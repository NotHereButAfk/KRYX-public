"""
Blender 4.x headless script — builds human Spartan-style character models for KYX.IO.

Run with:
  blender --background --python build_player.py

Output: public/player.glb
  armor_assault  — balanced tactical plate
  armor_recon    — light scout, slim
  armor_heavy    — juggernaut, imposing
  armor_stealth  — infiltrator, minimal

Coordinate mapping (Three.js Y-up → Blender Z-up):
  position  (tx,ty,tz) → Blender (tx, tz, ty)
  box scale (w, h, d)  → Blender (w,  d,  h)
  Character faces −Y in Blender; the game rotates.y=PI after GLB load.
"""

import bpy
import math
import os

C = bpy.context
D = bpy.data

# ── Clear scene ──────────────────────────────────────────────────────────────
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for m in list(D.meshes):    D.meshes.remove(m)
for m in list(D.materials): D.materials.remove(m)


# ── Materials ────────────────────────────────────────────────────────────────
# Names must end in the suffix so the game's endsWith() check fires.
# Trim / DarkJoint / Visor are kept as-is from the GLB; the game replaces
# _Primary and _Secondary with skin colours at runtime.

def mk_mat(suffix, col, metal=0.0, rough=0.5, alpha=1.0, emit=(0,0,0), emit_str=0.0):
    m = D.materials.new(f'char_{suffix}')
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    if b:
        b.inputs['Base Color'].default_value = (*col, 1.0)
        b.inputs['Metallic'].default_value   = metal
        b.inputs['Roughness'].default_value  = rough
        if alpha < 1.0:
            b.inputs['Alpha'].default_value = alpha
            m.blend_method = 'BLEND'
        # Emission (Blender 4 uses 'Emission Color' + 'Emission Strength')
        for ename in ('Emission Color', 'Emission'):
            if ename in b.inputs:
                b.inputs[ename].default_value = (*emit, 1.0)
                break
        if 'Emission Strength' in b.inputs:
            b.inputs['Emission Strength'].default_value = emit_str
    return m

MATS = {
    'Primary':   mk_mat('Primary',   (0.18,0.20,0.25), metal=0.52, rough=0.42),
    'Secondary': mk_mat('Secondary', (0.04,0.04,0.05), metal=0.06, rough=0.82),
    'Trim':      mk_mat('Trim',      (0.55,0.62,0.68), metal=0.88, rough=0.22),
    'DarkJoint': mk_mat('DarkJoint', (0.02,0.02,0.03), metal=0.06, rough=0.80),
    'Visor':     mk_mat('Visor',     (0.00,0.85,1.00), metal=0.00, rough=0.04,
                        alpha=0.84,  emit=(0.0,0.85,1.0), emit_str=1.4),
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def desel():
    bpy.ops.object.select_all(action='DESELECT')

def sel_act(obj):
    desel()
    obj.select_set(True)
    C.view_layer.objects.active = obj

def smooth(obj):
    sel_act(obj)
    bpy.ops.object.shade_smooth()

def assign_mat(obj, suffix):
    obj.data.materials.clear()
    obj.data.materials.append(MATS[suffix])

def mk_empty(name):
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0,0,0))
    e = C.active_object
    e.name = name
    return e

# Three.js → Blender coordinate helpers
def tp(tx, ty, tz): return (tx, tz, ty)          # position
def ts(tw, th, td): return (tw, td, th)           # box scale


# ── Primitive factories ───────────────────────────────────────────────────────

def box(name, w, h, d, tloc, parent, mat):
    """Bevelled box. w=Three-X, h=Three-Y(up), d=Three-Z(depth)."""
    desel()
    bpy.ops.mesh.primitive_cube_add(size=1, location=tp(*tloc))
    obj = C.active_object
    obj.name = name
    obj.scale = ts(w, h, d)
    bpy.ops.object.transform_apply(scale=True)
    # Light bevel makes plates look machined rather than plastic
    mod = obj.modifiers.new('Bv', 'BEVEL')
    mod.width    = min(w, h, d) * 0.07
    mod.segments = 2
    mod.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier='Bv')
    obj.parent = parent
    assign_mat(obj, mat)
    return obj

def sph(name, r, tloc, parent, mat, segs=16, rings=12):
    """UV sphere — genuinely round, shade-smooth applied."""
    desel()
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=r, segments=segs, ring_count=rings, location=tp(*tloc))
    obj = C.active_object
    obj.name = name
    smooth(obj)
    obj.parent = parent
    assign_mat(obj, mat)
    return obj

