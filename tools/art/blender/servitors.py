"""
Brings the summoner's servitors made with Tripo (tools/scripts/tripo.mjs tools/art/ai/servitors.json) into the game:
each model is set onto the skeleton of the mob it replaces (its donor: client/public/m/<donor>.glb) and bound to it,
so it moves with that mob's own clips, for tools/scripts/m-assets.mjs to finish into client/public/m/ai_<name>.glb.

    blender -b --python tools/art/blender/servitors.py -- <spec.json> <src dir> <out dir> war_wolf=1 mirage=2 ...
                                                          [--preview <dir>] [--force]

<src dir> holds Tripo's <name>_<n>.glb and donors/<donor>.glb: the donors as m-assets left them, decoded first
(npx @gltf-transform/cli dequantize client/public/m/<donor>.glb <src>/donors/<donor>.glb: Blender reads no meshopt).
For each servitor picked (name=n, the variant), the script:

  * keeps the donor's armature and the clips the client plays (the KayKit skeleton's from skeleton_anims.glb, which
    holds them for it), and measures its mesh before dropping it: the ground, the top, the belly line and the paws of a
    beast, the shoulders, the crotch and the hands of a body;
  * turns Tripo's model to face the donor's way (Tripo leaves the front towards +X) and sets it to the donor's height
    with its feet on the donor's ground, then moves the skeleton onto it part by part (the model keeps its own build: a
    stockier wolf, a wraith with high shoulders): each bone where the model has that part, its direction and roll kept,
    so the clips turn it as they did; the clips' moves (the paws' IK targets, the body's bob) grow or shrink with the
    legs. A part that would have to stretch past 2.5 or shrink under 0.4 stops it (another variant, or --force);
  * cuts it to the piece's `faces`, and binds it by distance as creatures.py did the yeti: each vertex to its nearest
    two or three bones among those its part may follow (a leg its own side's front or back chain, the tail its tail,
    the head rigidly its head, the horn, the wings and the sword their bone), the weights smoothed and those limits
    put back after;
  * gives it one material, Body: its colour map, and an emissive map of the texels of its glow's hue (the runes, the
    eyes, the ghost fire), no relief or metal maps (the mobs are drawn Lambert);

and writes <out dir>/ai_<name>.glb, printing its triangles, its unweighted vertices (none), the most bones on one vertex
(4 at most) and its clips. --preview <dir> renders it at rest, front and side, and in the middle of each clip.
"""
import colorsys
import heapq
import json
import math
import os
import re
import struct
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index('--') + 1:]
SPEC, SRC, OUT = args[0], args[1], args[2]
PICKS = dict(a.split('=') for a in args[3:] if '=' in a and not a.startswith('--'))
PREVIEW = args[args.index('--preview') + 1] if '--preview' in args else None
FORCE = '--force' in args
PIECES = json.load(open(SPEC, encoding='utf-8'))['pieces']
TEX = 1024  # m-assets.mjs brings it down to the mobs' 512

# Per donor: its file (`file`, else its name), the bones the mesh is bound to (a regex over the bone names), the clips
# the client plays (servitors.ts: the beasts' ANIMAL and STEED sets, the skeletons' BONES), the file that holds them
# when the donor's doesn't (`anims`), and the build (a beast on four legs, or a body standing in a T-pose).
DONORS = {
    'wolf': dict(beast=True, clips=['Idle', 'Gallop', 'Attack', 'Death'],
                 bind=r'(Back|Torso\d?|Neck\d|Head|(Front|Back)Shoulder|FrontUpperLeg|FrontLowerLeg|IKFrontLeg|FF|BackLeg|BackUpperLeg|BackLowerLeg|IKBackLeg|FFB|Tail\d)(\.[LR])?'),
    'horse': dict(beast=True, clips=['Idle', 'Gallop', 'Attack_Headbutt', 'Death'],
                  bind=r'(Back|Torso\d?|Neck\d|Head|(Front|Back)Shoulder|FrontUpperLeg|FrontLowerLeg|IKFrontLeg|FF|BackLeg|BackUpperLeg|BackLowerLeg|IKBackLeg|FFB|Tail\d)(\.[LR])?'),
    # the robe floats: no legs (Running_A would scissor it)
    # no death: Skeletons_Death takes a skeleton apart bone by bone (it tears a whole body), and a long robe swings flat
    # with a body's fall (Death_A): the client's keel-over (mobs.ts) fells the wraith whole
    'skeleton_mage': dict(beast=False, legs=False, anims=['skeleton_anims'],
                          clips=['Skeletons_Idle', 'Running_A', 'Melee_1H_Attack_Chop', 'Ranged_Magic_Spellcasting'],
                          bind=r'hips|spine|chest|head|(upperarm|lowerarm|wrist|hand)\.[lr]'),
    # the knight on the same KayKit skeleton, legs and all, with KayKit's own clips: a standing idle, a punch (its sword
    # cut away: drop_weapon()), a fall (the golem had none of these, nor arms to match a knight's)
    'knight': dict(file='skeleton_mage', beast=False, legs=True, anims=['Rig_Medium_General', 'Rig_Medium_CombatMelee', 'skeleton_anims'],
                   clips=['Idle_A', 'Running_A', 'Melee_Unarmed_Attack_Punch_A', 'Death_A', 'Ranged_Magic_Spellcasting'],
                   bind=r'hips|spine|chest|head|(upperarm|lowerarm|wrist|hand|upperleg|lowerleg|foot|toes)\.[lr]'),
}
# Quaternius' paws are weighted to the IK bones, which hang from the root: the leg goes on to them
NEXT = {'FrontLowerLeg': 'IKFrontLeg', 'IKFrontLeg': 'FF', 'BackLowerLeg': 'IKBackLeg', 'IKBackLeg': 'FFB'}


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def world_coords(ob):
    a = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', a)
    a = a.reshape(-1, 3)
    m = np.array(ob.matrix_world)
    return a @ m[:3, :3].T + m[:3, 3]


def set_coords(ob, g):
    """World coordinates back into the mesh (its transform is the identity by then)."""
    ob.data.vertices.foreach_set('co', g.ravel())
    ob.data.update()


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def image_into(socket):
    """The image texture feeding a socket, through whatever nodes are between (ai_gear.py)."""
    stack = [l.from_node for l in socket.links]
    while stack:
        n = stack.pop()
        if n.type == 'TEX_IMAGE':
            return n
        stack += [l.from_node for s in n.inputs for l in s.links]
    return None


def read(img, size):
    c = img.copy()
    c.scale(size, size)
    a = np.empty(size * size * 4, np.float32)
    c.pixels.foreach_get(a)
    bpy.data.images.remove(c)
    return a.reshape(size, size, 4)


# ---------------------------------------------------------------- the donor

