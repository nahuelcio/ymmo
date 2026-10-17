"""
Gear for the playable characters, modelled here from code (no source pack): each armour set's pieces, written to
client/public/q/gear/<set>.glb with one node per piece (`helm` for now; the body pieces and shields come later).

    blender --background --python tools/art/blender/gear.py -- [out_dir]
    GEAR_PREVIEW=<dir> GEAR_HEAD=<head.json> [GEAR_FAST=1] [GEAR_ONLY=a,b] blender --background --python ...

Art rules, for every piece: it is armour a smith could make, not a fantasy prop. Each one follows a real type (a
morion, a great helm, a close helmet, a Corinthian...) and keeps its silhouette, so it reads at a distance; up close it
carries what makes forged armour believable: hammer work, creases and facets, rolled and roped edges, rows of rivets,
plates that overlap and pivot, straps and buckles, etched or embossed decoration. Nothing floats: every detail sits
sunk into what holds it. No fire, ice or glow - a set's theme comes from real finishes (polished, blued or blackened
steel, paint chipped at the edges, gilding, brass, bronze gone green, boiled leather, mail, horsehair).

Coordinates are the game's, in metres: Y up, the character faces +Z, +X is its left. Every piece is modelled around
its bone's pivot in the bind pose and exported with its origin there; the client hangs it from that bone with
attach() (client/src/render/quaternius.ts), which keeps the orientation it was modelled in. Round the head bone's
pivot (the top of the neck) the head is ~0.18 m wide (x +-0.09), its forehead at z 0.11, the back at z -0.09, the
top at y 0.24; the eyes sit at y ~0.095, the nose tip at (y 0.05, z 0.133), the chin at y ~0. GEAR_HEAD (dumped from
the game) puts the real head in the previews and reports where the piece and the body cut into each other.

How a helmet is built:
- forms (Skull) are lofted from profiles: at each height a section of a given width and depth, pinched into a keel
  front and back if the type has one, the crown round or pointed, the walls below the middle straight, tapering to
  the jaw or flaring into a tail; a skull's columns run from its rim (the face opening's shape) up to the crown and
  can carry a brim, a peak or a neck guard grown from the same sheet;
- plates (visors, bevors, cheek pieces, face plates, crosses, spectacles) are cut from a form by a 2D outline with
  holes (plate(): marching squares on a signed distance, so outlines, slits and holes come out smooth); standing a
  plate off its form by a V-shaped amount gives it a sharp medial ridge;
- every surface gets a thickness, hammer work and rolled (or roped) edges; combs and crests rise along the midline;
  bands, rivets, hinges and straps sit sunk into what they hold.
Each piece is built twice from the same procedure: dense, with every fine detail, and light (RES), for the game;
finish() bakes the dense one onto the light one (colour and normal maps, 1024 px): each material's recipe (brushed or
hammered steel, paint chipped at the edges, gilt etching, embossed bronze with its patina, leather, mail rings,
horsehair) with worn edges, grime in the crevices and light from above.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(REPO, 'client', 'public', 'q', 'gear')
PREVIEW = os.environ.get('GEAR_PREVIEW', '')  # render each set on the head into this folder instead of exporting
FAST = os.environ.get('GEAR_FAST', '') == '1'  # previews of the dense model, without the bake (flat colours)
HEAD = os.environ.get('GEAR_HEAD', '')
ONLY = os.environ.get('GEAR_ONLY', '')
LIGHT = float(os.environ.get('GEAR_LIGHT', '2.2'))  # how much coarser the game's copy is than the dense model
BUDGET = int(os.environ.get('GEAR_TRIS', '10000'))  # the triangles a piece may have in the game

RES = 1.0  # the resolution being built: 1 for the dense model, LIGHT for the game's copy
UP = Vector((0, 1, 0))
HEAD_C = Vector((0.0, 0.12, 0.01))  # the middle of the head
METAL = ('steel', 'blued', 'black', 'iron', 'brass', 'gold', 'bronze')


def B(v):
    """game space (Y up, facing +Z) -> Blender (Z up, facing -Y); the glTF export turns it back."""
    return Vector((v[0], -v[2], v[1]))


def G(v):
    """Blender -> game space."""
    return Vector((v[0], v[2], -v[1]))


def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def smooth(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def gauss(x, w):
    return math.exp(-(x / w) ** 2)


def wrap(a):
    while a <= -math.pi:
        a += 2 * math.pi
    while a > math.pi:
        a -= 2 * math.pi
    return a


def curve(points):
    """A smooth function through (x, y) points, x increasing: cubic Hermite, flat at the ends and at every turn, so it
    never overshoots."""
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    n = len(xs)
    ms = [0.0] * n
    for i in range(1, n - 1):
        d0, d1 = ys[i] - ys[i - 1], ys[i + 1] - ys[i]
        ms[i] = 0.0 if d0 * d1 <= 0 else (ys[i + 1] - ys[i - 1]) / (xs[i + 1] - xs[i - 1])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = 0
        while xs[i + 1] < x:
            i += 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        t2, t3 = t * t, t * t * t
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * ms[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * ms[i + 1]
    return f


def spline(points, n=8):
    """A smooth open path through points (Catmull-Rom)."""
    pts = [Vector(p) for p in points]
    out = []
    for i in range(len(pts) - 1):
        p0, p1, p2, p3 = pts[max(i - 1, 0)], pts[i], pts[i + 1], pts[min(i + 2, len(pts) - 1)]
        for j in range(n):
            t = j / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return out


def angle_of(p, zc):
    """The angle round the head of a point (0 in front, +pi/2 at the left)."""
    return math.atan2(p.x, p.z - zc)


def seg_dist(u, v, p0, p1):
    ex, ey = p1[0] - p0[0], p1[1] - p0[1]
    t = clamp(((u - p0[0]) * ex + (v - p0[1]) * ey) / (ex * ex + ey * ey + 1e-18))
    return math.hypot(u - p0[0] - ex * t, v - p0[1] - ey * t)


# ---------------------------------------------------------------- surface work: bumps added to a part

def hammered(amp=0.0006, freq=38.0, seed=0.0):
    """Forged steel: shallow, uneven hammer work, metres out along the normal."""
    def f(p):
        q = Vector((p.x * freq + seed, p.y * freq + 3.7 * seed, p.z * freq))
        return amp * (noise.noise(q) + 0.45 * noise.noise(q * 2.7))
    return f


def creased(amp=0.0009, seed=0.0):
    """Boiled leather: soft creases and wrinkles."""
    def f(p):
        q = Vector((p.x * 55 + seed, p.y * 55, p.z * 55))
        return amp * (noise.noise(q) + 0.6 * abs(noise.noise(q * 3.3)) - 0.3)
    return f


def dents(*spots):
    """Dents taken in a fight: (centre, radius, depth) each."""
    def f(p):
        return -sum(d * gauss((p - c).length, r) for c, r, d in spots)
    return f


def bumps(*fns):
    fns = [f for f in fns if f]
    return lambda p: sum(f(p) for f in fns)


# ---------------------------------------------------------------- materials

_mats = {}


def mat(name, color, kind, engrave=None, engrave_color=None, rough=0.55, metal=0.0, emboss=False, ring=0.0042):
    """A colour (sRGB hex) and what it is made of (kind: steel, blued, black, iron, enamel, brass, gold, bronze, leather,
    mail, hair); `engrave` puts a pattern (waves, scales, vines, lattice, stitch) wherever the part's deco mask allows:
    etched in dark lines, gilt (engrave_color) or, with emboss, raised in relief; ring: a mail ring's size."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m['kind'], m['rgb'], m['rough'], m['metal'] = kind, color, rough, metal
    m['engrave'] = engrave or ''
    m['engrave_rgb'] = engrave_color if engrave_color is not None else -1
    m['emboss'], m['ring'] = int(emboss), ring
    _mats[name] = m
    return m


def plain(m):
    """The same material without a texture: for plain rolled edges and small details (rivets, hinges, buckles), which
    would only waste room in the maps."""
    name = m.name + '_plain'
    if name not in _mats:
        q = bpy.data.materials.new(name)
        q.use_nodes = True
        for k in ('kind', 'rgb', 'rough', 'metal'):
            q[k] = m[k]
        q['engrave'], q['engrave_rgb'], q['emboss'], q['ring'], q['plain'] = '', -1, 0, 0.0, 1
        _mats[name] = q
    return _mats[name]


def inside(m):
    """The inside of a plate: the same metal or leather, unpolished and in shadow (no texture)."""
    name = m.name + '_inside'
    if name not in _mats:
        q = bpy.data.materials.new(name)
        q.use_nodes = True
        rgb = m['rgb']
        dark = [int(((rgb >> s_) & 255) * 0.42) for s_ in (16, 8, 0)]
        q['kind'], q['rgb'], q['rough'], q['metal'] = 'inner', (dark[0] << 16) | (dark[1] << 8) | dark[2], 0.8, m['metal'] * 0.5
        q['engrave'], q['engrave_rgb'], q['emboss'], q['ring'], q['plain'] = '', -1, 0, 0.0, 1
        _mats[name] = q
    return _mats[name]


# ---------------------------------------------------------------- simple solids

def resample(pts, step, closed=False):
    """Points every ~step metres along a polyline, and how far along each one is."""
    seq = pts + [pts[0]] if closed else pts
    d = [0.0]
    for i in range(1, len(seq)):
        d.append(d[-1] + (seq[i] - seq[i - 1]).length)
    total = d[-1]
    n = max(3 if closed else 1, int(math.ceil(total / step)))
    out, j = [], 0
    for k in range(n if closed else n + 1):
        t = total * k / n
        while j < len(d) - 2 and d[j + 1] < t:
            j += 1
        seg = d[j + 1] - d[j]
        f = 0.0 if seg < 1e-12 else clamp((t - d[j]) / seg)
        out.append(seq[j].lerp(seq[j + 1], f))
    return out, [total * k / n for k in range(n if closed else n + 1)]


def tube(points, radii, seg=10, cap=True, closed=False, twist=None, fixed=False):
    """A tube along a polyline, its radius per point: rolled edges, cords, horns. Frames are carried along the path
    (and untwisted round a closed loop) so the tube never pinches. twist=(strands, pitch, depth) cuts it into a rope.
    Coarser at a coarse RES unless fixed."""
    pts = [Vector(p) for p in points]
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * len(pts)
    if not fixed and RES > 1:
        k = max(1, int(round(RES)))
        if len(pts) > 16:
            keep = list(range(0, len(pts), k))
            if not closed and keep[-1] != len(pts) - 1:
                keep.append(len(pts) - 1)
            pts, radii = [pts[i] for i in keep], [radii[i] for i in keep]
        seg = max(5, int(round(seg / RES ** 0.6)))
    m = len(pts)

    def tangent(i):
        if closed:
            return (pts[(i + 1) % m] - pts[i - 1]).normalized()
        return (pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)]).normalized()
    ds = [tangent(i) for i in range(m)]
    ref = Vector((0, 0, 1)) if abs(ds[0].z) < 0.9 else Vector((1, 0, 0))
    ns = [ds[0].cross(ref).normalized()]
    for i in range(1, m):
        n = ns[-1] - ds[i] * ns[-1].dot(ds[i])
        ns.append(n.normalized() if n.length > 1e-9 else ns[-1])
    if closed:
        end = ns[-1] - ds[0] * ns[-1].dot(ds[0])
        ang = math.atan2(ds[0].dot(ns[0].cross(end)), ns[0].dot(end))
        ns = [Matrix.Rotation(-ang * i / m, 3, ds[i]) @ ns[i] for i in range(m)]
    along = [0.0]
    for i in range(1, m):
        along.append(along[-1] + (pts[i] - pts[i - 1]).length)
    if twist:
        strands, pitch, depth = twist
        total = along[-1] + ((pts[0] - pts[-1]).length if closed else 0.0)
        pitch = total / max(1, round(total / pitch))
    verts, faces = [], []
    for i in range(m):
        b = ds[i].cross(ns[i])
        for j in range(seg):
            t = 2 * math.pi * j / seg
            r = radii[i]
            if twist:
                r *= 1.0 - depth * (0.5 + 0.5 * math.cos(strands * (t - 2 * math.pi * along[i] / pitch)))
            verts.append(pts[i] + (ns[i] * math.cos(t) + b * math.sin(t)) * r)
    for i in range(m if closed else m - 1):
        i2 = (i + 1) % m
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((i * seg + j, i2 * seg + j, i2 * seg + j2, i * seg + j2))
    if cap and not closed:
        verts += [pts[0], pts[-1]]
        s, e, last = len(verts) - 2, len(verts) - 1, (m - 1) * seg
        faces += [(s, (j + 1) % seg, j) for j in range(seg)]
        faces += [(e, last + j, last + (j + 1) % seg) for j in range(seg)]
    return verts, faces


