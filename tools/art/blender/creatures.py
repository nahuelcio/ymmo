"""
Builds the werewolf and the yeti mobs from two Sketchfab models (CC BY 4.0, see client/public/m/CREDITS.txt), for
tools/scripts/m-assets.mjs:

    blender -b --python tools/art/blender/creatures.py -- <werewolf_anims.glb> <yeti scene.gltf> <out dir>

<werewolf_anims.glb> is silvercrow101's werewolf with the moves it lacks (run, attack, death) retargeted onto its
Mixamo skeleton by tools/scripts/creature-anims.mjs. The script:

  * werewolf: keeps its full body (the scene also holds an icosphere and two overlapping copies of the body), cuts it to
    about 10k triangles (the skin weights go along), and splits it into three tintable materials - Fur, Belly (the
    front of the trunk) and Claws (finger and toe tips) - since it comes untextured; its idle becomes `Idle`;
  * yeti: orioltron's T-posed yeti (no rig), joined with its eyes, set to the werewolf's height, the skeleton's arms
    stretched or shrunk to its arm span, and bound to that skeleton's body bones by distance (Blender's bone heat fails
    on its fur), so it moves with the werewolf's clips;

and writes <out dir>/werewolf_sf.glb and <out dir>/yeti_sf.glb, each with Idle, Run, Attack and Death.
"""
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
WEREWOLF, YETI, OUT = args[0], args[1], args[2]
TRIS = 10000
CLIPS = {'Action': 'Idle', 'Run': 'Run', 'Attack': 'Attack', 'Death': 'Death'}

bpy.ops.wm.read_factory_settings(use_empty=True)


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def bbox(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def material(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    return m


# --- the werewolf
bpy.ops.import_scene.gltf(filepath=WEREWOLF)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
body = max(meshes, key=lambda o: (o.dimensions.z, len(o.data.polygons)))  # the full body, its head included
for o in meshes:
    if o is not body:
        bpy.data.objects.remove(o, do_unlink=True)
body.name = 'Werewolf'

select_only([body])
dec = body.modifiers.new('cut', 'DECIMATE')
dec.ratio = min(1.0, TRIS / len(body.data.polygons))
bpy.ops.object.modifier_move_to_index(modifier='cut', index=0)
bpy.ops.object.modifier_apply(modifier='cut')

# three tintable materials, by the bone each face moves with and the way it faces (the model looks down -Y)
fur, belly, claws = material('Fur', (0.42, 0.38, 0.34)), material('Belly', (0.7, 0.66, 0.6)), material('Claws', (0.12, 0.1, 0.1))
body.data.materials.clear()
for m in (fur, belly, claws):
    body.data.materials.append(m)
group = {g.index: g.name for g in body.vertex_groups}
TRUNK = ('Hips', 'Spine', 'Spine1', 'Spine2')
TIPS = ('Thumb3', 'Thumb4', 'Index3', 'Index4', 'Middle3', 'Middle4', 'Ring3', 'Ring4', 'Pinky3', 'Pinky4', 'ToeBase', 'Toe_End')


def bone_of(v):
    g = max(v.groups, key=lambda e: e.weight, default=None)
    return group.get(g.group, '') if g else ''


def is_(name, parts):
    n = name.split(':')[-1].rsplit('_', 1)[0]  # mixamorig:LeftHandIndex3_29 -> LeftHandIndex3
    return any(n.endswith(p) for p in parts) if parts is TIPS else n in parts


verts = body.data.vertices
for p in body.data.polygons:
    bones = [bone_of(verts[i]) for i in p.vertices]
    if sum(is_(b, TIPS) for b in bones) >= 2:
        p.material_index = 2
    elif sum(is_(b, TRUNK) for b in bones) >= 2 and (body.matrix_world.to_3x3() @ p.normal).normalized().y < -0.45:
        p.material_index = 1
    else:
        p.material_index = 0

# The rig's controls and helpers go (two thirds of its 169 bones, keyed in every clip): only the Mixamo bones, the ones
# the skin uses and their ancestors stay.
weighted = {group[e.group] for v in body.data.vertices for e in v.groups if e.weight > 0.001}
keep = set()
for b in arm.data.bones:
    if b.name.startswith('mixamorig:') or b.name in weighted:
        keep.update([b.name] + [p.name for p in b.parent_recursive])
select_only([arm])
bpy.ops.object.mode_set(mode='EDIT')
for eb in list(arm.data.edit_bones):
    if eb.name not in keep:
        arm.data.edit_bones.remove(eb)
bpy.ops.object.mode_set(mode='OBJECT')
for g in list(body.vertex_groups):
    if g.name not in keep:
        body.vertex_groups.remove(g)

# its clips: the idle, run, attack and death; the second idle and the bind pose go
for a in list(bpy.data.actions):
    if a.name in CLIPS:
        a.name = CLIPS[a.name]
    else:
        bpy.data.actions.remove(a)


def export(path, mesh):
    select_only([mesh, arm], arm)
    for o in bpy.data.objects:
        if o.type == 'EMPTY' and o.children:
            o.select_set(True)  # the Sketchfab root nodes the armature hangs from
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_skins=True, export_morph=False, export_apply=False)


os.makedirs(OUT, exist_ok=True)
export(os.path.join(OUT, 'werewolf_sf.glb'), body)
ww_lo, ww_hi = bbox([body])

# --- the yeti, on the werewolf's skeleton
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=YETI)
parts = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
select_only(parts)
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.join()
yeti = bpy.context.view_layer.objects.active
yeti.name = 'Yeti'
for o in list(bpy.data.objects):
    if o not in before and o is not yeti:
        bpy.data.objects.remove(o, do_unlink=True)