def glb(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    return json.loads(b[20:20 + n]), b[28 + n:28 + n + struct.unpack('<I', b[20 + n:24 + n])[0]]


def with_clips(path, anims, out, keep):
    """The donor's file with the clips named in `keep` from others (made on the same skeleton: skeleton_anims.glb, which
    holds only clips, and KayKit's own Rig_Medium_* files) put into it, each channel on the node of the same name, as
    the client binds them; the first file to have a clip gives it. A file of clips only comes in as loose empties, not
    bones: its clips would not be the armature's."""
    g, bin_ = glb(path)
    node = {}
    for i, nd in enumerate(g['nodes']):
        node.setdefault(nd.get('name'), i)
    g['animations'], taken = [], set()
    for src in anims:
        a, abin = glb(src)
        base_off = (len(bin_) + 3) // 4 * 4
        bin_ = bin_ + b'\0' * (base_off - len(bin_)) + abin
        views, accs = len(g.get('bufferViews', [])), len(g.get('accessors', []))
        for v in a.get('bufferViews', []):
            g.setdefault('bufferViews', []).append({**v, 'buffer': 0, 'byteOffset': v.get('byteOffset', 0) + base_off})
        for acc in a.get('accessors', []):
            g.setdefault('accessors', []).append({**acc, 'bufferView': acc['bufferView'] + views})
        for an in a.get('animations', []):
            if an['name'] not in keep or an['name'] in taken:
                continue
            taken.add(an['name'])
            samplers = [{**s, 'input': s['input'] + accs, 'output': s['output'] + accs} for s in an['samplers']]
            channels = [{'sampler': c['sampler'], 'target': {'node': node[a['nodes'][c['target']['node']]['name']], 'path': c['target']['path']}}
                        for c in an['channels'] if a['nodes'][c['target']['node']].get('name') in node]
            g['animations'].append({'name': an['name'], 'samplers': samplers, 'channels': channels})
    g['buffers'][0]['byteLength'] = len(bin_)
    js = json.dumps(g).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    bin_ += b'\0' * ((4 - len(bin_) % 4) % 4)
    with open(out, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 28 + len(js) + len(bin_)))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942) + bin_)


def donor(name):
    """The donor's armature, its clips, and its mesh's measures; its meshes gone."""
    before = set(bpy.data.objects)
    path = os.path.join(SRC, 'donors', f'{DONORS[name].get("file", name)}.glb')
    if DONORS[name].get('anims'):
        path, src = os.path.join(tempfile.gettempdir(), f'servitors_{name}_clips.glb'), path
        with_clips(src, [os.path.join(SRC, 'donors', f'{a}.glb') for a in DONORS[name]['anims']], path, DONORS[name]['clips'])
    bpy.ops.import_scene.gltf(filepath=path, bone_heuristic='BLENDER', guess_original_bind_pose=False)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == 'ARMATURE')
    meshes = [o for o in new if o.type == 'MESH']
    # measured by its skinned meshes (not the importer's bone shape, an Icosphere, nor a hat hung on a bone) as the rest
    # pose shows them: their raw vertices are where the bind matrices take them from, not where they stand
    arm.data.pose_position = 'REST'
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in meshes:
        if o.vertex_groups:
            ev = o.evaluated_get(dg)
            me = ev.to_mesh()
            m = np.array(ev.matrix_world)
            a = np.array([v.co for v in me.vertices])
            pts.append(a @ m[:3, :3].T + m[:3, 3])
            ev.to_mesh_clear()
    pts = np.concatenate(pts)
    arm.data.pose_position = 'POSE'
    for o in meshes:
        bpy.data.objects.remove(o, do_unlink=True)
    d = DONORS[name]
    for a in list(bpy.data.actions):
        if a.name not in d['clips']:
            bpy.data.actions.remove(a)
    missing = set(d['clips']) - {a.name for a in bpy.data.actions}
    assert not missing, f'{name}: no clip {missing}'
    return arm, pts


def bones(arm):
    """Every bone's head in world space, by name."""
    return {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}


def base(n):
    return re.sub(r'\.[LRlr]$', '', n)


def measure_beast(pts):
    """A beast's measures (Blender space: Z up, its front towards -Y): ground, top, belly, its paws' centres, the line
    between its legs (`midx`: a head turned aside sways its bounds, not its legs)."""
    lo, hi = pts.min(0), pts.max(0)
    h = hi[2] - lo[2]
    low = pts[pts[:, 2] < lo[2] + 0.08 * h]
    mx = np.median(low[:, 0])
    # On each side, what reaches the ground in clumps along the body: the first two from the front are the paws, any
    # further back a tail (the seraphim's sweeps the ground behind it). Two clumps not found: split at the middle.
    paws = {}
    for side, sx in (('L', 1), ('R', -1)):
        sel = low[np.sign(low[:, 0] - mx) == sx]
        ys = np.sort(sel[:, 1])
        clumps = [c for c in np.split(ys, np.where(np.diff(ys) > 0.04 * h)[0] + 1) if len(c) >= 0.03 * len(ys)]
        if len(clumps) < 2:
            my = np.median(ys)
            clumps = [ys[ys < my], ys[ys >= my]]
        for end, c in (('front', clumps[0]), ('back', clumps[1])):
            at = sel[(sel[:, 1] >= c[0]) & (sel[:, 1] <= c[-1])]
            paws[end + side] = at.mean(0)
    fy = (paws['frontL'][1] + paws['frontR'][1]) / 2
    by = (paws['backL'][1] + paws['backR'][1]) / 2
    midx = float(np.mean([p[0] for p in paws.values()]))
    px = np.mean([abs(p[0] - midx) for p in paws.values()])
    # the belly: the lowest of the trunk between the legs, in the middle
    mid = pts[(pts[:, 1] > fy + 0.25 * (by - fy)) & (pts[:, 1] < by - 0.25 * (by - fy)) & (np.abs(pts[:, 0] - midx) < px * 0.5)]
    belly = mid[:, 2].min() if len(mid) else lo[2] + 0.45 * h
    return dict(ground=lo[2], top=hi[2], nose=lo[1], tail=hi[1], front=fy, back=by, pawx=px, belly=belly, h=h, midx=midx,
                hind=np.array([paws['backL'], paws['backR']]))


def measure_body(pts, legs):
    """A T-posed body's measures: ground, top, the arms' line and the hands' reach (on its left, +X: the weapon is in its
    right hand), the crotch (when it has legs)."""
    lo, hi = pts.min(0), pts.max(0)
    h = hi[2] - lo[2]
    left = pts[pts[:, 0] > 0]
    tip = left[:, 0].max()
    arms = left[left[:, 0] > 0.7 * tip]
    m = dict(ground=lo[2], top=hi[2], tip=tip, shoulder=float(np.median(arms[:, 2])), h=h)
    if legs:
        # where the legs part: going up, the last height at which the middle is clear between them, looked for in the
        # back half (a skirt of plates may hang in front of them, a robe between them)
        cx, back = (lo[0] + hi[0]) / 2, pts[pts[:, 1] > np.median(pts[:, 1])]
        m['crotch'] = lo[2] + 0.45 * h
        for z in np.arange(lo[2] + 0.1 * h, lo[2] + 0.7 * h, 0.01 * h):
            sl = back[(np.abs(back[:, 2] - z) < 0.01 * h) & (np.abs(back[:, 0] - cx) < 0.15 * h)]
            if len(sl) and np.abs(sl[:, 0] - cx).min() < 0.004 * h:
                m['crotch'] = z
                break
    return m