def oball(c, radii, axes=None, seg=12, rings=7):
    """An ellipsoid at c, its radii along axes (x, y, z unit vectors): rivet heads, washers, knots."""
    seg, rings = max(6, int(round(seg / RES ** 0.6))), max(4, int(round(rings / RES ** 0.6)))
    ax = axes or (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
    r = (radii, radii, radii) if isinstance(radii, (int, float)) else radii
    c = Vector(c)
    verts, faces = [], []
    for i in range(1, rings):
        lat = -math.pi / 2 + math.pi * i / rings
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append(c + ax[0] * (r[0] * math.cos(lat) * math.cos(a)) + ax[2] * (r[2] * math.cos(lat) * math.sin(a)) + ax[1] * (r[1] * math.sin(lat)))
    for i in range(rings - 2):
        for j in range(seg):
            k, k2 = i * seg + j, i * seg + (j + 1) % seg
            faces.append((k, k + seg, k2 + seg, k2))
    verts += [c - ax[1] * r[1], c + ax[1] * r[1]]
    bot, top, last = len(verts) - 2, len(verts) - 1, (rings - 2) * seg
    faces += [(bot, (j + 1) % seg, j) for j in range(seg)]
    faces += [(top, last + j, last + (j + 1) % seg) for j in range(seg)]
    return verts, faces


def frame(n):
    """Two unit vectors across a normal, and the normal (a basis with n as its y)."""
    n = Vector(n).normalized()
    t = n.cross(Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))).normalized()
    return t, n, n.cross(t)


def merge(*meshes):
    verts, faces = [], []
    for v, f in meshes:
        base = len(verts)
        verts += list(v)
        faces += [tuple(k + base for k in face) for face in f]
    return verts, faces


def mirror(verts, faces):
    """The same part on the other side (x -> -x)."""
    return [Vector((-v[0], v[1], v[2])) for v in verts], [tuple(reversed(f)) for f in faces]


# ---------------------------------------------------------------- a piece: parts with thickness, edges, surface work

class Piece:
    def __init__(self, name):
        self.name = name
        self.parts = []

    def add(self, material, verts, faces, solid=0.0, roll=0.0, roll_min=0.0, roll_mat=None, rope=False, bump=None,
            fine=None, forge=None, bead=None, deco=None, sharp=40):
        """solid: thickness (inwards); roll: how far a rolled edge stands out of the plate, along every edge loop longer
        than roll_min metres, in roll_mat (rope: twisted like a cable); bump(p) -> metres to push each point out, fine
        the same for detail only the dense model gets; forge: the surface work (default: hammered, for metal plates);
        bead=(inset, height, width): a raised bead running that far inside every edge; deco: where the material's
        engraving shows - a function p -> 0..1 or (p, distance to the nearest edge) -> 0..1, a width (a border that wide
        along the outer edges) or (width, function); sharp: edges sharper than this many degrees stay sharp."""
        self.parts.append(dict(material=material, verts=verts, faces=faces, solid=solid, roll=roll, roll_min=roll_min,
                               roll_mat=roll_mat, rope=rope, bump=bump, fine=fine, forge=forge, bead=bead, deco=deco,
                               sharp=sharp))
        return self

    def build(self):
        objs = []
        for i, P in enumerate(self.parts):
            bm = bmesh.new()
            bv = [bm.verts.new(B(v)) for v in P['verts']]
            for f in P['faces']:
                if len(set(f)) < 3:
                    continue
                try:
                    bm.faces.new([bv[k] for k in f])
                except ValueError:
                    pass
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
            bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            is_open = any(e.is_boundary for e in bm.edges)
            if is_open and bm.faces:  # an open sheet faces away from the head
                ref = B(HEAD_C)
                if sum((f.calc_center_median() - ref).dot(f.normal) * f.calc_area() for f in bm.faces) < 0:
                    for f in bm.faces:
                        f.normal_flip()
            bm.normal_update()
            bm.verts.index_update()
            verts = list(bm.verts)
            loops = boundary_loops(bm) if is_open else []
            lens = [sum((lp[k].co - lp[k - 1].co).length for k in range(len(lp))) for lp in loops]

            def edge_dist(min_len):
                edge = [v.co.copy() for lp, L in zip(loops, lens) if L > min_len for v in lp]
                if not edge:
                    return [1.0] * len(verts)
                kd = KDTree(len(edge))
                for k, co in enumerate(edge):
                    kd.insert(co, k)
                kd.balance()
                return [kd.find(v.co)[2] for v in verts]
            # surface work
            material = P['material']
            forge = P['forge']
            if forge is None:
                forge = hammered(0.00035, seed=i * 1.7) if material['kind'] in METAL and P['solid'] else None
            fine = P['fine'] if RES <= 1 else None
            bead_d = edge_dist(0.05) if P['bead'] and RES <= 1 else None
            if P['bump'] or forge or fine or bead_d:
                moves = []
                for k, v in enumerate(verts):
                    q = G(v.co)
                    d = (P['bump'](q) if P['bump'] else 0.0) + (forge(q) if forge else 0.0) + (fine(q) if fine else 0.0)
                    if bead_d:
                        inset, height, width = P['bead']
                        d += height * gauss(bead_d[k] - inset, width)
                    moves.append(v.normal * d)
                for v, mv in zip(verts, moves):
                    v.co += mv
                bm.normal_update()
            # rolled edges
            rolls = []
            if P['roll'] and is_open:
                for lp, L in zip(loops, lens):
                    if L < P['roll_min']:
                        continue
                    pts = [v.co - v.normal * (P['solid'] / 2) for v in lp]
                    rope = P['rope'] and RES <= 1
                    pts, _ = resample(pts, 0.0016 if rope else 0.0035 * RES, closed=True)
                    for _ in range(2 if rope else 2):
                        pts = [(pts[k - 1] + pts[k] * 2 + pts[(k + 1) % len(pts)]) / 4 for k in range(len(pts))]
                    r = P['solid'] / 2 + P['roll']
                    seg = 16 if rope else (8 if RES <= 1 else 6)
                    rolls.append(tube(pts, r, seg, closed=True, fixed=True, twist=(3, 0.011, 0.22) if rope else None))
            # where the engraving shows
            deco = P['deco']
            dvals = None
            if deco is not None:
                if isinstance(deco, (int, float, tuple)):
                    width, fn = deco if isinstance(deco, tuple) else (deco, None)
                    dist = edge_dist(0.16)
                    dvals = [max(smooth(width, width - 0.003, dist[k]), fn(G(v.co)) if fn else 0.0) for k, v in enumerate(verts)]
                elif deco.__code__.co_argcount == 2:
                    dist = edge_dist(0.05)
                    dvals = [deco(G(v.co), dist[k]) for k, v in enumerate(verts)]
                else:
                    dvals = [deco(G(v.co)) for v in verts]
            for f in bm.faces:
                f.smooth = True
            me = bpy.data.meshes.new(f'{self.name}_{i}')
            bm.to_mesh(me)
            bm.free()
            lo_, hi_ = Vector(P['verts'][0]), Vector(P['verts'][0])
            for v in P['verts']:
                lo_ = Vector((min(lo_.x, v[0]), min(lo_.y, v[1]), min(lo_.z, v[2])))
                hi_ = Vector((max(hi_.x, v[0]), max(hi_.y, v[1]), max(hi_.z, v[2])))
            small = (hi_ - lo_).length < 0.035
            ob = self._object(me, plain(material) if small else material, inside(material), dvals)
            if P['solid']:
                mod = ob.modifiers.new('sol', 'SOLIDIFY')
                mod.thickness, mod.offset, mod.use_rim, mod.use_even_offset = P['solid'], -1.0, True, True
                mod.material_offset, mod.material_offset_rim = 1, (1 if rolls else 0)  # a rolled edge hides the rim
                bpy.ops.object.modifier_apply(modifier='sol')
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(P['sharp']))
            ob['thin'] = bool(P['solid']) and not small
            objs.append(ob)
            for rv, rf in rolls:
                rme = bpy.data.meshes.new(f'{self.name}_{i}_roll')
                rme.from_pydata(rv, [], rf)
                for poly in rme.polygons:
                    poly.use_smooth = True
                rm = P['roll_mat'] or material
                objs.append(self._object(rme, rm if P['rope'] else plain(rm), inside(material), [0.0] * len(rv)))
        if RES > 1:  # the game's copy: thin the plates down to the budget (rolled edges and small parts stay whole)
            count = lambda o: sum(len(p_.vertices) - 2 for p_ in o.data.polygons)
            thin = [o for o in objs if o.get('thin')]
            fixed = sum(count(o) for o in objs if not o.get('thin'))
            ratio = clamp((BUDGET - fixed) / max(1, sum(count(o) for o in thin)), 0.2, 1.0)
            for o in thin:
                if ratio < 1.0:
                    select(o)
                    dec = o.modifiers.new('dec', 'DECIMATE')
                    dec.ratio = ratio
                    bpy.ops.object.modifier_apply(modifier='dec')
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = ob.data.name = self.name
        return ob

    def _object(self, me, material, inner, dvals):
        me.materials.append(material)
        me.materials.append(inner)
        attr = me.color_attributes.new('deco', 'FLOAT_COLOR', 'POINT')
        for k in range(len(me.vertices)):
            d = dvals[k] if dvals is not None else 1.0
            attr.data[k].color = (d, d, d, 1.0)
        ob = bpy.data.objects.new(me.name, me)
        bpy.context.scene.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        return ob


def boundary_loops(bm):
    bm.verts.index_update()
    nb = {}
    for e in bm.edges:
        if e.is_boundary:
            a, b = e.verts
            nb.setdefault(a.index, []).append(b.index)
            nb.setdefault(b.index, []).append(a.index)
    verts = list(bm.verts)
    seen, loops = set(), []
    for start in nb:
        if start in seen:
            continue
        loop, prev, cur = [start], -1, start
        seen.add(start)
        while True:
            nxt = [w for w in nb[cur] if w != prev and w not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) > 3:
            loops.append([verts[k] for k in loop])
    return loops


# ---------------------------------------------------------------- forms

