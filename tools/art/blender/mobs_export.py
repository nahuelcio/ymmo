# Exports one creature from a .blend to .glb with its rig and every action, for tools/scripts/m-assets.mjs.
# Usage: blender -b --python tools/art/blender/mobs_export.py -- <in.blend> <out.glb> <mesh object name> [image dir]
# Keeps only that mesh and the armature it deforms with (cameras, lights, ground planes and helpers go), resolves
# missing external images from [image dir], applies the non-armature modifiers and writes all actions as clips.
import os
import sys

import bpy

args = sys.argv[sys.argv.index('--') + 1:]
src, out, mesh_name = args[0], args[1], args[2]
img_dir = args[3] if len(args) > 3 else os.path.dirname(src)

bpy.ops.wm.open_mainfile(filepath=src)
mesh = bpy.data.objects[mesh_name]
arm = mesh.parent if mesh.parent and mesh.parent.type == 'ARMATURE' else next(
    (m.object for m in mesh.modifiers if m.type == 'ARMATURE' and m.object), None)
keep = {mesh, arm} - {None}
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

# external textures that did not travel with the .blend: look for a file of the same name next to it
for img in bpy.data.images:
    if img.packed_file or not img.filepath or img.has_data:
        continue
    name = os.path.basename(bpy.path.abspath(img.filepath).replace('\\', '/'))
    cand = os.path.join(img_dir, name)
    if os.path.exists(cand):
        img.filepath = cand
        img.reload()
        print('image', name, '->', cand)

# Old files (Blender Internal materials) keep their images but lose the texture slots that used them: give such
# a material a node tree with the diffuse image (the largest one that is not a normal, specular, AO, emission or render map).
def diffuse_image():
    imgs = [i for i in bpy.data.images if (i.packed_file or i.has_data or os.path.exists(bpy.path.abspath(i.filepath)))
            and not any(k in i.name.lower() for k in ('nor', 'emit', 'render', 'helper', 'spec', 'ao-', 'ao_', '-ao', 'dieing'))]
    for i in imgs:
        try:
            i.reload() if not i.packed_file else None
        except RuntimeError:
            pass
    imgs = [i for i in imgs if i.size[0] > 0]
    return max(imgs, key=lambda i: i.size[0] * i.size[1], default=None)


for slot in mesh.material_slots:
    m = slot.material
    if not m:
        continue
    has_tex = m.use_nodes and m.node_tree and any(n.type == 'TEX_IMAGE' and n.image for n in m.node_tree.nodes)
    img = None if has_tex else diffuse_image()
    if img:
        m.use_nodes = True
        nt = m.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None) or nt.nodes.new('ShaderNodeBsdfPrincipled')
        out_node = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None) or nt.nodes.new('ShaderNodeOutputMaterial')
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(bsdf.outputs['BSDF'], out_node.inputs['Surface'])
        print('material', m.name, '<- image', img.name)

# every action as its own clip (they are matched to the armature by bone names)
if arm:
    arm.animation_data_create()
    for a in bpy.data.actions:
        a.use_fake_user = True

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=False,
    export_apply=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_yup=True,
)
print('exported', out, 'actions', [a.name for a in bpy.data.actions])
