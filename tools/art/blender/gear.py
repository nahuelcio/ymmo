"""
Gear for the playable characters, modelled here from code (no source pack): each armour set's pieces, written to
client/public/q/gear/<set>.glb with one node per piece (`helm` for now; the body pieces and shields come later).

    blender --background --python tools/art/blender/gear.py -- [out_dir]

Coordinates are the game's, in metres: Y up, the character faces +Z, +X is its left. Every piece is modelled around
its bone's pivot in the bind pose and exported with its origin there; the client hangs it from that bone with
attach() (client/src/render/quaternius.ts), which keeps the orientation it was modelled in. The head bone's pivot
sits at the top of the neck; the skull fills roughly a 0.23 m wide ball centred 0.125 m above it (measured on the
armature and on the kit's helmets, which fit it). Materials are flat colours (the game shades with Lambert) with
emission only on the accents meant to glow.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(REPO, 'client', 'public', 'q', 'gear')

# the skull, around the head bone's pivot
SKULL = Vector((0.0, 0.125, 0.012))
SKULL_R = Vector((0.118, 0.13, 0.126))


def B(v):
    """game space (Y up, facing +Z) -> Blender (Z up, facing -Y); the glTF export turns it back."""
    return Vector((v[0], -v[2], v[1]))


# ---------------------------------------------------------------- materials

_mats = {}


def mat(name, color, emit=0.0, rough=0.7, metal=0.0):
    """A flat colour (sRGB hex); emit > 0 makes it glow in that colour."""
    key = (name, color, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    c = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    bsdf.inputs['Base Color'].default_value = (*lin, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emit > 0:
        bsdf.inputs['Emission Color'].default_value = (*lin, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


# ---------------------------------------------------------------- a piece: geometry gathered per material

class Piece:
    """Geometry for one exported node, kept per material; `smooth` per part (crystals stay faceted)."""

    def __init__(self, name):
        self.name = name
        self.parts = []  # (material, verts, faces, smooth)

    def add(self, material, verts, faces, smooth=True):
        self.parts.append((material, [Vector(v) for v in verts], faces, smooth))
        return self

    def build(self):
        me = bpy.data.meshes.new(self.name)
        bm = bmesh.new()
        slots = []
        for material, verts, faces, smooth in self.parts:
            if material not in slots:
                slots.append(material)
            idx = slots.index(material)
            bv = [bm.verts.new(B(v)) for v in verts]
            for f in faces:
                try:
                    face = bm.faces.new([bv[i] for i in f])
                except ValueError:
                    continue
                face.material_index = idx
                face.smooth = smooth
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for m in slots:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- shapes (all in game space)

def shell(c, r, y_from, y_to, seg=28, rings=10, cut=None, squash_top=1.0, bucket=0.0):
    """An ellipsoid band between two heights (fractions -1..1 of the y radius): helmet shells and caps.
    cut(angle, yfrac) -> True drops that quad (a face opening). angle 0 faces +Z, pi/2 is +X.
    bucket 0..1: below the middle the walls go straight down instead of curling in (a closed helm over the jaw)."""
    verts, faces = [], []
    for i in range(rings + 1):
        t = y_from + (y_to - y_from) * i / rings
        lat = math.asin(max(-1.0, min(1.0, t)))
        rr, yy = math.cos(lat), math.sin(lat) * (squash_top if t > 0 else 1.0)
        if t < 0 and bucket:
            rr, yy = rr + (1.0 - 0.06 * -t - rr) * bucket, yy + (t - yy) * bucket
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append((c[0] + r[0] * rr * math.sin(a), c[1] + r[1] * yy, c[2] + r[2] * rr * math.cos(a)))
    top_cap = y_to >= 0.999
    for i in range(rings):
        for j in range(seg):
            a0, t0 = 2 * math.pi * (j + 0.5) / seg, y_from + (y_to - y_from) * (i + 0.5) / rings
            if cut and cut(a0 if a0 <= math.pi else a0 - 2 * math.pi, t0):
                continue
            k = i * seg + j
            k2 = i * seg + (j + 1) % seg
            faces.append((k, k2, k2 + seg, k + seg))
    if top_cap:
        verts.append((c[0], c[1] + r[1] * squash_top, c[2]))
        top = len(verts) - 1
        base = rings * seg
        faces += [(base + j, base + (j + 1) % seg, top) for j in range(seg)]
    return verts, faces


def thicken(verts, faces, c, t):
    """A shell with a back face pushed in toward c by t, and its open edges closed (reads as a plate, not paper)."""
    n = len(verts)
    inner = []
    for v in verts:
        d = Vector(v) - Vector(c)
        inner.append(Vector(c) + d * max(0.0, (d.length - t) / max(d.length, 1e-6)))
    out_f = list(faces) + [tuple(reversed([i + n for i in f])) for f in faces]
    # rim: edges used by one face only
    use = {}
    for f in faces:
        for a, b in zip(f, f[1:] + f[:1]):
            use[(a, b)] = use.get((a, b), 0) + 1
    for (a, b), _ in use.items():
        if (b, a) not in use:
            out_f.append((b, a, a + n, b + n))
    return [Vector(v) for v in verts] + inner, out_f


def tube(points, radii, seg=10, cap=True):
    """A tube swept along a polyline, its radius per point: horns, fins' ribs, rims, vines."""
    pts = [Vector(p) for p in points]
    verts, faces = [], []
    prev_n = None
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        if prev_n is None:
            up = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
            n = d.cross(up).normalized()
        else:
            n = (prev_n - d * prev_n.dot(d)).normalized()
        prev_n = n
        b = d.cross(n).normalized()
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append(p + (n * math.cos(a) + b * math.sin(a)) * radii[i])
    for i in range(len(pts) - 1):
        for j in range(seg):
            k, k2 = i * seg + j, i * seg + (j + 1) % seg
            faces.append((k, k + seg, k2 + seg, k2))
    if cap:
        verts.append(pts[0])
        verts.append(pts[-1])
        s, e, last = len(verts) - 2, len(verts) - 1, (len(pts) - 1) * seg
        faces += [(s, (j + 1) % seg, j) for j in range(seg)]
        faces += [(e, last + j, last + (j + 1) % seg) for j in range(seg)]
    return verts, faces