def cyl(name, r, h, tloc, parent, mat, segs=12):
    """Vertical cylinder (along Blender Z = Three.js Y)."""
    desel()
    bpy.ops.mesh.primitive_cylinder_add(
        radius=r, depth=h, vertices=segs, location=tp(*tloc))
    obj = C.active_object
    obj.name = name
    smooth(obj)
    obj.parent = parent
    assign_mat(obj, mat)
    return obj


# ════════════════════════════════════════════════════════════════════════════════
# ASSAULT — standard balanced Spartan tactical plate
# ════════════════════════════════════════════════════════════════════════════════
def build_assault():
    p = mk_empty('armor_assault')

    # ── Boots ──────────────────────────────────────────────────────────────────
    for sx in (-0.15, 0.15):
        s = 'L' if sx < 0 else 'R'
        box(f'boot_{s}',     0.21,0.22,0.31, (sx, 0.11,  0.02), p,'Primary')
        box(f'sole_{s}',     0.23,0.04,0.33, (sx, 0.005, 0.02), p,'Trim')
        box(f'bootheel_{s}', 0.23,0.09,0.29, (sx, 0.23,  0.01), p,'Primary')

    # ── Lower legs ─────────────────────────────────────────────────────────────
    for sx in (-0.15, 0.15):
        s = 'L' if sx < 0 else 'R'
        cyl(f'lleg_{s}',  0.095,0.38, (sx,  0.53,  0),     p,'Secondary')
        box(f'shinp_{s}', 0.17,0.38,0.06, (sx, 0.53, -0.10), p,'Primary')
        # Sphere knee — genuinely round instead of a flat box
        sph(f'knsph_{s}', 0.115,      (sx,  0.76, -0.06),  p,'Primary', segs=12, rings=8)

    # ── Thighs ─────────────────────────────────────────────────────────────────
    for sx, si in ((-0.15,-1),(0.15,1)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'thigh_{s}', 0.12,0.36, (sx,           1.04, 0), p,'Secondary')
        box(f'tpl_{s}',   0.14,0.34,0.10, (sx-si*0.13, 1.04, 0), p,'Primary')

    # ── Hips ───────────────────────────────────────────────────────────────────
    box('hips', 0.47,0.12,0.29, (0, 1.21, 0), p,'Primary')
    box('belt', 0.49,0.07,0.31, (0, 1.27, 0), p,'Secondary')

    # ── Torso ──────────────────────────────────────────────────────────────────
    cyl('torso',       0.28,0.48, (0, 1.56,  0),     p,'Secondary', segs=16)
    box('chest',       0.51,0.51,0.10, (0, 1.56,-0.18), p,'Primary')
    box('chest_trim',  0.51,0.025,0.10,(0, 1.815,-0.18),p,'Trim')
    box('backp',       0.49,0.44,0.09, (0, 1.56, 0.18), p,'Primary')
    box('collar',      0.31,0.08,0.31, (0, 1.85,  0),   p,'Primary')

    # ── Pauldrons ──────────────────────────────────────────────────────────────
    for sx, ax in ((-1,-0.35),(1,0.35)):
        s = 'L' if sx < 0 else 'R'
        sph(f'shoulder_{s}', 0.11,         (ax,     1.76, 0), p,'Secondary', segs=12,rings=8)
        box(f'pau_{s}',  0.23,0.21,0.33,   (sx*0.44,1.76, 0), p,'Primary')
        box(f'pau_top_{s}',0.26,0.06,0.35, (sx*0.44,1.87, 0), p,'Primary')
        # Glowing stripe on shoulder — Visor material stays lit from GLB
        box(f'pvs_{s}',  0.008,0.19,0.33,  (sx*0.555,1.76,0), p,'Visor')

    # ── Arms ───────────────────────────────────────────────────────────────────
    for sx, ax in ((-1,-0.38),(1,0.38)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'uarm_{s}',  0.090,0.34, (ax, 1.52, 0),        p,'Secondary')
        sph(f'elbow_{s}', 0.095,      (ax, 1.31, 0),        p,'Primary', segs=12,rings=8)
        cyl(f'farm_{s}',  0.080,0.28, (ax, 1.10, 0),        p,'Secondary')
        box(f'vamb_{s}',  0.16,0.28,0.06, (ax, 1.10,-0.09), p,'Primary')
        box(f'hand_{s}',  0.18,0.14,0.16, (ax, 0.85,  0),   p,'Secondary')

    # ── Helmet — sphere dome over box lower hull ────────────────────────────────
    # Lower hull forms the jaw/cheek area
    box('helm_lower',  0.38,0.28,0.40, (0, 2.00,  0),    p,'Primary')
    # The sphere dome sits on top — genuinely round, not a box!
    sph('helm_dome',   0.215,          (0, 2.17,  0),    p,'Primary')
    # Cheek guards
    for sx in (-1, 1):
        s = 'L' if sx < 0 else 'R'
        box(f'cheek_{s}', 0.06,0.22,0.32, (sx*0.215, 2.02, 0), p,'Primary')
    # Visor — dark recess then glowing band
    box('helm_vbg',    0.37,0.12,0.06,  (0, 2.09,-0.19), p,'DarkJoint')
    box('helm_vis',    0.30,0.09,0.04,  (0, 2.09,-0.22), p,'Visor')
    # Brow ridge trim
    box('helm_brow',   0.38,0.04,0.09,  (0, 2.17,-0.19), p,'Trim')
    # Back panel
    box('helm_back',   0.36,0.38,0.08,  (0, 2.05, 0.22), p,'Primary')
    # Neck
    cyl('neck',        0.12,0.10,        (0, 1.87,  0),  p,'Secondary')

    return p


