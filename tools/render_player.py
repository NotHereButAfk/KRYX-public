"""Turntable preview of ev_io_player_model.blend — Cycles CPU, four views.

    python3 tools/render_player.py                 (needs the bpy module)
    blender --background --python tools/render_player.py

Writes hero_view0..3.png next to the .blend. Reads the .blend from the current
directory, which is where model_player.py writes it.
"""
import os, sys, math
import bpy
from mathutils import Vector

HERE = os.getcwd()
BLEND = os.path.join(HERE, "ev_io_player_model.blend")
W, H, VIEWS = 440, 880, 4

bpy.ops.wm.open_mainfile(filepath=BLEND)

scn = bpy.context.scene
scn.render.engine = 'CYCLES'
scn.cycles.device = 'CPU'
scn.cycles.samples = 48
scn.cycles.use_denoising = False
scn.render.resolution_x, scn.render.resolution_y = W, H
scn.render.resolution_percentage = 100
scn.render.film_transparent = False
# Standard, not Filmic/AgX: a tone curve rolls the white armour AND the
# emissive visor to the same clipped white, which is exactly what hid the
# visor in the first pass.
scn.view_settings.view_transform = 'Standard'
scn.view_settings.look = 'None'
scn.view_settings.exposure = -0.35

# world
world = bpy.data.worlds.new("W")
scn.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.055, 0.06, 0.075, 1)
bg.inputs[1].default_value = 1.0

# floor
bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
floor = bpy.context.active_object
fm = bpy.data.materials.new("floor"); fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.10, 0.10, 0.125, 1)
fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
floor.data.materials.append(fm)

def lamp(name, loc, energy, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, type='AREA')
    d.energy, d.size, d.color = energy, size, color
    o = bpy.data.objects.new(name, d)
    scn.collection.objects.link(o)
    o.location = loc
    dirv = Vector((0, 0, 1.1)) - Vector(loc)
    o.rotation_euler = dirv.to_track_quat('-Z', 'Y').to_euler()
    return o

lamp("key",  (2.6, -3.4, 3.6), 260, 3.0, (1.0, 0.97, 0.92))
lamp("fill", (-3.4, -1.6, 2.0), 90, 3.0, (0.72, 0.80, 1.0))
lamp("rim",  (-1.4, 3.6, 2.6), 150, 2.5, (1.0, 0.85, 0.55))

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 70
cam = bpy.data.objects.new("Cam", cam_data)
scn.collection.objects.link(cam)
scn.camera = cam

target = Vector((0, 0, 0.95))
out = []
for i in range(VIEWS):
    a = (i / VIEWS) * 2 * math.pi
    r = 5.0
    cam.location = (math.sin(a) * r, -math.cos(a) * r, 1.35)
    cam.rotation_euler = (target - Vector(cam.location)).to_track_quat('-Z', 'Y').to_euler()
    path = os.path.join(HERE, f"hero_view{i}.png")
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    out.append(path)
    print("wrote", path)
print("DONE", " ".join(out))