class Skull:
    """A form round the head (a helmet's skull, or the shape a visor or bevor is cut from). At height y the section
    has half-width w*R and reaches d*R in front of (df) and behind (db) its axis z=zc, R being the profile: above yc a
    superellipse dome (n: 2 round, higher is flatter-topped) that `peak` draws up into a point; below yc whatever
    lower(|a|, metres below yc) says (straight walls, a taper to the jaw, a flare into a tail). Seen from above a section
    is a superellipse (plan: 2 an ellipse, higher squarer, as a head is), and keel pinches its front and back into a
    ridge above keel_from. Each column at angle a (0 in front, +pi/2 at the left) runs from rim(|a|) up to the crown."""

    def __init__(self, yc=0.125, zc=0.008, w=0.106, h=0.128, df=0.116, db=0.112, n=2.4, peak=0.0, keel=(0.0, 0.0),
                 keel_from=0.0, rim=0.12, lower=None, plan=2.4):
        self.yc, self.zc, self.w, self.h, self.df, self.db, self.n, self.peak = yc, zc, w, h, df, db, n, peak
        self.plan = 2.0 / plan
        self.kf, self.kb = keel
        self.keel_from = keel_from
        self.rim = rim if callable(rim) else (lambda a, v=rim: v)
        self.lower = lower or (lambda a, u: 1.0 - 2.0 * u * u)

    def at(self, a, y):
        s, c = math.sin(a), math.cos(a)
        if y >= self.yc:
            v = min(1.0, (y - self.yc) / self.h)
            R = (1.0 - v ** self.n) ** (1.0 / self.n)
            if self.peak:
                R = lerp(R, 1.0 - v, self.peak * v * v)
        else:
            R = self.lower(abs(wrap(a)), self.yc - y)
        k = (self.kf if c >= 0 else self.kb) * smooth(self.keel_from - 0.03, self.keel_from + 0.03, y)
        d = self.df if c >= 0 else self.db
        sx = math.copysign(abs(s) ** self.plan, s)
        cz = math.copysign(abs(c) ** self.plan, c)
        return Vector((self.w * R * sx, y, self.zc + d * R * cz * (1.0 - k * abs(s))))

    def normal(self, a, y):
        e = 1e-4
        n = (self.at(a + e, y) - self.at(a - e, y)).cross(self.at(a, y + e) - self.at(a, y - e))
        p = self.at(a, y)
        ref = Vector((0, min(y, self.yc), self.zc))
        if n.length < 1e-12:
            return (p - Vector((0, self.yc, self.zc))).normalized()
        n.normalize()
        return n if n.dot(p - ref) >= 0 else -n

    def point(self, a, y, off=0.0):
        return self.at(a, y) + self.normal(a, y) * off

    def column(self, a, brim=None):
        """The points up one column: from a brim's edge (if any) in to the rim, round a small fillet, up to the crown."""
        y0 = self.rim(abs(a))
        L = lift = 0.0
        curl = 1.0
        if brim:
            L, lift, curl = brim(abs(a))
        fil = min(0.008, L * 0.35) if L > 0.002 else 0.0
        ys = y0 + fil
        wall = []
        if ys < self.yc:
            wall += [self.at(a, lerp(ys, self.yc, i / 48)) for i in range(48)]
            phi0 = 0.0
        else:
            phi0 = math.asin(min(1.0, (ys - self.yc) / self.h))
        wall += [self.at(a, self.yc + self.h * math.sin(lerp(phi0, math.pi / 2, i / 96))) for i in range(97)]
        if not fil:
            return wall
        p0 = self.at(a, y0)
        n0 = self.normal(a, y0)
        out = Vector((n0.x, 0, n0.z)).normalized()

        def bp(f):
            return p0 + out * (L * f) + UP * (lift * f ** curl)
        fc = 1.0
        for i in range(1, 400):
            if (bp(i / 400) - p0).length >= fil:
                fc = i / 400
                break
        rim_pts = [bp(lerp(1.0, fc, i / 40)) for i in range(41)]
        c0, c2 = rim_pts[-1], wall[0]
        fillet = [c0 * (1 - t) ** 2 + p0 * (2 * (1 - t) * t) + c2 * (t * t) for t in (i / 10 for i in range(1, 10))]
        return rim_pts + fillet + wall

    def cols(self, base=112, extra=(), tol=0.004):
        """Column angles: `base` round the head, the `extra` ones (to resolve ridges, dense model only), and more
        wherever the rim drops fast between two (so the face opening's edges stay clean)."""
        base = max(40, int(round(base / RES)))
        extra = extra if RES <= 1 else ()
        tol *= RES
        cs = sorted(set([round(-math.pi + 2 * math.pi * (i + 0.5) / base, 6) for i in range(base)] +
                        [round(wrap(e), 6) for e in extra]))
        for _ in range(7):
            out = []
            for i, c in enumerate(cs):
                out.append(c)
                c2 = cs[(i + 1) % len(cs)] + (2 * math.pi if i == len(cs) - 1 else 0.0)
                if c2 - c > 0.003 and abs(self.rim(abs(wrap(c2))) - self.rim(abs(c))) > tol:
                    out.append(round(wrap((c + c2) / 2), 6))
            if len(out) == len(cs):
                break
            cs = sorted(set(out))
        return cs

    def mesh(self, cols, step=0.0045, brim=None):
        """Columns resampled from the crown down every `step` m, stitched side by side into triangles."""
        step *= RES
        top = self.at(0.0, self.yc + self.h)
        verts = [top]
        idx, dist = [], []
        for a in cols:
            pts = self.column(a, brim)[::-1]
            pts[0] = top
            rs, ds = resample(pts, step)
            idx.append([0] + list(range(len(verts), len(verts) + len(rs) - 1)))
            verts += rs[1:]
            dist.append(ds)
        faces = []
        for i in range(len(cols)):
            j = (i + 1) % len(cols)
            ia, da, ib, db = idx[i], dist[i], idx[j], dist[j]
            p, q = 0, 0
            while p < len(ia) - 1 or q < len(ib) - 1:
                if q >= len(ib) - 1 or (p < len(ia) - 1 and da[p + 1] <= db[q + 1]):
                    faces.append((ia[p], ia[p + 1], ib[q]))
                    p += 1
                else:
                    faces.append((ia[p], ib[q + 1], ib[q]))
                    q += 1
        return verts, faces


def extra_cols(angles, spread=(0.006, 0.014, 0.024, 0.036)):
    return [a + s * k for a in angles for s in spread for k in (1, -1)] + list(angles)


def beak(u, width=0.075, power=1.15):
    """How far out a V-shaped plate stands at u (1 on its ridge, 0 past `width`): its straight sides meet at a crease."""
    return max(0.0, 1.0 - abs(u) / width) ** power


# ---------------------------------------------------------------- plates cut from a form by an outline

def sd_ellipse(u, v, cu, cv, ru, rv, rot=0.0):
    du, dv = u - cu, v - cv
    if rot:
        c, s = math.cos(rot), math.sin(rot)
        du, dv = c * du + s * dv, -s * du + c * dv
    return (math.hypot(du / ru, dv / rv) - 1.0) * min(ru, rv)


def sd_box(u, v, cu, cv, hu, hv, r=0.0):
    qx, qy = abs(u - cu) - hu + r, abs(v - cv) - hv + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def sd_capsule(u, v, p0, p1, r):
    return seg_dist(u, v, p0, p1) - r


def sd_poly(u, v, poly):
    d, inside_ = 1e9, False
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        wx, wy = u - x1, v - y1
        t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey + 1e-18))
        d = min(d, math.hypot(wx - ex * t, wy - ey * t))
        if (y1 > v) != (y2 > v) and u < x1 + (v - y1) * ex / (ey + 1e-18):
            inside_ = not inside_
    return -d if inside_ else d


def outline(points, n=8):
    """A smooth closed outline through (u, v) points (Catmull-Rom), as a polygon."""
    out, m = [], len(points)
    for i in range(m):
        p0, p1, p2, p3 = [Vector(points[(i + k) % m]) for k in (-1, 0, 1, 2)]
        for j in range(n):
            t = j / n
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
            out.append((q.x, q.y))
    return out


def symmetric(half):
    """A closed outline from its left half (u >= 0, listed from the top of the midline round to its bottom)."""
    return list(half) + [(-u, v) for u, v in reversed(half[1:-1])]


def plate(surface, sd, u0, u1, v0, v1, h=0.0028, periodic=False):
    """The part of surface(u, v) where sd(u, v) < 0, on a grid of ~h metres (coarser at a coarse RES), its outline
    traced through the zero of sd (marching squares) so edges, slits and holes come out smooth. periodic: u wraps round
    (u1 meets u0). A domain centred on u=0 always has a column on it, so a ridge there stays sharp."""
    h *= RES
    nu = max(2, int(round((u1 - u0) / h)))
    if abs(u0 + u1) < 1e-9 and nu % 2:
        nu += 1
    nv = max(2, int(round((v1 - v0) / h)))
    us = [u0 + (u1 - u0) * i / nu for i in range(nu if periodic else nu + 1)]
    vs = [v0 + (v1 - v0) * j / nv for j in range(nv + 1)]
    ncol = len(us)
    val = []
    for v in vs:
        row = []
        for u in us:
            f = sd(u, v)
            row.append(f if abs(f) > 1e-6 else 1e-6)
        val.append(row)
    pts, index = [], {}

    def corner(i, j):
        key = ('c', i, j)
        if key not in index:
            index[key] = len(pts)
            pts.append((us[i], vs[j]))
        return index[key]

    def cross(a, b):
        key = ('e',) + tuple(sorted((a, b)))
        if key not in index:
            (i0, j0), (i1, j1) = a, b
            f0, f1 = val[j0][i0], val[j1][i1]
            t = f0 / (f0 - f1)
            ua, ub = us[i0], us[i1]
            if periodic and i1 == 0 and i0 == ncol - 1:
                ub = u1
            if periodic and i0 == 0 and i1 == ncol - 1:
                ua = u1
            index[key] = len(pts)
            pts.append((lerp(ua, ub, t), lerp(vs[j0], vs[j1], t)))
        return index[key]
    faces = []
    for j in range(nv):
        for i in range(ncol if periodic else ncol - 1):
            i2 = (i + 1) % ncol
            cs = [(i, j), (i2, j), (i2, j + 1), (i, j + 1)]
            poly = []
            for k in range(4):
                a, b = cs[k], cs[(k + 1) % 4]
                fa, fb = val[a[1]][a[0]], val[b[1]][b[0]]
                if fa < 0:
                    poly.append(corner(*a))
                if (fa < 0) != (fb < 0):
                    poly.append(cross(a, b))
            if len(poly) >= 3:
                faces.append(poly)
    return [surface(u, v) for u, v in pts], faces


# ---------------------------------------------------------------- details held on a surface

def rivet(at, normal, r=0.005, washer=0.0):
    """A domed rivet head sunk into the surface at `at`; with a washer (a flat rosette) under it."""
    t, n, b = frame(normal)
    head = oball(at - n * (r * 0.35), (r, r * 0.75, r), (t, n, b), 10, 6)
    if not washer:
        return head
    return merge(head, oball(at - n * 0.0008, (washer, 0.0016, washer), (t, n, b), 12, 4))


def srivet(sk, a, y, r=0.005, off=0.0, washer=0.0):
    return rivet(sk.point(a, y, off), sk.normal(a, y), r, washer)


def strap(sk, path, width, height=0.003, off=0.0, sink=0.0025):
    """A band riveted on along (a, y) points of a form, following its surface across too (over keels and crowns);
    off: metres out from the surface (a number or a function of y)."""
    of = off if callable(off) else (lambda y, o=off: o)
    vertical = all(abs(a - path[0][0]) < 1e-9 for a, _ in path)
    verts, faces = [], []
    for a, y in path:
        if vertical:
            q = sk.at(a, y)
            da = width / 2 / max(0.012, math.hypot(q.x, q.z - sk.zc))
            ring = [(a - da, y), (a, y), (a + da, y)]
        else:
            ring = [(a, y - width / 2), (a, y), (a, y + width / 2)]
        o = of(y)
        verts += [sk.point(aa, yy, o + height) for aa, yy in ring] + [sk.point(aa, yy, o - sink) for aa, yy in ring]
    m = len(path)
    for k in range(m - 1):
        b, c = k * 6, (k + 1) * 6
        faces += [(b, b + 1, c + 1, c), (b + 1, b + 2, c + 2, c + 1), (b + 3, c + 3, c + 4, b + 4), (b + 4, c + 4, c + 5, b + 5),
                  (b, c, c + 3, b + 3), (b + 2, b + 5, c + 5, c + 2)]
    last = (m - 1) * 6
    faces += [(0, 3, 4, 1), (1, 4, 5, 2), (last, last + 1, last + 4, last + 3), (last + 1, last + 2, last + 5, last + 4)]
    return verts, faces


def fin(sk, path, heights, top=0.002, foot=0.008, sink=0.005):
    """A comb raised from the skull along points (a, y) of its midline: `heights` above the surface, thin and rounded
    on top, flaring at the foot into the skull it grows out of."""
    prof = [(-foot, 0, -sink), (-foot * 0.5, 0, 0.0), (-top * 1.5, 0.3, 0.0), (-top, 0.75, 0.0), (-top * 0.7, 1.0, -top * 0.5),
            (0.0, 1.0, 0.0), (top * 0.7, 1.0, -top * 0.5), (top, 0.75, 0.0), (top * 1.5, 0.3, 0.0), (foot * 0.5, 0, 0.0), (foot, 0, -sink)]
    verts, faces = [], []
    side = Vector((1, 0, 0))
    m = len(path)
    for k, (a, y) in enumerate(path):
        p, n = sk.at(a, y), sk.normal(a, y)
        h = heights[k]
        for x, fh, dy in prof:
            verts.append(p + side * x + n * (fh * h + dy))
    np_ = len(prof)
    for k in range(m - 1):
        for j in range(np_):
            j2 = (j + 1) % np_
            faces.append((k * np_ + j, k * np_ + j2, (k + 1) * np_ + j2, (k + 1) * np_ + j))
    faces.append(tuple(range(np_))[::-1])
    faces.append(tuple(range((m - 1) * np_, m * np_)))
    return verts, faces


