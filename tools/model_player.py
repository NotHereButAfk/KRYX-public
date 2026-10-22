"""
Builds an ev.io-style hero character — white armour over a black undersuit with
a glowing yellow visor — entirely from primitives, rigs it, and saves a .blend.

Run:
    blender --background --python tools/model_player.py
    blender --background --python tools/model_player.py -- --out /path/out.blend
    blender --background --python tools/model_player.py -- --glb   (also write a .glb)

or, with the `bpy` pip module installed:
    python3 tools/model_player.py

Axes follow the rest of tools/ (see gunlib.py): +Z up, character faces -Y, so
the glTF exporter's Z-up→Y-up conversion lands the model facing glTF-forward
without a fix-up rotation. That also means +X is the character's LEFT, which is
what Blender's .L/.R naming and its mirror tools assume.

EVERY part is a tapered box: eight explicit corners, six quads, twelve
triangles. A taper costs nothing over a cube and is the whole difference
between sci-fi plate and a stack of shoeboxes — a pauldron that narrows toward
the arm and a boot that flares toward the floor read as designed hardware at
the same triangle count. Nothing is smooth-shaded, nothing is textured, and
the silhouette does all the work.

Detail 1 = 92 blocks / 1104 tris (the original game budget);
detail 2 adds greeble on top. The build asserts it stays inside its budget.
"""

import os
import sys
import math

import bpy
from mathutils import Euler, Vector

# ── the figure ───────────────────────────────────────────────────────────────
# These are src/player/Proportions.js, to the digit. They have to be: the game's
# Locomotion solves ground contact against a fixed hip/knee/ankle chain and
# RifleCarry IKs both arms against a fixed shoulder and fixed bone lengths, and
# neither derives anything from the mesh. A rig that is 2cm off at the ankle
# does not look 2cm wrong, it makes the feet skate.
#
# `npm run test:mesh` measures these off the built body against Proportions.js
# at 1e-6, so a drift here fails the build rather than shipping.
STATURE = 1.816
ANKLE_Z, KNEE_Z, HIP_Z = 0.0708, 0.5176, 0.9625
WAIST_Z, CHEST_Z = 1.1259, 1.3075                 # LUMBAR_Y, THORAX_Y
PELVIS_Z = 0.9988
SHOULDER_Z, NECK_Z, CHIN_Z, CROWN_Z = 1.4891, 1.4982, 1.5799, 1.816
HEAD_Z = 1.6253
SHOULDER_X, HIP_X = 0.2088, 0.0817
ELBOW_Z, WRIST_Z = 1.1441, 0.8808

# ── detail level ─────────────────────────────────────────────────────────────
# Every part carries a tier. --detail 1 builds only tiers 0-1 and lands under
# the original 1200-triangle game budget; the default builds everything.
#
# This is a switch rather than a rewrite because the two are wanted for
# different jobs: tier 1 is what you ship to run 24 of on screen, tier 2 is
# what you put in the menu, the store card and the render. Deleting the
# low-poly build to get a detailed one trades one for the other for no reason.
DETAIL = 2
TRI_BUDGETS = {0: 700, 1: 1200, 2: 2700}


