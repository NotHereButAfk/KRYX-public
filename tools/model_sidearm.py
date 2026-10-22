"""
Blender (bpy) model script — the reference-chart Glock 17 (Pulse Pistol),
built with the traced-silhouette + punched-hole technique on gunlib:
  - slide = one extruded side profile (chamfered nose)
  - frame + grip = one extruded profile with the trigger-guard opening
    boolean-punched through it, orange grip panels riding the sides
Materials are named so the game's GLB loader remaps them (body / metal /
dark_metal / energy). Exports public/sidearm.glb with node weapon_sidearm.

Run:  python3 tools/model_sidearm.py
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from gunlib import reset, make_mats, Gun, export

reset()
MATS = make_mats()
R = math.radians
ZB = 0.072   # bore line

g = Gun(MATS)

# ── SLIDE: one traced profile, chamfered nose (chart) ──────────────────────
g.profile([
    (0.145, ZB+0.032), (0.150, ZB+0.020),     # rear top corner
    (0.150, ZB-0.018),                         # rear bottom
    (-0.130, ZB-0.018),                        # slide underside
    (-0.168, ZB-0.012),                        # nose bottom
    (-0.168, ZB+0.016),                        # muzzle face
    (-0.152, ZB+0.032),                        # nose chamfer
], 0.052, 'dark', bevel=0.005, seg=2)
g.box((0, -0.01, ZB+0.036), (0.036, 0.29, 0.010), 'dark', bevel=0.003)   # raised top rib

# ── FRAME + GRIP: one profile, trigger guard punched through ───────────────
frame = g.profile([
    (0.150, ZB-0.016),                         # rear, under the slide
    (0.190, ZB-0.185),                         # raked backstrap
    (0.180, ZB-0.214),                         # grip heel
    (0.116, ZB-0.220),                         # grip toe
    (0.085, ZB-0.115),                         # frontstrap top
    (0.020, ZB-0.130),                         # guard underside rear
    (-0.048, ZB-0.128),                        # guard underside front
    (-0.058, ZB-0.060),                        # guard front rising
    (-0.062, ZB-0.020),                        # dust cover front
], 0.048, 'dark', bevel=0.005, seg=2)
g.hole_rect(frame, 0.012, ZB-0.075, 0.105, 0.062, bevel=0.016)   # trigger-guard opening
g.box((0, 0.040, ZB-0.070), (0.010, 0.012, 0.056), 'metal')      # trigger (anchored above the hole)

# ── grip furniture: ORANGE side panels + frontstrap finger bumps (chart) ───
g.box((0.023, 0.145, ZB-0.12), (0.004, 0.075, 0.125), 'body', bevel=0.004, rot=(R(14), 0, 0))
g.box((-0.023, 0.145, ZB-0.12), (0.004, 0.075, 0.125), 'body', bevel=0.004, rot=(R(14), 0, 0))
g.row((0.0252, 0.128, ZB-0.170), (0, 0.012, 0.024), 3, (0.002, 0.014, 0.016), 'dark')  # stipple R
g.row((-0.0252, 0.128, ZB-0.170), (0, 0.012, 0.024), 3, (0.002, 0.014, 0.016), 'dark') # stipple L
g.box((0, 0.108, ZB-0.192), (0.042, 0.014, 0.012), 'body', bevel=0.003, rot=(R(14), 0, 0))  # finger bump 1
g.box((0, 0.100, ZB-0.163), (0.042, 0.014, 0.012), 'body', bevel=0.003, rot=(R(14), 0, 0))  # finger bump 2
g.box((0, 0.092, ZB-0.134), (0.042, 0.014, 0.012), 'body', bevel=0.003, rot=(R(14), 0, 0))  # finger bump 3
g.box((0, 0.150, ZB-0.226), (0.046, 0.08, 0.012), 'dark', bevel=0.003, rot=(R(14), 0, 0))   # magwell plate
g.box((0.0245, 0.075, ZB-0.100), (0.002, 0.022, 0.012), 'body')  # mag release nub R (orange, chart)
g.box((-0.0245, 0.075, ZB-0.100), (0.002, 0.022, 0.012), 'body') # mag release nub L

# ── frame hardware lines ───────────────────────────────────────────────────
g.box((0.0245, -0.02, ZB-0.017), (0.002, 0.22, 0.006), 'metal')  # rail line R
g.box((-0.0245, -0.02, ZB-0.017), (0.002, 0.22, 0.006), 'metal') # rail line L
g.box((0.0245, 0.030, ZB-0.038), (0.002, 0.035, 0.007), 'metal') # takedown lever R
g.box((-0.0245, 0.030, ZB-0.038), (0.002, 0.035, 0.007), 'metal')# takedown lever L
g.cyl((0, 0.02, ZB-0.045), 0.0035, 0.052, 'metal', axis='X')     # frame pin

# ── slide dress-up: chart's green cuts + orange lock block ─────────────────
g.box((0.0265, -0.03, ZB+0.014), (0.004, 0.07, 0.024), 'metal')  # ejection port
for i in range(5):   # rear serrations — GREEN bars
    g.box((0, 0.085 - i*0.014, ZB+0.004), (0.054, 0.006, 0.044), 'energy', bevel=0)
for i in range(4):   # front serrations — GREEN bars
    g.box((0, -0.150 + i*0.010, ZB+0.004), (0.054, 0.005, 0.036), 'energy', bevel=0)
for i in range(3):   # slanted slashes, both flanks
    g.box((0.0265, -0.115 + i*0.024, ZB+0.016), (0.004, 0.010, 0.030), 'energy', bevel=0, rot=(R(28), 0, 0))
    g.box((-0.0265, -0.115 + i*0.024, ZB+0.016), (0.004, 0.010, 0.030), 'energy', bevel=0, rot=(R(28), 0, 0))
g.box((0.0265, 0.0, ZB+0.024), (0.004, 0.13, 0.007), 'energy')   # long side stripe R
g.box((-0.0265, 0.0, ZB+0.024), (0.004, 0.13, 0.007), 'energy')  # long side stripe L
g.box((0, -0.05, ZB+0.043), (0.010, 0.14, 0.005), 'energy')      # top stripe
g.box((0.0265, -0.045, ZB-0.012), (0.004, 0.013, 0.013), 'energy')   # green square R
g.box((-0.0265, -0.045, ZB-0.012), (0.004, 0.013, 0.013), 'energy')  # green square L
g.box((0.0265, -0.095, ZB-0.010), (0.004, 0.05, 0.022), 'body', bevel=0.002, rot=(R(20), 0, 0))  # orange lock block R
g.box((-0.0265, -0.095, ZB-0.010), (0.004, 0.05, 0.022), 'body', bevel=0.002, rot=(R(20), 0, 0)) # orange lock block L

# ── sights + muzzle ────────────────────────────────────────────────────────
g.box((0, 0.135, ZB+0.044), (0.024, 0.016, 0.014), 'dark', bevel=0.003)  # rear sight
g.box((0.008, 0.139, ZB+0.050), (0.004, 0.005, 0.005), 'energy', bevel=0)
g.box((-0.008, 0.139, ZB+0.050), (0.004, 0.005, 0.005), 'energy', bevel=0)
g.box((0, -0.155, ZB+0.040), (0.010, 0.014, 0.012), 'dark', bevel=0.003) # front sight
g.box((0, -0.158, ZB+0.048), (0.005, 0.006, 0.005), 'energy', bevel=0)
g.cyl((0, -0.172, ZB+0.004), 0.015, 0.012, 'metal')              # crown
g.cyl((0, -0.177, ZB+0.004), 0.010, 0.008, 'energy', verts=14)   # glowing bore

g.finish('sidearm', (0, -0.185, ZB+0.004), scale=0.92)
export(os.path.join(os.path.dirname(__file__), "..", "public", "sidearm.glb"))