def comb_rope(sk, path, heights, r=0.0027):
    """The roped crest along the top of a comb."""
    pts = [sk.point(a, y, heights[k] - 0.0004) for k, (a, y) in enumerate(path)]
    keep = [k for k in range(len(path)) if heights[k] > r * 1.5]
    return tube(spline([pts[k] for k in keep], 4), r, 16, twist=(3, 0.011, 0.22) if RES <= 1 else None)


def midline(sk, y_front, y_back, n=28):
    """Points (a, y) up the front of the skull from y_front, over the crown and down the back to y_back."""
    top = sk.yc + sk.h - 1e-4
    front = [(0.0, lerp(y_front, top, math.sin(math.pi / 2 * i / n))) for i in range(n + 1)]
    back = [(math.pi, lerp(y_back, top, math.sin(math.pi / 2 * i / n))) for i in range(n)][::-1]
    return front + back


def hinge(sk, a, y, length=0.026, r=0.0035, low_off=-0.0045):
    """A hinge on the rim: the barrel, and a riveted leaf up onto the skull and one down onto the plate it holds."""
    p, n = sk.point(a, y, 0.002), sk.normal(a, y)
    t = (sk.at(a + 0.01, y) - sk.at(a - 0.01, y)).normalized()
    parts = [tube([p - t * length / 2, p + t * length / 2], r, 10)]
    for dy, off in ((0.011, 0.0), (-0.011, low_off)):
        q = sk.point(a, y + dy, off + 0.0006)
        nn = sk.normal(a, y + dy)
        up = nn.cross(t).normalized()
        parts.append(oball(q, (length * 0.42, 0.0012, 0.009), (t, nn, up), 10, 4))
        for s in (-1, 1):
            parts.append(rivet(q + t * (s * length * 0.26), nn, 0.0028))
    return merge(*parts)


def ribbon(points, width, thick=0.0018, centre=Vector((0.0, 0.06, 0.0))):
    """A flat leather strap along points, lying face-out from `centre` (chin straps)."""
    verts, faces = [], []
    m = len(points)
    for k in range(m):
        p = points[k]
        d = (points[min(k + 1, m - 1)] - points[max(k - 1, 0)]).normalized()
        up = p - centre
        up = (up - d * up.dot(d)).normalized()
        side = d.cross(up).normalized() * (width / 2)
        t = up * (thick / 2)
        verts += [p + side + t, p - side + t, p - side - t, p + side - t]
    for k in range(m - 1):
        a, b = k * 4, k * 4 + 4
        faces += [(a, a + 1, b + 1, b), (a + 1, a + 2, b + 2, b + 1), (a + 2, a + 3, b + 3, b + 2), (a + 3, a, b, b + 3)]
    last = (m - 1) * 4
    faces += [(0, 3, 2, 1), (last, last + 1, last + 2, last + 3)]
    return verts, faces


def buckle(at, up, along, w=0.016, h=0.02, r=0.0014):
    """A buckle on a strap: a rounded frame and its tongue."""
    up = Vector(up).normalized()
    along = (Vector(along) - up * Vector(along).dot(up)).normalized()
    side = along.cross(up)
    c = Vector(at) + up * r
    loop = []
    for k in range(28):
        t = 2 * math.pi * k / 28
        cx, cy = math.cos(t), math.sin(t)
        loop.append(c + along * (math.copysign(abs(cx) ** 0.4, cx) * h / 2) + side * (math.copysign(abs(cy) ** 0.4, cy) * w / 2))
    return merge(tube(loop, r, 6, closed=True, fixed=True), tube([c - along * (h / 2), c + along * (h * 0.15)], r * 0.8, 6, fixed=True))


def chin_strap(top, width=0.011):
    """A leather strap from inside the helmet at `top` (the left side; the right mirrors it), down past the cheek and
    under the chin, and its buckle on the left cheek: (strap, buckle)."""
    left = [Vector(top), Vector((0.087, 0.076, 0.058)), Vector((0.069, 0.02, 0.077)), Vector((0.044, -0.014, 0.092))]
    right = [Vector((-q.x, q.y, q.z)) for q in left]
    pts = spline(right + [Vector((0.0, -0.025, 0.097))] + left[::-1], 6)
    pts = resample(pts, 0.004 * RES)[0]
    k = int(len(pts) * 0.76)
    d = (pts[k + 1] - pts[k - 1]).normalized()
    up = pts[k] - Vector((0.0, 0.06, 0.0))
    up = (up - d * up.dot(d)).normalized()
    return ribbon(pts, width), buckle(pts[k] + up * 0.0012, up, d)


def crest(points, ups, heights, widths):
    """A crest of horsehair standing along points (its foot): `heights` out along ups, `widths` across, full and rounded
    on top, its foot sunk into its holder."""
    prof = [(-1.0, -0.2)] + [(math.cos(t), math.sin(t)) for t in (math.pi * (1 - i / 14) for i in range(15))] + [(1.0, -0.2)]
    verts, faces = [], []
    m = len(points)
    for k in range(m):
        p, want = Vector(points[k]), Vector(ups[k]).normalized()
        d = (Vector(points[min(k + 1, m - 1)]) - Vector(points[max(k - 1, 0)])).normalized()
        side = d.cross(want).normalized()
        up = side.cross(d).normalized()
        if up.dot(want) < 0:
            up, side = -up, -side
        for x, y in prof:
            full = 1.0 + 0.18 * max(0.0, math.sin(math.pi * max(0.0, y)))
            verts.append(p + side * (x * widths[k] * full) + up * (y * heights[k]))
    np_ = len(prof)
    for k in range(m - 1):
        for j in range(np_):
            j2 = (j + 1) % np_
            faces.append((k * np_ + j, k * np_ + j2, (k + 1) * np_ + j2, (k + 1) * np_ + j))
    faces.append(tuple(range(np_))[::-1])
    faces.append(tuple(range((m - 1) * np_, m * np_)))
    return verts, faces


# ---------------------------------------------------------------- helmets

def apprentice_helm():
    """A boiled-leather cap with ear flaps and a neck guard, stitched round its edge, stiffened by an iron brow band and
    two iron bands crossing over the crown to a boss, all riveted; the flaps tied under the chin with a thong."""
    p = Piece('helm')
    leather = mat('leather', 0x6e482a, 'leather', engrave='stitch', rough=0.7)
    dark = mat('binding', 0x3a2414, 'leather', rough=0.8)
    iron = mat('iron', 0x3b3835, 'iron', rough=0.6, metal=0.7)
    rim = curve([(0, 0.133), (0.45, 0.131), (0.64, 0.12), (0.78, 0.07), (0.9, 0.012), (1.04, -0.004), (1.62, -0.004),
                 (1.82, 0.012), (2.0, 0.03), (2.2, 0.022), (2.5, -0.012), (2.85, -0.028), (math.pi, -0.03)])

    def lower(a, u):
        back = smooth(2.1, 2.8, a)
        return 1.0 - 12.0 * u * u * (1 - back) + back * 4.0 * u * u
    sk = Skull(yc=0.12, zc=0.008, w=0.109, h=0.138, df=0.113, db=0.113, n=2.5, peak=0.2, keel=(0.05, 0.05), keel_from=0.15,
               rim=rim, lower=lower)
    p.add(leather, *sk.mesh(sk.cols(112)), solid=0.0045, roll=0.002, roll_mat=dark, forge=creased(0.0006), deco=0.011)
    band_y = lambda a: max(rim(abs(wrap(a))), 0.128) + 0.012
    p.add(iron, *strap(sk, [(2 * math.pi * k / 96, band_y(2 * math.pi * k / 96)) for k in range(97)], 0.02, 0.0026),
          forge=hammered(0.0004))
    top = sk.yc + sk.h
    for a0 in (0.0, math.pi, math.pi / 2, -math.pi / 2):
        y0 = band_y(a0) + 0.006
        p.add(iron, *strap(sk, [(a0, lerp(y0, top - 0.008, math.sin(math.pi / 2 * k / 24))) for k in range(25)], 0.016, 0.0024),
              forge=hammered(0.0004, seed=a0))
        p.add(iron, *srivet(sk, a0, lerp(y0, top, 0.45), 0.0036, 0.0024))
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        p.add(iron, *srivet(sk, a, band_y(a), 0.0036, 0.0026))
    t_, n_, b_ = frame(sk.normal(0, top - 0.002))
    p.add(iron, *oball(sk.point(0, top - 0.002), (0.017, 0.007, 0.017), (t_, n_, b_)))  # the boss where the bands cross
    knot = Vector((0.0, -0.032, 0.094))
    for s in (1, -1):
        tab = sk.point(s * 1.0, 0.008, 0.001)
        p.add(dark, *oball(tab, (0.006, 0.004, 0.006)))
        p.add(dark, *tube(spline([tab, Vector((s * 0.06, -0.012, 0.09)), Vector((s * 0.03, -0.03, 0.1)), knot], 4), 0.0026, 8))
        p.add(dark, *tube([knot, knot + Vector((s * 0.008, -0.022, 0.004)), knot + Vector((s * 0.01, -0.038, 0.002))], [0.0024, 0.0022, 0.0018], 8))
    p.add(dark, *oball(knot, 0.0055))
    return p


def abyssal_helm():
    """A comb morion: a tall comb raised from the skull with a roped crest, the brim swept up into points front and back
    and roped round its edge; blued steel with gilt etched bands, brass rosette rivets round the base, a plume holder at
    the back, a leather lining and a chin strap with a brass buckle."""
    p = Piece('helm')
    blued = mat('blued', 0x1b2a46, 'blued', engrave='waves', engrave_color=0xc8a24a, rough=0.3, metal=0.8)
    brass = mat('brass', 0xb08a3c, 'brass', rough=0.35, metal=0.85)
    leather = mat('lining', 0x4a2e1a, 'leather', rough=0.8)
    rim = curve([(0, 0.138), (1.57, 0.127), (math.pi, 0.134)])
    sk = Skull(yc=0.13, zc=0.006, w=0.108, h=0.148, df=0.118, db=0.118, n=2.3, peak=0.25, keel=(0.08, 0.08), keel_from=0.2, rim=rim)

    def brim(a):
        c = math.cos(a)
        return 0.034 + 0.03 * c * c, -0.006 + 0.086 * c ** 4, 2.0

    def bands(q):  # etched bands up the skull
        th = angle_of(q, sk.zc)
        d = min(abs(wrap(th - b)) for b in (0.5, -0.5, 1.55, -1.55, 2.6, -2.6))
        return smooth(0.13, 0.1, d) * smooth(rim(abs(th)) + 0.004, rim(abs(th)) + 0.012, q.y)
    p.add(blued, *sk.mesh(sk.cols(112), brim=brim), solid=0.0035, roll=0.0018, rope=True, deco=bands)
    path = midline(sk, 0.17, 0.17)
    hs = [0.056 * math.sin(math.pi * k / (len(path) - 1)) ** 0.7 for k in range(len(path))]
    p.add(blued, *fin(sk, path, hs), deco=lambda q: 0.0)
    p.add(blued, *comb_rope(sk, path, hs), deco=lambda q: 0.0)
    for k in range(14):
        a = 2 * math.pi * (k + 0.5) / 14
        p.add(brass, *srivet(sk, a, rim(abs(wrap(a))) + 0.012, 0.0042, washer=0.0075))
    p.add(leather, *strap(sk, [(lerp(-math.pi, math.pi, k / 120), rim(abs(wrap(lerp(-math.pi, math.pi, k / 120)))) + 0.004) for k in range(121)],
                          0.016, 0.0, -0.0035, 0.0022))
    a, y = math.pi, 0.168
    q, n = sk.point(a, y, 0.0048), sk.normal(a, y)
    p.add(brass, *tube([q - UP * 0.018, q + UP * 0.02], 0.0055, 12))
    t_, n_, b_ = frame(n)
    p.add(brass, *oball(sk.point(a, y - 0.012, 0.0005), (0.009, 0.0022, 0.009), (t_, n_, b_)))
    p.add(brass, *srivet(sk, a, y - 0.012, 0.003, 0.0022))
    strap_, buckle_ = chin_strap((0.097, 0.13, 0.034))
    p.add(leather, *strap_, forge=creased(0.0003))
    p.add(brass, *buckle_)
    return p


