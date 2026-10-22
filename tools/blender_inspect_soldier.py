import bpy
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "soldier.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

report = {"objects": [], "actions": [], "materials": []}
print("KYX_BLENDER_INSPECT_BEGIN")
for obj in bpy.context.scene.objects:
    print(
        "OBJECT",
        obj.name,
        obj.type,
        "loc=", tuple(round(v, 4) for v in obj.location),
        "dim=", tuple(round(v, 4) for v in obj.dimensions),
    )
    item = {
        "name": obj.name,
        "type": obj.type,
        "location": [round(v, 5) for v in obj.location],
        "dimensions": [round(v, 5) for v in obj.dimensions],
    }
    if obj.type == "ARMATURE":
        print("BONES", ",".join(b.name for b in obj.data.bones))
        item["bones"] = [b.name for b in obj.data.bones]
    report["objects"].append(item)

print("ACTIONS", ",".join(action.name for action in bpy.data.actions))
print("MATERIALS", ",".join(mat.name for mat in bpy.data.materials))
report["actions"] = [action.name for action in bpy.data.actions]
report["materials"] = [mat.name for mat in bpy.data.materials]
(ROOT / "artifacts").mkdir(exist_ok=True)
(ROOT / "artifacts" / "blender-soldier-inspect.json").write_text(
    json.dumps(report, indent=2), encoding="utf-8"
)
print("KYX_BLENDER_INSPECT_END")