# ---------------------------------------------------------------- Tripo's model onto it

def load(path, name):
    """A downloaded model as one object, its transforms applied (ai_gear.py)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    names = [o.name for o in new]  # the join removes the others: by name after it
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    select_only(meshes)
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for n in names:
        if n in bpy.data.objects and bpy.data.objects[n] != ob:
            bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)
    select_only([ob])
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.name = ob.data.name = name
    return ob


def rot_z(g, a):
    c, s = math.cos(a), math.sin(a)
    return g @ np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])


def face(g, beast, yaw):
    """Turned to face -Y as the donors do. Tripo leaves the front towards +X; a beast drawn in three-quarter view may
    come turned, so it goes by its footprint: its length along Y, its head (the higher end) forward. `yaw` (degrees,
    the spec's) turns it on from there."""
    g = rot_z(g, -math.pi / 2)  # +X to -Y
    if beast:
        # its length from what is low (the legs, a tail's end: wings spread wide would skew the whole footprint), onto Y
        low = g[:, 2] < np.quantile(g[:, 2], 0.25)
        xy = g[low, :2] - g[low, :2].mean(0)
        w, v = np.linalg.eigh(np.cov(xy.T))
        long = v[:, np.argmax(w)]
        g = rot_z(g, math.atan2(long[0], long[1]))
        # the head forward (-Y): the highest of it (the ears, a horn) lies ahead of its legs
        top = g[:, 2] > np.quantile(g[:, 2], 0.97)
        if g[top, 1].mean() > g[low, 1].mean():
            g = rot_z(g, math.pi)
    elif np.ptp(g[:, 0]) < np.ptp(g[:, 1]):
        g = rot_z(g, math.pi / 2)  # the arms along X
    return rot_z(g, math.radians(yaw)) if yaw else g


def straighten_head(name, g):
    """A beast's head back in line with its body. Its concept was drawn in three-quarter view, the head turned to look
    out of the picture, and the model kept the turn: the tip of its head (the furthest of it, ahead of the front legs
    and over half its height, from the base of the neck: a muzzle, a horn) off the middle line between its legs. The
    neck and head turn back about an upright axis there, over the front legs, little at the base of the neck and
    fully by the head, so nothing creases."""
    m = measure_beast(g)
    base, h, x0 = m['front'], m['h'], m['midx']
    head = g[(g[:, 1] < base) & (g[:, 2] > m['ground'] + 0.5 * h)]
    tip = head[np.argmax(np.hypot(head[:, 0] - x0, head[:, 1] - base))]
    yaw = math.atan2(tip[0] - x0, base - tip[1])
    print(f'[servitors] {name}: its head was turned {math.degrees(yaw):.0f} degrees')
    if abs(yaw) < math.radians(4):
        return g
    w = np.clip((base - g[:, 1]) / (0.5 * (base - m['nose'])), 0, 1)
    a = -yaw * w
    c, s = np.cos(a), np.sin(a)
    x, y = g[:, 0] - x0, g[:, 1] - base
    out = g.copy()
    out[:, 0], out[:, 1] = x * c - y * s + x0, x * s + y * c + base
    return out


def shrink_head(name, g, k):
    """A beast's head (and its ruff) brought down to `k` of its size: Tripo's model may grow it past its concept's (the
    wolf's took nearly half its height, and the client sizes a servitor by its height). Toward a point at the base of
    the neck over the front legs, more the further from it: the neck tapers into it, the shoulders and chest stay."""
    m = measure_beast(g)
    h = m['h']
    pivot = np.array([m['midx'], m['front'] + 0.05 * h, m['ground'] + 0.5 * h])
    ahead = (g[:, 1] < m['front'] + 0.15 * h) & (g[:, 2] > m['belly'])
    w = np.clip((np.linalg.norm(g - pivot, axis=1) - 0.15 * h) / (0.25 * h), 0, 1) * ahead
    print(f'[servitors] {name}: its head to {k:.0%} of its size')
    return pivot + (g - pivot) * (1 - (1 - k) * w)[:, None]


def warp(x, src, dst):
    """Piecewise linear through the knots, straight on past the ends."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    out = np.interp(x, src, dst)
    lo, hi = x < src[0], x > src[-1]
    out[lo] = dst[0] + (x[lo] - src[0]) * (dst[1] - dst[0]) / (src[1] - src[0])
    out[hi] = dst[-1] + (x[hi] - src[-1]) * (dst[-1] - dst[-2]) / (src[-1] - src[-2])
    return out


def stretches(src, dst):
    return [(dst[i + 1] - dst[i]) / (src[i + 1] - src[i]) for i in range(len(src) - 1)]


def fit(name, g, dm, beast, legs):
    """The model at the donor's height, on its ground, and how its parts lie against the donor's: the map from the
    donor's to the model's, part by part (for reshape()), and how much its legs are the donor's."""
    lo, hi = g.min(0), g.max(0)
    g = (g - [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]]) * (dm['h'] / (hi[2] - lo[2]))
    g[:, 2] += dm['ground']
    if beast:
        m = measure_beast(g)
        # its legs' middle line on the donor's, and its paws' middle under the donor's
        g[:, 0] += dm['midx'] - m['midx']
        g[:, 1] += (dm['front'] + dm['back']) / 2 - (m['front'] + m['back']) / 2
        m = measure_beast(g)
        # along its length by its nose and its paws; behind the hind legs on as the trunk goes (what lies furthest back
        # may be a wing's tip, not the tail's: the tail gets its own reach, reach_tail())
        ys, yd = [m['nose'], m['front'], m['back']], [dm['nose'], dm['front'], dm['back']]
        zs, zd = [m['ground'], m['belly'], m['top']], [dm['ground'], dm['belly'], dm['top']]
        kx = dm['pawx'] / m['pawx']
        to_model = lambda p: np.stack([p[:, 0] / kx, warp(p[:, 1], yd, ys), warp(p[:, 2], zd, zs)], 1)
        ratios = stretches(ys, yd) + stretches(zs, zd) + [kx]
        leg = (m['belly'] - m['ground']) / (dm['belly'] - dm['ground'])
    else:
        hips = dm['hips']
        g[:, 0] += hips[0]
        g[:, 1] += hips[1] - np.median(g[:, 1])
        m = measure_body(g, legs)
        zs = [m['ground']] + ([m['crotch']] if legs else []) + [m['shoulder'], m['top']]
        zd = [dm['ground']] + ([dm['crotch']] if legs else []) + [dm['shoulder'], dm['top']]
        # the arms from the shoulders out (the trunk keeps its width)
        s = dm['shoulderx']
        k = (dm['tip'] - s) / (m['tip'] - s)

        def arms(x, k):
            ax = np.abs(x - hips[0])
            return np.where(ax > s, hips[0] + np.sign(x - hips[0]) * (s + (ax - s) * k), x)
        to_model = lambda p: np.stack([arms(p[:, 0], 1 / k), p[:, 1], warp(p[:, 2], zd, zs)], 1)
        ratios = stretches(zs, zd) + [k]
        leg = (m['crotch'] - m['ground']) / (dm['crotch'] - dm['ground']) if legs else 1.0
    print(f'[servitors] {name}: stretches {", ".join(f"{r:.2f}" for r in ratios)}')
    if not FORCE and any(r < 0.4 or r > 2.5 for r in ratios):
        show = lambda d: ', '.join(f'{k} {float(v):.3f}' for k, v in d.items() if np.ndim(v) == 0)
        print(f'[servitors] {name}: donor {show(dm)}\n[servitors] {name}: model {show(m)}')
        raise SystemExit(f'[servitors] {name}: its shape is too far from its donor\'s (another variant, or --force)')
    return g, to_model, leg


