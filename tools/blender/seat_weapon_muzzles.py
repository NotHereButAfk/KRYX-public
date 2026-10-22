"""Seat stale muzzle markers on the front of the shipped barrel geometry."""
from pathlib import Path
import bpy
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
for wid in ['uzi','concussion','rpg']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    path=root/'public/models/ev-default'/f'{wid}.glb'
    bpy.ops.import_scene.gltf(filepath=str(path))
    weapon=bpy.data.objects['weapon_'+wid]
    points=[obj.matrix_world@v.co for obj in weapon.children_recursive if obj.type=='MESH' for v in obj.data.vertices]
    # Blender imports glTF Y-up as Z-up: game (x,y,z) = Blender (x,z,-y).
    points=[Vector((p.x,p.z,-p.y)) for p in points]
    front=min(p.z for p in points)
    tip=[p for p in points if p.z<front+.005]
    center=Vector(((min(p.x for p in tip)+max(p.x for p in tip))/2,(min(p.y for p in tip)+max(p.y for p in tip))/2,front-.001))
    marker=bpy.data.objects['BIND_BULLET']
    marker.matrix_world.translation=Vector((center.x,-center.z,center.y))
    bpy.ops.wm.save_as_mainfile(filepath=str(root/'art/ev-default-weapons'/f'{wid}.blend'),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',export_extras=True,export_animations=False)
    print('MUZZLE',wid,list(center))
