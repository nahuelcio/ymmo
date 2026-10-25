"""
The AI-made gear brought into the game. tools/scripts/tripo.mjs downloads it to tools/art/ai/out/<set>/: <piece>_<n>.glb,
its concept image and Tripo's own render. Each picked variant is
- turned to face the way the game's pieces do, scaled and placed as gear.py's are (the weapons upright with the grip at
  the origin, the helm and circlet round the head bone's pivot, the shield strapped on the left forearm, the cuirass
  over the reference body);
- cut to its triangle budget;
- given the game's maps (the colour with the shine in its alpha, the relief), as gear.py's finish() does;
- skinned to the reference body if it is worn on it (the cuirass, the shield);
and all of them are written to client/public/q/gear/ai_<set>.glb, a node per piece (quaternius.ts draws them with ?ai=1).

    blender --background --python tools/art/blender/ai_gear.py -- <set> blade=2 staff=1 ...   write the picks
    blender --background --python tools/art/blender/ai_gear.py -- <set> --file light_<set> hood=1 jerkin=1 ...
        (the light armour's pieces, or the mage's with mage_<set>: a file of their own, ai_light_<set>.glb, its nodes
        named as in light_<set>.glb: the jerkin 'chest', the bracers 'gloves'...)
    blender --background --python tools/art/blender/ai_gear.py -- <set> --preview <dir>        every variant, rendered
    (--only helm,chest: just those pieces' variants; --bare: the pieces alone, without the body)
    (with --preview after picks: the picks written and rendered)

Tripo's models come in a unit box, Y up, the concept's front towards +X and its width along Z.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gear  # noqa: E402  the reference body, its weights and the game's axes

argv = sys.argv[sys.argv.index('--') + 1:]
SET = argv[0]
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else ''
PICKS = dict(a.split('=', 1) for a in argv[1:] if '=' in a)
ONLY = argv[argv.index('--only') + 1].split(',') if '--only' in argv else []
BARE = '--bare' in argv  # previews without the body under the pieces
AI = os.path.join(gear.REPO, 'tools', 'art', 'ai')
SRC = os.path.join(AI, 'out', SET)
SET_SPEC = json.load(open(os.path.join(AI, f'{SET}.json'), encoding='utf-8'))
SPEC = SET_SPEC['pieces']
FILE = argv[argv.index('--file') + 1] if '--file' in argv else SET  # the set's own gear file it stands in for (light_<set>, mage_<set>)
OUT = os.path.join(gear.REPO, 'client', 'public', 'q', 'gear', f'ai_{FILE}.glb')
# pieces whose dark cloth and leather are dyed (as the client's tintGear does), by the set's spec ("tint": {piece: "rrggbb"}):
# black leggings vanish against the dark suit drawn under a set's pieces
TINT = {k: int(v, 16) for k, v in SET_SPEC.get('tint', {}).items()}
# the light and mage pieces made as the heavy ones are, under the node names the client looks for in their files
KIND = {'jerkin': 'chest', 'bracers': 'gloves', 'mage_gloves': 'gloves', 'leggings': 'legs', 'treads': 'feet', 'shoes': 'feet'}
TEX = {'blade': 512, 'staff': 512, 'spellblade': 512, 'bow': 512, 'dagger': 512}  # a map's size, by piece (else 1024): a weapon is small on screen
GAP = 0.012  # how far the cuirass stands off the body at least


# ---------------------------------------------------------------- the mesh in game space (Y up, facing +Z)

def coords(ob):
    a = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('co', a)
    a = a.reshape(-1, 3)
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1)


def put(ob, g):
    ob.data.vertices.foreach_set('co', np.stack([g[:, 0], -g[:, 2], g[:, 1]], 1).ravel())
    ob.data.update()


def faces(ob):
    return [tuple(p.vertices) for p in ob.data.polygons]


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def load(path, name):
    """A downloaded model as one object, its transforms applied, its colour map the active texture (Workbench's)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    names = [o.name for o in new]
    meshes = [o for o in new if o.type == 'MESH']
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    gear.select(*meshes, active=meshes[0])
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    for n in names:
        if n in bpy.data.objects and bpy.data.objects[n] != ob:
            bpy.data.objects.remove(bpy.data.objects[n])
    gear.select(ob)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ob.name = ob.data.name = name
    for m in ob.data.materials:
        tex = image_into(next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'])
        if tex:
            m.node_tree.nodes.active = tex
    return ob


def cut(ob, budget):
    """Down to the budget, if it is over (the UVs and their seams kept)."""
    n = tris(ob)
    if n > budget:
        gear.select(ob)
        m = ob.modifiers.new('cut', 'DECIMATE')
        m.ratio, m.use_collapse_triangulate = budget / n, True
        bpy.ops.object.modifier_apply(modifier='cut')


def smooth_normals(ob):
    """Normals from the shape as it now is (the imported ones were for the shape Tripo made)."""
    gear.select(ob)
    if ob.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))


# ---------------------------------------------------------------- the camera, for the previews

def camera():
    sc = bpy.context.scene
    if not sc.camera:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
        sc.camera = cam
    return sc.camera


def shoot(path, size, centre, extent, a, pitch=0.0, flat=True, alpha=True):
    """A render through an orthographic camera turned `a` about Y from the front (+Z) and tipped `pitch` down."""
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light, sh.color_type = ('FLAT' if flat else 'STUDIO'), 'TEXTURE'
    sc.render.film_transparent = alpha
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    cam = camera()
    cam.data.type, cam.data.ortho_scale, cam.data.clip_end = 'ORTHO', extent, 50.0
    d = 10.0
    off = (math.sin(a) * math.cos(pitch) * d, math.sin(pitch) * d, math.cos(a) * math.cos(pitch) * d)
    cam.location = gear.B(Vector(centre) + Vector(off))
    cam.rotation_euler = (math.pi / 2 - pitch, 0.0, a)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def turn(g):
    """The concept's front (+X, as Tripo leaves it) turned to face +Z, as the game's pieces do: a turn about Y."""
    x, y, z = g.T
    return np.stack([-z, y, x], 1)


# ---------------------------------------------------------------- the weapons: upright, the grip at the origin

def guard(g, length):
    """Where the crossguard is: the widest slice across (X) of the lower half."""
    lo = g[:, 1].min()
    best, at = -1.0, lo
    for y in np.arange(lo, lo + 0.5 * length, 0.01 * length):
        s = g[(g[:, 1] >= y) & (g[:, 1] < y + 0.02 * length)]
        if len(s) and np.ptp(s[:, 0]) > best:
            best, at = np.ptp(s[:, 0]), y + 0.01 * length
    return at


def thin(g, at, length):
    """A blade as thin as a blade: Tripo, guessing the depth from the front alone, makes it as thick as it is wide.
    Its width and depth are the middle ones of its slices (the ornaments at its foot left out of the count)."""
    w, d, zc = [], [], []
    for y in np.arange(at + 0.1 * length, g[:, 1].max() - 0.05 * length, 0.02 * length):
        s = g[(g[:, 1] >= y) & (g[:, 1] < y + 0.02 * length)]
        if len(s) > 4:
            w.append(np.ptp(s[:, 0]))
            d.append(np.ptp(s[:, 2]))
            zc.append((s[:, 2].max() + s[:, 2].min()) / 2)
    if len(w) < 3 or np.median(d) <= 0.45 * np.median(w):
        return g
    k = 0.35 * np.median(w) / np.median(d)
    zc = np.median(zc)
    t = np.clip((g[:, 1] - (at + 0.02 * length)) / (0.04 * length), 0, 1)
    g = g.copy()
    g[:, 2] = zc + (g[:, 2] - zc) * (1 - t * (1 - k))
    return g