def reshape(arm, to_model, leg):
    """The skeleton onto the model: each bone's head to where the model has that part, its direction and roll kept (a
    clip turns a bone about its own axes: they must not change), its length as the model's there. The clips' moves (a
    bone's offsets from its rest: the paws' IK targets, the body's bob) shrink or grow with the legs."""
    select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    mw = arm.matrix_world
    inv = mw.inverted()
    for eb in arm.data.edit_bones:
        eb.use_connect = False
    for eb in arm.data.edit_bones:
        h, t = mw @ eb.head, mw @ eb.tail
        nh, nt = (Vector(v) for v in to_model(np.array([h, t])))
        d = t - h
        roll = eb.roll
        eb.head = inv @ nh
        eb.tail = inv @ (nh + d * ((nt - nh).length / max(d.length, 1e-9)))
        eb.roll = roll
    bpy.ops.object.mode_set(mode='OBJECT')
    for act in bpy.data.actions:
        for fc in fcurves(act):
            if fc.data_path.endswith('.location'):
                for k in fc.keyframe_points:
                    k.co.y *= leg
                    k.handle_left.y *= leg
                    k.handle_right.y *= leg


def tail_room(g, m):
    """Where a tail's tip may be: behind the hind legs, near the middle, above a fifth of the height (lower, between
    close hind legs, lie their inner sides: a short tail's tip is not the furthest from its root there)."""
    return (g[:, 1] > m['back']) & (np.abs(g[:, 0] - m['midx']) < m['pawx'] * 0.6) & (g[:, 2] > m['ground'] + 0.2 * m['h'])


def hind_legs(g, edges, m):
    """The hind legs: what the mesh reaches from a hind hoof within about the leg's length (up to the belly's height).
    A tail hanging against them is further along the mesh: up the leg, over the haunch, down the tail."""
    hooves = [int(np.argmin(np.linalg.norm(g - p, axis=1))) for p in m['hind']]
    return np.min([geodesic(g, edges, v) for v in hooves], 0) < 1.1 * (m['belly'] - m['ground'])


def tail_tip(g, edges, m, root, legs):
    """A tail's tip: the furthest from its root where a tip may be (tail_room()), off the hind legs (a short tail's tip
    may be nearer its root than the hocks are). None when there is none."""
    cand = np.where(tail_room(g, m) & ~legs)[0]
    return int(cand[np.argmax(np.linalg.norm(g[cand] - root, axis=1))]) if len(cand) else None


def reach_tail(arm, g, edges, m):
    """The tail's bones stretched along their own line to the model's tail tip (tail_tip()), when it hangs longer than
    the donor's: else its end (a horse's tail down to the hocks) is nearer the hind legs than any tail bone."""
    tail = sorted((b for b in arm.data.bones if re.fullmatch(r'Tail\d', b.name)), key=lambda b: int(b.name[4:]))
    if not tail:
        return
    mw = arm.matrix_world
    root = np.array(mw @ tail[0].head_local)
    end = np.array(mw @ tail[-1].tail_local)
    tip = tail_tip(g, edges, m, root, hind_legs(g, edges, m))
    if tip is None:
        return
    tip = g[tip]
    k = np.linalg.norm(tip - root) / max(np.linalg.norm(end - root), 1e-9)
    print(f'[servitors] its tail reaches x{k:.2f} to the model\'s tip')
    if k <= 1:
        return
    select_only([arm])
    bpy.ops.object.mode_set(mode='EDIT')
    inv = mw.inverted()
    r = Vector(root)
    for b in tail:
        eb = arm.data.edit_bones[b.name]
        h, t = mw @ eb.head, mw @ eb.tail
        roll = eb.roll
        eb.head = inv @ (r + (h - r) * k)
        eb.tail = inv @ (r + (t - r) * k)
        eb.roll = roll
    bpy.ops.object.mode_set(mode='OBJECT')


def calm(pattern, k):
    """The clips' turns of the bones matching `pattern` brought toward their rest by `k` (1: as they were, 0: still): a
    unicorn's long tail flung up by the horse's gallop as its short one was would stream out like a flag."""
    pat = re.compile(f'^({pattern})$')
    for act in bpy.data.actions:
        quats = {}
        for fc in fcurves(act):
            m = re.match(r'pose\.bones\["(.+)"\]\.rotation_quaternion', fc.data_path)
            if m and pat.match(m.group(1)):
                quats.setdefault(m.group(1), {})[fc.array_index] = fc
        for curves in quats.values():
            if len(curves) < 4:
                continue
            for i in range(len(curves[0].keyframe_points)):
                q = Quaternion([curves[c].keyframe_points[i].co.y for c in range(4)])
                r = Quaternion().slerp(q, k)
                for c in range(4):
                    kp = curves[c].keyframe_points[i]
                    kp.co.y = kp.handle_left.y = kp.handle_right.y = r[c]