# ════════════════════════════════════════════════════════════════════════════════
# RECON — light scout, slim plate carrier, ballistic dome helmet
# ════════════════════════════════════════════════════════════════════════════════
def build_recon():
    p = mk_empty('armor_recon')

    # ── Boots ──────────────────────────────────────────────────────────────────
    for sx in (-0.13, 0.13):
        s = 'L' if sx < 0 else 'R'
        box(f'boot_{s}',     0.18,0.20,0.28, (sx, 0.10,  0.01), p,'Secondary')
        box(f'sole_{s}',     0.20,0.03,0.30, (sx, 0.005, 0.01), p,'Trim')
        box(f'bootheel_{s}', 0.18,0.08,0.25, (sx, 0.22,  0.01), p,'Primary')

    # ── Lower legs ─────────────────────────────────────────────────────────────
    for sx in (-0.13, 0.13):
        s = 'L' if sx < 0 else 'R'
        cyl(f'lleg_{s}',  0.085,0.38, (sx, 0.52, 0),       p,'Secondary')
        box(f'shinp_{s}', 0.10,0.22,0.05, (sx, 0.52,-0.09), p,'Primary')
        sph(f'knsph_{s}', 0.095,      (sx, 0.74,-0.05),    p,'Primary', segs=10,rings=7)

    # ── Thighs ─────────────────────────────────────────────────────────────────
    for sx, si in ((-0.13,-1),(0.13,1)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'thigh_{s}', 0.105,0.36, (sx, 1.03, 0), p,'Secondary')
        box(f'tpl_{s}',   0.10,0.26,0.07, (sx-si*0.10, 1.03, 0), p,'Primary')

    # ── Hips ───────────────────────────────────────────────────────────────────
    box('hips', 0.38,0.10,0.26, (0, 1.20, 0), p,'Secondary')
    box('belt', 0.40,0.06,0.28, (0, 1.26, 0), p,'Primary')

    # ── Torso — plate carrier ──────────────────────────────────────────────────
    cyl('torso',  0.25,0.46, (0, 1.54, 0),       p,'Secondary', segs=16)
    box('chest',  0.42,0.24,0.10, (0, 1.60,-0.16), p,'Primary')
    box('collar', 0.28,0.06,0.28, (0, 1.82,  0),   p,'Secondary')
    box('backp',  0.22,0.36,0.10, (0, 1.58, 0.16), p,'Secondary')

    # ── Slim pauldrons ─────────────────────────────────────────────────────────
    for sx, ax in ((-1,-0.29),(1,0.29)):
        s = 'L' if sx < 0 else 'R'
        sph(f'shoulder_{s}', 0.09, (ax, 1.74, 0), p,'Secondary', segs=10,rings=7)
        box(f'pau_{s}', 0.16,0.10,0.24, (sx*0.38, 1.76, 0), p,'Primary')

    # ── Arms ───────────────────────────────────────────────────────────────────
    for sx, ax in ((-1,-0.34),(1,0.34)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'uarm_{s}',  0.082,0.34, (ax, 1.50, 0),        p,'Secondary')
        sph(f'elbow_{s}', 0.085,      (ax, 1.30, 0),        p,'Primary', segs=10,rings=7)
        cyl(f'farm_{s}',  0.075,0.28, (ax, 1.09, 0),        p,'Secondary')
        box(f'wrist_{s}', 0.14,0.06,0.10, (ax, 0.95,-0.04), p,'Secondary')
        box(f'hand_{s}',  0.16,0.14,0.15, (ax, 0.84,  0),   p,'Secondary')

    # ── Helmet — ballistic dome + goggles visor ────────────────────────────────
    box('helm_lower',  0.34,0.22,0.38, (0, 2.04,  0),   p,'Primary')
    sph('helm_dome',   0.190,          (0, 2.20,  0),   p,'Primary')
    # NVG mount bracket
    box('nvg_arm',     0.06,0.04,0.10, (0, 2.31,-0.10), p,'Trim')
    box('nvg_bar',     0.12,0.03,0.04, (0, 2.32,-0.15), p,'Trim')
    # Goggles visor
    box('helm_vbg',    0.28,0.09,0.05, (0, 2.07,-0.19), p,'DarkJoint')
    box('helm_vis',    0.24,0.07,0.04, (0, 2.07,-0.22), p,'Visor')
    # Ear guards
    for sx in (-1, 1):
        s = 'L' if sx < 0 else 'R'
        box(f'ear_{s}', 0.04,0.10,0.18, (sx*0.185, 2.09, 0), p,'Primary')
    box('helm_back',   0.32,0.24,0.07, (0, 2.06, 0.22), p,'Primary')
    cyl('neck',        0.11,0.09,       (0, 1.87,  0),  p,'Secondary')

    return p