def ashforged_helm():
    """A sugarloaf great helm, after a reconstruction of one from about 1300: a pointed crown over a face plate creased
    down the middle to a point at the chin, a brass cross over the face with flared, riveted ends and the vision slits cut
    through its arm, fields of breathing holes on both cheeks, holes for the lining's lacing and a toggle for the chain
    that held it to the breastplate; fire-blackened steel and brass."""
    p = Piece('helm')
    black = mat('blackened', 0x27231f, 'black', rough=0.5, metal=0.7)
    brass = mat('brass', 0xb8923e, 'brass', rough=0.28, metal=0.9)
    steel = mat('steel', 0x8e8d8a, 'steel', rough=0.4, metal=0.85)
    sk = Skull(yc=0.11, zc=0.012, w=0.12, h=0.19, df=0.134, db=0.124, n=2.0, peak=0.9, keel=(0.34, 0.0), keel_from=-1.0,
               rim=0.112, lower=lambda a, u: 1.0 + 0.1 * u)
    over_slits = lambda q: smooth(0.7, 0.6, abs(angle_of(q, sk.zc)))
    p.add(black, *sk.mesh(sk.cols(112, extra_cols([0.0]))), solid=0.0035, roll=0.0014,
          bump=bumps(lambda q: 0.003 * smooth(0.12, 0.112, q.y) * over_slits(q),
                     dents((sk.at(0.75, 0.2), 0.014, 0.0015), (sk.at(-1.9, 0.165), 0.012, 0.0012))))
    RU = 0.13
    bottom = curve([(0, -0.066), (0.3, -0.05), (0.7, -0.036), (1.5, -0.028), (math.pi, -0.038)])

    def sd(u, v):
        d = max(bottom(abs(u / RU)) - v, v - 0.125)
        for s in (1, -1):
            d = max(d, -sd_box(u, v, s * 0.036, 0.109, 0.022, 0.011, 0.002))  # the slits, open up under the crown
            for row in range(6):  # breathing holes, a field narrowing downwards
                for k in range(5 - row // 2):
                    d = max(d, -sd_ellipse(u, v, s * (0.024 + 0.0125 * k + 0.006 * (row % 2)), 0.072 - 0.0135 * row, 0.0021, 0.0021))
        uu = round(u / 0.022) * 0.022  # the lining's lacing holes along the bottom
        return max(d, -sd_ellipse(u, v, uu, bottom(abs(uu / RU)) + 0.009, 0.0014, 0.0014))
    face = plate(lambda u, v: sk.point(u / RU, v, -0.0035), sd, -math.pi * RU, math.pi * RU, -0.07, 0.127, periodic=True)
    p.add(black, *face, solid=0.0035, roll=0.0014, roll_min=0.3,
          bump=bumps(lambda q: 0.0025 * smooth(0.09, 0.098, q.y) * smooth(0.12, 0.1, q.y) * over_slits(q),
                     dents((sk.at(-0.45, 0.0), 0.012, 0.001))))
    # the brass cross: bent over the crown's edge where it passes from the face plate to the crown

    def boff(v):
        return lerp(-0.0019, 0.0016, smooth(0.106, 0.114, v))
    ends = [[(-0.0105, 0.236), (-0.023, 0.248), (-0.012, 0.252), (0.0, 0.268), (0.012, 0.252), (0.023, 0.248), (0.0105, 0.236)],
            [(-0.0105, -0.036), (-0.023, -0.048), (-0.012, -0.052), (0.0, -0.064), (0.012, -0.052), (0.023, -0.048), (0.0105, -0.036)]]
    for s in (1, -1):
        ends.append([(s * 0.11, 0.0885), (s * 0.124, 0.079), (s * 0.128, 0.09), (s * 0.144, 0.106), (s * 0.128, 0.122), (s * 0.124, 0.133), (s * 0.11, 0.1235)])

    def cross_sd(u, v):
        d = min([sd_box(u, v, 0.0, 0.1, 0.0105, 0.152), sd_box(u, v, 0.0, 0.106, 0.128, 0.0175)] + [sd_poly(u, v, e) for e in ends])
        for s in (1, -1):
            d = max(d, -sd_box(u, v, s * 0.036, 0.1045, 0.0215, 0.0062, 0.002))
        return d
    p.add(brass, *plate(lambda u, v: sk.point(u / RU, v, boff(v)), cross_sd, -0.16, 0.16, -0.075, 0.275, h=0.002),
          solid=0.0022, roll=0.0004, forge=hammered(0.0003))
    rivets = [(s * 0.016, 0.244) for s in (1, -1)] + [(s * 0.016, -0.044) for s in (1, -1)] + [(0.0, 0.04), (0.0, 0.0), (0.0, 0.17), (0.0, 0.21)]
    rivets += [(s * 0.132, v) for s in (1, -1) for v in (0.094, 0.118)] + [(s * u, v) for s in (1, -1) for u in (0.07, 0.1) for v in (0.092, 0.12)]
    for u, v in rivets:
        p.add(brass, *srivet(sk, u / RU, v, 0.0034, boff(v) + 0.0004))
    for k in range(12):  # brass rivets round the crown's edge at the sides and back
        a = 1.15 + (2 * math.pi - 2.3) * k / 11
        p.add(brass, *srivet(sk, a, 0.118, 0.0036, 0.0003))
    # the chain toggle on the left: a stud, a ring hanging from it, a cross-shaped toggle on the ring
    a, y = 0.95, -0.004
    stud, n = sk.point(a, y, -0.0035), sk.normal(a, y)
    t_, n_, b_ = frame(n)
    c = stud + n * 0.004 - UP * 0.008
    p.add(steel, *rivet(stud, n, 0.0042))
    p.add(steel, *tube([c + (UP * math.cos(f) + n_ * math.sin(f)) * 0.0075 for f in (2 * math.pi * k / 20 for k in range(20))], 0.0014, 6, closed=True))
    bot = c - UP * 0.0075
    p.add(steel, *merge(tube([bot - t_ * 0.009, bot + t_ * 0.009], 0.0016, 6), tube([bot - UP * 0.009, bot + UP * 0.002], 0.0016, 6)))
    return p


def dragon_helm():
    """A close helmet, after the English and German ones of the later 16th century: a crested skull with a roped comb,
    a visor drawn out into a sharp beak with two sights, a bevor below it with a rosette of breathing holes, both
    pivoting at the temples, and two gorget plates at the back; crimson-painted steel with gilt etched borders of
    scales, gilt roped edges and gilt rivets."""
    p = Piece('helm')
    red = mat('crimson', 0x7a1620, 'enamel', engrave='scales', engrave_color=0xc9a040, rough=0.35, metal=0.3)
    gold = mat('gold', 0xc49a3a, 'gold', rough=0.3, metal=0.9)
    rim = curve([(0, 0.142), (0.9, 0.14), (1.08, 0.1), (1.2, -0.006), (math.pi, -0.008)])
    sk = Skull(yc=0.125, zc=0.008, w=0.108, h=0.13, df=0.118, db=0.116, n=2.3, keel=(0.08, 0.08), keel_from=0.17, rim=rim,
               lower=lambda a, u: 1.0 - 1.6 * u * u)
    p.add(red, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0018, rope=True, roll_mat=gold, deco=0.014)
    path = midline(sk, 0.2, 0.06)
    hs = [0.036 * math.sin(math.pi * k / (len(path) - 1)) ** 0.8 for k in range(len(path))]
    p.add(red, *fin(sk, path, hs, top=0.0022, foot=0.008), deco=lambda q: 0.0)
    p.add(gold, *comb_rope(sk, path, hs), deco=lambda q: 0.0)
    RU = 0.125

    def ridge(u, v, hi, lo, at, spread):  # V-shaped stand-off: a crease down the middle, deepest at `at`
        return lo + hi * beak(u) * gauss(v - at, spread)
    voff = lambda u, v: 0.0065 + ridge(u, v, 0.034, 0.0, 0.1, 0.045)
    boff = lambda u, v: 0.0042 + ridge(u, v, 0.024, 0.0, 0.07, 0.06)
    visor = outline([(-0.157, 0.152), (-0.08, 0.153), (0.0, 0.154), (0.08, 0.153), (0.157, 0.152), (0.162, 0.13), (0.152, 0.112),
                     (0.1, 0.098), (0.045, 0.086), (0.0, 0.077), (-0.045, 0.086), (-0.1, 0.098), (-0.152, 0.112), (-0.162, 0.13)])
    sights = [[(s * 0.009, 0.0975), (s * 0.064, 0.1005), (s * 0.064, 0.1065), (s * 0.009, 0.1035)] for s in (1, -1)]

    def visor_sd(u, v):
        return max(sd_poly(u, v, visor), -min(sd_poly(u, v, sights[0]), sd_poly(u, v, sights[1])))
    p.add(red, *plate(lambda u, v: sk.point(u / RU, v, voff(u, v)), visor_sd, -0.17, 0.17, 0.07, 0.16),
          solid=0.003, roll=0.0015, rope=True, roll_mat=gold, roll_min=0.2, deco=0.011, sharp=25)
    bevor = outline([(-0.159, 0.125), (-0.1, 0.11), (-0.045, 0.098), (0.0, 0.09), (0.045, 0.098), (0.1, 0.11), (0.159, 0.125),
                     (0.162, 0.06), (0.15, 0.01), (0.12, -0.012), (0.06, -0.03), (0.0, -0.046), (-0.06, -0.03), (-0.12, -0.012),
                     (-0.15, 0.01), (-0.162, 0.06)])
    holes = [(-0.06, 0.04)] + [(-0.06 + r * math.cos(t), 0.04 + r * math.sin(t)) for r, n in ((0.0085, 6), (0.017, 12)) for t in (2 * math.pi * k / n for k in range(n))]

    def bevor_sd(u, v):
        return max(sd_poly(u, v, bevor), -min(sd_ellipse(u, v, hu, hv, 0.0021, 0.0021) for hu, hv in holes))
    p.add(red, *plate(lambda u, v: sk.point(u / RU, v, boff(u, v)), bevor_sd, -0.17, 0.17, -0.05, 0.13),
          solid=0.003, roll=0.0015, rope=True, roll_mat=gold, roll_min=0.2, deco=0.011, sharp=25)
    for s in (1, -1):  # the pivots, and a rivet each side where the bevor's strap fastens
        a = s * 1.25
        p.add(gold, *srivet(sk, a, 0.127, 0.0068, voff(a * RU, 0.127) + 0.0004, washer=0.011))
        p.add(gold, *srivet(sk, s * 1.18, 0.045, 0.0042, boff(s * 1.18 * RU, 0.045) + 0.0004))
    # two gorget plates at the back and sides, flaring out over the neck
    def gorget(off_, v0, v1):
        def surf(u, v):
            a = u / RU
            base = sk.point(a, -0.004, off_)
            n = sk.normal(a, -0.004)
            out = Vector((n.x, 0, n.z)).normalized()
            return base + UP * (v + 0.004) + out * (0.75 * (-0.004 - v))
        return plate(surf, lambda u, v: sd_box(u, v, math.pi * RU, (v0 + v1) / 2, (math.pi - 1.05) * RU, (v1 - v0) / 2, 0.004),
                     1.0 * RU, (2 * math.pi - 1.0) * RU, v0 - 0.004, v1 + 0.004)
    p.add(red, *gorget(-0.0012, -0.028, -0.004), solid=0.003, roll=0.0014, rope=True, roll_mat=gold, deco=0.009)
    p.add(red, *gorget(0.0018, -0.044, -0.022), solid=0.003, roll=0.0014, rope=True, roll_mat=gold, deco=0.009)
    for k in range(9):
        a = 1.15 + (2 * math.pi - 2.3) * k / 8
        p.add(gold, *srivet(sk, a, -0.006, 0.0036, 0.0016))
    return p


def glacial_helm():
    """A Viking spectacle helm, after the one found at Gjermundbu: a rounded, slightly pointed skull of bright steel
    held by riveted bands, a spike at the crown, a spectacle guard with almond eyes and a pointed nasal, and a mail
    aventail of big rings hanging all round, over the mouth and down to the neck."""
    p = Piece('helm')
    steel = mat('steel', 0xc3c9cf, 'steel', rough=0.25, metal=0.9)
    dark = mat('band_steel', 0x7c838a, 'steel', rough=0.35, metal=0.85)
    mail = mat('mail', 0x9aa0a6, 'mail', rough=0.4, metal=0.85, ring=0.0068)
    rim = curve([(0, 0.133), (1.57, 0.124), (math.pi, 0.12)])
    sk = Skull(yc=0.13, zc=0.008, w=0.113, h=0.138, df=0.121, db=0.117, n=2.1, peak=0.4, keel=(0.12, 0.12),
               keel_from=0.17, rim=rim)
    p.add(steel, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0012)
    p.add(dark, *strap(sk, [(2 * math.pi * k / 96, rim(abs(wrap(2 * math.pi * k / 96))) + 0.011) for k in range(97)], 0.022, 0.003),
          forge=hammered(0.0004))
    top = sk.yc + sk.h
    for a0 in (0.0, math.pi, math.pi / 2, -math.pi / 2):
        y0 = rim(abs(a0)) + 0.02
        p.add(dark, *strap(sk, [(a0, lerp(y0, top - 0.006, math.sin(math.pi / 2 * k / 24))) for k in range(25)], 0.018, 0.0028),
              forge=hammered(0.0004, seed=a0))
        for f in (0.2, 0.45, 0.7):
            p.add(dark, *srivet(sk, a0, lerp(y0, top, f), 0.0036, 0.0028))
    for k in range(24):
        a = 2 * math.pi * (k + 0.5) / 24
        p.add(dark, *srivet(sk, a, rim(abs(wrap(a))) + 0.011, 0.0036, 0.003))
    tip = sk.at(0, top)
    p.add(dark, *tube([tip - UP * 0.006, tip + UP * 0.004, tip + UP * 0.02, tip + UP * 0.036, tip + UP * 0.05],
                      [0.012, 0.0095, 0.0055, 0.003, 0.0008], 12))
    # the spectacle guard
    RU = 0.12

    def off(u, v):
        return 0.006 + 0.012 * smooth(0.104, 0.056, v) * gauss(u, 0.016)
    half = [(0.0, 0.138), (0.088, 0.137), (0.091, 0.114), (0.079, 0.089), (0.059, 0.075), (0.036, 0.072), (0.019, 0.076),
            (0.012, 0.062), (0.0, 0.045)]
    guard = outline(symmetric(half), 6)
    eye = outline([(0.012, 0.112), (0.04, 0.117), (0.066, 0.109), (0.075, 0.098), (0.061, 0.087), (0.037, 0.084), (0.017, 0.091)], 6)
    eye_r = [(-u, v) for u, v in eye]

    def sd(u, v):
        return max(sd_poly(u, v, guard), -sd_poly(u, v, eye), -sd_poly(u, v, eye_r))

    def ribs(q):  # a raised rib round each eye and down the nasal
        u, v = angle_of(q, sk.zc) * RU, q.y
        d = min(abs(sd_poly(u, v, eye) - 0.007), abs(sd_poly(u, v, eye_r) - 0.007))
        return 0.0012 * gauss(d, 0.0022) + 0.0012 * gauss(u, 0.0022) * smooth(0.12, 0.11, v) * smooth(0.05, 0.06, v)
    p.add(dark, *plate(lambda u, v: sk.point(u / RU, v, off(u, v)), sd, -0.1, 0.1, 0.04, 0.142), solid=0.003, roll=0.0011,
          fine=ribs, sharp=30)
    for u, v in [(0.0, 0.129), (0.062, 0.129), (-0.062, 0.129), (0.082, 0.107), (-0.082, 0.107), (0.06, 0.081), (-0.06, 0.081)]:
        p.add(dark, *srivet(sk, u / RU, v, 0.0034, off(u, v) + 0.0006))

    # the aventail: hung behind the spectacles in front and inside the brow band elsewhere, falling and flaring a little
    def mail_pt(i, j, na, nv):
        a = -math.pi + 2 * math.pi * i / na
        aa = abs(wrap(a))
        t = j / nv
        y0 = lerp(0.077, rim(aa) + 0.006, smooth(0.8, 1.05, aa))
        y1 = lerp(lerp(-0.062, -0.032, smooth(0.6, 1.4, aa)), -0.066, smooth(2.0, 2.9, aa)) + 0.003 * math.cos(a * 40)
        q, n = sk.point(a, y0, lerp(0.012, -0.002, smooth(0.8, 1.05, aa))), sk.normal(a, y0)
        out = Vector((n.x, 0, n.z)).normalized()
        return q + UP * ((y1 - y0) * t) + out * (lerp(0.03, 0.022, smooth(0.6, 1.4, aa)) * t * t + 0.012 * t)
    na, nv = int(144 / RES), int(26 / RES)
    av = [mail_pt(i, j, na, nv) for j in range(nv + 1) for i in range(na)]
    af = [(j * na + i, j * na + (i + 1) % na, (j + 1) * na + (i + 1) % na, (j + 1) * na + i) for j in range(nv) for i in range(na)]
    p.add(mail, av, af, solid=0.003, forge=False)
    return p


def emerald_helm():
    """A Corinthian helmet: a bronze bowl raised in one piece with long cheek pieces that leave a T-shaped opening for
    the eyes and mouth, a nasal between the eyes, a flared neck guard, a raised rib at the brow and a bead round every
    edge, embossed scrolling foliage round the eyes and down the cheek pieces, a rosette over the nose, and a crest of
    green-dyed horsehair on a bronze holder sweeping back down the neck; bronze gone green in its hollows."""
    p = Piece('helm')
    bronze = mat('bronze', 0x86622e, 'bronze', engrave='vines', emboss=True, rough=0.38, metal=0.85)
    hair = mat('horsehair', 0x23442b, 'hair', rough=0.9)

    def lower(a, u):
        side = smooth(0.4, 1.4, a) * (1 - smooth(1.8, 2.5, a))
        return 1.0 - (1.4 + 3.0 * side) * u * u * (1 - smooth(1.8, 2.6, a)) + smooth(1.9, 2.9, a) * 0.55 * (u / 0.16) ** 1.8
    sk = Skull(yc=0.13, zc=0.006, w=0.112, h=0.13, df=0.124, db=0.122, n=2.2, keel=(0.04, 0.04), keel_from=0.2, rim=0.142, lower=lower)
    p.add(bronze, *sk.mesh(sk.cols(112)), solid=0.003, deco=lambda q: 0.0)
    RU = 0.125
    bottom = curve([(0, -0.038), (0.45, -0.035), (0.9, -0.014), (1.3, 0.016), (1.58, 0.042), (1.8, 0.03), (2.1, -0.008), (2.6, -0.03), (math.pi, -0.035)])
    eye = outline([(0.009, 0.116), (0.032, 0.121), (0.058, 0.116), (0.078, 0.102), (0.072, 0.088), (0.05, 0.08), (0.026, 0.074),
                   (0.012, 0.064), (0.0075, 0.056)], 6)
    eye_r = [(-u, v) for u, v in eye]

    def sd(u, v):
        d = max(bottom(abs(u / RU)) - v, v - 0.15)
        mouth = sd_box(u, v, 0.0, -0.002, 0.0105 + 0.005 * smooth(0.06, -0.04, v), 0.064, 0.003)
        return max(d, -min(sd_poly(u, v, eye), sd_poly(u, v, eye_r), mouth))

    def rosette(q):  # embossed over the nose, between the brows
        u, v = angle_of(q, sk.zc) * RU, q.y - 0.131
        r = math.hypot(u, v * 1.2)
        petals = 0.65 + 0.35 * abs(math.cos(3 * math.atan2(v, u)))
        return 0.0022 * smooth(0.012, 0.009, r / petals) + 0.0012 * gauss(r - 0.0125, 0.0012)

    def scroll(q, d):  # the foliage runs in a band inside the bead
        return smooth(0.009, 0.012, d) * smooth(0.028, 0.024, d) * smooth(0.143, 0.137, q.y)
    nose = lambda q: 0.013 * gauss(angle_of(q, sk.zc) * RU, 0.02) * smooth(0.118, 0.088, q.y)
    p.add(bronze, *plate(lambda u, v: sk.point(u / RU, v, -0.0028), sd, -math.pi * RU, math.pi * RU, -0.045, 0.152, periodic=True),
          solid=0.003, roll=0.0011, bump=nose, bead=(0.0062, 0.0016, 0.0016), fine=rosette, deco=scroll)
    p.add(bronze, *strap(sk, [(2 * math.pi * k / 120, 0.142) for k in range(121)], 0.011, 0.0026), forge=hammered(0.0003), deco=lambda q: 0.0)
    # the crest: a bronze holder along the midline, the horsehair standing on it and hanging down behind
    path = midline(sk, 0.205, 0.17, 20)
    foot = [sk.point(a, y, 0.0) for a, y in path]
    ups = [sk.normal(a, y) for a, y in path]
    last, up_last = foot[-1], ups[-1]
    for k, dv in enumerate(((0.0, -0.028, -0.012), (0.0, -0.058, -0.02), (0.0, -0.088, -0.02), (0.0, -0.112, -0.014))):
        foot.append(last + Vector(dv))
        ups.append((up_last + Vector((0.0, -0.25 * (k + 1), 0.0))).normalized())
    m = len(foot)
    holder = [foot[k] + ups[k] * 0.004 for k in range(len(path))]
    p.add(bronze, *crest(holder, ups[:len(path)], [0.008] * len(path), [0.0075] * len(path)), deco=lambda q: 0.0)
    s_ = [k / (m - 1) for k in range(m)]
    heights = [0.036 + 0.046 * math.sin(math.pi * min(1.0, s * 1.35)) ** 0.8 if s < 0.74 else lerp(0.045, 0.014, (s - 0.74) / 0.26) for s in s_]
    widths = [0.022 if s < 0.74 else lerp(0.021, 0.01, (s - 0.74) / 0.26) for s in s_]
    p.add(hair, *crest([foot[k] + ups[k] * 0.009 for k in range(m)], ups, heights, widths), forge=False)
    return p


def infernal_helm():
    """A black-and-white knight's helm: a blackened skull and lower face plate, a polished brow plate swept up into
    points over a polished visor drawn out into a beak and slashed for sight, the lower plate drawn down to a point and
    slashed for breath, polished rolled edges and rows of polished rivets."""
    p = Piece('helm')
    black = mat('blackened', 0x1c1a1a, 'black', rough=0.45, metal=0.7)
    bright = mat('polished', 0xd2d6db, 'steel', rough=0.16, metal=0.95)
    rim = curve([(0, 0.13), (1.0, 0.128), (1.15, 0.0), (1.3, -0.008), (math.pi, -0.012)])
    sk = Skull(yc=0.12, zc=0.01, w=0.11, h=0.136, df=0.122, db=0.118, n=2.3, keel=(0.12, 0.1), keel_from=0.15, rim=rim,
               lower=lambda a, u: 1.0 - 1.8 * u * u + smooth(2.2, 3.0, a) * 1.2 * u * u)
    p.add(black, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0016, roll_mat=bright)
    RU = 0.125
    brow = outline(symmetric([(0.0, 0.232), (0.05, 0.226), (0.1, 0.212), (0.15, 0.192), (0.2, 0.178), (0.175, 0.162), (0.15, 0.156),
                              (0.1, 0.149), (0.05, 0.14), (0.0, 0.127)]), 6)
    p.add(bright, *plate(lambda u, v: sk.point(u / RU, v, 0.0016), lambda u, v: sd_poly(u, v, brow), -0.21, 0.21, 0.12, 0.24),
          solid=0.0022, roll=0.0011, sharp=30)
    for u, v in [(s * x, y) for s in (1, -1) for x, y in ((0.03, 0.142), (0.08, 0.155), (0.13, 0.166), (0.17, 0.175))]:
        p.add(bright, *srivet(sk, u / RU, v + 0.006, 0.0032, 0.0022))
    voff = lambda u, v: 0.0075 + 0.022 * beak(u) * smooth(0.06, 0.1, v) * smooth(0.15, 0.12, v)
    loff = lambda u, v: 0.0045 + 0.017 * beak(u) * smooth(-0.05, 0.03, v)
    visor = outline(symmetric([(0.0, 0.136), (0.06, 0.146), (0.12, 0.152), (0.158, 0.148), (0.162, 0.12), (0.12, 0.1), (0.06, 0.083),
                               (0.0, 0.066)]), 6)
    slashes = [(s * 0.02, 0.094 + 0.016 * k, s * 0.058, 0.108 + 0.016 * k) for s in (1, -1) for k in range(2)]

    def visor_sd(u, v):
        return max(sd_poly(u, v, visor), -min(sd_capsule(u, v, (a, b), (c, d), 0.0028) for a, b, c, d in slashes))
    p.add(bright, *plate(lambda u, v: sk.point(u / RU, v, voff(u, v)), visor_sd, -0.17, 0.17, 0.06, 0.16),
          solid=0.0028, roll=0.0012, roll_min=0.2, sharp=22)
    lower_ = outline(symmetric([(0.0, 0.082), (0.06, 0.095), (0.12, 0.112), (0.16, 0.124), (0.163, 0.06), (0.142, 0.015), (0.09, -0.016),
                                (0.04, -0.036), (0.0, -0.052)]), 6)
    vents = [(s * 0.013, 0.036 - 0.016 * k, s * 0.05, 0.05 - 0.016 * k) for s in (1, -1) for k in range(3)]

    def lower_sd(u, v):
        return max(sd_poly(u, v, lower_), -min(sd_capsule(u, v, (a, b), (c, d), 0.0027) for a, b, c, d in vents))
    p.add(black, *plate(lambda u, v: sk.point(u / RU, v, loff(u, v)), lower_sd, -0.17, 0.17, -0.06, 0.13),
          solid=0.003, roll=0.0013, roll_min=0.2, roll_mat=bright, sharp=22)
    for s in (1, -1):
        a = s * 1.27
        p.add(bright, *srivet(sk, a, 0.118, 0.0062, voff(a * RU, 0.118) + 0.0004, washer=0.0095))
        for u, v in ((0.145, 0.06), (0.13, 0.02), (0.1, -0.006)):
            p.add(bright, *srivet(sk, s * u / RU, v, 0.0034, loff(s * u, v) + 0.0004))
        for u, v in ((0.05, 0.145), (0.1, 0.151)):
            p.add(bright, *srivet(sk, s * u / RU, v - 0.006, 0.003, voff(s * u, v - 0.006) + 0.0003))
    return p


# ---------------------------------------------------------------- finish: bake the dense model onto the light one

TEX = 1024
BUMP = {'steel': 0.25, 'blued': 0.25, 'black': 0.12, 'iron': 0.15, 'enamel': 0.2, 'brass': 0.2, 'gold': 0.2, 'bronze': 0.3,
        'leather': 0.45, 'mail': 1.0, 'hair': 0.8}


def _rgb(hexc):
    c = [((hexc >> s_) & 255) / 255 for s_ in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


class NT:
    """Node-graph helpers over one material's tree, in object space (metres; Blender's Z is up)."""

    def __init__(self, nt):
        self.nt, self.N, self.L = nt, nt.nodes, nt.links.new
        self.obj = self.node('ShaderNodeTexCoord').outputs['Object']

    def node(self, t, **kw):
        n = self.N.new(t)
        for k, v in kw.items():
            if k.startswith('in_'):
                n.inputs[k[3:].replace('_', ' ')].default_value = v
            else:
                setattr(n, k, v)
        return n

    def link(self, src, dst):
        if isinstance(src, (int, float, list, tuple)):
            dst.default_value = src
        else:
            self.L(src, dst)

    def mapped(self, scale, rot=(0, 0, 0), vec=None):
        m = self.node('ShaderNodeMapping')
        m.inputs['Scale'].default_value = scale
        m.inputs['Rotation'].default_value = rot
        self.L(vec if vec is not None else self.obj, m.inputs['Vector'])
        return m.outputs['Vector']

    def noise(self, scale, detail=6.0, rough=0.55, rot=(0, 0, 0)):
        n = self.node('ShaderNodeTexNoise', in_Detail=detail, in_Roughness=rough)
        self.L(self.mapped(scale, rot), n.inputs['Vector'])
        return n.outputs['Fac']

    def voronoi(self, scale, feature='F1', out='Distance'):
        v = self.node('ShaderNodeTexVoronoi', feature=feature)
        self.L(self.mapped(scale), v.inputs['Vector'])
        return v.outputs[out]

    def wave(self, scale, distortion=4.0, detail=2.0, direction='Z', profile='SIN', vec=None):
        w = self.node('ShaderNodeTexWave', wave_type='BANDS', bands_direction=direction, wave_profile=profile, in_Scale=scale,
                      in_Distortion=distortion, in_Detail=detail)
        self.L(vec if vec is not None else self.obj, w.inputs['Vector'])
        return w.outputs['Fac']

    def rng(self, sock, a, b, c, d):
        r = self.node('ShaderNodeMapRange', in_From_Min=a, in_From_Max=b, in_To_Min=c, in_To_Max=d)
        self.L(sock, r.inputs['Value'])
        return r.outputs['Result']

    def math(self, op, a, b=0.0):
        m = self.node('ShaderNodeMath', operation=op)
        self.link(a, m.inputs[0])
        self.link(b, m.inputs[1])
        return m.outputs[0]

    def gray(self, v):
        c = self.node('ShaderNodeCombineColor')
        for i in range(3):
            self.link(v, c.inputs[i])
        return c.outputs['Color']

    def mul(self, a, b):
        m = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
        m.inputs['Factor'].default_value = 1.0
        self.link(a, m.inputs[6])
        self.link(b, m.inputs[7])
        return m.outputs[2]

    def mix(self, a, b, fac):
        m = self.node('ShaderNodeMix', data_type='RGBA', blend_type='MIX')
        self.link(fac, m.inputs['Factor'])
        self.link(a, m.inputs[6])
        self.link(b, m.inputs[7])
        return m.outputs[2]

    def deco(self):
        return self.node('ShaderNodeAttribute', attribute_name='deco').outputs['Fac']

    def ao(self, distance):
        return self.node('ShaderNodeAmbientOcclusion', samples=16, in_Distance=distance).outputs['AO']

    def rings(self, size=0.0042):
        """Mail: rows of interlinked rings round the head (cylindrical coordinates), 1 on a ring, 0 between."""
        sep = self.node('ShaderNodeSeparateXYZ')
        self.L(self.obj, sep.inputs['Vector'])
        ang = self.math('ARCTAN2', sep.outputs['X'], self.math('MULTIPLY', sep.outputs['Y'], -1.0))
        comb = self.node('ShaderNodeCombineXYZ')
        self.link(self.math('MULTIPLY', ang, 0.12), comb.inputs['X'])
        self.L(sep.outputs['Z'], comb.inputs['Y'])
        out = None
        for off in (0.0, 0.5):
            m = self.node('ShaderNodeMapping')
            m.inputs['Location'].default_value = (off * size, off * size, 0.0)
            self.L(comb.outputs['Vector'], m.inputs['Vector'])
            v = self.node('ShaderNodeTexVoronoi', voronoi_dimensions='2D', in_Scale=1.0 / size, in_Randomness=0.0)
            self.L(m.outputs['Vector'], v.inputs['Vector'])
            d = v.outputs['Distance']
            ring = self.math('MULTIPLY', self.rng(d, 0.22, 0.3, 0.0, 1.0), self.rng(d, 0.44, 0.52, 1.0, 0.0))
            out = ring if out is None else self.math('MAXIMUM', out, ring)
        return out

    def strands(self):
        """Horsehair: fine strands across the crest, uneven."""
        return self.math('MULTIPLY', self.wave(260, 3.0, 3.0, 'Y', 'SIN'), self.rng(self.noise((60, 60, 300), 4), 0.3, 0.7, 0.6, 1.0))


def engraving(g, kind):
    """The pattern: 1 on a line, 0 off it."""
    if kind == 'waves':
        return g.rng(g.wave(70, 6, 2, 'Z', 'SIN'), 0.0, 0.12, 1.0, 0.0)
    if kind == 'scales':
        return g.rng(g.voronoi((150, 150, 150), 'DISTANCE_TO_EDGE'), 0.0, 0.06, 1.0, 0.0)
    if kind == 'vines':  # scrolling foliage
        return g.math('MAXIMUM', g.rng(g.wave(45, 12, 4, 'X', 'SIN'), 0.0, 0.14, 1.0, 0.0), g.rng(g.wave(45, 12, 4, 'Z', 'SIN'), 0.0, 0.14, 1.0, 0.0))
    if kind == 'lattice':
        a = g.rng(g.wave(40, 0, 0, 'X', 'SIN', g.mapped((1, 1, 1), (0, 0.785, 0))), 0.0, 0.1, 1.0, 0.0)
        b = g.rng(g.wave(40, 0, 0, 'X', 'SIN', g.mapped((1, 1, 1), (0, -0.785, 0))), 0.0, 0.1, 1.0, 0.0)
        return g.math('MAXIMUM', a, b)
    if kind == 'stitch':  # a row of stitches
        return g.rng(g.voronoi((300, 300, 300)), 0.0, 0.32, 1.0, 0.0)
    return None


def band_of(g, m):
    """Where the engraving shows: the deco mask, sharpened (a line along it for stitches)."""
    if m['engrave'] == 'stitch':
        return g.rng(g.math('ABSOLUTE', g.math('SUBTRACT', g.deco(), 0.5)), 0.0, 0.16, 1.0, 0.0)
    return g.rng(g.deco(), 0.35, 0.65, 0.0, 1.0)


def height(g, m):
    """The relief to bump with (None: smooth)."""
    kind = m['kind']
    h = None
    if kind in ('steel', 'blued', 'gold', 'brass'):
        h = g.math('MULTIPLY', g.noise((260, 10, 10), 2, 0.4), 0.3)  # brushed
    elif kind == 'enamel':
        h = g.math('MULTIPLY', g.noise((40, 40, 40), 2, 0.4), 0.15)  # the paint's slight orange peel
    elif kind in ('black', 'iron'):
        h = g.math('ADD', g.rng(g.voronoi((24, 24, 24)), 0, 0.7, 0, 0.5), g.math('MULTIPLY', g.noise((20, 20, 20), 3), 0.3))  # hammer facets
    elif kind == 'bronze':
        h = g.math('MULTIPLY', g.noise((90, 90, 90), 5, 0.6), 0.4)  # cast and worked, slightly pitted
    elif kind == 'leather':
        h = g.math('ADD', g.noise((150, 150, 150), 8, 0.65), g.math('MULTIPLY', g.noise((18, 18, 18), 3), 0.6))
    elif kind == 'mail':
        h = g.rings(m['ring'])
    elif kind == 'hair':
        h = g.strands()
    e = engraving(g, m['engrave']) if m['engrave'] else None
    if e is not None:
        cut = g.math('MULTIPLY', g.math('MULTIPLY', e, band_of(g, m)), 0.9 if m['emboss'] else -0.6)
        h = cut if h is None else g.math('ADD', h, cut)
    return h


def look(g, m):
    """A material's colour: its finish, engraving, worn edges, grime in the crevices, light from above."""
    kind = m['kind']
    base = _rgb(m['rgb'])
    steelc = _rgb(0x9aa0a6)
    light = [min(1.0, x * 1.6 + 0.06) for x in base[:3]] + [1.0]
    dark = [x * 0.45 for x in base[:3]] + [1.0]
    rgb = g.node('ShaderNodeRGB')
    rgb.outputs[0].default_value = base
    c = rgb.outputs[0]
    if kind in ('steel', 'blued', 'gold', 'brass', 'enamel', 'black', 'iron', 'bronze'):
        if kind != 'enamel':
            c = g.mix(c, light, g.rng(g.noise((260, 10, 10), 2, 0.4), 0.55, 0.7, 0.0, 0.12))  # brush marks
        c = g.mix(c, dark, g.rng(g.noise((14, 14, 14), 4), 0.45, 0.72, 0.0, 0.3))  # tarnish and grime
        if kind == 'blued':
            c = g.mix(c, _rgb(0x3a2a52), g.rng(g.noise((6, 6, 6), 2), 0.4, 0.7, 0.0, 0.35))  # the bluing's purple sheen
        if kind in ('black', 'iron'):
            c = g.mix(c, dark, g.rng(g.voronoi((40, 40, 40)), 0.0, 0.7, 0.4, 0.0))  # hammer marks
        if kind == 'brass':
            c = g.mix(c, _rgb(0x4a5a30), g.rng(g.noise((40, 40, 40), 3), 0.62, 0.75, 0.0, 0.2))  # verdigris in spots
        if kind == 'bronze':  # the patina: green in the hollows and in patches, the bronze showing where it is handled
            green = _rgb(0x3f8a66)
            hollow = g.rng(g.ao(0.012), 0.62, 0.95, 0.9, 0.0)
            patch = g.rng(g.noise((18, 18, 18), 4, 0.55), 0.5, 0.66, 0.0, 0.55)
            c = g.mix(c, green, g.math('MINIMUM', g.math('ADD', hollow, patch), 0.85))
            c = g.mix(c, _rgb(0x5e3a1c), g.rng(g.noise((60, 60, 60), 3), 0.5, 0.7, 0.0, 0.3))
    elif kind == 'leather':
        c = g.mix(c, dark, g.rng(g.noise((150, 150, 150), 8, 0.65), 0.35, 0.7, 0.35, 0.0))
        c = g.mix(c, light, g.rng(g.noise((18, 18, 18), 3), 0.55, 0.75, 0.0, 0.22))
    elif kind == 'mail':
        c = g.mix([0.03, 0.03, 0.035, 1.0], c, g.rings(m['ring']))  # the dark between the rings
    elif kind == 'hair':
        c = g.mix([x * 0.3 for x in base[:3]] + [1.0], light, g.math('POWER', g.strands(), 1.5))
    e = engraving(g, m['engrave']) if m['engrave'] else None
    if e is not None:
        band = band_of(g, m)
        if m['engrave'] == 'stitch':
            c = g.mix(c, [x * 0.35 for x in base[:3]] + [1.0], g.math('MULTIPLY', e, band))
        elif m['emboss']:  # raised and polished, the ground between sunk and dark
            c = g.mix(c, [x * 0.6 for x in base[:3]] + [1.0], g.math('MULTIPLY', band, g.math('SUBTRACT', 1.0, e)))
            c = g.mix(c, light, g.math('MULTIPLY', g.math('MULTIPLY', e, band), 0.45))
        else:
            if m['engrave_rgb'] >= 0:  # gilt: the band gilded, the pattern etched dark into the gilding
                gc = _rgb(m['engrave_rgb'])
                c = g.mix(c, g.mix(gc, [x * 0.8 for x in gc[:3]] + [1.0], g.noise((60, 60, 60), 3)), band)
                c = g.mix(c, [x * 0.3 for x in gc[:3]] + [1.0], g.math('MULTIPLY', e, band))
            else:
                c = g.mix(c, dark, g.math('MULTIPLY', g.math('MULTIPLY', e, band), 0.8))
            line = g.rng(g.math('ABSOLUTE', g.math('SUBTRACT', g.deco(), 0.5)), 0.0, 0.12, 0.75, 0.0)
            c = g.mix(c, [0.02, 0.018, 0.015, 1.0], line)
    if kind == 'inner':
        return c
    geo = g.node('ShaderNodeNewGeometry')
    edge = g.rng(geo.outputs['Pointiness'], 0.53, 0.6, 0.0, 1.0)
    if kind == 'enamel':
        chips = g.math('MULTIPLY', edge, g.rng(g.noise((90, 90, 90), 4), 0.4, 0.55, 0.0, 1.0))
        c = g.mix(c, steelc, g.math('MINIMUM', chips, 0.9))  # the paint chipped off the edges
    elif kind in ('black', 'iron'):
        c = g.mix(c, _rgb(0x7a6a58), g.math('MULTIPLY', edge, 0.5))  # worn to bare, heat-tinted steel
    elif kind == 'bronze':
        c = g.mix(c, _rgb(0xd09a5a), g.math('MULTIPLY', edge, 0.7))  # rubbed bright on the edges
    elif kind not in ('mail', 'hair'):
        c = g.mix(c, light, g.math('MULTIPLY', edge, 0.5))
    c = g.mul(c, g.gray(g.rng(g.ao(0.03), 0.0, 1.0, 0.45, 1.0)))
    sep = g.node('ShaderNodeSeparateXYZ')
    g.L(g.obj, sep.inputs['Vector'])
    return g.mul(c, g.gray(g.rng(sep.outputs['Z'], -0.08, 0.32, 0.75, 1.05)))


def select(*objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[-1]


def finish(hi, lo, name):
    """Bake the dense model's colour and relief onto the light one (unwrapped with the insides and the plain parts left
    out) and give it the game's materials, carrying what each is made of for the client."""
    sc = bpy.context.scene
    select(hi)
    bev = hi.modifiers.new('bevel', 'BEVEL')
    bev.width, bev.segments, bev.limit_method, bev.angle_limit = 0.0008, 2, 'ANGLE', math.radians(50)
    bpy.ops.object.modifier_apply(modifier='bevel')
    hi.name = name + '_hi'
    lo.name = lo.data.name = name
    select(lo)
    wn = lo.modifiers.new('wn', 'WEIGHTED_NORMAL')
    wn.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier='wn')
    olds = list(lo.data.materials)
    skip = [i for i, m in enumerate(olds) if m['kind'] == 'inner' or m.get('plain')]
    for poly in lo.data.polygons:
        poly.select = poly.material_index not in skip
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    uv = lo.data.uv_layers.active.data
    for poly in lo.data.polygons:
        if poly.material_index in skip:
            for li in poly.loop_indices:
                uv[li].uv = (0.0005, 0.0005)
    col_img = bpy.data.images.new(f'{name}_color', TEX, TEX, alpha=False)
    nor_img = bpy.data.images.new(f'{name}_normal', TEX, TEX, alpha=False)
    nor_img.colorspace_settings.name = 'Non-Color'
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    mats = set(olds) | set(hi.data.materials)

    def prep(target, surface):
        for m in mats:
            nt = m.node_tree
            for n in list(nt.nodes):
                if n.type != 'OUTPUT_MATERIAL':
                    nt.nodes.remove(n)
            g = NT(nt)
            nt.links.new(surface(g, m), nt.nodes['Material Output'].inputs['Surface'])
            tn = nt.nodes.new('ShaderNodeTexImage')
            tn.image = target
            nt.nodes.active = tn

    def relief(g, m):
        bsdf = g.node('ShaderNodeBsdfDiffuse')
        h = height(g, m)
        if h is not None:
            bump = g.node('ShaderNodeBump', in_Strength=BUMP.get(m['kind'], 0.3), in_Distance=0.003)
            g.L(h, bump.inputs['Height'])
            g.L(bump.outputs['Normal'], bsdf.inputs['Normal'])
        return bsdf.outputs['BSDF']

    def colour(g, m):
        em = g.node('ShaderNodeEmission')
        g.L(look(g, m), em.inputs['Color'])
        return em.outputs['Emission']

    bake = dict(use_selected_to_active=True, cage_extrusion=0.003, max_ray_distance=0.02, margin=6)
    prep(nor_img, relief)
    select(hi, lo, active=lo)
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', **bake)
    prep(col_img, colour)
    bpy.ops.object.bake(type='EMIT', **bake)
    if PREVIEW:  # keep the maps to look at
        for img in (col_img, nor_img):
            img.filepath_raw = os.path.join(PREVIEW, f'{img.name}.png')
            img.file_format = 'PNG'
            img.save()
    bpy.data.objects.remove(hi)
    for i, m in enumerate(olds):
        f = bpy.data.materials.new(m.name + '_baked')
        f.use_nodes = True
        for k in ('kind', 'rgb', 'rough', 'metal'):
            f[k] = m[k]
        nt = f.node_tree
        bsdf = nt.nodes['Principled BSDF']
        bsdf.inputs['Roughness'].default_value = m['rough']
        bsdf.inputs['Metallic'].default_value = m['metal']
        if i in skip:
            bsdf.inputs['Base Color'].default_value = _rgb(m['rgb'])
        else:
            tn = nt.nodes.new('ShaderNodeTexImage')
            tn.image = nor_img
            nm = nt.nodes.new('ShaderNodeNormalMap')
            nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
            nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
            tc = nt.nodes.new('ShaderNodeTexImage')
            tc.image = col_img
            nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
            nt.nodes.active = tc
        lo.data.materials[i] = f
    return lo


# ---------------------------------------------------------------- previews on the head

def preview(ob, set_id):
    """Front, three-quarter, side and back views of the piece on the real head (Workbench), where the head pokes out
    through the piece and where the piece cuts into the head or shoulders."""
    sc = bpy.context.scene
    if HEAD and os.path.exists(HEAD):
        d = json.load(open(HEAD))
        me = bpy.data.meshes.new('mannequin')
        me.from_pydata([B(v) for v in d['v']], [], [tuple(f) for f in d['f']])
        for poly in me.polygons:
            poly.use_smooth = True
        skin = bpy.data.materials.new('skin')
        skin.diffuse_color = (0.7, 0.5, 0.4, 1.0)
        me.materials.append(skin)
        man = bpy.data.objects.new('mannequin', me)
        sc.collection.objects.link(man)
        deps = bpy.context.evaluated_depsgraph_get()
        piece, body = BVHTree.FromObject(ob, deps), BVHTree.FromObject(man, deps)
        c = B(HEAD_C)
        pokes = []
        for v in d['v']:
            if v[1] < 0.0 or abs(v[0]) > 0.1:
                continue
            q = B(v)
            dv = q - c
            hit = piece.ray_cast(c, dv.normalized(), dv.length)
            if hit[0] is not None:
                pokes.append((dv.length - hit[3], v))
        pokes.sort(reverse=True)
        cuts = []
        for vert in ob.data.vertices:
            q = vert.co
            dv = q - c
            if dv.length < 1e-6 or body.ray_cast(c, dv.normalized(), dv.length)[0] is not None:
                continue
            near = body.find_nearest(q)
            if near[0] is not None and near[3] > 0.001:
                cuts.append((near[3], tuple(round(x, 3) for x in G(q))))
        cuts.sort(reverse=True)
        where = ' '.join(f'({x:.3f},{y:.3f},{z:.3f})' for _, (x, y, z) in pokes[:3])
        print(f'[gear] {set_id}: {len(pokes)} head points poke out (worst {pokes[0][0] * 1000 if pokes else 0:.1f} mm) {where}')
        print(f'[gear] {set_id}: {len(cuts)} piece points inside the body (deepest {cuts[0][0] * 1000 if cuts else 0:.1f} mm) '
              + ' '.join(str(q) for _, q in cuts[:4]))
    for m in bpy.data.materials:
        if m.get('rgb') is not None:
            m.diffuse_color = _rgb(m['rgb'])
    world = bpy.data.worlds.new('w')
    world.color = (0.05, 0.06, 0.08)
    sc.world = world
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL' if FAST else 'TEXTURE'
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_specular_highlight = True
    sc.render.resolution_x = sc.render.resolution_y = 440
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 85
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = B((0.0, 0.135, 0.0))
    for name, deg, el in (('a', 0, 6), ('b', 40, 12), ('c', 90, 4), ('d', 150, 14)):
        az, e = math.radians(deg), math.radians(el)
        cam.location = B((1.15 * math.sin(az) * math.cos(e), 0.135 + 1.15 * math.sin(e), 1.15 * math.cos(az) * math.cos(e)))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'{set_id}_{name}.png')
        bpy.ops.render.render(write_still=True)


SETS = {
    'apprentice': {'helm': apprentice_helm},
    'abyssal': {'helm': abyssal_helm},
    'ashforged': {'helm': ashforged_helm},
    'dragon': {'helm': dragon_helm},
    'glacial': {'helm': glacial_helm},
    'emerald': {'helm': emerald_helm},
    'infernal': {'helm': infernal_helm},
}


def tris(ob):
    return sum(len(p_.vertices) - 2 for p_ in ob.data.polygons)


def run(set_id, pieces):
    global RES
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    objs = []
    for name, fn in pieces.items():
        RES = 1.0
        hi = fn().build()
        dense = tris(hi)
        if FAST:
            ob = hi
        else:
            RES = LIGHT
            lo = fn().build()
            RES = 1.0
            ob = finish(hi, lo, name)
        objs.append(ob)
        print(f'[gear] {set_id}.{name}: {dense} tris dense, {tris(ob)} for the game')
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        preview(objs[0], set_id)
        return
    select(*objs)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{set_id}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='WEBP',
                              export_extras=True)
    print(f'[gear] {set_id}: {", ".join(pieces)} -> {path} ({os.path.getsize(path) // 1024} KB)')


for set_id, pieces in SETS.items():
    if not ONLY or set_id in ONLY.split(','):
        run(set_id, pieces)
