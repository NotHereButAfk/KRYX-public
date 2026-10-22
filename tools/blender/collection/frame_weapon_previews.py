"""Frame each remodeled weapon individually for readable store cards."""
import bpy, json, shutil
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
items=json.loads((ROOT/'art/collection-remakes/catalog.json').read_text())['items']
for index,item in enumerate(x for x in items if x['category']=='weapon'):
    folder=ROOT/'artifacts/collection-remodeled'/item['kryxId']
    bpy.ops.wm.open_mainfile(filepath=str(folder/'model.blend'))
    scene=bpy.context.scene;camera=scene.camera
    points=[o.matrix_world@Vector(c) for o in scene.objects if o.type=='MESH' for c in o.bound_box]
    minimum=Vector(tuple(min(p[i] for p in points) for i in range(3)))
    maximum=Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center=(minimum+maximum)*.5;camera.location=center+Vector((1.8,-2.2,1.15))
    camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
    rotation=camera.rotation_euler.to_quaternion().inverted()
    projected=[rotation@(p-center) for p in points]
    width=max(p.x for p in projected)-min(p.x for p in projected)
    height=max(p.y for p in projected)-min(p.y for p in projected)
    camera.data.ortho_scale=max(width,height*1.5)*1.12
    scene.render.filepath=str(folder/'preview.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'model.blend'),compress=True)
    bpy.ops.render.render(write_still=True)
    shutil.copy2(folder/'preview.png',ROOT/'public/assets/weapon-skins'/(item['kryxId']+'.png'))
    shutil.copy2(folder/'model.blend',ROOT/'art/collection-remakes/scenes'/(item['kryxId']+'.blend'))
    print('FRAMED',index+1,item['sourceId'],flush=True)
