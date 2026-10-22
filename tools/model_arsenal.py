"""
Models the whole arsenal as DETAILED real-firearm builds (grey steel + orange
furniture via the body role + energy accents) and exports one combined
public/weapons_authored.glb with a weapon_<id> node per gun.

Deep-detail pass: each gun carries its real hardware — sight hoods, knurled
collars, rivets, belt links, barrel fluting, handguard vents, checkering,
pins/screws — ~40-70 parts per weapon.

Run:  python3 tools/model_arsenal.py
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(__file__))
import bpy
from gunlib import reset, make_mats, Gun, export

reset()
MATS = make_mats()
R = math.radians
Z = 0.07   # shared bore line height


# ═════════════════════════════════════════════════════════════════════════════
# IMI Uzi — stamped receiver w/ grip grooves, hooded front sight, folding stock
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, 0.0, Z), (0.055, 0.30, 0.075), 'dark', bevel=0.006)               # receiver
g.row((0.0285, -0.10, Z), (0, 0.025, 0), 9, (0.002, 0.012, 0.055), 'metal') # side grooves R
g.row((-0.0285, -0.10, Z), (0, 0.025, 0), 9, (0.002, 0.012, 0.055), 'metal')# side grooves L
g.box((0, -0.02, Z+0.042), (0.032, 0.24, 0.012), 'dark')                    # top cover
g.row((0, -0.10, Z+0.049), (0, 0.03, 0), 7, (0.026, 0.006, 0.004), 'metal') # top cover ribs
g.box((0, 0.055, Z+0.052), (0.016, 0.028, 0.016), 'metal', bevel=0.002)     # cocking knob
g.box((0, 0.055, Z+0.062), (0.022, 0.014, 0.006), 'dark')                   # knob cap
g.box((0, 0.03, -0.045), (0.042, 0.055, 0.16), 'body', bevel=0.006)         # grip
g.row((0, 0.056, -0.11), (0, 0, 0.028), 4, (0.044, 0.004, 0.010), 'dark')   # backstrap grooves
g.box((0.0225, 0.014, -0.02), (0.004, 0.018, 0.03), 'metal')                # mag release
g.box((-0.028, 0.055, Z-0.032), (0.006, 0.03, 0.008), 'metal')              # selector
g.box((0, 0.03, -0.15), (0.036, 0.045, 0.075), 'metal', bevel=0.003)        # mag protruding
g.box((0, 0.03, -0.192), (0.039, 0.048, 0.012), 'dark')                     # mag floorplate
g.box((0, -0.038, -0.050), (0.026, 0.125, 0.016), 'dark')                   # guard bottom (buried into grip)
g.box((0, -0.09, 0.005), (0.026, 0.014, 0.095), 'dark')                     # guard front (buried into receiver)
g.box((0, -0.02, -0.03), (0.010, 0.012, 0.035), 'metal')                    # trigger
g.cyl((0, -0.20, Z), 0.014, 0.10, 'metal')                                   # barrel
g.box((0, -0.205, Z), (0.034, 0.09, 0.034), 'dark', bevel=0.004)             # square barrel shroud (chart)
g.box((0, -0.19, Z-0.026), (0.024, 0.055, 0.024), 'dark', bevel=0.004)       # under-lug stub (chart)
g.cyl((0, -0.158, Z), 0.021, 0.026, 'dark')                                  # barrel nut
g.knurl((0, -0.158, Z), 0.021, 10, (0.006, 0.020, 0.006), 'metal')           # nut knurling
# hooded front sight: post + two side ears
g.box((0, -0.145, Z+0.048), (0.006, 0.010, 0.024), 'metal')
g.box((0.012, -0.145, Z+0.046), (0.004, 0.014, 0.028), 'dark')
g.box((-0.012, -0.145, Z+0.046), (0.004, 0.014, 0.028), 'dark')
# three wide green pills per side on the upper receiver (chart)
g.row((0.0285, -0.11, Z+0.022), (0, 0.075, 0), 3, (0.003, 0.045, 0.013), 'energy')
g.row((-0.0285, -0.11, Z+0.022), (0, 0.075, 0), 3, (0.003, 0.045, 0.013), 'energy')
# recessed green bar low on the rear receiver flank (chart)
g.box((0.0285, 0.105, Z-0.024), (0.002, 0.048, 0.011), 'energy')
g.box((-0.0285, 0.105, Z-0.024), (0.002, 0.048, 0.011), 'energy')
g.box((0, 0.13, Z+0.040), (0.026, 0.014, 0.010), 'dark')                     # rear sight frame
g.box((0, 0.13, Z+0.048), (0.008, 0.012, 0.010), 'metal')                    # aperture blade
# FOLDED stock (chart): orange wedge hung off the rear of the receiver
g.box((0, 0.165, Z+0.002), (0.042, 0.055, 0.055), 'body', bevel=0.006)       # hinge block
g.box((0, 0.175, Z-0.05), (0.042, 0.038, 0.095), 'body', bevel=0.006, rot=(R(24), 0, 0))  # folded arm
g.box((0, 0.19, Z-0.105), (0.046, 0.05, 0.032), 'body', bevel=0.006)         # folded butt pad
g.row((-0.014, 0.19, Z-0.123), (0.014, 0, 0), 3, (0.006, 0.044, 0.005), 'dark')  # pad ribs
g.finish('uzi', (0, -0.26, Z), scale=1.55)

# ═════════════════════════════════════════════════════════════════════════════
# Winchester M1887 — octagon-hint barrel, loop lever, hammer, checkered wood
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.cyl((0, -0.30, Z+0.02), 0.0145, 0.52, 'metal', verts=8)                    # octagonal barrel
g.cyl((0, -0.26, Z-0.012), 0.011, 0.42, 'metal')                             # mag tube
g.cyl((0, -0.468, Z-0.012), 0.0125, 0.014, 'dark')                           # tube end cap
g.box((0, -0.06, Z+0.004), (0.03, 0.05, 0.03), 'metal')                      # tube/receiver join
g.box((0, 0.02, Z), (0.046, 0.17, 0.085), 'dark', bevel=0.006)               # receiver
g.box((0.0235, 0.02, Z+0.01), (0.002, 0.13, 0.06), 'metal')                  # side plate R
g.box((-0.0235, 0.02, Z+0.01), (0.002, 0.13, 0.06), 'metal')                 # side plate L
g.cyl((0.026, -0.01, Z+0.012), 0.004, 0.006, 'metal', axis='X')              # pin 1
g.cyl((0.026, 0.05, Z+0.012), 0.004, 0.006, 'metal', axis='X')               # pin 2
g.box((0.024, -0.045, Z+0.018), (0.004, 0.03, 0.022), 'metal')               # loading gate
g.box((0, -0.02, Z+0.046), (0.03, 0.08, 0.012), 'dark')                      # top flat
g.box((0.0238, -0.03, Z+0.026), (0.002, 0.09, 0.022), 'energy')              # green receiver panel R (chart)
g.box((-0.0238, -0.03, Z+0.026), (0.002, 0.09, 0.022), 'energy')             # green receiver panel L
g.box((0.0238, 0.075, Z+0.028), (0.002, 0.016, 0.016), 'energy')             # green square, rear corner R
g.box((-0.0238, 0.075, Z+0.028), (0.002, 0.016, 0.016), 'energy')            # green square, rear corner L
g.cyl((0, -0.50, Z+0.02), 0.0155, 0.010, 'energy')                           # green barrel ring
g.box((0, -0.28, Z+0.0355), (0.006, 0.48, 0.008), 'energy')                  # green stripe along the WHOLE barrel top (chart)
g.box((0, 0.095, Z+0.024), (0.012, 0.028, 0.03), 'metal', rot=(R(-35), 0, 0))# hammer spur
g.row((0, 0.098, Z+0.040), (0, 0.006, -0.004), 3, (0.014, 0.003, 0.004), 'dark')  # hammer serrations (on the spur face)
# BIG orange forend slab wrapping both tubes (chart look)
g.box((0, -0.26, Z+0.004), (0.06, 0.17, 0.085), 'body', bevel=0.014)         # forend
g.row((0.0305, -0.31, Z+0.004), (0, 0.028, 0), 5, (0.002, 0.014, 0.05), 'dark')   # checkering R
g.row((-0.0305, -0.31, Z+0.004), (0, 0.028, 0), 5, (0.002, 0.014, 0.05), 'dark')  # checkering L
g.box((0, 0.20, Z-0.03), (0.044, 0.22, 0.075), 'body', bevel=0.010, rot=(R(14), 0, 0))  # stock
g.box((0, 0.13, Z-0.055), (0.040, 0.075, 0.055), 'body', bevel=0.010, rot=(R(28), 0, 0))# wrist curve
g.box((0, 0.315, Z-0.065), (0.05, 0.02, 0.085), 'dark', rot=(R(14), 0, 0))   # butt plate
g.row((0, 0.322, Z-0.10), (0, 0.004, 0.022), 3, (0.044, 0.003, 0.007), 'metal')  # plate ribs
# lever loop — ONE orange plate with the loop opening punched through (chart)
lever = g.profile([
    (0.105, Z-0.038),                          # rear top (into the receiver)
    (0.112, Z-0.100),                          # rear edge down
    (0.098, Z-0.138),                          # rear-bottom round
    (-0.045, Z-0.142),                         # bottom run forward
    (-0.064, Z-0.108),                         # front-bottom round
    (-0.058, Z-0.055),                         # front edge rising
    (-0.045, Z-0.038),                         # front top (into the receiver)
], 0.020, 'body', bevel=0.004, seg=2)
g.hole_rect(lever, 0.024, Z-0.094, 0.118, 0.058, bevel=0.020)    # the D-loop opening
g.cyl((0.014, 0.085, Z-0.046), 0.005, 0.028, 'metal', axis='X')  # lever pivot pin
g.box((0, -0.012, Z-0.060), (0.010, 0.012, 0.045), 'metal')      # trigger (hangs into the loop)
g.box((0, -0.545, Z+0.038), (0.008, 0.010, 0.014), 'metal')                  # bead base
g.cyl((0, -0.548, Z+0.048), 0.004, 0.008, 'energy', axis='Z', verts=10)      # glowing bead
g.finish('levershotgun', (0, -0.565, Z+0.02), scale=1.2)

# ═════════════════════════════════════════════════════════════════════════════
# AR-15 family — deep shared builder: M4 / M16A2 / SR-25
# ═════════════════════════════════════════════════════════════════════════════
def build_ar(blen, hg_len, stock='collapsible', scope=False, carry=False, mag_len=0.10, hg_round=False,
             grip='body', flips=False):
    a = Gun(MATS)
    a.box((0, 0.03, Z+0.012), (0.05, 0.20, 0.05), 'dark', bevel=0.005)       # upper
    a.box((0, 0.05, Z-0.032), (0.048, 0.16, 0.045), 'dark', bevel=0.005)     # lower
    a.box((0.026, 0.005, Z+0.016), (0.004, 0.05, 0.026), 'metal')            # ejection port
    a.box((0.027, 0.045, Z+0.012), (0.004, 0.018, 0.018), 'dark')            # deflector
    a.cyl((0.028, 0.07, Z+0.008), 0.008, 0.010, 'metal', axis='X')           # forward assist
    a.box((0, 0.115, Z+0.030), (0.026, 0.03, 0.012), 'metal')                # charging handle
    a.box((-0.018, 0.115, Z+0.030), (0.010, 0.022, 0.010), 'dark')           # ch latch
    a.box((0, 0.03, Z+0.044), (0.03, 0.18, 0.014), 'metal')                  # rail base
    a.row((0, -0.05, Z+0.052), (0, 0.018, 0), 10, (0.028, 0.008, 0.004), 'dark')  # rail teeth
    a.box((-0.026, 0.075, Z-0.02), (0.004, 0.03, 0.012), 'metal')            # bolt catch
    a.box((-0.027, 0.10, Z-0.008), (0.005, 0.022, 0.008), 'metal')           # selector
    a.cyl((0.026, 0.055, Z-0.022), 0.006, 0.006, 'metal', axis='X')          # mag release
    # handguard + vents
    hgz = -0.13 - (hg_len - 0.16) / 2
    a.box((0, hgz, Z+0.005), (0.052, hg_len, 0.055), 'body', bevel=0.014 if hg_round else 0.010)
    a.row((0.027, hgz - hg_len/2 + 0.03, Z+0.005), (0, 0.03, 0), int(hg_len/0.03) - 1, (0.002, 0.014, 0.026), 'dark')
    a.row((-0.027, hgz - hg_len/2 + 0.03, Z+0.005), (0, 0.03, 0), int(hg_len/0.03) - 1, (0.002, 0.014, 0.026), 'dark')
    a.cyl((0, hgz, Z+0.038), 0.006, hg_len*0.8, 'metal')                     # gas tube
    a.cyl((0, hgz + hg_len/2 + 0.012, Z+0.005), 0.017, 0.025, 'dark')        # delta ring
    # barrel + FSB + flash hider
    brl_z = hgz - hg_len/2 - blen/2
    a.cyl((0, brl_z, Z+0.005), 0.010, blen, 'metal')                          # barrel (pencil)
    a.cyl((0, brl_z + blen*0.25, Z+0.005), 0.012, blen*0.4, 'metal')          # barrel step
    fsb_y = brl_z + blen/2 - 0.02
    a.box((0, fsb_y, Z+0.032), (0.016, 0.02, 0.058), 'dark', rot=(R(10), 0, 0))   # FSB A-frame front
    a.box((0, fsb_y + 0.018, Z+0.032), (0.016, 0.02, 0.058), 'dark', rot=(R(-10), 0, 0))  # rear leg
    a.box((0, fsb_y + 0.009, Z+0.010), (0.020, 0.036, 0.026), 'dark')        # FSB base on barrel
    a.box((0, fsb_y + 0.009, Z+0.066), (0.007, 0.009, 0.022), 'metal')       # front post
    a.ring((0, fsb_y + 0.007, Z-0.012), 0.007, 0.002, 'metal', axis='X')     # sling swivel
    fh_y = brl_z - blen/2 - 0.024
    a.cyl((0, fh_y, Z+0.005), 0.014, 0.052, 'dark')                          # A2 birdcage
    a.row((0.0145, fh_y - 0.005, Z+0.005), (0, 0.012, 0), 3, (0.002, 0.006, 0.018), 'metal')  # slots
    a.row((-0.0145, fh_y - 0.005, Z+0.005), (0, 0.012, 0), 3, (0.002, 0.006, 0.018), 'metal')
    # grip + guard + trigger (chart M4/SR-25 grips are grey, M16's orange)
    a.box((0, 0.10, Z-0.075), (0.04, 0.05, 0.09), grip, bevel=0.008, rot=(R(20), 0, 0))
    a.row((0, 0.133, Z-0.094), (0, -0.010, 0.028), 3, (0.042, 0.004, 0.007), 'dark')  # grip grooves (on the backstrap)
    a.box((0, 0.045, Z-0.10), (0.026, 0.09, 0.012), 'dark')
    a.box((0, 0.0, Z-0.075), (0.026, 0.012, 0.05), 'dark')
    a.box((0, 0.012, Z-0.055), (0.010, 0.012, 0.035), 'metal')
    # magazine w/ ribs + floorplate
    a.box((0, -0.02, Z-0.09), (0.036, 0.05, mag_len), 'metal', bevel=0.004, rot=(R(-8), 0, 0))
    a.row((0, -0.038, Z-0.065), (0, 0.012, -0.024), 3, (0.038, 0.004, 0.010), 'dark', rot=(R(-8), 0, 0))
    a.box((0, -0.006, Z-0.09 - mag_len/2 + 0.006, ), (0.039, 0.052, 0.012), 'dark', rot=(R(-8), 0, 0))
    # stock
    if stock == 'collapsible':
        a.cyl((0, 0.16, Z+0.005), 0.018, 0.10, 'body')                        # buffer tube (orange, chart)
        a.knurl((0, 0.125, Z+0.005), 0.019, 8, (0.005, 0.014, 0.005), 'metal')# castle nut
        a.box((0, 0.235, Z-0.005), (0.046, 0.09, 0.075), 'body', bevel=0.008)
        a.box((0, 0.21, Z+0.032), (0.04, 0.05, 0.014), 'body')                # cheek
        a.box((0, 0.205, Z-0.048), (0.044, 0.075, 0.03), 'body', bevel=0.008, rot=(R(-28), 0, 0))  # angled underside (M4 look)
        a.box((0, 0.285, Z-0.005), (0.05, 0.016, 0.085), 'dark')              # butt pad
        a.row((0, 0.294, Z-0.035), (0, 0, 0.022), 3, (0.044, 0.004, 0.007), 'metal')
        a.ring((0, 0.255, Z-0.045), 0.007, 0.002, 'metal', axis='X')          # sling loop
    else:
        a.box((0, 0.22, Z-0.02), (0.046, 0.20, 0.08), 'body', bevel=0.010, rot=(R(8), 0, 0))
        a.box((0, 0.15, Z+0.028), (0.042, 0.08, 0.02), 'body', rot=(R(8), 0, 0))
        a.box((0, 0.315, Z-0.045), (0.05, 0.02, 0.09), 'dark', rot=(R(8), 0, 0))
        a.row((0, 0.330, Z-0.08), (0, -0.004, 0.027), 3, (0.044, 0.003, 0.007), 'metal')
    if carry:
        a.box((0, 0.03, Z+0.066), (0.022, 0.15, 0.026), 'dark', bevel=0.004)  # carry handle
        a.box((0, -0.035, Z+0.056), (0.018, 0.02, 0.012), 'dark')             # front leg
        a.box((0, 0.095, Z+0.056), (0.018, 0.02, 0.012), 'dark')              # rear leg
        a.box((0, 0.09, Z+0.082), (0.008, 0.014, 0.010), 'metal')             # aperture
        a.cyl((0.013, 0.045, Z+0.066), 0.005, 0.008, 'metal', axis='X')       # windage drum
    if scope:
        a.cyl((0, 0.01, Z+0.078), 0.019, 0.17, 'dark')                        # tube
        a.cyl((0, -0.075, Z+0.078), 0.026, 0.045, 'dark')                     # objective
        a.cyl((0, 0.095, Z+0.078), 0.022, 0.035, 'dark')                      # ocular
        a.cyl((0, 0.01, Z+0.101), 0.007, 0.014, 'metal', axis='Z')            # elevation
        a.cyl((0.024, 0.01, Z+0.078), 0.006, 0.012, 'metal', axis='X')        # windage
        a.box((0, -0.03, Z+0.056), (0.014, 0.03, 0.018), 'metal')             # ring F
        a.box((0, 0.05, Z+0.056), (0.014, 0.03, 0.018), 'metal')              # ring R
        a.cyl((0, 0.114, Z+0.078), 0.019, 0.006, 'energy')                    # glowing ocular lens
    if flips:
        # tall flip-up irons front + rear on the top rail (chart SR-25)
        a.box((0, 0.105, Z+0.062), (0.016, 0.018, 0.030), 'dark')             # rear base
        a.box((0, 0.105, Z+0.084), (0.009, 0.009, 0.016), 'metal')            # rear aperture
        a.box((0, -0.045, Z+0.062), (0.016, 0.018, 0.030), 'dark')            # front base
        a.box((0, -0.045, Z+0.084), (0.006, 0.008, 0.016), 'metal')           # front post
    return a

g = build_ar(0.16, 0.16, carry=True, grip='dark'); g.finish('m4', (0, -0.40, Z+0.005), scale=1.55)
g = build_ar(0.24, 0.20, stock='fixed', carry=True, hg_round=True); g.finish('m16', (0, -0.50, Z+0.005), scale=1.4)
g = build_ar(0.20, 0.26, mag_len=0.12, grip='dark', flips=True); g.finish('dmr', (0, -0.50, Z+0.005), scale=1.45)

# ═════════════════════════════════════════════════════════════════════════════
# AK-pattern — ribbed dust cover, banana mag, slant brake, hooded post
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, 0.02, Z), (0.05, 0.24, 0.06), 'dark', bevel=0.006)                 # receiver
g.box((0, -0.005, Z+0.036), (0.044, 0.19, 0.018), 'metal', bevel=0.004)      # dust cover
g.row((0, 0.048, Z+0.044), (0, 0.014, 0), 4, (0.040, 0.005, 0.003), 'dark')  # cover ribs
# two green pills on the orange handguard top (chart)
g.row((0, -0.21, Z+0.042), (0, 0.06, 0), 2, (0.014, 0.030, 0.008), 'energy')
g.cyl((0.027, -0.03, Z+0.008), 0.004, 0.006, 'metal', axis='X')              # rivet 1
g.cyl((0.027, 0.05, Z+0.008), 0.004, 0.006, 'metal', axis='X')               # rivet 2
g.cyl((0.027, 0.10, Z+0.008), 0.004, 0.006, 'metal', axis='X')               # rivet 3
g.box((0.026, 0.08, Z+0.022), (0.004, 0.09, 0.010), 'metal', rot=(R(-8), 0, 0))  # safety lever blade
g.box((0.0265, 0.02, Z-0.005), (0.005, 0.04, 0.016), 'metal')                # ejection port frame
g.box((0, -0.175, Z+0.02), (0.05, 0.16, 0.045), 'body', bevel=0.010)         # upper handguard
g.box((0, -0.175, Z-0.025), (0.052, 0.16, 0.04), 'body', bevel=0.010)        # lower handguard
g.row((0.0265, -0.22, Z-0.025), (0, 0.024, 0), 5, (0.002, 0.012, 0.028), 'dark')  # hg grooves R
g.row((-0.0265, -0.22, Z-0.025), (0, 0.024, 0), 5, (0.002, 0.012, 0.028), 'dark') # hg grooves L
g.cyl((0, -0.32, Z+0.028), 0.007, 0.16, 'energy')                            # gas tube — GREEN (chart)
g.cyl((0, -0.265, Z+0.028), 0.011, 0.022, 'dark')                            # gas block
g.cyl((0, -0.33, Z+0.002), 0.011, 0.18, 'metal')                             # barrel
g.cyl((0, -0.335, Z+0.002), 0.0118, 0.115, 'energy')                         # GREEN exposed barrel sleeve (chart)
g.cyl((0, -0.435, Z+0.002), 0.014, 0.038, 'dark', rot=(0, 0, 0))             # slant brake body
g.box((0, -0.455, Z+0.010), (0.024, 0.016, 0.014), 'dark', rot=(R(35), 0, 0))# slant cut
# hooded front sight (base block welds tower + ears to the barrel)
g.box((0, -0.405, Z+0.016), (0.026, 0.016, 0.024), 'dark')                   # base on barrel
g.box((0, -0.405, Z+0.024), (0.010, 0.010, 0.026), 'dark')                   # tower
g.box((0, -0.405, Z+0.044), (0.005, 0.006, 0.020), 'metal')                  # post
g.box((0.011, -0.405, Z+0.038), (0.003, 0.010, 0.026), 'dark')               # ear R
g.box((-0.011, -0.405, Z+0.038), (0.003, 0.010, 0.026), 'dark')              # ear L
# banana mag — five short segments sweep a SMOOTH, gentle curve (chart)
g.box((0, -0.008, Z-0.050), (0.038, 0.054, 0.075), 'dark', bevel=0.005, rot=(R(-8), 0, 0))
g.box((0, 0.000, Z-0.086), (0.038, 0.054, 0.068), 'dark', bevel=0.005, rot=(R(-17), 0, 0))
g.box((0, 0.012, Z-0.120), (0.038, 0.054, 0.064), 'dark', bevel=0.005, rot=(R(-26), 0, 0))
g.box((0, 0.028, Z-0.151), (0.038, 0.054, 0.060), 'dark', bevel=0.005, rot=(R(-35), 0, 0))
g.box((0, 0.048, Z-0.178), (0.038, 0.054, 0.058), 'dark', bevel=0.005, rot=(R(-44), 0, 0))
g.box((0, 0.064, Z-0.200), (0.041, 0.056, 0.012), 'dark', rot=(R(-48), 0, 0))   # floorplate
g.row((0, -0.020, Z-0.062), (0, 0.012, -0.022), 3, (0.040, 0.005, 0.010), 'dark', rot=(R(-14), 0, 0))
g.box((0, 0.12, Z-0.075), (0.04, 0.05, 0.085), 'body', bevel=0.008, rot=(R(22), 0, 0))   # grip
g.row((0, 0.148, Z-0.098), (0, 0.006, 0.016), 3, (0.042, 0.004, 0.007), 'dark')          # grip grooves
g.box((0, 0.06, Z-0.095), (0.026, 0.08, 0.012), 'dark')                      # guard
g.box((0, 0.075, Z-0.05), (0.010, 0.012, 0.05), 'metal')                     # trigger (reaches the receiver)
g.box((0, 0.24, Z-0.02), (0.044, 0.22, 0.07), 'body', bevel=0.012, rot=(R(10), 0, 0))    # stock
g.box((0, 0.345, Z-0.045), (0.048, 0.02, 0.08), 'dark', rot=(R(10), 0, 0))   # butt plate
g.ring((0, 0.285, Z-0.038), 0.007, 0.002, 'metal', axis='X')                 # sling loop (on the stock)
g.box((0, 0.115, Z+0.036), (0.018, 0.030, 0.02), 'dark')                     # rear sight block (on the cover)
g.box((0, 0.105, Z+0.050), (0.010, 0.03, 0.006), 'metal', rot=(R(-6), 0, 0)) # tangent leaf
g.finish('rifle', (0, -0.46, Z+0.002), scale=1.4)

# ═════════════════════════════════════════════════════════════════════════════
# FN M240 — feed cover latches, belt links, carry handle, bipod feet
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, 0.02, Z), (0.055, 0.34, 0.085), 'dark', bevel=0.006)               # receiver
g.cyl((0.029, -0.10, Z-0.01), 0.004, 0.006, 'metal', axis='X')               # rivets
g.cyl((0.029, 0.0, Z-0.01), 0.004, 0.006, 'metal', axis='X')
g.cyl((0.029, 0.10, Z-0.01), 0.004, 0.006, 'metal', axis='X')
g.box((0, -0.05, Z+0.052), (0.05, 0.20, 0.022), 'metal', bevel=0.004)        # feed cover
g.box((0.027, -0.11, Z+0.052), (0.006, 0.02, 0.014), 'dark')                 # cover latch F
g.box((0.027, 0.02, Z+0.052), (0.006, 0.02, 0.014), 'dark')                  # cover latch R
g.row((0, -0.10, Z+0.065), (0, 0.028, 0), 6, (0.040, 0.006, 0.004), 'dark')  # cover ribs
g.box((0.0253, -0.05, Z+0.052), (0.002, 0.18, 0.012), 'energy')              # green cover stripe R
g.box((-0.0253, -0.05, Z+0.052), (0.002, 0.18, 0.012), 'energy')             # green cover stripe L
# long green angular band along the receiver flanks + rear block (chart)
g.box((0.0285, -0.02, Z+0.022), (0.003, 0.26, 0.026), 'energy')
g.box((-0.0285, -0.02, Z+0.022), (0.003, 0.26, 0.026), 'energy')
g.box((0.0285, 0.145, Z+0.01), (0.003, 0.028, 0.05), 'energy')
g.box((-0.0285, 0.145, Z+0.01), (0.003, 0.028, 0.05), 'energy')
# visible ammo belt feeding in from the left
g.row((-0.030, -0.02, Z+0.02), (0, 0.016, 0), 5, (0.014, 0.007, 0.02), 'metal')
g.row((-0.040, -0.02, Z+0.02), (0, 0.016, 0), 5, (0.006, 0.012, 0.014), 'body')  # brass-ish tips
g.cyl((0, -0.30, Z+0.01), 0.014, 0.34, 'metal')                              # barrel (into the receiver)
g.cyl((0, -0.24, Z+0.01), 0.017, 0.06, 'dark')                               # barrel shroud step
g.cyl((0, -0.455, Z+0.01), 0.019, 0.045, 'dark')                             # flash hider
g.row((0.0175, -0.452, Z+0.01), (0, 0.010, 0), 3, (0.003, 0.005, 0.014), 'metal')
g.box((0, -0.24, Z+0.044), (0.014, 0.05, 0.040), 'dark', rot=(R(50), 0, 0))  # carry handle post
g.box((0, -0.265, Z+0.068), (0.014, 0.055, 0.012), 'dark')                   # handle grip
# bipod w/ feet (legs splay outward-down from the clamp block)
g.box((0.024, -0.36, Z-0.048), (0.008, 0.008, 0.13), 'metal', rot=(0, R(-14), 0))
g.box((-0.024, -0.36, Z-0.048), (0.008, 0.008, 0.13), 'metal', rot=(0, R(14), 0))
g.box((0.042, -0.36, Z-0.112), (0.012, 0.010, 0.016), 'dark')                # foot R
g.box((-0.042, -0.36, Z-0.112), (0.012, 0.010, 0.016), 'dark')               # foot L
g.box((0, -0.36, Z-0.005), (0.06, 0.024, 0.03), 'dark', bevel=0.004)         # bipod clamp block on the barrel
g.box((0, 0.09, Z-0.075), (0.04, 0.05, 0.085), 'dark', bevel=0.008, rot=(R(20), 0, 0))  # grip (grey, chart)
g.row((0, 0.123, Z-0.094), (0, -0.010, 0.028), 3, (0.042, 0.004, 0.007), 'metal')
g.box((0, 0.045, Z-0.095), (0.026, 0.08, 0.012), 'dark')                     # guard
g.box((0, 0.055, Z-0.06), (0.010, 0.012, 0.035), 'metal')                    # trigger
g.box((0, 0.26, Z+0.005), (0.046, 0.14, 0.075), 'dark', bevel=0.008)         # stock (grey, chart)
g.box((0, 0.245, Z+0.048), (0.04, 0.09, 0.016), 'dark')                      # stock hump
g.box((0, 0.33, Z+0.005), (0.05, 0.016, 0.085), 'metal')                     # butt pad
# ORANGE ammo box with a glowing green L-shaped window (chart)
g.box((0.01, 0.0, Z-0.10), (0.06, 0.10, 0.075), 'body', bevel=0.006)         # ammo box
g.box((0.041, 0.0, Z-0.085), (0.004, 0.020, 0.038), 'energy')                # window upright
g.box((0.041, 0.012, Z-0.112), (0.004, 0.044, 0.018), 'energy')              # window foot
g.box((0.01, -0.028, Z-0.10), (0.064, 0.014, 0.079), 'dark', bevel=0.002)    # box strap F
g.box((0.01, 0.028, Z-0.10), (0.064, 0.014, 0.079), 'dark', bevel=0.002)     # box strap R
g.box((0, -0.048, Z-0.062), (0.05, 0.014, 0.008), 'metal')                   # box latch
g.box((0, -0.13, Z+0.055), (0.012, 0.012, 0.022), 'dark')                    # front sight
g.finish('lmg', (0, -0.48, Z+0.01), scale=1.4)

# ═════════════════════════════════════════════════════════════════════════════
# RPG-7 — wrapped tube, layered venturi, ribbed warhead, iron sight rail
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.cyl((0, 0.05, Z+0.01), 0.028, 0.55, 'dark')                                # main tube
g.ring((0, -0.10, Z+0.01), 0.029, 0.004, 'metal')                            # tube band F
g.ring((0, 0.16, Z+0.01), 0.029, 0.004, 'metal')                             # tube band R
g.cyl((0, 0.36, Z+0.01), 0.032, 0.10, 'body', r2=0.055)                      # rear flare (ORANGE bell, chart)
g.cyl((0, 0.415, Z+0.01), 0.056, 0.012, 'metal')                             # venturi lip
g.ring((0, 0.395, Z+0.01), 0.048, 0.004, 'metal')                            # flare band
g.box((0, -0.02, Z+0.01), (0.075, 0.16, 0.075), 'body', bevel=0.014)         # wood heat shield
g.ring((0, -0.095, Z+0.01), 0.039, 0.004, 'dark')                            # shield band F
g.ring((0, 0.055, Z+0.01), 0.039, 0.004, 'dark')                             # shield band R
g.cyl((0, -0.27, Z+0.01), 0.030, 0.11, 'body', r2=0.05)                      # warhead taper (ORANGE, chart look)
g.cyl((0, -0.365, Z+0.01), 0.05, 0.10, 'body')                               # warhead bulb (orange)
g.ring((0, -0.335, Z+0.01), 0.051, 0.003, 'dark')                            # warhead rib 1
g.ring((0, -0.375, Z+0.01), 0.051, 0.003, 'dark')                            # warhead rib 2
g.cone((0, -0.46, Z+0.01), 0.05, 0.10, 'body')                               # ogive cone (orange, chart)
g.cyl((0, -0.515, Z+0.01), 0.006, 0.022, 'metal')                            # fuze tip
g.box((0, -0.10, Z-0.052), (0.036, 0.045, 0.085), 'dark', bevel=0.008, rot=(R(14), 0, 0))  # front grip (grey, chart)
g.row((0, -0.082, Z-0.092), (0, 0.005, 0.015), 3, (0.038, 0.004, 0.006), 'dark')
g.box((0, 0.03, Z-0.052), (0.036, 0.045, 0.09), 'body', bevel=0.008, rot=(R(18), 0, 0))    # rear grip
g.row((0, 0.05, Z-0.092), (0, 0.005, 0.015), 3, (0.038, 0.004, 0.006), 'dark')
g.box((0, -0.075, Z-0.026), (0.010, 0.012, 0.03), 'metal')                   # trigger
g.box((0, -0.04, Z-0.028), (0.014, 0.03, 0.026), 'dark')                     # trigger housing
g.box((0, -0.16, Z+0.040), (0.010, 0.05, 0.014), 'dark')                     # sight rail
g.box((0, -0.175, Z+0.056), (0.006, 0.008, 0.022), 'metal')                  # front sight leaf
g.box((0, 0.10, Z+0.042), (0.008, 0.020, 0.018), 'metal')                    # rear sight
g.finish('rpg', (0, -0.535, Z+0.01), scale=1.3)

# ═════════════════════════════════════════════════════════════════════════════
# AI AWM — fluted barrel, braked muzzle, turreted scope, thumbhole chassis
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, 0.06, Z), (0.05, 0.30, 0.07), 'body', bevel=0.010)                 # chassis mid
# rear stock built as a frame so a REAL thumbhole reads through it (chart)
g.box((0, 0.27, Z+0.030), (0.046, 0.17, 0.045), 'body', bevel=0.008)         # comb bar (top)
g.box((0, 0.33, Z-0.02), (0.046, 0.05, 0.13), 'body', bevel=0.008)           # rear upright
g.box((0, 0.27, Z-0.065), (0.046, 0.17, 0.035), 'body', bevel=0.008)         # toe bar (bottom)
g.box((0, 0.27, Z+0.056), (0.038, 0.10, 0.014), 'dark')                      # grey comb strip (chart)
# darker checkering dashes on the stock flanks (chart texture)
g.row((0.0235, 0.215, Z+0.026), (0, 0.032, 0), 4, (0.002, 0.018, 0.016), 'dark')
g.row((-0.0235, 0.215, Z+0.026), (0, 0.032, 0), 4, (0.002, 0.018, 0.016), 'dark')
g.row((0.0235, 0.215, Z-0.062), (0, 0.032, 0), 4, (0.002, 0.018, 0.014), 'dark')
g.row((-0.0235, 0.215, Z-0.062), (0, 0.032, 0), 4, (0.002, 0.018, 0.014), 'dark')
g.box((0, 0.362, Z+0.0), (0.05, 0.016, 0.14), 'dark')                        # butt pad
# ORANGE forend panel running forward under the barrel (chart)
g.box((0, -0.16, Z-0.005), (0.044, 0.20, 0.05), 'body', bevel=0.008)
g.box((0.0225, -0.16, Z-0.002), (0.002, 0.14, 0.022), 'dark')                # forend inset R
g.box((-0.0225, -0.16, Z-0.002), (0.002, 0.14, 0.022), 'dark')               # forend inset L
g.box((0, -0.06, Z+0.012), (0.046, 0.16, 0.055), 'dark', bevel=0.005)        # action
g.cyl((0, -0.34, Z+0.012), 0.016, 0.42, 'metal')                             # barrel (heavy profile, chart)
g.row((0, -0.30, Z+0.027), (0, 0.05, 0), 6, (0.003, 0.036, 0.003), 'dark')   # fluting top
g.row((0.014, -0.30, Z+0.017), (0, 0.05, 0), 6, (0.003, 0.036, 0.003), 'dark')   # fluting R
# cylindrical ribbed muzzle brake (chart)
g.cyl((0, -0.545, Z+0.012), 0.020, 0.05, 'dark')
g.ring((0, -0.532, Z+0.012), 0.021, 0.0025, 'metal')                         # brake ring F
g.ring((0, -0.556, Z+0.012), 0.021, 0.0025, 'metal')                         # brake ring R
g.box((0.035, 0.02, Z+0.02), (0.022, 0.014, 0.014), 'metal', rot=(0, R(-30), 0))    # bolt handle
g.cyl((0.044, 0.028, Z+0.012), 0.009, 0.025, 'metal', axis='X')              # bolt knob
g.cyl((0, 0.10, Z+0.012), 0.012, 0.05, 'metal')                              # bolt shroud
# BIG scope (chart): fat tube, wide objective bell, tall mounts
g.cyl((0, -0.02, Z+0.085), 0.026, 0.24, 'dark')                              # scope tube
g.cyl((0, -0.155, Z+0.085), 0.036, 0.06, 'dark')                             # objective bell
g.cyl((0, -0.188, Z+0.085), 0.037, 0.012, 'metal')                           # sunshade lip
g.cyl((0, 0.115, Z+0.085), 0.030, 0.05, 'dark')                              # ocular
g.cyl((0, 0.142, Z+0.085), 0.027, 0.008, 'energy')                           # glowing lens
g.cyl((0, -0.02, Z+0.115), 0.009, 0.018, 'metal', axis='Z')                  # elevation turret
g.cyl((0.030, -0.02, Z+0.085), 0.008, 0.016, 'metal', axis='X')              # windage turret
g.cyl((-0.030, -0.02, Z+0.085), 0.007, 0.012, 'metal', axis='X')             # parallax
g.box((0, -0.065, Z+0.052), (0.016, 0.03, 0.030), 'metal')                   # ring F
g.box((0, 0.045, Z+0.052), (0.016, 0.03, 0.030), 'metal')                    # ring R
g.box((0, 0.045, Z-0.048), (0.034, 0.06, 0.055), 'metal', bevel=0.004, rot=(R(-5), 0, 0))  # mag
g.box((0, 0.045, Z-0.078), (0.037, 0.055, 0.010), 'dark', rot=(R(-5), 0, 0)) # floorplate
g.box((0, 0.12, Z-0.075), (0.038, 0.045, 0.08), 'body', bevel=0.008, rot=(R(18), 0, 0))   # grip
g.box((0, 0.075, Z-0.09), (0.024, 0.07, 0.012), 'dark')                      # guard
g.box((0, 0.085, Z-0.055), (0.010, 0.012, 0.03), 'metal')                    # trigger
g.finish('boltsniper', (0, -0.575, Z+0.012), scale=1.35)

# ═════════════════════════════════════════════════════════════════════════════
# Desert Eagle — slab slide w/ top rib + serrations, safety, grip screws
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, -0.01, Z+0.02), (0.052, 0.30, 0.06), 'dark', bevel=0.006)          # slab slide (grey, chart)
g.box((0, -0.01, Z+0.055), (0.032, 0.28, 0.014), 'metal')                    # top rib
g.row((0, -0.115, Z+0.0625), (0, 0.02, 0), 12, (0.028, 0.008, 0.003), 'dark')# rib cuts
# long ORANGE stripe panel along the lower slide flank (chart signature)
g.box((0.0265, -0.02, Z+0.004), (0.002, 0.24, 0.026), 'body')
g.box((-0.0265, -0.02, Z+0.004), (0.002, 0.24, 0.026), 'body')
g.row((0, 0.10, Z+0.02), (0, -0.014, 0), 4, (0.056, 0.005, 0.05), 'dark')    # rear serrations
g.row((0, -0.125, Z+0.02), (0, 0.014, 0), 3, (0.056, 0.005, 0.045), 'dark')  # front serrations
g.box((0.027, -0.04, Z+0.028), (0.004, 0.05, 0.024), 'metal')                # ejection port
g.box((-0.028, 0.09, Z+0.03), (0.005, 0.022, 0.010), 'metal')                # safety lever
g.box((0, -0.15, Z+0.02), (0.05, 0.02, 0.055), 'dark', rot=(R(-20), 0, 0))   # nose chamfer
g.cyl((0, -0.165, Z+0.02), 0.015, 0.02, 'dark')                              # big bore
g.cyl((0, -0.172, Z+0.02), 0.0105, 0.012, 'metal')                           # rifling step
g.box((0, 0.0, Z-0.03), (0.048, 0.24, 0.045), 'dark', bevel=0.005)           # frame (same grey as slide, chart)
g.row((0, -0.09, Z-0.048), (0, 0.016, 0), 4, (0.05, 0.006, 0.008), 'dark')   # frame rail cuts
g.cyl((0.025, 0.02, Z-0.03), 0.004, 0.006, 'metal', axis='X')                # takedown pin
g.box((0, 0.10, Z-0.095), (0.044, 0.10, 0.16), 'dark', bevel=0.010, rot=(R(16), 0, 0))    # grip
g.box((0.023, 0.10, Z-0.09), (0.004, 0.07, 0.11), 'body', bevel=0.006, rot=(R(16), 0, 0)) # grip panel R
g.box((-0.023, 0.10, Z-0.09), (0.004, 0.07, 0.11), 'body', bevel=0.006, rot=(R(16), 0, 0))# grip panel L
g.cyl((0.026, 0.085, Z-0.055), 0.003, 0.005, 'metal', axis='X')              # panel screw top
g.cyl((0.026, 0.125, Z-0.135), 0.003, 0.005, 'metal', axis='X')              # panel screw bottom
g.box((0, 0.125, Z-0.172), (0.046, 0.055, 0.016), 'dark', rot=(R(16), 0, 0)) # magwell base
g.box((0, 0.03, Z-0.09), (0.028, 0.09, 0.012), 'metal')                      # guard bottom
g.box((0, -0.015, Z-0.065), (0.028, 0.012, 0.05), 'metal')                   # guard front
g.box((0, 0.015, Z-0.055), (0.010, 0.012, 0.032), 'metal')                   # trigger
g.box((0, 0.125, Z+0.058), (0.022, 0.014, 0.012), 'dark')                    # rear sight
g.box((0.007, 0.125, Z+0.065), (0.004, 0.005, 0.005), 'energy')              # sight dot R
g.box((-0.007, 0.125, Z+0.065), (0.004, 0.005, 0.005), 'energy')             # sight dot L
g.box((0, -0.135, Z+0.058), (0.010, 0.012, 0.010), 'dark')                   # front sight
g.box((0, -0.14, Z+0.063), (0.005, 0.006, 0.005), 'energy')                  # front dot
g.finish('magnum', (0, -0.180, Z+0.02), scale=1.3)

# ═════════════════════════════════════════════════════════════════════════════
# H&K G3 — drum sight, fluted handguard, paddle release, charging tube
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, 0.0, Z), (0.048, 0.30, 0.065), 'dark', bevel=0.006)                # receiver
g.box((0, -0.05, Z+0.040), (0.032, 0.20, 0.012), 'metal')                    # top spine
g.cyl((0, -0.22, Z+0.030), 0.009, 0.22, 'metal')                             # charging handle tube
g.box((-0.014, -0.28, Z+0.030), (0.018, 0.014, 0.010), 'metal')              # charging handle knob
g.box((0.025, 0.0, Z+0.008), (0.004, 0.05, 0.024), 'metal')                  # ejection port
g.box((0, -0.24, Z-0.005), (0.046, 0.18, 0.05), 'body', bevel=0.010)         # slim handguard
g.row((0.024, -0.30, Z-0.005), (0, 0.028, 0), 5, (0.002, 0.016, 0.030), 'dark')  # hg flutes R
g.row((-0.024, -0.30, Z-0.005), (0, 0.028, 0), 5, (0.002, 0.016, 0.030), 'dark') # hg flutes L
g.row((0, -0.30, Z+0.019), (0, 0.055, 0), 3, (0.026, 0.030, 0.005), 'dark')  # three dark top slots (chart)
g.cyl((0, -0.40, Z+0.012), 0.011, 0.16, 'metal')                             # barrel
g.cyl((0, -0.485, Z+0.012), 0.014, 0.035, 'dark')                            # flash hider
g.row((0.0145, -0.495, Z+0.012), (0, 0.011, 0), 3, (0.002, 0.005, 0.016), 'metal')
g.cyl((0, -0.32, Z+0.048), 0.013, 0.018, 'dark', axis='Y')                   # FS ring base
g.box((0, -0.32, Z+0.065), (0.006, 0.006, 0.018), 'metal')                   # FS post
g.cyl((0, 0.10, Z+0.040), 0.015, 0.030, 'dark', axis='Z')                    # rear drum (on receiver)
g.cyl((0, 0.10, Z+0.058), 0.007, 0.010, 'metal', axis='Z')                   # drum aperture
g.box((0, 0.02, Z-0.075), (0.036, 0.05, 0.09), 'dark', bevel=0.004, rot=(R(-6), 0, 0))   # mag (grey, chart)
g.row((0, 0.002, Z-0.055), (0, 0.014, -0.018), 3, (0.038, 0.004, 0.009), 'dark', rot=(R(-6), 0, 0))
g.box((0, 0.048, Z-0.105), (0.012, 0.03, 0.014), 'metal')                    # paddle release
g.box((0, 0.13, Z-0.075), (0.04, 0.05, 0.085), 'body', bevel=0.008, rot=(R(20), 0, 0))   # grip
g.row((0, 0.163, Z-0.094), (0, -0.010, 0.028), 3, (0.042, 0.004, 0.007), 'dark')
g.box((0, 0.075, Z-0.095), (0.026, 0.08, 0.012), 'dark')                     # guard
g.box((0, 0.09, Z-0.06), (0.010, 0.012, 0.035), 'metal')                     # trigger
g.box((0, 0.245, Z-0.01), (0.044, 0.20, 0.07), 'body', bevel=0.010, rot=(R(6), 0, 0))    # stock (reaches receiver)
g.row((0, 0.19, Z+0.024), (0, 0.024, -0.002), 3, (0.046, 0.006, 0.006), 'dark', rot=(R(6), 0, 0))  # buffer rings
g.box((0, 0.340, Z-0.025), (0.048, 0.02, 0.08), 'dark', rot=(R(6), 0, 0))    # butt
g.finish('battlerifle', (0, -0.505, Z+0.012), scale=1.35)

# ═════════════════════════════════════════════════════════════════════════════
# FN P90 (needler) — molded shell, translucent top mag w/ rounds, sight bridge
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
# The chart P90 is ONE tall body slab with the trigger holes PUNCHED THROUGH
# it: flat top (mag inset flush into the top-front), tall flat butt, belly
# sweeping up into the curved hook under the muzzle, near-vertical front face.
body = g.profile([
    (0.248, Z+0.058), (0.256, Z+0.044),     # rear-top rounded corner
    (0.256, Z-0.078), (0.246, Z-0.094),     # tall flat butt, rounded bottom
    (0.02,  Z-0.100),                       # flat belly
    (-0.06, Z-0.092),                       # sweep begins
    (-0.115, Z-0.062),
    (-0.15, Z-0.030),
    (-0.172, Z-0.006),                      # hook underside
    (-0.19, Z+0.020),                       # hook tip / front face bottom
    (-0.192, Z+0.048),                      # near-vertical front face
    (-0.178, Z+0.058),                      # front-top round-off
], 0.056, 'dark', bevel=0.006, seg=2)
# the two signature holes, punched straight through the body (chart):
g.hole_rect(body, 0.015, Z-0.052, 0.095, 0.058, bevel=0.018)   # big rounded thumbhole
g.hole_ellipse(body, -0.095, Z-0.030, 0.026, 0.026)            # round trigger hole
g.box((0, -0.088, Z-0.019), (0.009, 0.010, 0.042), 'metal')    # trigger (anchored above the hole)
g.box((0, 0.042, Z-0.026), (0.012, 0.026, 0.016), 'dark', bevel=0.004)  # mag-release tab hanging into the thumbhole
# lighter belly edge along the lower rear body (the chart's two-tone underside)
g.box((0.0285, 0.16, Z-0.088), (0.002, 0.17, 0.016), 'metal')
g.box((-0.0285, 0.16, Z-0.088), (0.002, 0.17, 0.016), 'metal')
# dual charging-handle tabs on the body sides at the front (P90 hardware)
g.box((0.0295, -0.145, Z+0.030), (0.003, 0.030, 0.012), 'dark', bevel=0.002)
g.box((-0.0295, -0.145, Z+0.030), (0.003, 0.030, 0.012), 'dark', bevel=0.002)
# ORANGE magazine inset FLUSH with the body top line, slightly proud of the
# sides so the orange reads in profile (chart); thin pink needle slit on top
g.box((0, -0.04, Z+0.0475), (0.058, 0.27, 0.021), 'body', bevel=0.006, seg=2)
g.box((0, -0.04, Z+0.059), (0.010, 0.22, 0.004), 'energy')
g.box((0.0295, -0.04, Z+0.047), (0.002, 0.23, 0.003), 'dark')   # mag seam line R
g.box((-0.0295, -0.04, Z+0.047), (0.002, 0.23, 0.003), 'dark')  # mag seam line L
# BIG orange rear side panels with screw dots (chart lower-left block)
g.box((0.0285, 0.175, Z-0.055), (0.004, 0.155, 0.082), 'body', bevel=0.006, seg=2)
g.box((-0.0285, 0.175, Z-0.055), (0.004, 0.155, 0.082), 'body', bevel=0.006, seg=2)
# sight bridge over the FRONT half (chart): diagonal rear leg rising forward,
# long top bar, front leg landing above the muzzle — triangular opening under
g.box((0, 0.005, Z+0.082), (0.018, 0.016, 0.062), 'dark', bevel=0.005, rot=(R(38), 0, 0))  # rear leg
g.box((0, -0.085, Z+0.106), (0.030, 0.16, 0.013), 'dark', bevel=0.005)       # top bar
g.box((0, -0.168, Z+0.085), (0.018, 0.014, 0.05), 'dark', bevel=0.005)       # front leg
g.box((0, -0.01, Z+0.118), (0.014, 0.014, 0.014), 'dark', bevel=0.004)       # rear sight blade
g.box((0, -0.168, Z+0.114), (0.010, 0.012, 0.014), 'dark', bevel=0.004)      # front nub
# stub barrel + rectangular muzzle block out the front face at mid height
g.cyl((0, -0.21, Z+0.032), 0.011, 0.05, 'metal')
g.box((0, -0.235, Z+0.032), (0.024, 0.026, 0.026), 'dark', bevel=0.005)
g.cyl((0, -0.2495, Z+0.032), 0.005, 0.006, 'energy')             # glowing needle bore
# screw dots (chart): two on the upper body, two on the orange panel
g.cyl((0.0285, 0.10, Z+0.030), 0.004, 0.005, 'metal', axis='X')
g.cyl((0.0285, 0.19, Z+0.025), 0.004, 0.005, 'metal', axis='X')
g.cyl((0.031, 0.135, Z-0.03), 0.004, 0.005, 'metal', axis='X')
g.cyl((0.031, 0.23, Z-0.03), 0.004, 0.005, 'metal', axis='X')
g.finish('needler', (0, -0.25, Z+0.032), scale=1.45)

# ═════════════════════════════════════════════════════════════════════════════
# Remington 870 — action bars, loading port, checkered stock, barrel ring
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, 0.03, Z), (0.048, 0.16, 0.07), 'dark', bevel=0.006)                # receiver
g.box((0.0245, 0.03, Z+0.002), (0.002, 0.12, 0.016), 'metal')                # receiver side band R (chart)
g.box((-0.0245, 0.03, Z+0.002), (0.002, 0.12, 0.016), 'metal')               # receiver side band L
g.box((0.025, 0.02, Z+0.012), (0.004, 0.05, 0.026), 'metal')                 # ejection port
g.box((0, 0.05, Z-0.036), (0.026, 0.05, 0.006), 'metal')                     # loading port plate
g.cyl((0, -0.26, Z+0.018), 0.0155, 0.46, 'metal')                            # barrel (roots into the receiver)
g.cyl((0, -0.22, Z-0.018), 0.012, 0.36, 'metal')                             # mag tube (roots into the receiver)
g.cyl((0, -0.395, Z-0.018), 0.0135, 0.014, 'dark')                           # tube cap
g.box((0, -0.38, Z), (0.006, 0.014, 0.038), 'metal')                         # barrel ring strap
g.box((0, -0.19, Z-0.018), (0.058, 0.13, 0.056), 'body', bevel=0.014)        # pump (chunky, chart)
g.row((0, -0.145, Z-0.018), (0, -0.022, 0), 5, (0.060, 0.006, 0.044), 'dark')# pump ribs (vertical, chart)
g.box((0.019, -0.09, Z-0.006), (0.005, 0.09, 0.008), 'metal')                # action bar R
g.box((-0.019, -0.09, Z-0.006), (0.005, 0.09, 0.008), 'metal')               # action bar L
g.box((0, 0.19, Z-0.02), (0.05, 0.24, 0.09), 'body', bevel=0.014, rot=(R(12), 0, 0))     # stock (fat, chart)
g.box((0, 0.125, Z-0.052), (0.044, 0.08, 0.06), 'body', bevel=0.014, rot=(R(30), 0, 0))  # wrist
g.row((0.0255, 0.17, Z-0.045), (0, 0.02, -0.005), 4, (0.002, 0.012, 0.026), 'dark', rot=(R(12), 0, 0))  # checkering R
g.row((-0.0255, 0.17, Z-0.045), (0, 0.02, -0.005), 4, (0.002, 0.012, 0.026), 'dark', rot=(R(12), 0, 0)) # checkering L
g.box((0, 0.305, Z-0.05), (0.054, 0.02, 0.098), 'dark', rot=(R(12), 0, 0))   # recoil pad
g.row((0, 0.304, Z-0.08), (0, 0.004, 0.022), 3, (0.042, 0.003, 0.007), 'metal')
g.box((0, 0.075, Z-0.075), (0.026, 0.08, 0.012), 'dark')                     # guard
g.box((0, 0.085, Z-0.045), (0.010, 0.012, 0.03), 'metal')                    # trigger
g.ring((0, 0.26, Z-0.050), 0.007, 0.002, 'metal', axis='X')                  # sling stud (on the stock)
g.box((0, -0.485, Z+0.032), (0.008, 0.008, 0.012), 'metal')                  # bead base
g.cyl((0, -0.488, Z+0.039), 0.004, 0.007, 'energy', axis='Z', verts=10)      # glowing bead
g.finish('energyshotgun', (0, -0.50, Z+0.018), scale=1.3)

# ═════════════════════════════════════════════════════════════════════════════
# M79 — break-action w/ hinge + lever, ladder sight frame, shell rim
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.cyl((0, -0.17, Z+0.01), 0.033, 0.36, 'dark')                               # fat barrel (flat grey, chart)
g.cyl((0, -0.355, Z+0.01), 0.037, 0.025, 'dark')                             # muzzle ring
g.cyl((0, -0.343, Z+0.01), 0.028, 0.006, 'energy')                           # faint bore glow
g.ring((0, -0.05, Z+0.01), 0.034, 0.004, 'dark')                             # breech ring
g.box((0, 0.05, Z+0.005), (0.05, 0.10, 0.075), 'dark', bevel=0.006)          # receiver block
g.cyl((0.027, 0.005, Z+0.01), 0.006, 0.008, 'metal', axis='X')               # hinge pin
g.box((0, 0.095, Z+0.045), (0.016, 0.035, 0.012), 'metal')                   # break lever
# ORANGE forend slab hanging under the fat barrel, ribbed rail on its base (chart)
g.box((0, -0.19, Z-0.032), (0.06, 0.26, 0.045), 'body', bevel=0.012)         # forend
g.row((0, -0.27, Z-0.058), (0, 0.035, 0), 5, (0.05, 0.014, 0.008), 'dark')   # base rail ribs
g.cyl((0.031, -0.20, Z-0.032), 0.004, 0.006, 'metal', axis='X')              # forend screw
g.box((0, 0.20, Z-0.025), (0.046, 0.24, 0.075), 'body', bevel=0.012, rot=(R(13), 0, 0))  # stock
g.box((0, 0.13, Z-0.058), (0.042, 0.07, 0.05), 'body', bevel=0.012, rot=(R(30), 0, 0))   # wrist
g.box((0, 0.315, Z-0.055), (0.05, 0.02, 0.085), 'dark', rot=(R(13), 0, 0))   # butt pad
g.row((0, 0.324, Z-0.088), (0, 0.004, 0.022), 3, (0.044, 0.003, 0.007), 'metal')
g.box((0, 0.055, Z-0.042), (0.026, 0.09, 0.014), 'dark')                     # guard
g.box((0, 0.065, Z-0.022), (0.010, 0.012, 0.03), 'metal')                    # trigger
# big flip-up leaf sight standing at the breech end of the barrel (chart)
g.box((0, -0.10, Z+0.048), (0.036, 0.010, 0.016), 'dark')                    # sight base
g.box((0, -0.10, Z+0.085), (0.030, 0.005, 0.062), 'metal')                   # leaf plate
g.box((0, -0.10, Z+0.118), (0.034, 0.008, 0.008), 'dark')                    # leaf top edge
g.row((0, -0.10, Z+0.068), (0, 0, 0.018), 3, (0.032, 0.0065, 0.004), 'dark') # graduation bars
g.box((0, -0.345, Z+0.052), (0.006, 0.008, 0.018), 'metal')                  # front sight blade
g.box((0, 0.09, Z+0.048), (0.016, 0.012, 0.016), 'dark')                     # rear notch
g.finish('fuelrod', (0, -0.375, Z+0.01), scale=1.25)

# ═════════════════════════════════════════════════════════════════════════════
# Combat knife — fullered crystal blade, quillon guard, wrapped handle
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.box((0, -0.13, Z), (0.008, 0.20, 0.038), 'energy', bevel=0.004)            # crystal blade
g.box((0, -0.12, Z+0.004), (0.0085, 0.16, 0.008), 'dark')                    # fuller groove
g.cone((0, -0.26, Z+0.004), 0.019, 0.07, 'energy', rot=(0, R(45), 0), verts=4)  # tip
g.box((0, -0.10, Z+0.024), (0.006, 0.14, 0.010), 'metal')                    # spine
g.box((0, -0.175, Z+0.026), (0.007, 0.012, 0.010), 'dark', rot=(R(45), 0, 0))   # spine notch 1 (chart)
g.box((0, -0.150, Z+0.026), (0.007, 0.012, 0.010), 'dark', rot=(R(45), 0, 0))   # spine notch 2
g.box((0, -0.06, Z-0.020), (0.007, 0.09, 0.006), 'metal', rot=(R(-4), 0, 0)) # edge bevel line
g.box((0, -0.025, Z), (0.026, 0.018, 0.055), 'body', bevel=0.004)            # guard (orange, chart)
g.box((0, -0.025, Z+0.034), (0.012, 0.014, 0.014), 'body', rot=(R(30), 0, 0))    # quillon up
g.box((0, -0.025, Z-0.034), (0.012, 0.014, 0.014), 'body', rot=(R(-30), 0, 0))   # quillon down
g.box((0, 0.045, Z), (0.024, 0.13, 0.036), 'body', bevel=0.010)              # handle
g.row((0, -0.005, Z), (0, 0.022, 0), 6, (0.026, 0.006, 0.038), 'dark')       # wrap rings
g.box((0, 0.115, Z), (0.028, 0.02, 0.04), 'dark', bevel=0.004)               # pommel
g.ring((0, 0.124, Z), 0.009, 0.0025, 'metal')                                # lanyard ring
g.finish('knife', (0, -0.30, Z), scale=0.78)

# ═════════════════════════════════════════════════════════════════════════════
# Arc Blade (sword) — full-size crystal sword in the knife's chart language:
# glowing faceted blade (one traced profile), orange guard + wrapped grip
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
# blade: one extruded silhouette — straight spine, long taper, clipped tip
g.profile([
    (-0.030, Z+0.044),                        # base, spine side
    (-0.380, Z+0.038),                        # spine run
    (-0.520, Z+0.004),                        # clipped tip point
    (-0.430, Z-0.030),                        # edge return
    (-0.030, Z-0.038),                        # base, edge side
], 0.013, 'energy', bevel=0.003, seg=2)
g.box((0, -0.19, Z+0.004), (0.0145, 0.30, 0.009), 'dark')                    # fuller groove
g.box((0, -0.115, Z+0.040), (0.008, 0.014, 0.011), 'dark', rot=(R(45), 0, 0))  # spine notch 1
g.box((0, -0.085, Z+0.041), (0.008, 0.014, 0.011), 'dark', rot=(R(45), 0, 0))  # spine notch 2
# orange angular guard + swept quillons (chart knife language, scaled up)
g.box((0, -0.018, Z), (0.034, 0.026, 0.13), 'body', bevel=0.005)
g.box((0, -0.030, Z+0.070), (0.016, 0.018, 0.026), 'body', rot=(R(35), 0, 0))   # quillon up
g.box((0, -0.030, Z-0.070), (0.016, 0.018, 0.026), 'body', rot=(R(-35), 0, 0))  # quillon down
g.box((0, -0.005, Z+0.030), (0.006, 0.010, 0.020), 'energy')                 # guard gem glow
# two-hand grip: orange with dark wrap bands, grey pommel + ring
g.box((0, 0.075, Z), (0.028, 0.17, 0.042), 'body', bevel=0.010, seg=2)
g.row((0, 0.010, Z), (0, 0.026, 0), 6, (0.030, 0.007, 0.044), 'dark')        # wrap bands
g.box((0, 0.170, Z), (0.032, 0.024, 0.048), 'dark', bevel=0.005)             # pommel
g.cyl((0, 0.185, Z), 0.008, 0.012, 'energy')                                 # pommel crystal
g.finish('sword', (0, -0.52, Z), scale=1.0)

# ═════════════════════════════════════════════════════════════════════════════
# Concussion Rifle — chunky sci-fi launcher: one fat traced body with a punched
# trigger guard, orange top canopy + grip panels, glowing vents + muzzle core
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
body = g.profile([
    (0.24, Z+0.050),                           # rear top
    (0.30, Z+0.015),                           # butt slope
    (0.30, Z-0.050),                           # flat butt
    (0.22, Z-0.075),                           # butt underside
    (-0.10, Z-0.075),                          # belly
    (-0.17, Z-0.052),                          # taper toward the nose
    (-0.30, Z-0.035),                          # nose bottom
    (-0.325, Z+0.008),                         # muzzle face
    (-0.28, Z+0.045),                          # nose top slope
    (-0.05, Z+0.058),                          # body hump
], 0.075, 'dark', bevel=0.010, seg=3)
g.hole_rect(body, 0.10, Z-0.035, 0.085, 0.045, bevel=0.014)      # trigger guard opening
g.box((0, 0.075, Z-0.020), (0.010, 0.011, 0.045), 'metal')       # trigger (anchored above the hole)
g.box((0, 0.0, Z+0.062), (0.058, 0.30, 0.028), 'body', bevel=0.010, seg=3)  # orange top canopy
g.box((0, -0.02, Z+0.078), (0.014, 0.20, 0.006), 'energy')       # canopy core line
g.box((0.039, 0.16, Z-0.030), (0.004, 0.075, 0.055), 'body', bevel=0.005)   # grip panel R
g.box((-0.039, 0.16, Z-0.030), (0.004, 0.075, 0.055), 'body', bevel=0.005)  # grip panel L
g.row((0.0375, -0.24, Z+0.005), (0, 0.055, 0), 3, (0.004, 0.032, 0.020), 'energy')   # glow vents R
g.row((-0.0375, -0.24, Z+0.005), (0, 0.055, 0), 3, (0.004, 0.032, 0.020), 'energy')  # glow vents L
g.cyl((0, -0.335, Z+0.005), 0.034, 0.03, 'dark')                 # muzzle collar
g.cyl((0, -0.348, Z+0.005), 0.026, 0.010, 'energy')              # glowing bore core
g.box((0, -0.05, Z+0.085), (0.012, 0.05, 0.014), 'dark', bevel=0.004)  # top sight fin
g.box((0, 0.20, Z+0.052), (0.05, 0.05, 0.020), 'dark', bevel=0.006)    # rear hump vent block
g.finish('concussion', (0, -0.355, Z+0.005), scale=1.25)

# ═════════════════════════════════════════════════════════════════════════════
# Gravity Hammer — two-hand shaft, massive grey head with orange side plates,
# glowing power band, top spike, flat striking face
# ═════════════════════════════════════════════════════════════════════════════
g = Gun(MATS)
g.cyl((0, -0.02, Z), 0.018, 0.60, 'dark')                        # shaft
g.box((0, 0.16, Z), (0.030, 0.16, 0.046), 'body', bevel=0.010, seg=2)   # orange grip
g.row((0, 0.10, Z), (0, 0.030, 0), 5, (0.033, 0.007, 0.049), 'dark')    # grip wrap bands
g.box((0, 0.27, Z), (0.036, 0.024, 0.052), 'dark', bevel=0.005)  # pommel
g.cyl((0, 0.285, Z), 0.009, 0.012, 'energy')                     # pommel crystal
g.box((0, -0.24, Z), (0.05, 0.05, 0.07), 'dark', bevel=0.008)    # head coupling collar
# the head
g.box((0, -0.36, Z+0.02), (0.10, 0.16, 0.20), 'dark', bevel=0.012, seg=2)   # head block
g.box((0.052, -0.36, Z+0.02), (0.006, 0.13, 0.16), 'body', bevel=0.005)     # orange side plate R
g.box((-0.052, -0.36, Z+0.02), (0.006, 0.13, 0.16), 'body', bevel=0.005)    # orange side plate L
g.box((0, -0.36, Z+0.02), (0.118, 0.028, 0.17), 'energy')        # glowing power band through the head
g.box((0, -0.447, Z+0.02), (0.11, 0.018, 0.21), 'metal', bevel=0.004)   # striking face plate
g.row((0, -0.457, Z-0.05), (0, 0, 0.048), 3, (0.09, 0.005, 0.012), 'dark')  # face ribs
g.cone((0, -0.36, Z+0.15), 0.030, 0.09, 'dark', axis='Z')        # top spike
g.cyl((0, -0.36, Z+0.115), 0.034, 0.02, 'metal', axis='Z')       # spike collar
g.finish('ghammer', (0, -0.46, Z+0.02), scale=1.0)

export(os.path.join(os.path.dirname(__file__), "..", "public", "weapons_authored.glb"))