def fcurves(act):
    """An action's curves, in its layers' channel bags (Blender 4.4 on) or the old flat list."""
    if hasattr(act, 'layers') and act.layers:
        return [fc for layer in act.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    return list(getattr(act, 'fcurves', []))


# ---------------------------------------------------------------- the binding

def segments(arm, bind):
    """Each bound bone as a segment, from its head to its next bound bone's head (a leaf: a stub half its parent's
    length on); the importer's tails are guesses."""
    pat = re.compile(f'^({bind})$')
    heads = bones(arm)
    names = [b.name for b in arm.data.bones if pat.match(b.name)]
    segs = {}
    for n in names:
        b = arm.data.bones[n]
        side = n[len(base(n)):]
        nxt = NEXT.get(base(n))
        a = heads[n]
        # the child that carries on the chain: the one least off to the side (a chest's head, not its arms)
        kids = [nxt + side] if nxt and nxt + side in heads else sorted((c.name for c in b.children if c.name in names), key=lambda c: abs(heads[c].x - a.x))
        if kids:
            e = heads[kids[0]]
        else:
            p = b.parent
            d = (a - heads[p.name]) if p else Vector((0, 0, 0.1))
            e = a + d * 0.5
        segs[n] = (np.array(a), np.array(e))
    return segs


def seg_near(p, a, b):
    """The point of the segment a-b nearest each point."""
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return a + t[:, None] * ab


def seg_dist(p, a, b):
    """Distance of each point to the segment a-b (creatures.py's, over arrays)."""
    return np.linalg.norm(p - seg_near(p, a, b), axis=1)


def allowed(name, g, segs, dm, beast, piece, parts, edges):
    """For each vertex, the bones it may follow, those it follows rigidly (a mask per bone), and how far some are kept
    from it (a factor on its distance to that bone, per bone: 1 not at all)."""
    names = list(segs)
    n = len(g)
    ok = {b: np.ones(n, bool) for b in names}
    rigid, far = {}, {}
    near = np.argmin(np.stack([seg_dist(g, *segs[b]) for b in names], 1), 1)
    nearest = np.array(names)[near]
    side_of = lambda b: np.sign(segs[b][0][0])
    weapon = None
    if beast:
        legs_front = [b for b in names if base(b) in ('FrontShoulder', 'FrontUpperLeg', 'FrontLowerLeg', 'IKFrontLeg', 'FF')]
        legs_back = [b for b in names if base(b) in ('BackShoulder', 'BackLeg', 'BackUpperLeg', 'BackLowerLeg', 'IKBackLeg', 'FFB')]
        lower = [b for b in legs_front + legs_back if base(b) in ('FrontLowerLeg', 'IKFrontLeg', 'FF', 'BackLowerLeg', 'IKBackLeg', 'FFB')]
        tail = [b for b in names if base(b).startswith('Tail')]
        mid = (dm['front'] + dm['back']) / 2
        # the tail (tail_of()) takes its own bones, its base the trunk's too; under the belly it still follows the tail
        is_tail, any_tail = tail_of(g, edges, segs, dm, np.isin(nearest, tail))
        below = (g[:, 2] < dm['belly']) & ~is_tail
        front = g[:, 1] < mid
        for b in names:
            if b in legs_front or b in legs_back:
                # a leg takes only its own side, and under the belly only its own end's
                same_side = np.sign(g[:, 0] - dm['midx']) == side_of(b)
                right_end = front if b in legs_front else ~front
                ok[b] &= same_side & (~below | right_end)
                if b in lower:
                    ok[b] &= below  # the trunk never follows a shin or a paw
            elif b not in ('Back',) and not base(b).startswith('Torso'):
                ok[b] &= ~below  # under the belly only legs
        # The barrel, between the legs and over the belly, follows the trunk. The legs' bones run up into it (the
        # thigh's from the hip down past the flank), nearer its lower half than the spine is, and a leg swinging back
        # would drag the belly in. None of them in its middle; toward the shoulders and the haunches they come back,
        # kept off less and less (their distance up to four times as far), so nothing creases where the two meet.
        along = (g[:, 1] - dm['front']) / (dm['back'] - dm['front'])  # 0 at the front paws, 1 at the hind ones
        over = (g[:, 2] > dm['belly']) & ~is_tail
        keep_off = np.clip(np.minimum((along - 0.1) / 0.15, (0.9 - along) / 0.15), 0, 1) * over
        for b in legs_front + legs_back:
            ok[b] &= keep_off < 1
            far[b] = 1 + 3 * keep_off
        # the tail its own, the trunk none of it
        for b in names:
            if b in tail:
                ok[b] &= any_tail
            elif base(b) not in ('Back', 'Torso', 'Torso2', 'Torso3'):
                ok[b] &= ~is_tail
        # the head (its ears, its horn) rigidly with Head
        head = [b for b in names if base(b) == 'Head']
        if head:
            rigid[head[0]] = nearest == head[0]
        if piece.get('wings'):
            # the folded wings ride on the trunk: wide of the body, over the belly, never on a leg or the neck
            trunk = [b for b in names if base(b) in ('Back', 'Torso', 'Torso2', 'Torso3')]
            wide = (np.abs(g[:, 0] - dm['midx']) > dm['pawx'] * 0.9) & ~below & (g[:, 1] > dm['front'] - 0.1 * dm['h'])
            for b in names:
                if b not in trunk:
                    ok[b] &= ~wide
    else:
        hips = dm['hips']
        arms = {s: [b for b in names if side_of(b) == s and re.match(r'(shoulder|upper_?arm|lower_?arm|forearm|wrist|hand)', base(b))] for s in (1, -1)}
        legs = {s: [b for b in names if side_of(b) == s and re.match(r'(thigh|shin|upperleg|lowerleg|foot|toe)', base(b))] for s in (1, -1)}
        # past the shoulders the arms, but only over the hips (and the crotch): below them a wide stance, a skirt of
        # plates or a robe's hem reaching past a narrow skeleton's shoulders is legs, or the robe
        over = g[:, 2] > max(dm['crotch'] + 0.05 * dm['h'], hips[2])
        out = (np.abs(g[:, 0] - hips[0]) > dm['shoulderx']) & over
        # What sits over the shoulder joint (a pauldron) rides the chest: an arm lowered from the T-pose would fling it
        # up and out. Barred a little above the joint, kept off (three times as far) just over it; out to the elbow,
        # less and less over the forearm's first half (what rises off a forearm, a flame at the elbow, is the arm's).
        upper = [segs[b][0] for s in (1, -1) for b in arms[s] if re.match(r'upper_?arm', base(b))]
        joint = np.mean([a[2] for a in upper] or [np.inf])
        elbows = [abs(segs[b][0][0] - hips[0]) for s in (1, -1) for b in arms[s] if re.match(r'(lower_?arm|forearm)', base(b))]
        shoulder = np.mean([abs(a[0] - hips[0]) for a in upper] or [0])
        elbow, half = (np.mean(elbows), 0.5 * (np.mean(elbows) - shoulder)) if elbows else (np.inf, 1)
        reach = np.clip((elbow + half - np.abs(g[:, 0] - hips[0])) / half, 0, 1)
        atop = np.clip((g[:, 2] - joint) / (0.04 * dm['h']), 0, 1) * reach
        # Under its T-posed arms (spec `sleeves`: how far under its arm the arm's own mesh still reaches, a sleeve or a
        # fist, of the height) a body is not arm, even past the narrow shoulders: a robe's drape hanging from the sleeves
        # (the arm lowered from the T would swing it in across the body, the two sides crossed), a knight's hip plates.
        # It rides the trunk, the arm kept off it more and more (up to four times as far) going down.
        drape = np.zeros(n)
        for s in (1, -1):
            mine = np.sign(g[:, 0] - hips[0]) == s
            if piece.get('sleeves') and arms[s]:
                r = piece['sleeves'] * dm['h']
                d = np.stack([seg_dist(g, *segs[b]) for b in arms[s]], 1)
                line = np.stack([seg_near(g, *segs[b])[:, 2] for b in arms[s]], 1)[np.arange(n), d.argmin(1)]
                drape = np.where(mine, np.clip((line - g[:, 2] - r) / r, 0, 1), drape)
            for b in arms[s]:
                ok[b] &= mine & over & (atop < 1)
                far[b] = 1 + 2 * atop + 3 * drape
            for b in legs[s]:
                ok[b] &= mine & (g[:, 2] < dm['crotch'] + 0.05 * dm['h'])
        for b in names:
            if not any(b in arms[s] for s in (1, -1)):
                ok[b] &= ~out | (drape > 0) | (atop > 0)  # past the shoulders only the arms (the drape under them, a pauldron over them the trunk's)
        head = [b for b in names if base(b) == 'head']
        if head:
            hz = segs[head[0]][0][2]
            rigid[head[0]] = (nearest == head[0]) & (g[:, 2] > hz)
            # the head only over its neck and within the shoulders: a collar, a pauldron nodded with it
            ok[head[0]] &= (g[:, 2] > hz - 0.08 * dm['h']) & (np.abs(g[:, 0] - hips[0]) < dm['shoulderx'])
        if piece.get('weapon') == 'R':
            weapon = next(b for b in names if base(b) == 'hand' and side_of(b) < 0)  # the right one (-X)
    # A loose part (all but the body) rigidly with one bone, the nearest its middle; near the weapon hand, that hand
    # (the sword hold_weapon() cut loose and turned: its blade, its hilt).
    held = lambda p: weapon is not None and np.linalg.norm(g[p].mean(0) - segs[weapon][0]) < 0.6 * dm['h']
    for part in parts[1:]:
        c = g[part].mean(0)[None]
        b = weapon if held(part) else names[int(np.argmin([seg_dist(c, *segs[n])[0] for n in names]))]
        m = np.zeros(len(g), bool)
        m[part] = True
        rigid[b] = rigid.get(b, np.zeros(len(g), bool)) | m
    return ok, rigid, far


def tail_of(g, edges, segs, m, near=None):
    """A beast's tail, and its tail with its base: what lies along the mesh from its tip no further than most of the way
    to its root (the rest of the way, the base, may take the trunk's bones too). A long tail hangs against the hind
    legs, nearer some of their bones than its own: along the surface it is far from them (up the tail and down the
    haunch). Without a tip to go from, `near` (what is nearest a tail bone)."""
    near = np.zeros(len(g), bool) if near is None else near
    tail = [b for b in segs if base(b).startswith('Tail')]
    if not tail:
        return near, near
    root = segs[min(tail, key=lambda b: int(base(b)[4:]))][0]
    legs = hind_legs(g, edges, m)
    tip = tail_tip(g, edges, m, root, legs)
    if tip is None:
        return near & ~legs, near & ~legs
    along = geodesic(g, edges, tip)
    to_root = along[np.argmin(np.linalg.norm(g - root, axis=1))]
    if not np.isfinite(to_root):
        return near & ~legs, near & ~legs
    return (along < 0.85 * to_root) & ~legs, (along < 1.05 * to_root) & ~legs


def geodesic(g, edges, src):
    """How far each vertex is from one along the mesh's edges (Dijkstra; another loose part: infinitely)."""
    adj = [[] for _ in range(len(g))]
    for a, b in edges:
        w = float(np.linalg.norm(g[a] - g[b]))
        adj[a].append((b, w))
        adj[b].append((a, w))
    dist = np.full(len(g), np.inf)
    dist[src] = 0.0
    heap = [(0.0, int(src))]
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v]:
            continue
        for w, l in adj[v]:
            if d + l < dist[w]:
                dist[w] = d + l
                heapq.heappush(heap, (d + l, w))
    return dist


