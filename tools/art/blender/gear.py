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
BUDGET = {'helm': 8000, 'chest': 12000, 'gloves': 5000, 'legs': 5000, 'feet': 5000, 'shield': 4000, 'blade': 3000, 'staff': 3500, 'robe': 12000,
          'circlet': 4000}  # the triangles each piece may have in the game
PART = os.environ.get('GEAR_PART', '')  # only these pieces of each set (helm, chest, gloves, legs, feet, shield)
ZOOM = os.environ.get('GEAR_ZOOM', '')  # body previews closer in: "height,width" in metres (0.85,0.6 frames the hips), or "x,height,width"

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


def mat(name, color, kind, engrave=None, engrave_color=None, rough=0.55, metal=0.0, emboss=False, ring=0.0042, bump=-1.0, frost=0.0,
        trim=-1, sheen=-1, gloss=-1.0, scale=0.085, panels=False):
    """A colour (sRGB hex) and what it is made of (kind: steel, blued, black, iron, enamel, brass, gold, bronze, leather,
    mail, hair, fur, ice, cloth); `engrave` puts a pattern (waves, scales, vines, lattice, stitch, frost) wherever the
    part's deco mask allows: etched in dark lines, gilt (engrave_color) or, with emboss, raised in relief; ring: a mail
    ring's size; bump: how strong its relief is (else its kind's); frost: how much rime has grown on it (0..1), white
    on its edges, on the faces turned up and in the hollows; trim: a polished metal (sRGB hex) bordering it wherever
    the deco mask is low, standing a little proud, etched; sheen: a second colour its lacquer shifts to in broad
    patches and on the crowns of its scales, as a beetle's shell does; gloss: how much it shines (else by its kind);
    scale: how big its scales are (metres to four of them; a scrollwork panel's width); panels: its deco mask in three -
    the trim along the edges (0), the plain material (0.5), its engraving (1) - for plates only partly ornamented."""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m['kind'], m['rgb'], m['rough'], m['metal'] = kind, color, rough, metal
    m['engrave'] = engrave or ''
    m['engrave_rgb'] = engrave_color if engrave_color is not None else -1
    m['emboss'], m['ring'], m['bump'], m['frost'] = int(emboss), ring, bump, frost
    m['trim'], m['sheen'], m['gloss'], m['scale'], m['panels'] = trim, sheen, gloss, scale, int(panels)
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
        for k in ('frost', 'sheen', 'gloss'):
            if k in m:
                q[k] = m[k]
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
        self.rules = [None]  # skin rules, by index: none (a rigid piece, the helmet), bones, or a function
        self.min_ratio = 0.05  # how far the game's copy may thin its plates
        self.centre = HEAD_C  # what a rigid piece's open sheets face away from (a helmet's: the head's middle)
        self.budget = BUDGET.get(name, 8000)
        self.tex = None  # its maps' size (else TEX, the cuirass twice that)

    def add(self, material, verts, faces, solid=0.0, roll=0.0, roll_min=0.0, roll_mat=None, rope=False, bump=None,
            fine=None, forge=None, bead=None, deco=None, sharp=40, skin=None, whole=False, wound=False):
        """solid: thickness (inwards); roll: how far a rolled edge stands out of the plate, along every edge loop longer
        than roll_min metres, in roll_mat (rope: twisted like a cable); bump(p) -> metres to push each point out, fine
        the same for detail only the dense model gets; forge: the surface work (default: hammered, for metal plates);
        bead=(inset, height, width): a raised bead running that far inside every edge; deco: where the material's
        engraving shows - a function p -> 0..1 or (p, distance to the nearest edge) -> 0..1, a width (a border that wide
        along the outer edges) or (width, function); sharp: edges sharper than this many degrees stay sharp; skin: the
        bones a body piece follows - a tuple of names (weights taken from the body under it, kept to those bones) or a
        function p -> {bone: weight}; whole: the game's copy keeps it as built, unthinned (lumpy, strongly curved parts
        the thinning would pull away from the dense model, so the bake would miss them); wound: its faces already face
        out (taken from the body's own mesh, a glove) - turning them by the part's majority would turn some inwards,
        and those the game does not draw."""
        if skin not in self.rules:
            self.rules.append(skin)
        self.parts.append(dict(material=material, verts=verts, faces=faces, solid=solid, roll=roll, roll_min=roll_min,
                               roll_mat=roll_mat, rope=rope, bump=bump, fine=fine, forge=forge, bead=bead, deco=deco,
                               sharp=sharp, rule=self.rules.index(skin), whole=whole, wound=wound))
        return self

    def build(self, join=True):
        """The piece as one object, or (join=False) as its parts' objects, each marked with the part it is ('part'):
        the bake takes each part from its own dense copy."""
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
            if not P['wound']:
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            is_open = any(e.is_boundary for e in bm.edges)
            if is_open and bm.faces and not P['wound']:  # an open sheet faces away from the head, or a body piece from the body under it
                if P['rule']:
                    kd = body()['kd']
                    out = sum((f.calc_center_median() - B(kd.find(G(f.calc_center_median()))[0])).dot(f.normal) * f.calc_area() for f in bm.faces)
                else:
                    ref = B(self.centre)
                    out = sum((f.calc_center_median() - ref).dot(f.normal) * f.calc_area() for f in bm.faces)
                if out < 0:
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
            if P['roll'] and is_open and RES <= 1:  # the game's copy gets its rolled edges from the bake
                for lp, L in zip(loops, lens):
                    if L < P['roll_min']:
                        continue
                    pts = [v.co - v.normal * (P['solid'] / 2) for v in lp]
                    rope = P['rope'] and RES <= 1
                    pts, _ = resample(pts, 0.0021 if rope else (0.0035 if RES <= 1 else 0.009), closed=True)
                    for _ in range(2 if rope else 2):
                        pts = [(pts[k - 1] + pts[k] * 2 + pts[(k + 1) % len(pts)]) / 4 for k in range(len(pts))]
                    r = P['solid'] / 2 + P['roll']
                    seg = 12 if rope else (8 if RES <= 1 else 5)
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
            ob = self._object(me, plain(material) if small else material, inside(material), dvals, P['rule'])
            if P['solid']:
                mod = ob.modifiers.new('sol', 'SOLIDIFY')
                mod.thickness, mod.offset, mod.use_rim, mod.use_even_offset = P['solid'], -1.0, True, False
                mod.use_quality_normals = True
                mod.material_offset, mod.material_offset_rim = 1, (1 if rolls else 0)  # a rolled edge hides the rim
                bpy.ops.object.modifier_apply(modifier='sol')
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(P['sharp']))
            ob['thin'] = bool(P['solid']) and not small and not P['whole']
            ob['part'] = i
            objs.append(ob)
            for rv, rf in rolls:
                rme = bpy.data.meshes.new(f'{self.name}_{i}_roll')
                rme.from_pydata(rv, [], rf)
                for poly in rme.polygons:
                    poly.use_smooth = True
                rm = P['roll_mat'] or material
                ro = self._object(rme, rm if P['rope'] else plain(rm), inside(material), [0.0] * len(rv), P['rule'])
                ro['part'] = i
                objs.append(ro)
        if RES > 1:  # the game's copy: thin the plates down to the budget (rolled edges and small parts stay whole)
            count = lambda o: sum(len(p_.vertices) - 2 for p_ in o.data.polygons)
            thin = [o for o in objs if o.get('thin')]
            fixed = sum(count(o) for o in objs if not o.get('thin'))
            counts = [count(o) for o in thin]
            floor = 120  # every plate keeps this many: a small lame wrapped round an arm thinned further leaves the dense one
            lo_r, hi_r = 0.0, 1.0
            for _ in range(30):
                r = (lo_r + hi_r) / 2
                if sum(max(min(c, floor), r * c) for c in counts) > self.budget - fixed:
                    hi_r = r
                else:
                    lo_r = r
            ratio = clamp(lo_r, self.min_ratio, 1.0)
            if os.environ.get('GEAR_COUNT'):  # where the triangles go
                kinds = {}
                for o in objs:
                    k = 'thin' if o.get('thin') else ('roll' if o.name.endswith('_roll') else 'detail')
                    kinds[k] = kinds.get(k, 0) + count(o)
                print(f'[gear] {self.name}: {kinds}, ratio {ratio:.2f}')
            for o, c in zip(thin, counts):
                r = max(ratio, min(1.0, floor / max(1, c)))
                if r < 1.0:
                    select(o)
                    dec = o.modifiers.new('dec', 'DECIMATE')
                    dec.ratio = r
                    bpy.ops.object.modifier_apply(modifier='dec')
        bpy.ops.object.select_all(action='DESELECT')
        if not join:
            return objs
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = ob.data.name = self.name
        return ob

    def _object(self, me, material, inner, dvals, rule=0):
        me.materials.append(material)
        me.materials.append(inner)
        attr = me.color_attributes.new('deco', 'FLOAT_COLOR', 'POINT')
        for k in range(len(me.vertices)):
            d = dvals[k] if dvals is not None else 1.0
            attr.data[k].color = (d, d, d, 1.0)
        me.attributes.new('rule', 'INT', 'POINT').data.foreach_set('value', [rule] * len(me.vertices))
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

    def around(self, a, y):
        """How far from the axis the surface is (to turn a width into an angle)."""
        q = self.at(a, y)
        return math.hypot(q.x, q.z - self.zc)

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
            t = 0.12 if t < 0.12 else 0.88 if t > 0.88 else t
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
            da = width / 2 / max(0.012, sk.around(a, y))
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


# ---------------------------------------------------------------- the body under the armour

_bodies = {}


def body(g='m'):
    """The reference body (tools/art/blender/body/, dumped from the game by dump.js): the character in its bind pose in
    the peasant kit armour goes over, each vertex with its skin joints and weights, and a tree to find the nearest."""
    if g not in _bodies:
        import gzip
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'body', ('male' if g == 'm' else 'female') + '.json.gz')
        with gzip.open(path, 'rt', encoding='utf-8') as fh:
            d = json.load(fh)
        d['V'] = [Vector(v) for v in d['v']]
        d['bone_of'] = [d['names'][k] for k in d['b']]
        d['mesh_of'] = [d['meshes'][k] for k in d['m']] if 'm' in d else [''] * len(d['v'])
        kd = KDTree(len(d['V']))
        for i, v in enumerate(d['V']):
            kd.insert(v, i)
        kd.balance()
        d['kd'] = kd
        _bodies[g] = d
    return _bodies[g]


def bone(name, g='m'):
    """A bone's pivot in the bind pose."""
    return Vector(body(g)['bones'][name])


def hull(points):
    """The convex hull of 2D points (monotone chain), counter-clockwise."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for q in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], q) <= 0:
            lower.pop()
        lower.append(q)
    for q in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], q) <= 0:
            upper.pop()
        upper.append(q)
    return lower[:-1] + upper[:-1]


def ray_hull(poly, a):
    """How far from the origin a ray at angle a leaves a convex polygon round it."""
    dx, dy = math.cos(a), math.sin(a)
    best = 0.0
    n = len(poly)
    for i in range(n):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % n]
        ex, ey = x2 - x1, y2 - y1
        den = dx * ey - dy * ex
        if abs(den) < 1e-12:
            continue
        t = (x1 * ey - y1 * ex) / den
        s_ = (x1 * dy - y1 * dx) / den
        if t > 0 and -1e-9 <= s_ <= 1 + 1e-9:
            best = max(best, t)
    return best


class Fit:
    """A form fitted round part of the body: along an axis from o in direction d, at a distance t along it, the section
    reaches as far as the body does there (the vertices of `bones` that `keep` accepts, leaving out the kit pieces named
    in `skip`, or keeping only those in `only`) plus `gap`, its outline made convex and smoothed along the axis without
    shrinking, so a plate cut from it
    clears the body and reads as one forged surface; `ends` = (start, stop) rounds it off to a point before start and
    after stop (a toe, a heel). Angles start at `up` and turn towards d x up. The skin's own mesh holds the whole bare
    body, so with the boots skipped a fit follows the real shin and foot."""

    def __init__(self, bones, o, d, up, t0, t1, gap=0.01, keep=None, na=72, nt=40, smooth_t=5, smooth_a=3, skip=(), only=(), ends=None, g='m'):
        bd = body(g)
        self.o, self.d = Vector(o), Vector(d).normalized()
        self.up = (Vector(up) - self.d * Vector(up).dot(self.d)).normalized()
        self.side = self.d.cross(self.up)
        self.t0, self.t1, self.na, self.nt = t0, t1, na, nt
        rows = [[] for _ in range(nt + 1)]
        span = (t1 - t0) / nt
        for v, bn, mn in zip(bd['V'], bd['bone_of'], bd['mesh_of']):
            if bn not in bones or (keep and not keep(v)) or any(k in mn for k in skip) or (only and not any(k in mn for k in only)):
                continue
            rel = v - self.o
            t = rel.dot(self.d)
            k = int(round((t - t0) / span))
            if k < -1 or k > nt + 1:
                continue
            q = rel - self.d * t
            pt = (q.dot(self.up), q.dot(self.side))
            for kk in (k - 1, k, k + 1):  # each vertex counts for its row and the two beside it
                if 0 <= kk <= nt:
                    rows[kk].append(pt)
        R = []
        for pts in rows:
            if len(pts) < 3:
                R.append(None)
                continue
            poly = hull(pts)
            R.append([ray_hull(poly, 2 * math.pi * i / na) for i in range(na)])
        filled = [i for i, r in enumerate(R) if r]
        if not filled:
            raise ValueError(f'no body for {bones}')
        R = [r if r else list(R[min(filled, key=lambda f: abs(f - i))]) for i, r in enumerate(R)]
        n = len(R)
        for _ in range(smooth_t):  # the largest of each row and its neighbours, then averaged: smooth, never smaller
            M = [[max(R[j][i] for j in range(max(0, k - 1), min(n, k + 2))) for i in range(na)] for k in range(n)]
            R = [[(M[max(0, k - 1)][i] + 2 * M[k][i] + M[min(n - 1, k + 1)][i]) / 4 for i in range(na)] for k in range(n)]
        for _ in range(smooth_a):  # the same round each section
            M = [[max(row[(i - 1) % na], row[i], row[(i + 1) % na]) for i in range(na)] for row in R]
            R = [[(row[(i - 1) % na] + 2 * row[i] + row[(i + 1) % na]) / 4 for i in range(na)] for row in M]
        self.R = [[r + gap for r in row] for row in R]
        self.ends = ends

    def radius(self, a, t):
        r = self.raw(a, t)
        if self.ends:
            start, stop = self.ends
            if t < start:
                r *= math.sqrt(max(0.0, 1.0 - ((start - t) / (start - self.t0)) ** 2))
            elif t > stop:
                r *= math.sqrt(max(0.0, 1.0 - ((t - stop) / (self.t1 - stop)) ** 2))
        return r

    def raw(self, a, t):
        f = clamp((t - self.t0) / (self.t1 - self.t0), 0.0, 1.0) * self.nt
        k = min(int(f), self.nt - 1)
        ft = f - k
        x = (a % (2 * math.pi)) / (2 * math.pi) * self.na
        i = int(x) % self.na
        fa = x - int(x)
        i2 = (i + 1) % self.na
        row0, row1 = self.R[k], self.R[k + 1]
        return lerp(lerp(row0[i], row0[i2], fa), lerp(row1[i], row1[i2], fa), ft)

    def around(self, a, t):
        return self.radius(a, t)

    def at(self, a, t):
        return self.o + self.d * t + (self.up * math.cos(a) + self.side * math.sin(a)) * self.radius(a, t)

    def normal(self, a, t):
        e = 1e-3
        n = (self.at(a + e, t) - self.at(a - e, t)).cross(self.at(a, t + e) - self.at(a, t - e))
        radial = self.up * math.cos(a) + self.side * math.sin(a)
        if n.length < 1e-12:
            return radial
        n.normalize()
        return n if n.dot(radial) >= 0 else -n

    def point(self, a, t, off=0.0):
        return self.at(a, t) + self.normal(a, t) * off


class Cone:
    """A smooth elliptic cone round a vertical axis (a gorget's form): at height t, half-width rx and reach rz forward
    and back of z = zc, both going linearly from (rx0, rz0) at t0 to (rx1, rz1) at t1."""

    def __init__(self, zc, t0, rx0, rz0, t1, rx1, rz1):
        self.zc, self.t0, self.t1, self.r0, self.r1 = zc, t0, t1, (rx0, rz0), (rx1, rz1)

    def at(self, a, t):
        f = (t - self.t0) / (self.t1 - self.t0)
        rx, rz = lerp(self.r0[0], self.r1[0], f), lerp(self.r0[1], self.r1[1], f)
        return Vector((rx * math.sin(a), t, self.zc + rz * math.cos(a)))

    def normal(self, a, t):
        e = 1e-3
        n = (self.at(a + e, t) - self.at(a - e, t)).cross(self.at(a, t + e) - self.at(a, t - e))
        radial = Vector((math.sin(a), 0.0, math.cos(a)))
        n.normalize()
        return n if n.dot(radial) >= 0 else -n

    def point(self, a, t, off=0.0):
        return self.at(a, t) + self.normal(a, t) * off

    def around(self, a, t):
        q = self.at(a, t)
        return math.hypot(q.x, q.z - self.zc)


def transfer(p, allowed, bd, n=12):
    """The weights of the body under a point, kept to the allowed bones: the nearest body vertices' weights, blended
    by distance (the nearest allowed bone if none of them follows one)."""
    acc = {}
    for _, i, d in bd['kd'].find_n(p, n):
        k = 1.0 / (d + 0.006) ** 2
        for jj, ww in zip(bd['j'][i], bd['w'][i]):
            name = bd['joints'][jj]
            if ww > 0 and name in allowed:
                acc[name] = acc.get(name, 0.0) + ww * k
    if not acc:
        acc = {min(allowed, key=lambda b: (bone(b) - p).length): 1.0}
    return acc


def skin_weights(ob, rules, g='m'):
    """Each vertex's four joints and weights by its part's rule, as the _joints and _weights attributes the client binds
    the piece with (joint numbers in the order the object's `joints` lists)."""
    bd = body(g)
    joints = bd['joints']
    jix = {name: i for i, name in enumerate(joints)}
    me = ob.data
    rule = [0] * len(me.vertices)
    if 'rule' in me.attributes:
        me.attributes['rule'].data.foreach_get('value', rule)
    J, W = [], []
    for k, v in enumerate(me.vertices):
        r = rules[rule[k]] if rule[k] < len(rules) else None
        p = G(v.co)
        weights = {} if r is None else (r(p) if callable(r) else transfer(p, r, bd))
        top = sorted(weights.items(), key=lambda kv: -kv[1])[:4]
        total = sum(w for _, w in top) or 1.0
        js = [float(jix[name]) for name, _ in top] + [0.0] * (4 - len(top))
        ws = [w / total for _, w in top] + [0.0] * (4 - len(top))
        J += js
        W += ws
    for name, data in (('_joints', J), ('_weights', W)):
        a = me.attributes.new(name, 'FLOAT_COLOR', 'POINT')
        a.data.foreach_set('color', data)
    ob['joints'] = list(joints)


def swap(rule):
    """A left side's rule for the right side."""
    if rule is None:
        return None
    if callable(rule):
        return lambda p, r=rule: {k.replace('_l', '_R').replace('_r', '_l').replace('_R', '_r'): w
                                  for k, w in r(Vector((-p.x, p.y, p.z))).items()}
    return tuple(n[:-2] + ('_r' if n.endswith('_l') else '_l') if n.endswith(('_l', '_r')) else n for n in rule)


def both(p, material, mesh, skin, **kw):
    """A left-side part and its mirror on the right."""
    v, f = mesh
    p.add(material, v, f, skin=skin, **kw)
    mv, mf = mirror(v, f)
    flip = lambda q: Vector((-q.x, q.y, q.z))

    def one(fn):  # closures, not default arguments: the deco is told apart by how many arguments it takes
        return lambda q: fn(flip(q))

    def two(fn):
        return lambda q, d: fn(flip(q), d)
    for k in ('bump', 'fine', 'forge'):
        if callable(kw.get(k)):
            kw[k] = one(kw[k])
    deco = kw.get('deco')
    if callable(deco):
        kw['deco'] = two(deco) if deco.__code__.co_argcount == 2 else one(deco)
    elif isinstance(deco, tuple):
        kw['deco'] = (deco[0], one(deco[1]))
    p.add(material, mv, mf, skin=swap(skin), **kw)


def preview_body(objs, set_id):
    """The body pieces on the whole reference body: front, three-quarter, side and back, and where they cut into it."""
    sc = bpy.context.scene
    bd = body('m')
    me = bpy.data.meshes.new('mannequin')
    me.from_pydata([B(v) for v in bd['v']], [], [tuple(f) for f in bd['f']])
    for poly in me.polygons:
        poly.use_smooth = True
    skin = bpy.data.materials.new('skin')
    skin.diffuse_color = (0.55, 0.5, 0.45, 1.0)
    me.materials.append(skin)
    man = bpy.data.objects.new('mannequin', me)
    sc.collection.objects.link(man)
    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(man, deps)
    for ob in objs:
        cuts = []
        for vert in ob.data.vertices:
            near = tree.find_nearest(vert.co)
            if near[0] is not None and (vert.co - near[0]).dot(near[1]) < 0 and near[3] > 0.002:
                cuts.append((near[3], tuple(round(x, 3) for x in G(vert.co))))
        cuts.sort(reverse=True)
        print(f'[gear] {set_id}.{ob.name}: {len(cuts)} points inside the body (deepest {cuts[0][0] * 1000 if cuts else 0:.1f} mm) '
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
    sc.render.resolution_x, sc.render.resolution_y = 520, 760
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    zv = [float(x) for x in ZOOM.split(',')] if ZOOM else [0.92, 2.05]
    zx, zy, zw = zv if len(zv) == 3 else [0.0] + zv
    cam.data.ortho_scale = zw
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = B((zx, zy, 0.0))
    for name, deg, el in (('a', 0, 4), ('b', 40, 8), ('c', 90, 2), ('d', 155, 8)):
        el = float(os.environ.get('GEAR_ELEV', el))  # from above: a shield faces up in the rest pose
        az, e = math.radians(deg), math.radians(el)
        cam.location = B((zx + 4 * math.sin(az) * math.cos(e), zy + 4 * math.sin(e), 4 * math.cos(az) * math.cos(e)))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'{set_id}_body_{name}.png')
        bpy.ops.render.render(write_still=True)


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
    """A barbute, the deep Italian helmet of the fifteenth century: a close bowl coming down over the cheeks and the
    nape, leaving a Y-shaped opening for the eyes and mouth, with a fish's fin raised along its crest and curved slits for
    breath on the cheeks like gills; steel blued near black, etched with waves in a pale blue along every edge, the fin
    lacquered an ocean blue, a band of pale steel where the bowl meets the face, and rosette rivets."""
    p = Piece('helm')
    blued, accent, gilt = abyssal_mats()

    def lower(a, u):  # close over the cheeks and jaw, a little flare over the nape
        side = smooth(0.4, 1.4, a) * (1 - smooth(1.8, 2.5, a))
        return 1.0 - (1.2 + 2.6 * side) * u * u * (1 - smooth(1.8, 2.6, a)) + smooth(2.0, 2.9, a) * 0.3 * (u / 0.16) ** 1.8
    sk = Skull(yc=0.13, zc=0.006, w=0.11, h=0.134, df=0.122, db=0.12, n=2.2, keel=(0.08, 0.1), keel_from=0.17, rim=0.142, lower=lower)
    p.add(blued, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.003, deco=lambda q: 0.0)
    RU = 0.125
    bottom = curve([(0, -0.03), (0.6, -0.026), (1.3, -0.016), (2.2, -0.02), (math.pi, -0.024)])
    opening = outline(symmetric([(0.0, 0.09), (0.02, 0.106), (0.045, 0.12), (0.07, 0.122), (0.081, 0.112), (0.068, 0.1), (0.042, 0.093),
                                 (0.022, 0.077), (0.014, 0.056), (0.015, 0.01), (0.021, -0.05), (0.0, -0.05)]), 6)
    gills = [((s_ * (0.098 + 0.011 * k), 0.07 - 0.004 * k), (s_ * (0.09 + 0.011 * k), 0.032 - 0.004 * k)) for s_ in (1, -1) for k in range(3)]

    def sd(u, v):
        d = max(bottom(abs(u / RU)) - v, v - 0.15)
        d = max(d, -sd_poly(u, v, opening))
        return max(d, -min(sd_capsule(u, v, a_, b_, 0.0022) for a_, b_ in gills))
    nose = lambda q: 0.012 * gauss(angle_of(q, sk.zc) * RU, 0.022) * smooth(0.12, 0.085, q.y)
    p.add(blued, *plate(lambda u, v: sk.point(u / RU, v, -0.0028), sd, -math.pi * RU, math.pi * RU, -0.04, 0.152, periodic=True),
          solid=0.003, roll=0.0012, roll_mat=gilt, roll_min=0.15, bump=nose, bead=(0.0055, 0.0012, 0.0014), deco=0.013)
    p.add(gilt, *strap(sk, [(2 * math.pi * k / 120, 0.143) for k in range(121)], 0.012, 0.0024), forge=hammered(0.0003))
    # the fin along the crest, its rays standing out of a gilt edge
    path = midline(sk, 0.165, 0.1)
    m = len(path)
    ray = lambda k: 0.6 + 0.4 * (1 - abs(2 * ((k / (m - 1) * 7) % 1) - 1)) ** 2
    hs = [0.034 * math.sin(math.pi * k / (m - 1)) ** 0.7 * ray(k) for k in range(m)]
    p.add(accent, *fin(sk, path, hs, top=0.0016, foot=0.007), deco=lambda q: 0.0)
    p.add(gilt, *comb_rope(sk, path, hs, 0.0022), deco=lambda q: 0.0)
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        p.add(gilt, *srivet(sk, a, 0.143, 0.0036, 0.0024, washer=0.0065))
    return p


def ashforged_helm():
    """A knight's close helm worn through a war: a rounded skull with a ridge down the front, a visor whose raised brow
    leaves a sight across the eyes, a plain bevor below it creased down the middle with a few holes for breath, both
    pivoting at the temples, and two gorget lames flaring over the neck; fire-blackened steel, dented and worn."""
    p = Piece('helm')
    steel, mail, leather, wool = ash_mats()
    rim = curve([(0, 0.15), (0.95, 0.148), (1.08, 0.1), (1.2, -0.006), (math.pi, -0.008)])
    sk = Skull(yc=0.125, zc=0.008, w=0.113, h=0.142, df=0.124, db=0.118, n=2.2, peak=0.32, keel=(0.16, 0.12), keel_from=0.15, rim=rim,
               lower=lambda a, u: 1.0 - 1.6 * u * u)
    worn = dents((sk.at(0.9, 0.21), 0.016, 0.002), (sk.at(-2.2, 0.18), 0.014, 0.0016))
    p.add(steel, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0015, bump=worn)
    RU = 0.125
    ridge = lambda u, v, hi, at, spread: hi * beak(u, 0.09) * gauss(v - at, spread)
    voff = lambda u, v: 0.0065 + ridge(u, v, 0.032, 0.115, 0.05) + 0.005 * smooth(0.112, 0.1, v)  # a beak, and the brow lip over the sight
    boff = lambda u, v: 0.0045 + ridge(u, v, 0.026, 0.07, 0.07)
    visor = outline(symmetric([(0.0, 0.162), (0.08, 0.161), (0.155, 0.158), (0.163, 0.135), (0.155, 0.113), (0.08, 0.104), (0.0, 0.097)]), 6)
    p.add(steel, *plate(lambda u, v: sk.point(u / RU, v, voff(u, v)), lambda u, v: sd_poly(u, v, visor), -0.17, 0.17, 0.095, 0.17),
          solid=0.003, roll=0.0014, roll_min=0.2, sharp=25, bump=dents((sk.at(0.35, 0.14), 0.012, 0.0015),))
    bevor = outline(symmetric([(0.0, 0.088), (0.08, 0.095), (0.157, 0.102), (0.163, 0.06), (0.15, 0.01), (0.12, -0.012), (0.06, -0.03),
                               (0.0, -0.042)]), 6)
    breaths = [(s_ * (0.05 + 0.011 * k), 0.052 - 0.009 * r_) for s_ in (1, -1) for k in range(3) for r_ in range(3)]

    def bevor_sd(u, v):
        return max(sd_poly(u, v, bevor), -min(sd_ellipse(u, v, hu, hv, 0.0019, 0.0019) for hu, hv in breaths))
    p.add(steel, *plate(lambda u, v: sk.point(u / RU, v, boff(u, v)), bevor_sd, -0.17, 0.17, -0.05, 0.1),
          solid=0.003, roll=0.0014, roll_min=0.2, sharp=25)
    for s_ in (1, -1):
        a = s_ * 1.25
        p.add(steel, *srivet(sk, a, 0.125, 0.0062, voff(a * RU, 0.125) + 0.0004, washer=0.0095))

    def gorget(off_, v0, v1):
        def surf(u, v):
            a = u / RU
            base = sk.point(a, -0.004, off_)
            n = sk.normal(a, -0.004)
            out = Vector((n.x, 0, n.z)).normalized()
            return base + UP * (v + 0.004) + out * (0.75 * (-0.004 - v))
        return plate(surf, lambda u, v: max(v0 - v, v - v1), -math.pi * RU, math.pi * RU, v0 - 0.004, v1 + 0.004, periodic=True)
    p.add(steel, *gorget(0.0005, -0.026, -0.004), solid=0.003, roll=0.0013)
    p.add(steel, *gorget(0.003, -0.042, -0.02), solid=0.003, roll=0.0013)
    for k in range(10):
        a = 2 * math.pi * (k + 0.5) / 10
        p.add(steel, *srivet(sk, a, -0.012, 0.0034, 0.0014))
    return p


def dragon_helm():
    """A close helmet, after the English and German ones of the later 16th century: a crested skull with a roped comb,
    a visor drawn out into a sharp beak with two sights, a bevor below it with a rosette of breathing holes, both
    pivoting at the temples, and two gorget plates at the back; dark steel worked with scales like the rest of the
    dragon harness, the comb and visor in red-lacquered scales, polished edges and rivets."""
    p = Piece('helm')
    dark, red, gold = dragon_mats()
    rim = curve([(0, 0.142), (0.9, 0.14), (1.08, 0.1), (1.2, -0.006), (math.pi, -0.008)])
    sk = Skull(yc=0.125, zc=0.008, w=0.108, h=0.13, df=0.118, db=0.116, n=2.3, keel=(0.08, 0.08), keel_from=0.17, rim=rim,
               lower=lambda a, u: 1.0 - 1.6 * u * u)
    p.add(dark, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0018, roll_mat=gold, deco=scaled)
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
          solid=0.003, roll=0.0015, roll_mat=gold, roll_min=0.2, deco=scaled, sharp=25)
    bevor = outline([(-0.159, 0.125), (-0.1, 0.11), (-0.045, 0.098), (0.0, 0.09), (0.045, 0.098), (0.1, 0.11), (0.159, 0.125),
                     (0.162, 0.06), (0.15, 0.01), (0.12, -0.012), (0.06, -0.03), (0.0, -0.046), (-0.06, -0.03), (-0.12, -0.012),
                     (-0.15, 0.01), (-0.162, 0.06)])
    holes = [(-0.06, 0.04)] + [(-0.06 + r * math.cos(t), 0.04 + r * math.sin(t)) for r, n in ((0.0085, 6), (0.017, 12)) for t in (2 * math.pi * k / n for k in range(n))]

    def bevor_sd(u, v):
        return max(sd_poly(u, v, bevor), -min(sd_ellipse(u, v, hu, hv, 0.0021, 0.0021) for hu, hv in holes))
    p.add(dark, *plate(lambda u, v: sk.point(u / RU, v, boff(u, v)), bevor_sd, -0.17, 0.17, -0.05, 0.13),
          solid=0.003, roll=0.0015, roll_mat=gold, roll_min=0.2, deco=scaled, sharp=25)
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
    p.add(dark, *gorget(-0.0012, -0.028, -0.004), solid=0.003, roll=0.0014, roll_mat=gold, deco=scaled)
    p.add(dark, *gorget(0.0018, -0.044, -0.022), solid=0.003, roll=0.0014, roll_mat=gold, deco=scaled)
    for k in range(9):
        a = 1.15 + (2 * math.pi - 2.3) * k / 8
        p.add(gold, *srivet(sk, a, -0.006, 0.0036, 0.0016))
    return p


def glacial_helm():
    """A close helm frosted over: a round skull with a low ridge over the crown, a visor of colder blue drawn to a sharp
    ridge down the face with one narrow sight cut across it and rows of breaths on the cheeks, a bevor below it, both
    pivoting at the temples, and two gorget lames over the neck hung with icicles; pale steel etched with frost along
    its borders, polished edges."""
    p = Piece('helm')
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    rim_c = curve([(0, 0.15), (0.95, 0.148), (1.08, 0.1), (1.2, -0.006), (math.pi, -0.008)])
    sk = Skull(yc=0.125, zc=0.008, w=0.114, h=0.14, df=0.124, db=0.118, n=2.15, peak=0.08, keel=(0.08, 0.07), keel_from=0.17, rim=rim_c,
               lower=lambda a, u: 1.0 - 1.6 * u * u)
    p.add(steel, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0015, roll_mat=rim, deco=0.016)
    RU = 0.125
    ridge = lambda u, v, hi, at, spread: hi * beak(u, 0.08) * gauss(v - at, spread)
    voff = lambda u, v: 0.0065 + ridge(u, v, 0.03, 0.1, 0.06) + 0.004 * smooth(0.112, 0.104, v) * smooth(0.09, 0.098, v)
    boff = lambda u, v: 0.0045 + ridge(u, v, 0.024, 0.06, 0.07)
    visor = outline(symmetric([(0.0, 0.17), (0.08, 0.168), (0.155, 0.162), (0.164, 0.13), (0.16, 0.1), (0.146, 0.076), (0.112, 0.061),
                               (0.06, 0.052), (0.0, 0.048)]), 6)
    breaths = [(s_ * (0.085 + 0.012 * k), 0.08 - 0.0085 * r_) for s_ in (1, -1) for k in range(4) for r_ in range(2)]

    def visor_sd(u, v):
        sight = sd_box(u, v, 0.0, 0.097, 0.075, 0.0048, 0.0035)
        holes = min(sd_box(u, v, hu, hv, 0.0045, 0.0014, 0.0012) for hu, hv in breaths)
        return max(sd_poly(u, v, visor), -sight, -holes)
    p.add(deep, *plate(lambda u, v: sk.point(u / RU, v, voff(u, v)), visor_sd, -0.17, 0.17, 0.04, 0.175, h=0.002),
          solid=0.003, roll=0.0014, roll_mat=rim, roll_min=0.2, sharp=25, deco=0.01)
    bevor = outline(symmetric([(0.0, 0.062), (0.08, 0.068), (0.15, 0.078), (0.16, 0.05), (0.148, 0.01), (0.12, -0.014), (0.06, -0.032),
                               (0.0, -0.044)]), 6)
    p.add(steel, *plate(lambda u, v: sk.point(u / RU, v, boff(u, v)), lambda u, v: sd_poly(u, v, bevor), -0.17, 0.17, -0.05, 0.07),
          solid=0.003, roll=0.0014, roll_mat=rim, roll_min=0.2, sharp=25, deco=0.01)
    for s_ in (1, -1):
        a = s_ * 1.25
        p.add(rim, *srivet(sk, a, 0.118, 0.0062, voff(a * RU, 0.118) + 0.0004, washer=0.0095))

    def gorget(off_, v0, v1):
        def surf(u, v):
            a = u / RU
            base = sk.point(a, -0.004, off_)
            n = sk.normal(a, -0.004)
            out = Vector((n.x, 0, n.z)).normalized()
            return base + UP * (v + 0.004) + out * (0.75 * (-0.004 - v))
        return surf, plate(surf, lambda u, v: max(v0 - v, v - v1), -math.pi * RU, math.pi * RU, v0 - 0.004, v1 + 0.004, periodic=True)
    _, g1 = gorget(0.0005, -0.026, -0.004)
    p.add(steel, *g1, solid=0.003, roll=0.0013, roll_mat=rim, deco=0.006)
    surf, g2 = gorget(0.003, -0.042, -0.02)
    p.add(deep, *g2, solid=0.003, roll=0.0013, roll_mat=rim, deco=0.006)
    for k in range(10):
        a = 2 * math.pi * (k + 0.5) / 10
        p.add(rim, *srivet(sk, a, -0.012, 0.0034, 0.0014))
    hang = []  # icicles under the lower lame, round the sides and back
    for k in range(12):
        a = lerp(0.9, 2 * math.pi - 0.9, (k + 0.5) / 12) + 0.08 * noise.noise(Vector((k * 1.7, 0.2, 0.0)))
        grow = 0.5 + 0.5 * noise.noise(Vector((k * 2.3, 4.1, 1.0)))
        q = surf(a * RU, -0.0405) - sk.normal(a, -0.004) * 0.0015
        n = sk.normal(a, -0.004)
        hang.append(icicle(q, Vector((0.0, -1.0, 0.0)) + Vector((n.x, 0, n.z)).normalized() * 0.3, 0.014 + 0.02 * grow, 0.004 + 0.002 * grow, k))
    p.add(ice, *merge(*hang))
    return p


def emerald_helm():
    """After the user's emerald knights: a round helm of emerald lacquer worked in scales, a smooth domed visor of dark
    glassy green over the whole face, smooth feathers swept back along both sides in three layers, each over the one
    below, and a feathered crest over the crown; every edge in polished silver."""
    p = Piece('helm')
    scale, smooth_, silver, mail, glass = emerald_mats()
    rim_c = curve([(0, 0.158), (0.95, 0.156), (1.12, 0.1), (1.3, -0.01), (math.pi, -0.014)])
    sk = Skull(yc=0.125, zc=0.008, w=0.115, h=0.143, df=0.125, db=0.12, n=2.2, peak=0.06, rim=rim_c, lower=lambda a, u: 1.0 - 1.6 * u * u)
    p.add(scale, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0015, roll_mat=silver, deco=trimmed(0.01))
    # the visor, domed over the whole face
    RU = 0.125
    vis = outline(symmetric([(0.0, 0.172), (0.07, 0.17), (0.13, 0.162), (0.16, 0.135), (0.165, 0.085), (0.152, 0.035), (0.122, -0.008),
                             (0.07, -0.034), (0.0, -0.044)]), 6)
    visor = mat('emerald_visor', 0x05301e, 'glass', rough=0.05, metal=0.3, sheen=0x1a8f7a)
    voff = lambda u, v: 0.008 + 0.028 * gauss(u, 0.1) * gauss(v - 0.08, 0.08) + 0.006 * beak(u, 0.07) * smooth(0.13, 0.03, v)
    p.add(visor, *plate(lambda u, v: sk.point(u / RU, v, voff(u, v)), lambda u, v: sd_poly(u, v, vis), -0.17, 0.17, -0.05, 0.176),
          solid=0.0035, roll=0.0022, roll_mat=silver, roll_min=0.2, sharp=30)
    for s_ in (1, -1):
        a = s_ * 1.3
        p.add(silver, *srivet(sk, a, 0.12, 0.006, voff(a * RU, 0.12) + 0.0004, washer=0.009))
    # the crest along the crown, its top edge rising and falling in feathers, a silver edge along it
    path = midline(sk, 0.2, 0.16, 24)
    hs = []
    for k in range(len(path)):
        s = k / (len(path) - 1)
        hs.append((0.018 + 0.03 * math.sin(math.pi * min(1.0, s * 1.6)) ** 0.6 * (1 - 0.6 * smooth(0.5, 1.0, s)))
                  * (0.85 + 0.15 * abs(math.cos(s * 5 * math.pi))) + 0.002)
    p.add(smooth_, *fin(sk, path, hs, top=0.009, foot=0.03, sink=0.008), deco=lambda q: 1.0)
    p.add(silver, *tube([sk.point(a, y, hs[k] - 0.0006) for k, (a, y) in enumerate(path)], 0.0024, 10))
    # a feather down the brow from the crest to a point over the top of the visor
    brow = [(0.0, 0.222), (0.0, 0.178), (0.0, 0.142)]
    p.add(smooth_, *plate(lambda u, v: sk.point(u / RU, v, 0.021 * smooth(0.2, 0.17, v) + 0.004), lambda u, v: ribbon_sd(u, v, brow, [0.024, 0.02, 0.0]),
                          -0.04, 0.04, 0.13, 0.235), solid=0.0025, roll=0.0012, roll_mat=silver, deco=trimmed(0.004), sharp=30)
    # three feathers down each side, swept back from the temple to a point behind, the upper over the lower
    RF = 0.11
    feathers = (([(0.75, 0.152), (1.4, 0.152), (2.15, 0.125), (2.75, 0.085)], [0.011, 0.02, 0.016, 0.0], 0.0045),
                ([(0.5, 0.19), (1.3, 0.195), (2.2, 0.172), (2.8, 0.135)], [0.011, 0.022, 0.018, 0.0], 0.0075),
                ([(0.3, 0.225), (1.2, 0.235), (2.25, 0.215), (2.85, 0.185)], [0.01, 0.02, 0.016, 0.0], 0.0105))
    for spine, ws, off in feathers:
        sp = [(a * RF, y) for a, y in spine]
        us, vs = [q[0] for q in sp], [q[1] for q in sp]
        both(p, smooth_, plate(lambda u, v, off=off: sk.point(u / RF, v, off), lambda u, v, sp=sp, ws=ws: ribbon_sd(u, v, sp, ws),
                               min(us) - 0.03, max(us) + 0.03, min(vs) - 0.03, max(vs) + 0.03), None,
             solid=0.0025, roll=0.0012, roll_mat=silver, deco=trimmed(0.004), sharp=35)
    return p


def horn(base, out, up, inward, length, r, rings=9):
    """A horn of gold: from inside its root out along `out`, sweeping up and curling in at the tip, ringed with low
    ridges as it tapers to a point."""
    o, u_, i_ = Vector(out).normalized(), Vector(up).normalized(), Vector(inward).normalized()
    pts, radii = [], []
    n = 28
    for k in range(n + 1):
        t = k / n
        pts.append(Vector(base) + o * (length * (0.95 * t - 0.6 * t * t) - r * 0.5) + u_ * (length * (0.15 * t + 0.95 * t * t))
                   + i_ * (length * 0.55 * t ** 3))
        ridge = 1.0 + 0.07 * max(0.0, math.sin(t * rings * math.pi)) * (1 - t)
        radii.append(max(0.0008, r * (1 - t) ** 0.9 * ridge))
    return tube(pts, radii, 14)


def infernal_helm():
    """After the user's black knight: a close helm of black lacquer, its skull worked over the sides in raised gilt
    scrollwork and drawn into a low ridge, a gold comb along it; a visor gold-bordered with a raised ridge down the face
    and two sights; a bevor below it with breaths; two gorget lames; from the temples a pair of gold horns sweeping out
    and up and curling in at the tips, set in ornate mounts."""
    p = Piece('helm')
    p.budget, p.tex = 9000, 2048
    orn, blk, gold, mail, leather, stone = infernal_mats()
    rim_c = curve([(0, 0.155), (0.95, 0.152), (1.1, 0.1), (1.25, -0.008), (math.pi, -0.01)])
    sk = Skull(yc=0.125, zc=0.008, w=0.114, h=0.142, df=0.124, db=0.119, n=2.2, peak=0.18, keel=(0.13, 0.11), keel_from=0.15, rim=rim_c,
               lower=lambda a, u: 1.0 - 1.6 * u * u)
    side_orn = lambda q: smooth(0.4, 0.8, abs(angle_of(q, sk.zc))) * smooth(2.9, 2.5, abs(angle_of(q, sk.zc)))
    p.add(orn, *sk.mesh(sk.cols(112, extra_cols([0.0, math.pi]))), solid=0.0035, roll=0.0016, roll_mat=gold, deco=ornate(0.011, side_orn))
    path = midline(sk, 0.185, 0.07, 24)  # the comb
    hs = [0.004 + 0.009 * math.sin(math.pi * k / (len(path) - 1)) ** 0.6 for k in range(len(path))]
    p.add(gold, *fin(sk, path, hs, top=0.0018, foot=0.007), deco=lambda q: 1.0)
    RU = 0.125
    ridge = lambda u, v, hi, at, spread: hi * beak(u, 0.07) * gauss(v - at, spread)
    voff = lambda u, v: 0.007 + ridge(u, v, 0.028, 0.11, 0.06)
    boff = lambda u, v: 0.0048 + ridge(u, v, 0.024, 0.06, 0.07)
    visor = outline(symmetric([(0.0, 0.172), (0.08, 0.17), (0.152, 0.163), (0.164, 0.135), (0.16, 0.108), (0.13, 0.094), (0.07, 0.088),
                               (0.0, 0.08)]), 6)
    sights = [((s * 0.016, 0.112), (s * 0.072, 0.118)) for s in (1, -1)]

    def visor_sd(u, v):
        return max(sd_poly(u, v, visor), -min(sd_capsule(u, v, a, b, 0.0042) for a, b in sights))
    p.add(orn, *plate(lambda u, v: sk.point(u / RU, v, voff(u, v)), visor_sd, -0.17, 0.17, 0.075, 0.18, h=0.0022),
          solid=0.003, roll=0.0015, roll_mat=gold, roll_min=0.2, sharp=25, deco=ornate(0.008, lambda q: smooth(0.13, 0.142, q.y)))
    bevor = outline(symmetric([(0.0, 0.094), (0.08, 0.1), (0.152, 0.108), (0.163, 0.06), (0.15, 0.012), (0.12, -0.014), (0.06, -0.033),
                               (0.0, -0.046)]), 6)
    breaths = [(s * (0.05 + 0.012 * k), 0.054 - 0.01 * r_) for s in (1, -1) for k in range(3) for r_ in range(3)]

    def bevor_sd(u, v):
        return max(sd_poly(u, v, bevor), -min(sd_ellipse(u, v, hu, hv, 0.002, 0.002) for hu, hv in breaths))
    p.add(orn, *plate(lambda u, v: sk.point(u / RU, v, boff(u, v)), bevor_sd, -0.17, 0.17, -0.052, 0.112),
          solid=0.003, roll=0.0015, roll_mat=gold, roll_min=0.2, sharp=25, deco=ornate(0.008, lambda q: smooth(0.035, 0.0, q.y)))
    for s_ in (1, -1):
        a = s_ * 1.25
        p.add(gold, *srivet(sk, a, 0.12, 0.0068, voff(a * RU, 0.12) + 0.0004, washer=0.011))

    def gorget(off_, v0, v1):
        def surf(u, v):
            a = u / RU
            base = sk.point(a, -0.004, off_)
            n = sk.normal(a, -0.004)
            out = Vector((n.x, 0, n.z)).normalized()
            return base + UP * (v + 0.004) + out * (0.75 * (-0.004 - v))
        return plate(surf, lambda u, v: max(v0 - v, v - v1), -math.pi * RU, math.pi * RU, v0 - 0.004, v1 + 0.004, periodic=True)
    p.add(blk, *gorget(0.0005, -0.026, -0.004), solid=0.003, roll=0.0014, roll_mat=gold, deco=PLAIN)
    p.add(blk, *gorget(0.003, -0.042, -0.02), solid=0.003, roll=0.0014, roll_mat=gold, deco=PLAIN)
    # the horns, from ornate mounts at the temples
    for s_ in (1, -1):
        a = s_ * 1.38
        y0 = 0.212
        root, n = sk.point(a, y0, 0.0), sk.normal(a, y0)
        out = Vector((n.x, 0.0, n.z)).normalized()
        p.add(gold, *horn(root, out + Vector((0, 0.2, 0)), UP, -out + Vector((0, 0, 0.12)), 0.12, 0.021))
        mount = outline(star((a * RU, y0), 0.03, 0.021, 6), 4)
        p.add(orn, *plate(lambda u, v: sk.point(u / RU, v, 0.0045), lambda u, v, mount=mount: sd_poly(u, v, mount), a * RU - 0.034, a * RU + 0.034,
                          y0 - 0.034, y0 + 0.034), solid=0.003, roll=0.0012, roll_mat=gold, deco=ornate(0.006), sharp=30)
    return p



# ---------------------------------------------------------------- body armour

TORSO = ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01')
FINGERS_L = tuple(f'{f}_0{k}_l' for f in ('index', 'middle', 'ring', 'pinky') for k in (1, 2, 3))
THUMB_L = ('thumb_01_l', 'thumb_02_l', 'thumb_03_l')
_fits = {}


def fitted(key, make):
    """A Fit built once per run (each piece is built twice, dense and light)."""
    if key not in _fits:
        _fits[key] = make()
    return _fits[key]


def forms(gap=0.0):
    """The forms body armour is cut from, fitted to the reference body's bare skin (left side; the right mirrors it):
    under a set's armour the client draws the bare body, dyed, instead of the cloth it covers, so the plates can sit a
    few millimetres off the body. The hips also clear the kit's breeches, which stay on when only the cuirass is worn.
    `gap` is added to each one's own clearance."""
    foot, ball = bone('foot_l'), bone('ball_l')
    bare = ('Head_',)
    return {
        'torso': fitted(('torso', gap), lambda: Fit(TORSO, (0, 0, 0), UP, (0, 0, 1), 0.9, 1.56, gap=0.006 + gap, only=bare,
                                                    keep=lambda v: abs(v.x) < 0.17)),
        'hips': fitted(('hips', gap), lambda: Fit(('pelvis', 'spine_01', 'thigh_l', 'thigh_r'), (0, 0, 0), UP, (0, 0, 1), 0.72, 1.07,
                                                  gap=0.006 + gap, only=bare + ('Legs',), keep=lambda v: v.y > 0.72)),
        'arm': fitted(('arm', gap), lambda: Fit(('upperarm_l', 'clavicle_l'), bone('upperarm_l'), (1, 0, 0), (0, 1, 0), -0.08, 0.27,
                                                gap=0.006 + gap, only=bare, keep=lambda v: v.x > 0.12)),
        'forearm': fitted(('forearm', gap), lambda: Fit(('lowerarm_l', 'upperarm_l'), bone('lowerarm_l'), (1, 0, 0), (0, 1, 0), -0.07, 0.25,
                                                        gap=0.005 + gap, only=bare, keep=lambda v: v.x > 0.37)),
        'hand': fitted(('hand', gap), lambda: Fit(('hand_l', 'lowerarm_l') + FINGERS_L + THUMB_L, bone('hand_l'), (1, 0, 0), (0, 1, 0), -0.09, 0.22,
                                                  gap=0.004 + gap, only=bare, keep=lambda v: v.x > 0.6)),
        'thigh': fitted(('thigh', gap), lambda: Fit(('thigh_l',), bone('thigh_l'), (0, -1, 0), (0, 0, 1), 0.0, 0.45, gap=0.006 + gap, only=bare)),
        'knee': fitted(('knee', gap), lambda: Fit(('thigh_l', 'calf_l'), bone('calf_l'), (0, -1, 0), (0, 0, 1), -0.1, 0.1, gap=0.007 + gap,
                                                  only=bare, keep=lambda v: abs(v.y - 0.542) < 0.14)),
        'calf': fitted(('calf', gap), lambda: Fit(('calf_l',), bone('calf_l'), (0, -1, 0), (0, 0, 1), 0.0, 0.47, gap=0.006 + gap, only=bare)),
        'foot': fitted(('foot', gap), lambda: Fit(('foot_l', 'ball_l'), foot, ball - foot, (0, 1, 0), -0.085, 0.25, gap=0.006 + gap, only=bare,
                                                  ends=(-0.05, 0.2))),
    }


def band_plate(f, RU, a0, a1, t0, t1, off, r=0.006, h=0.0034):
    """A plate over a band of a form: angles a0..a1, distances t0..t1, its corners rounded."""
    sd = lambda u, v: sd_box(u, v, (a0 + a1) / 2 * RU, (t0 + t1) / 2, (a1 - a0) / 2 * RU, (t1 - t0) / 2, r)
    of = off if callable(off) else (lambda u, v, o=off: o)
    return plate(lambda u, v: f.point(u / RU, v, of(u, v)), sd, a0 * RU - 0.004, a1 * RU + 0.004, t0 - 0.004, t1 + 0.004, h=h)


def ring_plate(f, RU, t0, t1, off, h=0.0034):
    """A plate all round a form between t0 and t1 (vambraces, greaves, rerebraces)."""
    of = off if callable(off) else (lambda u, v, o=off: o)
    return plate(lambda u, v: f.point(u / RU, v, of(u, v)), lambda u, v: max(t0 - v, v - t1), -math.pi * RU, math.pi * RU,
                 t0 - 0.004, t1 + 0.004, h=h, periodic=True)


def wing(root, wrist, tips, lower):
    """A small dragon's wing of steel: a leading edge from its root to the wrist, fingers fanning out from the wrist to
    `tips`, a membrane between them with a scalloped trailing edge back to `lower`, and a claw at the wrist. Returns its
    membrane and its bones (leading edge, fingers, claw) as meshes."""
    R, W = Vector(root), Vector(wrist)
    U = (W - R).normalized()
    N = U.cross(Vector(tips[1]) - R).normalized()
    if N.z > 0:  # the membrane's face looks back, away from the body
        N = -N
    V = N.cross(U)
    flat = lambda q: ((Vector(q) - R).dot(U), (Vector(q) - R).dot(V))
    pts = [flat(R), flat(W)]
    for i, t in enumerate(tips):
        pts.append(flat(t))
        nxt = Vector(tips[i + 1]) if i + 1 < len(tips) else Vector(lower)
        pts.append(flat(((Vector(t) + nxt) / 2).lerp(W, 0.3)))  # the scallop between two fingers
    pts.append(flat(lower))
    edge = outline(pts, 6)
    us, vs = [q[0] for q in edge], [q[1] for q in edge]
    span = max(us) - min(us)
    billow = lambda u, v: 0.012 * math.sin(math.pi * clamp((u - min(us)) / span)) * smooth(-0.02, 0.06, v)
    membrane = plate(lambda u, v: R + U * u + V * v + N * billow(u, v), lambda u, v: sd_poly(u, v, edge),
                     min(us) - 0.01, max(us) + 0.01, min(vs) - 0.01, max(vs) + 0.01, h=0.003)
    lift = lambda q: Vector(q) + N * 0.002
    bones_ = [tube([lift(R), lift(R.lerp(W, 0.5)) + N * 0.004, lift(W)], [0.0065, 0.0055, 0.0045], 10)]
    for t in tips:
        bones_.append(tube([lift(W), lift(W.lerp(Vector(t), 0.5)) + N * 0.003, lift(t)], [0.0042, 0.003, 0.0012], 8))
    bones_.append(tube([lift(W), lift(W) + U * 0.022 + V * 0.006 + N * 0.004], [0.004, 0.0004], 8))  # the claw
    return {'membrane': membrane, 'bones': merge(*bones_)}


def teeth_sd(u, v, u0, u1, t0, t1, points=3, depth=0.02, free='high', shape='point'):
    """A band from u0 to u1 and t0 to t1 whose free edge (t1 for 'high', t0 for 'low') is cut into `points` pointed
    scales (or rounded lobes, shape 'round'), as a signed distance (good enough for its outline to be traced)."""
    x = clamp((u - u0) / (u1 - u0)) * points
    f = abs(2 * (x - math.floor(x)) - 1)
    notch = depth * (1 - math.sqrt(max(0.0, 1 - f * f)) if shape == 'round' else f ** 0.85)
    side = abs(u - (u0 + u1) / 2) - (u1 - u0) / 2
    if free == 'low':
        return max(side, v - t1, t0 + notch - v)
    return max(side, t0 - v, v - (t1 - notch))


def teeth_plate(f, RU, a0, a1, t0, t1, off, points=3, depth=0.02, free='high', h=0.0034, shape='point'):
    """A lame over a band of a form, its free edge cut into pointed scales (or rounded lobes)."""
    of = off if callable(off) else (lambda u, v, o=off: o)
    u0, u1 = a0 * RU, a1 * RU
    return plate(lambda u, v: f.point(u / RU, v, of(u, v)), lambda u, v: teeth_sd(u, v, u0, u1, t0, t1, points, depth, free, shape),
                 u0 - 0.004, u1 + 0.004, t0 - 0.004, t1 + 0.004, h=h)


def spike(base, direction, length, r, bend=(0, 0, 0)):
    """A short horn of steel: from inside its base out along `direction`, curving towards `bend`, tapering to a point."""
    d, b = Vector(direction).normalized(), Vector(bend)
    pts = [Vector(base) + d * (length * t - r * 0.6) + b * (length * 0.4 * t * t) for t in (i / 10 for i in range(11))]
    return tube(pts, [r * (1 - t) ** 1.1 + 0.0004 for t in (i / 10 for i in range(11))], 10)


def hanging(side, top=0.93, waist=0.99):
    """The weights of a plate hanging from the waist over a thigh (a tasset, a strip of a skirt): held at the waist, it
    follows the thigh wholly below `top`. The cuisses and mail under it follow the thigh; a tasset that kept any of the
    hips there would let them through whenever the leg moved, even standing at ease with a thigh turned out. The hold
    is kept to the top of the first lame, under the fauld: the lames of a tasset overlap, and any of them held more
    than the next would come through it."""
    return lambda p: {'pelvis': smooth(top, waist, p.y), f'thigh_{side}': 1 - smooth(top, waist, p.y)}


def skirt(top=0.93, waist=0.99):
    """The weights of a skirt hanging round both thighs (a hauberk's, under the tassets or strips): on each side as a
    tasset's (hanging), so the two move together, the halves meeting in the middle as a skirt slit for riding would."""
    def f(p):
        held = smooth(top, waist, p.y)
        left = smooth(-0.04, 0.04, p.x)
        return {'pelvis': held, 'thigh_l': (1 - held) * left, 'thigh_r': (1 - held) * (1 - left)}
    return f


def dragon_mats():
    """Blued, near-black steel worked all over with scales, red-lacquered scale plates over it, polished steel edges."""
    return (mat('dragon_steel', 0x2a2d34, 'steel', engrave='scales', emboss=True, rough=0.3, metal=0.9, bump=0.9),
            mat('dragon_scale', 0x9c2216, 'enamel', engrave='scales', emboss=True, rough=0.3, metal=0.4, bump=1.0),
            mat('dragon_rim', 0x80868f, 'steel', rough=0.22, metal=0.95))


def scaled(q, d):
    """Scales all over a plate but for a plain band along its edges."""
    return smooth(0.006, 0.011, d)


def dragon_chest():
    """The dragon harness's cuirass: a breastplate of dark steel creased down the middle with a plastron of red scales
    over the chest, cut in points below, a backplate with two small steel wings of a dragon on a mount, a collar standing
    round the back of the neck, a gorget in front, a fauld and tassets of pointed red scales, pauldrons of layered,
    pointed red scales with a horn, rerebraces and couters with a spur."""
    p = Piece('chest')
    dark, red, rim = dragon_mats()
    F = forms()
    torso, hips, arm, fore = F['torso'], F['hips'], F['arm'], F['forearm']
    trunk = ('spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r')
    edge = dict(solid=0.003, roll=0.0014, roll_mat=rim)
    RU = 0.17
    front = outline(symmetric([(0.0, 1.488), (0.045, 1.494), (0.08, 1.51), (0.115, 1.528), (0.145, 1.505), (0.17, 1.42),
                               (0.205, 1.345), (0.24, 1.31), (0.258, 1.2), (0.258, 1.065), (0.17, 1.038), (0.08, 1.004), (0.0, 0.988)]), 6)

    def foff(u, v):  # a ridge down the middle, swelling a little over the belly
        return 0.003 + 0.013 * beak(u, 0.12) + 0.012 * beak(u, 0.1) * gauss(v - 1.08, 0.08)
    p.add(dark, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v)), lambda u, v: sd_poly(u, v, front), -0.27, 0.27, 0.97, 1.54),
          deco=scaled, sharp=25, skin=trunk, **edge)
    p.add(red, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v) + 0.0055),  # clear of the plate under it on a woman too
                      lambda u, v: max(teeth_sd(u, v, -0.215, 0.215, 1.315, 1.56, 5, 0.04, 'low'), sd_poly(u, v, front) + 0.011),
                      -0.23, 0.23, 1.3, 1.54), deco=scaled, sharp=25, skin=trunk, **edge)
    back = outline(symmetric([(0.0, 1.53), (0.05, 1.532), (0.09, 1.535), (0.13, 1.51), (0.17, 1.41), (0.21, 1.34), (0.25, 1.3),
                              (0.29, 1.2), (0.29, 1.06), (0.15, 1.012), (0.0, 1.002)]), 6)
    p.add(dark, *plate(lambda u, v: torso.point(math.pi + u / RU, v, 0.0), lambda u, v: sd_poly(u, v, back), -0.3, 0.3, 0.99, 1.545),
          deco=scaled, skin=trunk, **edge)
    # two small steel wings of a dragon on a mount between the shoulder blades
    root = torso.point(math.pi - 0.3, 1.405, 0.004)
    wrist = root + Vector((0.075, 0.19, -0.1))
    wing_parts = wing(root, wrist, [wrist + Vector((0.12, 0.07, -0.08)), wrist + Vector((0.16, -0.06, -0.07)), wrist + Vector((0.12, -0.18, -0.05))],
                      root + Vector((0.03, -0.09, -0.02)))
    both(p, red, wing_parts['membrane'], ('spine_03',), solid=0.002, roll=0.0009, roll_mat=rim, deco=scaled, sharp=30)
    both(p, rim, wing_parts['bones'], ('spine_03',))
    both(p, dark, teeth_plate(torso, RU, math.pi - 0.52, math.pi - 0.08, 1.35, 1.45, 0.006, 2, 0.02, 'low'), ('spine_03',), deco=scaled,
         solid=0.002, roll=0.001, roll_mat=rim)
    for a, y in ((math.pi - 0.45, 1.43), (math.pi - 0.15, 1.43)):
        both(p, rim, rivet(torso.point(a, y, 0.0062), torso.normal(a, y), 0.0032), ('spine_03',))
    # the collar standing round the sides and back of the neck, flaring at the top; the gorget's two lames in front
    neck = Cone(-0.035, 1.48, 0.112, 0.1, 1.57, 0.075, 0.075)
    top = lambda a: 1.585 - 0.035 * smooth(1.7, 2.7, abs(wrap(a)))
    p.add(red, *plate(lambda u, v: neck.point(u / 0.09, v, 0.006 + 0.028 * smooth(1.51, 1.585, v)),
                      lambda u, v: max(1.478 - v, v - top(u / 0.09), abs(u / 0.09 - math.pi) - (math.pi - 0.75)),
                      0.6 * 0.09, (2 * math.pi - 0.6) * 0.09, 1.47, 1.6), deco=scaled, skin=('neck_01', 'spine_03'), **edge)
    for k, (lo_, hi_) in enumerate(((1.483, 1.525), (1.517, 1.56))):
        p.add(dark, *band_plate(neck, 0.09, -0.95, 0.95, lo_, hi_, 0.0065 - 0.0025 * k, 0.008), deco=scaled, skin=('neck_01', 'spine_03'), **edge)
    # the fauld round the waist, its lower lame cut in points, and tassets of three pointed red lames over each thigh
    p.add(dark, *plate(lambda u, v: hips.point(u / 0.16, v, 0.0), lambda u, v: max(0.966 - v, v - 1.05), -math.pi * 0.16, math.pi * 0.16,
                       0.962, 1.054, periodic=True), deco=scaled, skin=('pelvis', 'spine_01'), **edge)
    p.add(dark, *plate(lambda u, v: hips.point(u / 0.16, v, 0.0025), lambda u, v: teeth_sd(u, v, -math.pi * 0.16, math.pi * 0.16, 0.918, 0.98, 16, 0.016, 'low'),
                       -math.pi * 0.16, math.pi * 0.16, 0.912, 0.984, periodic=True), deco=scaled, skin=('pelvis', 'spine_01'), **edge)
    tasset = hanging('l')
    for k, (lo_, hi_) in enumerate(((0.875, 0.94), (0.825, 0.89), (0.765, 0.84))):
        both(p, red, teeth_plate(hips, 0.16, 0.12, 1.24, lo_, hi_, 0.006 + 0.0025 * k, 3, 0.022, 'low'), tasset, deco=scaled, **edge)
    # pauldrons: a cap with a ridge and a horn, four lames down the arm cut in points, each over the next
    capoff = lambda u, v: 0.013 + 0.005 * beak(u, 0.03)
    dome = lambda q: 0.008 * gauss((q - arm.at(0.0, -0.01)).length, 0.06)
    both(p, red, band_plate(arm, 0.09, -2.05, 2.05, -0.085, 0.075, capoff, 0.03), ('clavicle_l', 'upperarm_l'), bump=dome, deco=scaled, sharp=30, **edge)
    horn_at = arm.point(0.0, -0.02, 0.024)
    both(p, rim, spike(horn_at, (0.25, 1.0, -0.35), 0.05, 0.009, (0.4, 0.0, -0.6)), ('clavicle_l', 'upperarm_l'))
    for k, (t0, t1) in enumerate(((0.055, 0.1), (0.083, 0.128), (0.111, 0.156), (0.139, 0.184))):
        both(p, red, teeth_plate(arm, 0.09, -1.85, 1.85, t0, t1, 0.011 - 0.0025 * k, 4, 0.014), ('upperarm_l',), deco=scaled, **edge)
    both(p, dark, ring_plate(arm, 0.09, 0.17, 0.25, 0.0), ('upperarm_l',), deco=scaled, **edge)
    # couters: a cup over the back of the elbow with a short spur
    cup = lambda q: 0.008 * gauss((q - fore.at(-math.pi / 2, 0.0)).length, 0.035)
    both(p, dark, plate(lambda u, v: fore.point(u / 0.07, v, 0.006), lambda u, v: sd_ellipse(u, v, -math.pi / 2 * 0.07, 0.0, 0.085, 0.052),
                        -math.pi * 0.07, 0.0, -0.06, 0.06), ('upperarm_l', 'lowerarm_l'), bump=cup, deco=scaled, **edge)
    both(p, rim, spike(fore.point(-math.pi / 2, 0.0, 0.012), (0.3, 0.0, -1.0), 0.03, 0.007), ('upperarm_l', 'lowerarm_l'))
    return p


def dragon_gloves():
    """Vambraces of dark steel with a plate of red scales over the forearm pointing to the hand, and gauntlets: a
    flared cuff, a plate over the back of the hand, a red knuckle plate cut in points, four lames over the fingers and
    one over the thumb."""
    p = Piece('gloves')
    dark, red, rim = dragon_mats()
    F = forms()
    fore, hand = F['forearm'], F['hand']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=rim)
    both(p, dark, ring_plate(fore, 0.07, 0.045, 0.2, lambda u, v: 0.003 + 0.004 * beak(u, 0.05)), ('lowerarm_l',), deco=scaled, sharp=28, **edge)
    both(p, red, teeth_plate(fore, 0.07, -1.0, 1.0, 0.06, 0.205, lambda u, v: 0.006 + 0.004 * beak(u, 0.05), 3, 0.028), ('lowerarm_l',),
         deco=scaled, sharp=28, **edge)
    both(p, dark, ring_plate(hand, 0.06, -0.085, 0.006, lambda u, v: 0.003 + 0.02 * smooth(-0.005, -0.085, v)), ('hand_l', 'lowerarm_l'),
         deco=scaled, **edge)
    both(p, dark, band_plate(hand, 0.06, -1.15, 1.15, -0.002, 0.098, 0.006, 0.012), ('hand_l',), deco=scaled, **edge)
    both(p, red, teeth_plate(hand, 0.06, -1.1, 1.1, 0.06, 0.104, 0.009, 4, 0.012), ('hand_l',), deco=scaled, **edge)
    for k, (t0, t1) in enumerate(((0.096, 0.126), (0.122, 0.152), (0.148, 0.178), (0.174, 0.205))):
        both(p, dark, band_plate(hand, 0.06, -1.05, 1.05, t0, t1, 0.004 - 0.0006 * k, 0.012 if k == 3 else 0.004), ('hand_l',) + FINGERS_L,
             deco=scaled, **edge)
    both(p, dark, band_plate(hand, 0.06, 1.3, 2.4, 0.015, 0.085, 0.004, 0.012), ('hand_l',) + THUMB_L, deco=scaled, **edge)
    return p


def dragon_legs():
    """Cuisses of dark steel with three lames of red scales cut in points down the front, and poleyns with a wing and a
    spur at the knees."""
    p = Piece('legs')
    dark, red, rim = dragon_mats()
    F = forms()
    thigh, knee = F['thigh'], F['knee']
    edge = dict(solid=0.003, roll=0.0014, roll_mat=rim)
    both(p, dark, band_plate(thigh, 0.085, -2.0, 1.1, 0.1, 0.4, lambda u, v: 0.003 + 0.005 * beak(u, 0.05), 0.02), ('thigh_l',), deco=scaled,
         sharp=28, **edge)
    for k, (t0, t1) in enumerate(((0.1, 0.2), (0.18, 0.28), (0.26, 0.36))):
        both(p, red, teeth_plate(thigh, 0.085, -1.6, 0.85, t0, t1, 0.007 - 0.0012 * k, 3, 0.03), ('thigh_l',), deco=scaled, **edge)
    dome = lambda q: 0.006 * gauss((q - knee.at(0.0, 0.0)).length, 0.035)
    both(p, dark, band_plate(knee, 0.065, -1.3, 1.3, -0.055, 0.055, 0.005, 0.03), ('thigh_l', 'calf_l'), bump=dome, deco=scaled, **edge)
    both(p, dark, plate(lambda u, v: knee.point(u / 0.065, v, 0.004), lambda u, v: sd_ellipse(u, v, -1.6 * 0.065, 0.004, 0.04, 0.034),
                        -2.4 * 0.065, -0.8 * 0.065, -0.036, 0.044), ('thigh_l', 'calf_l'), deco=scaled, **edge)
    both(p, rim, spike(knee.point(0.0, 0.012, 0.014), (0.0, -0.45, 1.0), 0.028, 0.0075), ('thigh_l', 'calf_l'))
    return p


def dragon_feet():
    """From the knee down, in place of the boots: greaves of dark steel closed round the shins with a red plate of
    scales over the shin rising to a point at the knee, and sabatons - a leather shoe with steel lames over the instep,
    each over the next, a rounded toe cap and a heel plate."""
    p = Piece('feet')
    dark, red, rim = dragon_mats()
    leather = mat('sole', 0x2a1a12, 'leather', rough=0.85)
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=rim)
    both(p, dark, ring_plate(calf, 0.06, 0.065, 0.43, lambda u, v: 0.003 + 0.01 * smooth(0.39, 0.43, v)), ('calf_l',), deco=scaled, **edge)
    both(p, red, teeth_plate(calf, 0.06, -0.95, 0.95, 0.07, 0.385, lambda u, v: 0.0058 + 0.005 * beak(u, 0.04), 1, 0.06, 'low'), ('calf_l',),
         deco=scaled, sharp=28, **edge)
    shoe = ('foot_l', 'ball_l')
    both(p, leather, ring_plate(foot, 0.045, -0.085, 0.25, 0.0), shoe, solid=0.002)
    for k, (t0, t1) in enumerate(((-0.01, 0.04), (0.035, 0.08), (0.075, 0.12), (0.115, 0.16), (0.155, 0.25))):
        mat_ = red if k == 1 else dark
        both(p, mat_, band_plate(foot, 0.045, -1.6, 1.6, t0, t1, 0.011 - 0.0025 * k, 0.012 if k == 4 else 0.004),
             ('foot_l',) if k < 2 else shoe, deco=scaled, **edge)
    both(p, dark, band_plate(foot, 0.045, math.pi - 1.2, math.pi + 1.2, -0.085, -0.02, 0.004, 0.01), ('foot_l',), deco=scaled, **edge)
    return p


def limb_fin(f, a, t0, t1, height, spines=5, top=0.0014, foot=0.006, sink=0.004, n=40):
    """A fish's fin of steel standing out of a form along the line at angle a from t0 to t1: rising from nothing at
    both ends, its edge cut into `spines` rays."""
    prof = [(-foot, 0, -sink), (-foot * 0.5, 0, 0.0), (-top * 1.5, 0.3, 0.0), (-top, 0.75, 0.0), (-top * 0.7, 1.0, -top * 0.5),
            (0.0, 1.0, 0.0), (top * 0.7, 1.0, -top * 0.5), (top, 0.75, 0.0), (top * 1.5, 0.3, 0.0), (foot * 0.5, 0, 0.0), (foot, 0, -sink)]
    verts, faces = [], []
    e = 1e-3
    for k in range(n + 1):
        s_ = k / n
        t = lerp(t0, t1, s_)
        p, nrm = f.at(a, t), f.normal(a, t)
        d = (f.at(a, t + e) - f.at(a, t - e)).normalized()
        side = d.cross(nrm).normalized()
        x = s_ * spines
        ray = 0.55 + 0.45 * (1 - abs(2 * (x - math.floor(x)) - 1)) ** 2  # each ray a point, a dip between
        h = height * math.sin(math.pi * s_) ** 0.6 * ray + 0.0005
        for px_, fh, dy in prof:
            verts.append(p + side * px_ + nrm * (fh * h + dy))
    np_ = len(prof)
    for k in range(n):
        for j in range(np_):
            j2 = (j + 1) % np_
            faces.append((k * np_ + j, k * np_ + j2, (k + 1) * np_ + j2, (k + 1) * np_ + j))
    faces.append(tuple(range(np_))[::-1])
    faces.append(tuple(range(n * np_, (n + 1) * np_)))
    return verts, faces


def shell_plate(f, RU, a0, a1, t0, t1, off, ribs=7, depth=0.02, free='high', rib_h=0.0035, h=0.0034):
    """A scallop shell of steel over a band of a form: fluted in `ribs` ribs running to its free edge, which is cut into a
    rounded lobe at the end of each rib."""
    of = off if callable(off) else (lambda u, v, o=off: o)
    u0, u1 = a0 * RU, a1 * RU

    def surface(u, v):
        x = clamp((u - u0) / (u1 - u0)) * ribs
        flute = rib_h * (0.5 + 0.5 * math.cos(2 * math.pi * (x - math.floor(x) - 0.5)))
        grow = smooth(t0, t1, v) if free == 'high' else smooth(t1, t0, v)  # the flutes deepen towards the free edge
        return f.point(u / RU, v, of(u, v) + flute * (0.35 + 0.65 * grow))
    return plate(surface, lambda u, v: teeth_sd(u, v, u0, u1, t0, t1, ribs, depth, free, 'round'),
                 u0 - 0.004, u1 + 0.004, t0 - 0.004, t1 + 0.004, h=h)


def abyssal_mats():
    """The sea in its blues: steel blued near black, etched with waves in a pale blue where the deco allows; plates
    lacquered an ocean blue (the shells, the scalloped lames, the fins), etched the same; polished edges of a pale,
    bluish steel."""
    return (mat('abyssal_steel', 0x0b1322, 'blued', engrave='waves', engrave_color=0x2e5680, rough=0.28, metal=0.85),
            mat('abyssal_lacquer', 0x0f3462, 'enamel', engrave='waves', engrave_color=0x3b6e9e, rough=0.3, metal=0.4),
            mat('abyssal_rim', 0x55708a, 'steel', rough=0.22, metal=0.95))


def abyssal_chest():
    """The abyssal harness's cuirass, after a conquistador's: a breastplate of blued steel with a keel and bands etched
    with waves, a backplate, a gorget, a fauld and tassets of overlapping scallop shells, pauldrons of a fluted shell and
    scalloped lames, rerebraces, and couters fluted like shells; the shells and lames lacquered an ocean blue."""
    p = Piece('chest')
    steel, accent, gilt = abyssal_mats()
    F = forms()
    torso, hips, arm, fore = F['torso'], F['hips'], F['arm'], F['forearm']
    trunk = ('spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r')
    edge = dict(solid=0.003, roll=0.0014, roll_mat=gilt)
    RU = 0.17
    front = outline(symmetric([(0.0, 1.488), (0.045, 1.494), (0.08, 1.51), (0.115, 1.528), (0.145, 1.505), (0.17, 1.42),
                               (0.205, 1.345), (0.24, 1.31), (0.258, 1.2), (0.258, 1.065), (0.17, 1.038), (0.08, 1.004), (0.0, 0.985)]), 6)

    def foff(u, v):  # the keel, drawn out over the belly as the peascods of the 1560s were
        return 0.003 + 0.014 * beak(u, 0.12) + 0.02 * beak(u, 0.1) * gauss(v - 1.06, 0.075)
    centre = lambda q: max(smooth(0.016, 0.012, abs(q.x)), smooth(0.01, 0.007, abs(abs(math.atan2(q.x, q.z)) * RU - 0.15))) \
        * smooth(1.0, 1.03, q.y) * (1 if q.z > 0 else 0)
    p.add(steel, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v)), lambda u, v: sd_poly(u, v, front), -0.27, 0.27, 0.97, 1.54),
          deco=(0.014, centre), sharp=25, skin=trunk, **edge)
    back = outline(symmetric([(0.0, 1.53), (0.05, 1.532), (0.09, 1.535), (0.13, 1.51), (0.17, 1.41), (0.21, 1.34), (0.25, 1.3),
                              (0.29, 1.2), (0.29, 1.06), (0.15, 1.012), (0.0, 1.002)]), 6)
    p.add(steel, *plate(lambda u, v: torso.point(math.pi + u / RU, v, 0.0), lambda u, v: sd_poly(u, v, back), -0.3, 0.3, 0.99, 1.545),
          deco=(0.014, lambda q: smooth(0.016, 0.012, abs(q.x)) * smooth(1.02, 1.05, q.y)), skin=trunk, **edge)
    for u, v in ((0.105, 1.505), (0.24, 1.09)):
        for s in (1, -1):
            p.add(gilt, *rivet(torso.point(s * u / RU, v, foff(s * u, v) + 0.0004), torso.normal(s * u / RU, v), 0.004, washer=0.007), skin=trunk)
    neck = Cone(-0.035, 1.48, 0.112, 0.1, 1.57, 0.075, 0.075)
    for k, (lo_, hi_) in enumerate(((1.483, 1.525), (1.517, 1.56))):
        p.add(steel, *band_plate(neck, 0.09, -1.65, 1.65, lo_, hi_, 0.0065 - 0.0025 * k, 0.008), deco=0.008, skin=('neck_01', 'spine_03'), **edge)
    # the fauld, and tassets of three scallop shells over each thigh, each over the next
    p.add(steel, *plate(lambda u, v: hips.point(u / 0.16, v, 0.0), lambda u, v: max(0.966 - v, v - 1.05), -math.pi * 0.16, math.pi * 0.16,
                        0.962, 1.054, periodic=True), deco=0.008, skin=('pelvis', 'spine_01'), **edge)
    tasset = hanging('l')
    for k, (lo_, hi_) in enumerate(((0.88, 0.975), (0.83, 0.905), (0.77, 0.85))):
        both(p, accent, shell_plate(hips, 0.16, 0.1, 1.28, lo_, hi_, 0.01 + 0.0025 * k, 5, 0.018, 'low', 0.0028), tasset, deco=0.009, **edge)  # clear of the cuisses' ridges
    # pauldrons: a fluted shell over the shoulder, three scalloped lames down the arm, the rerebrace below
    capoff = lambda u, v: 0.012
    dome = lambda q: 0.008 * gauss((q - arm.at(0.0, -0.01)).length, 0.06)
    both(p, accent, shell_plate(arm, 0.09, -2.05, 2.05, -0.085, 0.08, capoff, 9, 0.016, 'high', 0.004), ('clavicle_l', 'upperarm_l'),
         bump=dome, deco=0.01, sharp=30, **edge)
    for k, (t0, t1) in enumerate(((0.065, 0.11), (0.095, 0.14), (0.125, 0.17))):
        both(p, accent, teeth_plate(arm, 0.09, -1.85, 1.85, t0, t1, 0.0085 - 0.0025 * k, 6, 0.01, 'high', shape='round'), ('upperarm_l',),
             deco=0.007, **edge)
    both(p, steel, ring_plate(arm, 0.09, 0.16, 0.25, 0.0), ('upperarm_l',), deco=0.007, **edge)
    shell_at = fore.at(-math.pi / 2, 0.0)
    cup = lambda q: 0.008 * gauss((q - shell_at).length, 0.035)
    both(p, accent, plate(lambda u, v: fore.point(u / 0.07, v, 0.006 + 0.0025 * (0.5 + 0.5 * math.cos(9 * math.atan2(v, u / 0.07 + math.pi / 2)))),
                         lambda u, v: sd_ellipse(u, v, -math.pi / 2 * 0.07, 0.0, 0.085, 0.052), -math.pi * 0.07, 0.0, -0.06, 0.06),
         ('upperarm_l', 'lowerarm_l'), bump=cup, deco=0.008, **edge)
    return p


def abyssal_gloves():
    """Vambraces of blued steel with a lacquered fin along the outside of the forearm, and gauntlets with a scalloped,
    lacquered knuckle plate."""
    p = Piece('gloves')
    steel, accent, gilt = abyssal_mats()
    F = forms()
    fore, hand = F['forearm'], F['hand']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=gilt)
    both(p, steel, ring_plate(fore, 0.07, 0.045, 0.2, lambda u, v: 0.003 + 0.004 * beak(u, 0.05)), ('lowerarm_l',), deco=0.008, sharp=28, **edge)
    both(p, accent, limb_fin(fore, 0.0, 0.05, 0.2, 0.022, 4), ('lowerarm_l',), deco=lambda q: 0.0)
    both(p, steel, ring_plate(hand, 0.06, -0.085, 0.006, lambda u, v: 0.003 + 0.02 * smooth(-0.005, -0.085, v)), ('hand_l', 'lowerarm_l'),
         deco=0.007, **edge)
    both(p, steel, band_plate(hand, 0.06, -1.15, 1.15, -0.002, 0.098, 0.006, 0.012), ('hand_l',), deco=0.006, **edge)
    both(p, accent, teeth_plate(hand, 0.06, -1.1, 1.1, 0.065, 0.104, 0.009, 4, 0.01, shape='round'), ('hand_l',), solid=0.002, roll=0.001,
         roll_mat=gilt, deco=0.004)
    for k, (t0, t1) in enumerate(((0.096, 0.126), (0.122, 0.152), (0.148, 0.178), (0.174, 0.205))):
        both(p, steel, band_plate(hand, 0.06, -1.05, 1.05, t0, t1, 0.004 - 0.0006 * k, 0.012 if k == 3 else 0.004), ('hand_l',) + FINGERS_L,
             deco=0.005, **edge)
    both(p, steel, band_plate(hand, 0.06, 1.3, 2.4, 0.015, 0.085, 0.004, 0.012), ('hand_l',) + THUMB_L, deco=0.005, **edge)
    return p


def abyssal_legs():
    """Cuisses of blued steel with bands etched with waves and three lacquered, scalloped lames down the front, and
    poleyns fluted like shells."""
    p = Piece('legs')
    steel, accent, gilt = abyssal_mats()
    F = forms()
    thigh, knee = F['thigh'], F['knee']
    edge = dict(solid=0.003, roll=0.0014, roll_mat=gilt)
    band = lambda q: smooth(0.011, 0.008, abs(math.atan2(q.x - bone('thigh_l').x, q.z - bone('thigh_l').z)) * 0.085)
    both(p, steel, band_plate(thigh, 0.085, -2.0, 1.1, 0.1, 0.4, lambda u, v: 0.003 + 0.005 * beak(u, 0.05), 0.02), ('thigh_l',),
         deco=(0.011, band), sharp=28, **edge)
    for k, (t0, t1) in enumerate(((0.26, 0.31), (0.3, 0.35), (0.34, 0.39))):
        both(p, accent, teeth_plate(thigh, 0.085, -1.7, 0.95, t0, t1, 0.0065 - 0.0012 * k, 5, 0.012, shape='round'), ('thigh_l',), deco=0.006, **edge)
    both(p, accent, shell_plate(knee, 0.065, -1.3, 1.3, -0.055, 0.055, 0.005, 7, 0.012, 'high', 0.003), ('thigh_l', 'calf_l'),
         bump=lambda q: 0.006 * gauss((q - knee.at(0.0, 0.0)).length, 0.035), deco=0.008, **edge)
    return p


def abyssal_feet():
    """From the knee down, in place of the boots: greaves of blued steel etched with waves and a lacquered fin down the
    back of the calf, and sabatons of scalloped lames over a leather shoe."""
    p = Piece('feet')
    steel, accent, gilt = abyssal_mats()
    leather = mat('sole', 0x221a14, 'leather', rough=0.85)
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=gilt)
    shin = lambda q: smooth(0.011, 0.008, abs(math.atan2(q.x - bone('calf_l').x, q.z - bone('calf_l').z)) * 0.06) * smooth(0.12, 0.16, q.y)
    both(p, steel, ring_plate(calf, 0.06, 0.065, 0.43, lambda u, v: 0.003 + 0.004 * beak(u, 0.045) + 0.01 * smooth(0.39, 0.43, v)), ('calf_l',),
         deco=(0.01, shin), sharp=28, **edge)
    both(p, accent, limb_fin(calf, math.pi, 0.1, 0.34, 0.02, 5), ('calf_l',), deco=lambda q: 0.0)
    shoe = ('foot_l', 'ball_l')
    both(p, leather, ring_plate(foot, 0.045, -0.085, 0.25, 0.0), shoe, solid=0.002)
    for k, (t0, t1) in enumerate(((-0.01, 0.045), (0.035, 0.085), (0.075, 0.125), (0.115, 0.165), (0.155, 0.25))):
        off = 0.011 - 0.0025 * k
        lame = band_plate(foot, 0.045, -1.6, 1.6, t0, t1, off, 0.012) if k == 4 else             teeth_plate(foot, 0.045, -1.6, 1.6, t0, t1, off, 4, 0.008, shape='round')
        both(p, accent if k in (1, 3) else steel, lame, ('foot_l',) if k < 2 else shoe, deco=0.006, **edge)
    both(p, steel, band_plate(foot, 0.045, math.pi - 1.2, math.pi + 1.2, -0.085, -0.02, 0.004, 0.01), ('foot_l',), deco=0.006, **edge)
    return p


def form_strap(f, path, width, off, thick=0.0028):
    """A leather strap lying on a form along (a, t) points, `off` metres out from it (a number or a function of (a, t))."""
    of = off if callable(off) else (lambda a, t, o=off: o)
    pts = [f.point(a, t, of(a, t) + thick / 2) for a, t in path]
    ups = [f.normal(a, t) for a, t in path]
    verts, faces = [], []
    m = len(pts)
    for k in range(m):
        p, up = pts[k], ups[k]
        d = (pts[min(k + 1, m - 1)] - pts[max(k - 1, 0)]).normalized()
        side = d.cross(up).normalized() * (width / 2)
        t_ = up * (thick / 2)
        verts += [p + side + t_, p - side + t_, p - side - t_, p + side - t_]
    for k in range(m - 1):
        a_, b_ = k * 4, k * 4 + 4
        faces += [(a_, a_ + 1, b_ + 1, b_), (a_ + 1, a_ + 2, b_ + 2, b_ + 1), (a_ + 2, a_ + 3, b_ + 3, b_ + 2), (a_ + 3, a_, b_, b_ + 3)]
    last = (m - 1) * 4
    faces += [(0, 3, 2, 1), (last, last + 1, last + 2, last + 3)]
    return verts, faces


def line(a0, t0, a1, t1, n=40):
    """(a, t) points from one place on a form to another."""
    return [(lerp(a0, a1, k / n), lerp(t0, t1, k / n)) for k in range(n + 1)]


def ragged_plate(f, RU, a0, a1, t0, t1, off, seed=0.0, depth=0.02, h=0.0034):
    """A strip of worn leather hanging over a band of a form: its lower edge (t1) torn unevenly."""
    of = off if callable(off) else (lambda u, v, o=off: o)
    u0, u1 = a0 * RU, a1 * RU

    def sd(u, v):
        x = (u - u0) / (u1 - u0)
        tear = depth * (0.5 + 0.5 * noise.noise(Vector((x * 6.0 + seed, seed * 1.3, 0.0)))) * (0.6 + 0.4 * abs(math.sin(x * 9 + seed)))
        side = abs(u - (u0 + u1) / 2) - (u1 - u0) / 2
        return max(side, t0 - v, v - (t1 - tear))
    return plate(lambda u, v: f.point(u / RU, v, of(u, v)), sd, u0 - 0.004, u1 + 0.004, t0 - 0.004, t1 + 0.004, h=h)


def ash_mats():
    """Fire-blackened steel, worn bright on the edges, sooty and rusting in the hollows; dark mail; old leather; a
    charcoal wool."""
    return (mat('ash_steel', 0x2b2b2e, 'black', rough=0.68, metal=0.7),
            mat('ash_mail', 0x48494d, 'mail', rough=0.6, metal=0.85),
            mat('ash_leather', 0x33211a, 'leather', rough=0.8),
            mat('ash_wool', 0x2e2b28, 'cloth', rough=0.95))


def ashforged_chest():
    """The ashforged knight's harness, worn through a war: a hauberk of dark mail down to the thighs with sleeves to the
    wrists, over it a ridged breastplate and a backplate of blackened steel, pauldrons of three lames, couters; leather
    straps crossed over the chest through an iron ring, a belt with a buckle and torn leather strips hanging from it
    over the mail; a thick wool scarf wound round the neck."""
    p = Piece('chest')
    steel, mail, leather, wool = ash_mats()
    F = forms()
    torso, hips, arm, fore = F['torso'], F['hips'], F['arm'], F['forearm']
    trunk = ('spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r')
    edge = dict(solid=0.003, roll=0.0013)
    RU = 0.17
    # the hauberk: the body, the sleeves to the wrist, the skirt over both legs to mid-thigh
    # the trunk's weights alone: with the arms' it would come out through the backplate as they swing
    p.add(mail, *ring_plate(torso, RU, 0.99, 1.505, 0.0018), solid=0.002, skin=trunk + ('pelvis', 'neck_01'))
    both(p, mail, ring_plate(arm, 0.08, -0.03, 0.255, 0.0018), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), solid=0.002)
    both(p, mail, ring_plate(fore, 0.06, -0.03, 0.23, 0.0016), ('upperarm_l', 'lowerarm_l', 'hand_l'), solid=0.002)
    p.add(mail, *ring_plate(hips, 0.16, 0.74, 1.005, lambda u, v: 0.002 + 0.012 * smooth(0.95, 0.74, v)), solid=0.002,
          skin=skirt(0.88, 1.0))
    # breastplate and backplate over it
    front = outline(symmetric([(0.0, 1.488), (0.045, 1.494), (0.08, 1.51), (0.115, 1.528), (0.145, 1.505), (0.17, 1.42),
                               (0.205, 1.345), (0.24, 1.3), (0.25, 1.2), (0.22, 1.135), (0.12, 1.11), (0.0, 1.1)]), 6)
    foff = lambda u, v: 0.008 + 0.011 * beak(u, 0.12) + 0.008 * beak(u, 0.1) * gauss(v - 1.2, 0.08)  # clear of the mail
    p.add(steel, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v)), lambda u, v: sd_poly(u, v, front), -0.27, 0.27, 1.09, 1.54),
          bump=dents((torso.point(0.6, 1.3), 0.02, 0.0025), (torso.point(-0.9, 1.22), 0.016, 0.002)), sharp=25, skin=trunk, **edge)
    for s_ in (1, -1):
        for u, v in ((0.03, 1.478), (0.075, 1.494), (0.13, 1.49), (0.165, 1.41), (0.2, 1.34), (0.235, 1.27), (0.215, 1.15), (0.12, 1.122)):
            a = s_ * u / RU
            p.add(steel, *rivet(torso.point(a, v, foff(s_ * u, v) + 0.0003), torso.normal(a, v), 0.0032), skin=trunk)
    back = outline(symmetric([(0.0, 1.53), (0.05, 1.532), (0.09, 1.535), (0.13, 1.51), (0.17, 1.41), (0.21, 1.34), (0.25, 1.3),
                              (0.27, 1.2), (0.2, 1.15), (0.0, 1.14)]), 6)
    p.add(steel, *plate(lambda u, v: torso.point(math.pi + u / RU, v, 0.009), lambda u, v: sd_poly(u, v, back), -0.3, 0.3, 1.13, 1.545),
          skin=trunk, **edge)
    # straps crossed over the breastplate through an iron ring, and the belt
    over = lambda a, t: foff(a * RU, t) + 0.0004
    for s in (1, -1):
        p.add(leather, *form_strap(torso, line(s * 0.66, 1.49, -s * 0.62, 1.07), 0.03, over), skin=trunk)
    ring_at, ring_n = torso.point(0.0, 1.29, foff(0.0, 1.29) + 0.004), torso.normal(0.0, 1.29)
    t_, n_, b_ = frame(ring_n)
    p.add(steel, *tube([ring_at + (t_ * math.cos(k * math.pi / 12) + b_ * math.sin(k * math.pi / 12)) * 0.016 for k in range(24)], 0.0032, 8,
                       closed=True), skin=trunk)
    p.add(leather, *strap(hips, [(2 * math.pi * k / 96, 1.02) for k in range(97)], 0.036, 0.004, 0.015), skin=('pelvis', 'spine_01'))
    bk = hips.point(0.0, 1.02, 0.021)
    p.add(steel, *buckle(bk, hips.normal(0.0, 1.02), Vector((1, 0, 0)), 0.034, 0.042, 0.0025), skin=('pelvis',))
    # torn leather strips hanging from the belt over the skirt, front, sides and back
    strip = lambda side: hanging(side, 0.88, 1.0)
    for k, (a0, a1) in enumerate(((0.05, 0.42), (0.47, 0.84), (0.95, 1.3), (2.35, 2.75), (2.8, 3.1))):
        lo_ = 0.8 if k < 3 else 0.84
        both(p, leather, ragged_plate(hips, 0.16, a0, a1, lo_, 1.01, 0.0175, seed=k * 2.3, depth=0.03), strip('l'), solid=0.0025)
    # pauldrons of a cap and three lames, couters
    both(p, steel, band_plate(arm, 0.09, -2.0, 2.0, -0.08, 0.075, 0.013, 0.03), ('clavicle_l', 'upperarm_l'),
         bump=lambda q: 0.007 * gauss((q - arm.at(0.0, -0.01)).length, 0.06), **edge)
    for k, (t0, t1) in enumerate(((0.06, 0.105), (0.09, 0.135), (0.12, 0.165))):
        both(p, steel, band_plate(arm, 0.09, -1.8, 1.8, t0, t1, 0.0105 - 0.0025 * k, 0.01), ('upperarm_l',), **edge)
        for a in (-1.6, 1.6):
            both(p, steel, rivet(arm.point(a, (t0 + t1) / 2 + 0.008, 0.012 - 0.0025 * k), arm.normal(a, (t0 + t1) / 2 + 0.008), 0.0032), ('upperarm_l',))
    cup = lambda q: 0.008 * gauss((q - fore.at(-math.pi / 2, 0.0)).length, 0.035)
    both(p, steel, plate(lambda u, v: fore.point(u / 0.07, v, 0.008), lambda u, v: sd_ellipse(u, v, -math.pi / 2 * 0.07, 0.0, 0.085, 0.052),
                         -math.pi * 0.07, 0.0, -0.06, 0.06), ('upperarm_l', 'lowerarm_l'), bump=cup, **edge)
    # the scarf, wound thick round the neck
    neck = Cone(-0.045, 1.46, 0.12, 0.125, 1.57, 0.08, 0.08)
    fold = lambda u, v: 0.004 + 0.016 * math.sin(math.pi * clamp((v - 1.455) / 0.095)) ** 0.7 + 0.004 * noise.noise(Vector((u * 40, v * 60, 0.3)))
    p.add(wool, *ring_plate(neck, 0.1, 1.455, 1.55, fold), solid=0.004, skin=('neck_01', 'spine_03', 'clavicle_l', 'clavicle_r'))
    return p


def ashforged_gloves():
    """Vambraces of blackened steel strapped on over the mail sleeves, and plain gauntlets."""
    p = Piece('gloves')
    steel, mail, leather, wool = ash_mats()
    F = forms()
    fore, hand = F['forearm'], F['hand']
    edge = dict(solid=0.0025, roll=0.0011)
    both(p, steel, band_plate(fore, 0.07, -2.2, 2.2, 0.05, 0.2, lambda u, v: 0.006 + 0.004 * beak(u, 0.05), 0.012), ('lowerarm_l',), sharp=28, **edge)
    for t in (0.08, 0.17):
        both(p, leather, ring_plate(fore, 0.07, t - 0.008, t + 0.008, 0.0105), ('lowerarm_l',), solid=0.0022)
    both(p, steel, ring_plate(hand, 0.06, -0.085, 0.006, lambda u, v: 0.004 + 0.018 * smooth(-0.005, -0.085, v)), ('hand_l', 'lowerarm_l'), **edge)
    both(p, steel, band_plate(hand, 0.06, -1.15, 1.15, -0.002, 0.098, 0.006, 0.012), ('hand_l',),
         bump=lambda q: 0.0025 * gauss(q.x - bone('hand_l').x - 0.09, 0.006), **edge)
    for k, (t0, t1) in enumerate(((0.096, 0.126), (0.122, 0.152), (0.148, 0.178), (0.174, 0.205))):
        both(p, steel, band_plate(hand, 0.06, -1.05, 1.05, t0, t1, 0.004 - 0.0006 * k, 0.012 if k == 3 else 0.004), ('hand_l',) + FINGERS_L, **edge)
    both(p, steel, band_plate(hand, 0.06, 1.3, 2.4, 0.015, 0.085, 0.004, 0.012), ('hand_l',) + THUMB_L, **edge)
    return p


def ashforged_legs():
    """Mail chausses over the thighs, with a small worn plate over the front of each, and poleyns with a wing."""
    p = Piece('legs')
    steel, mail, leather, wool = ash_mats()
    F = forms()
    thigh, knee = F['thigh'], F['knee']
    edge = dict(solid=0.003, roll=0.0013)
    both(p, mail, ring_plate(thigh, 0.08, 0.15, 0.46, 0.0018), ('thigh_l', 'calf_l'), solid=0.002)
    both(p, steel, band_plate(thigh, 0.085, -1.3, 0.8, 0.24, 0.42, lambda u, v: 0.006 + 0.004 * beak(u, 0.05), 0.02), ('thigh_l',), sharp=28, **edge)
    dome = lambda q: 0.006 * gauss((q - knee.at(0.0, 0.0)).length, 0.035)
    both(p, steel, band_plate(knee, 0.065, -1.3, 1.3, -0.055, 0.055, 0.007, 0.03), ('thigh_l', 'calf_l'), bump=dome, **edge)
    both(p, steel, plate(lambda u, v: knee.point(u / 0.065, v, 0.006), lambda u, v: sd_ellipse(u, v, -1.6 * 0.065, 0.004, 0.04, 0.034),
                         -2.4 * 0.065, -0.8 * 0.065, -0.036, 0.044), ('thigh_l', 'calf_l'), **edge)
    for t in (-0.045, 0.05):
        both(p, leather, ring_plate(knee, 0.065, t - 0.007, t + 0.007, 0.004), ('thigh_l', 'calf_l'), solid=0.0022)
    return p


def ashforged_feet():
    """From the knee down, in place of the boots: tall boots of old leather with a steel greave strapped over each shin
    and a toe cap."""
    p = Piece('feet')
    steel, mail, leather, wool = ash_mats()
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = dict(solid=0.0025, roll=0.0012)
    p_boot = lambda u, v: 0.002 + 0.006 * smooth(0.12, 0.05, v)  # the leg of the boot, a fold at the top
    both(p, leather, ring_plate(calf, 0.06, 0.05, 0.47, p_boot), ('calf_l',), solid=0.003, roll=0.0016,
         forge=creased(0.0007))
    shoe = ('foot_l', 'ball_l')
    both(p, leather, ring_plate(foot, 0.045, -0.085, 0.25, 0.0), shoe, solid=0.0025, forge=creased(0.0006))
    both(p, steel, band_plate(calf, 0.06, -1.35, 1.35, 0.06, 0.38, lambda u, v: 0.008 + 0.004 * beak(u, 0.045), 0.015), ('calf_l',), sharp=28,
         bump=dents((calf.at(0.3, 0.22), 0.015, 0.002),), **edge)
    for t in (0.12, 0.3):
        both(p, leather, ring_plate(calf, 0.06, t - 0.008, t + 0.008, 0.0125), ('calf_l',), solid=0.0022)
    both(p, steel, band_plate(foot, 0.045, -1.5, 1.5, 0.16, 0.25, 0.0035, 0.012), shoe, **edge)
    return p


def pelt_sd(u, v, u0, u1, t0, t1, locks=8, depth=0.03, seed=0.0, free='high'):
    """A pelt over a band from u0 to u1 and t0 to t1, its free edge (t1 for 'high', t0 for 'low') falling in `locks`
    locks of uneven width and length, each to a point, as a signed distance."""
    x = clamp((u - u0) / (u1 - u0)) * locks
    x += 0.22 * noise.noise(Vector((x * 0.8 + seed, seed, 0.5)))
    k = math.floor(x)
    fr = x - k
    dep = lambda i: depth * (0.45 + 0.55 * (0.5 + 0.5 * noise.noise(Vector((i * 1.37 + seed, 2.1, seed)))))
    notch = lerp(dep(k), dep(k + 1), smooth(0.0, 1.0, fr)) * abs(2 * fr - 1) ** 0.75
    side = abs(u - (u0 + u1) / 2) - (u1 - u0) / 2
    if free == 'low':
        return max(side, v - t1, t0 + notch - v)
    return max(side, t0 - v, v - (t1 - notch))


def furry(amp=0.003, seed=0.0, freq=22.0):
    """Fur's thickness: soft, uneven lumps, drawn out down the hang (y), metres out along the normal. Kept broad and
    shallow so the game's thinned copy still lies where the dense one is (the hairs come from the bake)."""
    def f(p):
        q = Vector((p.x * freq + seed, p.y * freq * 0.36, p.z * freq))
        return amp * (0.6 + 0.5 * noise.noise(q) + 0.25 * noise.noise(q * 2.9))
    return f


def lock(root, down, out, length, r, seed=0.0):
    """A lock of fur: from `root` along `down`, curling a little `out`, tapering to a point, a little crooked."""
    n = 7 if RES <= 1 else 5
    d, o = Vector(down).normalized(), Vector(out).normalized()
    side = d.cross(o).normalized()
    pts, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        wob = 0.18 * length * noise.noise(Vector((seed, t * 2.0, 0.3))) * t
        pts.append(Vector(root) + d * (length * t) + o * (0.25 * length * t * t) + side * wob)
        radii.append(r * (1 - t) ** 0.8 + 0.0005)
    return tube(pts, radii, 7)


def icicle(root, down, length, r, seed=0.0):
    """An icicle: from a little inside the edge it hangs from, along `down`, rippled, tapering to a fine point."""
    d = Vector(down).normalized()
    t_, _, b_ = frame(d)
    bend = t_ * noise.noise(Vector((seed, 0.0, 0.0))) + b_ * noise.noise(Vector((0.0, seed, 0.0)))
    pts, radii = [], []
    n = 7 if RES <= 1 else 5
    for i in range(n):
        t = i / (n - 1)
        pts.append(Vector(root) + d * ((length + r * 0.8) * t - r * 0.8) + bend * (0.12 * length * t * t))
        radii.append(max(0.0003, r * (1 - t) ** 1.25 * (1.0 + 0.12 * math.sin(t * 17 + seed * 3))))
    return tube(pts, radii, 8)


def icicles(f, a0, a1, t, off, count, length, r, down, flare=0.25, seed=0.0):
    """A row of icicles hanging from an edge: `count` of them along the line at distance t on a form (off out from it)
    between angles a0 and a1, uneven in length (some barely begun), each along `down` and leaning `flare` away from
    the form."""
    parts = []
    for k in range(count):
        s = clamp((k + 0.5 + 0.35 * noise.noise(Vector((k * 1.9 + seed, 0.7, 0.0)))) / count)
        a = lerp(a0, a1, s)
        grow = 0.5 + 0.5 * noise.noise(Vector((k * 2.3 + seed, 4.1, 1.0)))
        d = Vector(down).normalized() + f.normal(a, t) * flare
        parts.append(icicle(f.point(a, t, off), d, length * (0.3 + 0.7 * grow), r * (0.65 + 0.5 * grow), seed + k))
    return merge(*parts)


def glacial_mats():
    """Pale steel frosted over, the frost etched in ferns along its borders; a deeper, colder blue steel for the
    plackart, the visor and alternate lames; polished silvery edges; white fur; clear ice; a worn blue-grey cloth."""
    return (mat('glacial_steel', 0x7f9fbc, 'steel', engrave='frost', rough=0.32, metal=0.85, frost=0.42),
            mat('glacial_deep', 0x2f4d6b, 'steel', engrave='frost', rough=0.3, metal=0.85, frost=0.3),
            mat('glacial_rim', 0xc6d6e3, 'steel', rough=0.2, metal=0.95, frost=0.2),
            mat('glacial_fur', 0xe6ebee, 'fur', rough=0.95),
            mat('glacial_ice', 0xbfe4f4, 'ice', rough=0.05),
            mat('glacial_cloth', 0x34404e, 'cloth', rough=0.95, frost=0.35))


def glacial_chest():
    """The glacial knight's harness, frosted over: a rounded breastplate with a ridge down the middle and a plackart of
    a colder blue over the belly rising to a point, a backplate, a fauld and long tassets nearly to the knees with
    icicles hanging from them, worn strips of cloth behind; pauldrons of a cap and four lames hung with icicles under a
    white fur pelt thrown over the left shoulder, the fur gathered round the neck, thick on that side; rerebraces and
    couters with a fan."""
    p = Piece('chest')
    p.min_ratio, p.budget = 0.03, 14000  # the fur is kept whole, and with the icicles needs more room than a plain cuirass
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    F = forms()
    torso, hips, arm, fore = F['torso'], F['hips'], F['arm'], F['forearm']
    trunk = ('spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r')
    edge = dict(solid=0.003, roll=0.0014, roll_mat=rim)
    RU = 0.17
    down = (0.0, -1.0, 0.0)
    front = outline(symmetric([(0.0, 1.488), (0.045, 1.494), (0.08, 1.51), (0.115, 1.528), (0.145, 1.505), (0.17, 1.42),
                               (0.205, 1.345), (0.24, 1.31), (0.258, 1.2), (0.258, 1.065), (0.17, 1.038), (0.08, 1.004), (0.0, 0.988)]), 6)
    foff = lambda u, v: 0.003 + 0.012 * beak(u, 0.12) + 0.007 * beak(u, 0.1) * gauss(v - 1.24, 0.1)
    ridge = lambda q: smooth(0.022, 0.016, abs(q.x)) * smooth(1.27, 1.3, q.y) * (1 if q.z > 0 else 0)
    p.add(steel, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v)), lambda u, v: sd_poly(u, v, front), -0.27, 0.27, 0.97, 1.54),
          deco=(0.018, ridge), sharp=25, skin=trunk, **edge)
    plack = outline(symmetric([(0.0, 1.275), (0.035, 1.225), (0.1, 1.16), (0.19, 1.115), (0.245, 1.09), (0.252, 1.06), (0.17, 1.032),
                               (0.08, 0.998), (0.0, 0.982)]), 6)
    p.add(deep, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v) + 0.0035), lambda u, v: sd_poly(u, v, plack), -0.26, 0.26, 0.975, 1.28),
          deco=lambda q: 1.0, sharp=25, skin=trunk, **edge)
    for u, v in ((0.0, 1.252), (0.03, 1.212), (-0.03, 1.212), (0.215, 1.09), (-0.215, 1.09)):
        p.add(rim, *rivet(torso.point(u / RU, v, foff(u, v) + 0.0039), torso.normal(u / RU, v), 0.0034), skin=trunk)
    back = outline(symmetric([(0.0, 1.53), (0.05, 1.532), (0.09, 1.535), (0.13, 1.51), (0.17, 1.41), (0.21, 1.34), (0.25, 1.3),
                              (0.29, 1.2), (0.29, 1.06), (0.15, 1.012), (0.0, 1.002)]), 6)
    p.add(steel, *plate(lambda u, v: torso.point(math.pi + u / RU, v, 0.0), lambda u, v: sd_poly(u, v, back), -0.3, 0.3, 0.99, 1.545),
          deco=0.018, skin=trunk, **edge)
    # the fauld round the waist; long tassets over the front of each thigh, shorter ones behind, icicles under the last
    hip_skin = ('pelvis', 'spine_01')
    for k, (lo_, hi_) in enumerate(((0.966, 1.05), (0.918, 0.984))):
        p.add(steel if k == 0 else deep, *plate(lambda u, v, k=k: hips.point(u / 0.16, v, 0.0025 * k), lambda u, v, lo_=lo_, hi_=hi_: max(lo_ - v, v - hi_),
                                                 -math.pi * 0.16, math.pi * 0.16, lo_ - 0.004, hi_ + 0.004, periodic=True), deco=0.008, skin=hip_skin, **edge)
    tasset = hanging('l')
    lames = ((0.875, 0.94), (0.82, 0.888), (0.765, 0.834), (0.71, 0.778), (0.655, 0.724))
    for k, (lo_, hi_) in enumerate(lames):
        off = 0.006 + 0.0025 * k
        both(p, steel, band_plate(hips, 0.16, 0.12, 1.3, lo_, hi_, off, 0.012 if k == 4 else 0.004), tasset,
             deco=0.008, **edge)
    both(p, ice, icicles(hips, 0.22, 1.2, 0.658, 0.006 + 0.01 - 0.0015, 7, 0.075, 0.0075, down, 0.2, 1.0), tasset)
    for k, (lo_, hi_) in enumerate(((0.875, 0.94), (0.82, 0.888), (0.765, 0.834))):
        both(p, steel, band_plate(hips, 0.16, 1.75, 2.95, lo_, hi_, 0.006 + 0.0025 * k, 0.012 if k == 2 else 0.004), tasset,
             deco=0.008, **edge)
    both(p, ice, icicles(hips, 1.85, 2.45, 0.768, 0.011 - 0.0015, 3, 0.05, 0.0065, down, 0.2, 7.0), tasset)
    # worn strips of cloth hanging behind, over the back tassets
    strip = lambda side: hanging(side, 0.88, 1.0)
    for k, (a0, a1) in enumerate(((math.pi - 0.3, math.pi - 0.04), (math.pi - 0.62, math.pi - 0.34))):
        both(p, cloth, ragged_plate(hips, 0.16, a0, a1, 0.62 + 0.05 * k, 1.0, 0.0175, seed=k * 3.1 + 0.5, depth=0.04), strip('l'), solid=0.0022,
             forge=creased(0.0012, k * 1.3))
    # pauldrons: a cap and four lames, each over the next, the last hung with icicles; the rerebrace below
    dome = lambda q: 0.008 * gauss((q - arm.at(0.0, -0.01)).length, 0.06)
    both(p, steel, band_plate(arm, 0.09, -2.05, 2.05, -0.085, 0.075, 0.013, 0.03), ('clavicle_l', 'upperarm_l'), bump=dome, deco=0.012,
         sharp=30, **edge)
    for k, (t0, t1) in enumerate(((0.055, 0.1), (0.083, 0.128), (0.111, 0.156), (0.139, 0.184))):
        both(p, steel, band_plate(arm, 0.09, -1.85, 1.85, t0, t1, 0.011 - 0.0025 * k, 0.006), ('upperarm_l',),
             deco=0.007, **edge)
    both(p, ice, icicles(arm, -1.7, 1.7, 0.182, 0.0035 - 0.0015, 8, 0.06, 0.0065, (1.0, 0.0, 0.0), 0.35, 3.0), ('upperarm_l',))
    both(p, steel, ring_plate(arm, 0.09, 0.17, 0.25, 0.0), ('upperarm_l',), deco=0.007, **edge)
    # couters: a cup over the back of the elbow and a fan on its outside, icicles under the cup
    cup = lambda q: 0.008 * gauss((q - fore.at(-math.pi / 2, 0.0)).length, 0.035)
    both(p, steel, plate(lambda u, v: fore.point(u / 0.07, v, 0.006), lambda u, v: sd_ellipse(u, v, -math.pi / 2 * 0.07, 0.0, 0.085, 0.052),
                         -math.pi * 0.07, 0.0, -0.06, 0.06), ('upperarm_l', 'lowerarm_l'), bump=cup, deco=0.008, **edge)
    both(p, deep, plate(lambda u, v: fore.point(u / 0.07, v, 0.0105), lambda u, v: sd_ellipse(u, v, -0.5 * 0.07, 0.0, 0.03, 0.04),
                        -1.1 * 0.07, 0.05 * 0.07, -0.045, 0.045), ('upperarm_l', 'lowerarm_l'), deco=0.006, **edge)
    both(p, ice, icicles(fore, -1.95, -1.2, 0.046, 0.006 - 0.0015, 3, 0.045, 0.0055, (1.0, 0.0, 0.0), 0.3, 11.0), ('lowerarm_l',))
    # the fur: gathered round the neck, thick on the left, and a pelt thrown over the left shoulder, both falling in locks
    collar = Cone(-0.035, 1.45, 0.128, 0.118, 1.57, 0.08, 0.08)

    def collar_pt(a, t, off):  # the cone, pushed out past the cuirass where it would sink into it
        q = collar.at(a, t)
        need = torso.radius(math.atan2(q.x, q.z), min(t, 1.56)) + 0.03 * smooth(1.575, 1.53, t)
        r = math.hypot(q.x, q.z)
        if r < need:
            q = Vector((q.x * need / r, q.y, q.z * need / r))
        return q + collar.normal(a, t) * off
    left = lambda a: (0.5 + 0.5 * math.sin(a)) ** 1.5  # 1 over the left shoulder, 0 over the right
    thick = lambda u, v: 0.006 + (0.004 + 0.02 * left(u / 0.1)) * math.sin(math.pi * clamp((v - 1.40) / 0.155)) ** 0.6
    fur_skin = ('neck_01', 'spine_03', 'clavicle_l', 'clavicle_r')
    p.add(fur, *plate(lambda u, v: collar_pt(u / 0.1, v, thick(u, v)),
                      lambda u, v: max(v - 1.555, pelt_sd(u, v, -math.pi * 0.1, math.pi * 0.1, 1.39 + 0.1 * (1 - left(u / 0.1)), 1.6, 18, 0.03, 0.7, 'low')),
                      -math.pi * 0.1, math.pi * 0.1, 1.37, 1.56, h=0.004 if RES <= 1 else 0.0075, periodic=True), solid=0.006, bump=furry(0.003, 1.0),
          forge=False, sharp=80, skin=fur_skin, whole=True)
    pelt = lambda u, v: pelt_sd(u, v, -2.35 * 0.09, 2.35 * 0.09, -0.085, 0.11, 9, 0.045, 2.0, 'high')
    poff = lambda u, v: 0.034 + 0.01 * smooth(0.06, -0.07, v)
    p.add(fur, *plate(lambda u, v: arm.point(u / 0.09, v, poff(u, v)), pelt, -2.4 * 0.09, 2.4 * 0.09, -0.09, 0.115, h=0.004 if RES <= 1 else 0.0075),
          solid=0.008, bump=furry(0.0035, 3.0), forge=False, sharp=80, skin=('clavicle_l', 'upperarm_l', 'spine_03'), whole=True)
    locks = []
    for k in range(11):
        a = lerp(-2.1, 2.1, (k + 0.5) / 11) + 0.12 * noise.noise(Vector((k * 1.3, 0.4, 0.0)))
        t = 0.07 + 0.02 * noise.noise(Vector((k * 2.1, 1.3, 0.0)))
        locks.append(lock(arm.point(a, t, poff(a * 0.09, t) - 0.004), (1.0, -0.15, 0.0), arm.normal(a, t), 0.045 + 0.02 * noise.noise(Vector((k, 3.0, 0.0))),
                          0.009, k * 1.7))
    p.add(fur, *merge(*locks), skin=('upperarm_l', 'clavicle_l'))
    locks = []
    for k in range(9):
        a = lerp(0.3, 2.85, (k + 0.5) / 9) + 0.1 * noise.noise(Vector((k * 1.7, 2.4, 0.0)))
        t = 1.42 + 0.08 * (1 - left(a))
        q = collar_pt(a, t, thick(a * 0.1, t) - 0.004)
        out = Vector((q.x, 0.0, q.z - collar.zc)).normalized()
        locks.append(lock(q, (0.0, -1.0, 0.0), out, (0.03 + 0.025 * left(a)) * (0.8 + 0.3 * noise.noise(Vector((k, 5.0, 0.0)))), 0.008, k * 2.3 + 9))
    p.add(fur, *merge(*locks), skin=fur_skin)
    return p


def glacial_gloves():
    """Vambraces of pale steel etched with frost along their edges, and gauntlets: a flared cuff, a plate of colder blue
    over the back of the hand with a ridged knuckle plate, four lames over the fingers and one over the thumb."""
    p = Piece('gloves')
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    F = forms()
    fore, hand = F['forearm'], F['hand']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=rim)
    both(p, steel, ring_plate(fore, 0.07, 0.045, 0.2, lambda u, v: 0.003 + 0.004 * beak(u, 0.05)), ('lowerarm_l',), deco=0.012, sharp=28, **edge)
    both(p, steel, ring_plate(hand, 0.06, -0.085, 0.006, lambda u, v: 0.003 + 0.02 * smooth(-0.005, -0.085, v)), ('hand_l', 'lowerarm_l'),
         deco=0.008, **edge)
    both(p, deep, band_plate(hand, 0.06, -1.15, 1.15, -0.002, 0.098, 0.006, 0.012), ('hand_l',), deco=0.008, **edge)
    both(p, steel, band_plate(hand, 0.06, -1.1, 1.1, 0.07, 0.104, 0.0095, 0.008), ('hand_l',),
         bump=lambda q: 0.0025 * gauss(q.x - bone('hand_l').x - 0.087, 0.005), deco=0.005, **edge)
    for k, (t0, t1) in enumerate(((0.096, 0.126), (0.122, 0.152), (0.148, 0.178), (0.174, 0.205))):
        both(p, steel, band_plate(hand, 0.06, -1.05, 1.05, t0, t1, 0.004 - 0.0006 * k, 0.012 if k == 3 else 0.004), ('hand_l',) + FINGERS_L,
             deco=0.005, **edge)
    both(p, steel, band_plate(hand, 0.06, 1.3, 2.4, 0.015, 0.085, 0.004, 0.012), ('hand_l',) + THUMB_L, deco=0.005, **edge)
    return p


def glacial_legs():
    """Cuisses of pale steel etched with frost, three lames of it and of colder blue over the knee, and poleyns with a
    fan, icicles hanging from them."""
    p = Piece('legs')
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    F = forms()
    thigh, knee = F['thigh'], F['knee']
    edge = dict(solid=0.003, roll=0.0014, roll_mat=rim)
    band = lambda q: smooth(0.011, 0.008, abs(math.atan2(q.x - bone('thigh_l').x, q.z - bone('thigh_l').z)) * 0.085)
    both(p, steel, band_plate(thigh, 0.085, -2.0, 1.1, 0.1, 0.4, lambda u, v: 0.003 + 0.005 * beak(u, 0.05), 0.02), ('thigh_l',),
         deco=(0.014, band), sharp=28, **edge)
    for k, (t0, t1) in enumerate(((0.3, 0.345), (0.335, 0.38), (0.37, 0.415))):
        both(p, steel, band_plate(thigh, 0.085, -1.7, 0.95, t0, t1, 0.0075 - 0.0012 * k, 0.006), ('thigh_l',),
             deco=0.006, **edge)
    dome = lambda q: 0.006 * gauss((q - knee.at(0.0, 0.0)).length, 0.035)
    both(p, steel, band_plate(knee, 0.065, -1.3, 1.3, -0.055, 0.055, 0.005, 0.03), ('thigh_l', 'calf_l'), bump=dome, deco=0.008, **edge)
    both(p, deep, plate(lambda u, v: knee.point(u / 0.065, v, 0.004), lambda u, v: sd_ellipse(u, v, -1.6 * 0.065, 0.004, 0.04, 0.034),
                        -2.4 * 0.065, -0.8 * 0.065, -0.036, 0.044), ('thigh_l', 'calf_l'), deco=0.007, **edge)
    both(p, ice, icicles(knee, -0.75, 0.75, 0.05, 0.005 - 0.0015, 5, 0.04, 0.0055, (0.0, -1.0, 0.0), 0.45, 5.0), ('thigh_l', 'calf_l'))
    return p


def glacial_feet():
    """From the knee down, in place of the boots: greaves of pale steel closed round the shins with a plate of colder
    blue over the shin rising to a point under the knee, and sabatons - steel lames over a leather shoe, each over the
    next, a rounded toe cap and a heel plate."""
    p = Piece('feet')
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    leather = mat('sole', 0x1e2226, 'leather', rough=0.85)
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=rim)
    both(p, steel, ring_plate(calf, 0.06, 0.065, 0.43, lambda u, v: 0.003 + 0.01 * smooth(0.39, 0.43, v)), ('calf_l',), deco=0.012, **edge)
    both(p, deep, teeth_plate(calf, 0.06, -0.95, 0.95, 0.07, 0.385, lambda u, v: 0.0058 + 0.005 * beak(u, 0.04), 1, 0.06, 'low'), ('calf_l',),
         deco=0.01, sharp=28, **edge)
    shoe = ('foot_l', 'ball_l')
    both(p, leather, ring_plate(foot, 0.045, -0.085, 0.25, 0.0), shoe, solid=0.002)
    for k, (t0, t1) in enumerate(((-0.01, 0.04), (0.035, 0.08), (0.075, 0.12), (0.115, 0.16), (0.155, 0.25))):
        both(p, steel, band_plate(foot, 0.045, -1.6, 1.6, t0, t1, 0.011 - 0.0025 * k, 0.012 if k == 4 else 0.004),
             ('foot_l',) if k < 2 else shoe, deco=0.006, **edge)
    both(p, steel, band_plate(foot, 0.045, math.pi - 1.2, math.pi + 1.2, -0.085, -0.02, 0.004, 0.01), ('foot_l',), deco=0.006, **edge)
    return p


def emerald_mats():
    """A beetle's shell: an emerald lacquer, glossy, shifting to teal in broad patches, worked in big rounded scales,
    every plate bordered in polished silver; the same lacquer smooth; polished, etched silver for the belt and the
    bosses; dark mail under it all; a darker, glassy green for the visor and the stones."""
    trim = 0xb7bcc2
    return (mat('emerald_scale', 0x09502f, 'enamel', engrave='scales', emboss=True, rough=0.18, metal=0.5, bump=1.0, trim=trim, sheen=0x12806b,
                gloss=0.85, scale=0.16),
            mat('emerald_smooth', 0x08472b, 'enamel', rough=0.15, metal=0.5, trim=trim, sheen=0x10745f, gloss=0.9),
            mat('emerald_silver', trim, 'steel', engrave='vines', rough=0.22, metal=0.95),
            mat('emerald_mail', 0x34373b, 'mail', rough=0.5, metal=0.85),
            mat('emerald_glass', 0x08402c, 'enamel', rough=0.06, metal=0.3, sheen=0x0f6e5c, gloss=0.95))


def trimmed(w=0.009):
    """A silver border `w` wide along a plate's edges (the deco mask low there, for a material with a trim)."""
    return lambda q, d: smooth(w, w + 0.004, d)


def ribbon_sd(u, v, spine, widths):
    """Signed distance to a band along a polyline of (u, v) points, its half-width at each point given (0 at an end
    draws it out to a point, as a feather's tip)."""
    best = 1e9
    for k in range(len(spine) - 1):
        (u0, v0), (u1, v1) = spine[k], spine[k + 1]
        du, dv = u1 - u0, v1 - v0
        t = clamp(((u - u0) * du + (v - v0) * dv) / (du * du + dv * dv + 1e-18))
        best = min(best, math.hypot(u - u0 - du * t, v - v0 - dv * t) - lerp(widths[k], widths[k + 1], t))
    return best


def gem(at, normal, r=0.008):
    """A cabochon in a silver setting: a domed stone on a rosette."""
    t, n, b = frame(normal)
    return oball(Vector(at) + n * (r * 0.15), (r, r * 0.6, r), (t, n, b), 12, 7)


def emerald_chest():
    """After the user's emerald knights: a hauberk of dark mail under everything, its sleeves and a collar up the neck
    showing; a breastplate of emerald lacquer worked in big rounded scales with a silver V below the chest, a smooth
    plate over the upper chest coming down to a point at the breastbone with a silver boss and an emerald, a backplate,
    an etched silver belt with a buckle plate, a skirt of scaled lames with scalloped edges; pauldrons of a domed cap
    and four scalloped lames like feathers, couters drawn out to a point past the elbow;
    silver borders on every plate."""
    p = Piece('chest')
    p.min_ratio = 0.035  # the hauberk under it takes room; its broad plates thin well
    scale, smooth_, silver, mail, glass = emerald_mats()
    F = forms()
    torso, hips, arm, fore = F['torso'], F['hips'], F['arm'], F['forearm']
    trunk = ('spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r')
    edge = dict(solid=0.003, roll=0.0014, roll_mat=silver)
    RU = 0.17
    # the hauberk: the body, sleeves to mid-forearm, a skirt to mid-thigh, a collar up the neck
    # the trunk's weights alone: with the arms' it would come out through the backplate as they swing
    p.add(mail, *ring_plate(torso, RU, 0.99, 1.505, 0.0018), solid=0.002, skin=trunk + ('pelvis', 'neck_01'))
    both(p, mail, ring_plate(arm, 0.08, -0.03, 0.255, 0.0018), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), solid=0.002)
    both(p, mail, ring_plate(fore, 0.06, -0.03, 0.1, 0.0016), ('upperarm_l', 'lowerarm_l'), solid=0.002)
    p.add(mail, *ring_plate(hips, 0.16, 0.74, 1.005, lambda u, v: 0.002 + 0.003 * smooth(0.95, 0.74, v)), solid=0.002,
          skin=skirt())
    neckc = Cone(-0.045, 1.46, 0.125, 0.125, 1.6, 0.078, 0.082)
    p.add(mail, *ring_plate(neckc, 0.1, 1.46, 1.6, 0.003), solid=0.002, skin=('neck_01', 'spine_03', 'clavicle_l', 'clavicle_r', 'Head'))
    # the breastplate, a silver V below the chest
    front = outline(symmetric([(0.0, 1.488), (0.045, 1.494), (0.08, 1.51), (0.115, 1.528), (0.145, 1.505), (0.17, 1.42),
                               (0.205, 1.345), (0.24, 1.31), (0.258, 1.2), (0.258, 1.065), (0.17, 1.038), (0.08, 1.004), (0.0, 0.988)]), 6)
    foff = lambda u, v: 0.008 + 0.01 * beak(u, 0.12) + 0.006 * beak(u, 0.1) * gauss(v - 1.2, 0.1)  # clear of the mail
    V = [(-0.215, 1.375), (0.0, 1.232), (0.215, 1.375)]

    def vtrim(q, d):
        u, v = math.atan2(q.x, q.z) * RU, q.y
        dv = min(seg_dist(u, v, V[0], V[1]), seg_dist(u, v, V[1], V[2]))
        return min(smooth(0.009, 0.013, d), smooth(0.005, 0.008, dv) if q.z > 0 else 1.0)
    p.add(scale, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v)), lambda u, v: sd_poly(u, v, front), -0.27, 0.27, 0.97, 1.54),
          deco=vtrim, sharp=25, skin=trunk, **edge)
    # the smooth plate over the upper chest, down to a point at the breastbone, the boss and its stone
    upper = outline(symmetric([(0.0, 1.352), (0.05, 1.392), (0.1, 1.437), (0.135, 1.475), (0.15, 1.505), (0.115, 1.528), (0.08, 1.51),
                               (0.045, 1.494), (0.0, 1.488)]), 6)
    p.add(smooth_, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v) + 0.004), lambda u, v: sd_poly(u, v, upper), -0.17, 0.17, 1.34, 1.54),
          deco=trimmed(0.008), sharp=25, skin=trunk, **edge)
    boss_at, boss_n = torso.point(0.0, 1.372, foff(0.0, 1.372) + 0.0045), torso.normal(0.0, 1.372)
    p.add(silver, *rivet(boss_at, boss_n, 0.011, washer=0.017), skin=trunk)
    p.add(glass, *gem(boss_at + boss_n * 0.004, boss_n, 0.0075), skin=trunk)
    back = outline(symmetric([(0.0, 1.53), (0.05, 1.532), (0.09, 1.535), (0.13, 1.51), (0.17, 1.41), (0.21, 1.34), (0.25, 1.3),
                              (0.29, 1.2), (0.29, 1.06), (0.15, 1.012), (0.0, 1.002)]), 6)
    p.add(scale, *plate(lambda u, v: torso.point(math.pi + u / RU, v, 0.009), lambda u, v: sd_poly(u, v, back), -0.3, 0.3, 0.99, 1.545),
          deco=trimmed(), skin=trunk, **edge)
    # the fauld and the skirt of scaled lames, scalloped
    hip_skin = ('pelvis', 'spine_01')
    p.add(scale, *plate(lambda u, v: hips.point(u / 0.16, v, 0.005), lambda u, v: max(0.95 - v, v - 1.035), -math.pi * 0.16, math.pi * 0.16,
                        0.946, 1.039, periodic=True), deco=trimmed(0.008), skin=hip_skin, **edge)
    p.add(scale, *plate(lambda u, v: hips.point(u / 0.16, v, 0.0075),
                        lambda u, v: teeth_sd(u, v, -math.pi * 0.16, math.pi * 0.16, 0.89, 0.96, 20, 0.014, 'low', 'round'),
                        -math.pi * 0.16, math.pi * 0.16, 0.886, 0.964, periodic=True), deco=trimmed(0.007), skin=hip_skin, **edge)
    panel = outline(symmetric([(0.0, 0.93), (0.036, 0.93), (0.036, 0.79), (0.022, 0.756), (0.0, 0.74)]), 6)  # in front, under the tassets
    p.add(scale, *plate(lambda u, v: hips.point(u / 0.16, v, 0.0065), lambda u, v: sd_poly(u, v, panel), -0.046, 0.046, 0.735, 0.935),
          deco=trimmed(0.007), skin=('pelvis',), **edge)
    tasset = hanging('l')
    for k, (lo_, hi_) in enumerate(((0.835, 0.91), (0.775, 0.85), (0.71, 0.79))):
        both(p, scale, teeth_plate(hips, 0.16, 0.12, 1.3, lo_, hi_, 0.01 + 0.0025 * k, 3, 0.018, 'low', shape='round'), tasset,
             deco=trimmed(0.008), **edge)
    for k, (lo_, hi_) in enumerate(((0.835, 0.91), (0.775, 0.85))):
        both(p, scale, teeth_plate(hips, 0.16, 1.75, 2.95, lo_, hi_, 0.01 + 0.0025 * k, 3, 0.016, 'low', shape='round'), tasset,
             deco=trimmed(0.008), **edge)
    # the belt, etched silver, a buckle plate in front with a stone
    p.add(silver, *strap(hips, [(2 * math.pi * k / 96, 1.0) for k in range(97)], 0.042, 0.004, 0.024), skin=hip_skin)
    p.add(silver, *band_plate(hips, 0.16, -0.3, 0.3, 0.972, 1.028, 0.03, 0.01), solid=0.003, roll=0.0012, skin=hip_skin)
    p.add(glass, *gem(hips.point(0.0, 1.0, 0.0305), hips.normal(0.0, 1.0), 0.0085), skin=hip_skin)
    # pauldrons: a domed cap, four scalloped lames like feathers, each over the next
    capoff = lambda u, v: (0.024 + 0.006 * beak(u, 0.03)) * (0.5 + 0.5 * smooth(-0.095, -0.035, v))  # closing in by the neck
    dome = lambda q: 0.014 * gauss((q - arm.at(0.0, -0.01)).length, 0.07)
    both(p, scale, band_plate(arm, 0.09, -2.3, 2.3, -0.095, 0.095, capoff, 0.03), ('clavicle_l', 'upperarm_l'), bump=dome, deco=trimmed(0.011),
         sharp=30, **edge)
    for k, (t0, t1) in enumerate(((0.06, 0.125), (0.1, 0.165), (0.14, 0.205), (0.18, 0.245))):
        flare = lambda u, v, t0=t0, t1=t1, k=k: 0.02 - 0.003 * k + 0.012 * smooth(t0, t1, v)
        both(p, scale, teeth_plate(arm, 0.09, -2.1, 2.1, t0, t1, flare, 3, 0.026, 'high', shape='round'), ('upperarm_l',),
             deco=trimmed(0.009), **edge)
    # couters: a cup over the elbow drawn out to a point up the back of the arm
    uc = -math.pi / 2 * 0.07
    leaf = outline([(uc, -0.115), (uc + 0.03, -0.065), (uc + 0.046, -0.005), (uc + 0.032, 0.04), (uc, 0.056), (uc - 0.032, 0.04),
                    (uc - 0.046, -0.005), (uc - 0.03, -0.065)], 6)
    cup = lambda q: 0.007 * gauss((q - fore.at(-math.pi / 2, 0.0)).length, 0.035)
    both(p, scale, plate(lambda u, v: fore.point(u / 0.07, v, 0.008), lambda u, v: sd_poly(u, v, leaf), uc - 0.06, uc + 0.06, -0.125, 0.065),
         ('upperarm_l', 'lowerarm_l'), bump=cup, deco=trimmed(0.007), sharp=30, **edge)
    return p


def emerald_gloves():
    """Vambraces of smooth lacquer, a long scaled feather down the outside of each forearm drawn to a point past the
    elbow, and gauntlets: a flared cuff, a scaled plate over the back of the hand, a knuckle plate, four lames over the
    fingers and one over the thumb; silver borders."""
    p = Piece('gloves')
    scale, smooth_, silver, mail, glass = emerald_mats()
    F = forms()
    fore, hand = F['forearm'], F['hand']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=silver)
    both(p, smooth_, ring_plate(fore, 0.07, 0.045, 0.2, lambda u, v: 0.003 + 0.004 * beak(u, 0.05)), ('lowerarm_l',), deco=trimmed(0.007), sharp=28,
         **edge)
    fe = [(-0.4 * 0.07, 0.205), (-0.4 * 0.07, 0.1), (-0.45 * 0.07, 0.0), (-0.5 * 0.07, -0.06)]
    both(p, scale, plate(lambda u, v: fore.point(u / 0.07, v, 0.0085), lambda u, v: ribbon_sd(u, v, fe, [0.022, 0.026, 0.018, 0.0]),
                         -0.09, 0.03, -0.07, 0.23), ('lowerarm_l',), deco=trimmed(0.006), sharp=30, **edge)
    both(p, smooth_, ring_plate(hand, 0.06, -0.085, 0.006, lambda u, v: 0.003 + 0.02 * smooth(-0.005, -0.085, v)), ('hand_l', 'lowerarm_l'),
         deco=trimmed(0.007), **edge)
    both(p, scale, band_plate(hand, 0.06, -1.15, 1.15, -0.002, 0.098, 0.006, 0.012), ('hand_l',), deco=trimmed(0.007), **edge)
    both(p, smooth_, band_plate(hand, 0.06, -1.1, 1.1, 0.07, 0.104, 0.0095, 0.008), ('hand_l',),
         bump=lambda q: 0.0025 * gauss(q.x - bone('hand_l').x - 0.087, 0.005), deco=trimmed(0.004), **edge)
    for k, (t0, t1) in enumerate(((0.096, 0.126), (0.122, 0.152), (0.148, 0.178), (0.174, 0.205))):
        both(p, smooth_, band_plate(hand, 0.06, -1.05, 1.05, t0, t1, 0.004 - 0.0006 * k, 0.012 if k == 3 else 0.004), ('hand_l',) + FINGERS_L,
             deco=trimmed(0.004), **edge)
    both(p, smooth_, band_plate(hand, 0.06, 1.3, 2.4, 0.015, 0.085, 0.004, 0.012), ('hand_l',) + THUMB_L, deco=trimmed(0.004), **edge)
    return p


def emerald_legs():
    """Mail chausses over the thighs, which the emerald knights leave bare of plate, and poleyns of smooth lacquer with a
    scaled wing; silver borders."""
    p = Piece('legs')
    scale, smooth_, silver, mail, glass = emerald_mats()
    F = forms()
    thigh, knee = F['thigh'], F['knee']
    edge = dict(solid=0.003, roll=0.0014, roll_mat=silver)
    both(p, mail, ring_plate(thigh, 0.08, 0.1, 0.46, 0.0018), ('thigh_l', 'calf_l'), solid=0.002)  # from under the hauberk's skirt
    dome = lambda q: 0.006 * gauss((q - knee.at(0.0, 0.0)).length, 0.035)
    both(p, smooth_, band_plate(knee, 0.065, -1.3, 1.3, -0.055, 0.055, 0.005, 0.03), ('thigh_l', 'calf_l'), bump=dome, deco=trimmed(0.007), **edge)
    both(p, scale, plate(lambda u, v: knee.point(u / 0.065, v, 0.004), lambda u, v: sd_ellipse(u, v, -1.6 * 0.065, 0.004, 0.04, 0.034),
                         -2.4 * 0.065, -0.8 * 0.065, -0.036, 0.044), ('thigh_l', 'calf_l'), deco=trimmed(0.006), **edge)
    return p


def emerald_feet():
    """From the knee down, in place of the boots: greaves of scaled lacquer closed round the shins with a smooth plate
    over the shin rising to a point under the knee, and sabatons of smooth lames over a leather shoe, each over the
    next, a rounded toe cap and a heel plate; silver borders."""
    p = Piece('feet')
    scale, smooth_, silver, mail, glass = emerald_mats()
    leather = mat('sole', 0x1a1d1a, 'leather', rough=0.85)
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = dict(solid=0.0025, roll=0.0012, roll_mat=silver)
    both(p, scale, ring_plate(calf, 0.06, 0.065, 0.43, lambda u, v: 0.003 + 0.01 * smooth(0.39, 0.43, v)), ('calf_l',), deco=trimmed(), **edge)
    both(p, smooth_, teeth_plate(calf, 0.06, -0.95, 0.95, 0.07, 0.385, lambda u, v: 0.0058 + 0.005 * beak(u, 0.04), 1, 0.06, 'low'), ('calf_l',),
         deco=trimmed(0.007), sharp=28, **edge)
    shoe = ('foot_l', 'ball_l')
    both(p, leather, ring_plate(foot, 0.045, -0.085, 0.25, 0.0), shoe, solid=0.002)
    for k, (t0, t1) in enumerate(((-0.01, 0.04), (0.035, 0.08), (0.075, 0.12), (0.115, 0.16), (0.155, 0.25))):
        both(p, smooth_, band_plate(foot, 0.045, -1.6, 1.6, t0, t1, 0.011 - 0.0025 * k, 0.012 if k == 4 else 0.004),
             ('foot_l',) if k < 2 else shoe, deco=trimmed(0.005), **edge)
    both(p, smooth_, band_plate(foot, 0.045, math.pi - 1.2, math.pi + 1.2, -0.085, -0.02, 0.004, 0.01), ('foot_l',), deco=trimmed(0.005), **edge)
    return p


def infernal_mats():
    """The endgame harness, after the user's black knight: a black lacquer with a faint cold sheen, every plate bordered
    in polished gold; the same lacquer worked in its panels with raised gilt scrollwork; polished gold for the horns,
    the mounts and the bosses; dark mail; a brown leather belt; a dark stone."""
    gold = 0xc9a245
    return (mat('infernal_ornate', 0x0b0c0f, 'enamel', engrave='scroll', engrave_color=gold, emboss=True, rough=0.14, metal=0.6,
                bump=1.4, trim=gold, sheen=0x161a24, gloss=0.85, scale=0.16, panels=True),
            mat('infernal_black', 0x0b0c0f, 'enamel', rough=0.14, metal=0.6, trim=gold, sheen=0x161a24, gloss=0.85, panels=True),
            mat('infernal_gold', gold, 'gold', rough=0.2, metal=0.95),
            mat('infernal_mail', 0x2a2b2e, 'mail', rough=0.5, metal=0.85),
            mat('infernal_leather', 0x3f2617, 'leather', rough=0.75),
            mat('infernal_stone', 0x10283a, 'enamel', rough=0.05, metal=0.3, sheen=0x2b6d8a, gloss=0.95))


def ornate(w=0.01, where=None):
    """The deco of a plate of a set with panels: its gold border `w` wide along the edges, and inside it the scrollwork
    where `where` says (a function of the point, 0..1; everywhere if none), the plain lacquer elsewhere."""
    def f(q, d):
        inner = 1.0 if where is None else where(q)
        return smooth(w, w + 0.003, d) * (0.5 + 0.5 * inner)
    return f


PLAIN = ornate(0.009, lambda q: 0.0)


def star(c, r_out, r_in, points=8, turn=0.0):
    """A star's outline round (u, v) c, its points r_out out and the notches between them r_in."""
    return [(c[0] + (r_out if k % 2 == 0 else r_in) * math.sin(turn + math.pi * k / points),
             c[1] + (r_out if k % 2 == 0 else r_in) * math.cos(turn + math.pi * k / points)) for k in range(2 * points)]


def infernal_chest():
    """The black knight's harness, ornate beyond any other: a hauberk of dark mail under it, showing at the hips; a
    breastplate of black lacquer worked over the chest in raised gilt scrollwork, a gold-set stone at the breastbone;
    four lames over the belly drawn down to a point in the middle, each bordered in gold; a backplate, a gorget; a
    leather belt with a gold medallion; two ornate panels hanging in front to the knees, meeting in a point; tassets of
    three lames; great pauldrons, their caps all scrollwork, four lames under them; rerebraces, and couters with an
    ornate fan."""
    p = Piece('chest')
    p.budget, p.min_ratio = 15000, 0.035
    orn, blk, gold, mail, leather, stone = infernal_mats()
    F = forms()
    torso, hips, arm, fore = F['torso'], F['hips'], F['arm'], F['forearm']
    trunk = ('spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r')
    edge = dict(solid=0.003, roll=0.0016, roll_mat=gold)
    RU = 0.17
    # the hauberk: the trunk's alone, sleeves to the elbow, the skirt under the tassets
    p.add(mail, *ring_plate(torso, RU, 0.99, 1.505, 0.0018), solid=0.002, skin=trunk + ('pelvis', 'neck_01'))
    both(p, mail, ring_plate(arm, 0.08, -0.03, 0.255, 0.0018), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), solid=0.002)
    p.add(mail, *ring_plate(hips, 0.16, 0.74, 1.005, lambda u, v: 0.002 + 0.003 * smooth(0.95, 0.74, v)), solid=0.002, skin=skirt())
    # the breastplate, its lower edge drawn down to a point, scrollwork over the chest; the stone at the breastbone
    front = outline(symmetric([(0.0, 1.488), (0.045, 1.494), (0.08, 1.51), (0.115, 1.528), (0.145, 1.505), (0.17, 1.42),
                               (0.205, 1.345), (0.24, 1.31), (0.258, 1.25), (0.25, 1.215), (0.12, 1.19), (0.0, 1.165)]), 6)
    foff = lambda u, v: 0.008 + 0.012 * beak(u, 0.12) + 0.008 * beak(u, 0.1) * gauss(v - 1.3, 0.1)
    chest_orn = lambda q: smooth(1.215, 1.245, q.y) * smooth(0.012, 0.02, abs(q.x)) if q.z > 0 else 0.0
    p.add(orn, *plate(lambda u, v: torso.point(u / RU, v, foff(u, v)), lambda u, v: sd_poly(u, v, front), -0.27, 0.27, 1.15, 1.54),
          deco=ornate(0.011, chest_orn), sharp=25, skin=trunk, **edge)
    gem_at, gem_n = torso.point(0.0, 1.37, foff(0.0, 1.37) + 0.0005), torso.normal(0.0, 1.37)
    t_, n_, b_ = frame(gem_n)
    p.add(gold, *merge(rivet(gem_at, gem_n, 0.016, washer=0.024),
                       *[oball(gem_at + (t_ * math.cos(k * math.pi / 4) + b_ * math.sin(k * math.pi / 4)) * 0.024 + gem_n * 0.001,
                               (0.005, 0.003, 0.005), (t_, n_, b_), 8, 5) for k in range(8)]), skin=trunk)
    p.add(stone, *gem(gem_at + gem_n * 0.006, gem_n, 0.011), skin=trunk)
    # the lames over the belly, each over the one below, drawn down to a point in the middle
    for k in range(4):
        top = 1.215 - 0.052 * k
        lame = lambda u, v, top=top: max(abs(u) - 0.252, v - (top + 0.28 * abs(u)), (top - 0.066 + 0.28 * abs(u)) - v)
        p.add(blk, *plate(lambda u, v, k=k: torso.point(u / RU, v, foff(u, v) - 0.0015 * k + 0.0012), lame, -0.26, 0.26, top - 0.07, top + 0.08),
              deco=PLAIN, sharp=25, skin=trunk, **edge)
    back = outline(symmetric([(0.0, 1.53), (0.05, 1.532), (0.09, 1.535), (0.13, 1.51), (0.17, 1.41), (0.21, 1.34), (0.25, 1.3),
                              (0.29, 1.2), (0.29, 1.06), (0.15, 1.012), (0.0, 1.002)]), 6)
    back_orn = lambda q: smooth(1.36, 1.4, q.y) * smooth(1.53, 1.49, q.y) * smooth(0.03, 0.04, abs(q.x))
    p.add(orn, *plate(lambda u, v: torso.point(math.pi + u / RU, v, 0.009), lambda u, v: sd_poly(u, v, back), -0.3, 0.3, 0.99, 1.545),
          deco=ornate(0.011, back_orn), skin=trunk, **edge)
    neck = Cone(-0.035, 1.48, 0.112, 0.1, 1.57, 0.075, 0.075)
    for k, (lo_, hi_) in enumerate(((1.483, 1.525), (1.517, 1.56))):
        p.add(blk, *band_plate(neck, 0.09, -1.65, 1.65, lo_, hi_, 0.0075 - 0.0025 * k, 0.008), deco=PLAIN, skin=('neck_01', 'spine_03'), **edge)
    # the fauld under the belt, the belt and its medallion
    hip_skin = ('pelvis', 'spine_01')
    p.add(blk, *plate(lambda u, v: hips.point(u / 0.16, v, 0.006), lambda u, v: max(0.95 - v, v - 1.04), -math.pi * 0.16, math.pi * 0.16,
                      0.946, 1.044, periodic=True), deco=PLAIN, skin=hip_skin, **edge)
    p.add(leather, *strap(hips, [(2 * math.pi * k / 96, 1.0) for k in range(97)], 0.04, 0.004, 0.022), skin=hip_skin, forge=creased(0.0005))
    med = outline(star((0.0, 1.0), 0.036, 0.024, 8), 4)
    p.add(gold, *plate(lambda u, v: hips.point(u / 0.16, v, 0.029), lambda u, v: sd_poly(u, v, med), -0.045, 0.045, 0.955, 1.045),
          solid=0.003, roll=0.0012, skin=hip_skin, bump=lambda q: 0.004 * gauss(math.hypot(q.x, q.y - 1.0), 0.02))
    p.add(stone, *gem(hips.point(0.0, 1.0, 0.0345), hips.normal(0.0, 1.0), 0.009), skin=hip_skin)
    # the panels hanging in front, one over each thigh, meeting in a point; tassets of three lames at the sides
    panel = outline([(0.0, 0.985), (0.075, 0.985), (0.075, 0.66), (0.04, 0.6), (0.0, 0.55)], 6)
    poff = lambda u, v: 0.02 + 0.03 * smooth(0.9, 0.55, v)  # standing off the thighs towards the knee
    both(p, orn, plate(lambda u, v: hips.point(u / 0.16, v, poff(u, v)), lambda u, v: sd_poly(u, v, panel), -0.004, 0.08, 0.54, 0.99),
         hanging('l'), deco=ornate(0.01), sharp=30, **edge)
    for k, (lo_, hi_) in enumerate(((0.875, 0.94), (0.82, 0.888), (0.765, 0.835))):
        both(p, blk, band_plate(hips, 0.16, 0.42, 1.35, lo_, hi_, 0.01 + 0.0025 * k, 0.012 if k == 2 else 0.004), hanging('l'), deco=PLAIN, **edge)
    for k, (lo_, hi_) in enumerate(((0.875, 0.94), (0.82, 0.888))):
        both(p, blk, band_plate(hips, 0.16, 1.75, 2.95, lo_, hi_, 0.01 + 0.0025 * k, 0.012 if k == 1 else 0.004), hanging('l'), deco=PLAIN, **edge)
    # pauldrons: a great domed cap all scrollwork with a gold-bordered ridge, four lames under it, each over the next
    capoff = lambda u, v: (0.026 + 0.008 * beak(u, 0.035)) * (0.5 + 0.5 * smooth(-0.095, -0.035, v))
    dome = lambda q: 0.014 * gauss((q - arm.at(0.0, -0.01)).length, 0.07)
    both(p, orn, band_plate(arm, 0.09, -2.3, 2.3, -0.095, 0.1, capoff, 0.03), ('clavicle_l', 'upperarm_l'), bump=dome, deco=ornate(0.012),
         sharp=30, **edge)
    for k, (t0, t1) in enumerate(((0.065, 0.125), (0.1, 0.16), (0.135, 0.195), (0.17, 0.23))):
        both(p, blk, band_plate(arm, 0.09, -2.0, 2.0, t0, t1, lambda u, v, k=k, t0=t0, t1=t1: 0.019 - 0.003 * k + 0.008 * smooth(t0, t1, v), 0.008),
             ('upperarm_l',), deco=PLAIN, **edge)
    both(p, blk, ring_plate(arm, 0.09, 0.2, 0.26, 0.002), ('upperarm_l',), deco=PLAIN, **edge)
    # couters: a cup over the elbow, an ornate fan on its outside
    cup = lambda q: 0.008 * gauss((q - fore.at(-math.pi / 2, 0.0)).length, 0.035)
    both(p, blk, plate(lambda u, v: fore.point(u / 0.07, v, 0.007), lambda u, v: sd_ellipse(u, v, -math.pi / 2 * 0.07, 0.0, 0.085, 0.052),
                       -math.pi * 0.07, 0.0, -0.06, 0.06), ('upperarm_l', 'lowerarm_l'), bump=cup, deco=PLAIN, **edge)
    fan = outline([(-0.5 * 0.07, 0.05), (-0.5 * 0.07 + 0.036, 0.0), (-0.5 * 0.07, -0.05), (-0.5 * 0.07 - 0.028, -0.02),
                   (-0.5 * 0.07 - 0.028, 0.02)], 6)
    both(p, orn, plate(lambda u, v: fore.point(u / 0.07, v, 0.0125), lambda u, v: sd_poly(u, v, fan), -1.2 * 0.07, 0.1 * 0.07, -0.06, 0.06),
         ('upperarm_l', 'lowerarm_l'), deco=ornate(0.006), sharp=30, **edge)
    return p


def infernal_gloves():
    """Vambraces of black lacquer worked in scrollwork, gold-bordered, and gauntlets: a flared cuff, an ornate plate over
    the back of the hand, a gold knuckle plate, four lames over the fingers and one over the thumb."""
    p = Piece('gloves')
    p.budget = 6000
    orn, blk, gold, mail, leather, stone = infernal_mats()
    F = forms()
    fore, hand = F['forearm'], F['hand']
    edge = dict(solid=0.0025, roll=0.0013, roll_mat=gold)
    both(p, orn, ring_plate(fore, 0.07, 0.045, 0.2, lambda u, v: 0.003 + 0.005 * beak(u, 0.05)), ('lowerarm_l',), deco=ornate(0.009), sharp=28,
         **edge)
    both(p, blk, ring_plate(hand, 0.06, -0.085, 0.006, lambda u, v: 0.003 + 0.022 * smooth(-0.005, -0.085, v)), ('hand_l', 'lowerarm_l'),
         deco=PLAIN, **edge)
    both(p, orn, band_plate(hand, 0.06, -1.15, 1.15, -0.002, 0.098, 0.006, 0.012), ('hand_l',), deco=ornate(0.007), **edge)
    both(p, gold, band_plate(hand, 0.06, -1.1, 1.1, 0.07, 0.104, 0.0095, 0.008), ('hand_l',),
         bump=lambda q: 0.0025 * gauss(q.x - bone('hand_l').x - 0.087, 0.005), solid=0.0025, roll=0.0011)
    for k, (t0, t1) in enumerate(((0.096, 0.126), (0.122, 0.152), (0.148, 0.178), (0.174, 0.205))):
        both(p, blk, band_plate(hand, 0.06, -1.05, 1.05, t0, t1, 0.004 - 0.0006 * k, 0.012 if k == 3 else 0.004), ('hand_l',) + FINGERS_L,
             deco=ornate(0.004, lambda q: 0.0), **edge)
    both(p, blk, band_plate(hand, 0.06, 1.3, 2.4, 0.015, 0.085, 0.004, 0.012), ('hand_l',) + THUMB_L, deco=ornate(0.004, lambda q: 0.0), **edge)
    return p


def infernal_legs():
    """Cuisses of black lacquer bordered in gold, and great poleyns: an ornate dome over the knee with an ornate wing on
    its outside and a lame above and below."""
    p = Piece('legs')
    p.budget = 6000
    orn, blk, gold, mail, leather, stone = infernal_mats()
    F = forms()
    thigh, knee = F['thigh'], F['knee']
    edge = dict(solid=0.003, roll=0.0015, roll_mat=gold)
    both(p, blk, band_plate(thigh, 0.085, -2.0, 1.1, 0.1, 0.4, lambda u, v: 0.003 + 0.005 * beak(u, 0.05), 0.02), ('thigh_l',), deco=PLAIN,
         sharp=28, **edge)
    dome = lambda q: 0.008 * gauss((q - knee.at(0.0, 0.0)).length, 0.035)
    both(p, orn, band_plate(knee, 0.065, -1.35, 1.35, -0.05, 0.05, 0.006, 0.03), ('thigh_l', 'calf_l'), bump=dome, deco=ornate(0.008), **edge)
    for t0, t1, off in ((-0.075, -0.042, 0.004), (0.042, 0.075, 0.004)):
        both(p, blk, band_plate(knee, 0.065, -1.2, 1.2, t0, t1, off, 0.008), ('thigh_l', 'calf_l'), deco=PLAIN, **edge)
    wing = outline([(-1.6 * 0.065, 0.045), (-1.6 * 0.065 - 0.045, 0.02), (-1.6 * 0.065 - 0.05, -0.012), (-1.6 * 0.065 - 0.02, -0.04),
                    (-1.6 * 0.065 + 0.02, -0.03), (-1.6 * 0.065 + 0.02, 0.03)], 6)
    both(p, orn, plate(lambda u, v: knee.point(u / 0.065, v, 0.009), lambda u, v: sd_poly(u, v, wing), -2.6 * 0.065, -0.6 * 0.065, -0.05, 0.055),
         ('thigh_l', 'calf_l'), deco=ornate(0.007), sharp=30, **edge)
    return p


def infernal_feet():
    """From the knee down, in place of the boots: greaves of black lacquer closed round the shins with an ornate plate
    over the shin rising to a point under the knee, and sabatons of gold-bordered lames over a leather shoe, a rounded
    toe cap and a heel plate."""
    p = Piece('feet')
    p.budget = 6000
    orn, blk, gold, mail, leather, stone = infernal_mats()
    sole = mat('sole', 0x17130f, 'leather', rough=0.85)
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = dict(solid=0.0025, roll=0.0013, roll_mat=gold)
    both(p, blk, ring_plate(calf, 0.06, 0.065, 0.43, lambda u, v: 0.003 + 0.01 * smooth(0.39, 0.43, v)), ('calf_l',), deco=PLAIN, **edge)
    both(p, orn, teeth_plate(calf, 0.06, -1.0, 1.0, 0.07, 0.39, lambda u, v: 0.0062 + 0.005 * beak(u, 0.04), 1, 0.07, 'low'), ('calf_l',),
         deco=ornate(0.008), sharp=28, **edge)
    shoe = ('foot_l', 'ball_l')
    both(p, sole, ring_plate(foot, 0.045, -0.085, 0.25, 0.0), shoe, solid=0.002)
    for k, (t0, t1) in enumerate(((-0.01, 0.04), (0.035, 0.08), (0.075, 0.12), (0.115, 0.16), (0.155, 0.25))):
        both(p, blk, band_plate(foot, 0.045, -1.6, 1.6, t0, t1, 0.011 - 0.0025 * k, 0.012 if k == 4 else 0.004),
             ('foot_l',) if k < 2 else shoe, deco=ornate(0.005, lambda q: 0.0), **edge)
    both(p, blk, band_plate(foot, 0.045, math.pi - 1.2, math.pi + 1.2, -0.085, -0.02, 0.004, 0.01), ('foot_l',), deco=ornate(0.005, lambda q: 0.0),
         **edge)
    return p


FORE = ('lowerarm_l',)  # a shield goes wherever the forearm goes


class Shield:
    """A shield's face, strapped on the outside of the left forearm (the top of the arm in the rest pose, its outside
    hanging): across it (s, forward) and up it (h, towards the elbow) from its middle, domed out by `dome` metres at the
    middle - 'round' a dish, 'curve' bent across and only a little up and down. hw, hh: its half width and height."""

    def __init__(self, hw, hh, dome=0.03, kind='curve', t=0.15, lift=0.08):
        self.fore = forms()['forearm']
        axis = self.fore.o + self.fore.d * t
        self.c = Vector((axis.x, self.fore.at(0.0, t).y + lift, axis.z))
        self.hw, self.hh, self.dome, self.kind, self.t = hw, hh, dome, kind, t
        self.n, self.up, self.side = Vector((0, 1, 0)), Vector((-1, 0, 0)), Vector((0, 0, 1))

    def bulge(self, s, h):
        a, b = s / self.hw, h / self.hh
        return self.dome * (1 - (a * a + b * b if self.kind == 'round' else a * a + 0.25 * b * b))

    def flat(self, s, h, off=0.0):
        return self.c + self.side * s + self.up * h + self.n * (self.bulge(s, h) + off)

    def normal(self, s, h):
        e = 1e-3
        n = (self.flat(s + e, h) - self.flat(s - e, h)).cross(self.flat(s, h + e) - self.flat(s, h - e)).normalized()
        return n if n.dot(self.n) > 0 else -n

    def at(self, s, h, off=0.0):
        """A point on the face, `off` out along its normal."""
        return self.flat(s, h) + self.normal(s, h) * off

    def local(self, q):
        """(s, h) of a point near the face."""
        d = Vector(q) - self.c
        return d.dot(self.side), d.dot(self.up)

    def plate(self, sd, off=0.0, pad=0.012, h=0.003, box=None):
        u0, u1, v0, v1 = box or (-self.hw - pad, self.hw + pad, -self.hh - pad, self.hh + pad)
        return plate(lambda u, v: self.at(u, v, off), sd, u0, u1, v0, v1, h=h)

    def rim(self, pts, r, off=0.0):
        """A rolled rim round an outline of (s, h) points."""
        q = [self.at(s, h, off) for s, h in pts]
        return tube(q + q[:1], r, 10, closed=True)

    def dome_bump(self, c, r, height):
        """A boss's swell over the face: round, `height` at its middle."""
        return lambda q: height * math.sqrt(max(0.0, 1 - (math.hypot(*(a - b for a, b in zip(self.local(q), c))) / r) ** 2))


def strapped(p, sh, leather, core):
    """The straps a shield is worn by: two round the forearm, each nailed to the back of the shield's core by a short
    tongue, and a grip under the hand."""
    fore = sh.fore
    for t in (sh.t - 0.085, sh.t + 0.06):
        p.add(leather, *ring_plate(fore, 0.07, t - 0.012, t + 0.012, 0.014), solid=0.003, skin=FORE)
        s0, h0 = sh.local(fore.point(0.0, t, 0.016))
        p.add(leather, *tube([fore.point(0.0, t, 0.012), sh.at(s0, h0, -core - 0.002)], 0.009, 8), skin=FORE)
    gs, gh = sh.local(fore.o + fore.d * (sh.t + 0.12))
    p.add(leather, *tube([sh.at(gs - 0.045, gh, -core - 0.002), sh.at(gs - 0.02, gh, -core - 0.03), sh.at(gs + 0.02, gh, -core - 0.03),
                          sh.at(gs + 0.045, gh, -core - 0.002)], 0.008, 8), skin=FORE)


def heater(hw, hh, top_round=0.0):
    """A heater shield's outline: a straight (or gently arched) top, sides falling straight then curving in to a point."""
    return outline(symmetric([(0.0, hh + top_round), (0.5 * hw, hh + 0.6 * top_round), (hw, hh), (hw, hh * 0.25), (0.86 * hw, -hh * 0.35),
                              (0.55 * hw, -hh * 0.78), (0.0, -hh)]), 8)


def kite(hw, hh):
    """A kite shield's outline: a rounded top, widest high up, drawn out to a long point."""
    return outline(symmetric([(0.0, hh), (0.6 * hw, hh * 0.92), (hw, hh * 0.62), (0.92 * hw, hh * 0.15), (0.6 * hw, -hh * 0.45),
                              (0.25 * hw, -hh * 0.85), (0.0, -hh)]), 8)


def inset(poly, d):
    """An outline shrunk `d` towards its middle (good enough for a shield's convex outline)."""
    cx, cy = sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly)
    return [(cx + (x - cx) * (1 - d / max(1e-6, math.hypot(x - cx, y - cy))), cy + (y - cy) * (1 - d / max(1e-6, math.hypot(x - cx, y - cy))))
            for x, y in poly]


def buckler_shield():
    """A wooden buckler: five oak planks, an iron band round the edge, a domed iron boss riveted at its middle."""
    p = Piece('shield')
    wood = mat('oak', 0x7a5232, 'wood', rough=0.8)
    iron = mat('shield_iron', 0x4a4d52, 'iron', rough=0.5, metal=0.85)
    leather = mat('strap_leather', 0x3a2416, 'leather', rough=0.8)
    R = 0.18
    sh = Shield(R, R, 0.024, 'round')
    for k in range(5):
        s0 = -R + k * (2 * R / 5)
        p.add(wood, *sh.plate(lambda u, v, s0=s0: max(math.hypot(u, v) - R, s0 + 0.0015 - u, u - (s0 + 2 * R / 5 - 0.0015))),
              solid=0.014, skin=FORE)
    ring = [(R * math.cos(2 * math.pi * k / 96), R * math.sin(2 * math.pi * k / 96)) for k in range(96)]
    p.add(iron, *sh.rim(ring, 0.0075, -0.006), skin=FORE)
    p.add(iron, *sh.plate(lambda u, v: math.hypot(u, v) - 0.058, off=0.0008), solid=0.003, roll=0.0012, bump=sh.dome_bump((0, 0), 0.058, 0.03), skin=FORE)
    for k in range(6):
        a = 2 * math.pi * k / 6
        s, h = 0.072 * math.cos(a), 0.072 * math.sin(a)
        p.add(iron, *rivet(sh.at(s, h, 0.001), sh.normal(s, h), 0.006), skin=FORE)
    strapped(p, sh, leather, 0.014)
    return p


def brigandine_shield():
    """A heater shield of the brigandine kit: boiled leather over a wooden core, an iron band round its edge and two
    crossing over it, studded with rows of iron rivets, an iron boss where the bands meet."""
    p = Piece('shield')
    leather = mat('brig_leather', 0x4a3222, 'leather', rough=0.75)
    iron = mat('shield_iron', 0x5c636c, 'iron', rough=0.45, metal=0.85)
    core = mat('shield_core', 0x5a3e28, 'wood', rough=0.85)
    strap = mat('strap_leather', 0x3a2416, 'leather', rough=0.8)
    hw, hh = 0.23, 0.28
    sh = Shield(hw, hh, 0.035)
    out = heater(hw, hh)
    face = lambda u, v: sd_poly(u, v, out)
    p.add(leather, *sh.plate(face), solid=0.004, forge=creased(0.0006), skin=FORE)
    p.add(core, *sh.plate(lambda u, v: sd_poly(u, v, out) + 0.004, off=-0.0045), solid=0.012, skin=FORE)
    p.add(iron, *sh.rim(out, 0.007, -0.002), skin=FORE)
    for band in (lambda u, v: max(abs(u) - 0.018, face(u, v) + 0.006), lambda u, v: max(abs(v - 0.06) - 0.018, face(u, v) + 0.006)):
        p.add(iron, *sh.plate(band, off=0.001), solid=0.0025, roll=0.001, skin=FORE)
    p.add(iron, *sh.plate(lambda u, v: math.hypot(u, v - 0.06) - 0.05, off=0.0035), solid=0.003, roll=0.0012,
          bump=sh.dome_bump((0, 0.06), 0.05, 0.026), skin=FORE)
    studs = [(s * x, y) for s in (1, -1) for x in (0.07, 0.13, 0.18) for y in (0.2, 0.13, -0.02, -0.09)
             if face(s * x, y) < -0.025] + [(0.0, y) for y in (0.22, -0.08, -0.16)] + [(s * x, 0.06) for s in (1, -1) for x in (0.11, 0.19)]
    for s, h in studs:
        p.add(iron, *rivet(sh.at(s, h, 0.0012), sh.normal(s, h), 0.0045), skin=FORE)
    strapped(p, sh, strap, 0.016)
    return p


def plate_shield():
    """A knight's heater shield of polished steel: a blue enamelled field inside a raised steel border, a cross pattée
    raised on it, rivets round the border."""
    p = Piece('shield')
    steel = mat('plate_steel', 0xc0c8d0, 'steel', rough=0.22, metal=0.95)
    field = mat('plate_azure', 0x1f3f8a, 'enamel', rough=0.3, metal=0.4)
    core = mat('shield_core', 0x5a3e28, 'wood', rough=0.85)
    strap = mat('strap_leather', 0x3a2416, 'leather', rough=0.8)
    hw, hh = 0.24, 0.3
    sh = Shield(hw, hh, 0.04)
    out = heater(hw, hh, 0.015)
    p.add(steel, *sh.plate(lambda u, v: sd_poly(u, v, out)), solid=0.003, roll=0.0022, sharp=30, skin=FORE)
    p.add(core, *sh.plate(lambda u, v: sd_poly(u, v, out) + 0.004, off=-0.0035), solid=0.012, skin=FORE)
    p.add(field, *sh.plate(lambda u, v: sd_poly(u, v, out) + 0.028, off=0.0012), solid=0.0015, roll=0.0012, sharp=30, skin=FORE)

    def cross(u, v):  # a cross pattée: arms flaring out from the middle
        v0 = v - 0.04
        arm = lambda a, b: max(abs(b) - (0.016 + 0.32 * abs(a)), abs(a) - 0.15)
        return max(min(arm(u, v0), arm(v0, u)), sd_poly(u, v, out) + 0.034)
    p.add(steel, *sh.plate(cross, off=0.0028), solid=0.002, roll=0.0011, sharp=30, skin=FORE)
    ring = inset(out, 0.015)
    for s, h in ring[::max(1, len(ring) // 18)]:  # round the border
        p.add(steel, *rivet(sh.at(s, h, 0.0006), sh.normal(s, h), 0.0042), skin=FORE)
    strapped(p, sh, strap, 0.0155)
    return p


def abyssal_shield():
    """A conquistador's rodela of the abyssal harness: round and deeply domed, blued steel etched with waves in a band
    round its edge, two lacquered rings, and a fluted shell for a boss."""
    p = Piece('shield')
    steel, accent, gilt = abyssal_mats()
    core = mat('shield_core', 0x3a2a1c, 'wood', rough=0.85)
    strap = mat('strap_leather', 0x2a1c14, 'leather', rough=0.8)
    R = 0.26
    sh = Shield(R, R, 0.06, 'round')
    disc = lambda u, v: math.hypot(u, v) - R
    p.add(steel, *sh.plate(disc), solid=0.003, roll=0.0022, roll_mat=gilt, deco=0.035, skin=FORE)
    p.add(core, *sh.plate(lambda u, v: disc(u, v) + 0.004, off=-0.0035), solid=0.012, skin=FORE)
    for r0, r1 in ((0.168, 0.185), (0.112, 0.124)):
        p.add(accent, *sh.plate(lambda u, v, r0=r0, r1=r1: max(r0 - math.hypot(u, v), math.hypot(u, v) - r1), off=0.0012), solid=0.0015,
              roll=0.0009, roll_mat=gilt, deco=lambda q: 0.0, skin=FORE)

    def shell(u, v):  # flutes running out from the middle, each ending in a lobe
        a, r = math.atan2(v, u), math.hypot(u, v)
        lobe = 0.008 * (1 - abs(math.cos(9 * a)) ** 0.5)
        return r - (0.085 - lobe)
    flutes = lambda q: (lambda s, h: 0.004 * (0.5 + 0.5 * math.cos(18 * math.atan2(h, s))) * smooth(0.0, 0.06, math.hypot(s, h)))(*sh.local(q))
    p.add(accent, *sh.plate(shell, off=0.002), solid=0.003, roll=0.0012, roll_mat=gilt, bump=lambda q: sh.dome_bump((0, 0), 0.085, 0.035)(q) + flutes(q),
          deco=lambda q: 0.0, skin=FORE)
    for k in range(12):
        a = 2 * math.pi * (k + 0.5) / 12
        s, h = 0.205 * math.cos(a), 0.205 * math.sin(a)
        p.add(gilt, *rivet(sh.at(s, h, 0.0006), sh.normal(s, h), 0.0045), skin=FORE)
    strapped(p, sh, strap, 0.0155)
    return p


def ashforged_shield():
    """The ashforged knight's heater, carried through a war: blackened steel over its core, two iron bands riveted
    across it, a thick rolled rim, dented and scored."""
    p = Piece('shield')
    steel, mail, leather, wool = ash_mats()
    core = mat('shield_core', 0x3a2a1c, 'wood', rough=0.85)
    hw, hh = 0.25, 0.31
    sh = Shield(hw, hh, 0.038)
    out = heater(hw, hh)
    worn = dents(*[(sh.at(s, h), r, d) for s, h, r, d in ((0.09, 0.12, 0.03, 0.004), (-0.12, -0.05, 0.025, 0.003), (0.03, -0.16, 0.02, 0.003),
                                                           (-0.06, 0.2, 0.018, 0.0025))])
    p.add(steel, *sh.plate(lambda u, v: sd_poly(u, v, out)), solid=0.003, roll=0.0028, bump=worn, sharp=30, skin=FORE)
    p.add(core, *sh.plate(lambda u, v: sd_poly(u, v, out) + 0.004, off=-0.0035), solid=0.012, skin=FORE)
    for v0 in (0.15, -0.06):
        band = lambda u, v, v0=v0: max(abs(v - v0) - 0.02, sd_poly(u, v, out) + 0.004)
        p.add(steel, *sh.plate(band, off=0.0015), solid=0.0025, roll=0.0012, bump=worn, skin=FORE)
        for s in (-0.2, -0.12, -0.04, 0.04, 0.12, 0.2):
            if sd_poly(s, v0, out) < -0.02:
                p.add(steel, *rivet(sh.at(s, v0, 0.0025), sh.normal(s, v0), 0.0055), skin=FORE)
    strapped(p, sh, leather, 0.0155)
    return p


def dragon_shield():
    """A kite shield of the dragon harness: dark steel worked in scales, its top drawn out into two points like a
    dragon's wings, three bands of red-lacquered scales down it cut in points, a boss with a horn."""
    p = Piece('shield')
    dark, red, rim = dragon_mats()
    core = mat('shield_core', 0x2a1e18, 'wood', rough=0.85)
    strap = mat('strap_leather', 0x2a1a12, 'leather', rough=0.8)
    hw, hh = 0.23, 0.37
    sh = Shield(hw, hh, 0.04)
    out = outline(symmetric([(0.0, hh * 0.86), (0.35 * hw, hh * 0.9), (0.75 * hw, hh), (1.08 * hw, hh * 1.04), (0.95 * hw, hh * 0.62),
                             (0.92 * hw, hh * 0.15), (0.6 * hw, -hh * 0.45), (0.25 * hw, -hh * 0.85), (0.0, -hh)]), 8)
    face = lambda u, v: sd_poly(u, v, out)
    p.add(dark, *sh.plate(face, pad=0.03), solid=0.003, roll=0.002, roll_mat=rim, deco=scaled, sharp=30, skin=FORE)
    p.add(core, *sh.plate(lambda u, v: face(u, v) + 0.004, off=-0.0035, pad=0.03), solid=0.012, skin=FORE)
    for k, v0 in enumerate((0.16, 0.0, -0.16)):  # V-shaped bands of red scales, pointing down
        band = lambda u, v, v0=v0: max(abs((v - v0) + 0.35 * abs(u)) - 0.045, face(u, v) + 0.014)
        tip = lambda u, v, v0=v0: band(u, v)
        p.add(red, *sh.plate(tip, off=0.0015 + 0.0012 * k), solid=0.002, roll=0.001, roll_mat=rim, deco=scaled, sharp=30, skin=FORE)
    p.add(rim, *sh.plate(lambda u, v: math.hypot(u, v - 0.06) - 0.05, off=0.006), solid=0.003, roll=0.0012, bump=sh.dome_bump((0, 0.06), 0.05, 0.022),
          skin=FORE)
    p.add(rim, *spike(sh.at(0.0, 0.06, 0.03), sh.normal(0.0, 0.06) + sh.up * 0.3, 0.06, 0.012, tuple(-sh.up * 0.5)), skin=FORE)
    strapped(p, sh, strap, 0.0155)
    return p


def glacial_shield():
    """A heater shield frosted over: pale steel etched with frost round its edge, a lozenge of colder blue at its
    middle with a boss, and icicles hanging from its lower edges."""
    p = Piece('shield')
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    core = mat('shield_core', 0x3a3430, 'wood', rough=0.85)
    strap = mat('strap_leather', 0x2a2420, 'leather', rough=0.8)
    hw, hh = 0.25, 0.32
    sh = Shield(hw, hh, 0.038)
    out = heater(hw, hh, 0.02)
    face = lambda u, v: sd_poly(u, v, out)
    p.add(steel, *sh.plate(face), solid=0.003, roll=0.002, roll_mat=rim, deco=0.03, sharp=30, skin=FORE)
    p.add(core, *sh.plate(lambda u, v: face(u, v) + 0.004, off=-0.0035), solid=0.012, skin=FORE)
    lozenge = outline([(0.0, 0.2), (0.13, 0.04), (0.0, -0.14), (-0.13, 0.04)], 4)
    p.add(deep, *sh.plate(lambda u, v: sd_poly(u, v, lozenge), off=0.0012), solid=0.002, roll=0.0012, roll_mat=rim, deco=lambda q: 1.0, sharp=30,
          skin=FORE)
    p.add(rim, *sh.plate(lambda u, v: math.hypot(u, v - 0.04) - 0.045, off=0.0035), solid=0.003, roll=0.0012, bump=sh.dome_bump((0, 0.04), 0.045, 0.022),
          skin=FORE)
    drops = []
    lower = [q for q in out if q[1] < -0.06]
    for k, q in enumerate(lower[::max(1, len(lower) // 9)]):  # along the two lower edges, hanging towards the point (down, worn)
        s, h = q[0] * 0.985, q[1] * 0.985
        grow = 0.5 + 0.5 * noise.noise(Vector((k * 2.3, 4.1, 1.0)))
        drops.append(icicle(sh.at(s, h, -0.002), -sh.up + sh.n * 0.25, 0.025 + 0.035 * grow, 0.004 + 0.002 * grow, k))
    if drops:
        p.add(ice, *merge(*drops), skin=FORE)
    strapped(p, sh, strap, 0.0155)
    return p


def emerald_shield():
    """A shield shaped as a leaf, of emerald lacquer worked in scales, bordered in silver: a silver rib down its middle
    and veins branching from it, a silver boss with an emerald."""
    p = Piece('shield')
    scale, smooth_, silver, mail, glass = emerald_mats()
    core = mat('shield_core', 0x2a2a1c, 'wood', rough=0.85)
    strap = mat('strap_leather', 0x22201a, 'leather', rough=0.8)
    hw, hh = 0.2, 0.34
    sh = Shield(hw, hh, 0.035)
    leaf = outline(symmetric([(0.0, hh), (0.45 * hw, hh * 0.8), (0.9 * hw, hh * 0.38), (hw, 0.0), (0.82 * hw, -hh * 0.42),
                              (0.45 * hw, -hh * 0.8), (0.0, -hh)]), 8)
    face = lambda u, v: sd_poly(u, v, leaf)
    p.add(scale, *sh.plate(face), solid=0.003, roll=0.0018, roll_mat=silver, deco=trimmed(0.012), sharp=30, skin=FORE)
    p.add(core, *sh.plate(lambda u, v: face(u, v) + 0.004, off=-0.0035), solid=0.012, skin=FORE)
    p.add(smooth_, *sh.plate(lambda u, v: max(abs(u) - 0.012, face(u, v) + 0.02), off=0.0015), solid=0.002, roll=0.0011, roll_mat=silver,
          deco=lambda q, d: 0.0, skin=FORE)
    for k, v0 in enumerate((0.16, 0.04, -0.08, -0.2)):
        for sgn in (1, -1):
            vein = lambda u, v, v0=v0, sgn=sgn: max(seg_dist(u, v, (0.0, v0), (sgn * (0.13 - 0.02 * abs(k - 1.5)), v0 + 0.09)) - 0.006, face(u, v) + 0.022)
            p.add(smooth_, *sh.plate(vein, off=0.0014), solid=0.0015, roll=0.0008, roll_mat=silver, deco=lambda q, d: 0.0, skin=FORE)
    p.add(silver, *sh.plate(lambda u, v: math.hypot(u, v - 0.02) - 0.042, off=0.003), solid=0.003, roll=0.001, bump=sh.dome_bump((0, 0.02), 0.042, 0.016),
          skin=FORE)
    p.add(glass, *gem(sh.at(0.0, 0.02, 0.019), sh.normal(0.0, 0.02), 0.016), skin=FORE)
    strapped(p, sh, strap, 0.0155)
    return p


def infernal_shield():
    """The black knight's great shield, after the user's reference: a heater drawn out at its corners into curling
    points, black lacquer worked all over in raised gilt scrollwork inside a gold border, a gold boss with a stone set
    in it like an eye, gold studs round it."""
    p = Piece('shield')
    p.budget, p.tex = 5500, 2048
    orn, blk, gold, mail, leather, stone = infernal_mats()
    core = mat('shield_core', 0x1a1410, 'wood', rough=0.85)
    hw, hh = 0.27, 0.36
    sh = Shield(hw, hh, 0.045)
    # sharp points, as the reference's: a notch in the middle of the top, the corners flaring out and up, a spike out
    # of each side, a smaller one lower down, and the long point below; the edges between them gently curved
    half = [(0.0, hh * 0.84), (0.3 * hw, hh * 0.9), (0.62 * hw, hh * 0.98), (0.86 * hw, hh * 1.0), (1.14 * hw, hh * 1.1),
            (1.0 * hw, hh * 0.86), (0.95 * hw, hh * 0.62), (0.97 * hw, hh * 0.46), (1.16 * hw, hh * 0.36), (0.96 * hw, hh * 0.22),
            (0.9 * hw, hh * 0.02), (0.88 * hw, -hh * 0.16), (1.0 * hw, -hh * 0.3), (0.8 * hw, -hh * 0.36), (0.66 * hw, -hh * 0.52),
            (0.44 * hw, -hh * 0.72), (0.22 * hw, -hh * 0.88), (0.0, -hh)]
    out = symmetric(half)
    face = lambda u, v: sd_poly(u, v, out)
    p.add(orn, *sh.plate(face, pad=0.04), solid=0.003, roll=0.0022, roll_mat=gold, deco=ornate(0.016), sharp=30, skin=FORE)
    p.add(core, *sh.plate(lambda u, v: face(u, v) + 0.005, off=-0.0035, pad=0.04), solid=0.012, skin=FORE)
    p.add(gold, *sh.plate(lambda u, v: math.hypot(u, v - 0.03) - 0.06, off=0.0035), solid=0.003, roll=0.0014,
          bump=sh.dome_bump((0, 0.03), 0.06, 0.02), skin=FORE)
    eye = sh.at(0.0, 0.03, 0.022)
    t_, n_, b_ = frame(sh.normal(0.0, 0.03))
    p.add(gold, *merge(*[oball(eye + (t_ * math.cos(k * math.pi / 6) + b_ * math.sin(k * math.pi / 6)) * 0.03, (0.006, 0.004, 0.006), (t_, n_, b_), 8, 5)
                         for k in range(12)]), skin=FORE)
    p.add(stone, *gem(eye, sh.normal(0.0, 0.03), 0.02), skin=FORE)
    for s, h in [(x * sg, y) for sg in (1, -1) for x, y in ((0.16, 0.24), (0.2, -0.04), (0.11, -0.2))] + [(0.0, 0.24), (0.0, -0.24)]:
        p.add(gold, *rivet(sh.at(s, h, 0.0012), sh.normal(s, h), 0.0075, washer=0.012), skin=FORE)
    strapped(p, sh, leather, 0.0155)
    return p


GUARD = 0.1  # where a blade leaves its guard (the grip's middle is the origin, the blade up +Y, as the Fiend props)


def loft(rings, cap=True):
    """A closed solid through rings of points, each with as many as the first, capped at both ends."""
    n = len(rings[0])
    verts = [Vector(p) for r in rings for p in r]
    faces = [(k * n + i, k * n + (i + 1) % n, (k + 1) * n + (i + 1) % n, (k + 1) * n + i) for k in range(len(rings) - 1) for i in range(n)]
    if cap:
        faces += [tuple(range(n))[::-1], tuple(range((len(rings) - 1) * n, len(rings) * n))]
    return verts, faces


def placed(mesh, origin=(0, 0, 0), up=(0, 1, 0), side=(1, 0, 0)):
    """A part built standing up +Y (its width along +X) moved to stand at `origin` along `up`, its width along `side`."""
    u = Vector(up).normalized()
    s = (Vector(side) - u * Vector(side).dot(u)).normalized()
    f = s.cross(u)
    o = Vector(origin)
    v, faces = mesh
    return [o + s * p[0] + u * p[1] + f * p[2] for p in v], faces


def blade(length, width, thick=0.0065, base=GUARD, shape=None, fuller=(0.0, 0.0), n=56):
    """A blade standing up from y = `base`: its half-width along it `width` * shape(t) (t 0 at the guard, 1 at the
    point; else straight, drawn to a point over the last fifth), lens-shaped across (flat along X, thickest down the
    middle) with a fuller (depth, how far up as a fraction) and thinning towards the point."""
    xs = [-1.0, -0.8, -0.55, -0.3, -0.12, 0.0, 0.12, 0.3, 0.55, 0.8, 1.0] if RES <= 1 else [-1.0, -0.6, -0.25, 0.0, 0.25, 0.6, 1.0]
    shape = shape or (lambda t: 1.0 if t < 0.8 else max(0.0, (1 - t) / 0.2) ** 0.85)
    n = max(6, int(round(n / RES)))  # coarser in the game's copy, like everything else built at RES
    rings = []
    for k in range(n + 1):
        t = k / n
        w = max(0.0012, width * shape(t))
        th = thick * (0.45 + 0.55 * min(1.0, w / width))
        depth, reach = fuller
        top = []
        for x in xs:
            z = th * (1 - abs(x) ** 1.7)
            if depth and t < reach:
                z -= depth * th * math.exp(-(x / 0.22) ** 2) * smooth(reach, reach - 0.08, t) * smooth(0.0, 0.04, t)
            top.append((x * w, base + length * t, max(z, th * 0.25 * (1 - abs(x)))))
        bottom = [(x, y, -z) for x, y, z in reversed(top[1:-1])]
        rings.append(top + bottom)
    return loft(rings)


def blade_at(width, length, base=GUARD, shape=None):
    """A blade's half-width at height y (for deco masks): its shape, from `blade`."""
    shape = shape or (lambda t: 1.0 if t < 0.8 else max(0.0, (1 - t) / 0.2) ** 0.85)
    return lambda y: max(0.0012, width * shape(clamp((y - base) / length)))


def grip(y0, y1, r, wire=None):
    """A grip from y0 up to y1, swelling a little in the middle; `wire`: a material for a cord wound round it (returns the
    wire's mesh too)."""
    pts = [Vector((0, lerp(y0, y1, k / 8), 0)) for k in range(9)]
    core = tube(pts, [r * (1 + 0.12 * math.sin(math.pi * k / 8)) for k in range(9)], 14)
    if not wire:
        return core, None
    turns, steps = 9, int(180 / RES)
    hel = [Vector((math.cos(2 * math.pi * turns * k / steps) * r * 1.08, lerp(y0, y1, k / steps), math.sin(2 * math.pi * turns * k / steps) * r * 1.08))
           for k in range(steps + 1)]
    return core, tube(hel, r * 0.16, 6)


def along(pts, *rs):
    """Radii for each of a path's points, running through `rs` evenly from its first point to its last."""
    n = len(pts) - 1
    out = []
    for k in range(n + 1):
        f = k / max(1, n) * (len(rs) - 1)
        i = min(int(f), len(rs) - 2)
        out.append(lerp(rs[i], rs[i + 1], f - i))
    return out


def facet_crystal(base, direction, length, r, sides=6):
    """An ice crystal: a six-sided prism from inside `base` along `direction`, drawn to a point."""
    d = Vector(direction).normalized()
    pts = [Vector(base) - d * (r * 0.5), Vector(base) + d * (length * 0.72), Vector(base) + d * length]
    return tube(pts, [r, r * 0.92, 0.0004], sides, fixed=True)


def talon(root, direction, curl, length, r):
    """A dragon's talon: from its root along `direction`, hooking round towards `curl`, tapering to a point."""
    d, c = Vector(direction).normalized(), Vector(curl).normalized()
    pts, radii = [], []
    for k in range(9):
        t = k / 8
        pts.append(Vector(root) + d * (length * (t - 0.35 * t * t)) + c * (length * 0.55 * t * t))
        radii.append(max(0.0006, r * (1 - t) ** 0.8))
    return tube(pts, radii, 9)


def spiral_shell(centre, r0, turns, grow=0.2, tube_r=0.32):
    """A nautilus: its tube coiling out from the middle in the plane of X and Y, widening as it goes; returns the mesh
    and where its mouth opens."""
    pts, radii = [], []
    n = int(36 * turns)
    for k in range(n + 1):
        th = 2 * math.pi * turns * k / n
        r = r0 * math.exp(grow * th)
        pts.append(Vector(centre) + Vector((r * math.cos(th), r * math.sin(th), 0.0)))
        radii.append(r * tube_r)
    return tube(pts, radii, 14), pts[-1], radii[-1]


def preview_props(objs, set_id):
    """The weapons alone, side by side: front and three-quarter."""
    sc = bpy.context.scene
    for k, ob in enumerate(objs):
        ob.location.x += 0.55 * k
    for m in bpy.data.materials:
        if m.get('rgb') is not None:
            m.diffuse_color = _rgb(m['rgb'])
    world = bpy.data.worlds.new('w')
    world.color = (0.05, 0.06, 0.08)
    sc.world = world
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light, sh.color_type = 'STUDIO', 'MATERIAL' if FAST else 'TEXTURE'
    sh.show_cavity, sh.cavity_type, sh.show_specular_highlight = True, 'BOTH', True
    k = float(os.environ.get('GEAR_RES', '1'))  # bigger renders, to look at the details
    sc.render.resolution_x, sc.render.resolution_y = int(520 * k), int(760 * k)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type, cam.data.ortho_scale = 'ORTHO', 2.3
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = B((0.28 * (len(objs) - 1), 0.45, 0.0))
    for name, deg in (('a', 0), ('b', 35)):
        az = math.radians(deg)
        cam.location = target + B((4 * math.sin(az), 0.3, 4 * math.cos(az)))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'{set_id}_{name}.png')
        bpy.ops.render.render(write_still=True)


def abyssal_blade():
    """A conquistador's cup-hilted rapier, of the abyssal harness: a long slender blade of bright steel, its ricasso
    blued and etched with waves; a cup over the hand fluted like a scallop shell and lacquered sea blue, long straight
    quillons and a knuckle bow of polished steel, a grip wound with wire, and a pearl for a pommel."""
    p = Piece('blade')
    p.centre = Vector((0, 0.03, 0))
    steel, accent, gilt = abyssal_mats()
    bright = mat('abyssal_bright', 0xb4c0cc, 'steel', rough=0.16, metal=0.95)
    pearl = mat('pearl', 0xe6eef2, 'enamel', rough=0.1, metal=0.2, sheen=0xc8d8f0, gloss=0.9)
    wire_m = mat('abyssal_wire', 0x8aa0b8, 'steel', rough=0.25, metal=0.95)
    shape = lambda t: (1.0 - 0.45 * t) if t < 0.9 else (0.55 * max(0.0, (1 - t) / 0.1)) ** 0.9
    p.add(bright, *blade(1.02, 0.016, 0.0055, GUARD + 0.012, shape, (0.35, 0.3)), sharp=30)
    p.add(steel, *blade(0.07, 0.0168, 0.0068, GUARD, lambda t: 1.0), deco=lambda q: 1.0)  # the blued ricasso
    # the cup: a fluted bowl over the hand, open below
    rings = []
    nr, na = max(5, int(12 / RES)), int(72 / RES) // 18 * 18
    for k in range(nr + 1):
        a = math.pi / 2 * (0.15 + 0.85 * k / nr)
        y, r = GUARD + 0.004 - 0.05 * math.cos(a), 0.058 * math.sin(a)
        rings.append([(r * math.cos(2 * math.pi * i / na) * (1 + 0.06 * math.cos(18 * 2 * math.pi * i / na) * k / nr), y,
                       r * math.sin(2 * math.pi * i / na) * (1 + 0.06 * math.cos(18 * 2 * math.pi * i / na) * k / nr)) for i in range(na)])
    v, f = loft(rings, cap=False)
    p.add(accent, v, f, solid=0.0025, roll=0.0016, roll_mat=gilt, deco=lambda q: 1.0, sharp=50)
    p.add(gilt, *tube([Vector((-0.17, GUARD + 0.006, 0)), Vector((0, GUARD + 0.009, 0)), Vector((0.17, GUARD + 0.006, 0))], [0.0048, 0.006, 0.0048], 10))
    for x in (-0.17, 0.17):
        p.add(gilt, *oball(Vector((x, GUARD + 0.006, 0)), (0.009, 0.009, 0.009)))
    bow = [Vector((0.0, GUARD - 0.04, 0.058)), Vector((0.0, GUARD - 0.1, 0.07)), Vector((0.0, -0.13, 0.05)), Vector((0.0, -0.165, 0.012))]
    p.add(gilt, *tube(spline(bow, 6), 0.0042, 9))
    core, wire = grip(-0.15, GUARD - 0.046, 0.0125, True)
    p.add(mat('abyssal_grip', 0x1a2a3a, 'leather', rough=0.7), *core)
    p.add(wire_m, *wire)
    p.add(pearl, *oball(Vector((0, -0.175, 0)), (0.024, 0.026, 0.024)))
    return p


def abyssal_staff():
    """A staff of the abyssal harness: a shaft of blued steel bound with lacquered collars, topped by a nautilus shell
    coiling out in sea-blue lacquer with a pearl at its mouth."""
    p = Piece('staff')
    steel, accent, gilt = abyssal_mats()
    pearl = mat('pearl', 0xe6eef2, 'enamel', rough=0.1, metal=0.2, sheen=0xc8d8f0, gloss=0.9)
    p.add(steel, *tube([Vector((0, y, 0)) for y in (-0.6, 0.0, 0.6, 1.18)], [0.017, 0.019, 0.019, 0.021], 14), deco=lambda q: 1.0)
    for y in (-0.6, -0.12, 0.12, 1.1, 1.18):
        p.add(accent, *tube([Vector((0, y - 0.018, 0)), Vector((0, y + 0.018, 0))], 0.025, 14), deco=lambda q: 1.0)
    p.add(gilt, *oball(Vector((0, -0.62, 0)), (0.024, 0.03, 0.024)))
    shell, mouth, mr = spiral_shell((0.0, 1.32, 0.0), 0.006, 2.1, 0.19, 0.42)
    p.add(accent, *shell, deco=lambda q: 1.0)
    p.add(gilt, *tube([Vector((0, 1.16, 0)), Vector((0.01, 1.22, 0)), Vector(mouth) + Vector((0, -0.01, 0))], [0.02, 0.016, 0.012], 10))
    p.add(pearl, *oball(Vector(mouth) + Vector((0.0, 0.0, mr * 0.2)), (mr * 0.55, mr * 0.55, mr * 0.55)))
    return p


def ashforged_blade():
    """The ashforged knight's sword, carried through a war: a straight arming sword of blackened steel with a fuller,
    its edges worn bright and nicked, a plain cross of iron bent a little down, a grip of old leather and a wheel
    pommel."""
    p = Piece('blade')
    steel, mail, leather, wool = ash_mats()
    iron = mat('ash_iron', 0x3a3b3e, 'iron', rough=0.55, metal=0.85)
    nicks = dents(*[(Vector((s * 0.026, GUARD + y, 0.0)), 0.008, 0.002) for s, y in ((1, 0.32), (-1, 0.55), (1, 0.71), (-1, 0.2))])
    p.add(steel, *blade(0.86, 0.026, 0.0068, GUARD, None, (0.45, 0.62)), bump=nicks, sharp=30)
    guard = [Vector((-0.12, GUARD - 0.012, 0)), Vector((-0.06, GUARD + 0.002, 0)), Vector((0.06, GUARD + 0.002, 0)), Vector((0.12, GUARD - 0.012, 0))]
    guard = spline(guard, 6)
    p.add(iron, *tube(guard, along(guard, 0.0075, 0.009, 0.009, 0.0075), 10))
    core, _ = grip(-0.11, GUARD - 0.008, 0.014)
    p.add(leather, *core, forge=creased(0.0006))
    p.add(iron, *placed(tube([Vector((0, -0.012, 0)), Vector((0, 0.012, 0))], [0.026, 0.026], 18), (0, -0.14, 0), (0, 0, 1)))
    p.add(iron, *oball(Vector((0, -0.14, 0)), (0.012, 0.012, 0.016)))
    return p


def ashforged_staff():
    """A war-worn quarterstaff: dark oak bound with iron bands and shod with iron, topped by an iron cage of four bent
    bars holding a lump of black volcanic glass."""
    p = Piece('staff')
    steel, mail, leather, wool = ash_mats()
    iron = mat('ash_iron', 0x3a3b3e, 'iron', rough=0.55, metal=0.85)
    oak = mat('ash_oak', 0x3e2c20, 'wood', rough=0.85)
    glass = mat('obsidian', 0x15100e, 'enamel', rough=0.08, metal=0.3, sheen=0x4a1a10, gloss=0.9)
    p.add(oak, *tube([Vector((0, y, 0)) for y in (-0.6, 0.0, 0.6, 1.2)], [0.02, 0.022, 0.021, 0.02], 12))
    for y in (-0.58, -0.2, 0.25, 0.9, 1.16):
        p.add(iron, *tube([Vector((0, y - 0.014, 0)), Vector((0, y + 0.014, 0))], 0.0245, 12))
    p.add(iron, *tube([Vector((0, -0.6, 0)), Vector((0, -0.65, 0))], [0.022, 0.012], 10))
    for k in range(4):
        a = math.pi / 2 * k + math.pi / 4
        d = Vector((math.cos(a), 0, math.sin(a)))
        bar = [Vector((0, 1.17, 0)) + d * 0.018, Vector((0, 1.24, 0)) + d * 0.05, Vector((0, 1.32, 0)) + d * 0.05, Vector((0, 1.38, 0)) + d * 0.012]
        p.add(iron, *tube(spline(bar, 6), 0.0055, 8))
    p.add(iron, *oball(Vector((0, 1.385, 0)), (0.012, 0.012, 0.012)))
    p.add(glass, *oball(Vector((0, 1.28, 0)), (0.034, 0.045, 0.032), seg=10, rings=7), bump=hammered(0.004, 60.0))
    return p


def dragon_blade():
    """A sword of the dragon harness: a broad blade of polished dark steel, a ricasso of red-lacquered scales, a guard
    of two dragon's wings swept up from the hilt, a grip of red leather wound with steel, and a claw for a pommel
    gripping a red stone."""
    p = Piece('blade')
    dark, red, rim = dragon_mats()
    blade_m = mat('dragon_blade', 0x4a4e56, 'steel', rough=0.2, metal=0.95)
    gem_m = mat('dragon_gem', 0x8a0a10, 'enamel', rough=0.06, metal=0.3, sheen=0xd02020, gloss=0.95)
    shape = lambda t: (1.0 + 0.12 * math.sin(math.pi * min(1.0, t / 0.75))) if t < 0.78 else max(0.0, (1 - t) / 0.22) ** 0.8 * 1.04
    p.add(blade_m, *blade(0.9, 0.03, 0.0072, GUARD + 0.06, shape, (0.4, 0.55)), sharp=30)
    p.add(red, *blade(0.09, 0.031, 0.008, GUARD, lambda t: 1.0 - 0.05 * t), deco=scaled)
    for s in (1, -1):
        wing_parts = wing(Vector((s * 0.02, GUARD, 0)), Vector((s * 0.09, GUARD + 0.05, 0)),
                          [Vector((s * 0.15, GUARD + 0.08, 0)), Vector((s * 0.15, GUARD + 0.035, 0)), Vector((s * 0.12, GUARD - 0.005, 0))],
                          Vector((s * 0.04, GUARD - 0.012, 0)))
        p.add(dark, *wing_parts['membrane'], solid=0.003, roll=0.001, roll_mat=rim, deco=scaled, sharp=30)
        p.add(rim, *wing_parts['bones'])
    p.add(rim, *tube([Vector((-0.04, GUARD - 0.005, 0)), Vector((0.04, GUARD - 0.005, 0))], 0.012, 12))
    core, wire = grip(-0.12, GUARD - 0.015, 0.0135, True)
    p.add(mat('dragon_grip', 0x5a1210, 'leather', rough=0.7), *core)
    p.add(rim, *wire)
    p.add(gem_m, *oball(Vector((0, -0.155, 0)), (0.017, 0.019, 0.017)))
    for k in range(3):
        a = 2 * math.pi * k / 3
        d = Vector((math.cos(a), 0, math.sin(a)))
        p.add(rim, *talon(Vector((0, -0.13, 0)) + d * 0.008, -UP * 0.4 + d, -UP * 0.6 - d * 0.6, 0.042, 0.0055))
    return p


def dragon_staff():
    """A staff of the dragon harness: a shaft of dark steel bound in bands of red scales, topped by a dragon's claw of
    four talons closing round a red orb."""
    p = Piece('staff')
    dark, red, rim = dragon_mats()
    gem_m = mat('dragon_gem', 0x8a0a10, 'enamel', rough=0.06, metal=0.3, sheen=0xd02020, gloss=0.95)
    p.add(dark, *tube([Vector((0, y, 0)) for y in (-0.6, 0.0, 0.6, 1.2)], [0.018, 0.02, 0.02, 0.022], 14), deco=lambda q: 1.0)
    for y0, y1 in ((-0.12, 0.12), (0.7, 0.86), (1.08, 1.2)):
        p.add(red, *tube([Vector((0, y0, 0)), Vector((0, y1, 0))], 0.0245, 14), deco=lambda q: 1.0)
    p.add(rim, *tube([Vector((0, -0.6, 0)), Vector((0, -0.66, 0))], [0.02, 0.006], 10))
    p.add(rim, *oball(Vector((0, 1.22, 0)), (0.03, 0.022, 0.03)))
    p.add(gem_m, *oball(Vector((0, 1.3, 0)), (0.05, 0.05, 0.05), seg=16, rings=10))
    for k in range(4):
        a = 2 * math.pi * k / 4 + math.pi / 4
        d = Vector((math.cos(a), 0, math.sin(a)))
        p.add(rim, *talon(Vector((0, 1.215, 0)) + d * 0.022, d + UP * 0.35, UP * 0.45 - d * 1.2, 0.16, 0.014))
    return p


def glacial_blade():
    """A longsword frosted over: a long blade of pale steel etched with frost down its middle, quillons drawn down
    into icicles, a grip of white leather and a crystal of ice for a pommel."""
    p = Piece('blade')
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    width, length = 0.026, 0.98
    w_at = blade_at(width, length, GUARD)
    p.add(steel, *blade(length, width, 0.0068, GUARD, None, (0.4, 0.5)), deco=lambda q: smooth(0.75, 0.55, abs(q.x) / w_at(q.y)), sharp=30)
    p.add(deep, *tube([Vector((-0.03, GUARD - 0.004, 0)), Vector((0.03, GUARD - 0.004, 0))], 0.014, 12), deco=lambda q: 1.0)
    for s in (1, -1):
        icicle_q = spline([Vector((s * 0.025, GUARD - 0.004, 0)), Vector((s * 0.09, GUARD + 0.004, 0)), Vector((s * 0.14, GUARD - 0.03, 0)),
                           Vector((s * 0.15, GUARD - 0.07, 0))], 6)
        p.add(ice, *tube(icicle_q, along(icicle_q, 0.011, 0.008, 0.004, 0.0006), 6, fixed=True))
        p.add(ice, *facet_crystal(Vector((s * 0.07, GUARD + 0.002, 0)), (s * 0.3, -1, 0), 0.035, 0.005))
    core, wire = grip(-0.12, GUARD - 0.016, 0.0135, True)
    p.add(mat('glacial_grip', 0xd8dee4, 'leather', rough=0.75), *core)
    p.add(rim, *wire)
    p.add(deep, *oball(Vector((0, -0.125, 0)), (0.016, 0.01, 0.016)), deco=lambda q: 1.0)
    p.add(ice, *facet_crystal(Vector((0, -0.13, 0)), (0, -1, 0), 0.07, 0.016))
    return p


def glacial_staff():
    """A staff frosted over: a shaft of pale steel bound with bands of colder blue, holding up a cluster of ice crystals
    in a ring of points."""
    p = Piece('staff')
    steel, deep, rim, fur, ice, cloth = glacial_mats()
    p.add(steel, *tube([Vector((0, y, 0)) for y in (-0.6, 0.0, 0.6, 1.2)], [0.017, 0.019, 0.019, 0.02], 14), deco=lambda q: 0.0)
    for y in (-0.58, -0.1, 0.1, 0.8, 1.17):
        p.add(deep, *tube([Vector((0, y - 0.015, 0)), Vector((0, y + 0.015, 0))], 0.0235, 14), deco=lambda q: 1.0)
    p.add(rim, *tube([Vector((0, -0.6, 0)), Vector((0, -0.66, 0))], [0.019, 0.005], 10))
    for k in range(6):  # the ring of points holding the cluster
        a = 2 * math.pi * k / 6
        d = Vector((math.cos(a), 0, math.sin(a)))
        claw = spline([Vector((0, 1.18, 0)) + d * 0.018, Vector((0, 1.24, 0)) + d * 0.045, Vector((0, 1.29, 0)) + d * 0.05], 4)
        p.add(rim, *tube(claw, along(claw, 0.005, 0.004, 0.0012), 8))
    p.add(ice, *facet_crystal(Vector((0, 1.22, 0)), (0, 1, 0), 0.26, 0.03))
    for k, (a, tilt, length, r) in enumerate(((0.3, 0.45, 0.17, 0.018), (2.4, 0.5, 0.15, 0.016), (4.3, 0.42, 0.18, 0.017), (1.4, 0.7, 0.11, 0.012),
                                              (3.4, 0.75, 0.1, 0.011), (5.3, 0.68, 0.12, 0.012))):
        d = Vector((math.cos(a) * tilt, 1.0, math.sin(a) * tilt))
        p.add(ice, *facet_crystal(Vector((0, 1.24, 0)) + Vector((math.cos(a), 0, math.sin(a))) * 0.012, d, length, r))
    return p


def emerald_blade():
    """An elven sword of the emerald harness: a leaf-shaped blade of silvered steel etched with vines down its middle,
    quillons swept up like leaves, a grip of emerald lacquer wound with silver, an emerald in a silver pommel."""
    p = Piece('blade')
    scale, smooth_, silver, mail, glass = emerald_mats()
    blade_m = mat('emerald_steel', 0xc4ccd2, 'steel', engrave='vines', rough=0.16, metal=0.95)
    width, length = 0.024, 0.92
    shape = lambda t: (0.85 + 0.45 * math.sin(math.pi * min(1.0, t / 0.82)) ** 1.5) if t < 0.82 else max(0.0, (1 - t) / 0.18) ** 0.75 * 0.85
    w_at = blade_at(width, length, GUARD, shape)
    p.add(blade_m, *blade(length, width, 0.0062, GUARD, shape, (0.3, 0.7)), deco=lambda q: smooth(0.5, 0.3, abs(q.x) / w_at(q.y)), sharp=30)
    for s in (1, -1):
        leaf = blade(0.07, 0.016, 0.005, 0.0, lambda t: math.sin(math.pi * min(1.0, t)) ** 0.7 if t < 1 else 0.0, n=12)
        p.add(silver, *placed(leaf, (s * 0.012, GUARD - 0.002, 0), (s * 1.0, 0.55, 0), (0, 1, 0)))
    p.add(silver, *tube([Vector((-0.02, GUARD - 0.004, 0)), Vector((0.02, GUARD - 0.004, 0))], 0.011, 12))
    core, wire = grip(-0.12, GUARD - 0.014, 0.0125, True)
    p.add(smooth_, *core, deco=lambda q: 1.0)
    p.add(silver, *wire)
    p.add(silver, *oball(Vector((0, -0.135, 0)), (0.019, 0.02, 0.019)))
    p.add(glass, *oball(Vector((0, -0.135, 0.014)), (0.011, 0.011, 0.007)))
    p.add(glass, *oball(Vector((0, -0.135, -0.014)), (0.011, 0.011, 0.007)))
    return p


def emerald_staff():
    """A staff of the emerald harness: two stems of living wood twisting round each other up to a crown of silver
    leaves opening round an emerald."""
    p = Piece('staff')
    scale, smooth_, silver, mail, glass = emerald_mats()
    wood = mat('living_wood', 0x4a3a22, 'wood', rough=0.85)
    for ph in (0.0, math.pi):
        pts = [Vector((0.011 * math.cos(ph + y * 9.0), y, 0.011 * math.sin(ph + y * 9.0))) for y in [lerp(-0.6, 1.2, k / 60) for k in range(61)]]
        p.add(wood, *tube(pts, 0.014, 10))
    for y in (-0.15, 0.15):
        p.add(silver, *tube([Vector((0, y - 0.012, 0)), Vector((0, y + 0.012, 0))], 0.029, 14))
    p.add(silver, *tube([Vector((0, -0.6, 0)), Vector((0, -0.65, 0))], [0.024, 0.008], 10))
    p.add(silver, *tube([Vector((0, 1.18, 0)), Vector((0, 1.24, 0))], [0.026, 0.02], 12))
    p.add(glass, *oball(Vector((0, 1.31, 0)), (0.03, 0.042, 0.03), seg=12, rings=8))
    for k in range(7):
        a = 2 * math.pi * k / 7
        d = Vector((math.cos(a), 0, math.sin(a)))
        leaf = blade(0.15, 0.024, 0.005, 0.0, lambda t: math.sin(math.pi * t) ** 0.8, n=16)
        p.add(smooth_ if k % 2 else silver, *placed(leaf, Vector((0, 1.23, 0)) + d * 0.018, d * 0.55 + UP, (math.cos(a + math.pi / 2), 0, math.sin(a + math.pi / 2))),
              deco=lambda q: 0.0)
    return p


def infernal_blade():
    """The black knight's sword: a long blade of black lacquered steel, gold along its edges and its flats worked in raised
    gilt scrollwork, a baroque guard of gold quillons curling into spirals, a grip of black leather wound with gold and
    a gold pommel set with the dark stone."""
    p = Piece('blade')
    orn, blk, gold, mail, leather, stone = infernal_mats()
    orn_b = mat('infernal_blade', 0x0b0c0f, 'enamel', engrave='scroll', engrave_color=0xc9a245, emboss=True, rough=0.14, metal=0.6, bump=1.2,
                trim=0xc9a245, sheen=0x161a24, gloss=0.85, scale=0.075, panels=True)
    width, length = 0.03, 1.0
    shape = lambda t: (1.0 - 0.2 * t) if t < 0.82 else max(0.0, (1 - t) / 0.18) ** 0.8 * 0.84
    w_at = blade_at(width, length, GUARD, shape)

    def deco(q):  # gold along the edges, scrollwork down the flats
        f = abs(q.x) / w_at(q.y)
        return smooth(0.92, 0.82, f) * (0.5 + 0.5 * smooth(0.62, 0.5, f))
    p.add(orn_b, *blade(length, width, 0.0075, GUARD, shape, (0.0, 0.0)), deco=deco, sharp=30)
    for s in (1, -1):  # quillons curling down into spirals
        pts = [Vector((s * 0.02, GUARD - 0.004, 0)), Vector((s * 0.08, GUARD + 0.008, 0)), Vector((s * 0.13, GUARD - 0.006, 0))]
        c = Vector((s * 0.13, GUARD - 0.03, 0))
        for k in range(1, 25):
            r = 0.024 * (1 - 0.6 * k / 24)
            pts.append(c + Vector((r * math.cos(math.pi / 2 - (k / 24) * 1.8 * math.pi) * s, r * math.sin(math.pi / 2 - (k / 24) * 1.8 * math.pi), 0)))
        p.add(gold, *tube(pts, [0.008 - 0.0055 * k / (len(pts) - 1) for k in range(len(pts))], 10))
    p.add(gold, *oball(Vector((0, GUARD - 0.006, 0)), (0.03, 0.016, 0.02)))
    p.add(stone, *oball(Vector((0, GUARD - 0.006, 0.016)), (0.009, 0.009, 0.006)))
    p.add(stone, *oball(Vector((0, GUARD - 0.006, -0.016)), (0.009, 0.009, 0.006)))
    core, wire = grip(-0.13, GUARD - 0.022, 0.0135, True)
    p.add(leather, *core)
    p.add(gold, *wire)
    p.add(gold, *oball(Vector((0, -0.15, 0)), (0.022, 0.026, 0.022)))
    p.add(stone, *oball(Vector((0, -0.15, 0.018)), (0.011, 0.011, 0.007)))
    p.add(stone, *oball(Vector((0, -0.15, -0.018)), (0.011, 0.011, 0.007)))
    return p


def infernal_staff():
    """The black knight's staff: a shaft of black lacquer bound in gold, topped by a pair of gold horns rising and curling
    in round the dark stone, as on the knight's helm."""
    p = Piece('staff')
    orn, blk, gold, mail, leather, stone = infernal_mats()
    p.add(blk, *tube([Vector((0, y, 0)) for y in (-0.6, 0.0, 0.6, 1.2)], [0.018, 0.02, 0.02, 0.021], 14), deco=lambda q: 0.5)
    for y in (-0.58, -0.14, 0.14, 0.75, 1.18):
        p.add(gold, *tube([Vector((0, y - 0.013, 0)), Vector((0, y + 0.013, 0))], 0.0245, 14))
    p.add(gold, *tube([Vector((0, -0.6, 0)), Vector((0, -0.67, 0))], [0.021, 0.005], 10))
    p.add(gold, *oball(Vector((0, 1.22, 0)), (0.032, 0.026, 0.032)))
    for s in (1, -1):
        p.add(gold, *horn(Vector((s * 0.022, 1.22, 0)), (s * 1.0, 0.3, 0), UP, (-s * 1.0, 0, 0), 0.16, 0.016))
    p.add(stone, *oball(Vector((0, 1.31, 0)), (0.036, 0.046, 0.036), seg=14, rings=9))
    p.add(gold, *tube([Vector((0, 1.31, 0)) + Vector((0.04 * math.cos(2 * math.pi * k / 32), 0, 0.04 * math.sin(2 * math.pi * k / 32))) for k in range(32)],
                      0.005, 8, closed=True))
    return p


# ---------------------------------------------------------------- mage gear: robes, circlets, gloves and shoes

LEGS = ('pelvis', 'spine_01', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r')
HEM = 0.3  # a robe's hem: mid-shin
SLIT = 0.76  # how far up its slits run, front and back: the upper thigh


def gown_form():
    """The form a robe's skirt hangs round: the hips and both legs together, from the waist down to the shin, as far as
    the bare body reaches (its sections convex, bridging the legs), angle 0 in front and pi/2 at the left."""
    return fitted(('gown', 0.0), lambda: Fit(LEGS, (0, 0, 0), UP, (0, 0, 1), 0.22, 1.1, gap=0.008, only=('Head_',), nt=44))


def gown_at(f, a, t, off):
    """A point `off` metres straight out from the gown's form, across its axis (the form's own normal tilts where the
    hips narrow to the thighs, and a skirt stood far off along it would fold over itself)."""
    return f.o + f.d * t + (f.up * math.cos(a) + f.side * math.sin(a)) * (f.radius(a, t) + off)


def flare(a, t, hem=HEM, wide=0.095, back=0.035):
    """How far a robe's skirt stands off the legs: close at the hips, widening evenly down to the hem (an A-line),
    wider behind, where the calf swings back."""
    return 0.006 + clamp((0.93 - t) / (0.93 - hem)) ** 1.1 * (wide + back * (1 - math.cos(a)) / 2)


def gown_skin(slit=SLIT, knee=0.6, hem=HEM):
    """The weights of a robe's skirt: held at the waist as a skirt's (skirt()), each half then following its own
    thigh, blended across the middle - more widely towards the hem - so the halves stay together; and from the knee
    down the calf more and more, most behind it, so a shin swinging back carries the cloth with it instead of coming
    through. Halves wholly apart below the slits would gape standing at ease, the legs a little apart: blended, the
    slits only open a few centimetres in a stride."""
    def f(p):
        held = smooth(0.93, 0.99, p.y)
        wb = lerp(0.05, 0.09, clamp((slit - p.y) / (slit - hem)))
        share = smooth(-wb, wb, p.x)
        c = smooth(knee, hem, p.y) * lerp(0.45, 0.85, smooth(0.0, -0.1, p.z))
        free = 1 - held
        return {'pelvis': held, 'thigh_l': free * share * (1 - c), 'calf_l': free * share * c,
                'thigh_r': free * (1 - share) * (1 - c), 'calf_r': free * (1 - share) * c}
    return f


def gown_skirt(f, RU=0.17, top=1.045, hem=HEM, slit=SLIT, folds=14, fold=0.006):
    """A robe's skirt from the waist to the hem, slit front and back up to `slit` (the slits opening a little
    towards the hem), hanging in soft folds that deepen towards the hem, flat in front."""
    w = lambda v: 0.0015 + 0.005 * clamp((slit - v) / (slit - hem))

    def sd(u, v):
        a = u / RU
        hem_a = hem - 0.015 * (1 - math.cos(a)) / 2  # a little longer behind
        cut = min(abs(u), abs(wrap(a - math.pi)) * RU)
        return max(hem_a - v, v - top, -max(cut - w(v), v - slit))

    def surf(u, v):
        a = u / RU
        depth = fold * clamp((0.95 - v) / (0.95 - hem)) * math.sin(a * folds) * smooth(0.45, 0.75, abs(wrap(a)))  # flat under the stoles
        return gown_at(f, a, v, flare(a, v, hem) + depth)
    return plate(surf, sd, -math.pi * RU, math.pi * RU, hem - 0.02, top + 0.004, h=0.004, periodic=True)


def bell(f, RU, t0, t1, off, wide, folds=8, fold=0.004):
    """A sleeve round a form from t0 to t1, `off` from it, widening into a bell over its last part (`wide` out at
    its end), in folds there."""
    def surf(u, v):
        a = u / RU
        k = smooth(t0 + (t1 - t0) * 0.3, t1, v) ** 1.5
        return f.point(a, v, off + wide * k + fold * k * math.sin(a * folds))
    return plate(surf, lambda u, v: max(t0 - v, v - t1), -math.pi * RU, math.pi * RU, t0 - 0.004, t1 + 0.004, h=0.0035, periodic=True)


def skin_patch(bones, keep=None, off=0.0015, mesh='Arms', clear='Head_', g='m'):
    """The body's own surface where it follows `bones` (each vertex by the bone it follows most; `keep` chooses among
    them), stood `off` out along its normals: a glove fitted as closely as the skin, finger by finger. It is taken
    from `mesh`: the reference keeps no faces of the bare skin's hands, but the kit's arms end in the same hands, near
    enough - where the bare hand (`clear`, drawn under a glove, dyed) swells out past them, up to a centimetre at the
    wrist and the thumb, the glove is pushed out to cover it (by the points of the same bone only, so a finger never
    swells into the next)."""
    bd = body(g)
    pick = {}
    for i, (bn, mn) in enumerate(zip(bd['bone_of'], bd['mesh_of'])):
        if bn in bones and mesh in mn and (not keep or keep(bd['V'][i])):
            pick[i] = True
    weld, verts, vbone = {}, [], []  # the dump splits vertices along its seams: weld them back so the normals are shared
    idx = {}
    for i in pick:
        key = tuple(round(x, 5) for x in bd['V'][i])
        if key not in weld:
            weld[key] = len(verts)
            verts.append(Vector(bd['V'][i]))
            vbone.append(bd['bone_of'][i])
        idx[i] = weld[key]
    faces = [tuple(idx[k] for k in f_) for f_ in bd['f'] if all(k in pick for k in f_)]
    faces = [f_ for f_ in faces if len(set(f_)) == 3]
    normals = [Vector((0, 0, 0)) for _ in verts]
    for a_, b_, c_ in faces:
        n = (verts[b_] - verts[a_]).cross(verts[c_] - verts[a_])
        for k in (a_, b_, c_):
            normals[k] += n
    normals = [n.normalized() if n.length > 1e-12 else Vector((0, 1, 0)) for n in normals]
    push = [off] * len(verts)
    if clear:
        pts = [(bd['V'][i], bn) for i, (bn, mn) in enumerate(zip(bd['bone_of'], bd['mesh_of'])) if bn in bones and clear in mn and (not keep or keep(bd['V'][i]))]
        kd = KDTree(len(pts))
        for k, (co, _) in enumerate(pts):
            kd.insert(co, k)
        kd.balance()
        for j, (v, n, b) in enumerate(zip(verts, normals, vbone)):
            for co, k, _ in kd.find_range(v, 0.014):
                if pts[k][1] != b:
                    continue
                dv = co - v
                dd = dv.dot(n)
                if (dv - n * dd).length < 0.005:
                    push[j] = max(push[j], dd + off)
        nbr = [set() for _ in verts]
        for f_ in faces:
            for a_ in f_:
                nbr[a_].update(f_)
        push = [max(push[k] for k in nbr[j] | {j}) for j in range(len(verts))]  # the largest round each, then smoothed
        push = [(push[j] + sum(push[k] for k in nbr[j])) / (1 + len(nbr[j])) for j in range(len(verts))]
    return [v + n * d for v, n, d in zip(verts, normals, push)], faces


_hair = []


def head_reach(y_of, slab=0.012, styles=None, bins=90):
    """How far out from the head's axis (z = 0.008) the bare head and the hairstyles reach round a band at height
    y_of(a), bin by bin round the head (body/hair.json.gz, dumped from the game): the largest of each bin and its
    neighbours, then smoothed - never under it. styles(a) names those to count at angle a (else every one)."""
    if not _hair:
        import gzip
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'body', 'hair.json.gz')
        with gzip.open(path, 'rt', encoding='utf-8') as fh:
            _hair.extend(json.load(fh)['v'])
    R = [0.0] * bins
    for x, y, z, s in _hair:
        a = math.atan2(x, z - 0.008)
        if abs(y - y_of(a)) > slab or (styles and s not in styles(a)):
            continue
        k = int((a + math.pi) / (2 * math.pi) * bins) % bins
        R[k] = max(R[k], math.hypot(x, z - 0.008))
    for _ in range(3):
        R = [max(R[(k - 1) % bins], R[k], R[(k + 1) % bins]) for k in range(bins)]
    for _ in range(4):
        R = [(R[(k - 1) % bins] + 2 * R[k] + R[(k + 1) % bins]) / 4 for k in range(bins)]

    def at(a):
        x = ((a + math.pi) / (2 * math.pi) * bins - 0.5) % bins
        i = int(x)
        return lerp(R[i], R[(i + 1) % bins], x - i)
    return at


class Band:
    """A circlet's band round the head: at angle a (0 in front, +pi/2 at the left) its middle at height y_of(a) and
    `reach(a)` + `gap` from the head's axis; h up from its middle it leans out by `lean` (a crown flares)."""

    def __init__(self, y_of, reach, gap=0.004, lean=0.22, RU=0.11):
        self.y_of, self.reach, self.gap, self.lean, self.RU = y_of, reach, gap, lean, RU

    def at(self, a, h):
        r = self.reach(a) + self.gap + self.lean * h
        return Vector((r * math.sin(a), self.y_of(a) + h, 0.008 + r * math.cos(a)))

    def normal(self, a, h):
        e = 1e-4
        n = (self.at(a + e, h) - self.at(a - e, h)).cross(self.at(a, h + e) - self.at(a, h - e))
        radial = Vector((math.sin(a), 0.0, math.cos(a)))
        n.normalize()
        return n if n.dot(radial) >= 0 else -n

    def point(self, a, h, off=0.0):
        return self.at(a, h) + self.normal(a, h) * off

    def around(self, a, h):
        return self.reach(a) + self.gap + self.lean * h


def curl(at, along, up, r0, r1, turns=1.25, r=0.0026, n=40):
    """A scroll's curl: a cord winding in from `at` along `along`, round towards `up`, tightening from r0 to r1."""
    a_, u_ = Vector(along).normalized(), Vector(up).normalized()
    pts, radii = [], []
    for k in range(n + 1):
        t = k / n
        th = 2 * math.pi * turns * t
        rr = lerp(r0, r1, t)
        c = Vector(at) + u_ * r0  # the curl's eye, above the start
        pts.append(c + a_ * (rr * math.sin(th)) - u_ * (rr * math.cos(th)))
        radii.append(r * lerp(1.0, 0.55, t))
    return tube(pts, radii, 8)


def infernal_silk(scale=0.16):
    """The infernal mage's cloth: a black silk with a faint cold sheen, bordered in gold braid and embroidered in its
    panels in raised gold scrollwork, as the harness's lacquer is."""
    gold = 0xc9a245
    return mat(f'infernal_silk_{scale}', 0x0e0f14, 'cloth', engrave='scroll', engrave_color=gold, emboss=True, rough=0.6, trim=gold,
               sheen=0x1d2232, gloss=0.3, scale=scale, panels=True)


def infernal_robe():
    """The black knight's mage: a robe of black silk to mid-shin, slit front and back, its hem and slits
    bordered in gold braid and embroidered above the hem in gold scrollwork as the harness is; a fitted bodice with a band
    of scrollwork down the front set with gold studs, and a scrolled yoke; bell sleeves with embroidered cuffs; a high
    collar, open in front, its corners set with gold rosettes; a mantle over each shoulder, its edge in three lobes, a
    gold star at its crown; a black belt corded in gold with the harness's gold star and dark stone; and hanging from
    it over the front slit two stoles embroidered finer, drawn to a point, a gold drop at each."""
    p = Piece('robe')
    p.budget, p.tex, p.min_ratio = 12000, 2048, 0.03
    silk = infernal_silk()
    orn, blk, gold, mail, leather, stone = infernal_mats()
    belt = mat('infernal_belt', 0x141215, 'leather', rough=0.5)
    F = forms()
    torso, arm, fore = F['torso'], F['arm'], F['forearm']
    gw = gown_form()
    cloth = dict(solid=0.0022, roll=0.0012, roll_mat=gold)
    # the skirt, embroidered above the hem
    p.add(silk, *gown_skirt(gw), deco=ornate(0.012, lambda q: smooth(HEM + 0.12, HEM + 0.09, q.y)), skin=gown_skin(), **cloth)
    # the bodice: scrollwork down the front and over the yoke, gold studs down the front
    front = lambda q: smooth(0.034, 0.026, abs(q.x)) if q.z > 0 else 0.0
    p.add(silk, *ring_plate(torso, 0.17, 0.975, 1.505, 0.004), deco=ornate(0.01, lambda q: max(front(q), smooth(1.37, 1.4, q.y))), skin=TORSO,
          **cloth)
    for y in (1.1, 1.16, 1.22, 1.28, 1.34):
        p.add(gold, *rivet(torso.point(0.0, y, 0.0058), torso.normal(0.0, y), 0.0042, washer=0.0065), skin=TORSO)
    # the sleeves: close over the upper arm, a bell from the elbow, its cuff embroidered
    both(p, silk, ring_plate(arm, 0.08, -0.07, 0.262, 0.005), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), deco=PLAIN, **cloth)
    cuff = lambda q: smooth(0.17, 0.19, q.x - bone('lowerarm_l').x)
    both(p, silk, bell(fore, 0.07, -0.05, 0.255, 0.009, 0.05), ('upperarm_l', 'lowerarm_l'), deco=ornate(0.01, cuff), **cloth)
    # the mantles, a gold star at the crown of each
    capoff = lambda u, v: 0.016 + 0.006 * smooth(-0.03, -0.085, v)
    both(p, silk, teeth_plate(arm, 0.09, -2.45, 2.45, -0.085, 0.13, capoff, 3, 0.035, 'high', shape='round'), ('clavicle_l', 'upperarm_l'),
         deco=ornate(0.011), sharp=35, **cloth)
    shoulder = outline(star((0.0, 0.0), 0.017, 0.011, 8), 4)
    both(p, gold, plate(lambda u, v: arm.point(u / 0.09, v, capoff(u, v) + 0.0012), lambda u, v: sd_poly(u, v, shoulder), -0.02, 0.02, -0.02, 0.02,
                        h=0.0012), ('clavicle_l', 'upperarm_l'), solid=0.0018, roll=0.0008,
         bump=lambda q: 0.003 * gauss((q - arm.at(0.0, 0.0)).length, 0.008))
    # the high collar, open in front, higher behind; a gold rosette at each front corner
    neck = Cone(-0.04, 1.47, 0.098, 0.09, 1.65, 0.118, 0.11)
    top_c = lambda a: 1.575 + 0.05 * (1 - math.cos(a)) / 2
    collar_sd = lambda u, v: max(1.472 - v, v - top_c(u / 0.1), 0.75 - abs(wrap(u / 0.1)))
    p.add(silk, *plate(lambda u, v: neck.point(u / 0.1, v, 0.0), collar_sd, -math.pi * 0.1, math.pi * 0.1, 1.468, 1.63, h=0.003, periodic=True),
          deco=ornate(0.009), skin=('neck_01', 'spine_03'), sharp=35, **cloth)
    for s_ in (1, -1):
        a = s_ * 0.86
        at, n = neck.point(a, 1.545, 0.001), neck.normal(a, 1.545)
        p.add(gold, *rivet(at, n, 0.0055, washer=0.0095), skin=('neck_01', 'spine_03'))
        p.add(stone, *gem(at + n * 0.0035, n, 0.004), skin=('neck_01', 'spine_03'))
    # the belt, corded in gold above and below, the star and the stone in front
    hip = ('pelvis', 'spine_01')
    p.add(belt, *strap(gw, [(2 * math.pi * k / 96, 1.0) for k in range(97)], 0.034, 0.0035, 0.0105), skin=hip, forge=creased(0.0004))
    for y in (0.983, 1.017):
        p.add(gold, *tube([gw.point(2 * math.pi * k / 96, y, 0.0125) for k in range(96)], 0.0017, 6, closed=True), skin=hip)
    med = outline(star((0.0, 1.0), 0.034, 0.023, 8), 4)
    p.add(gold, *plate(lambda u, v: gw.point(u / 0.16, v, 0.016), lambda u, v: sd_poly(u, v, med), -0.042, 0.042, 0.958, 1.042),
          solid=0.003, roll=0.0012, skin=hip, bump=lambda q: 0.004 * gauss(math.hypot(q.x, q.y - 1.0), 0.02))
    p.add(stone, *gem(gw.point(0.0, 1.0, 0.0215), gw.normal(0.0, 1.0), 0.0085), skin=hip)
    # the stoles over the front slit, from under the belt to a point; a gold drop at each point
    RU = 0.17
    stole = outline([(0.006, 1.005), (0.07, 1.005), (0.07, 0.47), (0.038, 0.405), (0.006, 0.47)], 6)
    soff = lambda u, v: flare(u / RU, v) + 0.006
    both(p, infernal_silk(0.07), plate(lambda u, v: gown_at(gw, u / RU, v, soff(u, v)), lambda u, v: sd_poly(u, v, stole), 0.0, 0.076, 0.395, 1.01,
                                       h=0.0032),
         gown_skin(), deco=ornate(0.009), sharp=35, **cloth)
    tip = gown_at(gw, 0.038 / RU, 0.405, soff(0.038, 0.405))
    both(p, gold, merge(oball(tip + Vector((0, -0.006, 0.002)), (0.006, 0.009, 0.006)), tube([tip + Vector((0, 0.002, 0)), tip + Vector((0, -0.004, 0.002))],
                                                                                              0.0022, 8)), gown_skin())
    return p


def infernal_circlet():
    """A diadem of gold over the brow, open behind the ears so any hair passes it: a band of black lacquer worked in
    raised gilt scrollwork between two roped gold edges, rising in front into an openwork crest of gold - a tall flame
    between C-scrolls, small points along the band - with the harness's dark stone at its foot and two small stones in
    the scrolls; two small gold horns at the temples, sweeping up and curling in as the helm's, set in star mounts;
    each end of the band finished in a gold curl."""
    p = Piece('circlet')
    p.budget = 4000
    gold_c = 0xc9a245
    orn = mat('infernal_crown', 0x0b0c0f, 'enamel', engrave='scroll', engrave_color=gold_c, emboss=True, rough=0.14, metal=0.6, bump=1.2,
              trim=gold_c, sheen=0x161a24, gloss=0.85, scale=0.05, panels=True)
    _, blk, gold, mail, leather, stone = infernal_mats()
    A, hw = 1.72, 0.0075  # how far round the band runs either side; half its height
    y_of = lambda a: 0.15 + 0.016 * (1 - math.cos(a)) / 2
    short = {'m0', 'f0', 'm1', 'f1', 'm4', 'f4', 'head'}
    every = short | {'m2', 'f2'}
    reach = head_reach(y_of, 0.016, lambda a: every if abs(a) < 1.6 else short)
    band = Band(y_of, reach)
    RU = band.RU
    p.add(orn, *plate(lambda u, v: band.point(u / RU, v), lambda u, v: max(abs(u) - A * RU, abs(v) - hw), -A * RU - 0.004, A * RU + 0.004,
                      -hw - 0.003, hw + 0.003, h=0.0016), solid=0.0025, roll=0.0011, roll_mat=gold, rope=True, deco=ornate(0.0028), sharp=30)
    # the crest: a flame between C-scrolls, small points along the band
    flame = outline(symmetric([(0.0, 0.064), (0.005, 0.054), (0.011, 0.04), (0.016, 0.026), (0.018, 0.014), (0.015, 0.004)]), 6)
    rings = [(s_ * cu, cv, r) for s_ in (1, -1) for cu, cv, r in ((0.031, 0.021, 0.0125), (0.057, 0.013, 0.0085))]
    points = [(s_ * u_, 0.0) for s_ in (1, -1) for u_ in (0.083, 0.101, 0.119, 0.137, 0.155)]

    def crest_sd(u, v):
        f = max(sd_poly(u, v, flame), -sd_ellipse(u, v, 0.0, 0.032, 0.0048, 0.011))
        for cu, cv, r in rings:
            f = min(f, abs(math.hypot(u - cu, v - cv) - r) - 0.0019)
        for cu, _ in points:
            f = min(f, max(sd_poly(u, v, [(cu - 0.006, hw - 0.002), (cu + 0.006, hw - 0.002), (cu, hw + 0.011)]), 0.0))
        return max(f, -hw * 0.4 - v)
    p.add(gold, *plate(lambda u, v: band.point(u / RU, v, 0.0016), crest_sd, -0.165, 0.165, -hw * 0.4 - 0.003, 0.068, h=0.0011),
          solid=0.002, roll=0.0007, sharp=30)
    # the dark stone at the flame's foot, in a beaded setting; two small stones in the scrolls
    at, n = band.point(0.0, 0.006, 0.0042), band.normal(0.0, 0.006)
    t_, n_, b_ = frame(n)
    p.add(gold, *merge(oball(at - n * 0.001, (0.0098, 0.0022, 0.0098), (t_, n_, b_), 14, 5),
                       *[oball(at + (t_ * math.cos(k * math.pi / 5) + b_ * math.sin(k * math.pi / 5)) * 0.0098, (0.0016, 0.0013, 0.0016), (t_, n_, b_), 6, 4)
                         for k in range(10)]))
    p.add(stone, *gem(at + n * 0.0018, n, 0.0072))
    for s_ in (1, -1):
        c = band.point(s_ * 0.031 / RU, 0.021, 0.0035)
        p.add(stone, *gem(c, band.normal(s_ * 0.031 / RU, 0.021), 0.0042))
    # the horns at the temples, in star mounts; the curls at the ends
    for s_ in (1, -1):
        a = s_ * 0.98
        root, n = band.point(a, 0.002, 0.0), band.normal(a, 0.002)
        radial = Vector((n.x, 0.0, n.z)).normalized()
        p.add(gold, *horn(root, radial + Vector((0, 0.35, 0)), UP, -radial + Vector((0, 0, -0.15)), 0.058, 0.0078))
        mount = outline(star((a * RU, 0.002), 0.0125, 0.0085, 6), 4)
        p.add(gold, *plate(lambda u, v: band.point(u / RU, v, 0.0025), lambda u, v, mount=mount: sd_poly(u, v, mount), a * RU - 0.015,
                           a * RU + 0.015, -0.014, 0.017, h=0.0009), solid=0.0018, roll=0.0007, sharp=30)
        end = s_ * A
        tang = (band.at(end + s_ * 1e-3, 0.0) - band.at(end, 0.0)).normalized()
        p.add(gold, *curl(band.point(end, -hw * 0.6, 0.0006), tang, -UP, 0.0085, 0.0022, turns=1.2, r=0.0024))
    # how much of any hair the band lets through (none, if it is fitted right)
    out = 0
    for x, y, z, s in _hair:
        a = math.atan2(x, z - 0.008)
        if abs(a) < A and abs(y - y_of(a)) < hw and s in (every if abs(a) < 1.6 else short):
            out += math.hypot(x, z - 0.008) > reach(a) + band.gap - 0.0025
    print(f'[gear] circlet: {out} hair or head points through the band')
    return p


def infernal_mage_gloves():
    """Gloves of fine black kid fitted finger by finger, a dark stone set in gold on the back of each hand over a
    panel of gold embroidery, and a flared cuff of black lacquer worked in scrollwork, bordered in gold."""
    p = Piece('gloves')
    p.budget = 5000
    gold_c = 0xc9a245
    kid = mat('infernal_kid', 0x121014, 'leather', engrave='scroll', engrave_color=gold_c, emboss=True, rough=0.45, trim=gold_c, gloss=0.4,
              scale=0.06, panels=True)
    orn, blk, gold, mail, leather, stone = infernal_mats()
    hand = forms()['hand']
    hx = bone('hand_l')
    tips = tuple(f'{f}_04_leaf_l' for f in ('index', 'middle', 'ring', 'pinky', 'thumb'))
    fingers = ('hand_l',) + FINGERS_L + THUMB_L + tips
    back = lambda q: smooth(hx.y - 0.004, hx.y + 0.004, q.y) * smooth(hx.x - 0.005, hx.x + 0.01, q.x) * smooth(hx.x + 0.09, hx.x + 0.075, q.x)
    both(p, kid, skin_patch(fingers + ('lowerarm_l',), keep=lambda v: v.x > hx.x - 0.04), fingers + ('lowerarm_l',), whole=True,
         deco=ornate(0.004, back), wound=True)
    both(p, orn, ring_plate(hand, 0.06, -0.078, 0.006, lambda u, v: 0.0035 + 0.017 * smooth(-0.005, -0.078, v)), ('hand_l', 'lowerarm_l'),
         deco=ornate(0.006), solid=0.0022, roll=0.0011, roll_mat=gold)
    at, n = hand.point(0.0, 0.045, 0.0004), hand.normal(0.0, 0.045)
    both(p, gold, rivet(at, n, 0.0058, washer=0.0098), ('hand_l',))
    both(p, stone, gem(at + n * 0.0035, n, 0.0048), ('hand_l',))
    return p


def infernal_shoes():
    """Soft boots of black leather to mid-calf, under the robe's hem: a cuff turned down at the top worked in gold
    scrollwork, a black strap corded in gold round the ankle with a small gold star, a gold toe cap, and a sole."""
    p = Piece('feet')
    p.budget = 5000
    gold_c = 0xc9a245
    boot = mat('infernal_boot', 0x131116, 'leather', engrave='scroll', engrave_color=gold_c, emboss=True, rough=0.5, trim=gold_c, gloss=0.35,
               scale=0.09, panels=True)
    orn, blk, gold, mail, leather, stone = infernal_mats()
    sole = mat('sole', 0x17130f, 'leather', rough=0.85)
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = dict(solid=0.0024, roll=0.0011, roll_mat=gold)
    both(p, boot, ring_plate(calf, 0.06, 0.2, 0.455, 0.0032), ('calf_l', 'foot_l'), deco=PLAIN, **edge)
    both(p, boot, ring_plate(foot, 0.045, -0.085, 0.25, 0.0032), ('foot_l', 'ball_l'), deco=PLAIN, **edge)
    both(p, boot, ring_plate(calf, 0.06, 0.19, 0.255, lambda u, v: 0.0068 + 0.004 * smooth(0.255, 0.19, v)), ('calf_l',), deco=ornate(0.008), **edge)
    both(p, blk, ring_plate(calf, 0.06, 0.405, 0.428, 0.0058), ('calf_l', 'foot_l'), deco=PLAIN, **edge)
    ankle = outline(star((0.0, 0.4165), 0.011, 0.0072, 6), 4)
    both(p, gold, plate(lambda u, v: calf.point(u / 0.06, v, 0.0086), lambda u, v: sd_poly(u, v, ankle), -0.014, 0.014, 0.402, 0.431, h=0.0009),
         ('calf_l', 'foot_l'), solid=0.0018, roll=0.0007)
    both(p, gold, band_plate(foot, 0.045, -1.3, 1.3, 0.198, 0.25, 0.0058, 0.008), ('ball_l',), solid=0.0024, roll=0.001)
    both(p, sole, band_plate(foot, 0.045, math.pi - 1.25, math.pi + 1.25, -0.085, 0.25, 0.0052, 0.01), ('foot_l', 'ball_l'), solid=0.0048)
    return p


# ---------------------------------------------------------------- what every set's mage gear is built from

def hem_edge(shape, depth, seed=0.0):
    """A free edge's profile: how far back from its furthest point the edge runs at x, counted in lobes (x = 2.5 is
    halfway along the third): 'round' scallops, 'point' dags, 'leaf' leaves (pointed, round-sided), 'ragged' torn."""
    def g(x):
        f = abs(2 * (x - math.floor(x)) - 1)  # 0 at a lobe's middle, 1 between two
        if shape == 'round':
            return depth * (1 - math.sqrt(max(0.0, 1 - f * f)))
        if shape == 'point':
            return depth * f ** 0.85
        if shape == 'leaf':
            return depth * (0.35 * f + 0.65 * (1 - math.sqrt(max(0.0, 1 - f * f))))
        if shape == 'ragged':
            return depth * (0.5 + 0.5 * noise.noise(Vector((x * 0.9 + seed, seed * 1.3, 0.0)))) * (0.55 + 0.45 * abs(math.sin(x * 2.3 + seed)))
        return 0.0
    return g


def skirt_at(f, a, v, hem=HEM, wide=0.095, back=0.035, off=0.0, folds=14, fold=0.006, flat=0.45, drape=None, **_):
    """Where a robe's skirt (robe_skirt, the same arguments) is at angle a and height v, `off` out from it: for what
    lies on it (bands, sashes, fur) to follow its folds."""
    hm = hem(a) if callable(hem) else hem
    k = clamp((0.95 - v) / (0.95 - hm))
    depth = fold * k * math.sin(a * folds) * smooth(flat, flat + 0.3, abs(wrap(a)))
    return gown_at(f, a, v, flare(a, v, hm, wide, back) + off + depth + (drape(a, v) if drape else 0.0))


def robe_skirt(f, top=1.045, hem=HEM, RU=0.17, slits=(), edge=None, lobes=0, h=0.004, **kw):
    """A robe's skirt round a form (the gown's, or a Dress), from `top` down to the hem - a height, or the height at
    each angle - widening as an A-line (flare: wide, and back more behind), hanging in `folds` deepening towards the
    hem (none within `flat` of the front), `off` further out (a layer over another), drape(a, t) metres more (a gown
    falling from under the bust). slits: (angle, how far up, half-width at its top, at the hem) each, cut up from the
    hem (or, reaching the top, a coat's opening); edge: the hem's profile (hem_edge), `lobes` of it round the hem."""
    hem_of = hem if callable(hem) else (lambda a, h0=hem: h0)
    low = min(hem_of(2 * math.pi * k / 24) for k in range(24))

    def sd(u, v):
        a = u / RU
        hm = hem_of(a)
        s = max(hm + (edge(lobes * (a + math.pi) / (2 * math.pi)) if edge else 0.0) - v, v - top)
        for ac, st, w0, w1 in slits:
            w = lerp(w1, w0, clamp((v - hm) / (st - hm)))
            s = max(s, -max(abs(wrap(a - ac)) * RU - w, v - st))
        return s
    return plate(lambda u, v: skirt_at(f, u / RU, v, hem, **kw), sd, -math.pi * RU, math.pi * RU, low - 0.004, top + 0.004, h=h, periodic=True)


def ring_teeth_sd(u, v, RU, t0, t1, points, depth, free='low', shape='point', phase=0.0):
    """A band all round a form from t0 to t1, its free edge cut into `points` scales (teeth_sd, but closing on itself;
    phase turns them by a fraction of one)."""
    x = (u / (2 * math.pi * RU) + 0.5) * points + phase
    f = abs(2 * (x - math.floor(x)) - 1)
    notch = depth * (1 - math.sqrt(max(0.0, 1 - f * f)) if shape == 'round' else f ** 0.85)
    return max(v - t1, t0 + notch - v) if free == 'low' else max(t0 - v, v - (t1 - notch))


def sleeve(f, RU, t0, t1, off, wide=0.0, folds=8, fold=0.004, edge=None, lobes=0, end=None, opening=None, h=0.0035):
    """A sleeve round an arm's form from t0 to t1, `off` from it, widening over its last part into a bell `wide` out
    at its end, in folds there; its end cut in `lobes` of `edge` (hem_edge) round the arm, running on past t1 by end(a)
    (a point over the back of the hand); opening = (angle, from t, half-width at the end): slit open along the arm from
    there (an angel sleeve, open underneath)."""
    def sd(u, v):
        a = u / RU
        stop = t1 + (end(a) if end else 0.0) - (edge(lobes * (a + math.pi) / (2 * math.pi)) if edge else 0.0)
        s = max(t0 - v, v - stop)
        if opening:
            ac, ts, w1 = opening
            w = w1 * clamp((v - ts) / (t1 - ts)) ** 0.8
            s = max(s, -max(abs(wrap(a - ac)) * RU - w, ts - v))
        return s

    def surf(u, v):
        a = u / RU
        k = smooth(t0 + (t1 - t0) * 0.3, t1, v) ** 1.5
        return f.point(a, v, off + wide * k + fold * k * math.sin(a * folds))
    longest = t1 + (max(end(2 * math.pi * k / 36) for k in range(36)) if end else 0.0)
    return plate(surf, sd, -math.pi * RU, math.pi * RU, t0 - 0.004, longest + 0.004, h=h, periodic=True)


class Dress:
    """One form from the chest down to the shins: the torso's above the waist, the gown's below it, blended between
    (both share their axis, up the body from the ground, angle 0 in front) - a gown cut in one piece from under the
    bust."""

    def __init__(self):
        self.torso, self.gown = forms()['torso'], gown_form()
        g = self.gown
        self.o, self.d, self.up, self.side = g.o, g.d, g.up, g.side

    def radius(self, a, t):
        k = smooth(1.0, 1.12, t)
        return lerp(self.gown.radius(a, min(t, 1.1)), self.torso.radius(a, max(t, 0.9)), k)

    def at(self, a, t):
        return self.o + self.d * t + (self.up * math.cos(a) + self.side * math.sin(a)) * self.radius(a, t)

    def normal(self, a, t):
        e = 1e-3
        n = (self.at(a + e, t) - self.at(a - e, t)).cross(self.at(a, t + e) - self.at(a, t - e))
        radial = self.up * math.cos(a) + self.side * math.sin(a)
        if n.length < 1e-12:
            return radial
        n.normalize()
        return n if n.dot(radial) >= 0 else -n

    def point(self, a, t, off=0.0):
        return self.at(a, t) + self.normal(a, t) * off

    def around(self, a, t):
        return self.radius(a, t)


def dress_skin(**kw):
    """The weights of a gown cut from under the bust: the trunk's above the waist (as the body's under it), a robe's
    skirt's below (gown_skin), blended over the waist."""
    below = gown_skin(**kw)
    bd = body()

    def f(p):
        k = smooth(1.0, 1.08, p.y)
        if k <= 0.0:
            return below(p)
        up = transfer(p, TORSO, bd)
        total = sum(up.values()) or 1.0
        w = {b: k * x / total for b, x in up.items()}
        if k < 1.0:
            for b, x in below(p).items():
                w[b] = w.get(b, 0.0) + (1 - k) * x
        return w
    return f


def styles_at(a):
    """The hairstyles a circlet must clear at angle a round the head: every one but towards the back, where the buns sit."""
    short = {'m0', 'f0', 'm1', 'f1', 'm4', 'f4', 'head'}
    return short | {'m2', 'f2'} if abs(a) < 1.6 else short


def diadem(p, material, A=1.72, hw=0.0075, y_front=0.15, rise=0.016, lean=0.22, gap=0.004, rope=True, deco=None, roll_mat=None, h=0.0016):
    """A circlet's band round the brow and temples, open behind the ears (so any hair passes it), fitted outside the
    head and every hairstyle (head_reach): half its height hw, its middle y_front over the brow, rising by `rise` over
    the temples, leaning out as it rises. Returns the band, its height at each angle and how far round it runs."""
    y_of = lambda a: y_front + rise * (1 - math.cos(a)) / 2
    reach = head_reach(y_of, max(0.016, hw * 2), styles_at)
    band = Band(y_of, reach, gap=gap, lean=lean)
    RU = band.RU
    p.add(material, *plate(lambda u, v: band.point(u / RU, v), lambda u, v: max(abs(u) - A * RU, abs(v) - hw), -A * RU - 0.004, A * RU + 0.004,
                           -hw - 0.003, hw + 0.003, h=h), solid=0.0025, roll=0.0011, roll_mat=roll_mat, rope=rope, deco=deco, sharp=30)
    out = sum(1 for x, y, z, s in _hair if abs(math.atan2(x, z - 0.008)) < A and abs(y - y_of(math.atan2(x, z - 0.008))) < hw
              and s in styles_at(math.atan2(x, z - 0.008)) and math.hypot(x, z - 0.008) > reach(math.atan2(x, z - 0.008)) + gap - 0.0025)
    print(f'[gear] circlet: {out} hair or head points through the band')
    return band, y_of, A


def fine_gloves(p, material, deco=None, off=0.0015):
    """Gloves fitted finger by finger (skin_patch), both hands; their cuffs and ornaments are each set's own."""
    hx = bone('hand_l')
    tips = tuple(f'{f}_04_leaf_l' for f in ('index', 'middle', 'ring', 'pinky', 'thumb'))
    fingers = ('hand_l',) + FINGERS_L + THUMB_L + tips
    both(p, material, skin_patch(fingers + ('lowerarm_l',), keep=lambda v: v.x > hx.x - 0.04, off=off), fingers + ('lowerarm_l',), whole=True, deco=deco,
         wound=True)


def back_of_hand(x0=0.005, x1=0.08):
    """Where the back of the left hand is (a deco mask), between x0 and x1 past the wrist."""
    hx = bone('hand_l')
    return lambda q: smooth(hx.y - 0.004, hx.y + 0.004, q.y) * smooth(hx.x + x0 - 0.01, hx.x + x0, q.x) * smooth(hx.x + x1 + 0.01, hx.x + x1, q.x)


def soft_boots(p, material, sole, top=0.2, off=0.0032, deco=None, edge=None):
    """Soft boots to `top` down the calf (0.2: mid-calf), their shaft and foot, and a sole under them; each set adds
    its cuff, straps and toe."""
    F = forms()
    calf, foot = F['calf'], F['foot']
    edge = edge or dict(solid=0.0024, roll=0.0011)
    both(p, material, ring_plate(calf, 0.06, top, 0.455, off), ('calf_l', 'foot_l'), deco=deco or PLAIN, **edge)
    both(p, material, ring_plate(foot, 0.045, -0.085, 0.25, off), ('foot_l', 'ball_l'), deco=deco or PLAIN, **edge)
    both(p, sole, band_plate(foot, 0.045, math.pi - 1.25, math.pi + 1.25, -0.085, 0.25, off + 0.002, 0.01), ('foot_l', 'ball_l'), solid=0.0048)
    return calf, foot


# ---------------------------------------------------------------- the abyssal mage: a wrap robe of the deep sea

def abyssal_cloth():
    """The abyssal mage's cloth: a deep sea-blue silk with a cold sheen, bordered in pale steel and embroidered in its
    panels with pale waves; a sea-green silk for the sash; pearls; a pale, nacreous blue lacquer for the shells."""
    rim = 0x8fa9bf
    return (mat('abyssal_silk', 0x0f2a4a, 'cloth', engrave='waves', engrave_color=0x9fc3dc, emboss=True, rough=0.55, trim=rim, sheen=0x1d4a6e,
                gloss=0.35, panels=True),
            mat('abyssal_sash', 0x1a5566, 'cloth', engrave='waves', engrave_color=0x9fd0d6, emboss=True, rough=0.55, trim=rim, sheen=0x2a7a80,
                gloss=0.35, panels=True),
            mat('pearl', 0xe9e4da, 'enamel', rough=0.1, metal=0.2, sheen=0xd7cbe6, gloss=0.95),
            mat('abyssal_shell', 0x4f86b2, 'enamel', rough=0.22, metal=0.4, sheen=0x9cc4dc, gloss=0.75))


def fan(c, r, lobes=9, notch=0.12, base=0.35, n=72):
    """A scallop shell's outline round (u, v) c, opening upwards: a half disc `r` across, its rim cut into `lobes`
    rounded lobes, drawn in to a hinge at the bottom."""
    pts = []
    for k in range(n + 1):
        th = math.pi * k / n
        rr = r * (1 - notch * abs(math.sin(th * lobes / 2)) ** 0.7)
        pts.append((c[0] + rr * math.cos(th), c[1] + rr * math.sin(th)))
    pts += [(c[0] - r * base, c[1] - r * 0.18), (c[0] + r * base, c[1] - r * 0.18)]
    return pts


def abyssal_robe():
    """The abyssal mage: a wrap robe of deep sea-blue silk to mid-shin, the left side crossed over the right - a broad
    band embroidered with pale waves runs from the right of the neck across the chest to the left hip and down to the
    hem - its hem cut in scallops like a shell's edge, embroidered with waves above them, a slit behind; sleeves
    widening into bells, their ends scalloped; a ribbed scallop shell of pale, nacreous lacquer over each shoulder, edged in pale
    steel; a band round the neck; a sea-green sash knotted at the left hip, its two ends hanging to the knee, a pearl
    in the knot; a shell brooch with a pearl where the band crosses the chest."""
    p = Piece('robe')
    p.budget, p.tex, p.min_ratio = 12000, 2048, 0.03
    silk, sash, pearl, shell_ = abyssal_cloth()
    steel, lacquer, rim = abyssal_mats()
    F = forms()
    torso, arm, fore = F['torso'], F['arm'], F['forearm']
    gw = gown_form()
    cloth = dict(solid=0.0022, roll=0.0012, roll_mat=rim)
    RU, hem = 0.17, 0.3
    sk = dict(hem=hem, flat=0.0, folds=13)
    skin = gown_skin(hem=hem)
    # the skirt, scalloped, embroidered above the scallops, slit behind
    p.add(silk, *robe_skirt(gw, slits=((math.pi, 0.62, 0.0015, 0.005),), edge=hem_edge('round', 0.026), lobes=22, **sk),
          deco=ornate(0.011, lambda q: smooth(hem + 0.15, hem + 0.12, q.y)), skin=skin, **cloth)
    # the bodice, and the band of the wrap from the right of the neck across the chest to the left hip, then down
    p.add(silk, *ring_plate(torso, RU, 0.975, 1.505, 0.004), deco=PLAIN, skin=TORSO, **cloth)
    wrap_line = [(-0.058, 1.53), (0.064, 0.99)]
    p.add(silk, *plate(lambda u, v: torso.point(u / RU, v, 0.0068), lambda u, v: max(ribbon_sd(u, v, wrap_line, [0.022, 0.022]), 0.985 - v, v - 1.508),
                       -0.1, 0.11, 0.98, 1.512), deco=ornate(0.008), skin=TORSO, sharp=35, **cloth)
    p.add(silk, *plate(lambda u, v: skirt_at(gw, u / RU, v, off=0.0046, **sk), lambda u, v: max(abs(u - 0.064) - 0.022, hem + 0.004 - v, v - 1.04),
                       0.038, 0.09, hem, 1.044), deco=ornate(0.008), skin=skin, sharp=35, **cloth)
    # the brooch where the band crosses the chest: a shell of pale steel, a pearl in it
    at, n = torso.point(0.0, 1.27, 0.009), torso.normal(0.0, 1.27)
    shell = outline(fan((0.0, 1.262), 0.02), 3)
    p.add(rim, *plate(lambda u, v: torso.point(u / RU, v, 0.0088 + 0.0012 * (0.5 + 0.5 * math.cos(9 * math.atan2(v - 1.262, u)))),
                      lambda u, v: sd_poly(u, v, shell), -0.025, 0.025, 1.255, 1.287, h=0.0009), solid=0.0018, roll=0.0007, skin=TORSO)
    p.add(pearl, *oball(at + n * 0.004 + Vector((0, -0.004, 0)), 0.0062), skin=TORSO)
    # the band round the neck
    neck = Cone(-0.04, 1.47, 0.1, 0.092, 1.56, 0.085, 0.082)
    p.add(silk, *ring_plate(neck, 0.1, 1.476, 1.535, 0.0), deco=ornate(0.007), skin=('neck_01', 'spine_03'), **cloth)
    # the sleeves: close over the upper arm, a bell from the elbow, its end scalloped and embroidered
    both(p, silk, ring_plate(arm, 0.08, -0.07, 0.262, 0.005), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), deco=PLAIN, **cloth)
    cuff = lambda q: smooth(0.16, 0.18, q.x - bone('lowerarm_l').x)
    both(p, silk, sleeve(fore, 0.07, -0.05, 0.258, 0.009, 0.045, edge=hem_edge('round', 0.02), lobes=8), ('upperarm_l', 'lowerarm_l'),
         deco=ornate(0.01, cuff), **cloth)
    # a scallop shell over each shoulder
    both(p, shell_, shell_plate(arm, 0.09, -2.0, 2.0, -0.075, 0.125, lambda u, v: 0.017 + 0.005 * smooth(-0.02, -0.075, v), ribs=9, depth=0.024),
         ('clavicle_l', 'upperarm_l'), deco=lambda q: 0.0, solid=0.0028, roll=0.0013, roll_mat=rim, sharp=35)
    both(p, rim, rivet(arm.point(0.0, -0.068, 0.024), arm.normal(0.0, -0.068), 0.0075, washer=0.012), ('clavicle_l', 'upperarm_l'))
    # the sash, knotted at the left hip, its ends hanging to the knee, a pearl in the knot
    hip = ('pelvis', 'spine_01')
    p.add(sash, *plate(lambda u, v: gw.point(u / 0.16, v, 0.013), lambda u, v: max(0.957 - v, v - 1.046), -math.pi * 0.16, math.pi * 0.16, 0.953, 1.05,
                       periodic=True), deco=ornate(0.007), skin=hip, **cloth)
    ka = 1.1
    kc, kn = gw.point(ka, 1.0, 0.03), gw.normal(ka, 1.0)
    t_, n_, b_ = frame(kn)
    p.add(sash, *oball(kc, (0.024, 0.016, 0.02), (t_, n_, b_), 14, 8), skin=hip)
    for k, (ac, y_end) in enumerate(((ka - 0.1, 0.56), (ka + 0.1, 0.5))):
        u0 = ac * RU
        tail = outline([(u0 - 0.023, 1.0), (u0 + 0.023, 1.0), (u0 + 0.023, y_end + 0.035), (u0, y_end), (u0 - 0.023, y_end + 0.035)], 4)
        p.add(sash, *plate(lambda u, v, k=k: skirt_at(gw, u / RU, v, off=0.0105 + 0.0045 * k, **sk), lambda u, v, tail=tail: sd_poly(u, v, tail),
                           u0 - 0.03, u0 + 0.03, y_end - 0.004, 1.004), deco=ornate(0.006, lambda q: smooth(y_end + 0.13, y_end + 0.1, q.y)), skin=skin,
              sharp=35, **cloth)
    p.add(pearl, *oball(kc + kn * 0.015, 0.0075), skin=hip)
    return p


def abyssal_circlet():
    """A diadem of blued steel etched with waves over the brow and the temples, edged in a twisted cord of pale steel:
    in front a scallop shell of pale, nacreous lacquer with a pearl hanging under it on the brow, a wave of pale steel breaking
    outwards either side of it and a smaller one beyond; small shells at the temples; each end curling into a wave."""
    p = Piece('circlet')
    p.budget = 4000
    steel, lacquer, rim = abyssal_mats()
    pearl, shell_ = abyssal_cloth()[2:]
    hw = 0.0065
    band, y_of, A = diadem(p, steel, hw=hw, deco=lambda q, d: smooth(0.002, 0.0035, d), roll_mat=rim)
    RU = band.RU
    waves = [(s_ * cu, cv, r, s_) for s_ in (1, -1) for cu, cv, r in ((0.037, 0.02, 0.0125), (0.07, 0.014, 0.0085))]

    def wave_sd(u, v):
        f = 1.0
        for cu, cv, r, s_ in waves:
            crescent = max(math.hypot(u - cu, v - cv) - r, -(math.hypot(u - (cu + s_ * 0.38 * r), v - (cv - 0.2 * r)) - 0.7 * r))
            foot = sd_poly(u, v, [(cu - s_ * r * 1.25, hw - 0.002), (cu + s_ * 0.3 * r, hw - 0.002), (cu - s_ * 0.2 * r, cv)] if s_ > 0 else
                           [(cu + s_ * 0.3 * r, hw - 0.002), (cu - s_ * r * 1.25, hw - 0.002), (cu - s_ * 0.2 * r, cv)])
            f = min(f, crescent, foot)
        return max(f, -hw * 0.4 - v)
    p.add(rim, *plate(lambda u, v: band.point(u / RU, v, 0.0014), wave_sd, -0.085, 0.085, -hw * 0.4 - 0.003, 0.036, h=0.001), solid=0.0018,
          roll=0.0007, sharp=30)
    # the shells, ribbed: a big one in front, small ones at the temples
    for c, r, deep in (((0.0, hw * 0.3), 0.02, 0.0012), ((0.98 * RU, hw * 0.2), 0.011, 0.0008), ((-0.98 * RU, hw * 0.2), 0.011, 0.0008)):
        shell = outline(fan(c, r), 3)
        p.add(shell_, *plate(lambda u, v, c=c, deep=deep: band.point(u / RU, v, 0.0026 + deep * (0.5 + 0.5 * math.cos(9 * math.atan2(v - c[1], u - c[0])))),
                              lambda u, v, shell=shell: sd_poly(u, v, shell), c[0] - r - 0.003, c[0] + r + 0.003, c[1] - r * 0.3, c[1] + r + 0.003, h=0.0008),
              solid=0.0018, roll=0.0007, roll_mat=rim, deco=lambda q: 1.0, sharp=35)
    # the pearl hanging under the big shell, on a short chain
    top_, n = band.point(0.0, -hw - 0.001, 0.0035), band.normal(0.0, -hw)
    drop = top_ + Vector((0, -0.011, 0)) + n * 0.002
    p.add(rim, *tube([top_, top_.lerp(drop, 0.5) + n * 0.0008, drop + Vector((0, 0.004, 0))], 0.0008, 6, fixed=True))
    p.add(pearl, *oball(drop, (0.0052, 0.0062, 0.0052)))
    for s_ in (1, -1):
        end = s_ * A
        tang = (band.at(end + s_ * 1e-3, 0.0) - band.at(end, 0.0)).normalized()
        p.add(rim, *curl(band.point(end, hw * 0.4, 0.0006), tang, UP, 0.0085, 0.002, turns=1.3, r=0.0022))
    return p


def abyssal_mage_gloves():
    """Gloves of sea-blue leather fitted finger by finger, a panel of waves on the back of each hand under a small
    shell of pale, nacreous lacquer with a pearl, and a cuff of blue lacquer flaring towards the elbow, its edge scalloped, edged in pale steel."""
    p = Piece('gloves')
    p.budget = 5000
    steel, lacquer, rim = abyssal_mats()
    pearl = abyssal_cloth()[2]
    kid = mat('abyssal_kid', 0x13304f, 'leather', engrave='waves', engrave_color=0x9fc3dc, emboss=True, rough=0.45, trim=0x8fa9bf, gloss=0.4,
              panels=True)
    hand = forms()['hand']
    fine_gloves(p, kid, deco=ornate(0.004, back_of_hand()))
    RU = 0.06
    both(p, lacquer, plate(lambda u, v: hand.point(u / RU, v, 0.0035 + 0.017 * smooth(-0.005, -0.078, v)),
                           lambda u, v: ring_teeth_sd(u, v, RU, -0.078, 0.006, 7, 0.012, 'low', 'round'), -math.pi * RU, math.pi * RU, -0.082, 0.01,
                           h=0.0025, periodic=True), ('hand_l', 'lowerarm_l'), deco=lambda q, d: smooth(0.004, 0.007, d), solid=0.0022, roll=0.0011,
         roll_mat=rim)
    both(p, abyssal_cloth()[3], shell_plate(hand, RU, -0.5, 0.5, 0.018, 0.068, 0.0045, ribs=7, depth=0.008), ('hand_l',), deco=lambda q: 0.0, solid=0.002,
         roll=0.0009, roll_mat=rim)
    at, n = hand.point(0.0, 0.03, 0.006), hand.normal(0.0, 0.03)
    both(p, pearl, oball(at + n * 0.003, 0.0045), ('hand_l',))
    return p


def abyssal_shoes():
    """Soft boots of sea-blue leather to mid-calf: a cuff turned down at the top, its edge scalloped and embroidered
    with waves; a small blue shell with a pearl at the outer ankle; a cap of pale steel on the toe; a sole."""
    p = Piece('feet')
    p.budget = 5000
    steel, lacquer, rim = abyssal_mats()
    pearl = abyssal_cloth()[2]
    boot = mat('abyssal_boot', 0x10263f, 'leather', engrave='waves', engrave_color=0x9fc3dc, emboss=True, rough=0.5, trim=0x8fa9bf, gloss=0.35,
               panels=True)
    sole = mat('sole', 0x17130f, 'leather', rough=0.85)
    edge = dict(solid=0.0024, roll=0.0011, roll_mat=rim)
    calf, foot = soft_boots(p, boot, sole, edge=edge)
    RU = 0.06
    both(p, boot, plate(lambda u, v: calf.point(u / RU, v, 0.0068 + 0.004 * smooth(0.27, 0.19, v)),
                        lambda u, v: ring_teeth_sd(u, v, RU, 0.19, 0.27, 9, 0.016, 'high', 'round'), -math.pi * RU, math.pi * RU, 0.186, 0.274,
                        h=0.0028, periodic=True), ('calf_l',), deco=ornate(0.006), **edge)
    a = -math.pi / 2  # the outer ankle
    both(p, abyssal_cloth()[3], shell_plate(calf, RU, a - 0.45, a + 0.45, 0.375, 0.43, 0.0055, ribs=6, depth=0.008), ('calf_l', 'foot_l'), deco=lambda q: 0.0,
         solid=0.002, roll=0.0009, roll_mat=rim)
    both(p, pearl, oball(calf.point(a, 0.392, 0.0105), 0.0042), ('calf_l', 'foot_l'))
    both(p, rim, band_plate(foot, 0.045, -1.3, 1.3, 0.2, 0.25, 0.0058, 0.008), ('ball_l',), solid=0.0024, roll=0.001)
    return p


# ---------------------------------------------------------------- the ashforged mage: a smith-priest's habit

def ash_cloth():
    """The ashforged mage's cloth: a charcoal wool, its hems and seams stitched; a lighter wool for its patches; a
    darker one for the hood."""
    return (mat('ash_habit', 0x3a3531, 'cloth', engrave='stitch', rough=0.95),
            mat('ash_patch', 0x413a34, 'cloth', engrave='stitch', rough=0.95),
            mat('ash_hood', 0x24211f, 'cloth', engrave='stitch', rough=0.95))


def ashforged_robe():
    """The ashforged mage, a smith-priest: a habit of charcoal wool to the knee, slit at the sides, its hem worn ragged
    and patched, every hem stitched; sleeves rolled up to mid-forearm; a capelet of dark mail over the shoulders and
    the upper chest, bound in leather; the hood down, lying in folds on the back; a leather belt with an iron buckle
    and two pouches; a leather baldric across the chest, studded with iron, a ring at the breast."""
    p = Piece('robe')
    p.budget, p.tex, p.min_ratio = 12000, 2048, 0.03
    wool, patch, hood = ash_cloth()
    steel, mail, leather, _ = ash_mats()
    F = forms()
    torso, arm, fore = F['torso'], F['arm'], F['forearm']
    gw = gown_form()
    cloth = dict(solid=0.0024, roll=0.0011)
    RU, hem = 0.17, 0.5
    sk = dict(hem=hem, wide=0.075, back=0.025, folds=10, fold=0.008, flat=0.0)
    skin = gown_skin(hem=0.3)
    # the habit: the skirt slit at the sides, worn ragged, patched; the body
    p.add(wool, *robe_skirt(gw, slits=((math.pi / 2, 0.8, 0.003, 0.024), (-math.pi / 2, 0.8, 0.003, 0.024)), edge=hem_edge('ragged', 0.03, 1.3),
                            lobes=34, **sk), deco=0.01, skin=skin, **cloth)
    for ac, y0, y1, w in ((0.55, 0.6, 0.68, 0.032), (2.55, 0.72, 0.8, 0.028), (-2.2, 0.56, 0.62, 0.024)):
        u0 = ac * RU
        p.add(patch, *plate(lambda u, v: skirt_at(gw, u / RU, v, off=0.0028, **sk), lambda u, v, u0=u0, y0=y0, y1=y1, w=w: sd_box(u, v, u0, (y0 + y1) / 2, w, (y1 - y0) / 2, 0.002),
                            u0 - w - 0.004, u0 + w + 0.004, y0 - 0.004, y1 + 0.004, h=0.003), deco=0.006, skin=skin, solid=0.0016)
    p.add(wool, *ring_plate(torso, RU, 0.975, 1.505, 0.004), deco=0.008, skin=TORSO, **cloth)
    # the sleeves, rolled up to mid-forearm
    both(p, wool, ring_plate(arm, 0.08, -0.07, 0.262, 0.005), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), deco=0.008, **cloth)
    both(p, wool, ring_plate(fore, 0.07, -0.05, 0.12, 0.008), ('upperarm_l', 'lowerarm_l'), deco=0.008, **cloth)
    both(p, wool, ring_plate(fore, 0.07, 0.092, 0.138, lambda u, v: 0.013 + 0.005 * math.sin(math.pi * clamp((v - 0.092) / 0.046))), ('lowerarm_l',),
         deco=0.006, solid=0.005, roll=0.0016, bump=lambda q: 0.0012 * math.sin(q.y * 400 + q.z * 300))
    # the capelet of mail, bound in leather
    bind = dict(solid=0.002, roll=0.0018, roll_mat=leather)
    p.add(mail, *ring_plate(torso, RU, 1.33, 1.508, lambda u, v: 0.0085 + 0.004 * smooth(1.42, 1.33, v)), skin=TORSO, **bind)
    both(p, mail, band_plate(arm, 0.09, -2.45, 2.45, -0.085, 0.105, lambda u, v: 0.013 + 0.004 * smooth(-0.02, -0.08, v), 0.02),
         ('clavicle_l', 'upperarm_l'), **bind)
    # the hood, down: rolled round the back of the neck, its fabric lying in folds down the back
    cowl = Cone(-0.06, 1.44, 0.14, 0.135, 1.6, 0.112, 0.118)
    roll_h = lambda a: 1.565 + 0.035 * clamp((abs(wrap(a)) - 1.15) / (math.pi - 1.15))
    p.add(hood, *plate(lambda u, v: cowl.point(u / 0.1, v, 0.004 + 0.012 * math.sin(math.pi * clamp((v - 1.445) / (roll_h(u / 0.1) - 1.445))) ** 0.7),
                       lambda u, v: max(1.448 - v, v - roll_h(u / 0.1), 1.15 - abs(wrap(u / 0.1))), -math.pi * 0.1, math.pi * 0.1, 1.444, 1.604,
                       h=0.003, periodic=True), deco=0.007, skin=('neck_01', 'spine_03'), solid=0.004, roll=0.0016, sharp=60)
    bag = outline([(-0.125, 1.475), (0.125, 1.475), (0.115, 1.39), (0.075, 1.315), (0.0, 1.27), (-0.075, 1.315), (-0.115, 1.39)], 6)
    fold = lambda u, v: 0.004 * math.sin(u * 70) * smooth(1.46, 1.33, v)
    p.add(hood, *plate(lambda u, v: torso.point(math.pi + u / RU, v, 0.015 + 0.02 * math.sin(math.pi * clamp((1.48 - v) / 0.21)) * math.cos(u / 0.13 * math.pi / 2) + fold(u, v)),
                       lambda u, v: sd_poly(u, v, bag), -0.13, 0.13, 1.265, 1.48, h=0.003), deco=0.008, skin=TORSO, solid=0.003, roll=0.0016, sharp=60)
    # the belt, its buckle and two pouches
    hip = ('pelvis', 'spine_01')
    p.add(leather, *strap(gw, [(2 * math.pi * k / 96, 1.0) for k in range(97)], 0.04, 0.0035, 0.0105), skin=hip, forge=creased(0.0005))
    at, n = gw.point(0.0, 1.0, 0.014), gw.normal(0.0, 1.0)
    p.add(steel, *buckle(at, n, (1, 0, 0), 0.034, 0.032, 0.0022), skin=hip)
    for s_ in (1, -1):
        ac = s_ * 1.4
        c, n = skirt_at(gw, ac, 0.915, off=0.022, **sk), gw.normal(ac, 0.915)
        t_, n_, b_ = frame(n)
        p.add(leather, *merge(oball(c, (0.032, 0.02, 0.036), (t_, n_, b_), 14, 8),
                              oball(c + n * 0.006 + UP * 0.022, (0.034, 0.012, 0.016), (t_, n_, b_), 12, 6)), skin=skin, forge=creased(0.0006))
        p.add(steel, *rivet(c + n * 0.019 + UP * 0.016, n, 0.004), skin=skin)
    # the baldric over the left shoulder, front and back, studded; a ring at the breast
    path_f = line(0.62, 1.495, -0.95, 1.02, 48)
    path_b = line(math.pi - 0.62, 1.495, math.pi + 0.95, 1.02, 48)
    boff = lambda a, t: 0.0075 + 0.0095 * smooth(1.3, 1.36, t)  # on the wool, then over the mail
    for path in (path_f, path_b):
        p.add(leather, *form_strap(torso, path, 0.038, boff), skin=TORSO, forge=creased(0.0005))
    for k in range(5, 44, 6):
        a, t = path_f[k]
        p.add(steel, *rivet(torso.point(a, t, boff(a, t) + 0.0032), torso.normal(a, t), 0.0042), skin=TORSO)
    a, t = path_f[16]
    c, n = torso.point(a, t, boff(a, t) + 0.0045), torso.normal(a, t)
    t_, n_, b_ = frame(n)
    p.add(steel, *tube([c + (t_ * math.cos(2 * math.pi * k / 24) + b_ * math.sin(2 * math.pi * k / 24)) * 0.016 for k in range(24)], 0.0028, 8, closed=True),
          skin=TORSO)
    return p


def ashforged_circlet():
    """A band of fire-blackened iron round the brow and the temples, riveted all along, forged nails rising from its
    front like a crown - the tallest in the middle - a riveted plate at the brow under them, each end turned out into a
    riveted tab."""
    p = Piece('circlet')
    p.budget = 4000
    steel, mail, leather, _ = ash_mats()
    hw = 0.009
    band, y_of, A = diadem(p, steel, hw=hw, rope=False, deco=None, lean=0.15)
    RU = band.RU
    for k in range(-6, 7):
        a = k * 0.26
        p.add(steel, *rivet(band.point(a, 0.0, 0.0012), band.normal(a, 0.0), 0.0032))
    brow = outline([(-0.022, -hw + 0.001), (0.022, -hw + 0.001), (0.024, hw + 0.008), (0.012, hw + 0.016), (-0.012, hw + 0.016), (-0.024, hw + 0.008)], 4)
    p.add(steel, *plate(lambda u, v: band.point(u / RU, v, 0.0026), lambda u, v: sd_poly(u, v, brow), -0.03, 0.03, -hw - 0.002, hw + 0.02, h=0.0012),
          solid=0.0028, roll=0.0009, sharp=30, bump=lambda q: 0.0015 * gauss(q.x, 0.012))
    for x in (-0.016, 0.016):
        for y in (-hw + 0.005, hw + 0.006):
            p.add(steel, *rivet(band.point(x / RU, y, 0.0055), band.normal(x / RU, y), 0.0028))
    for k in range(-4, 5):
        a = k * 0.2
        base, n = band.point(a, hw * 0.6, 0.0015), band.normal(a, hw * 0.6)
        up = (UP * 0.85 + n * 0.25).normalized()
        length = 0.034 - 0.0045 * abs(k) - (0.004 if k % 2 else 0.0)
        p.add(steel, *tube([base - up * 0.006, base + up * length * 0.85, base + up * length], [0.0034, 0.0022, 0.0004], 6, fixed=True))
        p.add(steel, *oball(base + up * 0.002, (0.0042, 0.0028, 0.0042), frame(up), 8, 5))
    for s_ in (1, -1):
        end = s_ * A
        tab_c = (end * RU + s_ * 0.004, 0.0)
        p.add(steel, *plate(lambda u, v: band.point(u / RU, v, 0.0012), lambda u, v, c=tab_c: sd_ellipse(u, v, c[0], c[1], 0.011, hw + 0.002),
                            tab_c[0] - 0.014, tab_c[0] + 0.014, -hw - 0.005, hw + 0.005, h=0.0012), solid=0.0024, roll=0.0008)
        p.add(steel, *rivet(band.point(tab_c[0] / RU, 0.0, 0.0038), band.normal(tab_c[0] / RU, 0.0), 0.003))
    return p


def ashforged_mage_gloves():
    """Fingerless gloves of old leather, the fingers bare from the middle joint, iron studs over the knuckles; leather
    bracers laced over the forearms to the wrist, three straps with iron buckles round each."""
    p = Piece('gloves')
    p.budget = 5000
    steel, mail, leather, _ = ash_mats()
    glove = mat('ash_glove', 0x3b2a20, 'leather', engrave='stitch', rough=0.8)
    hand, fore = forms()['hand'], forms()['forearm']
    hx = bone('hand_l')
    tips = tuple(f'{f}_04_leaf_l' for f in ('index', 'middle', 'ring', 'pinky', 'thumb'))
    ends = tuple(f'{f}_03_l' for f in ('index', 'middle', 'ring', 'pinky', 'thumb')) + tips
    worn = tuple(b for b in ('hand_l',) + FINGERS_L + THUMB_L if b not in ends)
    both(p, glove, skin_patch(worn + ('lowerarm_l',), keep=lambda v: v.x > hx.x - 0.04), worn + ('lowerarm_l',) + ends, whole=True, deco=0.004,
         wound=True)
    for k in range(4):
        z = hx.z + lerp(-0.028, 0.03, k / 3)
        top = max((v for v, b in zip(body()['V'], body()['bone_of']) if b == 'hand_l' and abs(v.x - hx.x - 0.088) < 0.012 and abs(v.z - z) < 0.008),
                  key=lambda v: v.y, default=None)
        if top is not None:
            both(p, steel, rivet(top + UP * 0.0028, UP, 0.0038), ('hand_l',))
    RU = 0.07
    both(p, leather, ring_plate(fore, RU, 0.085, 0.238, lambda u, v: 0.0045 + 0.004 * smooth(0.2, 0.238, v)), ('lowerarm_l', 'hand_l'), deco=0.006,
         solid=0.003, roll=0.0012, forge=creased(0.0005))
    for t in (0.115, 0.165, 0.212):
        both(p, glove, ring_plate(fore, RU, t - 0.008, t + 0.008, 0.009), ('lowerarm_l',), solid=0.0018, roll=0.0008)
        a = -math.pi / 2 - 0.4  # the buckles on the outside of the arm
        both(p, steel, buckle(fore.point(a, t, 0.0115), fore.normal(a, t), (0, 0, 1), 0.014, 0.016, 0.0013), ('lowerarm_l',))
    return p


def ashforged_shoes():
    """Worn boots of dark leather to the knee, under the habit's hem, the top turned down; two straps round the shaft
    with iron buckles; an iron cap on the toe, riveted; a thick sole."""
    p = Piece('feet')
    p.budget = 5000
    steel, mail, leather, _ = ash_mats()
    boot = mat('ash_boot', 0x2e1f17, 'leather', engrave='stitch', rough=0.8)
    sole = mat('sole', 0x17130f, 'leather', rough=0.85)
    edge = dict(solid=0.0026, roll=0.0012)
    calf, foot = soft_boots(p, boot, sole, top=0.06, deco=0.006, edge=edge)
    both(p, boot, ring_plate(calf, 0.06, 0.05, 0.115, lambda u, v: 0.007 + 0.004 * smooth(0.115, 0.05, v)), ('thigh_l', 'calf_l'), deco=0.006,
         solid=0.003, roll=0.0014, forge=creased(0.0008))
    for t in (0.25, 0.37):
        both(p, leather, ring_plate(calf, 0.06, t - 0.009, t + 0.009, 0.0062), ('calf_l', 'foot_l'), solid=0.002, roll=0.0009)
        a = -math.pi / 2
        both(p, steel, buckle(calf.point(a, t, 0.0085), calf.normal(a, t), (0, 0, 1), 0.016, 0.018, 0.0014), ('calf_l', 'foot_l'))
    both(p, steel, band_plate(foot, 0.045, -1.5, 1.5, 0.17, 0.25, 0.0062, 0.01), ('ball_l',), solid=0.0026, roll=0.001)
    for a in (-0.9, 0.0, 0.9):
        both(p, steel, rivet(foot.point(a, 0.185, 0.0092), foot.normal(a, 0.185), 0.0028), ('ball_l',))
    return p


# ---------------------------------------------------------------- the dragon mage: a coat of red silk and scales

def dragon_cloth():
    """The dragon mage's cloth: a blood-red silk embroidered in its panels with dark scales, bordered near black; for
    the panels a silk worked all over with near-black scales, red showing between them (a scale is bright over all its
    crown, so the dark goes on the crowns), bordered in steel; a red stone."""
    return (mat('dragon_silk', 0x6a1014, 'cloth', engrave='scales', engrave_color=0x2a0709, emboss=True, rough=0.55, trim=0x1c1416, sheen=0x8e1f1c,
                gloss=0.35, scale=0.06, panels=True),
            mat('dragon_panel', 0x8a2420, 'cloth', engrave='scales', engrave_color=0x1a0a0c, emboss=True, rough=0.5, trim=0x80868f, sheen=0x9c2a22,
                gloss=0.4, scale=0.075, panels=True),
            mat('dragon_stone', 0x8c0f12, 'enamel', rough=0.05, metal=0.3, sheen=0xd23a2a, gloss=0.95))


def dragon_robe():
    """The dragon mage: a long coat of blood-red silk, open in front from the belt down over an apron of near-black
    silk worked with scales in red gold, drawn to a point; behind, the coat falls lower, to the ankle, split into two
    tails; its hem cut into points all round, a band of dark scales embroidered above it; a plastron of the scaled
    black silk over the chest; a mantle of red-lacquered scales over the shoulders in two rows, two more rows over
    each shoulder; close sleeves ending in a point over the back of the hand, their cuffs embroidered with scales; a
    belt of red scales, its buckle a red stone gripped in three steel talons."""
    p = Piece('robe')
    p.budget, p.tex, p.min_ratio = 12000, 2048, 0.03
    silk, panel, stone = dragon_cloth()
    steel, scale, rim = dragon_mats()
    F = forms()
    torso, arm, fore = F['torso'], F['arm'], F['forearm']
    gw = gown_form()
    cloth = dict(solid=0.0022, roll=0.0012, roll_mat=rim)
    lames = dict(solid=0.0026, roll=0.0012, roll_mat=rim)
    RU = 0.17
    hem = lambda a: 0.37 - 0.15 * ((1 - math.cos(a)) / 2) ** 1.4  # short in front, to the ankle behind
    sk = dict(hem=hem, wide=0.09, back=0.05, folds=12, fold=0.006, flat=0.35)
    skin = gown_skin(hem=0.3)
    band = lambda q: (lambda h: smooth(h + 0.12, h + 0.09, q.y))(hem(math.atan2(q.x, q.z)))
    # the coat: open in front from the belt, split behind into two tails, its hem in points
    p.add(silk, *robe_skirt(gw, slits=((0.0, 1.0, 0.03, 0.125), (math.pi, 0.6, 0.002, 0.008)), edge=hem_edge('point', 0.034), lobes=26, **sk),
          deco=ornate(0.011, band), skin=skin, **cloth)
    # the apron under its opening, worked with scales, to a point
    apron = outline([(-0.078, 1.02), (0.078, 1.02), (0.078, 0.5), (0.0, 0.415), (-0.078, 0.5)], 4)
    p.add(panel, *plate(lambda u, v: skirt_at(gw, u / RU, v, off=-0.0045, **sk), lambda u, v: sd_poly(u, v, apron), -0.085, 0.085, 0.41, 1.025,
                        h=0.0032), deco=ornate(0.009), skin=skin, sharp=35, **cloth)
    # the body, and the plastron of scaled silk over the chest
    p.add(silk, *ring_plate(torso, RU, 0.975, 1.505, 0.004), deco=PLAIN, skin=TORSO, **cloth)
    plast = outline(symmetric([(0.0, 1.47), (0.06, 1.47), (0.115, 1.43), (0.135, 1.33), (0.115, 1.2), (0.06, 1.1), (0.0, 1.06)]), 6)
    p.add(panel, *plate(lambda u, v: torso.point(u / RU, v, 0.0088), lambda u, v: sd_poly(u, v, plast), -0.14, 0.14, 1.05, 1.475), deco=ornate(0.009),
          skin=TORSO, sharp=30, **cloth)
    # the mantle of scales round the shoulders, two rows all round; two more rows over each shoulder
    for t0, off, pts, ph in ((1.37, 0.0105, 18, 0.0), (1.425, 0.0145, 16, 0.5)):
        p.add(scale, *plate(lambda u, v, t0=t0, off=off: torso.point(u / RU, v, off + 0.003 * smooth(t0 + 0.04, t0, v)),
                            lambda u, v, t0=t0, pts=pts, ph=ph: ring_teeth_sd(u, v, RU, t0, 1.508, pts, 0.032, 'low', 'point', ph),
                            -math.pi * RU, math.pi * RU, t0 - 0.004, 1.512, periodic=True), deco=lambda q, d: smooth(0.005, 0.008, d), skin=TORSO,
              sharp=30, **lames)
    for k, (t0, t1) in enumerate(((-0.085, 0.1), (0.035, 0.165))):
        both(p, scale, teeth_plate(arm, 0.09, -2.25, 2.25, t0, t1, lambda u, v, k=k, t0=t0, t1=t1: 0.019 - 0.003 * k + 0.006 * smooth(t0, t1, v), 4,
                                   0.034, 'high'), ('clavicle_l', 'upperarm_l') if k == 0 else ('upperarm_l',), deco=lambda q, d: smooth(0.005, 0.008, d),
             sharp=30, **lames)
    # the sleeves: close, ending in a point over the back of the hand, their cuffs embroidered with scales
    both(p, silk, ring_plate(arm, 0.08, -0.07, 0.262, 0.005), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), deco=PLAIN, **cloth)
    cuff = lambda q: smooth(0.15, 0.17, q.x - bone('lowerarm_l').x)
    both(p, silk, sleeve(fore, 0.07, -0.05, 0.236, 0.008, 0.01, folds=6, fold=0.002, end=lambda a: 0.075 * max(0.0, math.cos(a)) ** 5),
         ('upperarm_l', 'lowerarm_l', 'hand_l'), deco=ornate(0.009, cuff), **cloth)
    # the belt of red scales; its buckle, a red stone gripped in three talons
    hip = ('pelvis', 'spine_01')
    p.add(scale, *plate(lambda u, v: gw.point(u / 0.16, v, 0.0125), lambda u, v: max(0.97 - v, v - 1.034), -math.pi * 0.16, math.pi * 0.16, 0.966,
                        1.038, periodic=True), deco=lambda q, d: smooth(0.004, 0.007, d), skin=hip, **lames)
    c, n = gw.point(0.0, 1.002, 0.03), gw.normal(0.0, 1.002)
    t_, n_, b_ = frame(n)
    p.add(steel, *oball(c - n * 0.008, (0.019, 0.006, 0.019), (t_, n_, b_), 14, 6), skin=hip)
    p.add(stone, *oball(c, (0.0125, 0.0105, 0.0125), (t_, n_, b_), 14, 8), skin=hip)
    for k in range(3):
        ang = math.pi / 2 + 2 * math.pi * k / 3
        side = t_ * math.cos(ang) + b_ * math.sin(ang)
        p.add(steel, *talon(c - n * 0.006 + side * 0.022, -side + n * 0.9, -side, 0.024, 0.0042), skin=hip)
    return p


def dragon_circlet():
    """A diadem of dark steel worked with scales, edged in polished steel: a spike rising over the brow, under it a
    red stone like a dragon's eye; two horns at each temple sweeping back over the head, the front pair longer; each
    end drawn back to a point."""
    p = Piece('circlet')
    p.budget = 4000
    steel, scale, rim = dragon_mats()
    stone = dragon_cloth()[2]
    hw = 0.0075
    band, y_of, A = diadem(p, steel, hw=hw, rope=False, roll_mat=rim, deco=lambda q, d: smooth(0.0025, 0.004, d))
    RU = band.RU
    spike_o = outline([(-0.017, hw - 0.002), (0.017, hw - 0.002), (0.009, hw + 0.014), (0.0025, hw + 0.036), (0.0, hw + 0.042), (-0.0025, hw + 0.036),
                       (-0.009, hw + 0.014)], 4)
    p.add(steel, *plate(lambda u, v: band.point(u / RU, v, 0.0016 + 0.002 * gauss(u, 0.006)), lambda u, v: sd_poly(u, v, spike_o), -0.02, 0.02, hw - 0.004,
                        hw + 0.046, h=0.0009), solid=0.0022, roll=0.0008, roll_mat=rim, sharp=25, deco=lambda q, d: smooth(0.002, 0.003, d))
    at, n = band.point(0.0, 0.0, 0.0035), band.normal(0.0, 0.0)
    t_, n_, b_ = frame(n)
    p.add(rim, *oball(at - n * 0.001, (0.0115, 0.0018, 0.0078), (t_, n_, b_), 14, 5))
    p.add(stone, *oball(at + n * 0.0012, (0.0092, 0.0042, 0.006), (t_, n_, b_), 14, 7))
    for s_ in (1, -1):
        for a, length, r, lift in ((0.82, 0.075, 0.0062, 0.55), (1.28, 0.058, 0.0052, 0.38)):
            a *= s_
            root, n = band.point(a, hw * 0.5, 0.0), band.normal(a, hw * 0.5)
            radial = Vector((n.x, 0.0, n.z)).normalized()
            back = Vector((0, 0, -1))
            p.add(steel, *spike(root, radial * 0.35 + UP * lift + back * 0.75, length, r, back * 0.8 + UP * 0.2))
            p.add(rim, *oball(root + radial * 0.002, (0.0075, 0.004, 0.0075), frame(radial), 10, 5))
        end = s_ * A
        tang = (band.at(end + s_ * 1e-3, 0.0) - band.at(end, 0.0)).normalized()
        p.add(steel, *spike(band.point(end, 0.0, 0.0), tang, 0.022, hw * 0.9, -UP * 0.1))
    return p


def dragon_mage_gloves():
    """Gloves of dark red leather fitted finger by finger, the back of each hand worked with scales, a steel talon over
    each finger's tip, and a cuff of red-lacquered scales pointing back up the forearm."""
    p = Piece('gloves')
    p.budget = 5000
    steel, scale, rim = dragon_mats()
    hide = mat('dragon_hide', 0x3a0d10, 'leather', engrave='scales', engrave_color=0x9c2a22, emboss=True, rough=0.45, trim=0x80868f, gloss=0.4,
               scale=0.03, panels=True)
    hand = forms()['hand']
    fine_gloves(p, hide, deco=ornate(0.004, back_of_hand()))
    for f in ('index', 'middle', 'ring', 'pinky', 'thumb'):
        b3, b4 = bone(f'{f}_03_l'), bone(f'{f}_04_leaf_l')
        d = (b4 - b3).normalized()
        up = (UP - d * UP.dot(d)).normalized() if f != 'thumb' else (Vector((0, 0.3, 1)) - d * Vector((0, 0.3, 1)).dot(d)).normalized()
        root = b3.lerp(b4, 0.35) + up * 0.0075
        both(p, steel, talon(root, d + up * 0.15, -up, 0.022 if f != 'pinky' else 0.017, 0.0034), (f'{f}_03_l',))
    RU = 0.06
    both(p, scale, plate(lambda u, v: hand.point(u / RU, v, 0.0035 + 0.018 * smooth(-0.005, -0.08, v)),
                         lambda u, v: ring_teeth_sd(u, v, RU, -0.082, 0.006, 6, 0.022, 'low', 'point'), -math.pi * RU, math.pi * RU, -0.086, 0.01,
                         h=0.0025, periodic=True), ('hand_l', 'lowerarm_l'), deco=lambda q, d: smooth(0.004, 0.006, d), solid=0.0024, roll=0.0011,
         roll_mat=rim)
    return p


def dragon_shoes():
    """Boots of dark red leather to mid-calf: a cuff of red-lacquered scales pointing down at the top, scales over the
    instep, a steel talon curling down over the toe, a short steel spur at the heel; a sole."""
    p = Piece('feet')
    p.budget = 5000
    steel, scale, rim = dragon_mats()
    hide = mat('dragon_boot', 0x2a0c0e, 'leather', engrave='scales', engrave_color=0x8a2420, emboss=True, rough=0.5, trim=0x80868f, gloss=0.35,
               scale=0.04, panels=True)
    sole = mat('sole', 0x17130f, 'leather', rough=0.85)
    edge = dict(solid=0.0024, roll=0.0011, roll_mat=rim)
    calf, foot = soft_boots(p, hide, sole, edge=edge)
    RU = 0.06
    both(p, scale, plate(lambda u, v: calf.point(u / RU, v, 0.0068 + 0.004 * smooth(0.27, 0.19, v)),
                         lambda u, v: ring_teeth_sd(u, v, RU, 0.19, 0.27, 8, 0.03, 'high', 'point'), -math.pi * RU, math.pi * RU, 0.186, 0.274,
                         h=0.0028, periodic=True), ('calf_l',), deco=lambda q, d: smooth(0.004, 0.006, d), **edge)
    for k, (t0, t1) in enumerate(((0.02, 0.09), (0.07, 0.14), (0.12, 0.2))):
        both(p, scale, teeth_plate(foot, 0.045, -1.35, 1.35, t0, t1, 0.0075 + 0.0012 * k, 3, 0.02, 'high'), ('foot_l',) if k < 2 else ('foot_l', 'ball_l'),
             deco=lambda q, d: smooth(0.004, 0.006, d), sharp=30, **edge)
    tip, n = foot.point(0.0, 0.215, 0.006), foot.normal(0.0, 0.215)
    fwd = (foot.at(0.0, 0.24) - foot.at(0.0, 0.2)).normalized()
    both(p, steel, talon(tip, fwd + n * 0.4, -n, 0.035, 0.007), ('ball_l',))
    heel, hn = foot.point(math.pi * 0.6, -0.07, 0.004), foot.normal(math.pi * 0.6, -0.07)
    both(p, steel, spike(heel, -fwd * 0.8 + hn * 0.4, 0.022, 0.0045, Vector((0, 0.3, 0))), ('foot_l',))
    return p


# ---------------------------------------------------------------- the glacial mage: a long white robe under a fur-trimmed tunic

def glacial_cloth():
    """The glacial mage's cloth: a white wool-silk embroidered with pale blue frost, bordered in silver; an ice-blue
    one embroidered with white frost, rimed a little, for the tunic."""
    rim = 0xc6d6e3
    return (mat('glacial_white', 0xe2e9ee, 'cloth', engrave='frost', engrave_color=0x6f98c0, emboss=True, rough=0.7, trim=rim, sheen=0xcfe0ee,
                gloss=0.25, panels=True),
            mat('glacial_blue', 0x5f87aa, 'cloth', engrave='frost', engrave_color=0xe6eef5, emboss=True, rough=0.7, trim=rim, sheen=0x7fa6c8,
                gloss=0.25, panels=True, frost=0.15))


def glacial_robe():
    """The glacial mage, in two layers: a long robe of white to the lower shin, embroidered with frost above its hem,
    slit a little behind; over it a tunic of ice blue to mid-thigh, slit at the sides, its hem trimmed with
    white fur falling in locks; white fur gathered round the neck, thick on the left, and a pelt thrown over the left
    shoulder as on the armour; wide sleeves embroidered with frost at the cuff, trimmed with fur; a white sash, its
    clasp a cluster of ice crystals set in silver, two icicles hanging from it."""
    p = Piece('robe')
    p.budget, p.tex, p.min_ratio = 13000, 2048, 0.03
    white, blue = glacial_cloth()
    steel, deep, rim, fur, ice, _ = glacial_mats()
    F = forms()
    torso, arm, fore = F['torso'], F['arm'], F['forearm']
    gw = gown_form()
    cloth = dict(solid=0.0022, roll=0.0012, roll_mat=rim)
    RU = 0.17
    skin = gown_skin(hem=0.22)
    fine = 0.004 if RES <= 1 else 0.0075  # the fur's grid: kept whole, so coarse in the game's copy
    # the long white robe, seen below the tunic and through its slits
    under = dict(hem=0.21, wide=0.085, back=0.035, folds=16, fold=0.005, flat=0.0)
    p.add(white, *robe_skirt(gw, top=0.97, slits=((math.pi, 0.48, 0.0015, 0.006),), **under),
          deco=ornate(0.011, lambda q: smooth(0.21 + 0.14, 0.21 + 0.11, q.y)), skin=skin, **cloth)
    # the tunic: its body, embroidered down the front; its skirt to mid-thigh, slit at the sides
    tunic = dict(hem=0.62, wide=0.068, back=0.022, off=0.012, folds=12, fold=0.004, flat=0.0)
    p.add(blue, *ring_plate(torso, RU, 0.975, 1.505, 0.0042), deco=ornate(0.01, lambda q: smooth(0.034, 0.026, abs(q.x)) if q.z > 0 else 0.0),
          skin=TORSO, **cloth)
    slits = ((math.pi / 2, 0.86, 0.003, 0.022), (-math.pi / 2, 0.86, 0.003, 0.022))
    p.add(blue, *robe_skirt(gw, slits=slits, **tunic), deco=ornate(0.011, lambda q: smooth(0.62 + 0.12, 0.62 + 0.09, q.y)), skin=skin, **cloth)
    # the fur along the tunic's hem, falling in locks, parted at the slits
    def fur_hem(u, v):
        a = u / RU
        s = pelt_sd(u, v, -math.pi * RU, math.pi * RU, 0.6, 0.668, 44, 0.026, 4.0, 'low')
        for ac, _, w0, w1 in slits:
            s = max(s, w1 - abs(wrap(a - ac)) * RU)
        return s
    p.add(fur, *plate(lambda u, v: skirt_at(gw, u / RU, v, **dict(tunic, off=0.012 + 0.0075)), fur_hem, -math.pi * RU, math.pi * RU, 0.594, 0.672,
                      h=fine, periodic=True), solid=0.006, bump=furry(0.0028, 5.0), forge=False, sharp=80, skin=skin, whole=True)
    # the fur round the neck, thick on the left, and the pelt over the left shoulder (as on the armour)
    collar = Cone(-0.035, 1.45, 0.128, 0.118, 1.57, 0.08, 0.08)

    def collar_pt(a, t, off):
        q = collar.at(a, t)
        need = torso.radius(math.atan2(q.x, q.z), min(t, 1.56)) + 0.012 * smooth(1.575, 1.53, t)
        r = math.hypot(q.x, q.z)
        if r < need:
            q = Vector((q.x * need / r, q.y, q.z * need / r))
        return q + collar.normal(a, t) * off
    left = lambda a: (0.5 + 0.5 * math.sin(a)) ** 1.5
    thick = lambda u, v: 0.006 + (0.004 + 0.018 * left(u / 0.1)) * math.sin(math.pi * clamp((v - 1.40) / 0.155)) ** 0.6
    fur_skin = ('neck_01', 'spine_03', 'clavicle_l', 'clavicle_r')
    p.add(fur, *plate(lambda u, v: collar_pt(u / 0.1, v, thick(u, v)),
                      lambda u, v: max(v - 1.555, pelt_sd(u, v, -math.pi * 0.1, math.pi * 0.1, 1.4 + 0.08 * (1 - left(u / 0.1)), 1.6, 18, 0.03, 0.7, 'low')),
                      -math.pi * 0.1, math.pi * 0.1, 1.38, 1.56, h=fine, periodic=True), solid=0.006, bump=furry(0.003, 1.0), forge=False, sharp=80,
          skin=fur_skin, whole=True)
    pelt = lambda u, v: pelt_sd(u, v, -2.35 * 0.09, 2.35 * 0.09, -0.085, 0.13, 9, 0.045, 2.0, 'high')
    poff = lambda u, v: 0.02 + 0.01 * smooth(0.06, -0.07, v)
    p.add(fur, *plate(lambda u, v: arm.point(u / 0.09, v, poff(u, v)), pelt, -2.4 * 0.09, 2.4 * 0.09, -0.09, 0.135, h=fine),
          solid=0.008, bump=furry(0.0035, 3.0), forge=False, sharp=80, skin=('clavicle_l', 'upperarm_l', 'spine_03'), whole=True)
    locks = []
    for k in range(11):
        a = lerp(-2.1, 2.1, (k + 0.5) / 11) + 0.12 * noise.noise(Vector((k * 1.3, 0.4, 0.0)))
        t = 0.09 + 0.02 * noise.noise(Vector((k * 2.1, 1.3, 0.0)))
        locks.append(lock(arm.point(a, t, poff(a * 0.09, t) - 0.004), (1.0, -0.15, 0.0), arm.normal(a, t), 0.045 + 0.02 * noise.noise(Vector((k, 3.0, 0.0))),
                          0.009, k * 1.7))
    p.add(fur, *merge(*locks), skin=('upperarm_l', 'clavicle_l'))
    # the sleeves: close over the upper arm, wide from the elbow, frost at the cuff, fur at the end
    both(p, blue, ring_plate(arm, 0.08, -0.07, 0.262, 0.005), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), deco=PLAIN, **cloth)
    cuff = lambda q: smooth(0.14, 0.16, q.x - bone('lowerarm_l').x)
    both(p, blue, sleeve(fore, 0.07, -0.05, 0.235, 0.009, 0.042), ('upperarm_l', 'lowerarm_l'), deco=ornate(0.01, cuff), **cloth)
    soff = lambda v: 0.009 + 0.042 * smooth(-0.05 + 0.285 * 0.3, 0.235, v) ** 1.5 + 0.008
    both(p, fur, plate(lambda u, v: fore.point(u / 0.07, v, soff(min(v, 0.235))), lambda u, v: pelt_sd(u, v, -math.pi * 0.07, math.pi * 0.07, 0.205, 0.262, 16, 0.018,
                                                                                                       6.0, 'high'),
                       -math.pi * 0.07, math.pi * 0.07, 0.2, 0.266, h=fine, periodic=True), ('lowerarm_l',), solid=0.006, bump=furry(0.0025, 7.0), forge=False,
         sharp=80, whole=True)
    # the sash and its clasp of ice, two icicles under it
    hip = ('pelvis', 'spine_01')
    p.add(white, *plate(lambda u, v: gw.point(u / 0.16, v, 0.0215), lambda u, v: max(0.962 - v, v - 1.042), -math.pi * 0.16, math.pi * 0.16, 0.958, 1.046,
                        periodic=True), deco=ornate(0.007), skin=hip, **cloth)
    c, n = gw.point(0.0, 1.002, 0.028), gw.normal(0.0, 1.002)
    t_, n_, b_ = frame(n)
    p.add(rim, *oball(c - n * 0.002, (0.022, 0.005, 0.017), (t_, n_, b_), 14, 6), skin=hip)
    crystals = [facet_crystal(c + t_ * dx + b_ * dz, (n * 0.6 + t_ * dx * 30 + b_ * dz * 30 + UP * 0.2), L, r)
                for dx, dz, L, r in ((0.0, 0.0, 0.03, 0.0062), (0.01, 0.004, 0.02, 0.0045), (-0.011, 0.003, 0.022, 0.0048), (0.004, -0.009, 0.016, 0.004))]
    p.add(ice, *merge(*crystals), skin=hip)
    p.add(ice, *merge(icicle(c + t_ * 0.007 - UP * 0.01, -UP, 0.05, 0.004, 1.0), icicle(c - t_ * 0.008 - UP * 0.009, -UP, 0.036, 0.0034, 2.0)), skin=skin)
    return p


def glacial_circlet():
    """A diadem of frosted steel etched with frost over the brow and the temples, edged in silver: a crown of ice
    crystals rising from it in front, the tallest over the brow, falling away towards the temples, a blue stone of ice
    at its foot; each end finished in a small crystal."""
    p = Piece('circlet')
    p.budget = 4000
    steel, deep, rim, fur, ice, _ = glacial_mats()
    hw = 0.0065
    band, y_of, A = diadem(p, steel, hw=hw, roll_mat=rim, deco=lambda q, d: smooth(0.002, 0.0035, d))
    RU = band.RU
    crystals = []
    for k in range(-7, 8):
        a = k * 0.12
        base, n = band.point(a, hw * 0.4, 0.0005), band.normal(a, hw * 0.4)
        length = (0.052 * math.exp(-(k / 2.6) ** 2) + 0.012) * (0.75 if k % 2 else 1.0)
        lean = Vector((math.sin(a), 0.0, math.cos(a))) * 0.18 + Vector((math.sin(a), 0, 0)) * 0.15
        crystals.append(facet_crystal(base, UP + lean, length, 0.0042 if k % 2 else 0.0052))
    p.add(ice, *merge(*crystals))
    p.add(rim, *plate(lambda u, v: band.point(u / RU, v, 0.0012), lambda u, v: max(abs(u) - 0.9, abs(v - hw * 0.55) - 0.0028), -0.1, 0.1, hw * 0.55 - 0.004,
                      hw * 0.55 + 0.004, h=0.0012), solid=0.002, roll=0.0006)
    at, n = band.point(0.0, -0.0005, 0.003), band.normal(0.0, 0.0)
    t_, n_, b_ = frame(n)
    p.add(rim, *oball(at - n * 0.0012, (0.0095, 0.0018, 0.0095), (t_, n_, b_), 14, 5))
    p.add(ice, *gem(at + n * 0.0008, n, 0.0072))
    for s_ in (1, -1):
        end = s_ * A
        tang = (band.at(end + s_ * 1e-3, 0.0) - band.at(end, 0.0)).normalized()
        p.add(ice, *facet_crystal(band.point(end, 0.0, 0.0), tang + UP * 0.3, 0.018, 0.0045))
    return p


def glacial_mage_gloves():
    """Gloves of white leather fitted finger by finger, embroidered with frost on the back of the hand under a small
    ice crystal set in silver; a cuff of white fur at the wrist."""
    p = Piece('gloves')
    p.budget = 5500
    steel, deep, rim, fur, ice, _ = glacial_mats()
    kid = mat('glacial_kid', 0xdfe7ec, 'leather', engrave='frost', engrave_color=0x6f98c0, emboss=True, rough=0.5, trim=0xc6d6e3, gloss=0.35,
              panels=True, frost=0.2)
    hand = forms()['hand']
    fine_gloves(p, kid, deco=ornate(0.004, back_of_hand()))
    RU = 0.06
    fine = 0.0035 if RES <= 1 else 0.0065
    both(p, fur, plate(lambda u, v: hand.point(u / RU, v, 0.006 + 0.012 * smooth(-0.01, -0.07, v)),
                       lambda u, v: pelt_sd(u, v, -math.pi * RU, math.pi * RU, -0.078, 0.004, 14, 0.016, 3.0, 'low'), -math.pi * RU, math.pi * RU,
                       -0.082, 0.008, h=fine, periodic=True), ('hand_l', 'lowerarm_l'), solid=0.005, bump=furry(0.0022, 2.0), forge=False, sharp=80,
         whole=True)
    at, n = hand.point(0.0, 0.042, 0.0008), hand.normal(0.0, 0.042)
    both(p, rim, rivet(at, n, 0.0055, washer=0.0085), ('hand_l',))
    both(p, ice, facet_crystal(at + n * 0.002, n + Vector((0.4, 0, 0)), 0.016, 0.0042), ('hand_l',))
    return p


def glacial_shoes():
    """Boots of white leather, rimed, to mid-calf, a cuff of white fur at the top, a silver cap on the toe, a small ice
    crystal set at the outer ankle; a sole."""
    p = Piece('feet')
    p.budget = 5500
    steel, deep, rim, fur, ice, _ = glacial_mats()
    boot = mat('glacial_boot', 0xc9d6e0, 'leather', engrave='frost', engrave_color=0x6f98c0, emboss=True, rough=0.55, trim=0xc6d6e3, gloss=0.3,
               panels=True, frost=0.3)
    sole = mat('sole', 0x17130f, 'leather', rough=0.85)
    edge = dict(solid=0.0024, roll=0.0011, roll_mat=rim)
    calf, foot = soft_boots(p, boot, sole, edge=edge)
    RU = 0.06
    fine = 0.0035 if RES <= 1 else 0.0065
    both(p, fur, plate(lambda u, v: calf.point(u / RU, v, 0.008 + 0.006 * math.sin(math.pi * clamp((v - 0.185) / 0.075))),
                       lambda u, v: pelt_sd(u, v, -math.pi * RU, math.pi * RU, 0.185, 0.262, 14, 0.02, 5.0, 'high'), -math.pi * RU, math.pi * RU,
                       0.18, 0.266, h=fine, periodic=True), ('calf_l',), solid=0.006, bump=furry(0.0025, 4.0), forge=False, sharp=80, whole=True)
    both(p, rim, band_plate(foot, 0.045, -1.3, 1.3, 0.2, 0.25, 0.0058, 0.008), ('ball_l',), solid=0.0024, roll=0.001)
    a = -math.pi / 2
    at, n = calf.point(a, 0.4, 0.0055), calf.normal(a, 0.4)
    both(p, rim, rivet(at, n, 0.006, washer=0.009), ('calf_l', 'foot_l'))
    both(p, ice, facet_crystal(at + n * 0.002, n + UP * 0.3, 0.014, 0.004), ('calf_l', 'foot_l'))
    return p


# ---------------------------------------------------------------- the emerald mage: an elven gown of leaves

def emerald_cloth():
    """The emerald mage's cloth: an emerald silk with a teal sheen, bordered in silver and embroidered in its panels
    with silver vines; a lighter, brighter green for the leaves."""
    trim = 0xb7bcc2
    return (mat('emerald_silk', 0x0b4f30, 'cloth', engrave='vines', engrave_color=0xc0c6cc, emboss=True, rough=0.5, trim=trim, sheen=0x0e5e3c,
                gloss=0.4, panels=True),
            mat('emerald_leaf', 0x17703f, 'cloth', engrave='vines', engrave_color=0xc8ced2, emboss=True, rough=0.5, trim=trim, sheen=0x1d8050,
                gloss=0.4, panels=True))


def leaf_sd(u, v, root, tip, width):
    """A leaf's outline from its root to its tip (u, v points), `width` across at its widest, as a signed distance."""
    mid = ((root[0] + tip[0]) / 2, (root[1] + tip[1]) / 2)
    q = (root[0] * 0.75 + tip[0] * 0.25, root[1] * 0.75 + tip[1] * 0.25)
    return ribbon_sd(u, v, [root, q, mid, tip], [width * 0.18, width * 0.45, width * 0.5, 0.0])


def emerald_robe():
    """The emerald mage, an elven gown: cut in one piece from under the bust and falling from there to the shin, slit
    high at the sides, its hem cut into leaves and embroidered with silver vines above them; a fitted bodice with a
    deep V at the neck, bordered in silver; a band of etched silver under the bust, a silver leaf brooch with an
    emerald at its middle; a cape of leaves over each shoulder, in two rows; angel sleeves, close to the elbow, then
    falling wide and open underneath, their ends cut into leaves; a girdle of silver leaves slung low over the hips,
    higher on the left, an emerald hanging from it."""
    p = Piece('robe')
    p.budget, p.tex, p.min_ratio = 12000, 2048, 0.03
    silk, leaf = emerald_cloth()
    scale, smooth_, silver, mail, glass = emerald_mats()
    F = forms()
    torso, arm, fore = F['torso'], F['arm'], F['forearm']
    dress = Dress()
    cloth = dict(solid=0.0022, roll=0.0012, roll_mat=silver)
    RU, hem, waist = 0.17, 0.26, 1.285
    bust = {}

    def drape(a, t):  # falling straight from under the bust over the belly, not drawn in to it
        k = round(a, 3)
        if k not in bust:
            bust[k] = [dress.radius(a, waist - 0.03 * i) for i in range(16)]
        if t >= waist:
            return 0.0
        i = min(15, int((waist - t) / 0.03))
        return max(0.0, max(bust[k][:i + 1]) - dress.radius(a, t)) * smooth(0.6, 0.95, t) + 0.006 * smooth(1.0, waist, t)
    sk = dict(hem=hem, wide=0.09, back=0.04, folds=16, fold=0.006, flat=0.0, drape=drape)
    skin = dress_skin(hem=hem)
    # the gown, slit high at the sides, its hem in leaves, vines above them
    p.add(silk, *robe_skirt(dress, top=waist, slits=((math.pi / 2, 0.74, 0.003, 0.032), (-math.pi / 2, 0.74, 0.003, 0.032)),
                            edge=hem_edge('leaf', 0.05), lobes=26, **sk), deco=ornate(0.011, lambda q: smooth(hem + 0.16, hem + 0.12, q.y)), skin=skin, **cloth)
    # the bodice, a deep V at the neck
    vtop = lambda u: 1.508 - 0.115 * max(0.0, 1 - abs(u) / 0.078)
    p.add(silk, *plate(lambda u, v: torso.point(u / RU, v, 0.004), lambda u, v: max(1.25 - v, v - vtop(u)), -math.pi * RU, math.pi * RU, 1.246, 1.512,
                       periodic=True), deco=ornate(0.009, lambda q: 0.0), skin=TORSO, **cloth)
    # the band under the bust and its brooch: an emerald among silver leaves
    p.add(silver, *plate(lambda u, v: torso.point(u / RU, v, 0.0125), lambda u, v: max(1.258 - v, v - 1.298), -math.pi * RU, math.pi * RU, 1.254, 1.302,
                         periodic=True), solid=0.0025, roll=0.0011, skin=TORSO)
    for k in range(4):
        ang = math.pi / 4 + math.pi / 2 * k
        tip = (0.026 * math.cos(ang), 1.278 + 0.022 * math.sin(ang))
        p.add(silver, *plate(lambda u, v: torso.point(u / RU, v, 0.0145), lambda u, v, tip=tip: leaf_sd(u, v, (0.0, 1.278), tip, 0.013),
                             -0.03, 0.03, 1.25, 1.306, h=0.0009), solid=0.0018, roll=0.0007, skin=TORSO, bump=lambda q: 0.0008)
    at, n = torso.point(0.0, 1.278, 0.0165), torso.normal(0.0, 1.278)
    p.add(silver, *rivet(at - n * 0.001, n, 0.009, washer=0.0), skin=TORSO)
    p.add(glass, *gem(at + n * 0.0025, n, 0.0075), skin=TORSO)
    # the cape of leaves over each shoulder, two rows, each leaf over the one before
    leaves = [(a, -0.075, 0.115, 0.054, 0.017 + 0.0016 * k) for k, a in enumerate((-1.9, -1.0, -0.1, 0.8, 1.7))]
    leaves += [(a, 0.0, 0.175, 0.048, 0.0145 + 0.0016 * k) for k, a in enumerate((-1.45, -0.55, 0.35, 1.25))]
    for a, t0, t1, w, off in leaves:
        u0 = a * 0.09
        both(p, leaf, plate(lambda u, v, off=off, t0=t0, t1=t1: arm.point(u / 0.09, v, off + 0.004 * smooth(t0, t1, v)),
                            lambda u, v, u0=u0, t0=t0, t1=t1, w=w: leaf_sd(u, v, (u0, t0), (u0, t1), w), u0 - w, u0 + w, t0 - 0.004, t1 + 0.004, h=0.003),
             ('clavicle_l', 'upperarm_l') if t0 < 0 else ('upperarm_l',), deco=ornate(0.005), sharp=35, **cloth)
    # the angel sleeves: close to the elbow, then wide, open underneath, their ends in leaves
    both(p, silk, ring_plate(arm, 0.08, -0.07, 0.262, 0.005), ('clavicle_l', 'upperarm_l', 'lowerarm_l'), deco=PLAIN, **cloth)
    cuff = lambda q: smooth(0.15, 0.17, q.x - bone('lowerarm_l').x)
    both(p, silk, sleeve(fore, 0.07, -0.05, 0.262, 0.009, 0.085, folds=6, fold=0.006, edge=hem_edge('leaf', 0.03), lobes=7, opening=(math.pi, 0.02, 0.075)),
         ('upperarm_l', 'lowerarm_l'), deco=ornate(0.01, cuff), **cloth)
    # the girdle of silver leaves slung over the hips, higher on the left, an emerald hanging in front
    gy = lambda a: 0.935 + 0.04 * math.sin(a)
    ring = [skirt_at(dress, 2 * math.pi * k / 120, gy(2 * math.pi * k / 120), off=0.0045, **sk) for k in range(120)]
    p.add(silver, *tube(ring, 0.0022, 6, closed=True), skin=skin)
    for k in range(18):
        a = 2 * math.pi * k / 18
        u0, y0 = a * RU, gy(a)
        p.add(silver, *plate(lambda u, v: skirt_at(dress, u / RU, v, off=0.006, **sk), lambda u, v, u0=u0, y0=y0: leaf_sd(u, v, (u0, y0), (u0 + 0.004, y0 - 0.026), 0.013),
                             u0 - 0.012, u0 + 0.014, y0 - 0.03, y0 + 0.004, h=0.0012), solid=0.0018, roll=0.0007, skin=skin)
    a0 = 0.25
    top_ = skirt_at(dress, a0, gy(a0) - 0.004, off=0.007, **sk)
    drop = skirt_at(dress, a0, gy(a0) - 0.07, off=0.009, **sk)
    p.add(silver, *tube([top_, top_.lerp(drop, 0.5), drop + Vector((0, 0.008, 0))], 0.0012, 6, fixed=True), skin=skin)
    p.add(glass, *oball(drop, (0.0065, 0.0095, 0.0055)), skin=skin)
    return p


def emerald_circlet():
    """An elven circlet: a twisted band of etched silver over the brow and the temples, covered in silver leaves swept
    back from the middle, each over the next; at the brow an emerald in a setting of two leaves; at each temple two long
    leaves rising back like wings."""
    p = Piece('circlet')
    p.budget = 4000
    scale, smooth_, silver, mail, glass = emerald_mats()
    hw = 0.0045
    band, y_of, A = diadem(p, silver, hw=hw, roll_mat=silver)
    RU = band.RU
    for s_ in (1, -1):
        for k in range(8):
            u0 = s_ * (0.012 + 0.021 * k)
            root, tip = (u0, -0.001), (u0 + s_ * 0.03, 0.006 + 0.0015 * k)
            p.add(silver, *plate(lambda u, v, k=k: band.point(u / RU, v, 0.0016 + 0.0004 * k + 0.0008 * gauss(v - 0.003, 0.004)),
                                 lambda u, v, root=root, tip=tip: leaf_sd(u, v, root, tip, 0.013), min(root[0], tip[0]) - 0.008, max(root[0], tip[0]) + 0.008,
                                 -0.009, 0.016, h=0.0009), solid=0.0016, roll=0.0006, sharp=30)
        for root, tip, w in (((s_ * 0.104, 0.002), (s_ * 0.15, 0.04), 0.017), ((s_ * 0.116, -0.002), (s_ * 0.17, 0.022), 0.014)):
            p.add(silver, *plate(lambda u, v: band.point(u / RU, v, 0.0022), lambda u, v, root=root, tip=tip, w=w: leaf_sd(u, v, root, tip, w),
                                 min(root[0], tip[0]) - 0.012, max(root[0], tip[0]) + 0.012, -0.01, 0.046, h=0.0009), solid=0.0018, roll=0.0006, sharp=30,
                  bump=lambda q: 0.0006)
    for s_ in (1, -1):
        p.add(silver, *plate(lambda u, v: band.point(u / RU, v, 0.0034), lambda u, v, s_=s_: leaf_sd(u, v, (0.0, -0.004), (s_ * 0.02, -0.011), 0.011),
                             -0.024, 0.024, -0.016, 0.002, h=0.0008), solid=0.0016, roll=0.0006)
    at, n = band.point(0.0, 0.002, 0.0045), band.normal(0.0, 0.002)
    p.add(silver, *rivet(at - n * 0.001, n, 0.0082, washer=0.0))
    p.add(glass, *oball(at + n * 0.002, (0.0072, 0.0045, 0.0095), frame(n), 14, 8))
    return p


def emerald_mage_gloves():
    """Gloves of emerald silk fitted finger by finger, silver vines embroidered on the back of the hand under a silver
    leaf set with an emerald; a cuff drawn out into a leaf's point up the back of the forearm, bordered in silver."""
    p = Piece('gloves')
    p.budget = 5000
    scale, smooth_, silver, mail, glass = emerald_mats()
    silk = mat('emerald_glove', 0x0d4a2e, 'cloth', engrave='vines', engrave_color=0xc0c6cc, emboss=True, rough=0.45, trim=0xb7bcc2, sheen=0x12806b,
               gloss=0.45, panels=True)
    hand = forms()['hand']
    fine_gloves(p, silk, deco=ornate(0.004, back_of_hand()))
    RU = 0.06
    both(p, silk, plate(lambda u, v: hand.point(u / RU, v, 0.0035 + 0.012 * smooth(-0.005, -0.08, v)),
                        lambda u, v: max(v - 0.006, (-0.07 - 0.06 * max(0.0, math.cos(u / RU)) ** 6) - v), -math.pi * RU, math.pi * RU, -0.134, 0.01,
                        h=0.0025, periodic=True), ('hand_l', 'lowerarm_l'), deco=ornate(0.005), solid=0.0022, roll=0.0011, roll_mat=silver)
    both(p, silver, plate(lambda u, v: hand.point(u / RU, v, 0.0042), lambda u, v: leaf_sd(u, v, (0.0, 0.015), (0.0, 0.07), 0.026), -0.016, 0.016, 0.012,
                          0.074, h=0.0012), ('hand_l',), solid=0.0018, roll=0.0007, bump=lambda q: 0.0006)
    at, n = hand.point(0.0, 0.035, 0.0062), hand.normal(0.0, 0.035)
    both(p, glass, gem(at, n, 0.0055), ('hand_l',))
    return p


def emerald_shoes():
    """Soft elven boots of green leather to mid-calf: a cuff turned down at the top cut into leaves, a silver leaf with
    an emerald at the outer ankle, the toe drawn out into a point curling up, tipped in silver; a sole."""
    p = Piece('feet')
    p.budget = 5000
    scale, smooth_, silver, mail, glass = emerald_mats()
    boot = mat('emerald_boot', 0x10422a, 'leather', engrave='vines', engrave_color=0xb0b8be, emboss=True, rough=0.5, trim=0xb7bcc2, gloss=0.35,
               panels=True)
    sole = mat('sole', 0x17130f, 'leather', rough=0.85)
    edge = dict(solid=0.0024, roll=0.0011, roll_mat=silver)
    calf, foot = soft_boots(p, boot, sole, edge=edge)
    RU = 0.06
    both(p, boot, plate(lambda u, v: calf.point(u / RU, v, 0.0068 + 0.004 * smooth(0.28, 0.19, v)),
                        lambda u, v: max(0.19 - v, v - 0.28 + hem_edge('leaf', 0.03)(7 * (u / RU + math.pi) / (2 * math.pi))), -math.pi * RU, math.pi * RU,
                        0.186, 0.284, h=0.0028, periodic=True), ('calf_l',), deco=ornate(0.006), **edge)
    a = -math.pi / 2
    both(p, silver, plate(lambda u, v: calf.point(u / RU, v, 0.0058), lambda u, v: leaf_sd(u, v, (a * RU, 0.43), (a * RU, 0.37), 0.022), a * RU - 0.014,
                          a * RU + 0.014, 0.365, 0.435, h=0.0012), ('calf_l', 'foot_l'), solid=0.0018, roll=0.0007)
    both(p, glass, gem(calf.point(a, 0.415, 0.008), calf.normal(a, 0.415), 0.0045), ('calf_l', 'foot_l'))
    tip, n = foot.point(0.0, 0.205, 0.0), foot.normal(0.0, 0.205)
    fwd = (foot.at(0.0, 0.24) - foot.at(0.0, 0.2)).normalized()
    pts = [tip + fwd * (0.04 * t) + UP * (0.03 * t ** 2.2) - n * 0.004 for t in (k / 10 for k in range(11))]
    both(p, boot, tube(pts, [0.016 * (1 - t) ** 0.8 + 0.002 for t in (k / 10 for k in range(11))], 12), ('ball_l',), deco=PLAIN)
    both(p, silver, oball(pts[-1] + fwd * 0.001, 0.0035), ('ball_l',))
    return p


# ---------------------------------------------------------------- finish: bake the dense model onto the light one

TEX = 1024
BUMP = {'steel': 0.25, 'blued': 0.25, 'black': 0.12, 'iron': 0.15, 'enamel': 0.2, 'brass': 0.2, 'gold': 0.2, 'bronze': 0.3,
        'leather': 0.45, 'mail': 1.0, 'hair': 0.8, 'cloth': 0.5, 'fur': 1.2, 'ice': 0.15, 'wood': 0.5}


def _rgb(hexc):
    c = [((hexc >> s_) & 255) / 255 for s_ in (16, 8, 0)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1.0]


def scale_tile(n=256, per=4):
    """A tileable height map of overlapping scales, `per` to a row, each row lying over the one below and hanging down
    past its own row: high on a scale's crown, falling to its rounded edge."""
    name = f'scale_tile_{n}'
    if name in bpy.data.images:
        return bpy.data.images[name]
    img = bpy.data.images.new(name, n, n, alpha=False, is_data=True)  # data, not colour: setting that later would wipe it
    s_ = n / per
    R = 0.76 * s_  # big enough that the rows leave no gaps
    px = [0.0] * (n * n * 4)
    for y in range(n):
        jr = int(y / s_)
        for x in range(n):
            best, h = -10 ** 9, 0.0
            for j in range(jr - 1, jr + 3):
                off = (j % 2) * s_ / 2
                for i in range(-1, per + 2):
                    d = math.hypot(x - (i * s_ + off), y - j * s_)
                    if d < R and j > best:  # the higher row lies over the lower
                        best, h = j, 1.0 - (d / R) ** 2
            k = (y * n + x) * 4
            px[k] = px[k + 1] = px[k + 2] = clamp(h)
            px[k + 3] = 1.0
    img.pixels[:] = px
    img.update()
    img.pack()  # Cycles only sees an image made in memory once it is packed
    return img


def mail_tile(n=256, per=4):
    """A tileable height map of mail, rings linked four to one: two lattices of rings half a ring apart, one lying over
    the other; high on the wire, nothing in the holes."""
    name = f'mail_tile_{n}'
    if name in bpy.data.images:
        return bpy.data.images[name]
    img = bpy.data.images.new(name, n, n, alpha=False, is_data=True)
    c = n / per
    px = [0.0] * (n * n * 4)
    for y in range(n):
        for x in range(n):
            h = 0.0
            for off, lift in ((0.0, 0.0), (0.5, 0.15)):  # the second lattice lies over the first
                fx, fy = (x / c + off) % 1.0 - 0.5, (y / c + off) % 1.0 - 0.5
                r = math.hypot(fx, fy * 1.15)
                wire = 1.0 - abs(r - 0.36) / 0.1
                if wire > 0:
                    h = max(h, wire ** 0.6 * 0.85 + lift) if lift else max(h, wire ** 0.6 * 0.85)
            k = (y * n + x) * 4
            px[k] = px[k + 1] = px[k + 2] = clamp(h)
            px[k + 3] = 1.0
    img.pixels[:] = px
    img.update()
    img.pack()
    return img


def scroll_tile(n=512):
    """A tileable panel of baroque scrollwork, for raised gilt ornament: an S of two spirals winding in from the middle
    to round terminals, the line tapering as it winds, from each a tendril curling into a small spiral of its own, and
    leaves along the outer arcs; 1 on the crest of a line, falling to 0 off it."""
    name = f'scroll_tile_{n}'
    if name in bpy.data.images:
        return bpy.data.images[name]
    import numpy as np
    strokes = []  # (points in tile units, half-widths)

    def spiral(c, r0, a0, turns, sense, w0, w1, r1=0.02):  # an open outer arc, winding tight at the end
        th = np.linspace(0.0, turns * 2 * np.pi, max(16, int(260 * turns * r0 / 0.1)))
        t = th / th[-1]
        r = r0 * (1 - (1 - r1 / r0) * t ** 1.2)
        a = a0 + sense * th
        return np.stack([c[0] + r * np.cos(a), c[1] + r * np.sin(a)], 1), w0 + (w1 - w0) * t

    def bez(p0, p1, p2, w0, w1, k=90):
        t = np.linspace(0.0, 1.0, k)[:, None]
        return (1 - t) ** 2 * np.array(p0) + 2 * (1 - t) * t * np.array(p1) + t * t * np.array(p2), np.linspace(w0, w1, k)

    def leaf(base, direction, length, width, curl=0.3, k=48):  # an acanthus leaf: swelling from its stem, curling to a tip
        d = np.array(direction, float)
        d /= np.linalg.norm(d)
        t = np.linspace(0.0, 1.0, k)
        side = np.array([-d[1], d[0]])
        pts = np.array(base) + d[None] * (length * t)[:, None] + side[None] * (curl * length * t * t)[:, None]
        return pts, width * np.sin(np.pi * t ** 0.6) ** 0.8 + 0.003

    def at(stroke, f):
        pts = stroke[0]
        return pts[min(len(pts) - 1, int(len(pts) * f))]

    def radial(stroke, f, c):
        q = at(stroke, f)
        return q - np.array(c)
    half = []
    c1 = (0.3, 0.5)
    s1 = spiral(c1, 0.2, 0.0, 1.5, 1, 0.026, 0.011)  # the S's first spiral, from the middle round over the top
    half += [s1, (s1[0][-1:], np.array([0.02]))]
    sa = spiral((0.64, 0.85), 0.08, math.pi, 1.3, -1, 0.017, 0.008, 0.012)  # a tendril up into a small spiral
    pa = at(s1, 0.12)
    ta = bez(pa, (pa[0] + 0.03, 0.97), sa[0][0], 0.018, 0.016)
    half += [ta, sa, (sa[0][-1:], np.array([0.014]))]
    sb = spiral((0.2, 0.135), 0.065, math.pi / 2, 1.25, 1, 0.015, 0.007, 0.011)  # and one down into another
    pb = at(s1, 0.42)
    tb = bez(pb, (0.08, 0.3), sb[0][0], 0.017, 0.015)
    half += [tb, sb, (sb[0][-1:], np.array([0.013]))]
    for f, length, width, curl in ((0.22, 0.1, 0.03, 0.35), (0.33, 0.09, 0.028, -0.3)):  # leaves off the outer arc
        half.append(leaf(at(s1, f), radial(s1, f, c1), length, width, curl))
    half.append(leaf(at(ta, 0.5), (-0.6, 0.8), 0.075, 0.022, 0.4))  # off the tendrils
    half.append(leaf(at(tb, 0.45), (-1.0, 0.1), 0.07, 0.02, -0.4))
    strokes += half + [(1.0 - pts, ws) for pts, ws in half]  # the other half turned about the middle
    m = np.full((n, n), 9.0, dtype=np.float32)
    for pts, ws in strokes:
        for (x, y), w in zip(pts, ws):
            cx, cy, rr = x * n, y * n, w * n
            r = int(math.ceil(rr)) + 1
            xs = np.arange(int(cx) - r, int(cx) + r + 1)
            ys = np.arange(int(cy) - r, int(cy) + r + 1)
            d = np.sqrt(((xs + 0.5 - cx)[None, :]) ** 2 + ((ys + 0.5 - cy)[:, None]) ** 2) / rr
            iy, ix = np.ix_(ys % n, xs % n)
            m[iy, ix] = np.minimum(m[iy, ix], d)
    h = np.sqrt(np.clip(1.0 - m * m, 0.0, 1.0))
    img = bpy.data.images.new(name, n, n, alpha=False, is_data=True)
    px = np.ones((n, n, 4), dtype=np.float32)
    px[:, :, 0] = px[:, :, 1] = px[:, :, 2] = h
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.pack()
    return img


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

    def scales(self, size=0.085):
        """Overlapping scales (scale_tile, four to a tile `size` metres wide), projected on every side; 1 on a scale's
        crown, 0 in the groove where the next row comes out."""
        t = self.node('ShaderNodeTexImage', projection='BOX', projection_blend=0.3)
        t.image = scale_tile()
        self.L(self.mapped((1 / size, 1 / size, 1 / size)), t.inputs['Vector'])
        return t.outputs['Color']

    def mail(self, ring=0.0042):
        """Mail (mail_tile, four rings to a tile), projected on every side: 1 on a ring's wire, 0 in its hole."""
        t = self.node('ShaderNodeTexImage', projection='BOX', projection_blend=0.3)
        t.image = mail_tile()
        size = ring * 4 * 1.3
        self.L(self.mapped((1 / size, 1 / size, 1 / size)), t.inputs['Vector'])
        return t.outputs['Color']

    def scrolls(self, size=0.16):
        """Baroque scrollwork (scroll_tile, a panel `size` metres wide), projected on every side and mirrored across the
        body's middle as a harness's ornament is; 1 on the crest of a line."""
        sep = self.node('ShaderNodeSeparateXYZ')
        self.L(self.obj, sep.inputs['Vector'])
        comb = self.node('ShaderNodeCombineXYZ')
        self.link(self.math('ABSOLUTE', sep.outputs['X']), comb.inputs['X'])
        self.L(sep.outputs['Y'], comb.inputs['Y'])
        self.L(sep.outputs['Z'], comb.inputs['Z'])
        t = self.node('ShaderNodeTexImage', projection='BOX', projection_blend=0.25)
        t.image = scroll_tile()
        self.L(self.mapped((1 / size, 1 / size, 1 / size), vec=comb.outputs['Vector']), t.inputs['Vector'])
        return t.outputs['Color']

    def frost(self):
        """Frost ferns: a network of fine crystals grown over the steel, coarse and fine together; 1 on a crystal."""
        out = None
        for scale, width, weight in ((60.0, 0.05, 1.0), (170.0, 0.07, 0.6)):
            n = self.node('ShaderNodeTexNoise', in_Scale=scale * 0.25, in_Detail=4.0, in_Roughness=0.6)
            self.L(self.obj, n.inputs['Vector'])
            warp = self.node('ShaderNodeVectorMath', operation='MULTIPLY_ADD')
            self.L(n.outputs['Color'], warp.inputs[0])
            warp.inputs[1].default_value = (0.7 / scale,) * 3
            self.L(self.obj, warp.inputs[2])
            v = self.node('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE', in_Scale=scale)
            self.L(warp.outputs['Vector'], v.inputs['Vector'])
            line = self.math('MULTIPLY', self.rng(v.outputs['Distance'], 0.0, width, 1.0, 0.0), weight)
            out = line if out is None else self.math('MAXIMUM', out, line)
        return out

    def fur(self):
        """Fur: fine hairs running down (Blender's Z), gathered into locks; 1 on a lock's crown, 0 deep between."""
        hairs = self.rng(self.noise((200, 200, 20), 3, 0.5), 0.3, 0.7, 0.0, 1.0)
        locks = self.rng(self.voronoi((13, 13, 5)), 0.0, 0.5, 1.0, 0.0)
        return self.math('MULTIPLY', self.math('ADD', self.math('MULTIPLY', hairs, 0.45), 0.55), locks)

    def strands(self):
        """Horsehair: fine strands across the crest, uneven."""
        return self.math('MULTIPLY', self.wave(260, 3.0, 3.0, 'Y', 'SIN'), self.rng(self.noise((60, 60, 300), 4), 0.3, 0.7, 0.6, 1.0))


def engraving(g, kind, m=None):
    """The pattern: 1 on a line, 0 off it."""
    if kind == 'waves':
        return g.rng(g.wave(70, 6, 2, 'Z', 'SIN'), 0.0, 0.12, 1.0, 0.0)
    if kind == 'scales':
        return g.scales(m.get('scale', 0.085) if m is not None else 0.085)
    if kind == 'vines':  # scrolling foliage
        return g.math('MAXIMUM', g.rng(g.wave(45, 12, 4, 'X', 'SIN'), 0.0, 0.14, 1.0, 0.0), g.rng(g.wave(45, 12, 4, 'Z', 'SIN'), 0.0, 0.14, 1.0, 0.0))
    if kind == 'lattice':
        a = g.rng(g.wave(40, 0, 0, 'X', 'SIN', g.mapped((1, 1, 1), (0, 0.785, 0))), 0.0, 0.1, 1.0, 0.0)
        b = g.rng(g.wave(40, 0, 0, 'X', 'SIN', g.mapped((1, 1, 1), (0, -0.785, 0))), 0.0, 0.1, 1.0, 0.0)
        return g.math('MAXIMUM', a, b)
    if kind == 'stitch':  # a row of stitches
        return g.rng(g.voronoi((300, 300, 300)), 0.0, 0.32, 1.0, 0.0)
    if kind == 'frost':
        return g.frost()
    if kind == 'scroll':
        return g.scrolls(m.get('scale', 0.16) if m is not None else 0.16)
    return None


def band_of(g, m):
    """Where the engraving shows: the deco mask, sharpened (a line along it for stitches)."""
    if m['engrave'] == 'stitch':
        return g.rng(g.math('ABSOLUTE', g.math('SUBTRACT', g.deco(), 0.5)), 0.0, 0.16, 1.0, 0.0)
    if m.get('panels'):
        return g.rng(g.deco(), 0.7, 0.85, 0.0, 1.0)
    return g.rng(g.deco(), 0.35, 0.65, 0.0, 1.0)


def trim_of(g, m):
    """Where a material's trim shows (1) and how far along the deco mask its inner edge lies."""
    at = 0.22 if m.get('panels') else 0.5
    return g.rng(g.deco(), at - 0.07, at + 0.07, 1.0, 0.0), at


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
        h = g.mail(m['ring'])
    elif kind == 'cloth':  # woven wool, with soft folds
        weave = g.math('MULTIPLY', g.wave(120, 0, 0, 'X', 'SIN'), g.wave(120, 0, 0, 'Z', 'SIN'))
        h = g.math('ADD', g.math('MULTIPLY', weave, 0.4), g.noise((25, 25, 25), 3, 0.5))
    elif kind == 'hair':
        h = g.strands()
    elif kind == 'fur':
        h = g.fur()
    elif kind == 'wood':  # the grain, along a shield's planks (the forearm's length in the rest pose)
        h = g.math('ADD', g.rng(g.wave(30, 8, 3, 'X', 'SIN'), 0.0, 1.0, 0.0, 0.4), g.math('MULTIPLY', g.noise((2, 40, 40), 4, 0.6), 0.6))
    elif kind == 'ice':  # meltwater ripples down its length
        h = g.math('MULTIPLY', g.noise((8, 8, 30), 3, 0.5), 0.3)
    e = engraving(g, m['engrave'], m) if m['engrave'] else None
    if e is not None:
        cut = g.math('MULTIPLY', g.math('MULTIPLY', e, band_of(g, m)), 0.9 if m['emboss'] else -0.6)
        h = cut if h is None else g.math('ADD', h, cut)
    if m.get('trim', -1) >= 0:  # the border stands a little proud of the plate
        tb = g.math('MULTIPLY', trim_of(g, m)[0], 0.5)
        h = tb if h is None else g.math('ADD', h, tb)
    if m.get('frost', 0.0) > 0:  # the rime's grain
        grain = g.math('MULTIPLY', g.noise((120, 120, 120), 2, 0.5), 0.25 * m['frost'])
        h = grain if h is None else g.math('ADD', h, grain)
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
            c = g.mix(c, _rgb(0x5a3a22), g.rng(g.noise((30, 30, 30), 5, 0.6), 0.62, 0.78, 0.0, 0.35))  # rust here and there
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
        c = g.mix([0.03, 0.03, 0.035, 1.0], c, g.rng(g.mail(m['ring']), 0.05, 0.4, 0.0, 1.0))  # the dark between the rings
    elif kind == 'cloth':
        c = g.mix(c, dark, g.rng(g.noise((25, 25, 25), 3, 0.5), 0.35, 0.7, 0.0, 0.5))
        c = g.mix(c, light, g.rng(g.noise((90, 90, 90), 4), 0.6, 0.8, 0.0, 0.15))
    elif kind == 'hair':
        c = g.mix([x * 0.3 for x in base[:3]] + [1.0], light, g.math('POWER', g.strands(), 1.5))
    elif kind == 'glass':  # a visor's glassy lacquer: the sky in it above, darkening to the chin, a bright streak at eye height
        zs = g.node('ShaderNodeSeparateXYZ')
        g.L(g.obj, zs.inputs['Vector'])
        sky = _rgb(m['sheen']) if m.get('sheen', -1) >= 0 else light
        c = g.mix(c, [min(1.0, x * 2.4) for x in sky[:3]] + [1.0], g.math('MULTIPLY', g.math('POWER', g.rng(zs.outputs['Z'], 0.03, 0.17, 0.0, 1.0), 1.6), 0.65))
        c = g.mix(c, [0.7, 0.9, 0.84, 1.0], g.rng(g.math('ABSOLUTE', g.math('SUBTRACT', zs.outputs['Z'], 0.112)), 0.0, 0.011, 0.6, 0.0))
    elif kind == 'wood':  # oak: its grain in darker streaks, lighter where it is worn
        c = g.mix(c, dark, g.rng(g.wave(30, 8, 3, 'X', 'SIN'), 0.0, 0.5, 0.45, 0.0))
        c = g.mix(c, light, g.rng(g.noise((2, 40, 40), 4, 0.6), 0.55, 0.75, 0.0, 0.25))
    elif kind == 'fur':  # white locks, grey-blue in the shadow between them
        c = g.mix([x * 0.55 for x in base[:3]] + [1.0], c, g.fur())
    elif kind == 'ice':  # clear ice: a darker core here and there, streaks down its length
        c = g.mix(c, [x * 0.72 for x in base[:3]] + [1.0], g.rng(g.noise((10, 10, 40), 3), 0.4, 0.7, 0.0, 0.6))
    sheen = m.get('sheen', -1)
    if sheen >= 0:  # a beetle's shell: the lacquer shifts to its second colour in broad patches
        c = g.mix(c, _rgb(sheen), g.rng(g.noise((5, 5, 5), 2, 0.5), 0.35, 0.75, 0.0, 0.6))
    e = engraving(g, m['engrave'], m) if m['engrave'] else None
    if e is not None:
        band = band_of(g, m)
        if m['engrave'] == 'stitch':
            c = g.mix(c, [x * 0.35 for x in base[:3]] + [1.0], g.math('MULTIPLY', e, band))
        elif m['emboss'] and m['engrave_rgb'] >= 0:  # raised gilt on the plate: polished on its crests, darker down its flanks
            gc = _rgb(m['engrave_rgb'])
            gilt = g.mix([x * 0.5 for x in gc[:3]] + [1.0], gc, g.rng(e, 0.0, 0.55, 0.0, 1.0))
            gilt = g.mix(gilt, [min(1.0, x * 1.3) for x in gc[:3]] + [1.0], g.rng(e, 0.75, 1.0, 0.0, 0.8))
            c = g.mix(c, gilt, g.math('MULTIPLY', band, g.rng(e, 0.02, 0.1, 0.0, 1.0)))
        elif m['emboss']:  # raised and polished, the ground between sunk and dark
            c = g.mix(c, [x * 0.32 for x in base[:3]] + [1.0], g.math('MULTIPLY', band, g.rng(e, 0.0, 0.45, 1.0, 0.0)))
            c = g.mix(c, light, g.math('MULTIPLY', g.math('MULTIPLY', e, band), 0.5))
        else:
            if m['engrave_rgb'] >= 0:  # gilt: the band gilded, the pattern etched dark into the gilding
                gc = _rgb(m['engrave_rgb'])
                c = g.mix(c, g.mix(gc, [x * 0.8 for x in gc[:3]] + [1.0], g.noise((60, 60, 60), 3)), band)
                c = g.mix(c, [x * 0.3 for x in gc[:3]] + [1.0], g.math('MULTIPLY', e, band))
            else:
                c = g.mix(c, dark, g.math('MULTIPLY', g.math('MULTIPLY', e, band), 0.8))
            line = g.rng(g.math('ABSOLUTE', g.math('SUBTRACT', g.deco(), 0.5)), 0.0, 0.12, 0.75, 0.0)
            c = g.mix(c, [0.02, 0.018, 0.015, 1.0], line)
        if m['emboss'] and sheen >= 0:  # the scales' crowns catch the sheen
            c = g.mix(c, [min(1.0, x * 1.3) for x in _rgb(sheen)[:3]] + [1.0], g.math('MULTIPLY', g.math('MULTIPLY', e, band), 0.4))
    trim = m.get('trim', -1)
    if trim >= 0:  # the border: polished metal, brushed, etched with a fine running line, a dark line where it meets the plate
        tc = _rgb(trim)
        metal_ = g.mix(tc, [min(1.0, x * 1.15) for x in tc[:3]] + [1.0], g.rng(g.noise((260, 10, 10), 2, 0.4), 0.4, 0.7, 0.0, 1.0))
        etch = g.rng(g.wave(160, 8, 3, 'X', 'SIN'), 0.0, 0.14, 0.7, 0.0)
        metal_ = g.mix(metal_, [x * 0.35 for x in tc[:3]] + [1.0], etch)
        tm, at = trim_of(g, m)
        c = g.mix(c, metal_, tm)
        c = g.mix(c, [0.02, 0.03, 0.025, 1.0], g.rng(g.math('ABSOLUTE', g.math('SUBTRACT', g.deco(), at)), 0.0, 0.1 if at == 0.5 else 0.04, 0.8, 0.0))
    if kind == 'inner':
        return c
    geo = g.node('ShaderNodeNewGeometry')
    edge = g.rng(geo.outputs['Pointiness'], 0.53, 0.6, 0.0, 1.0)
    if kind == 'enamel' and sheen < 0:
        chips = g.math('MULTIPLY', edge, g.rng(g.noise((90, 90, 90), 4), 0.4, 0.55, 0.0, 1.0))
        c = g.mix(c, steelc, g.math('MINIMUM', chips, 0.9))  # the paint chipped off the edges
    elif kind in ('black', 'iron'):
        c = g.mix(c, _rgb(0x7a6a58), g.math('MULTIPLY', edge, 0.5))  # worn to bare, heat-tinted steel
    elif kind == 'bronze':
        c = g.mix(c, _rgb(0xd09a5a), g.math('MULTIPLY', edge, 0.7))  # rubbed bright on the edges
    elif kind not in ('mail', 'hair', 'fur'):
        c = g.mix(c, light, g.math('MULTIPLY', edge, 0.5))
    frost = m.get('frost', 0.0)
    if frost > 0:  # rime on the edges, on the faces turned up and in the hollows, in patches, and a haze of it all over
        nz = g.node('ShaderNodeSeparateXYZ')
        g.L(geo.outputs['Normal'], nz.inputs['Vector'])
        where = g.math('ADD', g.math('ADD', g.rng(nz.outputs['Z'], 0.1, 0.9, 0.0, 0.8), edge), g.rng(g.ao(0.012), 0.55, 0.95, 0.7, 0.0))
        patch = g.rng(g.noise((22, 22, 22), 5, 0.6), 0.32, 0.66, 0.0, 1.0)
        c = g.mix(c, _rgb(0xeef5f9), g.math('MINIMUM', g.math('MULTIPLY', g.math('MULTIPLY', where, patch), frost), 0.92))
        c = g.mix(c, _rgb(0xd6e6f2), g.math('MULTIPLY', g.rng(g.noise((5, 5, 5), 3), 0.4, 0.7, 0.0, 0.18), frost))
    c = g.mul(c, g.gray(g.rng(g.ao(0.03), 0.0, 1.0, 0.45, 1.0)))
    sep = g.node('ShaderNodeSeparateXYZ')
    g.L(g.obj, sep.inputs['Vector'])
    return g.mul(c, g.gray(g.rng(sep.outputs['Z'], -0.08, 0.32, 0.75, 1.05)))


def select(*objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[-1]


def shine_of(m):
    """How much a material shines, 0..1 (it goes in the colour map's alpha; the client scales the highlight by it)."""
    if m.get('gloss', -1.0) >= 0:
        return m['gloss']
    if m['kind'] in METAL or m['kind'] == 'mail':
        return clamp(0.35 + 0.65 * (1 - m['rough']))
    if m['kind'] == 'glass':
        return 0.95
    return {'enamel': 0.45, 'inner': 0.08, 'ice': 0.85, 'fur': 0.05}.get(m['kind'], 0.12)


def finish(his, los, name, tex=None):
    """Bake the dense model's colour and relief onto the light one and give it one material, so the game draws each
    piece in one go: the unwrapped parts fill the maps but for a band along the top, where every flat-coloured part
    (insides, rivets, plain edges) gets a patch of its colour, and how much each part shines goes in the colour map's
    alpha. Each part is baked from its own dense copy alone: plates lie a few millimetres over each other (lames,
    tassets over mail), and the thinned copy of one a little off its dense one would otherwise take its look from the
    one under it. What the piece is mostly made of rides along for the client."""
    sc = bpy.context.scene
    for o in his:
        select(o)
        bev = o.modifiers.new('bevel', 'BEVEL')
        bev.width, bev.segments, bev.limit_method, bev.angle_limit = 0.0008, 2, 'ANGLE', math.radians(50)
        bpy.ops.object.modifier_apply(modifier='bevel')
    flat = lambda m: m['kind'] == 'inner' or m.get('plain')
    flats = []  # the flat-coloured materials, in the order of their patches
    for o in los:
        select(o)
        # each face's corners on their own side of every sharp edge: the bake casts its rays along the vertex normals,
        # and a vertex shared with the thin rim of a thinned plate points along the plate, its rays missing it
        es = o.modifiers.new('es', 'EDGE_SPLIT')
        es.split_angle, es.use_edge_sharp = math.radians(50), True
        bpy.ops.object.modifier_apply(modifier='es')
        wn = o.modifiers.new('wn', 'WEIGHTED_NORMAL')
        wn.keep_sharp = True
        bpy.ops.object.modifier_apply(modifier='wn')
        if not o.data.uv_layers:
            o.data.uv_layers.new()
        flats += [m for m in o.data.materials if flat(m) and m not in flats]
        for poly in o.data.polygons:
            poly.select = not flat(o.data.materials[poly.material_index])
    select(*los, active=los[0])
    bpy.ops.object.mode_set(mode='EDIT')  # all the parts unwrapped together, their islands packed into one map
    bpy.ops.uv.smart_project(angle_limit=math.radians(55), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    patch = {m.name: ((k + 0.5) / 32, 0.985) for k, m in enumerate(flats)}
    targets = []  # the parts with anything to bake
    for o in los:
        uv = o.data.uv_layers.active.data
        for poly in o.data.polygons:
            m = o.data.materials[poly.material_index]
            for li in poly.loop_indices:
                uv[li].uv = patch[m.name] if flat(m) else (uv[li].uv[0], uv[li].uv[1] * 0.965)
        if any(not flat(o.data.materials[poly.material_index]) for poly in o.data.polygons):
            targets.append(o)
    size = tex or (2048 if name == 'chest' else TEX)  # the cuirass is most of the armour's surface
    col_img = bpy.data.images.new(f'{name}_color', size, size, alpha=True)
    nor_img = bpy.data.images.new(f'{name}_normal', size, size, alpha=False, is_data=True)
    shine_img = bpy.data.images.new(f'{name}_shine', size, size, alpha=False, is_data=True)
    import numpy as np
    UNBAKED = (1.0, 0.0, 1.0)  # what a texel no ray reached keeps: a black one may be a black silk's, deep in shadow
    for img in (col_img, nor_img, shine_img):
        img.pixels.foreach_set(np.tile(np.array(UNBAKED + (1.0,), dtype=np.float32), size * size))
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    mats = {m for o in his + los for m in o.data.materials}

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
            strength = m.get('bump', -1.0) if m.get('bump', -1.0) >= 0 else BUMP.get(m['kind'], 0.3)
            bump = g.node('ShaderNodeBump', in_Strength=strength, in_Distance=0.003)
            g.L(h, bump.inputs['Height'])
            g.L(bump.outputs['Normal'], bsdf.inputs['Normal'])
        return bsdf.outputs['BSDF']

    def colour(g, m):
        em = g.node('ShaderNodeEmission')
        g.L(look(g, m), em.inputs['Color'])
        return em.outputs['Emission']

    def shine(g, m):
        em = g.node('ShaderNodeEmission')
        v = shine_of(m)
        em.inputs['Color'].default_value = (v, v, v, 1.0)
        return em.outputs['Emission']

    # each part from its own dense copy (the others stay in the scene, shading it): the rays can be long enough for a
    # thinned plate a few millimetres off its dense one without finding the plate under it; no margin, as one part's
    # would spill over another's islands - the fill below gives the maps theirs
    bake = dict(use_selected_to_active=True, cage_extrusion=0.004, max_ray_distance=0.01, margin=0, use_clear=False)
    for target, surface, kind in ((nor_img, relief, dict(type='NORMAL', normal_space='TANGENT')), (col_img, colour, dict(type='EMIT')),
                                  (shine_img, shine, dict(type='EMIT'))):
        prep(target, surface)
        for o in targets:
            select(*[h for h in his if h['part'] == o['part']], o, active=o)
            bpy.ops.object.bake(**kind, **bake)
    # the patches of flat colour (sRGB, as the colour map stores it), flat relief, and the shine in the colour's alpha
    px = {}
    for key, img in (('col', col_img), ('nor', nor_img), ('shine', shine_img)):
        a = np.empty(size * size * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        px[key] = a.reshape(size, size, 4)
    top = int(0.97 * size)
    for key in ('col', 'nor', 'shine'):  # texels no part reached (round the islands, or a ray that found nothing): fill them from their neighbours
        a = px[key]
        miss = np.abs(a[:, :, :3] - np.array(UNBAKED, dtype=np.float32)).max(axis=2) < 1e-4
        for _ in range(24):
            if not miss.any():
                break
            acc, cnt = np.zeros(a.shape[:2] + (3,), dtype=np.float32), np.zeros(a.shape[:2], dtype=np.float32)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                take = miss & np.roll(~miss, (dy, dx), axis=(0, 1))
                acc[take] += np.roll(a[:, :, :3], (dy, dx), axis=(0, 1))[take]
                cnt[take] += 1
            fill = cnt > 0
            a[fill, :3] = acc[fill] / cnt[fill][:, None]
            miss &= ~fill
        a[miss, :3] = (0.5, 0.5, 1.0) if key == 'nor' else (0.0, 0.0, 0.0)  # far from any island: flat and dark
    for k, m in enumerate(flats):
        x0, x1 = int(k / 32 * size), int((k + 1) / 32 * size)
        px['col'][top:, x0:x1, :3] = [((m['rgb'] >> s_) & 255) / 255 for s_ in (16, 8, 0)]
        px['nor'][top:, x0:x1, :3] = (0.5, 0.5, 1.0)
        px['shine'][top:, x0:x1, 0] = shine_of(m)
    px['col'][:, :, 3] = px['shine'][:, :, 0]
    col_img.pixels.foreach_set(px['col'].ravel())
    nor_img.pixels.foreach_set(px['nor'].ravel())
    if PREVIEW:  # keep the maps to look at
        for img in (col_img, nor_img):
            img.filepath_raw = os.path.join(PREVIEW, f'{img.name}.png')
            img.file_format = 'PNG'
            img.save()
    for h in his:
        bpy.data.objects.remove(h)
    select(*los, active=los[0])
    bpy.ops.object.join()
    lo = bpy.context.view_layer.objects.active
    lo.name = lo.data.name = name
    olds = list(lo.data.materials)
    skip = [i for i, m in enumerate(olds) if flat(m)]
    counts = [0] * len(olds)
    for poly in lo.data.polygons:
        counts[poly.material_index] += 1
    main = max((i for i in range(len(olds)) if i not in skip), key=lambda i: counts[i], default=0)
    f = bpy.data.materials.new(name + '_baked')
    f.use_nodes = True
    for k in ('kind', 'rgb', 'rough', 'metal'):
        f[k] = olds[main][k]
    f['shine'] = 1  # the colour map's alpha says how much each part shines
    nt = f.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = olds[main]['rough']
    bsdf.inputs['Metallic'].default_value = olds[main]['metal']
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = nor_img
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = col_img
    nt.links.new(tc.outputs['Color'], bsdf.inputs['Base Color'])
    nt.nodes.active = tc
    lo.data.materials.clear()
    lo.data.materials.append(f)
    for poly in lo.data.polygons:
        poly.material_index = 0
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
    'abyssal': {'helm': abyssal_helm, 'chest': abyssal_chest, 'gloves': abyssal_gloves, 'legs': abyssal_legs, 'feet': abyssal_feet},
    'ashforged': {'helm': ashforged_helm, 'chest': ashforged_chest, 'gloves': ashforged_gloves, 'legs': ashforged_legs, 'feet': ashforged_feet},
    'dragon': {'helm': dragon_helm, 'chest': dragon_chest, 'gloves': dragon_gloves, 'legs': dragon_legs, 'feet': dragon_feet},
    'glacial': {'helm': glacial_helm, 'chest': glacial_chest, 'gloves': glacial_gloves, 'legs': glacial_legs, 'feet': glacial_feet},
    'emerald': {'helm': emerald_helm, 'chest': emerald_chest, 'gloves': emerald_gloves, 'legs': emerald_legs, 'feet': emerald_feet},
    'infernal': {'helm': infernal_helm, 'chest': infernal_chest, 'gloves': infernal_gloves, 'legs': infernal_legs, 'feet': infernal_feet},
    # the shields, a file each (client/src/render/quaternius.ts SHIELDS)
    'shield_buckler': {'shield': buckler_shield}, 'shield_brigandine': {'shield': brigandine_shield}, 'shield_plate': {'shield': plate_shield},
    'shield_abyssal': {'shield': abyssal_shield}, 'shield_ashforged': {'shield': ashforged_shield}, 'shield_dragon': {'shield': dragon_shield},
    'shield_glacial': {'shield': glacial_shield}, 'shield_emerald': {'shield': emerald_shield}, 'shield_infernal': {'shield': infernal_shield},
    # each set's sword and staff, a file a set (client/src/render/quaternius.ts qWeapon)
    **{f'weapons_{s}': {'blade': globals()[f'{s}_blade'], 'staff': globals()[f'{s}_staff']} for s in ('abyssal', 'ashforged', 'dragon', 'glacial', 'emerald', 'infernal')},
    # each set's mage gear, a file a set (client/src/render/quaternius.ts armorPiece, HEADGEAR)
    'mage_infernal': {'robe': infernal_robe, 'circlet': infernal_circlet, 'gloves': infernal_mage_gloves, 'feet': infernal_shoes},
    **{f'mage_{s}': {'robe': globals()[f'{s}_robe'], 'circlet': globals()[f'{s}_circlet'], 'gloves': globals()[f'{s}_mage_gloves'],
                     'feet': globals()[f'{s}_shoes']} for s in ('abyssal', 'ashforged', 'dragon', 'glacial', 'emerald')},
}


def tris(ob):
    return sum(len(p_.vertices) - 2 for p_ in ob.data.polygons)


def run(set_id, pieces):
    global RES
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    objs = []
    for name, fn in pieces.items():
        if PART and name not in PART.split(','):
            continue
        RES = 1.0
        piece = fn()
        if FAST:
            ob = piece.build()
            dense = tris(ob)
        else:
            his = piece.build(join=False)
            dense = sum(tris(o) for o in his)
            RES = LIGHT
            piece = fn()
            los = piece.build(join=False)
            RES = 1.0
            ob = finish(his, los, name, piece.tex)
        if any(piece.rules[1:]):
            skin_weights(ob, piece.rules)
        objs.append(ob)
        print(f'[gear] {set_id}.{name}: {dense} tris dense, {tris(ob)} for the game')
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        heads = [o for o in objs if o.name.startswith(('helm', 'circlet'))]
        held = [o for o in objs if o.name.split('.')[0] in ('blade', 'staff')]
        if heads:
            preview(heads[0], set_id)
        if held:
            preview_props(held, set_id)
        if len(heads) + len(held) < len(objs):
            preview_body([o for o in objs if o not in heads and o not in held], set_id)
        return
    select(*objs)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{set_id}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=True, export_normals=True, export_materials='EXPORT', export_image_format='WEBP',
                              export_extras=True, export_attributes=True, export_vertex_color='NONE')
    print(f'[gear] {set_id}: {", ".join(pieces)} -> {path} ({os.path.getsize(path) // 1024} KB)')


for set_id, pieces in SETS.items():
    if not ONLY or set_id in ONLY.split(','):
        run(set_id, pieces)