# the werewolf's height, feet on the ground, centred under the skeleton's hips
lo, hi = bbox([yeti])
k = (ww_hi.z - ww_lo.z) / (hi.z - lo.z)
hips = next(b for b in arm.data.bones if b.name.startswith('mixamorig:Hips'))
hx, hy = (arm.matrix_world @ hips.head_local).xy
yeti.location = (hx - (lo.x + hi.x) / 2 * k, hy - (lo.y + hi.y) / 2 * k, ww_lo.z - lo.z * k)
yeti.scale = (k, k, k)
select_only([yeti])
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# the skeleton's arms to its arm span (in the bind pose, the arms along X)
lo, hi = bbox([yeti])
kx = (hi.x - lo.x) / (ww_hi.x - ww_lo.x)
arm.data.pose_position = 'REST'
select_only([arm])
bpy.ops.object.mode_set(mode='EDIT')
inv = arm.matrix_world.inverted()
for eb in arm.data.edit_bones:
    for end in ('head', 'tail'):
        w = arm.matrix_world @ getattr(eb, end)
        w.x = hx + (w.x - hx) * kx
        setattr(eb, end, inv @ w)
bpy.ops.object.mode_set(mode='OBJECT')
arm.data.pose_position = 'POSE'

# Bound by distance: each vertex to its nearest two or three body bones, weighted by the inverse of the distance to
# the fourth, then smoothed. Blender's bone heat fails on the fur's loose strands. Not the fingers, the rig's controls
# or the collarbones (which would fold the chest as the arms come down from the T-pose).
BODY = {'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'} | {f'{s}{p}' for s in ('Left', 'Right')
                                                                  for p in ('Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot', 'ToeBase')}
segs = []
for b in arm.data.bones:
    n = b.name.split(':')[-1].rsplit('_', 1)[0]
    if b.name.startswith('mixamorig:') and n in BODY:
        segs.append((b.name, arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local))


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


groups = {name: yeti.vertex_groups.new(name=name) for name, _, _ in segs}
for v in yeti.data.vertices:
    p = yeti.matrix_world @ v.co
    near = sorted((seg_dist(p, a, b), name) for name, a, b in segs)[:3]
    d0 = near[0][0]
    picks = [(d, n) for d, n in near if d <= d0 * 1.6 + 0.02]
    ws = [1 / (d + 0.01) ** 4 for d, _ in picks]
    for (d, n), w in zip(picks, ws):
        groups[n].add([v.index], w / sum(ws), 'REPLACE')
select_only([yeti])
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=4)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.data.objects.remove(body, do_unlink=True)
mod = yeti.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
world = yeti.matrix_world.copy()
yeti.parent = arm
yeti.matrix_world = world
export(os.path.join(OUT, 'yeti_sf.glb'), yeti)
print('[creatures] werewolf', len(bpy.data.objects), 'yeti fit', round(k, 4), 'arm span', round(kx, 3))
