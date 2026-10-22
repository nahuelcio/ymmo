// Retargets animation clips from another humanoid rig onto the Quaternius one the game animates (the 65 joints of
// q/anims.gltf), for q-assets.mjs. Rotations are carried over in world space against each rig's rest pose, after
// turning the target's rest bones to point the way the source's do (so a T-pose source drives an A-pose target
// right); the hips' travel is scaled by the ratio of leg lengths. Fingers and the bones the source lacks keep the
// target's own pose (`hold`: per-bone local rotations, e.g. a closed fist).
import fs from 'node:fs';
import * as THREE from 'three';

const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/** A .glb's JSON and binary chunk. */
export function readGlb(file) {
  const buf = fs.readFileSync(file);
  const len = buf.readUInt32LE(12);
  return { json: JSON.parse(buf.subarray(20, 20 + len).toString()), bin: buf.subarray(20 + len + 8) };
}

/** An accessor's values as floats (normalized integer types expanded, as glTF reads them). */
export function readAccessor({ json, bin }, i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView], n = a.count * SIZE[a.type];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out = new Float32Array(n);
  const stride = v.byteStride;
  const comp = { 5126: [4, (o) => bin.readFloatLE(o)], 5122: [2, (o) => Math.max(bin.readInt16LE(o) / 32767, -1)], 5123: [2, (o) => bin.readUInt16LE(o) / 65535],
    5120: [1, (o) => Math.max(bin.readInt8(o) / 127, -1)], 5121: [1, (o) => bin.readUInt8(o) / 255] }[a.componentType];
  const per = SIZE[a.type], el = comp[0] * per;
  for (let k = 0; k < a.count; k++) for (let c = 0; c < per; c++) out[k * per + c] = comp[1](off + k * (stride || el) + c * comp[0]);
  return out;
}

/** Rest transforms of a glTF's nodes: local TRS, parent, and world matrix / rotation / position. */
export function restPose(json) {
  const nodes = json.nodes.map((n) => ({
    name: n.name, parent: -1,
    t: new THREE.Vector3(...(n.translation ?? [0, 0, 0])), r: new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), s: new THREE.Vector3(...(n.scale ?? [1, 1, 1])),
  }));
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (nodes[c].parent = i)));
  const order = [];
  const visit = (i) => { if (order.includes(i)) return; if (nodes[i].parent >= 0) visit(nodes[i].parent); order.push(i); };
  nodes.forEach((_, i) => visit(i));
  for (const i of order) {
    const n = nodes[i], m = new THREE.Matrix4().compose(n.t, n.r, n.s);
    n.world = n.parent >= 0 ? nodes[n.parent].world.clone().multiply(m) : m;
    n.wq = new THREE.Quaternion(); n.wp = new THREE.Vector3();
    n.world.decompose(n.wp, n.wq, new THREE.Vector3());
  }
  return { nodes, order, byName: Object.fromEntries(nodes.map((n, i) => [n.name, i])) };
}

const lerpTrack = (times, vals, per, t, out, quat) => {
  let k = 0;
  while (k < times.length - 1 && times[k + 1] < t) k++;
  const k1 = Math.min(k + 1, times.length - 1), f = k1 === k ? 0 : THREE.MathUtils.clamp((t - times[k]) / (times[k1] - times[k]), 0, 1);
  if (quat) {
    const a = new THREE.Quaternion().fromArray(vals, k * 4), b = new THREE.Quaternion().fromArray(vals, k1 * 4);
    return out.copy(a.slerp(b, f));
  }
  for (let c = 0; c < per; c++) out.setComponent(c, vals[k * per + c] + (vals[k1 * per + c] - vals[k * per + c]) * f);
  return out;
};

/**
 * Retarget one clip. `src`: the source glb; `tgt`: the target rig's glTF JSON (its nodes: q/anims.gltf's); `map`: source
 * bone name -> target bone name; `hips`: [source, target] hips; `hold`: target bone name -> local quaternion for bones the
 * source does not drive. Returns { times, tracks: [{ node (target index), path, values }] }.
 */