def arc(p0, p1, bulge, n=10, twist=None):
    """Points along a curve from p0 to p1, bowed by `bulge` (a vector) at the middle: horns, crests."""
    p0, p1, bulge = Vector(p0), Vector(p1), Vector(bulge)
    return [p0.lerp(p1, i / n) + bulge * math.sin(math.pi * i / n) for i in range(n + 1)]


def slab(outline, thickness, origin, u, v):
    """A flat shape (2D outline, counter-clockwise) extruded by `thickness` along u x v, placed at origin on the u/v
    plane: fins, flames, leaves, visors, crests."""
    o, u, v = Vector(origin), Vector(u).normalized(), Vector(v).normalized()
    w = u.cross(v).normalized() * (thickness / 2)
    n = len(outline)
    front = [o + u * x + v * y + w for x, y in outline]
    back = [o + u * x + v * y - w for x, y in outline]
    verts = front + back
    # fan triangulation from the centroid keeps concave-ish outlines (flames) usable
    cx = sum(x for x, _ in outline) / n
    cy = sum(y for _, y in outline) / n
    verts.append(o + u * cx + v * cy + w)
    verts.append(o + u * cx + v * cy - w)
    cf, cb = 2 * n, 2 * n + 1
    faces = [(cf, i, (i + 1) % n) for i in range(n)]
    faces += [(cb, n + (i + 1) % n, n + i) for i in range(n)]
    faces += [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
    return verts, faces


def leaf(length, width, n=8):
    """A leaf's outline (pointed both ends, fuller near the stem), along +x."""
    pts = [(length * i / n, width * math.sin(math.pi * i / n) * (1.0 - 0.35 * i / n)) for i in range(n + 1)]
    return pts + [(x, -y) for x, y in reversed(pts[1:-1])]


def flame(h, w):
    """A flame's outline: a wavy tongue rising along +y."""
    return [(-w, 0), (-w * 0.55, h * 0.35), (-w * 0.85, h * 0.55), (-w * 0.2, h * 0.75), (-w * 0.35, h * 0.9),
            (0, h), (w * 0.3, h * 0.82), (w * 0.15, h * 0.6), (w * 0.7, h * 0.45), (w * 0.45, h * 0.2), (w, 0)]


def crystal(base, direction, length, r, sides=6):
    """A pointed hexagonal crystal from `base` along `direction`: ice."""
    d = Vector(direction).normalized()
    up = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    n = d.cross(up).normalized()
    b = d.cross(n).normalized()
    base = Vector(base)
    ring0 = [base + (n * math.cos(2 * math.pi * j / sides) + b * math.sin(2 * math.pi * j / sides)) * r for j in range(sides)]
    ring1 = [p + d * length * 0.7 for p in ring0]
    verts = ring0 + ring1 + [base + d * length, base]
    tip, bot = 2 * sides, 2 * sides + 1
    faces = [(j, (j + 1) % sides, sides + (j + 1) % sides, sides + j) for j in range(sides)]
    faces += [(sides + j, sides + (j + 1) % sides, tip) for j in range(sides)]
    faces += [((j + 1) % sides, j, bot) for j in range(sides)]
    return verts, faces


def ball(c, r, seg=10, rings=6):
    return shell(c, (r, r, r) if isinstance(r, (int, float)) else r, -1, 1, seg, rings)


def box(c, size, rot_y=0.0, rot_x=0.0, rot_z=0.0):
    """A box centred at c, turned by the given angles (radians, applied z, x, y)."""
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    corners = [(-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz), (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz)]
    rm = Matrix.Rotation(rot_y, 3, 'Y') @ Matrix.Rotation(rot_x, 3, 'X') @ Matrix.Rotation(rot_z, 3, 'Z')
    verts = [Vector(c) + rm @ Vector(p) for p in corners]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (0, 4, 7, 3)]
    return verts, faces