def slim(g, length, shaft=0.05):
    """A staff's shaft as thick as one is held (`shaft` across at most): scaled up to its length from the concept, a
    stout one came out as thick as the forearm. Its width and depth, the middle ones of its slices along the shaft
    (from a tenth to three quarters up), brought to that; its head thinned less (by the root of it), for its crown to
    keep its size."""
    w, c = [], []
    for y in np.arange(0.1 * length, 0.75 * length, 0.02 * length):
        sl = g[(g[:, 1] >= y) & (g[:, 1] < y + 0.02 * length)][:, [0, 2]]
        if len(sl) > 4:
            w.append(np.ptp(sl, 0).max())
            c.append((sl.min(0) + sl.max(0)) / 2)
    if len(w) < 3 or np.median(w) <= shaft:
        return g
    k, c = shaft / np.median(w), np.median(c, 0)
    t = np.clip((g[:, 1] - 0.75 * length) / (0.1 * length), 0, 1)
    f = (1 - t) * k + t * math.sqrt(k)
    g = g.copy()
    g[:, [0, 2]] = c + (g[:, [0, 2]] - c) * f[:, None]
    return g


def drop_strings(ob):
    """A bowstring the model came with: a long thin loose part (the client draws its own between the tips)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    seen, gone = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        part, stack = [], [v]
        seen.add(v.index)
        while stack:
            u = stack.pop()
            part.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        co = np.array([u.co for u in part])
        ext = np.sort(np.ptp(co, 0))
        if ext[1] < 0.012 and ext[2] > 0.5:
            gone += part
    if gone:
        bmesh.ops.delete(bm, geom=gone, context='VERTS')
        bm.to_mesh(ob.data)
    bm.free()
    return len(gone)


def held(ob, name, spec):
    """A weapon as gear.py builds them (quaternius.ts qWeapon holds them so): upright along +Y, its edges across X,
    the grip at the origin (just under the guard, or a set fraction of the way up); a bow's back towards +X, its tips
    in the node's extras for the client's string."""
    if name == 'bow':
        drop_strings(ob)
    g = turn(coords(ob))
    lo, hi = g.min(0), g.max(0)
    length = spec['length']
    g = (g - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) * (length / (hi[1] - lo[1]))
    if name == 'bow':
        ends = (g[:, 1] > length * 0.97) | (g[:, 1] < length * 0.03)
        mid = np.abs(g[:, 1] - length / 2) < 0.05 * length
        if g[ends, 0].mean() > g[mid, 0].mean():  # its tips bent towards the archer (-X), its back the other way
            g[:, [0, 2]] *= -1
    if name == 'staff':
        g = slim(g, length)
    if spec['grip'] == 'guard':
        at = guard(g, length)
        g = thin(g, at, length)
        y = at - 0.02
        near = (g[:, 1] < at - 0.02 * length) & (g[:, 1] > at - 0.12 * length)
    else:
        y = spec['grip'] * length
        near = np.abs(g[:, 1] - y) < 0.03 * length
    g -= [g[near, 0].mean() if near.any() else 0.0, y, g[near, 2].mean() if near.any() else 0.0]
    put(ob, g)
    if name == 'bow':
        top, low = g[g[:, 1].argmax()], g[g[:, 1].argmin()]
        ob['bow_tips'] = [float(c) for c in (*top, *low)]


# ---------------------------------------------------------------- the shield, strapped on the left forearm

def shield(ob, spec):
    """Strapped on the outside of the left forearm as gear.py's Shield is (its face out of the top of the arm in the
    rest pose, its top towards the elbow), its back just clear of the arm, and skinned to the forearm."""
    g = coords(ob)
    lo, hi = g.min(0), g.max(0)
    q = g - (lo + hi) / 2
    r = np.hypot(q[:, 1] / (np.ptp(g[:, 1]) / 2), q[:, 2] / (np.ptp(g[:, 2]) / 2))
    mid, rim = q[r < 0.25], q[r > 0.75]
    out = 1.0 if mid[:, 0].max() - rim[:, 0].max() >= rim[:, 0].min() - mid[:, 0].min() else -1.0  # the boss stands out in front
    # its own axes (across, up, out: right-handed) onto the forearm's (across, towards the elbow, out of the arm's top)
    up, o = np.array([0.0, 1.0, 0.0]), np.array([out, 0.0, 0.0])
    s = gear.Shield(0.27, 0.36)
    t_up, t_out = np.array(s.up), np.array(s.n)
    local = np.stack([q @ np.cross(up, o), q @ up, q @ o], 1) * (spec['length'] / np.ptp(g[:, 1]))
    g = np.outer(local[:, 0], np.cross(t_up, t_out)) + np.outer(local[:, 1], t_up) + np.outer(local[:, 2], t_out)
    top = s.c.y - 0.08  # the top of the forearm (Shield's centre is lifted 8 cm off it)
    g += [s.c.x, top + 0.015 - g[:, 1].min(), s.c.z]
    put(ob, g)
    skin(ob, g, lambda i, p: ('lowerarm_l',))


# ---------------------------------------------------------------- the helm and the circlet, round the head

_head = {}


def head(hair=False, g='m'):
    """The reference head (a man's, or a woman's: `g`) round its bone's pivot (where the client hangs the helm): its
    vertices and a tree of its faces (with the hair, for a circlet worn over it)."""
    if (hair, g) not in _head:
        bd = gear.body(g)
        V = np.array(bd['v']) - np.array(bd['bones']['Head'])
        keep = {i for i, m in enumerate(bd['mesh_of']) if m.startswith('Head') or (hair and m.startswith('Hair'))}
        fs = [f for f in bd['f'] if all(k in keep for k in f)]
        _head[hair, g] = (V[sorted(keep)], BVHTree.FromPolygons([Vector(v) for v in V], fs))
    return _head[hair, g]


def inside(points, tree, margin):
    """How many of the points lie inside the surface (or within `margin` of it)."""
    n = 0
    for p in points:
        loc, nor, _, _ = tree.find_nearest(Vector(p))
        if loc is not None and (Vector(p) - loc).dot(nor) < margin:
            n += 1
    return n


def covered(points, tree, centre, clear):
    """How many of the points the surface closes over: a ray out from the head's middle through each meets it, at
    least `clear` beyond the point."""
    n = 0
    for p in points:
        d = Vector(p) - Vector(centre)
        hit = tree.ray_cast(Vector(p), d.normalized(), 0.4)
        if hit[0] is not None and hit[3] >= clear:
            n += 1
    return n


def head_fit(g, fs, name, rim=None):
    """The size and place on the head of a piece in a unit box (bottom centre at the origin; its faces `fs`): a helm
    (or a hood's head) the smallest that closes over the crown without touching the head, its rim at `rim` (the jaw,
    -0.045, for a helm); a circlet the smallest that rings the head (over the hair) without cutting into it, at the
    brow. Returns (size of its largest side, its bottom's height, how far forward), round the head bone's pivot."""
    rng = np.random.default_rng(1)
    pick = lambda a, n: a[rng.choice(len(a), min(n, len(a)), replace=False)]
    hv, htree = head(hair=name == 'circlet')
    centre = np.array(gear.HEAD_C)
    if name != 'circlet':
        rim = -0.045 if rim is None else rim
        # a helm over a man's head and a woman's alike (the client hangs the same one from either head bone: a woman's
        # skull reaches a centimetre or two further back and up from it), closing over the crown and the back of both
        heads = [head(g=k) for k in ('m', 'f')] if name == 'helm' else [(hv, htree)]
        crown = np.concatenate([pick(v[(v[:, 1] > 0.15) | ((v[:, 2] < -0.02) & (v[:, 1] > rim + 0.09)) if name == 'helm' else v[:, 1] > 0.15], 160)
                                for v, _ in heads])
        spare = 3 * len(heads) if name == 'helm' else 1  # points it may leave uncovered (at the edge of its rim)
        for s in np.arange(0.25, 0.75, 0.01):
            for dy in sorted(np.arange(rim - 0.03, rim + 0.031, 0.01), key=lambda y: abs(y - rim)):  # at the rim first
                for dz in (0.0, 0.015, -0.015, 0.03):
                    p = g * s + [0.0, dy, dz]
                    tree = BVHTree.FromPolygons([Vector(v) for v in p], fs)
                    if covered(crown, tree, centre, 0.006) < len(crown) - spare:
                        continue
                    # a hood's face wrap stands right before the face: only its crown and back are kept off the head here
                    test = pick(p if name == 'helm' else p[(p[:, 1] > 0.12) | (p[:, 2] < 0.0)], 300)
                    if sum(inside(test, t, 0.004) for _, t in heads) > 3:
                        continue
                    return s, dy, dz
    else:
        for s in np.arange(0.12, 0.45, 0.005):
            for dy in sorted(np.arange(0.10, 0.22, 0.01), key=lambda y: abs(y - 0.16)):  # at the brow first
                for dz in (0.01, 0.0, 0.02, 0.03, -0.01):
                    p = g * s + [0.0, dy - s * 0.5 * np.ptp(g[:, 1]), dz]
                    if inside(pick(p, 300), htree, 0.003) == 0:
                        return s, dy - s * 0.5 * np.ptp(g[:, 1]), dz
    raise RuntimeError(f'{name}: found no size that fits the head')


def unit(g):
    """Points moved to a unit box: their bottom centre at the origin, their largest side 1."""
    lo, hi = g.min(0), g.max(0)
    return (g - [(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2]) / np.ptp(g, 0).max()


def on_head(ob, name):
    """A helm or a circlet set on the head (head_fit), round the head bone's pivot, where the client hangs it."""
    g = unit(turn(coords(ob)))
    lo, hi = g.min(0), g.max(0)
    if name == 'circlet' and (np.abs(g[:, 0]) < 0.15)[g[:, 2] < lo[2] + 0.25 * (hi[2] - lo[2])].sum() < 0.01 * len(g):
        g[:, 2] -= lo[2]  # a tiara, open at the back: its ends at the ears (round the head's middle), its front on the brow
    s, dy, dz = head_fit(g, faces(ob), name)
    put(ob, g * s + [0.0, dy, dz])
    print(f'[ai_gear] {name}: {s:.3f} m across its largest side, its bottom at y {dy:+.3f}, z {dz:+.3f}')


def hood(ob):
    """A hood with the capelet it comes with, in two parts made one, worn on the body (the client skins it): the hood
    fitted to the head as a helm is (its own size: fitting it with the capelet on the shoulders blows it up and the head
    looks small in it) and on the head alone, so it turns with the head; the capelet and its shoulder plates fitted to
    the shoulders as the cuirass is to the chest (as wide as the shoulders, its top at the hood's rim) and on the neck,
    the collarbones and the upper arms, so it stays with the shoulders as the head turns. Where the capelet begins: the
    first slice down from the head far wider than the head."""
    g = turn(coords(ob))
    lo, hi = g.min(0), g.max(0)
    h = hi[1] - lo[1]
    width = lambda f0, f1: np.ptp(g[(g[:, 1] >= lo[1] + f0 * h) & (g[:, 1] < lo[1] + f1 * h), 0]) if ((g[:, 1] >= lo[1] + f0 * h) & (g[:, 1] < lo[1] + f1 * h)).sum() > 10 else 0.0
    head_w = np.median([width(f, f + 0.05) for f in np.arange(0.5, 0.8, 0.05)])
    split = next((f for f in np.arange(0.5, 0.1, -0.05) if width(f - 0.05, f) > 1.4 * head_w), 0.5)
    top = g[:, 1] >= lo[1] + split * h
    fs = faces(ob)
    # the hood on the head, by itself
    tix = np.nonzero(top)[0]
    remap = -np.ones(len(g), int)
    remap[tix] = np.arange(len(tix))
    gh = unit(g[top])
    s, dy, dz = head_fit(gh, [tuple(remap[list(f)]) for f in fs if all(top[k] for k in f)], 'hood', rim=-0.06)
    pivot = np.array(gear.bone('Head'))
    out = np.zeros_like(g)
    out[top] = gh * s + [0.0, dy, dz] + pivot
    # its face wrap clear of the face (all of its inside: a few points through would show the nose)
    hv, _ = head()
    q, _ = inflate(out[top] - pivot, [np.array([0.0, -0.1, 0.0]), np.array([0.0, 0.26, 0.01])], hv[(hv[:, 1] > -0.1) & (np.abs(hv[:, 0]) < 0.16)],
                   0.016, bins=(12, 16), share=0, cap=1.6)
    # and what of it stands out before the face (its brim, the wrap pushed off the nose) brought in close to it: left as it
    # is it reaches a hand's breadth past the nose, and the head looks to start too far forward
    face = 0.133 + 0.02  # just before the nose's tip
    ahead = q[:, 2] > face
    q[ahead, 2] = face + (q[ahead, 2] - face) * 0.35
    out[top] = q + pivot
    # the capelet on the shoulders: as wide as them and its shoulder plates over them, its top at the hood's rim
    c = g[~top]
    sc = 0.8 / np.ptp(c[:, 0])
    rim = pivot[1] + dy + 0.01
    bd = gear.body('m')
    V = np.array(bd['v'])
    chest = V[np.array([m == 'Male_Peasant_Body' for m in bd['mesh_of']]) & (V[:, 1] > 1.4) & (V[:, 1] < 1.5)]
    out[~top] = (c - [(c[:, 0].max() + c[:, 0].min()) / 2, c[:, 1].max(), (c[:, 2].max() + c[:, 2].min()) / 2]) * sc + [0.0, rim, (chest[:, 2].max() + chest[:, 2].min()) / 2]
    cap_ = out[~top]
    # clear of the neck, the trunk and the tops of the shoulders (not of the level arms: they would push its shoulder plates out)
    cap_, moved = inflate(cap_, [np.array([0.0, 1.25, -0.03]), 'spine_03', 'neck_01', 'Head'], bare_points(x=(-0.2, 0.2), y=(1.25, 1.6)), GAP,
                          bins=(12, 16), share=5, cap=1.6)
    out[~top] = cap_
    put(ob, out)
    print(f'[ai_gear] hood: the capelet from {split:.2f} of its height down; the hood {s:.3f} m across its largest side, its rim at y {dy:+.3f} '
          f'from the head; the capelet {np.ptp(cap_[:, 0]):.2f} m across, down to y {cap_[:, 1].min():.2f}, {moved} points widened clear')
    shoulders = ('neck_01', 'spine_03', 'clavicle_l', 'clavicle_r')
    skin(ob, out, lambda i, p: ('Head',) if top[i] else shoulders + (('upperarm_l',) if p[0] > 0.18 else ('upperarm_r',) if p[0] < -0.18 else ()))


# ---------------------------------------------------------------- the cuirass, over the reference body

def normals(ob):
    a = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get('normal', a)
    a = a.reshape(-1, 3)
    return np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1)


