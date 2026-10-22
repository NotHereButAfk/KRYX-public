import bpy
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = root / 'public/ev-default.glb'
rig = bpy.data.objects['EV.IO Default - Rig']
rig.animation_data.action = bpy.data.actions['01 Idle - Armed']
for track in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(track)
for action in list(bpy.data.actions):
    if not action.name[:2].isdigit() or action.name.startswith('00'):
        bpy.data.actions.remove(action)
bpy.context.scene.frame_set(1)
keep = set()
for collection in bpy.data.collections:
    if collection.name.startswith(('CHARACTER', 'RIFLE')):
        collection.hide_viewport = False
        collection.hide_render = False
        for obj in list(collection.objects):
            keep.add(obj)
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.hide_render = False
for obj in list(bpy.data.objects):
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=False,
    export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False,
    export_force_sampling=True, export_anim_slide_to_zero=True, export_skins=True,
    export_extras=False, export_cameras=False, export_lights=False,
    export_optimize_animation_size=True)
print('GAME_ASSET', out.stat().st_size)