def on_skull(angle, yfrac, out=0.0):
    """A point on the helmet's surface: angle 0 faces front (+Z), pi/2 the left (+X); yfrac -1..1 of its height."""
    lat = math.asin(max(-1, min(1, yfrac)))
    rr = math.cos(lat)
    return Vector((SKULL.x + (SKULL_R.x + out) * rr * math.sin(angle), SKULL.y + (SKULL_R.y + out) * math.sin(lat),
                   SKULL.z + (SKULL_R.z + out) * rr * math.cos(angle)))


def face_open(width, top):
    """A face opening: the front within ±width radians, below yfrac `top`."""
    return lambda a, t: abs(a) < width and t < top


# ---------------------------------------------------------------- helmets

def leather_cap():
    """Apprentice: a padded leather cap with ear flaps and a stitched seam, a knob on top."""
    p = Piece('helm')
    leather, seam = mat('leather', 0x7a4a24, rough=0.9), mat('stitch', 0x3f2512, rough=0.9)
    v, f = shell(SKULL, SKULL_R * 1.0, -0.35, 1.0, cut=face_open(1.15, -0.05), squash_top=0.92)
    p.add(leather, *thicken(v, f, SKULL, 0.008))
    # ear flaps, rounded, hanging over the ears
    for s in (1, -1):
        top, bottom = on_skull(s * math.pi / 2, -0.3, 0.006), on_skull(s * math.pi / 2, -0.95, 0.012)
        outline = [(-0.035, 0.0), (0.035, 0.0), (0.03, -0.07), (0.012, -0.1), (-0.012, -0.1), (-0.03, -0.07)]
        p.add(leather, *slab(outline, 0.012, top, (0, 0, 1), (bottom - top).normalized() * -1))
        p.add(seam, *tube([top + Vector((s * 0.008, -0.01, -0.03)), top + Vector((s * 0.01, -0.085, 0.0)), top + Vector((s * 0.008, -0.01, 0.03))], [0.004] * 3, 5))
    # a stitched band round the brow and a seam over the crown
    band = [on_skull(2 * math.pi * i / 24, -0.02, 0.006) for i in range(25)]
    p.add(seam, *tube(band, [0.006] * 25, 6, cap=False))
    crown = [on_skull(0, -0.02 + i * 0.1, 0.006) for i in range(10)] + [on_skull(math.pi, 0.88 - i * 0.1, 0.006) for i in range(10)]
    p.add(seam, *tube(crown, [0.005] * len(crown), 6))
    p.add(seam, *ball(SKULL + Vector((0, SKULL_R.y * 0.92 + 0.012, 0)), 0.018))
    return p, {'hair': False, 'closed': False}