def bare_points(x=(-1.0, 1.0), y=(-1.0, 3.0), z=(-1.0, 1.0)):
    """The bare skin's vertices (Head_m: the dump holds the whole bare body there) within a box."""
    bd = gear.body('m')
    V = np.array(bd['v'])
    m = np.array([k.startswith('Head') for k in bd['mesh_of']])
    return V[m & (V[:, 0] > x[0]) & (V[:, 0] < x[1]) & (V[:, 1] > y[0]) & (V[:, 1] < y[1]) & (V[:, 2] > z[0]) & (V[:, 2] < z[1])]


def raise_pauldrons(g):
    """Pauldrons drawn over arms hanging down raised over the rest pose's, which stand out level: each side turned up
    about its shoulder by how far its pauldron hangs (the tilt of its longest axis, 30 to 75 degrees), the turn eased
    in from the side of the chest and from the armpit up, so the plates bend rather than tear (the breastplate's sides
    stay). The angles turned, left and right."""
    turned = []
    for sign, b in ((1, 'upperarm_l'), (-1, 'upperarm_r')):
        pivot = np.array(gear.bone(b))
        side = g[(sign * g[:, 0] > 0.2) & (g[:, 1] > 1.15)]
        if len(side) < 30:
            turned.append(0.0)
            continue
        q = side[:, :2] - side[:, :2].mean(0)
        ax = np.linalg.eigh(q.T @ q)[1][:, -1]
        ax = ax if ax[0] * sign > 0 else -ax
        droop = math.degrees(math.atan2(-ax[1], abs(ax[0])))
        a = math.radians(min(75.0, max(30.0, droop))) * sign
        w = np.clip((sign * g[:, 0] - 0.17) / 0.09, 0, 1) ** 2 * np.clip((g[:, 1] - 1.3) / 0.1, 0, 1)  # over the armpit, outside the chest
        r = g[:, :2] - pivot[:2]
        t = a * w
        c, s_ = np.cos(t), np.sin(t)
        g[:, 0] = np.where(w > 0, pivot[0] + r[:, 0] * c - r[:, 1] * s_, g[:, 0])
        g[:, 1] = np.where(w > 0, pivot[1] + r[:, 0] * s_ + r[:, 1] * c, g[:, 1])
        turned.append(math.degrees(abs(a)))
    return turned