export function retargetClip(src, clipName, tgtJson, map, hips, hold = {}, joints = null) {
  const S = restPose(src.json), T = restPose(tgtJson);
  const clip = src.json.animations.find((a) => a.name === clipName);
  if (!clip) throw new Error(`clip not found: ${clipName}`);
  const chans = clip.channels.map((c) => {
    const s = clip.samplers[c.sampler];
    return { node: c.target.node, path: c.target.path, times: readAccessor(src, s.input), vals: readAccessor(src, s.output) };
  });
  const times = [...new Set(chans.flatMap((c) => [...c.times]))].sort((a, b) => a - b);

  // the two rigs may face opposite ways: compare where their left hands are
  const side = (P, name) => P.nodes[P.byName[name]].wp.x;
  const pairs = Object.entries(map);
  const leftSrc = pairs.find(([s, t]) => /hand_l$/.test(t))[0];
  const flip = Math.sign(side(S, leftSrc)) !== Math.sign(side(T, map[leftSrc])) ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI) : new THREE.Quaternion();

  // the target's rest bones turned to point as the source's do (each towards its mapped child)
  const childOf = (P, i, names) => names.map((n) => P.byName[n]).find((c) => c !== undefined && (P.nodes[c].parent === i || P.nodes[P.nodes[c].parent]?.parent === i || P.nodes[P.nodes[P.nodes[c].parent]?.parent]?.parent === i));
  const align = {};
  for (const [s, t] of pairs) {
    const si = S.byName[s], ti = T.byName[t];
    const sc = childOf(S, si, pairs.map((p) => p[0])), tc = sc !== undefined ? T.byName[map[S.nodes[sc].name]] : undefined;
    if (sc === undefined || tc === undefined) continue;
    const ds = S.nodes[sc].wp.clone().sub(S.nodes[si].wp).applyQuaternion(flip).normalize();
    const dt = T.nodes[tc].wp.clone().sub(T.nodes[ti].wp).normalize();
    align[t] = new THREE.Quaternion().setFromUnitVectors(dt, ds);
  }
  // a bone with no mapped child turns as its parent did
  for (const [, t] of pairs) if (!align[t]) {
    let p = T.nodes[T.byName[t]].parent;
    while (p >= 0 && !align[T.nodes[p].name]) p = T.nodes[p].parent;
    align[t] = p >= 0 ? align[T.nodes[p].name].clone() : new THREE.Quaternion();
  }
  const ref = Object.fromEntries(pairs.map(([s, t]) => [t, { src: S.byName[s], inv: S.nodes[S.byName[s]].wq.clone().premultiply(flip).invert(), tgt: align[t].clone().multiply(T.nodes[T.byName[t]].wq) }]));

  // leg length ratio, for the hips' travel
  const legLen = (P, names) => names.slice(1).reduce((a, n, k) => a + P.nodes[P.byName[n]].wp.distanceTo(P.nodes[P.byName[names[k]]].wp), 0);
  const srcLeg = pairs.filter(([, t]) => /^(thigh|calf|foot)_l$/.test(t)).map(([s]) => s);
  const tgtLeg = srcLeg.map((s) => map[s]);
  const scale = legLen(T, tgtLeg) / legLen(S, srcLeg);

  const out = new Map(); // target index -> { path, values[] }
  // every target joint gets its track (the bones the source lacks at rest, or held), so the clip alone sets the pose
  const keep = (i) => !joints || joints.has(T.nodes[i].name);
  const put = (i, path, v) => { if (!keep(i)) return; const k = `${i}:${path}`; if (!out.has(k)) out.set(k, { node: i, path, values: [] }); out.get(k).values.push(...v); };
  const tmpV = new THREE.Vector3();
  for (const time of times) {
    // the source posed at this time
    const local = S.nodes.map((n) => ({ t: n.t.clone(), r: n.r.clone(), s: n.s.clone() }));
    for (const c of chans) {
      if (c.path === 'rotation') lerpTrack(c.times, c.vals, 4, time, local[c.node].r, true);
      else if (c.path === 'translation') lerpTrack(c.times, c.vals, 3, time, local[c.node].t);
      else if (c.path === 'scale') lerpTrack(c.times, c.vals, 3, time, local[c.node].s);
    }
    const world = [];
    for (const i of S.order) {
      const n = S.nodes[i], m = new THREE.Matrix4().compose(local[i].t, local[i].r, local[i].s);
      world[i] = n.parent >= 0 ? world[n.parent].clone().multiply(m) : m;
    }
    const wq = (i) => { const q = new THREE.Quaternion(); world[i].decompose(tmpV, q, new THREE.Vector3()); return q.premultiply(flip); };
    // the target, parents first
    const tWorld = [];
    for (const i of T.order) {
      const n = T.nodes[i], pw = n.parent >= 0 ? tWorld[n.parent] : null;
      const r = ref[n.name];
      let lq;
      if (r) {
        const want = wq(r.src).multiply(r.inv).multiply(r.tgt);
        lq = pw ? pw.clone().invert().multiply(want) : want;
        put(i, 'rotation', lq.toArray());
      } else {
        lq = hold[n.name] ? hold[n.name].clone() : n.r.clone();
        put(i, 'rotation', lq.toArray());
      }
      tWorld[i] = pw ? pw.clone().multiply(lq) : lq.clone();
    }
    // the hips' travel from their rest place, scaled to the target's legs, in the target pelvis's parent space
    const [sh, th] = hips.map((n, k) => (k ? T : S).byName[n]);
    const at = new THREE.Vector3().setFromMatrixPosition(world[sh]).sub(S.nodes[sh].wp).applyQuaternion(flip).multiplyScalar(scale);
    const want = T.nodes[th].wp.clone().add(at);
    const tp = T.nodes[th].parent;
    put(th, 'translation', (tp >= 0 ? want.applyMatrix4(T.nodes[tp].world.clone().invert()) : want).toArray());
  }
  return { times, tracks: [...out.values()] };
}