def abyssal_helm():
    """Abyssal: deep-sea blue with a fin crest, gill flaps on the cheeks, barnacles and a pearl on the brow."""
    p = Piece('helm')
    deep, fin, pearl = mat('abyss_deep', 0x1d4468, rough=0.45, metal=0.3), mat('abyss_fin', 0x2bb0a6, rough=0.5), mat('abyss_pearl', 0xe8e2d2, rough=0.3)
    glow = mat('abyss_glow', 0x8ff0ff, emit=0.8)
    v, f = shell(SKULL, SKULL_R * 1.03, -0.75, 1.0, cut=face_open(0.95, 0.05))
    p.add(deep, *thicken(v, f, SKULL, 0.01))
    # the fin: a crest rising from the brow and sweeping back over the crown, with ribs
    outline = [(0.0, 0.0), (0.04, 0.07), (0.1, 0.15), (0.18, 0.21), (0.26, 0.22), (0.31, 0.17), (0.3, 0.08), (0.33, 0.03), (0.28, 0.0)]
    u, v_ = Vector((0, 0.15, -1)).normalized(), Vector((0, 1, 0.15)).normalized()
    base = Vector((0, SKULL.y + SKULL_R.y * 0.55, SKULL.z + 0.1))
    p.add(fin, *slab(outline, 0.014, base, u, v_))
    for k in range(5):  # the ribs that hold the fin's webbing
        x0 = 0.04 + k * 0.055
        p.add(deep, *tube([base + u * x0, base + u * (x0 + 0.03) + v_ * (0.09 + k * 0.025)], [0.007, 0.003], 5))
    back = Vector((0, SKULL.y - 0.03, SKULL.z - SKULL_R.z - 0.005))
    p.add(fin, *slab([(0.0, 0.0), (0.05, 0.06), (0.11, 0.07), (0.13, 0.0)], 0.012, back, (0, -1, -0.2), (0, 0.2, -1)))
    # gill flaps: three angled plates down each cheek guard
    for s in (1, -1):
        for k in range(3):
            c = on_skull(s * (1.05 + k * 0.12), -0.35 - k * 0.15, 0.012)
            p.add(fin, *box(c, (0.012, 0.035, 0.055), rot_y=s * (1.05 + k * 0.12), rot_z=s * 0.4))
    # barnacles on the crown and the back
    for a, t in ((0.9, 0.45), (1.6, 0.2), (2.3, 0.5), (-1.2, 0.35), (-2.0, 0.1), (2.9, 0.2), (-2.7, 0.55)):
        p.add(pearl, *ball(on_skull(a, t, 0.006), (0.012, 0.009, 0.012), 8, 4))
    p.add(glow, *ball(on_skull(0, 0.32, 0.012), 0.016, 10, 6))
    return p, {'hair': False, 'closed': False}


def ashforged_helm():
    """Ashforged: a heavy blackened bucket helm, its visor slit glowing like a forge, slag horns and glowing cracks."""
    p = Piece('helm')
    iron, rivet, slag = mat('ash_iron', 0x2a2521, rough=0.85, metal=0.4), mat('ash_rivet', 0x5a524a, rough=0.6, metal=0.5), mat('ash_slag', 0x3b302a, rough=0.95)
    ember = mat('ash_ember', 0xff6a1a, emit=2.5)
    r = Vector((SKULL_R.x * 1.08, SKULL_R.y * 1.1, SKULL_R.z * 1.08))
    v, f = shell(SKULL + Vector((0, -0.01, 0)), r, -1.0, 1.0, seg=12, rings=8, squash_top=0.75, bucket=1.0)  # few sides: hammered facets
    p.add(iron, *thicken(v, f, SKULL, 0.012), smooth=False)
    # the visor: a dark recess and a glowing slit across it
    p.add(slag, *box(on_skull(0, 0.08, 0.02), (0.15, 0.03, 0.02)))
    p.add(ember, *box(on_skull(0, 0.08, 0.03), (0.13, 0.012, 0.012)))
    for s in (1, -1):  # breathing holes under it
        for k in range(3):
            p.add(ember, *box(on_skull(s * (0.18 + k * 0.1), -0.35, 0.022), (0.008, 0.008, 0.01)))
    # rivets round the rim and the brow
    for i in range(14):
        a = 2 * math.pi * i / 14
        p.add(rivet, *ball(on_skull(a, -0.8, 0.014), 0.008, 6, 4))
        p.add(rivet, *ball(on_skull(a, 0.45, 0.012), 0.007, 6, 4))
    # slag horns: short, lumpy, a crack of fire in each
    for s in (1, -1):
        base = on_skull(s * 1.25, 0.55, 0.0)
        pts = arc(base, base + Vector((s * 0.07, 0.09, -0.02)), (s * 0.02, 0.01, 0), 6)
        p.add(slag, *tube(pts, [0.03, 0.028, 0.025, 0.02, 0.015, 0.009, 0.002], 7), smooth=False)
        p.add(ember, *box(base + Vector((s * 0.03, 0.04, 0.01)), (0.004, 0.05, 0.006), rot_z=-s * 0.5))
    # cracks across the shell
    for a, t, rz in ((0.7, 0.3, 0.6), (-0.9, 0.55, -0.4), (2.4, 0.2, 0.9), (-2.2, 0.4, -0.7)):
        p.add(ember, *box(on_skull(a, t, 0.022), (0.004, 0.045, 0.004), rot_y=a, rot_z=rz))
    return p, {'hair': False, 'closed': True}


