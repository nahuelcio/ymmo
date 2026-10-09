"""
Builds the playable character models from Quaternius' "Universal Base Characters" (CC0)
and exports them to client/public/models/characters.glb.

    blender --background --python art/blender/characters.py -- [assets_dir] [out.glb] [preview.png]

assets_dir defaults to ../3d next to the repo (the unzipped kit: "Base Characters/",
"Hairstyles/"). For each gender the script:

  * imports the skinned base body (12k tris, full UE-style skeleton) and drops the arms
    from T-pose to the game's arms-down rest pose;
  * adds tintable clothing shells (top, bottom, boots, gloves, belt) cut from the body
    and pushed out along the normals, so they stay skinned to the same bones;
  * adds race features: `elf_ears` / `orc_ears` shape keys and tusk meshes;
  * fits the kit's hairstyles and beard to the head bone (hair0/1/2 = Corto/Largo/Rodete,
    plus `buzz` and `beard`);
  * adds socket empties on the bones (sock_head, sock_torso, sock_hand_l/r, ...) where the
    client hangs weapons and procedural armour;
  * swaps the skin texture for the light one, neutralised so the client can tint it per race,
    and drops normal/roughness maps (the game uses Lambert shading).

Nodes are named `<g>__<part>` (g = m | f); material names are colour roles
(skin, eyes, hair1, hair2, top, bottom, boots, gloves, belt, ivory).
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ASSETS = argv[0] if len(argv) > 0 and argv[0] else os.path.join(REPO, '..', '3d')
OUT = argv[1] if len(argv) > 1 else os.path.join(REPO, 'client', 'public', 'models', 'characters.glb')
PREVIEW = argv[2] if len(argv) > 2 else None

BASE = os.path.join(ASSETS, 'Base Characters', 'Godot - UE')
TEX = os.path.join(ASSETS, 'Base Characters', 'Textures')
HAIR = os.path.join(ASSETS, 'Hairstyles', 'Rigged to Head Bone', 'glTF (Godot -Unreal)')

GENDERS = {
    'm': dict(body='Superhero_Male_FullBody.gltf', skin='T_Superhero_Male_Ligh.png',
              hair={'hair0': 'Hair_SimpleParted', 'hair1': 'Hair_Long', 'hair2': 'Hair_Buns', 'buzz': 'Hair_Buzzed', 'beard': 'Hair_Beard'}),
    'f': dict(body='Superhero_Female_FullBody.gltf', skin='T_Superhero_Female_Light_BaseColor.png',
              hair={'hair0': 'Hair_BuzzedFemale', 'hair1': 'Hair_Long', 'hair2': 'Hair_Buns'}),
}
ARM_DROP = math.radians(76)  # T-pose -> arms down, leaving a little room for the hips


# ---------------------------------------------------------------- helpers

def import_gltf(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in [o for o in new if o.name.startswith('Icosphere')]:  # the kit ships a stray sphere
        new.remove(o)
        bpy.data.objects.remove(o)
    return new


def activate(o):
    for x in bpy.context.scene.objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = o
    o.select_set(True)


def attach(o, arm, bone, mw=None):
    """Parent to a bone, keeping the object where it is in the world (or placing it at mw)."""
    bpy.context.view_layer.update()
    mw = mw or o.matrix_world.copy()
    o.parent = arm
    o.parent_type = 'BONE'
    o.parent_bone = bone
    bpy.context.view_layer.update()
    o.matrix_world = mw


def material(name, color=(1, 1, 1)):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.85
    m.diffuse_color = (*color, 1)
    return m


def strip_maps(m):
    """Drop normal/roughness/metal textures; the game shades with Lambert + base colour only."""
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    for inp in bsdf.inputs:
        if inp.name != 'Base Color':
            for link in list(inp.links):
                nt.links.remove(link)
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Metallic'].default_value = 0.0
    for n in list(nt.nodes):
        if n.type == 'NORMAL_MAP' or (n.type == 'TEX_IMAGE' and not n.outputs[0].links):
            nt.nodes.remove(n)


def base_tex(m):
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    src = bsdf.inputs['Base Color'].links[0].from_node
    while src.type != 'TEX_IMAGE':
        src = next(i for i in src.inputs if i.links).links[0].from_node
    return src


def neutralise(img, size, target=0.88, mask_lum=0.3):
    """Resize and divide out the average hue so the client can tint by multiplication."""
    img.scale(size, size)
    a = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
    rgb = a[:, :, :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    mean = rgb[lum > mask_lum].mean(axis=0)
    a[:, :, :3] = np.clip(rgb * (target / mean), 0, 1)
    img.pixels[:] = a.ravel()
    img.pack()


def dominant_groups(obj):
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    for v in obj.data.vertices:
        best = max(v.groups, key=lambda g: g.weight, default=None)
        out.append(names[best.group] if best else None)
    return out


# ---------------------------------------------------------------- per gender

def build(g):
    G = GENDERS[g]
    objs = import_gltf(os.path.join(BASE, G['body']))
    arm = next(o for o in objs if o.type == 'ARMATURE')
    arm.name = arm.data.name = {'m': 'male', 'f': 'female'}[g]
    meshes = [o for o in objs if o.type == 'MESH']
    body = max(meshes, key=lambda o: len(o.data.polygons))
    eyes = next(o for o in meshes if o.name.startswith('Eyes'))
    brows = next(o for o in meshes if o.name.startswith('Eyebrows'))
    body.name, eyes.name, brows.name = f'{g}__body', f'{g}__eyes', f'{g}__brows'
    bones = arm.data.bones
    B = lambda n: bones[n].head_local.copy()

    # --- materials: tintable skin, plain eyes, tintable hair
    skin_mat = body.data.materials[0]
    skin_mat.name = 'skin'
    strip_maps(skin_mat)
    tex = base_tex(skin_mat)
    tex.image = bpy.data.images.load(os.path.join(TEX, G['skin']))
    tex.image.name = f'{g}_skin'
    neutralise(tex.image, 1024)
    eyes.data.materials[0].name = 'eyes'
    strip_maps(eyes.data.materials[0])
    eimg = base_tex(eyes.data.materials[0]).image
    if eimg.size[0] > 256:
        eimg.scale(256, 256)
        eimg.pack()
    hair_mats = {}

    def hair_mat(m):
        key = 'hair2' if 'Hair_2' in m.name else 'hair1'
        if key not in hair_mats:
            strip_maps(m)
            img = base_tex(m).image
            if not img.get('neutral'):
                neutralise(img, 512, target=0.8, mask_lum=0.05)
                img['neutral'] = True
            hair_mats[key] = material(key)
            nt = hair_mats[key].node_tree
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = img
            nt.links.new(t.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
        return hair_mats[key]
    brows.data.materials[0] = hair_mat(brows.data.materials[0])

    # --- clothing shells (cut in T-pose, where arms are easy to tell apart)
    waist = (B('pelvis').z + B('spine_01').z) / 2 + 0.02
    neck = B('neck_01').z - 0.01
    boot_top = B('foot_l').z + (B('calf_l').z - B('foot_l').z) * 0.55
    sleeve = B('upperarm_l').x + 0.12
    glove = B('hand_l').x - 0.045
    dom = dominant_groups(body)
    regions = {'top': [], 'bottom': [], 'boots': [], 'gloves': [], 'belt': []}
    for p in body.data.polygons:
        c = p.center
        ax = abs(c.x)
        if c.z >= neck or any(dom[i] == 'Head' for i in p.vertices):
            continue
        if ax >= glove:
            regions['gloves'].append(p.index)
        elif ax < 0.3 and c.z < boot_top:
            regions['boots'].append(p.index)
        elif ax < 0.3 and c.z < waist + 0.012:
            regions['bottom'].append(p.index)
            if c.z > waist - 0.045:
                regions['belt'].append(p.index)
        elif c.z < neck and ax < sleeve:
            regions['top'].append(p.index)
    thick = {'top': 0.0065, 'bottom': 0.005, 'boots': 0.011, 'gloves': 0.004, 'belt': 0.012}
    shells = []
    for role, faces in regions.items():
        o = body.copy()
        o.data = body.data.copy()
        o.name = f'{g}__{role}'
        bpy.context.scene.collection.objects.link(o)
        bm = bmesh.new()
        bm.from_mesh(o.data)
        keep = set(faces)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in keep], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.normal_update()
        for v in bm.verts:
            v.co += v.normal * thick[role]
        bm.to_mesh(o.data)
        bm.free()
        o.data.materials.clear()
        o.data.materials.append(material(role, (0.3, 0.2, 0.1) if role == 'belt' else (0.7, 0.6, 0.45)))
        shells.append(o)

    # --- arms down: pose, bake the pose into every skinned mesh, make it the rest pose
    activate(arm)
    bpy.ops.object.mode_set(mode='POSE')
    for side, sign in (('l', 1), ('r', -1)):
        pb = arm.pose.bones[f'upperarm_{side}']
        h = arm.data.bones[pb.name].head_local
        pb.matrix = Matrix.Translation(h) @ Matrix.Rotation(sign * ARM_DROP, 4, 'Y') @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()
    bpy.ops.object.mode_set(mode='OBJECT')
    skinned = [body, eyes, brows, *shells]
    for o in skinned:
        activate(o)
        mod = next(m for m in o.modifiers if m.type == 'ARMATURE')
        bpy.ops.object.modifier_apply(modifier=mod.name)
    activate(arm)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in skinned:
        o.modifiers.new('Armature', 'ARMATURE').object = arm

    # --- head landmarks
    hb = B('Head')
    ev = [eyes.matrix_world @ v.co for v in eyes.data.vertices]
    eye_z = sum(v.z for v in ev) / len(ev)
    head_v = [body.data.vertices[i].co.copy() for i, d in enumerate(dom) if d == 'Head']
    head_c = Vector((0, sum(v.y for v in head_v) / len(head_v), eye_z + 0.005))

    def front_y(z, x=0.0):
        near = [v.y for v in head_v if abs(v.z - z) < 0.006 and abs(v.x - x) < 0.012]
        return min(near) if near else head_c.y - 0.1

    # --- ears: shape keys that pull the ear tips up and back
    ear_v = [(i, body.data.vertices[i].co.copy()) for i, d in enumerate(dom) if d == 'Head' and abs(body.data.vertices[i].co.z - eye_z) < 0.06]
    ear_x = max(abs(co.x) for _, co in ear_v)
    tip = next(co for _, co in ear_v if abs(co.x) == ear_x)
    body.shape_key_add(name='Basis')
    for name, k in (('elf_ears', 1.0), ('orc_ears', 0.55)):
        sk = body.shape_key_add(name=name)
        sk.value = 0.0
        for i, co in ear_v:
            t = (abs(co.x) - (ear_x - 0.02)) / 0.02
            if t <= 0 or abs(co.y - tip.y) > 0.045:
                continue
            t = min(t, 1.0) ** 1.4
            u = max((co.z - (tip.z - 0.03)) / 0.06, 0.0)  # the upper ear stretches most
            sx = 1 if co.x > 0 else -1
            sk.data[i].co = co + Vector((sx * 0.022 * t * u, 0.035 * t * u, 0.065 * t * u)) * k

    # --- tusks (orc): small cones from the lower jaw
    mouth_z = eye_z - 0.068
    tusk_mesh = bpy.data.meshes.new(f'{g}__tusks')
    bm = bmesh.new()
    for sx in (-1, 1):
        base = Vector((sx * 0.022, front_y(mouth_z - 0.012, sx * 0.02) + 0.012, mouth_z - 0.014))
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.0075, radius2=0.0012, depth=0.042)
        m = Matrix.Translation(base + Vector((sx * 0.004, -0.008, 0.019))) @ Matrix.Rotation(math.radians(-25), 4, 'X') @ Matrix.Rotation(sx * math.radians(-12), 4, 'Y')
        bmesh.ops.transform(bm, matrix=m, verts=r['verts'])
    bm.to_mesh(tusk_mesh)
    bm.free()
    tusk_mesh.materials.append(material('ivory', (0.94, 0.92, 0.84)))
    tusks = bpy.data.objects.new(f'{g}__tusks', tusk_mesh)
    bpy.context.scene.collection.objects.link(tusks)
    attach(tusks, arm, 'Head')

    # --- hair, moved from whichever head it was made for onto this one
    for slot, src in G['hair'].items():
        new = import_gltf(os.path.join(HAIR, src + '.gltf'))
        src_arm = next(o for o in new if o.type == 'ARMATURE')
        h = next(o for o in new if o.type == 'MESH')
        delta = hb - src_arm.data.bones['Head'].head_local
        mw = h.matrix_world.copy()
        h.parent = None
        h.matrix_world = Matrix.Translation(delta) @ mw
        for mod in list(h.modifiers):
            h.modifiers.remove(mod)
        h.vertex_groups.clear()
        h.data.materials[0] = hair_mat(h.data.materials[0])
        h.name = f'{g}__{slot}'
        attach(h, arm, 'Head')
        bpy.data.objects.remove(src_arm)

    # --- sockets where the client hangs gear (axes aligned with the body, like the old rig groups)
    sh = B('upperarm_l')
    sockets = {
        'sock_head': ('Head', head_c),
        'sock_torso': ('spine_01', Vector((0, B('pelvis').y, sh.z - 0.56))),
        'sock_leg_l': ('thigh_l', B('thigh_l')), 'sock_leg_r': ('thigh_r', B('thigh_r')),
        'sock_arm_l': ('upperarm_l', sh), 'sock_arm_r': ('upperarm_r', B('upperarm_r')),
    }
    for side in ('l', 'r'):
        hd = arm.data.bones[f'hand_{side}']
        sockets[f'sock_hand_{side}'] = (hd.name, hd.head_local + (hd.tail_local - hd.head_local).normalized() * 0.075 + Vector((0, -0.01, 0)))
    for name, (bone, loc) in sockets.items():
        e = bpy.data.objects.new(f'{g}__{name}', None)
        e.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(e)
        attach(e, arm, bone, Matrix.Translation(loc))

    # glTF loaders dedupe node names across the file, so give each skeleton its own bone names
    for b in arm.data.bones:
        b.name = f'{g}_{b.name}'
    return arm


# ---------------------------------------------------------------- preview

def render_preview(path, arms):
    scene = bpy.context.scene
    for a in arms:
        g = a.name[0]
        a.location.x = -0.55 if g == 'm' else 0.55
        for o in a.children_recursive:
            if o.type != 'MESH':
                continue
            n = o.name.split('__')[1]
            o.hide_render = n in ('hair0', 'hair2', 'buzz', 'gloves') if g == 'm' else n in ('hair0', 'hair2', 'tusks', 'gloves')
            if o.data.shape_keys and g == 'f':
                o.data.shape_keys.key_blocks['elf_ears'].value = 1.0
            if n == 'hair1' and g == 'm':
                o.hide_render = True
            if n == 'buzz':
                o.hide_render = False
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'TEXTURE'
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 1400, 1100
    scene.world = bpy.data.worlds.new('w')
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.3
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -6, 0.93)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    arms = [build('m'), build('f')]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                              export_morph=True, export_morph_normal=False, export_animations=False, export_texcoords=True,
                              export_normals=True, export_tangents=False, export_image_format='JPEG', export_jpeg_quality=85,
                              export_extras=False)
    print('EXPORTED', OUT, os.path.getsize(OUT))
    if PREVIEW:
        render_preview(PREVIEW, arms)
        print('PREVIEW', PREVIEW)


main()
