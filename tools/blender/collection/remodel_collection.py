"""Offline Blender remodeling of the owner's selected non-Relic references.

Source meshes are references/derivatives, not represented as original IP.
Every character is fitted to the published Kryx rig before export.
"""
import bpy, bmesh, json, sys, math
import numpy as np
from pathlib import Path
from mathutils import Matrix, Vector, Quaternion
sys.path.insert(0,str(Path(__file__).parent))
from read_ev_asset import read_asset
ROOT=Path(__file__).resolve().parents[3]
CAT=json.loads((ROOT/'art/collection-remakes/catalog.json').read_text())['items']
OUT=ROOT/'artifacts/collection-remodeled';OUT.mkdir(exist_ok=True)
C=Matrix(((-1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))

def transform(t):
    q=t['rotation'];return Matrix.LocRotScale(Vector(t['position']),Quaternion((q[3],*q[:3])),Vector(t['scale']))

def materials(records,title,rarity,textures=None,out=None):
    result=[]
    for i,record in enumerate(records):
        m=bpy.data.materials.new(title+' | material '+str(i));m.use_nodes=True
        node=m.node_tree.nodes['Principled BSDF'];color=record.get('color',[.35,.38,.42,1])
        # Preserve the recognizable palette, with Kryx ceramic/graphite shading.
        node.inputs['Base Color'].default_value=tuple(color[:3])+(1,)
        node.inputs['Metallic'].default_value=.25;node.inputs['Roughness'].default_value=.54
        emission=record.get('emissive',[0,0,0]);node.inputs['Emission Color'].default_value=tuple(emission)+(1,)
        node.inputs['Emission Strength'].default_value=min(record.get('intensity',0),1.2 if rarity=='legendary' else .65)
        def texture_node(index):
            if not textures or not 0 <= index < len(textures): return None
            tex=textures[index];p=out/('texture_'+str(index)+('.png' if tex['kind']==0 else '.jpg'))
            if not p.exists():p.write_bytes(tex['bytes'])
            image=bpy.data.images.load(str(p),check_existing=True);image.pack()
            sampler=m.node_tree.nodes.new('ShaderNodeTexImage');sampler.image=image
            return sampler
        for key,socket,tint in [('map','Base Color',color),('emissiveMap','Emission Color',emission)]:
            sampler=texture_node(record.get(key,-1))
            if sampler:
                multiply=m.node_tree.nodes.new('ShaderNodeMixRGB');multiply.blend_type='MULTIPLY'
                multiply.inputs[0].default_value=1
                multiply.inputs[2].default_value=tuple(tint[:3])+(1,)
                m.node_tree.links.new(sampler.outputs['Color'],multiply.inputs[1])
                m.node_tree.links.new(multiply.outputs[0],node.inputs[socket])
        m.diffuse_color=tuple(color[:3])+(1,);result.append(m)
    return result

def character(item,src):
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'art/player-skins/rig-source.glb'))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    rig.animation_data_clear();rig.data.pose_position='REST'
    for b in rig.pose.bones:b.matrix_basis=Matrix.Identity(4)
    for o in list(bpy.context.scene.objects):
        if o!=rig:bpy.data.objects.remove(o,do_unlink=True)
    mats=materials(src['materials'],item['referenceName'],item['rarity'])
    worlds=[]
    for b in src['bones']:
        local=transform(b);worlds.append(worlds[b['parent']]@local if b['parent']>=0 else local)
    source_points=[(C@w).translation for w in worlds]
    names={b['name']:i for i,b in enumerate(src['bones'])}
    target={b.name:rig.matrix_world@b.matrix_local for b in rig.data.bones}
    def resolve(i):
        while i>=0:
            name=src['bones'][i]['name'].replace('Bip002','Bip001')
            if name in target:return name
            i=src['bones'][i]['parent']
        return 'Bip001 Pelvis'
    mapping=[resolve(i) for i in range(len(worlds))]
    pelvis=names.get('Bip001 Pelvis',names.get('Bip002 Pelvis'))
    head=names.get('Bip001 Head',names.get('Bip002 Head'))
    if pelvis is None or head is None:raise ValueError('Needs manual rig mapping: missing pelvis/head')
    scale=(target['Bip001 Head'].translation-target['Bip001 Pelvis'].translation).length/(source_points[head]-source_points[pelvis]).length
    rotations=[]
    for i,b in enumerate(src['bones']):
        children=[j for j,c in enumerate(src['bones']) if c['parent']==i and mapping[j]!=mapping[i]]
        child=next((j for j in children if 'Finger' not in mapping[j]),children[0] if children else None)
        if child is not None:
            a=source_points[child]-source_points[i];z=target[mapping[child]].translation-target[mapping[i]].translation
            rotations.append(a.rotation_difference(z) if a.length>.0001 and z.length>.0001 else Quaternion())
        else:rotations.append(Quaternion())
    for mesh_index,record in enumerate(src['meshes']):
        verts=[];groups={};boneids=record['bones'];inverses=[Matrix([v[k:k+4] for k in range(0,16,4)]) for v in record['inverse']]
        for vi in range(len(record['vertices'])//3):
            p=Vector(record['vertices'][vi*3:vi*3+3]);weights=record['weights'][vi];out=Vector();total=0
            for bi,w in zip(weights['bones'],weights['weights']):
                if w<=.00001:continue
                si=boneids[bi];name=mapping[si]
                bindpos=C@worlds[si]@inverses[bi]@p
                out+=(target[name].translation+rotations[si]@((bindpos-source_points[si])*scale))*w
                groups.setdefault(name,[]).append((vi,w));total+=w
            if total<.001:raise ValueError('Unweighted source vertex')
            verts.append(out/total)
        faces=[];face_mats=[]
        for g in record['groups']:
            ix=g['indices'];faces.extend(tuple(reversed(ix[j:j+3])) for j in range(0,len(ix),3));face_mats.extend([g['material']]*(len(ix)//3))
        geo=bpy.data.meshes.new('Kryx fitted mesh');geo.from_pydata(verts,[],faces);geo.update()
        obj=bpy.data.objects.new(item['kryxId']+'_'+str(mesh_index),geo);bpy.context.collection.objects.link(obj)
        for m in mats:geo.materials.append(m)
        for poly,mi in zip(geo.polygons,face_mats):poly.material_index=max(0,mi);poly.use_smooth=False
        for name,values in groups.items():
            vg=obj.vertex_groups.new(name=name)
            for vi,w in values:vg.add([vi],w,'ADD')
        mod=obj.modifiers.new('Kryx animation rig','ARMATURE');mod.object=rig;obj.parent=rig
        # Chamfer hard armor edges in Blender; keep skinning and flexible joints.
        if mesh_index>0:
            bevel=obj.modifiers.new('Kryx machined edges','BEVEL');bevel.width=.0025;bevel.segments=1;bevel.limit_method='ANGLE';bevel.angle_limit=.65
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.modifier_apply(modifier=bevel.name)
    rig.data.pose_position='POSE'
    return rig

WEAPONS={'Auto Rifle':'m4','Hand Cannon':'magnum','Burst Rifle':'battlerifle','Sweeper':'energyshotgun','Laser Rifle':'plasmarifle','Sword':'sword'}
FIT=json.loads((ROOT/'art/collection-remakes/weapon-fit.json').read_text())
def weapon(item,src,out):
    wid=WEAPONS[item['weapon']];pose=FIT[wid];nodes=[];markers={}
    def visit(n,parent):
        world=parent@transform(n);nodes.append((n,world))
        if n['name'].startswith('BIND_'):markers[n['name']]=world.translation.copy()
        for child in n['children']:visit(child,world)
    visit(src['root'],Matrix.Identity(4))
    all_points=[]
    for n,world in nodes:
        if n['geometry']<0 or not n['materials']:continue
        verts=src['geometries'][n['geometry']]['vertices']
        all_points.extend(world@Vector(verts[i:i+3]) for i in range(0,len(verts),3))
    points=np.array(all_points);right=markers['BIND_RIGHTHAND']
    blade_basis=None
    if wid=='sword':
        _,basis=np.linalg.eigh(np.cov(points.T));axis=Vector(basis[:,-1]);wide=Vector(basis[:,-2])
        if axis.dot(Vector(points.mean(axis=0))-right)<0:axis.negate()
        thin=axis.cross(wide);blade_basis=(axis,wide,thin)
        blade_length=max(axis.dot(p-right) for p in all_points)
        if blade_length<.1:raise ValueError('Invalid blade length')
        blade_scale=(pose['trigger'][2]-pose['muzzle'][2])/blade_length
    elif markers['BIND_BULLET'].z>=markers.get('BIND_LEFTHAND',right).z or right.z-markers['BIND_BULLET'].z<(points[:,2].max()-points[:,2].min())*.35:
        front=points[points[:,2]<=points[:,2].min()+.015]
        markers['BIND_BULLET']=Vector(front.mean(axis=0))
    if not blade_basis:
        # One similarity transform for the whole gun: never bend its barrel
        # to fit a third hand anchor. Mirror the source handedness first.
        source_direction=markers['BIND_BULLET']-right
        source_direction.x=-source_direction.x
        target_direction=Vector(pose['muzzle'])-Vector(pose['trigger'])
        gun_rotation=source_direction.rotation_difference(target_direction)
        gun_scale=target_direction.length/source_direction.length
    def fit(p):
        if blade_basis:
            axis,wide,thin=blade_basis;v=p-right;t=pose['trigger'];scale=min(blade_scale,1.1)
            return Vector((t[0]+v.dot(wide)*scale,-t[2]+v.dot(axis)*blade_scale,t[1]+v.dot(thin)*scale))
        offset=p-right;offset.x=-offset.x
        fitted=Vector(pose['trigger'])+gun_rotation@offset*gun_scale
        return Vector((fitted.x,-fitted.z,fitted.y))
    if not blade_basis:
        sample=all_points[::max(1,len(all_points)//80)]
        for point in sample:
            # A rigidly scaled gun preserves straight lines and relative distances.
            midpoint=(point+right)*.5
            assert (fit(midpoint)-(fit(point)+fit(right))*.5).length<1e-5, 'Bent weapon fit'
            expected=(point-right).length*gun_scale
            assert abs((fit(point)-fit(right)).length-expected)<1e-5, 'Distorted weapon fit'
    mats=materials(src['materials'],item['referenceName'],item['rarity'],src['textures'],out)
    for m in mats:m['role']='body'
    root=bpy.data.objects.new('weapon_'+wid,None);bpy.context.collection.objects.link(root);root['authoredHandPose']={k:v for k,v in pose.items() if k!='muzzle'}
    for n,world in nodes:
        if n['geometry']<0 or not n['materials']:continue
        record=src['geometries'][n['geometry']];p=record['vertices']
        verts=[fit(world@Vector(p[i:i+3])) for i in range(0,len(p),3)];faces=[];fm=[]
        for i,g in enumerate(record['groups']):
            ix=g['indices'];faces.extend(tuple(reversed(ix[j:j+3])) for j in range(0,len(ix),3));fm.extend([n['materials'][i]]*(len(ix)//3))
        geo=bpy.data.meshes.new('Fitted weapon surface');geo.from_pydata(verts,[],faces);geo.update()
        obj=bpy.data.objects.new(item['kryxId'],geo);bpy.context.collection.objects.link(obj);obj.parent=root
        for m in mats:geo.materials.append(m)
        for poly,mi in zip(geo.polygons,fm):poly.material_index=mi;poly.use_smooth=False
        if record.get('uv'):
            uv=geo.uv_layers.new(name='Reference artwork')
            for loop in geo.loops:uv.data[loop.index].uv=record['uv'][loop.vertex_index*2:loop.vertex_index*2+2]
        bevel=obj.modifiers.new('Kryx armor chamfer','BEVEL');bevel.width=.0015;bevel.segments=1;bevel.limit_method='ANGLE';bevel.angle_limit=.65
        bpy.context.view_layer.objects.active=obj;bpy.ops.object.modifier_apply(modifier=bevel.name)
    for name,key in [('BIND_BULLET','muzzle'),('BIND_RIGHTHAND','trigger'),('BIND_LEFTHAND','support')]:
        o=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(o);o.parent=root;p=pose[key];o.location=(p[0],-p[2],p[1])
    return None

def studio(item,rig,out):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=12
    scene.world=bpy.data.worlds.new('Kryx studio');scene.world.color=(.08,.08,.08)
    for pos,power,size in [((3,-4,5),500,4),((-3,-2,3),300,3),((0,3,4),700,3)]:
        bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.size=size;o.rotation_euler=(Vector((0,0,1.3))-o.location).to_track_quat('-Z','Y').to_euler()
    if rig:
        for side,s in [('L',1),('R',-1)]:
            b=rig.pose.bones.get('Bip001 '+side+' UpperArm');h=b.head.copy();b.matrix=Matrix.Translation(h)@Matrix.Rotation(s*1.15,4,'Y')@Matrix.Translation(-h)@b.matrix
            bpy.context.view_layer.update()
    bpy.ops.object.camera_add(location=(3,-6,2.85));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,1.27))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=3.2;scene.camera=cam
    scene.render.resolution_x=400;scene.render.resolution_y=500;scene.render.resolution_percentage=100;scene.render.film_transparent=True
    if not rig:
        cam.location=(1.8,-2.2,1.15);target=Vector((0,.25,0));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=1.55
        scene.render.resolution_x=600;scene.render.resolution_y=400
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(out/'preview.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(out/'model.blend'),compress=True)
    bpy.ops.render.render(write_still=True)

selected=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
force='--force' in selected
selected=[x for x in selected if x!='--force']
for item in CAT:
    if selected and item['sourceId'] not in selected:continue
    out=OUT/item['kryxId'];out.mkdir(exist_ok=True)
    if not force and (out/'preview.png').exists() and (out/'model.glb').exists():continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source=ROOT/'artifacts/collection-reference'/ (item['sourceId']+('.evskin' if item['category']=='character' else '.evobj'))
    rig=character(item,read_asset(source)) if item['category']=='character' else weapon(item,read_asset(source),out)
    bpy.ops.export_scene.gltf(filepath=str(out/'model.glb'),export_format='GLB',export_animations=False,export_yup=True)
    studio(item,rig,out)
    print('REMODELED',item['sourceId'],item['referenceName'],flush=True)