def mesh_skin(meshes):
    """The surface of those meshes of the reference body (by their faces): for a point, the nearest place on it and the
    way out there."""
    bd = gear.body('m')
    V = np.array(bd['v'])
    keep = {i for i, m in enumerate(bd['mesh_of']) if any(m.startswith(k) for k in meshes)}
    tree = BVHTree.FromPolygons([Vector(v) for v in V], [f for f in bd['f'] if all(k in keep for k in f)])

    def probe(p):
        loc, nor, _, _ = tree.find_nearest(Vector(p))
        return (np.array(loc), np.array(nor)) if loc is not None else None
    return probe


def bare_skin(chain):
    """The bare skin round a limb (Head_m's vertices: the dump has its faces only for the head): for a point, the
    nearest skin vertex and the way out there, from the limb's bones (`chain`, a line of bone names) out through it."""
    bd = gear.body('m')
    ix = [i for i, m in enumerate(bd['mesh_of']) if m.startswith('Head')]
    kd = KDTree(len(ix))
    for k, i in enumerate(ix):
        kd.insert(bd['V'][i], k)
    kd.balance()
    pts = [np.array(gear.bone(b)) for b in chain]

    def probe(p):
        q, _, _ = kd.find(Vector(p))
        q = np.array(q)
        best, axis = 1e9, q
        for a0, a1 in zip(pts[:-1], pts[1:]):
            d = a1 - a0
            c = a0 + d * np.clip(np.dot(q - a0, d) / np.dot(d, d), 0, 1)
            if np.linalg.norm(q - c) < best:
                best, axis = np.linalg.norm(q - c), c
        n = q - axis
        return q, n / (np.linalg.norm(n) + 1e-9)
    return probe


def push_out(ob, g, probe, gap=GAP):
    """The piece out of the reference body's skin (`probe`: mesh_skin or bare_skin) where it cuts in: its outer face `gap`
    off it, its inner face under that (so the inside never shows through), the parts it moved eased into what is round
    them and pushed out again. Returns the points and how many it moved."""
    put(ob, g)
    out = normals(ob)
    edges = np.array([e.vertices[:] for e in ob.data.edges])

    def push(g):
        moved = np.zeros(len(g), bool)
        for i, p in enumerate(g):
            hit = probe(p)
            if hit is None:
                continue
            loc, nor = hit
            want = gap if np.dot(out[i], nor) >= 0 else gap * 0.35
            d = np.dot(p - loc, nor)
            if d < want:
                g[i] = p + nor * (want - d)
                moved[i] = True
        return moved

    moved = push(g)
    for _ in range(3):
        acc, cnt = np.zeros_like(g), np.zeros(len(g))
        np.add.at(acc, edges[:, 0], g[edges[:, 1]])
        np.add.at(acc, edges[:, 1], g[edges[:, 0]])
        np.add.at(cnt, edges.ravel(), 1)
        near = moved.copy()
        near[edges[moved[edges[:, 0]], 1]] = True
        near[edges[moved[edges[:, 1]], 0]] = True
        g[near] = 0.5 * g[near] + 0.5 * acc[near] / np.maximum(cnt[near], 1)[:, None]
        moved |= push(g)
    put(ob, g)
    return g, int(moved.sum())


