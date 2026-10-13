"""
Gathering tools for the game from Quaternius' Fantasy Props MegaKit (CC0): the woodcutter's axe and the
miner's pickaxe, written to client/public/q as <item id>.glb in the convention of the other weapons there
(client/src/render/quaternius.ts): Y up, the grip at the origin, the head up, an axe's edge toward +X.

    blender --background --python tools/art/blender/tools_props.py -- [kit_dir] [out_dir]

kit_dir defaults to ../Fantasy Props MegaKit[Standard] next to the repo. Only the base colour survives
(the game shades with Lambert), its atlas cut down to 512 px. tools/scripts/q-assets.mjs meshopt-compresses
every .glb in client/public/q afterwards, or run `npx @gltf-transform/cli meshopt` on these two.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
KIT = argv[0] if len(argv) > 0 and argv[0] else os.path.join(REPO, '..', 'Fantasy Props MegaKit[Standard]')
OUT = argv[1] if len(argv) > 1 else os.path.join(REPO, 'client', 'public', 'q')

# item id: (kit model, total length in metres, turn about the vertical so the edge faces +X)
TOOLS = {
    'woodcutter_axe': ('Axe_Bronze', 0.82, math.pi),
    'miner_pickaxe': ('Pickaxe_Bronze', 0.92, 0.0),
}
GRIP = 0.2  # the hand holds the handle this far up from its butt (share of the length)
TEX = 512


def build(item, model, length, turn):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, 'Exports', 'glTF', model + '.gltf'))
    obj = next(o for o in bpy.data.objects if o.type == 'MESH')
    # bake the node's rotation and scale into the vertices, then work in world space
    me = obj.data
    me.transform(obj.matrix_world)
    obj.parent = None
    obj.matrix_world = Matrix.Identity(4)
    for o in [o for o in bpy.data.objects if o is not obj]:
        bpy.data.objects.remove(o)
    me.transform(Matrix.Rotation(turn, 4, 'Z'))
    zs = [v.co.z for v in me.vertices]
    z0, z1 = min(zs), max(zs)
    me.transform(Matrix.Scale(length / (z1 - z0), 4))
    z0 *= length / (z1 - z0)
    # the handle's centre: the middle of the vertices in its lower third (the head sits off to one side)
    low = [v.co for v in me.vertices if v.co.z < z0 + length * 0.3]
    cx, cy = sum(c.x for c in low) / len(low), sum(c.y for c in low) / len(low)
    me.transform(Matrix.Translation(Vector((-cx, -cy, -(z0 + length * GRIP)))))
    # base colour only, at 512 px; drop the vertex colours (the kit's masks, unused by our materials)
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    src = me.materials[0]
    img = next(n.image for n in src.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image and 'BaseColor' in n.image.name)
    img.scale(TEX, TEX)
    mat = bpy.data.materials.new(item)
    mat.use_nodes = True
    nt = mat.node_tree
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    bsdf = nt.nodes['Principled BSDF']
    nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.8
    me.materials[0] = mat
    obj.name = item
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, item + '.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_yup=True, export_image_format='WEBP',
                              export_materials='EXPORT', export_normals=True, export_texcoords=True, export_extras=False)
    print('EXPORTED', out, os.path.getsize(out))


for item, (model, length, turn) in TOOLS.items():
    build(item, model, length, turn)