def dragon_helm():
    """Dragon: a dragon's head - the upper jaw over the brow with teeth, horns swept back, a ridge of spikes."""
    p = Piece('helm')
    red, dark, bone, gold = mat('dragon_red', 0x7a1424, rough=0.5, metal=0.2), mat('dragon_dark', 0x4a0a14, rough=0.6), mat('dragon_bone', 0xdccaa2, rough=0.6), mat('dragon_gold', 0xc8962a, rough=0.35, metal=0.7)
    eye = mat('dragon_eye', 0xffb020, emit=1.5)
    v, f = shell(SKULL, SKULL_R * 1.04, -0.6, 1.0, cut=face_open(0.9, 0.12))
    p.add(red, *thicken(v, f, SKULL, 0.01))
    # the snout: a tapered wedge from the brow forward and down, nostrils on top
    snout = []
    for k in range(6):
        t = k / 5
        z = SKULL.z + SKULL_R.z * 0.8 + t * 0.12
        y = SKULL.y + 0.035 - t * 0.04
        w, h = 0.07 * (1 - t * 0.55), 0.035 * (1 - t * 0.5)
        snout.append([(-w, y - h * 0.3, z), (w, y - h * 0.3, z), (w * 0.8, y + h, z), (-w * 0.8, y + h, z)])
    verts = [Vector(q) for ring in snout for q in ring]
    faces = []
    for k in range(5):
        for j in range(4):
            a, b = k * 4 + j, k * 4 + (j + 1) % 4
            faces.append((a, b, b + 4, a + 4))
    faces += [(3, 2, 1, 0), (20, 21, 22, 23)]
    p.add(red, verts, faces, smooth=False)
    tip = Vector((0, snout[-1][0][1], snout[-1][0][2]))
    for s in (1, -1):
        p.add(dark, *ball(tip + Vector((s * 0.018, 0.03, -0.005)), 0.008, 6, 4))
        for k in range(3):  # teeth along the jaw's edge
            p.add(bone, *crystal(Vector((s * (0.02 + k * 0.018), snout[2 + k][0][1], snout[2 + k][0][2])), (0, -1, 0.1), 0.025, 0.005, 4), smooth=False)
        p.add(eye, *ball(on_skull(s * 0.42, 0.22, 0.012), (0.014, 0.008, 0.01), 8, 4))
        # horns from the temples, sweeping back and up
        base = on_skull(s * 1.0, 0.45, -0.005)
        pts = arc(base, base + Vector((s * 0.06, 0.12, -0.2)), (s * 0.03, 0.06, 0.0), 10)
        p.add(bone, *tube(pts, [0.026 - 0.0024 * i for i in range(11)], 8))
        for k in range(3):  # cheek scales
            p.add(dark, *box(on_skull(s * (1.1 + k * 0.18), -0.25 - k * 0.1, 0.014), (0.012, 0.04, 0.05), rot_y=s * (1.1 + k * 0.18), rot_x=0.3))
    for k in range(6):  # the ridge of spikes over the crown
        c = on_skull(math.pi * 0.0, 0.55 + k * 0.08, 0.0) if k < 2 else on_skull(math.pi, 1.35 - k * 0.12, 0.0)
        p.add(gold, *crystal(c, (0, 1, -0.4 if k >= 2 else 0.2), 0.05 - k * 0.004, 0.012, 4), smooth=False)
    return p, {'hair': False, 'closed': False}