def over_body(ob, light=False):
    """The cuirass set on the reference body: from the waist (y 1.0) to the base of the neck (1.56), its middle over the
    body's at the ribs, its pauldrons raised over the level arms, pushed out of the body (its trunk and arms, and the neck
    a gorget closes round) and skinned to it. (By its height: its pauldrons hang down its sides far enough that no slice
    of it is the chest alone.) A jerkin (`light`, no pauldrons) by its width instead: as wide at the ribs (the slice two
    fifths up it) as the body there and 3 cm each side, its top at the base of the neck."""
    g = turn(coords(ob))
    bd = gear.body('m')
    V = np.array(bd['v'])
    torso = np.array([m == 'Male_Peasant_Body' for m in bd['mesh_of']])
    ribs = V[torso & (V[:, 1] > 1.25) & (V[:, 1] < 1.35)]
    lo, hi = g.min(0), g.max(0)
    top = hi[1]
    if light:
        band = g[(g[:, 1] > lo[1] + 0.4 * (hi[1] - lo[1])) & (g[:, 1] < lo[1] + 0.55 * (hi[1] - lo[1]))]
        s = (np.ptp(ribs[:, 0]) + 0.06) / np.ptp(band[:, 0])
    else:
        # a gorget standing up round the neck (its top slices far narrower than it) is left out of its height: its
        # shoulders at the base of the neck, the gorget above them (counted in, it shrank the whole cuirass into the body)
        h, W = hi[1] - lo[1], np.ptp(g[:, 0])
        for f in np.arange(0.95, 0.5, -0.05):
            sl = g[(g[:, 1] >= lo[1] + f * h) & (g[:, 1] < lo[1] + (f + 0.05) * h)]
            if len(sl) > 5 and np.ptp(sl[:, 0]) >= 0.4 * W:
                top = lo[1] + (f + 0.05) * h
                break
        s = 0.56 / (top - lo[1])
    g = (g - [(lo[0] + hi[0]) / 2, top, (lo[2] + hi[2]) / 2]) * s + [0.0, 1.56, (ribs[:, 2].max() + ribs[:, 2].min()) / 2]
    turned = raise_pauldrons(g)
    if light:  # a jerkin hugs the body: widened round the spine (pushing each point out would cross its faces)
        g, moved = inflate(g, ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01'), bare_points(x=(-0.2, 0.2), y=(0.95, 1.6)), GAP, bins=(12, 16))
        put(ob, g)
    else:
        g, moved = push_out(ob, g, mesh_skin(('Male_Peasant_Body', 'Male_Peasant_Arms', 'Head')))
    print(f'[ai_gear] chest: scaled {s:.3f}, pauldrons raised {turned[0]:.0f} and {turned[1]:.0f} degrees, from y {g[:, 1].min():.2f} '
          f'to {g[:, 1].max():.2f}, {np.ptp(g[:, 0]):.2f} m across; {moved} of {len(g)} vertices pushed out of the body')
    trunk = ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'clavicle_l', 'clavicle_r')
    # a jerkin has no sleeves: its armholes stay with the trunk (on the arms they were dragged round as the arms rose)
    skin(ob, g, lambda i, p: trunk + (() if light else ('upperarm_l',) if p[0] > 0.2 else ('upperarm_r',) if p[0] < -0.2 else ()))


def inflate(g, chain, skin, gap, bins=(16, 12), keep=None, share=15, cap=1.45):
    """A limb's piece widened round the limb's bones (`chain`: bone names or points) where its inside is not `gap` clear of the skin (`skin`,
    the limb's skin vertices): by stretches along the bones and sectors round them, each widened (scaled out from the
    bone) as much as the nearest its inside comes needs, the widening eased between them. Its inner and outer faces move
    together, so they never cross (as pushing each point out of the skin on its own makes them do). Returns the points
    and how many it widened."""
    pts = [np.array(gear.bone(b)) if isinstance(b, str) else np.asarray(b, float) for b in chain]
    segs = list(zip(pts[:-1], pts[1:]))
    lens = [float(np.linalg.norm(b - a)) for a, b in segs]
    total = sum(lens)
    frames = []
    for a, b in segs:
        d = (b - a) / np.linalg.norm(b - a)
        up = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([0.0, 0.0, 1.0])
        u = up - d * np.dot(up, d)
        u /= np.linalg.norm(u)
        frames.append((d, u, np.cross(d, u)))

    def locate(P):
        """Each point's place along the bones (0 to 1), its angle round them and the point on them it is nearest."""
        best, T, A, C = np.full(len(P), 1e9), np.zeros(len(P)), np.zeros(len(P)), np.zeros_like(P)
        start = 0.0
        for (a, b), L, (d, u, v) in zip(segs, lens, frames):
            t = np.clip((P - a) @ d / L, 0, 1)
            c = a + np.outer(t, b - a)
            dist = np.linalg.norm(P - c, axis=1)
            w = dist < best
            best[w], T[w], C[w] = dist[w], (start + t[w] * L) / total, c[w]
            r = P[w] - c[w]
            A[w] = np.arctan2(r @ v, r @ u)
            start += L
        return T, A, C

    nt, na = bins
    Ts, As, Cs = locate(skin)
    Tp, Ap, Cp = locate(g)
    bt = lambda T: np.clip((T * nt).astype(int), 0, nt - 1)
    ba = lambda A: ((A + np.pi) / (2 * np.pi) * na).astype(int) % na
    reach = np.zeros((nt, na))
    np.maximum.at(reach, (bt(Ts), ba(As)), np.linalg.norm(skin - Cs, axis=1))
    # how near its inside comes: a low share of its points there (`share` percent), not the very nearest (a stray point by
    # the bone would blow the whole stretch up)
    rp, kp = np.linalg.norm(g - Cp, axis=1), bt(Tp) * na + ba(Ap)
    need = np.ones((nt, na))
    for k in np.unique(kp):
        t, a_ = divmod(int(k), na)
        if reach[t, a_] > 0:
            near = np.percentile(rp[kp == k], share)
            need[t, a_] = np.clip((reach[t, a_] + gap) / max(near, 1e-4), 1.0, cap)
    # evened out with the bins round it (round the bones, and along them)
    pad = lambda m: np.vstack([m[:1], m, m[-1:]])
    need = (need + np.roll(need, 1, 1) + np.roll(need, -1, 1) + np.roll(pad(need), 1, 0)[1:-1] + np.roll(pad(need), -1, 0)[1:-1]) / 5
    # each point by the bins round it
    ft, fa = Tp * nt - 0.5, (Ap + np.pi) / (2 * np.pi) * na - 0.5
    t0, a0 = np.floor(ft).astype(int), np.floor(fa).astype(int)
    wt, wa = ft - t0, fa - a0
    at = lambda t: np.clip(t, 0, nt - 1)
    f = ((1 - wt) * (1 - wa) * need[at(t0), a0 % na] + wt * (1 - wa) * need[at(t0 + 1), a0 % na]
         + (1 - wt) * wa * need[at(t0), (a0 + 1) % na] + wt * wa * need[at(t0 + 1), (a0 + 1) % na])
    if keep is not None:  # what is not to be widened (a boot's foot: widened round its bones it would splay)
        f = 1 + (f - 1) * keep
    return Cp + (g - Cp) * f[:, None], int((f > 1.001).sum())


def robe_fit(ob):
    """The robe set on the reference body as the cuirass is (its middle over the body's at the ribs, its mantle raised
    over the level arms), from the base of the neck (1.56) to mid-shin (0.3), pushed out of the body and of the
    breeches (under a robe the legs are bare, but the skirt hangs over them as cloth would) and skinned to the body:
    its skirt to the hips and, under half as much, to the thighs, as near each lies. (Widened round the body, not pushed
    point by point out of it.)"""
    g = turn(coords(ob))
    bd = gear.body('m')
    V = np.array(bd['v'])
    torso = np.array([m == 'Male_Peasant_Body' for m in bd['mesh_of']])
    ribs = V[torso & (V[:, 1] > 1.25) & (V[:, 1] < 1.35)]
    lo, hi = g.min(0), g.max(0)
    chest = g[(g[:, 1] > hi[1] - 0.3 * (hi[1] - lo[1])) & (g[:, 1] < hi[1] - 0.2 * (hi[1] - lo[1]))]
    s = max((1.56 - 0.3) / (hi[1] - lo[1]), (np.ptp(ribs[:, 0]) + 0.08) / np.ptp(chest[:, 0]))  # never narrower than the chest
    g = (g - [(lo[0] + hi[0]) / 2, hi[1], (lo[2] + hi[2]) / 2]) * s + [0.0, 1.56, (ribs[:, 2].max() + ribs[:, 2].min()) / 2]
    if g[:, 1].min() < 0.3:  # its skirt taken up to mid-shin, from the waist down
        low = g[:, 1] < 1.0
        g[low, 1] = 1.0 - (1.0 - g[low, 1]) * (0.7 / (1.0 - g[:, 1].min()))
    turned = raise_pauldrons(g)
    # widened round a line down the spine and on between the legs to its hem, clear of the bare body (and so its skirt
    # round both legs, as a skirt hangs)
    pelvis = np.array(gear.bone('pelvis'))
    line = [pelvis + [0.0, 0.3 - pelvis[1], 0.0], 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01']
    g, moved = inflate(g, line, bare_points(x=(-0.22, 0.22), y=(0.3, 1.6)), GAP * 1.5, bins=(18, 16))
    put(ob, g)
    print(f'[ai_gear] robe: scaled {s:.3f}, mantle raised {turned[0]:.0f} and {turned[1]:.0f} degrees, y {g[:, 1].min():.2f}..{g[:, 1].max():.2f}, '
          f'{np.ptp(g[:, 0]):.2f} m across; {moved} of {len(g)} vertices pushed out of the body')
    trunk = ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'clavicle_l', 'clavicle_r')
    legs = ('thigh_l', 'thigh_r')  # not the calves: a skirt does not bend at the knee
    skin(ob, g, lambda i, p: trunk + (('upperarm_l',) if p[0] > 0.2 else ('upperarm_r',) if p[0] < -0.2 else ()) + (legs if p[1] < 1.0 else ()),
         soften={'thigh_l': 0.45, 'thigh_r': 0.45})


