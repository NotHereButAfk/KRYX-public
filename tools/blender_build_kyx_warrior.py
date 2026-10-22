"""Build the production KYX arena-warrior with Blender.

The base is the project's licensed Universal Animation Library mannequin and
armature.  This script keeps its continuous skinned human body, renames the
deform bones to the runtime's Mixamo-compatible contract, authors a compact
layered arena-warrior shell, keeps a focused set of gameplay clips, exports a
GLB, saves the editable .blend, and renders three review views.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "vendor" / "quaternius" / "universal-animation-library.glb"
OUT_GLB = ROOT / "public" / "kyx-player.glb"
OUT_DIR = ROOT / "artifacts" / "kyx-player"
OUT_BLEND = OUT_DIR / "kyx-warrior.blend"
OUT_DIR.mkdir(parents=True, exist_ok=True)
BODY_SOURCE = None


def clear_scene():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)
    # Interactive reruns otherwise suffix every imported action with .001 and
    # leave the exporter with duplicate clips from the previous build.
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def material(name, color, metallic=0.0, roughness=0.6, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = (*emission, 1.0)
        if strength_input:
            strength_input.default_value = emission_strength
    return mat


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def smooth(obj):
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True


def apply_bevel(obj, amount=0.012, segments=3):
    if obj.type != "MESH" or amount <= 0:
        return
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Soft milled edges", "BEVEL")
    mod.width = amount
    mod.segments = segments
    mod.limit_method = "ANGLE"
    try:
        bpy.ops.object.modifier_apply(modifier=mod.name)
    except RuntimeError:
        pass
    obj.select_set(False)


def mark(obj, collection, export=True):
    obj["kyx_authored"] = True
    obj["kyx_export"] = bool(export)
    obj["kyx_collection"] = collection
    return obj


def rounded_box(name, loc, dims, mat, bevel=0.014, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_material(obj, mat)
    apply_bevel(obj, min(bevel, min(dims) * 0.23), 3)
    smooth(obj)
    return mark(obj, "armor")


def ellipsoid(name, loc, dims, mat, rot=(0.0, 0.0, 0.0), segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_material(obj, mat)
    smooth(obj)
    obj.select_set(False)
    return mark(obj, "armor")


def faceted_ellipsoid(name, loc, dims, mat, rot=(0.0, 0.0, 0.0), subdivisions=2):
    """Low-poly fitted shell for the angular planes of the arena armor."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, location=loc, rotation=rot)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    set_material(obj, mat)
    obj.select_set(False)
    return mark(obj, "armor")