def glacial_helm():
    """Glacial: a silver cap crowned with ice crystals, a frosted band over the brow and a fur trim."""
    p = Piece('helm')
    silver, fur = mat('ice_silver', 0xcfdce6, rough=0.3, metal=0.6), mat('ice_fur', 0xf2f2ee, rough=1.0)
    ice, frost = mat('ice_crystal', 0x8ed4f6, emit=0.6, rough=0.1), mat('ice_frost', 0xbfe8ff, emit=0.35, rough=0.2)
    v, f = shell(SKULL, SKULL_R * 1.02, -0.45, 1.0, cut=face_open(1.0, 0.1))
    p.add(silver, *thicken(v, f, SKULL, 0.008))
    band = [on_skull(2 * math.pi * i / 28, 0.15, 0.01) for i in range(29)]
    p.add(frost, *tube(band, [0.012] * 29, 6, cap=False))
    trim = [on_skull(1.05 + (2 * math.pi - 2.1) * i / 24, -0.45, 0.016) for i in range(25)]  # round the back, ear to ear
    p.add(fur, *tube(trim, [0.02 + 0.004 * math.sin(i * 2.7) for i in range(25)], 7))
    # the crown: crystals round the top, tallest at the front and back, leaning out
    for i in range(9):
        a = 2 * math.pi * i / 9
        base = on_skull(a, 0.62, -0.01)
        out = Vector((math.sin(a), 0, math.cos(a)))
        h = 0.07 + 0.06 * (0.5 + 0.5 * math.cos(2 * a))
        p.add(ice, *crystal(base, out * 0.35 + Vector((0, 1, 0)), h, 0.016), smooth=False)
        p.add(ice, *crystal(base + out * 0.012, out * 0.8 + Vector((0, 1, 0)), h * 0.5, 0.009), smooth=False)
    return p, {'hair': False, 'closed': False}


def emerald_helm():
    """Emerald: a slender elven helm, gold-trimmed, with leaf crests swept back like wings and a gem on the brow."""
    p = Piece('helm')
    green, gold, leafm = mat('em_green', 0x24704a, rough=0.4, metal=0.3), mat('em_gold', 0xd4a934, rough=0.3, metal=0.8), mat('em_leaf', 0x3a9a5a, rough=0.6)
    gem = mat('em_gem', 0x3aff9a, emit=1.0, rough=0.1)
    v, f = shell(SKULL, SKULL_R * 1.01, -0.3, 1.0, cut=face_open(1.05, 0.12), squash_top=1.05)
    p.add(green, *thicken(v, f, SKULL, 0.007))
    brow = [on_skull(2 * math.pi * i / 28, 0.12, 0.008) for i in range(29)]
    p.add(gold, *tube(brow, [0.007] * 29, 6, cap=False))
    ridge = [on_skull(0, 0.12 + i * 0.09, 0.008) for i in range(10)] + [on_skull(math.pi, 0.95 - i * 0.12, 0.008) for i in range(9)]
    p.add(gold, *tube(ridge, [0.006] * len(ridge), 6))
    # vines of gold over the sides
    for s in (1, -1):
        vine = [on_skull(s * (0.6 + 0.12 * i), 0.1 + 0.25 * math.sin(i * 0.9), 0.009) for i in range(12)]
        p.add(gold, *tube(vine, [0.004] * 12, 5))
        # the leaf wings: one long leaf and two shorter ones, swept back and up from the temples
        for k, (ln, wd, lift) in enumerate(((0.28, 0.06, 0.55), (0.21, 0.05, 0.25), (0.15, 0.04, 0.0))):
            base = on_skull(s * 1.25, 0.4 - k * 0.13, 0.0)
            back = Vector((s * 0.35, lift, -1)).normalized()
            p.add(leafm, *slab(leaf(ln, wd), 0.01, base, back, Vector((s * 0.9, 0.4, 0.1)).cross(back) * s))
    # the gem: a pointed jewel set in gold on the brow
    c = on_skull(0, 0.22, 0.012)
    p.add(gold, *ball(c, (0.024, 0.02, 0.01), 10, 4))
    p.add(gem, *crystal(c + Vector((0, -0.016, 0.008)), (0, 1, 0.15), 0.04, 0.012, 4), smooth=False)
    return p, {'hair': False, 'closed': False}