def mend_blade(name, ob, segs, h):
    """A blade Tripo left apart from its hilt (the spectral lord's: a loose part below the fist, off to the side and
    slanted) set back under it: turned to hang straight down, its upper end on the hilt's lowest point (the lowest of
    the body near the weapon hand, under it). The loose-part rule in allowed() then holds it to that hand."""
    g = world_coords(ob)
    parts = islands(ob)
    hand = next((b for b in segs if base(b) == 'hand' and np.sign(segs[b][0][0]) < 0), None)
    loose = [p for p in parts[1:] if g[p, 0].mean() < 0]
    if hand is None or not loose:
        return
    hp = segs[hand][0]
    blade = max(loose, key=lambda p: np.ptp(g[p, 2]))
    body = parts[0]
    under = body[(np.hypot(g[body, 0] - hp[0], g[body, 1] - hp[1]) < 0.08 * h) & (g[body, 2] < hp[2])]
    if not len(under):
        return
    hilt = g[under[np.argmin(g[under, 2])]]
    b = g[blade]
    w, v = np.linalg.eigh(np.cov((b - b.mean(0)).T))
    axis = v[:, np.argmax(w)] * (-1 if v[2, np.argmax(w)] > 0 else 1)  # down its length
    turn = np.array(Vector(axis).rotation_difference(Vector((0, 0, -1))).to_matrix())
    top = b[np.argmin(b @ axis)]
    for i, p in zip(blade, (b - top) @ turn.T + hilt):
        ob.data.vertices[i].co = p
    ob.data.update()
    gap = np.linalg.norm(top - hilt)
    print(f'[servitors] {name}: its blade put back under its hilt ({gap / h:.0%} of its height away, '
          f'{math.degrees(math.acos(min(1.0, -axis[2]))):.0f} degrees off upright)')