# ---------------------------------------------------------------- the gauntlets, cuisses and boots: one side, mirrored

FINGERS = ('index', 'middle', 'ring', 'pinky', 'thumb')
LIMBS = {
    # what of the body it covers (its left side: the vertices of those meshes in that box: the bare skin, Head_m, which
    # holds the whole body, as the client draws it under a set's piece) and the bones it follows
    'gloves': dict(meshes=('Head',), box=((0.48, 0.95), (1.3, 1.6), (-0.2, 0.1)),
                   bones=('lowerarm_l', 'hand_l') + tuple(f'{f}_0{k}_l' for f in FINGERS for k in (1, 2, 3)),
                   chain=('lowerarm_l', 'hand_l', 'middle_01_l', 'middle_04_leaf_l')),
    # a cuisse on the thigh and the knee alone, as a plate is (some of the hips' pull at its top sheared it off the knee
    # as the thigh turned)
    'legs': dict(meshes=('Head',), box=((0.0, 0.25), (0.45, 0.88), (-0.2, 0.12)),
                 bones=('thigh_l', 'calf_l'), chain=('thigh_l', 'calf_l', 'foot_l')),
    'shoes': dict(meshes=('Head',), box=((0.0, 0.25), (-0.05, 0.16), (-0.2, 0.2)), bones=('foot_l', 'ball_l'), chain=('foot_l', 'ball_l', 'ball_leaf_l'), foot=True),
    'feet': dict(meshes=('Head',), box=((0.0, 0.25), (-0.05, 0.48), (-0.2, 0.2)), foot=True,
                 bones=('calf_l', 'foot_l', 'ball_l'), chain=('calf_l', 'foot_l', 'ball_l', 'ball_leaf_l')),
}


def flip_faces(ob, faces=None):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:] if faces is None else [bm.faces[i] for i in faces])
    bm.to_mesh(ob.data)
    bm.free()