def infernal_helm():
    """Infernal: a demon's face - heavy brow, a spike for a nose, fangs, red-hot eyes - with great curling horns burning
    at the tips and a crest of flames."""
    p = Piece('helm')
    black, horn, bone = mat('inf_black', 0x1c1012, rough=0.55, metal=0.35), mat('inf_horn', 0x2e1614, rough=0.5), mat('inf_bone', 0xd8c4a0, rough=0.6)
    fire, core, eyes = mat('inf_fire', 0xff4a12, emit=2.2), mat('inf_core', 0xffc23a, emit=2.8), mat('inf_eyes', 0xff1a06, emit=4.0)
    v, f = shell(SKULL, SKULL_R * 1.06, -1.0, 1.0, seg=20, rings=10, bucket=0.85)
    p.add(black, *thicken(v, f, SKULL, 0.012))
    # the face: a heavy brow, slanted burning eyes under it, a nose spike, fangs along the jaw guard
    for s_ in (1, -1):
        brow = [on_skull(s_ * 0.05, 0.3, 0.018), on_skull(s_ * 0.35, 0.36, 0.022), on_skull(s_ * 0.62, 0.45, 0.012)]
        p.add(black, *tube(brow, [0.016, 0.014, 0.006], 6))
        p.add(eyes, *box(on_skull(s_ * 0.3, 0.17, 0.016), (0.06, 0.014, 0.012), rot_y=s_ * 0.3, rot_z=-s_ * 0.35))
        for k in range(2):
            p.add(bone, *crystal(on_skull(s_ * (0.12 + k * 0.14), -0.62, 0.016), (0, -1, 0.25), 0.04 - k * 0.01, 0.008, 4), smooth=False)
    p.add(black, *crystal(on_skull(0, 0.12, 0.012), (0, -0.55, 1), 0.06, 0.016, 4), smooth=False)
    # horns: out from the sides, sweeping up and curling forward; the last stretch burns
    for s_ in (1, -1):
        base = on_skull(s_ * 1.3, 0.5, -0.01)
        pts = [base, base + Vector((s_ * 0.07, 0.03, -0.02)), base + Vector((s_ * 0.13, 0.1, -0.05)), base + Vector((s_ * 0.16, 0.19, -0.04)),
               base + Vector((s_ * 0.15, 0.27, 0.01))]
        p.add(horn, *tube(pts, [0.04, 0.035, 0.029, 0.022, 0.015], 9))
        tip = [pts[-1], base + Vector((s_ * 0.12, 0.32, 0.07)), base + Vector((s_ * 0.08, 0.33, 0.12))]
        p.add(fire, *tube(tip, [0.015, 0.009, 0.002], 8))
    # the crest: flames along the crown, tallest in the middle, a hotter core inside each
    for k, (t, h, w) in enumerate(((0.75, 0.1, 0.03), (0.9, 0.17, 0.045), (1.0, 0.21, 0.05), (0.9, 0.16, 0.042), (0.72, 0.1, 0.03))):
        a = 0 if k < 2 else math.pi
        tt = t if k != 2 else 0.99
        base = on_skull(a, tt, -0.015) if k != 2 else on_skull(0, 1.0, -0.02)
        p.add(fire, *slab(flame(h, w), 0.012, base, (0, 0, -1), (0, 1, 0.1 * (2 - k))))
        p.add(core, *slab(flame(h * 0.55, w * 0.5), 0.016, base + Vector((0, 0.005, 0)), (0, 0, -1), (0, 1, 0.1 * (2 - k))))
    return p, {'hair': False, 'closed': True}


SETS = {
    'apprentice': {'helm': leather_cap},
    'abyssal': {'helm': abyssal_helm},
    'ashforged': {'helm': ashforged_helm},
    'dragon': {'helm': dragon_helm},
    'glacial': {'helm': glacial_helm},
    'emerald': {'helm': emerald_helm},
    'infernal': {'helm': infernal_helm},
}


def export(set_id, pieces):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _mats.clear()
    objs = []
    for name, fn in pieces.items():
        piece, _info = fn()
        objs.append(piece.build())
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{set_id}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT')
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    print(f'[gear] {set_id}: {", ".join(pieces)} -> {path} ({tris} tris, {os.path.getsize(path) // 1024} KB)')


for set_id, pieces in SETS.items():
    export(set_id, pieces)
