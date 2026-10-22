"""Import owner-requested EV default weapons via Blender; preserve source surfaces."""
import bpy,json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fit_default_weapon_grips import VIEWMODEL_SUPPORT
ROOT=Path(__file__).resolve().parents[2]
source=ROOT/'tools/blender/collection/remodel_collection.py'
scope={'__file__':str(source),'__name__':'default_weapon_import'}
code=source.read_text().split('selected=sys.argv')[0]
code=code.replace("bevel=obj.modifiers.new('Kryx armor chamfer','BEVEL');bevel.width=.0015;bevel.segments=1;bevel.limit_method='ANGLE';bevel.angle_limit=.65\n        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=bevel.name)",'# Preserve original geometry without beveling.')
code=code.replace("    mats=materials(src['materials'],item['referenceName'],item['rarity'],src['textures'],out)", "    if wid=='uzi' and 'BIND_LEFTHAND' in markers:\n        contact=fit(markers['BIND_LEFTHAND'])\n        pose=dict(pose,support=[contact.x,contact.z,-contact.y])\n    mats=materials(src['materials'],item['referenceName'],item['rarity'],src['textures'],out)")
exec(compile(code,str(source),'exec'),scope)
items=json.loads((ROOT/'art/ev-default-weapons/catalog.json').read_text())
out=ROOT/'public/models/ev-default';out.mkdir(parents=True,exist_ok=True)
art=ROOT/'art/ev-default-weapons';art.mkdir(parents=True,exist_ok=True)
for item in items:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    wid=item['id'];scope['WEAPONS'][item['name']]=wid
    pose=item['pose']
    if wid!='sword':
        factor=.45 if wid=='energyshotgun' else .85 if wid=='uzi' else .9 if wid=='concussion' else .65
        pose=dict(pose,muzzle=[t+(m-t)*factor for t,m in zip(pose['trigger'],pose['muzzle'])])
    scope['FIT'][wid]=pose
    src=scope['read_asset'](ROOT/f'art/ev-default-weapons/source/{wid}.evobj')
    scope['weapon']({'weapon':item['name'],'referenceName':item['name'],'rarity':'common','kryxId':wid},src,art)
    def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    root=bpy.data.objects['weapon_'+wid]
    contact_pose=dict(root['authoredHandPose'])
    surfaces=[BVHTree.FromPolygons([v.co for v in o.data.vertices],[list(p.vertices) for p in o.data.polygons]) for o in root.children if o.type=='MESH']
    for key in ['trigger','support']:
        if key not in contact_pose or (key=='support' and not contact_pose.get('supportVisible',True)):continue
        p=contact_pose[key];target=Vector((p[0],-p[2],p[1]+(.03 if key=='trigger' else 0)))
        hits=[tree.find_nearest(target) for tree in surfaces];hits=[h for h in hits if h[0] is not None]
        nearest=min(hits,key=lambda h:h[3])
        if nearest[3]>.02:
            v=nearest[0];contact_pose[key]=[v.x,v.z-(.03 if key=='trigger' else 0),-v.y]
    if wid in VIEWMODEL_SUPPORT:
        # This importer precedes the RPG's separate 2.3x shoulder-size pass.
        factor = 1 / 2.3 if wid == 'rpg' else 1
        contact_pose['viewmodelSupport']=[v * factor for v in VIEWMODEL_SUPPORT[wid]]
        if contact_pose.get('supportVisible', True):
            x, y, z = VIEWMODEL_SUPPORT[wid]
            contact_pose['characterSupport']=[(x - .055)*factor, (y - .025)*factor, (z + .045)*factor]
    root['authoredHandPose']=contact_pose
    for index,record in enumerate(src['materials']):
        material=bpy.data.materials.get(item['name']+' | material '+str(index))
        node=material.node_tree.nodes['Principled BSDF']
        color=tuple(linear(v) for v in record.get('color',[.4,.4,.4,1])[:3])+(1,)
        node.inputs['Base Color'].default_value=color;material.diffuse_color=color
        node.inputs['Metallic'].default_value=record.get('metallic',0)
        node.inputs['Roughness'].default_value=record.get('roughness',1)
        node.inputs['Emission Color'].default_value=tuple(linear(v) for v in record.get('emissive',[0,0,0]))+(1,)
        node.inputs['Emission Strength'].default_value=record.get('intensity',0)

    bpy.ops.wm.save_as_mainfile(filepath=str(art/f'{wid}.blend'),compress=True)
    bpy.ops.export_scene.gltf(filepath=str(out/f'{wid}.glb'),export_format='GLB',export_extras=True,export_animations=False)
    print('IMPORTED',wid)
(art/'sources.json').write_text(json.dumps([{'id':i['id'],'name':i['name'],'url':i['url']} for i in items],indent=2))