def mirror(ob, g):
    """The left piece and its mirror image for the right, as one: the copy's faces turned back the right way out."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n, nf = len(bm.verts), len(bm.faces)
    bmesh.ops.duplicate(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    flip_faces(ob, range(nf, 2 * nf))
    m = np.concatenate([g, g * [-1.0, 1.0, 1.0]])
    assert len(ob.data.vertices) == 2 * n
    put(ob, m)
    return m


def limb(ob, name, L=None):
    """A gauntlet, a cuisse or a boot made for the left side, set over the reference body's left arm or leg, pushed out
    of it, then mirrored for the right and skinned to both:
    - the gauntlet with its fingers out along the arm (+X), the back of the hand up and the thumb forward (a right one,
      by where its thumb is, is mirrored), from its fingertips at the body's to below the elbow;
    - the cuisse from the knee to the top of the thigh, its front forward;
    - the boot from the sole to below the knee, its toe forward, as long as the foot.
    Each centred on the part of the limb it covers."""
    L = L or LIMBS[name]
    g = coords(ob)
    if name == 'gloves':  # Tripo: the cuff up (+Y), fingers down, the back of the hand to the front (+X)
        g = np.stack([-g[:, 1], g[:, 0], g[:, 2]], 1)
    elif name == 'feet':
        # the concept may show the boot from the side: its toe is where the sole reaches furthest from under the shaft
        lo, hi = g.min(0), g.max(0)
        sole, shaft = g[g[:, 1] < lo[1] + 0.12 * (hi[1] - lo[1])], g[g[:, 1] > lo[1] + 0.6 * (hi[1] - lo[1])]
        c = (shaft.min(0) + shaft.max(0)) / 2
        toe = max(((sole[:, k].max() - c[k], k, 1.0) for k in (0, 2)), key=lambda t: t[0])
        toe = max(toe, *((c[k] - sole[:, k].min(), k, -1.0) for k in (0, 2)), key=lambda t: t[0])
        v = np.zeros(3)
        v[toe[1]] = toe[2]
        t = math.atan2(-v[0], v[2])  # about Y, the toe onto +Z
        g = np.stack([g[:, 0] * math.cos(t) + g[:, 2] * math.sin(t), g[:, 1], -g[:, 0] * math.sin(t) + g[:, 2] * math.cos(t)], 1)
    else:
        g = turn(g)
    bd = gear.body('m')
    V = np.array(bd['v'])
    (x0, x1), (y0, y1), (z0, z1) = L['box']
    sel = np.array([any(m.startswith(k) for k in L['meshes']) for m in bd['mesh_of']])
    part = V[sel & (V[:, 0] > x0) & (V[:, 0] < x1) & (V[:, 1] > y0) & (V[:, 1] < y1) & (V[:, 2] > z0) & (V[:, 2] < z1)]
    lo, hi = g.min(0), g.max(0)
    flipped = False
    if name == 'gloves':
        hand = g[g[:, 0] > lo[0] + 0.6 * (hi[0] - lo[0])]
        cuff = g[g[:, 0] < lo[0] + 0.3 * (hi[0] - lo[0])]
        if hand[:, 2].mean() < cuff[:, 2].mean():  # its thumb backwards: a right gauntlet
            g[:, 2] *= -1
            flipped = True
        s = (0.899 - x0) / (hi[0] - lo[0])  # from below the elbow to the fingertips (the body's reach, +x 0.9)
        g = (g - [hi[0], 0, 0]) * s + [0.899, 0, 0]
    else:
        s = (y1 - y0) / (hi[1] - lo[1])
        g = (g - [0, lo[1], 0]) * s + [0, y0, 0]
        if name == 'feet':
            foot = part[part[:, 1] < 0.12]
            want, have = np.ptp(foot[:, 2]) + 0.03, np.ptp(g[g[:, 1] < 0.12][:, 2])
            g[:, 2] *= float(np.clip(want / have, 0.8, 1.25))
    # each stretch of it over the middle of the stretch of limb it covers (across and front to back; along the limb as
    # fitted above): it bends with the limb (the hand hangs a little below the forearm)
    axis = 0 if name == 'gloves' else 1
    other = [k for k in range(3) if k != axis]
    cuts = np.linspace(max(g[:, axis].min(), part[:, axis].min()), min(g[:, axis].max(), part[:, axis].max()), 9)
    # and each stretch made as wide and deep as the limb there and `margin` more each side: it wraps the limb as it was
    # drawn to, rather than the skin being pushed through it
    margin = 0.012 if name == 'gloves' else 0.02
    at, off, mid, fit = [], [], [], []
    for a0, a1 in zip(cuts[:-1], cuts[1:]):
        sp, sb = g[(g[:, axis] >= a0) & (g[:, axis] < a1)], part[(part[:, axis] >= a0) & (part[:, axis] < a1)]
        if len(sp) > 5 and len(sb) > 5:
            at.append((a0 + a1) / 2)
            cb, cp = (sb[:, other].min(0) + sb[:, other].max(0)) / 2, (sp[:, other].min(0) + sp[:, other].max(0)) / 2
            o_, f_ = cb - cp, np.clip((np.ptp(sb[:, other], 0) / 2 + margin) / np.maximum(np.ptp(sp[:, other], 0) / 2, 1e-4), 0.8, 1.5)
            if name == 'legs':  # a cuisse is open behind (its middle is not the thigh's): its front just before the thigh's
                o_[1], f_[1] = sb[:, 2].max() + 0.025 - sp[:, 2].max(), 1.0
            off.append(o_)
            mid.append(cb)
            fit.append(f_)
    off, mid, fit = np.array(off), np.array(mid), np.array(fit)
    for k, o in enumerate(other):
        g[:, o] += np.interp(g[:, axis], at, off[:, k])
        c = np.interp(g[:, axis], at, mid[:, k])
        g[:, o] = c + (g[:, o] - c) * np.interp(g[:, axis], at, fit[:, k])
    if flipped:  # mirrored: its faces turned back the right way out
        flip_faces(ob)
    floor = g[:, 1].min()
    g, moved = inflate(g, L['chain'], part, GAP, keep=np.clip((g[:, 1] - 0.12) / 0.1, 0, 1) if name == 'feet' else None)
    if name == 'feet':  # widened round the foot's bones, the sole would sink through the floor
        g[:, 1] = np.maximum(g[:, 1], floor)
        # and a sabaton's toe drawn out far past the foot's swings like a needle as the toes bend: brought in to just
        # past the toes, from the ball of the foot on
        ball, tip = gear.bone('ball_l')[2], gear.bone('ball_leaf_l')[2] + 0.025
        if g[:, 2].max() > tip:
            fore = g[:, 2] > ball
            g[fore, 2] = ball + (g[fore, 2] - ball) * (tip - ball) / (g[:, 2].max() - ball)
    put(ob, g)
    if name != 'gloves':  # the left leg's piece kept off the right's (a boot widened to fit came to the middle)
        g[:, 0] = np.maximum(g[:, 0], 0.012)
    g = mirror(ob, g)
    print(f'[ai_gear] {name}: scaled {s:.3f}{", a right one mirrored" if flipped else ""}, {moved} vertices widened clear of the skin; '
          f'x {g[:, 0].min():+.2f}..{g[:, 0].max():+.2f}, y {g[:, 1].min():.2f}..{g[:, 1].max():.2f}, z {g[:, 2].min():+.2f}..{g[:, 2].max():+.2f}')
    right = tuple(b[:-2] + '_r' if b.endswith('_l') else b for b in L['bones'])
    if name == 'feet':
        ob['covers_feet'] = True  # it closes round the whole foot: the client draws no bare foot under it to come through
    half = len(g) // 2  # the left piece first, its mirror image after: each on its own side's bones, wherever it reaches
    skin(ob, g, lambda i, p: L['bones'] if i < half else right)


# ---------------------------------------------------------------- the cape, on the client's cloth

def cape(ob):
    """The cape on the cloth the client simulates (gear.py's capes): its outer face (the concept's front) to the back,
    from the pinned top over the shoulder blades to the knee, as wide at the hem as the set capes, its depth (Tripo's
    guess at cloth from the front) flattened to a few centimetres, its inner face wrapped round the line the set capes
    hang on; skinned to the four points of the cloth's grid round each vertex, with the grid in the node's extras."""
    g = turn(coords(ob))
    g[:, [0, 2]] *= -1  # its outer face to the back
    lo, hi = g.min(0), g.max(0)
    s = (gear.CAPE_TOP - gear.CAPE_HEM) / (hi[1] - lo[1])
    hem = g[g[:, 1] < lo[1] + 0.15 * (hi[1] - lo[1])]
    sx = float(np.clip(2 * gear.cape_half(gear.CAPE_HEM) / max(np.ptp(hem[:, 0]), 1e-6), 0.7 * s, 1.4 * s))
    sz = min(s, 0.06 / max(np.ptp(g[:, 2]), 1e-6))
    q = np.stack([(g[:, 0] - (lo[0] + hi[0]) / 2) * sx, (g[:, 1] - lo[1]) * s + gear.CAPE_HEM, (g[:, 2] - hi[2]) * sz], 1)
    for i, p in enumerate(q):  # its inner face (z 0 now) on the set capes' line, the rest behind it
        q[i, 2] = gear.cape_at(float(p[0]), float(p[1]), 0.0, 0, 0.0).z + p[2]
    put(ob, q)
    print(f'[ai_gear] cape: {np.ptp(q[:, 0]):.2f} m across, y {q[:, 1].min():.2f}..{q[:, 1].max():.2f}, {np.ptp(g[:, 2]) * sz * 100:.1f} cm deep')
    bd = gear.body('m')
    joints = list(bd['joints']) + list(gear.CAPE_BONES)
    jix = {n: i for i, n in enumerate(joints)}
    weigh = gear.cape_skin()
    J, W = [], []
    for p in q:
        top = sorted(weigh(Vector(p)).items(), key=lambda kv: -kv[1])[:4]
        total = sum(v for _, v in top) or 1.0
        J += [float(jix[n]) for n, _ in top] + [0.0] * (4 - len(top))
        W += [v / total for _, v in top] + [0.0] * (4 - len(top))
    for nm, data in (('_joints', J), ('_weights', W)):
        a = ob.data.attributes.new(nm, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', data)
    ob['joints'] = joints
    for k, v in gear.cape_piece().extras.items():
        ob[k] = v


def skin(ob, g, allowed, soften=None):
    """Each vertex's four joints and weights, from the body under it kept to the bones `allowed(i, p)` allows the i-th
    point, as the _joints and _weights attributes the client binds the piece with (gear.py skin_weights()). `soften`
    ({bone: share}) keeps only that share of a bone's pull, the rest going to the pelvis (a skirt that follows each leg
    only so far)."""
    bd = gear.body('m')
    joints = list(bd['joints'])
    jix = {n: i for i, n in enumerate(joints)}
    J, W = [], []
    for i, p in enumerate(g):
        w = gear.transfer(Vector(p), allowed(i, p), bd)
        for b, k in (soften or {}).items():
            if b in w:
                w['pelvis'] = w.get('pelvis', 0.0) + w[b] * (1 - k)
                w[b] *= k
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        total = sum(v for _, v in top) or 1.0
        J += [float(jix[n]) for n, _ in top] + [0.0] * (4 - len(top))
        W += [v / total for _, v in top] + [0.0] * (4 - len(top))
    for name, data in (('_joints', J), ('_weights', W)):
        a = ob.data.attributes.new(name, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', data)
    ob['joints'] = joints


# ---------------------------------------------------------------- the maps, made over into the game's

def image_into(socket):
    """The image texture feeding a socket, through whatever nodes are between (a normal map, a colour split)."""
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


def maps(ob, name, tint=None):
    """One material as gear.py's finish() leaves them: the colour map with how much each texel shines in its alpha
    (from Tripo's metal and roughness), the relief map, and what the piece is mostly made of for the client. `tint` dyes
    its dark, greyish texels (its black leather and cloth; not its gold, gems or bright steel) in that colour, shaded by
    their own lightness, as the client's tintGear does."""
    src = ob.data.materials[0]
    bsdf = next(n for n in src.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    base, mr, nrm = (image_into(bsdf.inputs[k]) for k in ('Base Color', 'Metallic', 'Normal'))
    size = TEX.get(name, 1024)
    col = read(base.image, size)
    rough, metal = (read(mr.image, size)[..., 1], read(mr.image, size)[..., 2]) if mr else (np.full((size, size), 0.6), np.zeros((size, size)))
    # Tripo marks little as metal (a tenth of a sword) but keeps the polished parts smooth: the shine goes mostly by that
    col[..., 3] = np.clip(0.12 + 0.85 * (1 - rough) ** 1.5 * (0.6 + 0.4 * metal), 0, 1)
    if tint is not None:
        c = col[..., :3]
        lum = c @ np.array([0.299, 0.587, 0.114])
        sat = c.max(-1) - c.min(-1)
        step = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
        k = ((1 - step(0.06, 0.22, sat)) * (1 - step(0.3, 0.6, lum)))[..., None]
        dye = np.array([((tint >> b) & 255) / 255 for b in (16, 8, 0)])
        col[..., :3] = c * (1 - k) + dye * (0.25 + lum[..., None] * 2.2) * k
    used = col[..., :3].sum(-1) > 0.02
    shiny = used & (rough < np.median(rough[used]))
    rgb = col[shiny, :3].mean(0)
    f = bpy.data.materials.new(name + '_ai')
    f.use_nodes = True
    f['kind'] = 'steel' if (metal[used] > 0.5).mean() > 0.05 or np.median(rough[used]) < 0.45 else 'leather'
    f['rgb'] = int(sum(int(round(c * 255)) << s for c, s in zip(rgb, (16, 8, 0))))
    f['rough'], f['metal'], f['shine'] = float(rough.mean()), float(metal.mean()), 1
    nt = f.node_tree
    out = nt.nodes['Principled BSDF']
    out.inputs['Roughness'].default_value, out.inputs['Metallic'].default_value = f['rough'], f['metal']
    ci = bpy.data.images.new(f'{name}_color', size, size, alpha=True)
    ci.pixels.foreach_set(col.ravel())
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = ci
    nt.links.new(tc.outputs['Color'], out.inputs['Base Color'])
    if nrm:
        ni = bpy.data.images.new(f'{name}_normal', size, size, alpha=False, is_data=True)
        ni.pixels.foreach_set(read(nrm.image, size).ravel())
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = ni
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], out.inputs['Normal'])
    nt.nodes.active = tc
    ob.data.materials.clear()
    ob.data.materials.append(f)


