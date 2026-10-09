# Export one nature .blend to a separate glTF (albedo stays external).
#   blender --background Model.blend --python tools/scripts/export-nature-blend.py -- out.gltf
import sys

import bpy

out = sys.argv[sys.argv.index("--") + 1]
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLTF_SEPARATE",
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
)