def frustum(name, loc, width_top, width_bottom, height, depth, mat, bevel=0.014):
    z0, z1 = -height * 0.5, height * 0.5
    yt, yf = depth * 0.5, -depth * 0.5
    verts = [
        (-width_bottom * 0.5, yf, z0), (width_bottom * 0.5, yf, z0),
        (width_top * 0.5, yf, z1), (-width_top * 0.5, yf, z1),
        (-width_bottom * 0.5, yt, z0), (width_bottom * 0.5, yt, z0),
        (width_top * 0.5, yt, z1), (-width_top * 0.5, yt, z1),
    ]
    faces = [
        (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
        (3, 2, 6, 7), (0, 3, 7, 4), (1, 5, 6, 2),
    ]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    set_material(obj, mat)
    apply_bevel(obj, min(bevel, depth * 0.25), 3)
    smooth(obj)
    return mark(obj, "armor")


def front_panel(name, loc, points, depth, mat, bevel=0.008):
    """Extrude an angular X/Z silhouette toward the camera-facing -Y side.

    EV-style armor reads from overlapping silhouettes rather than cuboids.  A
    small two-dimensional outline gives chest, helmet and leg plates a fitted
    shape while keeping the mesh inexpensive enough for a browser match.
    """
    half = depth * 0.5
    count = len(points)
    verts = [(x, -half, z) for x, z in points] + [(x, half, z) for x, z in points]
    faces = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    set_material(obj, mat)
    apply_bevel(obj, min(bevel, depth * 0.24), 2)
    smooth(obj)
    return mark(obj, "armor")


def front_bar(name, loc, length, width, angle, depth, mat):
    obj = rounded_box(name, loc, (length, depth, width), mat, min(width * 0.24, depth * 0.2))
    obj.rotation_euler[1] = angle
    return obj


def front_ribbon(name, loc, start, end, width, depth, mat):
    """Extrude a narrow X/Z ribbon between two exact endpoints."""
    dx, dz = end[0] - start[0], end[1] - start[1]
    length = max(1e-6, math.sqrt(dx * dx + dz * dz))
    px, pz = -dz / length * width * 0.5, dx / length * width * 0.5
    mx, mz = (start[0] + end[0]) * 0.5, (start[1] + end[1]) * 0.5
    points = [
        (start[0] - mx + px, start[1] - mz + pz),
        (end[0] - mx + px, end[1] - mz + pz),
        (end[0] - mx - px, end[1] - mz - pz),
        (start[0] - mx - px, start[1] - mz - pz),
    ]
    return front_panel(name, loc + Vector((mx, 0, mz)), points, depth, mat, width * 0.18)


def limb_guard(name, armature, bone_name, width, length_ratio, depth, mat,
               front_offset=0.0, taper=0.72):
    """An anatomical plate that follows a limb without replacing its volume.

    Full ellipsoid shells made every joint look like a robot cylinder.  These
    tapered plates leave the continuous skinned undersuit visible around their
    sides, so elbows, thighs and calves keep a recognisably human silhouette.
    """
    bone = armature.data.bones[bone_name]
    length = bone.length * length_ratio
    half = length * 0.5
    loc = bone_world(armature, bone_name, 0.50) + Vector((0.0, -front_offset, 0.0))
    obj = front_panel(
        name, loc,
        [(-width * 0.5 * taper, half), (width * 0.5 * taper, half),
         (width * 0.5, -half), (-width * 0.5, -half)],
        depth, mat, min(depth * 0.22, width * 0.08),
    )
    align_long_axis(obj, bone_vector(armature, bone_name))
    parent_to_bone(obj, armature, bone_name)
    return obj


def bone_socket(name, armature, bone_name, factor=0.88):
    """Export a stable attachment node for runtime weapon and hand IK."""
    socket = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(socket)
    socket.empty_display_type = "ARROWS"
    socket.empty_display_size = 0.08
    direction = bone_vector(armature, bone_name)
    socket.location = bone_world(armature, bone_name, factor)
    socket.rotation_mode = "QUATERNION"
    socket.rotation_quaternion = direction.to_track_quat("Z", "Y")
    world = socket.matrix_world.copy()
    socket.parent = armature
    socket.parent_type = "BONE"
    socket.parent_bone = bone_name
    socket.matrix_world = world
    return mark(socket, "socket")


def bone_world(armature, bone_name, factor=0.5):
    bone = armature.data.bones.get(bone_name)
    if not bone:
        raise KeyError(f"Missing rig bone: {bone_name}")
    # Bone.head/tail are parent-local in object mode. Authoring needs the full
    # armature-space locations so every limb and helmet piece lands on-body.
    local = bone.head_local.lerp(bone.tail_local, factor)
    return armature.matrix_world @ local


def bone_vector(armature, bone_name):
    bone = armature.data.bones[bone_name]
    return (armature.matrix_world.to_3x3() @ (bone.tail_local - bone.head_local)).normalized()


def parent_to_bone(obj, armature, bone_name):
    # Bake authored transforms, then give every hard-surface piece one rigid
    # deform group.  Nearest-surface weight transfer looked attractive on paper
    # but blended gauntlets across elbow/finger groups and folded shin/boot
    # plates into white blobs during Idle/Run.  Armor is rigid in real life too:
    # the black undersuit bends while each plate rides its anatomical bone.
    # `transform_apply(location=True)` resets generated primitive locations in
    # Blender 5 without preserving their intended world-space vertex offset.
    # Bake the complete matrix into the mesh explicitly instead.
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    for group in list(obj.vertex_groups):
        obj.vertex_groups.remove(group)
    group = obj.vertex_groups.new(name=bone_name)
    group.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
    modifier = obj.modifiers.new("KYX Rig", "ARMATURE")
    modifier.object = armature
    obj.parent = armature
    obj.matrix_parent_inverse = armature.matrix_world.inverted()


def align_long_axis(obj, direction):
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")


def limb_shell(name, armature, bone_name, radius_x, radius_y, length_ratio, mat, front_offset=0.0):
    bone = armature.data.bones[bone_name]
    length = bone.length * length_ratio
    loc = bone_world(armature, bone_name, 0.5) + Vector((0.0, -front_offset, 0.0))
    obj = ellipsoid(name, loc, (radius_x * 2, radius_y * 2, length), mat, segments=20, rings=10)
    align_long_axis(obj, bone_vector(armature, bone_name))
    parent_to_bone(obj, armature, bone_name)
    return obj


def faceted_limb_shell(name, armature, bone_name, radius_x, radius_y, length_ratio, mat, front_offset=0.0):
    bone = armature.data.bones[bone_name]
    length = bone.length * length_ratio
    loc = bone_world(armature, bone_name, 0.5) + Vector((0.0, -front_offset, 0.0))
    obj = faceted_ellipsoid(name, loc, (radius_x * 2, radius_y * 2, length), mat, subdivisions=2)
    align_long_axis(obj, bone_vector(armature, bone_name))
    parent_to_bone(obj, armature, bone_name)
    return obj


def bone_child_shell(name, armature, bone_name, radius_x, radius_y, length_ratio, mat, front_offset=0.0):
    """Rigid shell parented directly to a bone, used for small arm plates.

    The imported forearm has a non-standard bind roll. A single-weight skin
    re-applies that roll at runtime and turns a lengthwise bracer sideways;
    direct bone parenting preserves the authored world alignment.
    """
    bone = armature.data.bones[bone_name]
    loc = bone_world(armature, bone_name, 0.5) + Vector((0.0, -front_offset, 0.0))
    obj = faceted_ellipsoid(name, loc, (radius_x * 2, radius_y * 2, bone.length * length_ratio), mat, subdivisions=2)
    align_long_axis(obj, bone_vector(armature, bone_name))
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world
    return obj


def rename_rig(armature):
    mapping = {
        "root": "mixamorigRoot",
        "DEF-hips": "mixamorigHips",
        "DEF-spine.001": "mixamorigSpine",
        "DEF-spine.002": "mixamorigSpine1",
        "DEF-spine.003": "mixamorigSpine2",
        "DEF-neck": "mixamorigNeck",
        "DEF-head": "mixamorigHead",
        "DEF-shoulder.L": "mixamorigLeftShoulder",
        "DEF-upper_arm.L": "mixamorigLeftArm",
        "DEF-forearm.L": "mixamorigLeftForeArm",
        "DEF-hand.L": "mixamorigLeftHand",
        "DEF-shoulder.R": "mixamorigRightShoulder",
        "DEF-upper_arm.R": "mixamorigRightArm",
        "DEF-forearm.R": "mixamorigRightForeArm",
        "DEF-hand.R": "mixamorigRightHand",
        "DEF-thigh.L": "mixamorigLeftUpLeg",
        "DEF-shin.L": "mixamorigLeftLeg",
        "DEF-foot.L": "mixamorigLeftFoot",
        "DEF-toe.L": "mixamorigLeftToeBase",
        "DEF-thigh.R": "mixamorigRightUpLeg",
        "DEF-shin.R": "mixamorigRightLeg",
        "DEF-foot.R": "mixamorigRightFoot",
        "DEF-toe.R": "mixamorigRightToeBase",
    }
    for old, new in mapping.items():
        bone = armature.data.bones.get(old)
        if bone:
            bone.name = new
    # Keep finger articulation available to future reload/fire clips.
    for side, long_side in (("L", "Left"), ("R", "Right")):
        for finger, long_finger in (("index", "Index"), ("middle", "Middle"), ("ring", "Ring"), ("pinky", "Pinky"), ("thumb", "Thumb")):
            for index in (1, 2, 3):
                old = f"DEF-f_{finger}.{index:02d}.{side}" if finger != "thumb" else f"DEF-thumb.{index:02d}.{side}"
                bone = armature.data.bones.get(old)
                if bone:
                    bone.name = f"mixamorig{long_side}Hand{long_finger}{index}"


def keep_game_actions():
    aliases = {
        "A_TPose": "TPose",
        "Idle_Loop": "Idle",
        "Walk_Loop": "Walk",
        "Sprint_Loop": "Run",
        "Crouch_Idle_Loop": "CrouchIdle",
        "Crouch_Fwd_Loop": "CrouchWalk",
        "Jump_Start": "JumpStart",
        "Jump_Loop": "JumpLoop",
        "Jump_Land": "JumpLand",
        "Pistol_Shoot": "Fire",
        "Pistol_Reload": "Reload",
        "Pistol_Idle_Loop": "GunIdle",
        "Pistol_Aim_Down": "GunAimDown",
        "Pistol_Aim_Neutral": "GunAimNeutral",
        "Pistol_Aim_Up": "GunAimUp",
        "Hit_Chest": "HitChest",
        "Hit_Head": "HitHead",
        "Roll": "DodgeRoll",
        "Sword_Idle": "SwordIdle",
        "Sword_Attack": "SwordAttack",
        "Death01": "Death",
    }
    for action in list(bpy.data.actions):
        if action.name in aliases:
            action.name = aliases[action.name]
        else:
            bpy.data.actions.remove(action)
    return sorted(action.name for action in bpy.data.actions)


def character_bounds(objects):
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return lo, hi


clear_scene()
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

armature = next((obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"), None)
if armature is None:
    raise RuntimeError("Universal animation GLB imported without an armature")
armature.name = "KYX_Warrior_Rig"
armature.data.name = "KYX_Warrior_Skeleton"
armature["kyx_authored_armor"] = True
armature["kyx_character_version"] = 4
mark(armature, "rig")

armature.data.pose_position = "REST"
# Exclude Blender's hidden Icosphere bone-shape helper. Including it made the
# measured height 2.83m instead of the actual 1.83m mannequin and inflated all
# authored armor by roughly 57 percent.
body_objects = [
    obj for obj in bpy.context.scene.objects
    if obj.type == "MESH"
    and obj.name != "Icosphere"
    and any(mod.type == "ARMATURE" and mod.object == armature for mod in obj.modifiers)
]
if not body_objects:
    raise RuntimeError("No skinned mannequin mesh was imported")
BODY_SOURCE = body_objects[0]
for obj in body_objects:
    obj.name = "KYX_Undersuit_" + obj.name
    mark(obj, "body")

rename_rig(armature)
actions = keep_game_actions()


def offset_action_hips_vertical(action_name, amount):
    """Move a locomotion clip onto the shared ground plane without rebaking."""
    action = bpy.data.actions.get(action_name)
    if not action or not action.slots or not action.layers:
        return
    strip = action.layers[0].strips[0]
    bag = strip.channelbag(action.slots[0])
    if not bag:
        return
    for curve in bag.fcurves:
        # Mixamo's hips bone points along local Y. Blender scene Z is vertical,
        # but editing the pose-bone Z channel pushes this rig diagonally.
        if curve.data_path == 'pose.bones["mixamorigHips"].location' and curve.array_index == 1:
            for key in curve.keyframe_points:
                key.co[1] += amount
                key.handle_left[1] += amount
                key.handle_right[1] += amount


# The source sprint dips the toes about 5.7cm below Idle/Walk. Normalizing its
# hips baseline prevents a visible whole-body drop at the Walk→Run crossfade.
offset_action_hips_vertical("Run", 0.057)

undersuit = material("KYX_Undersuit", (0.018, 0.022, 0.028), metallic=0.02, roughness=0.82)
armor = material("KYX_Armor", (0.62, 0.65, 0.78), metallic=0.10, roughness=0.48)
armor_dark = material("KYX_ArmorDark", (0.055, 0.062, 0.075), metallic=0.14, roughness=0.52)
accent = material("KYX_Orange", (1.0, 0.30, 0.005), metallic=0.05, roughness=0.44,
                  emission=(1.0, 0.075, 0.0), emission_strength=0.18)
visor = material("KYX_Visor", (0.74, 0.96, 0.04), metallic=0.05, roughness=0.20,
                 emission=(0.60, 1.0, 0.015), emission_strength=3.6)

for obj in body_objects:
    set_material(obj, undersuit)
    smooth(obj)

lo, hi = character_bounds(body_objects)
height = hi.z - lo.z
scale = height / 1.80 if height > 0.5 else 1.0
cx = (lo.x + hi.x) * 0.5
cy = (lo.y + hi.y) * 0.5
z0 = lo.z


def S(value):
    return value * scale


def P(x, y, z):
    return (cx + S(x), cy + S(y), z0 + S(z))


pieces = []


def add(obj, bone):
    parent_to_bone(obj, armature, bone)
    pieces.append(obj)
    return obj


# Torso: narrow waist, broad upper breastplate, layered flexible abdomen.
pieces.append(add(frustum("KYX_CoreVest", P(0, 0.025, 1.22), S(0.37), S(0.285), S(0.37), S(0.17), armor_dark, S(0.018)), "mixamorigSpine2"))
for side in (-1, 1):
    plate = frustum(f"KYX_Chest_{'L' if side < 0 else 'R'}", P(0.074 * side, -0.089, 1.33),
                    S(0.142), S(0.118), S(0.175), S(0.038), armor, S(0.009))
    plate.rotation_euler[2] = math.radians(7.0 * side)
    pieces.append(add(plate, "mixamorigSpine2"))
pieces.append(add(frustum("KYX_Sternum", P(0, -0.128, 1.25), S(0.058), S(0.04), S(0.26), S(0.032), armor_dark, S(0.008)), "mixamorigSpine2"))
pieces.append(add(rounded_box("KYX_ChestSignal", P(0, -0.149, 1.32), (S(0.018), S(0.010), S(0.145)), accent, S(0.003)), "mixamorigSpine2"))
for idx, z in enumerate((1.08, 1.00, 0.93)):
    width = 0.255 - idx * 0.018
    pieces.append(add(rounded_box(f"KYX_AbBand_{idx+1}", P(0, -0.067, z),
                                  (S(width), S(0.072), S(0.048)), armor_dark, S(0.010)), "mixamorigSpine1"))
pieces.append(add(rounded_box("KYX_Belt", P(0, 0.0, 0.865), (S(0.32), S(0.17), S(0.068)), armor_dark, S(0.012)), "mixamorigSpine"))
pieces.append(add(frustum("KYX_Buckle", P(0, -0.132, 0.865), S(0.10), S(0.085), S(0.08), S(0.035), armor, S(0.008)), "mixamorigSpine"))

# Backpack/spine gives the warrior silhouette readable depth without bulk.
pieces.append(add(rounded_box("KYX_Backpack", P(0, 0.135, 1.23), (S(0.215), S(0.085), S(0.30)), armor_dark, S(0.019)), "mixamorigSpine2"))
pieces.append(add(rounded_box("KYX_BackSpineLight", P(0, 0.225, 1.27), (S(0.035), S(0.015), S(0.245)), visor, S(0.006)), "mixamorigSpine2"))
for side in (-1, 1):
    pieces.append(add(rounded_box(f"KYX_BackRail_{side}", P(0.085 * side, 0.225, 1.24),
                                  (S(0.038), S(0.02), S(0.24)), armor, S(0.007)), "mixamorigSpine2"))

# Helmet: smooth hood shell, hard crown, narrow luminous visor, jaw armor.
head_center = bone_world(armature, "mixamorigHead", 0.62)
hood = ellipsoid("KYX_HelmetHood", head_center + Vector((0, S(0.012), S(0.015))),
                 (S(0.285), S(0.245), S(0.325)), armor_dark, segments=28, rings=16)
pieces.append(add(hood, "mixamorigHead"))
pieces.append(add(ellipsoid("KYX_HelmetShell", head_center + Vector((0, S(-0.015), S(0.035))),
                            (S(0.255), S(0.218), S(0.29)), armor, segments=28, rings=16), "mixamorigHead"))
pieces.append(add(rounded_box("KYX_Visor", head_center + Vector((0, S(-0.132), S(0.03))),
                              (S(0.225), S(0.032), S(0.075)), visor, S(0.012)), "mixamorigHead"))
pieces.append(add(frustum("KYX_Brow", head_center + Vector((0, S(-0.125), S(0.10))),
                          S(0.23), S(0.19), S(0.065), S(0.045), armor_dark, S(0.01)), "mixamorigHead"))
for side in (-1, 1):
    pieces.append(add(rounded_box(f"KYX_Jaw_{side}", head_center + Vector((S(0.105 * side), S(-0.095), S(-0.075))),
                                  (S(0.065), S(0.075), S(0.145)), armor, S(0.014),
                                  rot=(0, math.radians(8 * side), math.radians(-4 * side))), "mixamorigHead"))
pieces.append(add(rounded_box("KYX_Mask", head_center + Vector((0, S(-0.135), S(-0.085))),
                              (S(0.105), S(0.04), S(0.105)), armor_dark, S(0.012)), "mixamorigHead"))
pieces.append(add(rounded_box("KYX_Crown", head_center + Vector((0, S(0.005), S(0.19))),
                              (S(0.115), S(0.18), S(0.035)), accent, S(0.008)), "mixamorigHead"))

# Shoulders, arms and gauntlets remain compact so a shouldered rifle clears them.
for side, label in ((-1, "Left"), (1, "Right")):
    shoulder_bone = f"mixamorig{label}Shoulder"
    upper_bone = f"mixamorig{label}Arm"
    fore_bone = f"mixamorig{label}ForeArm"
    shoulder = ellipsoid(f"KYX_Shoulder_{label}", bone_world(armature, upper_bone, 0.08) + Vector((S(0.025 * side), 0, 0)),
                         (S(0.145), S(0.12), S(0.115)), armor, segments=20, rings=10)
    pieces.append(add(shoulder, shoulder_bone))
    pieces.append(limb_shell(f"KYX_Bicep_{label}", armature, upper_bone, S(0.040), S(0.037), 0.45, armor_dark))
    pieces.append(limb_shell(f"KYX_Gauntlet_{label}", armature, fore_bone, S(0.047), S(0.043), 0.50, armor))

# Human leg silhouette: thin tactical guards over the continuous skinned legs.
# Flat front guards keep knees and calves anatomical instead of spherical robot
# joints while remaining readable at arena distance.
for side, label in ((-1, "Left"), (1, "Right")):
    thigh = f"mixamorig{label}UpLeg"
    shin = f"mixamorig{label}Leg"
    foot = f"mixamorig{label}Foot"
    thigh_mid = bone_world(armature, thigh, 0.46)
    thigh_guard = rounded_box(f"KYX_ThighGuard_{label}", thigh_mid + Vector((0, S(-0.075), 0)),
                              (S(0.105), S(0.032), S(0.22)), armor, S(0.012))
    align_long_axis(thigh_guard, bone_vector(armature, thigh))
    pieces.append(add(thigh_guard, thigh))
    knee_loc = bone_world(armature, shin, 0.02) + Vector((0, S(-0.065), 0))
    knee = rounded_box(f"KYX_Knee_{label}", knee_loc, (S(0.09), S(0.036), S(0.07)), armor, S(0.014))
    pieces.append(add(knee, shin))
    shin_mid = bone_world(armature, shin, 0.53)
    shin_guard = rounded_box(f"KYX_ShinGuard_{label}", shin_mid + Vector((0, S(-0.074), 0)),
                             (S(0.095), S(0.034), S(0.225)), armor, S(0.014))
    align_long_axis(shin_guard, bone_vector(armature, shin))
    pieces.append(add(shin_guard, shin))
    foot_loc = bone_world(armature, foot, 0.55) + Vector((0, S(-0.035), S(-0.012)))
    pieces.append(add(rounded_box(f"KYX_BootPlate_{label}", foot_loc + Vector((0, S(-0.06), S(0.045))),
                                  (S(0.105), S(0.135), S(0.024)), armor, S(0.007)), foot))

# Side hip plates and a short front tab read as warrior kit instead of robot hips.
for side in (-1, 1):
    hip = rounded_box(f"KYX_Hip_{side}", P(0.18 * side, 0.0, 0.82),
                      (S(0.070), S(0.12), S(0.155)), armor, S(0.014), rot=(0, math.radians(7 * side), 0))
    pieces.append(add(hip, "mixamorigHips"))
pieces.append(add(frustum("KYX_WaistTab", P(0, -0.115, 0.79), S(0.135), S(0.09), S(0.17), S(0.035), armor_dark, S(0.010)), "mixamorigHips"))
pieces.append(add(rounded_box("KYX_WaistMark", P(0, -0.158, 0.80), (S(0.035), S(0.012), S(0.13)), accent, S(0.003)), "mixamorigHips"))

# Version 4 rebuild.  The earlier pass proved that simply stacking rounded
# boxes over a mannequin produces the toy-robot silhouette the player rejected.
# Remove that pass and author a fitted, faceted warrior shell: the black body is
# continuous, joint gaps stay hidden, and the light/orange plates follow the
# same large shapes visible in the EV.IO default reference without extracting
# or redistributing its proprietary mesh.
for old_piece in list(pieces):
    try:
        old_name = old_piece.name
    except ReferenceError:
        # Several legacy calls appended add(...) twice.  The duplicate pointer
        # becomes invalid after the first instance is removed.
        continue
    if old_name in bpy.data.objects:
        bpy.data.objects.remove(old_piece, do_unlink=True)
pieces.clear()


def fitted(obj, bone):
    return add(obj, bone)


# Tapered carrier and split pectorals.  Their lower points interlock with the
# abdomen instead of ending in a rectangular shelf.
fitted(frustum("KYX_CoreVest", P(0, 0.012, 1.25), S(0.39), S(0.26), S(0.42), S(0.17), armor_dark, S(0.015)), "mixamorigSpine2")
for side, tag in ((-1, "L"), (1, "R")):
    mirrored = lambda pts: [(S(x * side), S(z)) for x, z in pts]
    fitted(front_panel(
        f"KYX_Pectoral_{tag}", P(S(0.083 * side) / scale, -0.096, 1.335),
        mirrored([(-0.082, 0.080), (0.052, 0.102), (0.088, 0.026),
                  (0.058, -0.084), (0.004, -0.122), (-0.074, -0.056)]),
        S(0.052), armor, S(0.009)), "mixamorigSpine2")
    fitted(front_panel(
        f"KYX_ChestOrange_{tag}", P(S(0.042 * side) / scale, -0.128, 1.285),
        mirrored([(-0.026, 0.050), (0.042, 0.070), (0.049, -0.048),
                  (0.006, -0.087), (-0.034, -0.056)]),
        S(0.025), accent, S(0.005)), "mixamorigSpine2")
fitted(front_panel(
    "KYX_SternumBlade", P(0, -0.145, 1.285),
    [(S(-0.050), S(0.112)), (S(0.050), S(0.112)),
     (S(0.038), S(-0.100)), (0, S(-0.142)), (S(-0.038), S(-0.100))],
    S(0.028), accent, S(0.006)), "mixamorigSpine2")

# Floating collar blades are a defining shoulder-to-neck transition in the
# reference.  They sit high but stay slim enough to clear the rifle stock.
for side, tag in ((-1, "L"), (1, "R")):
    fitted(front_panel(
        f"KYX_Collar_{tag}", P(0.105 * side, -0.075, 1.475),
        [(S(-0.070), S(-0.038)), (S(0.072), S(-0.055)),
         (S(0.064), S(0.060)), (S(-0.028), S(0.085))],
        S(0.065), accent, S(0.008)), "mixamorigSpine2")

# Articulated abdomen: dark diagonal gaps remain visible between plates and
# make the waist bend like armor worn by a person, not a rigid appliance.
for idx, (z, width) in enumerate(((1.135, 0.245), (1.065, 0.225), (0.995, 0.205))):
    fitted(front_panel(
        f"KYX_AbPlate_{idx+1}", P(0, -0.102, z),
        [(S(-width * 0.50), S(-0.030)), (S(width * 0.50), S(-0.030)),
         (S(width * 0.42), S(0.030)), (S(-width * 0.42), S(0.030))],
        S(0.045), armor if idx != 1 else armor_dark, S(0.006)), "mixamorigSpine1")
fitted(rounded_box("KYX_AbSignal", P(0, -0.137, 1.065), (S(0.034), S(0.015), S(0.034)), visor, S(0.005)), "mixamorigSpine1")

# Athletic pelvis: one fitted belt, a central groin plate, and independent hip
# wings.  The thighs begin under the shell, so there is no visible ball joint.
fitted(frustum("KYX_Belt", P(0, 0.0, 0.915), S(0.30), S(0.25), S(0.105), S(0.16), armor_dark, S(0.012)), "mixamorigHips")
fitted(front_panel("KYX_GroinPlate", P(0, -0.108, 0.835),
                   [(S(-0.074), S(0.095)), (S(0.074), S(0.095)),
                    (S(0.055), S(-0.105)), (0, S(-0.145)), (S(-0.055), S(-0.105))],
                   S(0.055), armor, S(0.009)), "mixamorigHips")
for side, tag in ((-1, "L"), (1, "R")):
    fitted(front_panel(f"KYX_HipWing_{tag}", P(0.165 * side, -0.015, 0.86),
                       [(S(-0.045), S(0.095)), (S(0.050), S(0.070)),
                        (S(0.038), S(-0.110)), (S(-0.025), S(-0.135))],
                       S(0.105), accent, S(0.009)), "mixamorigHips")

# Compact faceted helmet. A deep black facial recess separates the mask from
# the shell, while layered crown, cheek and jaw plates create an actual face.
# Three thin luminous chevrons replace the previous filled V-shaped polygon.
head_center = bone_world(armature, "mixamorigHead", 0.58)
fitted(faceted_ellipsoid("KYX_HelmetHood", head_center + Vector((0, S(0.018), 0)),
                         (S(0.226), S(0.202), S(0.266)), armor_dark, subdivisions=3), "mixamorigHead")
fitted(faceted_ellipsoid("KYX_HelmetShell", head_center + Vector((0, S(0.020), S(0.070))),
                         (S(0.228), S(0.214), S(0.258)), armor, subdivisions=3), "mixamorigHead")
fitted(front_panel("KYX_HelmetCrown", head_center + Vector((0, S(-0.108), S(0.030))),
                   [(S(-0.104), S(-0.018)), (S(-0.094), S(0.094)),
                    (S(-0.054), S(0.158)), (S(0.054), S(0.158)),
                    (S(0.094), S(0.094)), (S(0.104), S(-0.018)),
                    (S(0.060), S(-0.056)), (S(-0.060), S(-0.056))],
                   S(0.082), armor, S(0.009)), "mixamorigHead")
# Recessed mask opening: this dark silhouette is the face plane, not another
# outer helmet shell. It remains visible between every bright visor segment.
fitted(front_panel("KYX_FaceRecess", head_center + Vector((0, S(-0.171), S(-0.030))),
                   [(S(-0.090), S(0.090)), (S(0.090), S(0.090)),
                    (S(0.078), S(-0.062)), (S(0.044), S(-0.120)),
                    (0, S(-0.142)), (S(-0.044), S(-0.120)),
                    (S(-0.078), S(-0.062))],
                   S(0.022), armor_dark, S(0.004)), "mixamorigHead")
for side, tag in ((-1, "L"), (1, "R")):
    # Orange temple rails frame the mask; a smaller pale jaw insert adds a
    # second layer so the side profile no longer looks like one flat slab.
    fitted(front_panel(f"KYX_HelmetCheek_{tag}", head_center + Vector((S(0.086 * side), S(-0.151), S(-0.030))),
                       [(S(-0.030), S(0.096)), (S(0.034), S(0.070)),
                        (S(0.026), S(-0.090)), (S(-0.012), S(-0.118))],
                       S(0.040), accent, S(0.006)), "mixamorigHead")
    fitted(front_panel(f"KYX_JawInsert_{tag}", head_center + Vector((S(0.060 * side), S(-0.176), S(-0.094))),
                       [(S(-0.024), S(0.038)), (S(0.026), S(0.028)),
                        (S(0.018), S(-0.052)), (S(-0.018), S(-0.064))],
                       S(0.018), armor, S(0.004)), "mixamorigHead")

# Each visor chevron is made from two separate narrow illuminated bars. The
# black gap between rows is deliberately wider than the bar thickness.
visor_parts = []
for index, (z, width, drop, thickness) in enumerate(((0.050, 0.080, 0.058, 0.013),
                                                      (-0.012, 0.066, 0.048, 0.011),
                                                      (-0.064, 0.052, 0.038, 0.009))):
    for side, tag in ((-1, "L"), (1, "R")):
        visor_parts.append(fitted(front_ribbon(
            f"KYX_Visor_{index+1}_{tag}",
            head_center + Vector((0, S(-0.188), 0)),
            (S(width * side), S(z)), (0, S(z - drop)),
            S(thickness), S(0.013), visor),
            "mixamorigHead"))

# All six bars share one bone and one material. Joining them preserves the
# visible gaps while keeping the production model under its browser mesh budget.
for part in visor_parts[1:]:
    pieces.remove(part)
bpy.ops.object.select_all(action="DESELECT")
for part in visor_parts:
    part.select_set(True)
bpy.context.view_layer.objects.active = visor_parts[0]
bpy.ops.object.join()
visor_parts[0].name = "KYX_VisorChevrons"

fitted(front_panel("KYX_ForeheadInset", head_center + Vector((0, S(-0.158), S(0.118))),
                   [(S(-0.050), S(-0.030)), (S(0.050), S(-0.030)),
                    (S(0.036), S(0.048)), (0, S(0.064)), (S(-0.036), S(0.048))],
                   S(0.022), armor_dark, S(0.005)), "mixamorigHead")
fitted(front_panel("KYX_Chin", head_center + Vector((0, S(-0.143), S(-0.112))),
                   [(S(-0.058), S(0.042)), (S(0.058), S(0.042)),
                    (S(0.038), S(-0.046)), (0, S(-0.068)), (S(-0.038), S(-0.046))],
                   S(0.045), armor, S(0.007)), "mixamorigHead")

# Raised orange pauldrons with pale lower inserts, plus thin anatomical arm
# guards.  Cloth remains visible at the elbow and wrist; the armor therefore
# reads as equipment worn by a warrior instead of mechanical replacement limbs.
for side, label in ((-1, "Left"), (1, "Right")):
    shoulder_bone = f"mixamorig{label}Shoulder"
    upper_bone = f"mixamorig{label}Arm"
    fore_bone = f"mixamorig{label}ForeArm"
    shoulder_loc = bone_world(armature, upper_bone, 0.10) + Vector((S(0.024 * side), 0, S(0.035)))
    # A compressed ellipsoid follows the deltoid instead of presenting a
    # vertical orange box.  It stays rigid to the shoulder while the human arm
    # remains visible beneath it.
    fitted(faceted_ellipsoid(f"KYX_Pauldron_{label}", shoulder_loc,
                             (S(0.168), S(0.112), S(0.126)), accent,
                             rot=(0, math.radians(10 * side), math.radians(-8 * side)),
                             subdivisions=2), shoulder_bone)
    fitted(front_panel(f"KYX_PauldronInsert_{label}", shoulder_loc + Vector((0, S(-0.080), S(-0.025))),
                       [(S(-0.046), S(0.046)), (S(0.046), S(0.046)),
                        (S(0.038), S(-0.046)), (S(-0.038), S(-0.046))],
                       S(0.025), armor, S(0.005)), shoulder_bone)
    pieces.append(limb_guard(f"KYX_BicepGuard_{label}", armature, upper_bone,
                              S(0.082), 0.43, S(0.028), armor,
                              front_offset=S(0.057), taper=0.80))
    pieces.append(limb_guard(f"KYX_ForearmGuard_{label}", armature, fore_bone,
                              S(0.092), 0.58, S(0.032), accent,
                              front_offset=S(0.052), taper=0.68))
    vent_loc = bone_world(armature, upper_bone, 0.10) + Vector((0, S(-0.075), S(0.055)))
    for vent_index in range(3):
        fitted(rounded_box(f"KYX_ShoulderVent_{label}_{vent_index+1}",
                           vent_loc + Vector((S((vent_index - 1) * 0.026), 0, 0)),
                           (S(0.014), S(0.010), S(0.045)), visor, S(0.003)), shoulder_bone)

# Human legs use flat tapered guards over the continuous mannequin.  The dark
# inner thigh, back of the calf, ankle and knee flexion remain visible in every
# pose; no armor piece encloses a whole joint.
for side, label in ((-1, "Left"), (1, "Right")):
    thigh_bone = f"mixamorig{label}UpLeg"
    shin_bone = f"mixamorig{label}Leg"
    foot_bone = f"mixamorig{label}Foot"
    pieces.append(limb_guard(f"KYX_ThighGuard_{label}", armature, thigh_bone,
                              S(0.152), 0.70, S(0.040), armor,
                              front_offset=S(0.073), taper=0.74))
    thigh_mid = bone_world(armature, thigh_bone, 0.48) + Vector((S(0.073 * side), S(-0.036), 0))
    thigh_rail = rounded_box(f"KYX_ThighRail_{label}", thigh_mid,
                             (S(0.038), S(0.030), S(0.235)), accent, S(0.007))
    align_long_axis(thigh_rail, bone_vector(armature, thigh_bone))
    fitted(thigh_rail, thigh_bone)
    knee_loc = bone_world(armature, shin_bone, 0.035) + Vector((0, S(-0.060), S(0.005)))
    fitted(front_panel(f"KYX_Knee_{label}", knee_loc,
                       [(S(-0.054), S(0.050)), (S(0.054), S(0.050)),
                        (S(0.046), S(-0.048)), (0, S(-0.070)), (S(-0.046), S(-0.048))],
                       S(0.052), accent, S(0.009)), shin_bone)
    fitted(front_panel(f"KYX_KneeInset_{label}", knee_loc + Vector((0, S(-0.050), S(-0.006))),
                       [(S(-0.040), S(0.032)), (S(0.040), S(0.032)),
                        (S(0.032), S(-0.040)), (0, S(-0.054)), (S(-0.032), S(-0.040))],
                       S(0.025), armor, S(0.006)), shin_bone)
    pieces.append(limb_guard(f"KYX_ShinGuard_{label}", armature, shin_bone,
                              S(0.132), 0.69, S(0.038), armor,
                              front_offset=S(0.067), taper=0.60))
    shin_mid = bone_world(armature, shin_bone, 0.56) + Vector((S(0.062 * side), S(-0.034), 0))
    shin_rail = rounded_box(f"KYX_ShinRail_{label}", shin_mid,
                            (S(0.032), S(0.026), S(0.222)), accent, S(0.006))
    align_long_axis(shin_rail, bone_vector(armature, shin_bone))
    fitted(shin_rail, shin_bone)
    ankle = bone_world(armature, foot_bone, 0.08) + Vector((0, S(-0.018), S(0.012)))
    fitted(ellipsoid(f"KYX_AnkleCuff_{label}", ankle,
                     (S(0.132), S(0.140), S(0.080)), accent, segments=16, rings=8), foot_bone)
    foot_mid = bone_world(armature, foot_bone, 0.62) + Vector((0, S(-0.010), S(0.025)))
    boot = faceted_ellipsoid(f"KYX_Boot_{label}", foot_mid,
                             (S(0.145), S(0.228), S(0.082)), armor, subdivisions=2)
    align_long_axis(boot, bone_vector(armature, foot_bone))
    fitted(boot, foot_bone)
    boot_band = rounded_box(f"KYX_BootBand_{label}", foot_mid + Vector((0, S(-0.012), S(0.040))),
                            (S(0.154), S(0.045), S(0.022)), accent, S(0.005))
    fitted(boot_band, foot_bone)

# Runtime gun meshes stay separate so one character can use every weapon skin.
# These Blender-authored attachment nodes travel with the animated hands and
# give the game an unambiguous trigger grip, support grip and back holster.
weapon_sockets = [
    bone_socket("KYX_WeaponSocket_R", armature, "mixamorigRightHand", 0.72),
    bone_socket("KYX_SupportSocket_L", armature, "mixamorigLeftHand", 0.72),
    bone_socket("KYX_SwordSocket_R", armature, "mixamorigRightHand", 0.82),
    bone_socket("KYX_BackHolsterSocket", armature, "mixamorigSpine2", 0.58),
]

# Slim rear pack closes the silhouette without making the torso hunch forward.
fitted(frustum("KYX_Backpack", P(0, 0.132, 1.28), S(0.175), S(0.145), S(0.25), S(0.052), armor_dark, S(0.012)), "mixamorigSpine2")
for side, tag in ((-1, "L"), (1, "R")):
    fitted(rounded_box(f"KYX_BackRail_{tag}", P(0.074 * side, 0.190, 1.31),
                       (S(0.032), S(0.022), S(0.220)), accent, S(0.006)), "mixamorigSpine2")

# Export only the production character hierarchy.
for obj in bpy.context.scene.objects:
    obj.select_set(bool(obj.get("kyx_export")))
bpy.context.view_layer.objects.active = armature
# Armor is authored against REST, but animation sampling must evaluate POSE.
# Exporting while the armature remained in REST produced correctly named clips
# whose every bone collapsed to two identical keys (static/folded bots).
armature.data.pose_position = "POSE"
# Quaternius' character faces Blender -Y, which arrives in Three.js as local
# +Z. Armature object transforms are consumed by glTF skin export, so a plain
# armature rotation does not survive as a runtime forward-axis correction.
# Put the complete rig under an exported empty; that root node is preserved and
# turns model plus animation together onto KYX's local -Z gameplay forward.
forward_root = bpy.data.objects.new("KYX_ForwardRoot", None)
bpy.context.collection.objects.link(forward_root)
forward_root.rotation_euler[2] = math.pi
mark(forward_root, "root")
forward_root.select_set(True)
armature.parent = forward_root

bpy.ops.export_scene.gltf(
    filepath=str(OUT_GLB),
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_extras=True,
)

# Put the idle clip on the review render when Blender exposes it as an action.
idle = bpy.data.actions.get("Idle")
armature.data.pose_position = "POSE"
if idle:
    armature.animation_data_create()
    try:
        armature.animation_data.action = idle
    except (RuntimeError, TypeError):
        pass
bpy.context.scene.frame_set(1)

# Review studio. These helpers are deliberately added after the GLB export.
floor_mat = material("PreviewFloor", (0.012, 0.016, 0.025), metallic=0.0, roughness=0.82)
bpy.ops.mesh.primitive_plane_add(size=S(12), location=(cx, cy, z0 - S(0.01)))
floor = bpy.context.object
floor.name = "PREVIEW_Floor"
set_material(floor, floor_mat)
mark(floor, "preview", export=False)

world = bpy.context.scene.world or bpy.data.worlds.new("KYX Preview World")
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.004, 0.007, 0.014, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.20


def add_area(name, loc, energy, color, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    point_camera(obj, Vector((cx, cy, z0 + S(1.05))))
    mark(obj, "preview", export=False)
    return obj


def point_camera(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


add_area("PREVIEW_Key", (cx - S(2.7), cy - S(3.3), z0 + S(4.2)), 1050, (0.68, 0.82, 1.0), S(3.0))
add_area("PREVIEW_Fill", (cx + S(3.0), cy - S(2.2), z0 + S(2.2)), 720, (1.0, 0.33, 0.12), S(2.4))
add_area("PREVIEW_Rim", (cx, cy + S(3.2), z0 + S(3.5)), 980, (0.05, 0.65, 1.0), S(2.2))

cam_data = bpy.data.cameras.new("PREVIEW_Camera")
cam = bpy.data.objects.new("PREVIEW_Camera", cam_data)
bpy.context.collection.objects.link(cam)
cam.data.lens = 72
cam.data.sensor_width = 36
bpy.context.scene.camera = cam
mark(cam, "preview", export=False)

scene = bpy.context.scene
# The Windows headless WGL path can crash after a successful glTF export when
# EEVEE asks for a pixel format.  Use Blender's CPU renderer for deterministic
# CI/review plates; this does not affect the exported realtime materials.
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.cycles.use_denoising = False
scene.render.resolution_x = 560
scene.render.resolution_y = 760
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.render.resolution_percentage = 100

target = Vector((cx, cy, z0 + S(1.02)))
views = {
    "front": Vector((cx, cy + S(4.0), z0 + S(1.13))),
    "quarter": Vector((cx + S(2.75), cy + S(3.55), z0 + S(1.20))),
    "side": Vector((cx + S(4.15), cy, z0 + S(1.15))),
}
for name, location in views.items():
    cam.location = location
    point_camera(cam, target)
    scene.render.filepath = str(OUT_DIR / f"kyx-warrior-{name}.png")
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))

for obj in bpy.context.scene.objects:
    if obj.type == "MESH" and obj.get("kyx_export"):
        obj.data.calc_loop_triangles()

report = {
    "source": str(SOURCE),
    "glb": str(OUT_GLB),
    "blend": str(OUT_BLEND),
    "height": round(height, 4),
    "actions": actions,
    "characterVersion": 4,
    "weaponSockets": [socket.name for socket in weapon_sockets],
    "armorPieces": len(pieces),
    "bones": len(armature.data.bones),
    "triangles": sum(len(obj.data.loop_triangles) for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.get("kyx_export")),
}
(OUT_DIR / "build-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print("KYX_WARRIOR_BUILD_COMPLETE", json.dumps(report))