# ── materials ────────────────────────────────────────────────────────────────
def make_materials():
    """Three flat materials, no textures, no image nodes.

    `diffuse_color` is set as well as the Principled inputs: Solid viewport
    shading reads that, not the node tree, so without it the whole character is
    default grey until you switch to Material Preview.
    """
    def mat(name, rgb, rough, *, emit=None, emit_strength=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Metallic"].default_value = 0.0
        if emit is not None:
            # Renamed in Blender 4.0; support both so the script is not pinned
            # to one release.
            col = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
            col.default_value = (*emit, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emit_strength
        m.diffuse_color = (*rgb, 1.0)        # Solid-mode viewport colour
        m.roughness = rough
        m.use_backface_culling = False       # standard: draw both sides
        return m

    return {
        "armor": mat("HERO_Armor_White", (0.92, 0.92, 0.94), 0.4),
        "dark":  mat("HERO_Undersuit_Charcoal", (0.055, 0.058, 0.065), 0.8),
        "visor": mat("HERO_Visor_Emissive", (0.95, 0.78, 0.12), 0.25,
                     emit=(1.0, 0.82, 0.10), emit_strength=5.0),
    }


# ── geometry ─────────────────────────────────────────────────────────────────
PARTS = []          # (object, bone_name)
_MATS = {}


def block(name, material, bone, at, size,
          top=(1.0, 1.0), top_off=(0.0, 0.0), bot_off=(0.0, 0.0), rot=None,
          tier=0):
    """A tapered box: 8 verts, 6 quads, 12 triangles.

    at        centre of the block
    size      full extents (x, y, z) measured at the BOTTOM face
    top       (x, y) scale of the top face relative to the bottom — the taper
    top_off   / bot_off   lateral shift of each face, for a leaning slab
    rot       Euler XYZ about the block's own centre
    """
    if tier > DETAIL:
        return None
    cx, cy, cz = at
    hx, hy, hz = size[0] / 2.0, size[1] / 2.0, size[2] / 2.0
    tx, ty = hx * top[0], hy * top[1]

    bx, by = bot_off
    ux, uy = top_off
    verts = [
        (bx - hx, by - hy, -hz), (bx + hx, by - hy, -hz),
        (bx + hx, by + hy, -hz), (bx - hx, by + hy, -hz),
        (ux - tx, uy - ty,  hz), (ux + tx, uy - ty,  hz),
        (ux + tx, uy + ty,  hz), (ux - tx, uy + ty,  hz),
    ]
    faces = [
        (0, 3, 2, 1),           # -Z
        (4, 5, 6, 7),           # +Z
        (0, 1, 5, 4),           # -Y  (front, the way the character faces)
        (1, 2, 6, 5),           # +X
        (2, 3, 7, 6),           # +Y
        (3, 0, 4, 7),           # -X
    ]

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    for poly in mesh.polygons:              # flat shading, explicitly
        poly.use_smooth = False
    mesh.materials.append(material)

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    if rot:
        obj.rotation_euler = Euler(rot, 'XYZ')
    obj.location = (cx, cy, cz)
    PARTS.append((obj, bone))
    return obj


def sided_bones():
    """The bone names that exist per-side, e.g. {'Clavicle', 'Thigh', …}."""
    return {n[:-2] for n, *_ in BONES if n.endswith(".L")}   # noqa


def mirrored(name, material, bone, at, size, **kw):
    """Build the same block on both sides.

    `bone` gets .L / .R appended ONLY if that bone is actually sided. A left
    and a right pectoral both ride the single `Chest` bone, and so do the helm
    cheeks on `Head` and the hip plates on `Pelvis` — suffixing those asks for
    `Chest.L`, which does not exist.

    Mirroring is also not just a negated x: a rotation that tilts a pauldron
    outward on one side tilts it inward on the other unless its Y and Z
    components flip too.
    """
    if kw.get("tier", 0) > DETAIL:
        return
    two_sided = bone in sided_bones()
    for side, s in (("L", 1.0), ("R", -1.0)):
        k = dict(kw)
        if "rot" in k and k["rot"]:
            rx, ry, rz = k["rot"]
            k["rot"] = (rx, ry * s, rz * s)
        for key in ("top_off", "bot_off"):
            if key in k and k[key]:
                k[key] = (k[key][0] * s, k[key][1])
        block(f"{name}.{side}", material,
              f"{bone}.{side}" if two_sided else bone,
              (at[0] * s, at[1], at[2]), size, **k)


def row(name, material, bone, start, step, count, size, **kw):
    """`count` copies of one block marching along `step`.

    Louvres, rivet lines and finger stacks are most of what a detail pass is,
    and hand-placing forty near-identical blocks is how you get one at the
    wrong offset that nobody spots until it is in the render.
    """
    for i in range(count):
        block(f"{name}{i}", material, bone,
              (start[0] + step[0] * i, start[1] + step[1] * i, start[2] + step[2] * i),
              size, **kw)


def mrow(name, material, bone, start, step, count, size, **kw):
    """`row`, mirrored — the step's x is mirrored with the start."""
    if kw.get("tier", 0) > DETAIL:
        return
    two_sided = bone in sided_bones()
    for side, sg in (("L", 1.0), ("R", -1.0)):
        for i in range(count):
            block(f"{name}{i}.{side}", material,
                  f"{bone}.{side}" if two_sided else bone,
                  (sg * (start[0] + step[0] * i), start[1] + step[1] * i,
                   start[2] + step[2] * i), size, **kw)


def build_mesh(M):
    A, D, V = M["armor"], M["dark"], M["visor"]
    R = math.radians

    # ── head: a segmented helm with the visor let into the front plate ───────
    block("Helm_Crown", A, "Head", (0, -0.005, 1.712), (0.230, 0.255, 0.135),
          top=(0.72, 0.78), top_off=(0, 0.012))
    block("Helm_Face", A, "Head", (0, -0.086, 1.668), (0.212, 0.115, 0.104),
          top=(1.05, 1.0), bot_off=(0, 0.012))
    block("Helm_Nape", D, "Head", (0, 0.094, 1.665), (0.190, 0.090, 0.140),
          top=(0.85, 0.9))
    block("Helm_Jaw", D, "Head", (0, -0.040, 1.586), (0.176, 0.195, 0.058),
          top=(1.12, 1.05))
    # The visor sits proud of the face plate so it catches its own silhouette
    # edge; buried flush it reads as a decal rather than a lens.
    block("Visor", V, "Head", (0, -0.146, 1.670), (0.186, 0.030, 0.050),
          top=(0.92, 1.0))
    block("Helm_Crest", A, "Head", (0, 0.012, 1.788), (0.036, 0.20, 0.036),
          top=(0.45, 0.80))
    mirrored("Helm_Cheek", A, "Head", (0.096, -0.052, 1.640),
             (0.034, 0.130, 0.088), top=(0.8, 0.85))
    block("Neck", D, "Neck", (0, 0.005, 1.545), (0.100, 0.104, 0.075))

    # ── torso: white plate over a recessed dark core ─────────────────────────
    # The core is deliberately NARROWER and set back, not merely darker: a
    # recess is read from the step in the silhouette, and two coplanar slabs in
    # different colours read as paint.
    block("Torso_Core", D, "Chest", (0, 0.005, 1.345), (0.300, 0.225, 0.235))
    mirrored("Chest_Pec", A, "Chest", (0.086, -0.072, 1.385),
             (0.150, 0.140, 0.180), top=(0.95, 0.85), top_off=(0.012, 0.012),
             rot=(0, R(-6), 0))
    block("Chest_Collar", A, "Chest", (0, -0.012, 1.470), (0.290, 0.215, 0.058),
          top=(0.70, 0.80), top_off=(0, 0.015))
    block("Back_Plate", A, "Chest", (0, 0.112, 1.375), (0.265, 0.085, 0.215),
          top=(0.88, 0.85))
    block("Chest_Glow", V, "Chest", (0, -0.130, 1.300), (0.056, 0.024, 0.032))

    # ── abdomen + pelvis ─────────────────────────────────────────────────────
    block("Abdomen_Core", D, "Spine", (0, 0.005, 1.195), (0.230, 0.190, 0.145))
    block("Abdomen_Plate", A, "Spine", (0, -0.072, 1.222), (0.185, 0.075, 0.070),
          top=(1.10, 1.0))
    # Three stacked lames rather than one slab: a segmented belly is the single
    # cheapest thing that says "armour" instead of "torso-shaped box", and each
    # step is a free silhouette break at 12 triangles.
    block("Ab_Lame_Mid", A, "Spine", (0, -0.074, 1.170), (0.176, 0.072, 0.036))
    block("Ab_Lame_Low", A, "Spine", (0, -0.070, 1.130), (0.166, 0.068, 0.034))
    block("Pelvis_Core", D, "Pelvis", (0, 0.005, 1.055), (0.265, 0.205, 0.135))
    block("Belt", D, "Pelvis", (0, 0.005, 1.118), (0.280, 0.220, 0.040))
    mirrored("Hip_Plate", A, "Pelvis", (0.128, -0.020, 1.020),
             (0.080, 0.190, 0.140), top=(1.0, 0.9), bot_off=(0.014, 0),
             rot=(0, R(9), 0))

    # ── pauldrons, offset outboard of the torso so the arm swings under ──────
    mirrored("Pauldron", A, "Clavicle", (0.246, -0.010, 1.448),
             (0.160, 0.235, 0.125), top=(0.78, 0.84), top_off=(-0.014, 0),
             rot=(0, R(14), 0))
    mirrored("Pauldron_Lame", A, "Clavicle", (0.262, -0.008, 1.352),
             (0.150, 0.205, 0.080), top=(0.92, 0.96), top_off=(-0.010, 0),
             rot=(0, R(18), 0))
    mirrored("Pauldron_Glow", V, "Clavicle", (0.318, -0.070, 1.408),
             (0.020, 0.030, 0.050))

    # ── arms: guard over undersuit, joints left bare ─────────────────────────
    mirrored("Bicep_Under", D, "UpperArm", (0.220, 0.0, 1.315),
             (0.120, 0.130, 0.235), top=(0.90, 0.92))
    mirrored("Bicep_Guard", A, "UpperArm", (0.228, -0.026, 1.330),
             (0.128, 0.105, 0.155), top=(0.88, 0.95), bot_off=(0.008, 0))
    mirrored("Forearm_Under", D, "LowerArm", (0.220, 0.0, 1.030),
             (0.104, 0.114, 0.235), top=(1.10, 1.10))
    mirrored("Forearm_Guard", A, "LowerArm", (0.224, -0.020, 1.010),
             (0.126, 0.118, 0.165), top=(0.82, 0.88), bot_off=(0.006, 0))
    mirrored("Hand", D, "Hand", (0.220, -0.004, 0.856),
             (0.096, 0.086, 0.115), top=(1.06, 1.08))

    # ── legs ─────────────────────────────────────────────────────────────────
    # Human leg silhouette: the thigh narrows decisively into a hidden knee,
    # then the calf uses two tapered masses instead of one straight column.
    # These are still rigid plates on the same bones, so the proven gameplay
    # gait remains stable while the standing/run silhouette stops reading as a
    # robot assembled from equal-width tubes.
    mirrored("Thigh_Under", D, "Thigh", (0.112, 0.0, 0.760),
             (0.154, 0.170, 0.365), top=(1.25, 1.15))
    mirrored("Thigh_Plate", A, "Thigh", (0.114, -0.064, 0.810),
             (0.158, 0.105, 0.225), top=(1.13, 1.02), top_off=(0.004, -0.006))
    mirrored("Thigh_Cuff", D, "Thigh", (0.112, -0.004, 0.595),
             (0.150, 0.158, 0.085), top=(1.02, 1.02))
    mirrored("Knee", D, "Thigh", (0.112, -0.014, 0.520),
             (0.142, 0.154, 0.090), top=(1.03, 1.02))
    mirrored("Shin_Upper", D, "Shin", (0.112, 0.0, 0.405),
             (0.132, 0.142, 0.200), top=(1.13, 1.12))
    mirrored("Shin_Lower", D, "Shin", (0.112, 0.0, 0.225),
             (0.112, 0.126, 0.170), top=(1.20, 1.13))
    mirrored("Shin_Plate", A, "Shin", (0.114, -0.056, 0.340),
             (0.138, 0.092, 0.250), top=(1.11, 1.04))
    mirrored("Shin_Glow", V, "Shin", (0.114, -0.118, 0.430),
             (0.032, 0.022, 0.075))
    # Thick, flat-bottomed sci-fi boot: the block flares DOWNWARD (top scale
    # below 1) so the widest line is the one on the floor.
    mirrored("Ankle_Cuff", D, "Foot", (0.112, -0.002, 0.145),
             (0.132, 0.142, 0.080), top=(0.92, 0.94))
    mirrored("Boot", A, "Foot", (0.112, -0.022, 0.092),
             (0.165, 0.248, 0.100), top=(0.84, 0.90), top_off=(0, 0.014))
    mirrored("Boot_Sole", D, "Foot", (0.112, -0.022, 0.020),
             (0.174, 0.262, 0.040), top=(0.97, 0.98))

    # ── detail pass ──────────────────────────────────────────────────────────
    # Every one of these is another 12-triangle block. They are placed to break
    # a long unbroken face or to bridge a gap between two parts — detail that
    # sits in the middle of a flat panel costs the same and reads as nothing.

    # helmet: brow over the visor, ear pods, chin vent
    block("Helm_Brow", A, "Head", (0, -0.150, 1.706), (0.196, 0.036, 0.026),
          top=(0.90, 1.0), tier=1)
    mirrored("Helm_Ear", D, "Head", (0.116, 0.005, 1.672),
             (0.028, 0.090, 0.078), top=(0.85, 0.9), tier=1)
    block("Helm_Vent", D, "Head", (0, -0.100, 1.566), (0.100, 0.048, 0.026), tier=1)

    # chest: sternum ridge, collar clamps, vents under the pectorals, and the
    # bolt the pauldron pivots on — that gap between torso and shoulder was
    # reading as a missing part rather than an articulation.
    block("Chest_Sternum", A, "Chest", (0, -0.140, 1.395), (0.052, 0.030, 0.140),
          top=(0.80, 1.0), tier=1)
    mirrored("Collar_Clamp", D, "Chest", (0.118, -0.030, 1.492),
             (0.052, 0.100, 0.040), tier=1)
    mirrored("Chest_Vent", D, "Chest", (0.082, -0.118, 1.286),
             (0.086, 0.038, 0.040), tier=1)
    mirrored("Shoulder_Bolt", D, "Chest", (0.196, -0.004, 1.432),
             (0.060, 0.110, 0.090), top=(0.92, 0.94), tier=1)

    # back pack — the back was one flat plate from every rear angle
    block("Pack_Main", A, "Chest", (0, 0.176, 1.372), (0.190, 0.080, 0.190),
          top=(0.86, 0.90), tier=1)
    mirrored("Pack_Vent", D, "Chest", (0.062, 0.212, 1.318), (0.060, 0.036, 0.070), tier=1)
    mirrored("Pack_Glow", V, "Chest", (0.062, 0.232, 1.318), (0.040, 0.016, 0.048), tier=1)

    # pelvis
    block("Belt_Buckle", A, "Pelvis", (0, -0.112, 1.118), (0.072, 0.026, 0.050), tier=1)
    block("Groin_Plate", A, "Pelvis", (0, -0.062, 0.988), (0.110, 0.096, 0.090),
          top=(1.10, 1.0), tier=1)
    block("Hip_Rear", A, "Pelvis", (0, 0.112, 1.030), (0.180, 0.070, 0.120),
          top=(0.95, 0.95), tier=1)

    # arms: deltoid under the pauldron, elbow bridging bicep to forearm,
    # cuff at the wrist, knuckles on the hand
    mirrored("Deltoid_Cap", A, "UpperArm", (0.222, -0.006, 1.424),
             (0.126, 0.140, 0.070), top=(0.86, 0.88), tier=1)
    mirrored("Elbow_Pad", D, "LowerArm", (0.222, -0.012, 1.160),
             (0.122, 0.132, 0.070), tier=1)
    mirrored("Wrist_Cuff", A, "Hand", (0.222, -0.008, 0.928),
             (0.118, 0.108, 0.046), tier=1)
    mirrored("Knuckle", A, "Hand", (0.220, -0.040, 0.878),
             (0.092, 0.030, 0.052), tier=1)

    # legs: knee cap over the joint, an outboard thigh pod, a calf behind the
    # shin, an ankle collar and a toe cap on the boot
    mirrored("Knee_Cap", A, "Thigh", (0.114, -0.080, 0.520),
             (0.130, 0.070, 0.100), top=(0.90, 0.90), tier=1)
    mirrored("Thigh_Pod", A, "Thigh", (0.196, -0.010, 0.800),
             (0.048, 0.150, 0.170), top=(0.90, 0.90), tier=1)
    mirrored("Calf_Plate", A, "Shin", (0.112, 0.082, 0.330),
             (0.130, 0.060, 0.230), top=(0.90, 0.90), tier=1)
    mirrored("Ankle_Guard", D, "Foot", (0.112, -0.010, 0.168),
             (0.152, 0.170, 0.060), tier=1)
    mirrored("Boot_Toe", D, "Foot", (0.112, -0.132, 0.062),
             (0.166, 0.056, 0.062), top=(0.95, 0.90), tier=1)

    # ═══ tier 2 ═══════════════════════════════════════════════════════════════
    # Everything below is skipped by --detail 1. It is greeble: panel lines,
    # louvres, rivets and rims. None of it changes the silhouette, which is why
    # it is the part you can afford to drop — but on a flat-shaded model with no
    # textures it is the ONLY thing standing between a big white panel and a
    # blank one, because there is no normal map doing that job.

    # ── hands: fingers ──────────────────────────────────────────────────────
    # A hand as one block is the single most obviously unfinished thing on the
    # model, and four small blocks fix it for 48 triangles a side.
    mrow("Finger", D, "Hand", (0.190, -0.012, 0.772), (0.020, 0, 0), 4,
         (0.017, 0.056, 0.058), top=(0.9, 0.9), tier=2)
    mirrored("Thumb", D, "Hand", (0.176, -0.032, 0.812),
             (0.024, 0.030, 0.050), tier=2)

    # ── helmet ──────────────────────────────────────────────────────────────
    block("Visor_Rim_Top", D, "Head", (0, -0.152, 1.700), (0.192, 0.026, 0.014), tier=2)
    block("Visor_Rim_Bot", D, "Head", (0, -0.150, 1.640), (0.186, 0.026, 0.012), tier=2)
    row("Jaw_Vent", D, "Head", (-0.042, -0.128, 1.566), (0.042, 0, 0), 3,
        (0.024, 0.020, 0.030), tier=2)
    block("Antenna", A, "Head", (0.070, 0.086, 1.808), (0.014, 0.014, 0.070),
          top=(0.5, 0.5), tier=2)
    mirrored("Crest_Fin", A, "Head", (0.030, 0.030, 1.776),
             (0.014, 0.140, 0.028), top=(0.6, 0.7), tier=2)

    # ── torso panelling ─────────────────────────────────────────────────────
    mrow("Rib_Louvre", D, "Chest", (0.104, -0.126, 1.246), (0, 0, -0.030), 3,
         (0.072, 0.024, 0.018), tier=2)
    mirrored("Chest_Strap", D, "Chest", (0.052, -0.132, 1.452),
             (0.040, 0.040, 0.070), rot=(0, 0, 0), tier=2)
    mirrored("Torso_Side", A, "Chest", (0.152, 0.004, 1.330),
             (0.030, 0.180, 0.150), top=(0.85, 0.9), tier=2)
    mirrored("Tech_Port", V, "Chest", (0.150, -0.070, 1.240),
             (0.016, 0.030, 0.030), tier=2)
    block("Spine_Line", D, "Chest", (0, 0.152, 1.372), (0.030, 0.030, 0.180),
          top=(0.8, 1.0), tier=2)

    # ── pauldron rims and rivets ────────────────────────────────────────────
    mirrored("Pauldron_Rim", D, "Clavicle", (0.246, -0.010, 1.386),
             (0.164, 0.238, 0.020), rot=(0, math.radians(14), 0), tier=2)
    mrow("Pauldron_Rivet", D, "Clavicle", (0.196, -0.086, 1.470), (0.030, 0.020, -0.008), 3,
         (0.016, 0.016, 0.016), tier=2)

    # ── back pack ───────────────────────────────────────────────────────────
    row("Pack_Rib", D, "Chest", (0, 0.216, 1.430), (0, 0, -0.052), 3,
        (0.150, 0.024, 0.018), tier=2)
    mirrored("Pack_Pipe", D, "Chest", (0.104, 0.190, 1.392),
             (0.026, 0.026, 0.140), top=(0.8, 0.8), tier=2)
    block("Pack_Core", V, "Chest", (0, 0.222, 1.430), (0.058, 0.020, 0.014), tier=2)

    # ── waist ───────────────────────────────────────────────────────────────
    mirrored("Oblique", D, "Spine", (0.110, -0.020, 1.180),
             (0.030, 0.130, 0.120), top=(0.85, 0.9), tier=2)
    row("Lame_Edge", D, "Spine", (0, -0.106, 1.152), (0, 0, -0.040), 2,
        (0.150, 0.018, 0.010), tier=2)
    block("Ab_Glow", V, "Spine", (0, -0.108, 1.208), (0.034, 0.018, 0.020), tier=2)

    # ── pelvis / thigh straps ───────────────────────────────────────────────
    mirrored("Hip_Vent", D, "Pelvis", (0.150, -0.070, 1.052),
             (0.036, 0.048, 0.056), tier=2)
    mirrored("Thigh_Strap", D, "Thigh", (0.113, -0.012, 0.906),
             (0.190, 0.210, 0.028), tier=2)

    # ── arms ────────────────────────────────────────────────────────────────
    mirrored("Bicep_Band", D, "UpperArm", (0.221, 0.0, 1.238),
             (0.128, 0.138, 0.026), tier=2)
    mrow("Forearm_Fin", A, "LowerArm", (0.286, -0.030, 1.058), (0, 0, -0.058), 2,
         (0.020, 0.086, 0.040), top=(0.7, 0.8), tier=2)
    mirrored("Forearm_Glow", V, "LowerArm", (0.224, -0.084, 1.056),
             (0.020, 0.020, 0.062), tier=2)
    mirrored("Elbow_Spike", D, "LowerArm", (0.222, 0.062, 1.160),
             (0.056, 0.050, 0.048), top=(0.5, 0.5), tier=2)

    # ── legs ────────────────────────────────────────────────────────────────
    mrow("Thigh_Louvre", D, "Thigh", (0.196, -0.052, 0.856), (0, 0, -0.038), 3,
         (0.052, 0.026, 0.020), tier=2)
    mrow("Knee_Bolt", D, "Thigh", (0.076, -0.108, 0.540), (0.076, 0, 0), 2,
         (0.020, 0.020, 0.020), tier=2)
    mrow("Shin_Fin", A, "Shin", (0.192, -0.048, 0.376), (0, 0, -0.070), 2,
         (0.022, 0.076, 0.048), top=(0.7, 0.8), tier=2)
    mrow("Boot_Buckle", D, "Foot", (0.112, -0.104, 0.118), (0, 0, -0.046), 2,
         (0.150, 0.040, 0.020), tier=2)
    mirrored("Boot_Heel", D, "Foot", (0.112, 0.106, 0.062),
             (0.140, 0.048, 0.062), top=(0.9, 0.9), tier=2)
    mirrored("Boot_Glow", V, "Foot", (0.176, -0.030, 0.084),
             (0.016, 0.070, 0.024), tier=2)






# ── emitting the model for the game ──────────────────────────────────────────
# The engine builds its characters procedurally, with no runtime asset load, so
# this ships a DATA MODULE rather than a .glb: the same eight corners per block
# and the same bone table, written out as JS. One source of truth, no fetch to
# fail, and the parts arrive as a real SkinnedMesh instead of a node hierarchy.
#
# Frame conversion. Blender here is +Z up with the character facing −Y; the game
# is +Y up with characters facing −Z (AGENTS.md 4). The map is
#
#     (x, y, z)_blender  →  (−x, z, y)_game
#
# which has determinant +1, so it is a rotation and no winding flips. The x
# negation matters for more than handedness: Blender's .L is +X, the game's left
# is −X, and without the flip every left-side part would arrive on the right
# with the animation driving the opposite limb.
def to_game(v):
    return (-v[0], v[2], v[1])


FACES = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
         (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]


def emit_js(path):
    import json

    game = {}
    for name, head, tail, parent, connect, g in BONES:
        game[name] = g
        if name.endswith(".L"):
            game[name[:-2] + ".R"] = g[:-1] + "R" if g.endswith("L") else g + "R"

    bones = []
    for name, head, tail, parent, connect, g in BONES:
        bones.append((name, head, parent, g))
        if name.endswith(".L"):
            r = name[:-2] + ".R"
            rp = parent[:-2] + ".R" if parent and parent.endswith(".L") else parent
            bones.append((r, (-head[0], head[1], head[2]), rp, game[r]))

    lines = ["// GENERATED by tools/model_player.py — do not edit by hand.",
             "//",
             "// Re-generate with:  python3 tools/model_player.py -- --js src/player/heroParts.js",
             "//",
             "// Coordinates are already in the GAME's frame (+Y up, facing -Z) and on",
             "// the Proportions.js figure, so nothing here needs a fix-up rotation or a",
             "// scale. Each part is eight corners and one bone; weights are rigid.",
             "",
             "export const BONES = ["]
    for name, head, parent, g in bones:
        h = to_game(head)
        pg = game.get(parent) if parent else None
        lines.append("  { name: %s, parent: %s, at: [%.5f, %.5f, %.5f] }," % (
            json.dumps(g), json.dumps(pg) if pg else "null", h[0], h[1], h[2]))
    lines += ["];", "", "export const FACES = %s;" % json.dumps(FACES), "",
              "export const PARTS = ["]

    mat_key = {}
    for k, m in _MATS.items():
        mat_key[m.name] = k
    for obj, bone in PARTS:
        mw = obj.matrix_world
        vs = [to_game(mw @ v.co) for v in obj.data.vertices]
        flat = ", ".join("%.5f" % c for v in vs for c in v)
        lines.append("  { n: %s, m: %s, b: %s, v: [%s] }," % (
            json.dumps(obj.name), json.dumps(mat_key[obj.data.materials[0].name]),
            json.dumps(game[bone] if bone in game else bone), flat))
    lines += ["];", ""]

    with open(path, "w") as f:
        f.write("\n".join(lines))
    print(f"[hero] wrote {path} ({len(PARTS)} parts, {len(bones)} bones)")


# ── armature ─────────────────────────────────────────────────────────────────
#           name          head                       tail                      parent      connected
# Hand and Foot were not in the original brief's bone list, but the game drives
# both: Locomotion rotates the ankle to plant a foot, and RifleCarry IKs to the
# wrist. Without them the boots would swing off the shin and the hands off the
# forearm. GAME is the name each bone takes when the model is emitted for the
# engine — the game's chain is offset by one from the anatomical naming here
# (its `kneeL` is the SHIN, the bone AT the knee; its `ankleL` is the foot).
BONES = [
    #  name          head                        tail                        parent        connect  GAME
    ("Root",       (0, 0, 0.0),                (0, 0, 0.16),               None,         False, "root"),
    ("Pelvis",     (0, 0, PELVIS_Z),           (0, 0, WAIST_Z),            "Root",       False, "hips"),
    ("Spine",      (0, 0, WAIST_Z),            (0, 0, CHEST_Z),            "Pelvis",     True,  "spine"),
    ("Chest",      (0, 0, CHEST_Z),            (0, 0, NECK_Z),             "Spine",      True,  "chest"),
    ("Neck",       (0, 0, NECK_Z),             (0, 0, HEAD_Z),             "Chest",      True,  "neck"),
    ("Head",       (0, 0, HEAD_Z),             (0, 0, CROWN_Z),            "Neck",       True,  "head"),
    ("Clavicle.L", (0.034, 0, 1.452),          (SHOULDER_X, 0, SHOULDER_Z), "Chest",     False, "clavicleL"),
    ("UpperArm.L", (SHOULDER_X, 0, SHOULDER_Z), (SHOULDER_X, 0, ELBOW_Z),  "Clavicle.L", True,  "shoulderL"),
    ("LowerArm.L", (SHOULDER_X, 0, ELBOW_Z),   (SHOULDER_X, 0, WRIST_Z),   "UpperArm.L", True,  "elbowL"),
    ("Hand.L",     (SHOULDER_X, 0, WRIST_Z),   (SHOULDER_X, 0, WRIST_Z - 0.10), "LowerArm.L", True, "handL"),
    ("Thigh.L",    (HIP_X, 0, HIP_Z),          (HIP_X, 0, KNEE_Z),         "Pelvis",     False, "thighL"),
    ("Shin.L",     (HIP_X, 0, KNEE_Z),         (HIP_X, 0, ANKLE_Z),        "Thigh.L",    True,  "kneeL"),
    ("Foot.L",     (HIP_X, 0, ANKLE_Z),        (HIP_X, -0.16, ANKLE_Z),    "Shin.L",     True,  "ankleL"),
]


def build_armature():
    arm_data = bpy.data.armatures.new("HeroRig")
    arm = bpy.data.objects.new("HeroRig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    arm.show_in_front = True
    # mode_set polls the ACTIVE object, and some builds want it selected too.
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')

    def add(name, head, tail, parent, connect):
        b = arm_data.edit_bones.new(name)
        b.head, b.tail, b.roll = Vector(head), Vector(tail), 0.0
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = connect
        return b

    for name, head, tail, parent, connect, _game in BONES:
        add(name, head, tail, parent, connect)
        if name.endswith(".L"):          # mirror the whole arm/leg chain
            mx = lambda v: (-v[0], v[1], v[2])
            add(name[:-2] + ".R", mx(head), mx(tail),
                parent[:-2] + ".R" if parent and parent.endswith(".L") else parent,
                connect)

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def parent_to_bones(arm):
    """Rigid BONE parenting, one plate to one bone.

    Automatic Weights is the other option the brief allows, and it is the wrong
    one here: it needs a single skinned mesh, and it would smoothly blend rigid
    armour plates across joints — a shin plate would bend at the knee. These
    parts are hard surfaces, so each is parented outright to the bone it rides.

    Blender parents to a bone's TAIL, so the object jumps unless the transform
    is compensated. Re-assigning matrix_world after the parent is set does that
    without hand-building the inverse matrix.
    """
    for obj, bone_name in PARTS:
        if bone_name not in arm.data.bones:
            raise KeyError(f"{obj.name} wants bone {bone_name!r}, which does not exist")
        keep = obj.matrix_world.copy()
        obj.parent = arm
        obj.parent_type = 'BONE'
        obj.parent_bone = bone_name
        obj.matrix_world = keep


# ── scene ────────────────────────────────────────────────────────────────────
def set_viewport_shading():
    """Material Preview where there is a UI; a no-op under --background."""
    for window in getattr(bpy.context.window_manager, "windows", []):
        for area in window.screen.areas:
            if area.type == 'VIEW_3D':
                for space in area.spaces:
                    if space.type == 'VIEW_3D':
                        space.shading.type = 'MATERIAL'
                        space.shading.use_scene_lights = True


def count_triangles():
    total = 0
    for obj, _ in PARTS:
        if hasattr(obj.data, "calc_loop_triangles"):   # removed from 4.1's API path
            obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def script_args():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def main():
    global DETAIL
    args = script_args()
    out = os.path.abspath("ev_io_player_model.blend")
    if "--out" in args:
        out = os.path.abspath(args[args.index("--out") + 1])
    if "--detail" in args:
        DETAIL = int(args[args.index("--detail") + 1])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    PARTS.clear()

    mats = make_materials()
    global _MATS
    _MATS = mats
    build_mesh(mats)
    arm = build_armature()
    parent_to_bones(arm)

    tris = count_triangles()
    budget = TRI_BUDGETS[DETAIL]
    print(f"[hero] detail {DETAIL}: {len(PARTS)} parts, {tris} triangles "
          f"(budget {budget})")
    if tris >= budget:
        raise SystemExit(f"[hero] over budget: {tris} >= {budget} triangles")

    set_viewport_shading()
    bpy.context.view_layer.objects.active = arm

    bpy.ops.wm.save_as_mainfile(filepath=out)
    print(f"[hero] wrote {out}")

    if "--js" in args:
        emit_js(os.path.abspath(args[args.index("--js") + 1]))

    if "--glb" in args:
        glb = os.path.splitext(out)[0] + ".glb"
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB',
                                  export_apply=True)
        print(f"[hero] wrote {glb}")


if __name__ == "__main__":
    main()