def hold_weapon(name, ob, arm, segs, h):
    """The sword held as KayKit's weapons are, so KayKit's clips swing it as they do theirs: KayKit's swords lie along
    their hand slot's +Y, which points ahead in the skeleton's T-pose. Its blade first set back under the hilt
    (mend_blade()), then the hilt (what of the body hangs under the fist) cut loose from it, and the two turned together
    about the right hand's slot, from hanging down to pointing ahead (-Y here)."""
    mend_blade(name, ob, segs, h)
    hand = segs[next(b for b in segs if base(b) == 'hand' and np.sign(segs[b][0][0]) < 0)][0]
    # turned about the fist, between the wrist and the slot (KayKit's slot sits a little past the hand)
    slot = (hand + np.array(arm.matrix_world @ arm.data.bones['handslot.r'].head_local)) / 2
    g = world_coords(ob)
    body = islands(ob)[0]
    hilt = set(body[(np.hypot(g[body, 0] - hand[0], g[body, 1] - hand[1]) < 0.09 * h) & (g[body, 2] < hand[2] - 0.04 * h)].tolist())
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.split(bm, geom=[f for f in bm.faces if all(v.index in hilt for v in f.verts)])
    bm.to_mesh(ob.data)
    bm.free()
    g = world_coords(ob)
    parts = islands(ob)
    sword = [p for p in parts[1:] if np.linalg.norm(g[p].mean(0) - slot) < 0.6 * h]
    if not sword:
        return
    sword = np.concatenate(sword)
    turn = np.array(Vector((0, 0, -1)).rotation_difference(Vector((0, -1, 0))).to_matrix())
    for i, p in zip(sword, (g[sword] - slot) @ turn.T + slot):
        ob.data.vertices[i].co = p
    ob.data.update()
    print(f'[servitors] {name}: its sword ({len(sword)} vertices, the hilt {len(hilt)}) held ahead from its hand slot')


def drop_weapon(name, ob, segs, h):
    """The sword Tripo put in the right fist cut away (spec `weapon: drop`): its blade, the loose part hanging along
    under the fist with whatever lies on its line, and its hilt, what of the body hangs under the fist from where it
    narrows to a grip (the fist sits ahead of KayKit's hand bone: by its width across the arm, any depth). The fist's
    underside, opened where the hilt was, closed."""
    hand = segs[next(b for b in segs if base(b) == 'hand' and np.sign(segs[b][0][0]) < 0)][0]
    g = world_coords(ob)
    parts = islands(ob)
    body = parts[0]
    under = body[(np.abs(g[body, 0] - hand[0]) < 0.1 * h) & (g[body, 2] < hand[2])]
    grip = hand[2]
    for z in np.arange(hand[2], hand[2] - 0.25 * h, -0.015 * h):
        sl = g[under[(g[under, 2] < z) & (g[under, 2] >= z - 0.015 * h)]]
        if len(sl) and np.ptp(sl[:, 0]) < 0.035 * h:
            grip = z
            break
    cut = set(under[g[under, 2] < grip].tolist())
    loose = [p for p in parts[1:] if g[p, 0].mean() < 0]
    if loose:
        blade = max(loose, key=lambda p: np.ptp(g[p, 2]))
        b = g[blade]
        w, v = np.linalg.eigh(np.cov((b - b.mean(0)).T))
        axis = v[:, np.argmax(w)]
        t = (b - b.mean(0)) @ axis
        ends = b.mean(0) + np.outer([t.min() - 0.05 * h, t.max() + 0.05 * h], axis)
        for p in loose:
            if p is blade or np.all(seg_dist(g[p], *ends) < 0.06 * h):
                cut.update(p.tolist())
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in cut], context='VERTS')
    near = lambda e: all(np.linalg.norm(np.array(v.co) - hand) < 0.15 * h for v in e.verts)
    bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary and near(e)], sides=0)
    bm.to_mesh(ob.data)
    bm.free()
    print(f'[servitors] {name}: its sword cut away ({len(cut)} vertices, the grip from {(hand[2] - grip) / h:.0%} of its '
          f'height under the hand)')


def islands(ob):
    """The mesh's loose parts (vertex indices), the largest (the body) first."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    seen = np.zeros(len(bm.verts), bool)
    out = []
    for v0 in bm.verts:
        if seen[v0.index]:
            continue
        seen[v0.index] = True
        stack, part = [v0], []
        while stack:
            v = stack.pop()
            part.append(v.index)
            for e in v.link_edges:
                w = e.other_vert(v)
                if not seen[w.index]:
                    seen[w.index] = True
                    stack.append(w)
        out.append(np.array(part))
    bm.free()
    return sorted(out, key=len, reverse=True)


def bind(ob, arm, segs, ok, rigid, far, h):
    g = world_coords(ob)
    names = list(segs)
    dist = np.stack([seg_dist(g, *segs[b]) * far.get(b, 1.0) for b in names], 1)
    allow = np.stack([ok[b] for b in names], 1)
    for b, m in rigid.items():
        allow[m] = False
        allow[m, names.index(b)] = True
    # a vertex left with no bone it may follow (a stray bit out of every part) takes the nearest of them all
    allow[~allow.any(1)] = True
    dist[~allow] = np.inf
    assert len(ob.vertex_groups) == 0, f'{ob.name}: it came with vertex groups'
    eps, margin = 0.005 * h, 0.01 * h
    groups = [ob.vertex_groups.new(name=b) for b in names]
    order = np.argsort(dist, 1)[:, :3]
    for i in range(len(g)):
        d = dist[i, order[i]]
        keep = (d <= d[0] * 1.6 + margin) & np.isfinite(d)
        w = 1 / (d[keep] + eps) ** 4
        for j, wj in zip(order[i][keep], w / w.sum()):
            groups[j].add([i], float(wj), 'REPLACE')
    select_only([ob])
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=4)
    bpy.ops.object.mode_set(mode='OBJECT')
    # the smoothing spreads over the limits: back inside them
    for v in ob.data.vertices:
        for e in list(v.groups):
            if not allow[v.index, e.group]:
                ob.vertex_groups[e.group].remove([v.index])
    select_only([ob])
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # skinned by the modifier alone, the mesh left at the root: under Quaternius' armature (its turn and scale 100) its
    # node would carry them, and three.js applies a skinned mesh's node transform (glTF says to ignore it): turned
    mod = ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm


# ---------------------------------------------------------------- the material

def body(ob, name, glow):
    """One material, Body: the colour map, and its glow's texels (that hue, saturated and bright) as the emissive map."""
    src = ob.data.materials[0]
    bsdf = next(n for n in src.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = image_into(bsdf.inputs['Base Color'])
    if tex is None:
        print(f'[servitors] {name}: no colour map (a stand-in?): its own materials kept')
        return
    col = read(tex.image, TEX)
    m = bpy.data.materials.new('Body')
    m.use_nodes = True
    nt = m.node_tree
    out = nt.nodes['Principled BSDF']
    out.inputs['Roughness'].default_value, out.inputs['Metallic'].default_value = 1.0, 0.0
    ci = bpy.data.images.new(f'{name}_color', TEX, TEX, alpha=False)
    ci.pixels.foreach_set(col.ravel())
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = ci
    nt.links.new(tc.outputs['Color'], out.inputs['Base Color'])
    if glow:
        rgb = col[..., :3]
        mx, mn = rgb.max(-1), rgb.min(-1)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        d = np.maximum(mx - mn, 1e-6)
        hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
        want = colorsys.rgb_to_hsv(*[int(glow['hue'][i:i + 2], 16) / 255 for i in (0, 2, 4)])[0] * 360
        dh = np.abs((hue - want + 180) % 360 - 180)
        mask = ((dh < 25) & (sat > 0.35) & (mx > glow.get('min', 0.6))).astype(np.float32)
        em = col.copy()
        em[..., :3] *= mask[..., None]
        em[..., 3] = 1
        print(f'[servitors] {name}: {mask.mean() * 100:.1f}% of the texture glows')
        ei = bpy.data.images.new(f'{name}_glow', TEX, TEX, alpha=False)
        ei.pixels.foreach_set(em.ravel())
        te = nt.nodes.new('ShaderNodeTexImage')
        te.image = ei
        nt.links.new(te.outputs['Color'], out.inputs['Emission Color'])
        out.inputs['Emission Strength'].default_value = 1.0
    nt.nodes.active = tc
    ob.data.materials.clear()
    ob.data.materials.append(m)


# ---------------------------------------------------------------- out

def export(path, ob, arm, clips):
    objs = [ob, arm]
    p = arm.parent
    while p:
        objs.append(p)  # the root nodes the armature hangs from (Quaternius' scale and turn)
        p = p.parent
    select_only(objs, arm)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=bool(clips),
                              export_animation_mode='ACTIONS', export_skins=True, export_morph=False, export_apply=False,
                              export_image_format='WEBP')


