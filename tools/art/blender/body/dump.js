// The reference bodies tools/art/blender/gear.py models body armour against (male.json.gz, female.json.gz): the
// character in its bind pose wearing the peasant kit (the layer armour goes over), in character space (Y up, facing
// +Z, metres, unscaled), every vertex with its skin joints and weights and the piece of the kit it belongs to (`m`, an
// index into `meshes`: which file it came from), the joints' order and the bones' positions.
// Run it in the game's model gallery with the client's dev server up, once per sex, and gzip the line it prints:
//
//   npx tsx tools/scripts/soak.ts --nologin --url "http://localhost:5173/?q=1&tier=NG&still&g=m" \
//     --eval @tools/art/blender/body/dump.js
const Q = await import('/src/render/quaternius.ts'), M = await import('/src/render/models.ts');
// the same three.js module the game uses (Vite rewrites the bare import to a versioned path)
const src = await (await fetch('/src/render/quaternius.ts')).text();
const THREE = await import(/from "([^"]*\/three\.js[^"]*)"/.exec(src)[1]);
await Q.loadQ();
const g = new URLSearchParams(location.search).get('g') === 'f' ? 'f' : 'm';
const chest = 'apprentice_tunic';
const rig = M.playerModel('human', 'fighter', null, chest, { g, hs: 0, hc: 0 }, [null, null, 'apprentice_stockings', 'leather_sandals']);
rig.root.scale.setScalar(1);
rig.body.scale.set(1, 1, 1);
rig.root.updateMatrixWorld(true);
const bones = {};
rig.root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
const bonePos = {};
for (const n in bones) bonePos[n] = bones[n].getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(4));
const V = [], F = [], Bn = [], J = [], W = [], Mi = [], meshes = [];
let joints = null;
rig.root.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  const here = o.skeleton.bones.map((b) => b.name);
  if (!joints) joints = here;
  else if (here.join() !== joints.join()) throw new Error(`${o.name}: its joints are in another order`);
  const pos = o.geometry.attributes.position, idx = o.geometry.index;
  const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
  const base = V.length;
  meshes.push(o.userData.file ?? o.name ?? `mesh${meshes.length}`);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    o.applyBoneTransform(i, v);
    v.applyMatrix4(o.matrixWorld);
    V.push([+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]);
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    Bn.push(o.skeleton.bones[best].name);
    J.push([0, 1, 2, 3].map((k) => si.getComponent(i, k)));
    W.push([0, 1, 2, 3].map((k) => +sw.getComponent(i, k).toFixed(4)));
    Mi.push(meshes.length - 1);
  }
  const n = idx ? idx.count : pos.count;
  for (let k = 0; k < n; k += 3) F.push([base + (idx ? idx.getX(k) : k), base + (idx ? idx.getX(k + 1) : k + 1), base + (idx ? idx.getX(k + 2) : k + 2)]);
});
const names = [...new Set(Bn)];
console.log(`[soak] BODY ${JSON.stringify({ g, chest, bones: bonePos, joints, names, meshes, v: V, f: F, b: Bn.map((n) => names.indexOf(n)), j: J, w: W, m: Mi })}`);
return 'end';
