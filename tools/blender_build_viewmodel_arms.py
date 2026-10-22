"""Bake the actual KYX player arms into a lightweight first-person asset.

Run with Blender from the repository root:
  blender --background artifacts/kyx-player/kyx-warrior.blend \
    --python tools/blender_build_viewmodel_arms.py

The viewmodel must not grow a second, unrelated character design.  This script
samples the same skinned mannequin and armour pieces used by the live player,
keeps only each arm's weighted vertices, bakes the authored GunIdle hand pose,
and centres each side on its wrist for runtime grip placement.
"""

from pathlib import Path
import bmesh
import bpy
from mathutils import Matrix


ROOT = Path(bpy.path.abspath("//")).parents[1]
OUT = ROOT / "public" / "kyx-view-arms.glb"

ARMATURE_NAME = "KYX_Warrior_Rig"
BODY_NAME = "KYX_Undersuit_Mannequin"
POSE_ACTION = "GunIdle"
POSE_FRAME = 20


def reset_pose(armature):
    for bone in armature.pose.bones:
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_mode = "QUATERNION"
        bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        bone.scale = (1.0, 1.0, 1.0)


def arm_group_names(side, part):
    prefix = f"mixamorig{side}"
    if part == "hand":
        return {
            name
            for name in bpy.data.objects[BODY_NAME].vertex_groups.keys()
            if name.startswith(f"{prefix}Hand")
        }
    # Keep the real elbow and upper sleeve. Cutting at the elbow required a
    # procedural cylinder extension in-game, which did not match the body.
    # Exclude shoulder/chest weights so no torso can enter the viewmodel.
    return {f"{prefix}ForeArm", f"{prefix}Arm"}


def isolate_weighted_part(source, side, part):
    obj = source.copy()
    obj.data = source.data.copy()
    obj.name = f"KYX_View{side}_{part.title()}Source"
    bpy.context.scene.collection.objects.link(obj)

    allowed = arm_group_names(side, part)
    allowed_indices = {g.index for g in obj.vertex_groups if g.name in allowed}
    keep = set()
    for vertex in obj.data.vertices:
        arm_weight = sum(g.weight for g in vertex.groups if g.group in allowed_indices)
        if arm_weight >= 0.24:
            keep.add(vertex.index)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(
        bm,
        geom=[v for v in bm.verts if v.index not in keep],
        context="VERTS",
    )
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def freeze_object(source, wrist_world, name):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(
        evaluated, preserve_all_data_layers=True, depsgraph=depsgraph
    )
    frozen = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(frozen)
    # Bake the evaluated object and centre the complete arm on its wrist. This
    # leaves runtime with one simple transform: wrist origin -> weapon contact.
    mesh.transform(Matrix.Translation(-wrist_world) @ evaluated.matrix_world)
    frozen.matrix_world = Matrix.Identity(4)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    return frozen


def armor_sources(side):
    suffix = "Left" if side == "Left" else "Right"
    return [
        bpy.data.objects.get(f"KYX_Gauntlet_{suffix}"),
        bpy.data.objects.get(f"KYX_ForearmGuard_{suffix}"),
        bpy.data.objects.get(f"KYX_Bicep_{suffix}"),
        bpy.data.objects.get(f"KYX_BicepGuard_{suffix}"),
    ]


def curl_gloves(armature):
    """Add a restrained grip curl without replacing the animated hand pose.

    The old bake assigned absolute XYZ values to mirrored Mixamo bones. That
    discarded each finger's GunIdle basis and forced differently rolled bones
    through one another. Post-multiplying a local rotation preserves the
    authored pose while bending each phalanx naturally around the grip.
    """
    bends = (0.52, 0.72, 0.48)
    for side in ("Left", "Right"):
        for finger in ("Index", "Middle", "Ring", "Pinky"):
            for index, bend in enumerate(bends, 1):
                bone = armature.pose.bones.get(f"mixamorig{side}Hand{finger}{index}")
                if bone:
                    bone.matrix_basis = bone.matrix_basis @ Matrix.Rotation(
                        bend, 4, "X"
                    )
        # The thumb closes across the side of the grip with a much smaller
        # rotation so it remains distinct instead of collapsing into the palm.
        thumb_sign = -1.0 if side == "Left" else 1.0
        for index, bend in enumerate((0.30, 0.38, 0.24), 1):
            bone = armature.pose.bones.get(f"mixamorig{side}HandThumb{index}")
            if bone:
                bone.matrix_basis = bone.matrix_basis @ Matrix.Rotation(
                    thumb_sign * bend, 4, "Z"
                )


armature = bpy.data.objects[ARMATURE_NAME]
body = bpy.data.objects[BODY_NAME]
reset_pose(armature)
armature.animation_data_create()
armature.animation_data.action = bpy.data.actions[POSE_ACTION]
bpy.context.scene.frame_set(POSE_FRAME)
curl_gloves(armature)
bpy.context.view_layer.update()

baked_roots = []
temporary = []
for side in ("Left", "Right"):
    hand_bone = armature.pose.bones[f"mixamorig{side}Hand"]
    wrist_world = armature.matrix_world @ hand_bone.head

    root = bpy.data.objects.new(f"KYX_ViewArm_{side}", None)
    bpy.context.scene.collection.objects.link(root)
    baked_roots.append(root)

    isolated_sleeve = isolate_weighted_part(body, side, "sleeve")
    isolated_hand = isolate_weighted_part(body, side, "hand")
    temporary.extend((isolated_sleeve, isolated_hand))
    frozen_parts = [
        freeze_object(isolated_sleeve, wrist_world, f"KYX_View{side}_Sleeve"),
        freeze_object(isolated_hand, wrist_world, f"KYX_View{side}_Hand"),
    ]
    for armor in filter(None, armor_sources(side)):
        frozen_parts.append(
            freeze_object(armor, wrist_world, f"KYX_View{side}_{armor.name}")
        )
    for part in frozen_parts:
        part.parent = root

for obj in temporary:
    bpy.data.objects.remove(obj, do_unlink=True)

# Export only the two static arm hierarchies. No duplicated skeleton, actions,
# torso, or preview studio reaches the browser bundle.
bpy.ops.object.select_all(action="DESELECT")
for root in baked_roots:
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)

OUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUT),
    export_format="GLB",
    use_selection=True,
    export_animations=False,
    export_yup=True,
    export_apply=True,
    export_materials="EXPORT",
)
print(f"viewmodel arms: {OUT} ({OUT.stat().st_size} bytes)")