def report(name, ob, clips, budget):
    most = max((len(v.groups) for v in ob.data.vertices), default=0)
    bare = sum(1 for v in ob.data.vertices if not v.groups)
    print(f'[servitors] {name}: {tris(ob)} triangles (budget {budget}), {bare} unweighted vertices, at most {most} bones on '
          f'one, clips {clips}')
    assert bare == 0 and most <= 4, f'{name}: bad weights'


def preview(name, ob, arm, clips, dm):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light, sc.display.shading.color_type = 'STUDIO', 'TEXTURE'
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 512
    cam = bpy.data.objects.get('cam') or bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type, cam.data.clip_end = 'ORTHO', 100.0
    lo, hi = world_coords(ob).min(0), world_coords(ob).max(0)
    c = (lo + hi) / 2
    cam.data.ortho_scale = float(max(hi - lo)) * 1.15
    views = {'front': ((c[0], c[1] - 20, c[2]), (math.pi / 2, 0, 0)), 'side': ((c[0] + 20, c[1], c[2]), (math.pi / 2, 0, math.pi / 2))}
    shots = [('rest', None, 0)] + [(a, a, 0.5) for a in clips]
    arm.animation_data_create()
    for label, clip, at in shots:
        if clip:
            act = bpy.data.actions[clip]
            arm.animation_data.action = act
            if hasattr(arm.animation_data, 'action_slot') and act.slots:
                arm.animation_data.action_slot = act.slots[0]
            f0, f1 = act.frame_range
            sc.frame_set(int(f0 + (f1 - f0) * at))
        else:
            arm.animation_data.action = None
            arm.data.pose_position = 'REST'
        for v, (loc, rot) in views.items():
            if clip and v == 'front':
                continue
            cam.location, cam.rotation_euler = loc, rot
            sc.render.filepath = os.path.join(PREVIEW, f'{name}_{label}_{v}.png')
            bpy.ops.render.render(write_still=True)
        arm.data.pose_position = 'POSE'


def measures(pts, arm, d):
    """A shape's measures against a skeleton: a beast's (measure_beast), or a body's with its skeleton's hips and
    shoulders."""
    if d['beast']:
        return measure_beast(pts)
    heads = bones(arm)
    m = measure_body(pts, d['legs'])
    hips = next(v for k, v in heads.items() if base(k) == 'hips')
    m['hips'] = np.array(hips)
    m['shoulderx'] = float(np.mean([abs(v[0] - hips[0]) for k, v in heads.items() if re.match(r'(upper_?arm)', base(k))]))
    thighs = [v[2] for k, v in heads.items() if re.match(r'(thigh|upperleg)', base(k))]
    if not d['legs']:
        m['crotch'] = m['ground']
    elif thighs:
        m['crotch'] = float(np.mean(thighs))  # the skeleton knows where its legs part (its mesh may wear a robe)
    return m


def make(name, n):
    piece = PIECES[name]
    d = DONORS[piece['donor']]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arm, pts = donor(piece['donor'])
    beast = d['beast']
    dm = measures(pts, arm, d)
    ob = load(os.path.join(SRC, f'{name}_{n}.glb'), name)
    if len(ob.data.materials) != 1:
        print(f'[servitors] {name}: {len(ob.data.materials)} materials (Tripo gives one): the first one\'s map is used')
    g = face(world_coords(ob), beast, piece.get('yaw', 0))
    if beast:
        g = straighten_head(name, g)
        if 'head_scale' in piece:
            g = shrink_head(name, g, piece['head_scale'])
    g, to_model, leg = fit(name, g, dm, beast, d.get('legs'))
    reshape(arm, to_model, leg)
    ob.matrix_world = Matrix.Identity(4)
    set_coords(ob, g)
    # one vertex where several meet (a flat-shaded mesh has its own per face): the weights' smoothing goes along edges,
    # and copies apart would tear (the UVs, on the corners, keep their seams)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4 * dm['h'])
    bm.to_mesh(ob.data)
    bm.free()
    n0 = tris(ob)
    if n0 > piece['faces']:
        select_only([ob])
        cut = ob.modifiers.new('cut', 'DECIMATE')
        cut.ratio, cut.use_collapse_triangulate = piece['faces'] / n0, True
        bpy.ops.object.modifier_apply(modifier='cut')
    select_only([ob])
    if ob.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
    g, edges = world_coords(ob), np.array([e.vertices[:] for e in ob.data.edges])
    if beast:
        reach_tail(arm, g, edges, measure_beast(g))
    if 'tail_swing' in piece:
        calm(r'Tail\d', piece['tail_swing'])
    # the parts' limits by the shape as it now stands, on the skeleton as it now stands
    rm = measures(g, arm, d)
    segs = segments(arm, d['bind'])
    print(f'[servitors] {name}: bound to {len(segs)} bones of {piece["donor"]}: {", ".join(segs)}')
    if piece.get('weapon') == 'drop':
        drop_weapon(name, ob, segs, rm['h'])
        g, edges = world_coords(ob), np.array([e.vertices[:] for e in ob.data.edges])
    elif piece.get('weapon'):
        hold_weapon(name, ob, arm, segs, rm['h'])
        g, edges = world_coords(ob), np.array([e.vertices[:] for e in ob.data.edges])
    ok, rigid, far = allowed(name, g, segs, rm, beast, piece, islands(ob), edges)
    bind(ob, arm, segs, ok, rigid, far, rm['h'])
    body(ob, name, piece.get('glow'))
    report(name, ob, d['clips'], piece['faces'])
    os.makedirs(OUT, exist_ok=True)
    export(os.path.join(OUT, f'ai_{name}.glb'), ob, arm, d['clips'])
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        preview(name, ob, arm, d['clips'], dm)


for name, n in PICKS.items():
    make(name, n)