# ════════════════════════════════════════════════════════════════════════════════
# HEAVY — juggernaut full plate, widest silhouette
# ════════════════════════════════════════════════════════════════════════════════
def build_heavy():
    p = mk_empty('armor_heavy')

    # ── Boots ──────────────────────────────────────────────────────────────────
    for sx in (-0.18, 0.18):
        s = 'L' if sx < 0 else 'R'
        box(f'boot_{s}',     0.27,0.28,0.36, (sx, 0.14,  0.02), p,'Primary')
        box(f'sole_{s}',     0.30,0.05,0.38, (sx, 0.005, 0.02), p,'Trim')
        box(f'bootheel_{s}', 0.29,0.12,0.34, (sx, 0.28,  0.01), p,'Primary')

    # ── Lower legs (double-plated) ─────────────────────────────────────────────
    for sx in (-0.18, 0.18):
        s = 'L' if sx < 0 else 'R'
        cyl(f'lleg_{s}',   0.12,0.38,  (sx, 0.55,  0),     p,'Secondary')
        box(f'shinp_{s}',  0.23,0.40,0.09, (sx, 0.55,-0.13), p,'Primary')
        box(f'shinp2_{s}', 0.19,0.30,0.07, (sx, 0.55,-0.09), p,'Primary')
        sph(f'knsph_{s}',  0.145,       (sx, 0.79, -0.08),  p,'Primary', segs=12,rings=8)

    # ── Thighs ─────────────────────────────────────────────────────────────────
    for sx, si in ((-0.18,-1),(0.18,1)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'thigh_{s}',  0.15,0.38,  (sx, 1.07, 0),           p,'Secondary')
        box(f'tpl_{s}',    0.20,0.38,0.13, (sx-si*0.17, 1.07, 0), p,'Primary')
        box(f'tplf_{s}',   0.16,0.28,0.10, (sx, 1.07,-0.12),      p,'Primary')

    # ── Hips ───────────────────────────────────────────────────────────────────
    box('hips', 0.58,0.16,0.36, (0, 1.24, 0), p,'Primary')
    box('belt', 0.60,0.08,0.38, (0, 1.32, 0), p,'Secondary')

    # ── Torso (double chest plate) ─────────────────────────────────────────────
    cyl('torso',   0.34,0.54, (0, 1.60,  0),     p,'Secondary', segs=16)
    box('chest',   0.60,0.55,0.12, (0, 1.60,-0.20), p,'Primary')
    box('chest2',  0.54,0.48,0.07, (0, 1.60,-0.14), p,'Primary')
    box('backp',   0.36,0.50,0.12, (0, 1.64, 0.20), p,'Primary')
    box('pack',    0.38,0.50,0.16, (0, 1.64, 0.24), p,'Secondary')
    box('collar',  0.42,0.10,0.38, (0, 1.90,  0),   p,'Primary')
    # Pec panel visor strips
    for px in (-0.26, 0.26):
        s = 'L' if px < 0 else 'R'
        box(f'pec_pvs_{s}', 0.03,0.32,0.009, (px, 1.64,-0.265), p,'Visor')

    # ── Massive pauldrons ──────────────────────────────────────────────────────
    for sx, ax in ((-1,-0.43),(1,0.43)):
        s = 'L' if sx < 0 else 'R'
        sph(f'shoulder_{s}', 0.13,          (ax,      1.80, 0), p,'Secondary', segs=12,rings=8)
        box(f'pau_{s}',  0.34,0.28,0.42,    (sx*0.56, 1.78, 0), p,'Primary')
        box(f'pau2_{s}', 0.38,0.09,0.46,    (sx*0.56, 1.90, 0), p,'Primary')
        box(f'pau3_{s}', 0.38,0.09,0.46,    (sx*0.56, 1.66, 0), p,'Primary')
        box(f'pvs_{s}',  0.01,0.26,0.42,    (sx*0.755,1.78, 0), p,'Visor')

    # ── Arms (thick plated) ────────────────────────────────────────────────────
    for sx, ax in ((-1,-0.48),(1,0.48)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'uarm_{s}',   0.12,0.34,  (ax, 1.54,  0),        p,'Secondary')
        box(f'uarmp_{s}',  0.24,0.36,0.06, (ax, 1.54,-0.11),  p,'Primary')
        sph(f'elbow_{s}',  0.12,       (ax, 1.32,  0),        p,'Primary', segs=12,rings=8)
        cyl(f'farm_{s}',   0.11,0.30,  (ax, 1.10,  0),        p,'Secondary')
        box(f'vamb_{s}',   0.22,0.32,0.08, (ax, 1.10,-0.11),  p,'Primary')
        box(f'hand_{s}',   0.24,0.18,0.22, (ax, 0.83,  0),    p,'Secondary')

    # ── Helmet — full face, narrow visor slit ──────────────────────────────────
    # Sphere gives a round top even on the heavy helmet
    sph('helm_dome',   0.255,           (0, 2.10,  0),   p,'Primary')
    box('helm_body',   0.48,0.50,0.50,  (0, 2.10,  0),   p,'Primary')
    box('helm_top',    0.42,0.14,0.48,  (0, 2.34,  0),   p,'Primary')
    box('faceplate',   0.46,0.48,0.06,  (0, 2.10,-0.28), p,'Primary')
    # Narrow horizontal visor slit
    box('helm_vbg',    0.40,0.08,0.06,  (0, 2.18,-0.30), p,'DarkJoint')
    box('helm_vis',    0.34,0.06,0.05,  (0, 2.18,-0.32), p,'Visor')
    # Cheek armour
    for sx in (-1, 1):
        s = 'L' if sx < 0 else 'R'
        box(f'cheek_{s}', 0.09,0.32,0.38, (sx*0.285, 2.10, 0), p,'Primary')
    box('helm_back',   0.44,0.50,0.09,  (0, 2.10, 0.28), p,'Primary')
    cyl('neck',        0.16,0.09,        (0, 1.87,  0),  p,'Secondary')

    return p