# ---------------------------------------------------------------- a piece, start to end

def make(name, n):
    base = os.path.join(SRC, f'{name}_{n}')
    spec = SPEC[name]
    kind = KIND.get(name, name)
    ob = load(base + '.glb', kind)
    cut(ob, spec['faces'])
    if kind in ('blade', 'staff', 'spellblade', 'bow', 'dagger'):
        held(ob, kind, spec)
    elif kind == 'shield':
        shield(ob, spec)
    elif kind in ('helm', 'circlet'):
        on_head(ob, kind)
    elif kind == 'hood':
        hood(ob)
    elif kind == 'chest':
        over_body(ob, light=name == 'jerkin')
    elif kind == 'robe':
        robe_fit(ob)
    elif kind in LIMBS:
        limb(ob, kind, LIMBS.get(name))
    elif kind == 'cape':
        cape(ob)
    smooth_normals(ob)
    maps(ob, kind, TINT.get(name))
    print(f'[ai_gear] {name}_{n}: {tris(ob)} tris (budget {spec["faces"]})')
    return ob


def mannequin(name):
    """The reference body to show a worn piece on: the head round its pivot for the helm and circlet, the whole body
    for the rest; bare (as the client draws it under a set's piece) under the gauntlets, cuisses and boots."""
    bd = gear.body('m')
    V = np.array(bd['v'])
    if name in ('helm', 'circlet'):
        V = V - np.array(bd['bones']['Head'])
    fs = [tuple(f) for f in bd['f']]
    if name in LIMBS:
        fs = [f for f in fs if bd['mesh_of'][f[0]].startswith('Head')]
    me = bpy.data.meshes.new('mannequin')
    me.from_pydata([gear.B(v) for v in V], [], fs)
    m = bpy.data.materials.new('skin')
    m.diffuse_color = (0.55, 0.47, 0.42, 1.0)
    me.materials.append(m)
    ob = bpy.data.objects.new('mannequin', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def show(ob, name, tag):
    """Front, three-quarter and side views of the piece (on the body, if worn on it) into the preview folder."""
    worn = name in ('helm', 'circlet', 'hood', 'chest', 'robe', 'shield', 'cape') or name in LIMBS
    body = mannequin(name) if worn and not BARE else None
    g = coords(ob)
    lo, hi = g.min(0), g.max(0)
    if name in ('helm', 'circlet'):
        centre, extent = (0.0, 0.0, 0.0), 0.75
    elif name == 'hood':
        centre, extent = (0.0, 1.5, 0.0), 0.9
    elif name in ('chest', 'shield', 'gloves', 'robe'):
        centre, extent = (0.0, 1.0 if name == 'robe' else 1.15, 0.0), 1.9
    elif name in ('legs', 'feet', 'cape'):
        centre, extent = (0.0, 0.85, 0.0), 1.9
    else:
        centre, extent = (lo + hi) / 2, float((hi - lo).max()) * 1.15
    world = bpy.context.scene.world or bpy.data.worlds.new('w')
    bpy.context.scene.world = world
    world.color = (0.18, 0.18, 0.2)
    for view, a in (('front', 0.0), ('three', 0.6), ('side', math.pi / 2), ('back', math.pi)):
        if view == 'back' and not worn:
            continue
        shoot(os.path.join(PREVIEW, f'{tag}_{view}.png'), 512, centre, extent, a, pitch=0.12, flat=False, alpha=False)
    if body:
        bpy.data.objects.remove(body)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


clear()
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
if PICKS:
    objs = [make(name, n) for name, n in PICKS.items()]
    gear.select(*objs)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='WEBP',
                              export_extras=True, export_attributes=True, export_vertex_color='NONE')
    print(f'[ai_gear] {SET}: {", ".join(f"{k}_{v}" for k, v in PICKS.items())} -> {OUT} ({os.path.getsize(OUT) // 1024} KB)')
    if PREVIEW:
        for ob in objs:
            others = [o for o in objs if o is not ob]
            for o in others:
                o.hide_render = True
            show(ob, ob.name, ob.name)
            for o in others:
                o.hide_render = False
elif PREVIEW:
    for name in (n for n in SPEC if not ONLY or n in ONLY):
        for n in range(1, 10):
            if not os.path.exists(os.path.join(SRC, f'{name}_{n}.glb')):
                continue
            clear()
            try:
                show(make(name, n), KIND.get(name, name), f'{name}_{n}')
            except Exception as e:  # one bad variant leaves the others to look at
                print(f'[ai_gear] {name}_{n} failed: {e}')