# ════════════════════════════════════════════════════════════════════════════════
# STEALTH — slim infiltrator, partial face mask, minimal plates
# ════════════════════════════════════════════════════════════════════════════════
def build_stealth():
    p = mk_empty('armor_stealth')

    # ── Boots ──────────────────────────────────────────────────────────────────
    for sx in (-0.12, 0.12):
        s = 'L' if sx < 0 else 'R'
        box(f'boot_{s}',     0.17,0.18,0.28, (sx, 0.09,  0),    p,'Secondary')
        box(f'sole_{s}',     0.19,0.03,0.30, (sx, 0.005, 0),    p,'Trim')
        box(f'bootheel_{s}', 0.16,0.08,0.22, (sx, 0.20,  0.01), p,'Primary')

    # ── Lower legs ─────────────────────────────────────────────────────────────
    for sx in (-0.12, 0.12):
        s = 'L' if sx < 0 else 'R'
        cyl(f'lleg_{s}',  0.080,0.38, (sx, 0.52, 0),       p,'Secondary')
        box(f'shinp_{s}', 0.08,0.18,0.04, (sx, 0.52,-0.085), p,'Primary')
        sph(f'knsph_{s}', 0.082,      (sx, 0.72,-0.04),    p,'Primary', segs=10,rings=7)

    # ── Thighs ─────────────────────────────────────────────────────────────────
    for sx, si in ((-0.12,-1),(0.12,1)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'thigh_{s}', 0.10,0.36, (sx, 1.02, 0), p,'Secondary')
        box(f'tpl_{s}',   0.08,0.20,0.06, (sx-si*0.08, 1.02, 0), p,'Primary')

    # ── Hips ───────────────────────────────────────────────────────────────────
    box('hips', 0.34,0.09,0.24, (0, 1.19, 0), p,'Secondary')
    box('belt', 0.36,0.06,0.26, (0, 1.25, 0), p,'Primary')

    # ── Torso — tactical vest, minimal ─────────────────────────────────────────
    cyl('torso',  0.23,0.44, (0, 1.52, 0),       p,'Secondary', segs=16)
    box('chest',  0.36,0.36,0.07, (0, 1.54,-0.15), p,'Primary')
    box('backp',  0.38,0.38,0.06, (0, 1.54, 0.14), p,'Secondary')
    box('pack',   0.14,0.20,0.08, (0, 1.62, 0.19), p,'Secondary')
    box('collar', 0.26,0.06,0.26, (0, 1.80,  0),   p,'Secondary')

    # ── Slim pauldrons ─────────────────────────────────────────────────────────
    for sx, ax in ((-1,-0.26),(1,0.26)):
        s = 'L' if sx < 0 else 'R'
        sph(f'shoulder_{s}', 0.085, (ax, 1.72, 0), p,'Secondary', segs=10,rings=7)
        box(f'pau_{s}', 0.12,0.08,0.20, (sx*0.34, 1.74, 0), p,'Primary')

    # ── Arms (bare, wrist-device) ──────────────────────────────────────────────
    for sx, ax in ((-1,-0.31),(1,0.31)):
        s = 'L' if sx < 0 else 'R'
        cyl(f'uarm_{s}',  0.075,0.34, (ax, 1.49, 0),        p,'Secondary')
        sph(f'elbow_{s}', 0.080,      (ax, 1.30, 0),        p,'Primary', segs=10,rings=7)
        cyl(f'farm_{s}',  0.070,0.28, (ax, 1.08, 0),        p,'Secondary')
        box(f'wrist_{s}', 0.13,0.10,0.12, (ax, 0.96,-0.02), p,'Secondary')
        box(f'wrisd_{s}', 0.11,0.05,0.014,(ax, 0.96,-0.076),p,'Visor')
        box(f'hand_{s}',  0.15,0.12,0.14, (ax, 0.83,  0),   p,'Secondary')

    # ── Helmet — partial, with lower face mask ─────────────────────────────────
    box('helm_top',  0.33,0.22,0.38, (0, 2.07,  0),   p,'Primary')
    sph('helm_dome', 0.185,          (0, 2.18,  0),   p,'Primary')
    # Upper visor (goggles style)
    box('helm_vbg',  0.32,0.10,0.05, (0, 2.13,-0.19), p,'DarkJoint')
    box('helm_vis',  0.28,0.08,0.04, (0, 2.13,-0.22), p,'Visor')
    # Lower face — respirator mask (exposes forehead/top which shows the dome)
    box('mask',      0.25,0.14,0.10, (0, 1.97,-0.16), p,'Secondary')
    for mpx in (-0.08, 0.08):
        ms = 'L' if mpx < 0 else 'R'
        box(f'vent_{ms}', 0.04,0.04,0.024, (mpx, 1.97,-0.215), p,'Trim')
    # Ear comms
    for sx in (-1, 1):
        s = 'L' if sx < 0 else 'R'
        box(f'ear_{s}', 0.04,0.10,0.16, (sx*0.185, 2.10, 0.02), p,'Secondary')
    box('helm_back', 0.30,0.20,0.06, (0, 2.10, 0.22), p,'Primary')
    # Hood drape behind neck
    box('hood',      0.32,0.28,0.08, (0, 1.90, 0.16), p,'Secondary')
    cyl('neck',      0.11,0.08,       (0, 1.87,  0),  p,'Secondary')

    return p


# ── Build all four armor types ─────────────────────────────────────────────────
build_assault()
build_recon()
build_heavy()
build_stealth()

print(f"Built {len([o for o in D.objects if o.type == 'MESH'])} mesh objects")

# ── Export GLB ─────────────────────────────────────────────────────────────────
out = '/home/user/Ev.io/public/player.glb'
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=False,
    export_apply=True,          # apply any remaining modifiers
    export_materials='EXPORT',
    export_cameras=False,
    export_lights=False,
)
print(f"✓  Exported → {out}  ({os.path.getsize(out):,} bytes)")
