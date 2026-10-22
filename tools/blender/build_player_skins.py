"""Original Blender armor designs on the published player rig. Run with Blender -b --python this_file."""
import bpy, bmesh, math, json, sys
from pathlib import Path
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'art/player-skins'; OUT.mkdir(parents=True,exist_ok=True)
ASSETS=ROOT/'public/assets/player-skins'; ASSETS.mkdir(parents=True,exist_ok=True)
THUMBS=ROOT/'public/assets/character-skins'
DESIGNS=[('default_vanguard','Vanguard','#414b58','#f07808','#c7ff34'),('reactor_bastion','Reactor Bastion','#414b58','#ed7514','#ffd365'),('pestilence_warden','Pestilence Warden','#171e26','#48525c','#b3eb29'),('abyssal_sentinel','Abyssal Sentinel','#183d52','#b0d5df','#33eddf')]
def mat(name,h,metal=.35,glow=0):
 srgb=[int(h[i:i+2],16)/255 for i in (1,3,5)]; c=tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in srgb); m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
 n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=(*c,1);n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=.52
 n.inputs['Emission Color'].default_value=(*c,1);n.inputs['Emission Strength'].default_value=glow
 return m
selected=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
for slug,title,base,accent,energy in DESIGNS:
 if selected and slug not in selected:continue
 bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(ROOT/'art/player-skins/rig-source.glb'))
 rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE');rig.data.pose_position='REST';rig.animation_data_clear()
 for b in rig.pose.bones:b.matrix_basis=Matrix.Identity(4)
 for o in list(bpy.context.scene.objects):
  if o.type!='ARMATURE' and not(o.type=='MESH' and o.find_armature()==rig): bpy.data.objects.remove(o,do_unlink=True)
 body=[o for o in bpy.context.scene.objects if o.type=='MESH']
 armor=mat(title+' | ceramic',base); trim=mat(title+' | accent',accent); glow=mat(title+' | power',energy,.2,.65);dark=mat(title+' | graphite','#101820',.12);pale=mat(title+' | porcelain','#c9d1c7',.15)
 for o in body:
  head=o.vertex_groups.get('Bip001 Head')
  if head:
   indices={v.index for v in o.data.vertices if any(g.group==head.index and g.weight>.45 for g in v.groups)}
   bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.index in indices],context='VERTS');bm.to_mesh(o.data);bm.free()
  for i,m in enumerate(o.data.materials):o.data.materials[i]= dark if 'Undersuit' in m.name else trim if 'orange' in m.name else armor if 'gray' in m.name else glow
 # Give every new plate genuine skin weights on the original joint chain.
 def bind(o,name,bone,material):
  o.name=title+' | '+name;o.data.materials.clear();o.data.materials.append(material)
  bpy.context.view_layer.objects.active=o;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
  g=o.vertex_groups.new(name='Bip001 '+bone);g.add(list(range(len(o.data.vertices))),1,'REPLACE')
  mod=o.modifiers.new('Published player skeleton','ARMATURE');mod.object=rig;o.parent=rig
  return o
 def box(name,bone,loc,size,m=armor,bevel=.025):
  bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
  if bevel:
   b=o.modifiers.new('Machined bevel','BEVEL');b.width=bevel;b.segments=1;bpy.ops.object.modifier_apply(modifier=b.name)
  return bind(o,name,bone,m)
 def orb(name,bone,loc,scale,m=armor,sub=2):
  bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub,radius=1,location=loc);o=bpy.context.object;o.scale=scale;return bind(o,name,bone,m)
 def tube(name,bone,a,b,r,m=armor,r2=None,vertices=12):
  a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r,radius2=r if r2 is None else r2,depth=(b-a).length,location=(a+b)/2)
  o=bpy.context.object;o.rotation_mode='QUATERNION';o.rotation_quaternion=(b-a).to_track_quat('Z','Y');return bind(o,name,bone,m)
 def plate(name,bone,points,y,depth,m=armor):
  n=len(points);v=[(x,y+d,z) for d in (0,depth) for x,z in points];f=[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  mesh=bpy.data.meshes.new(name);mesh.from_pydata(v,[],f);mesh.update();bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True)
  b=o.modifiers.new('Armor edge chamfer','BEVEL');b.width=.012;b.segments=1;bpy.ops.object.modifier_apply(modifier=b.name)
  return bind(o,name,bone,m)
 # Shared inset construction, each silhouette receives different outer plates.
 for side,s in [('L',1),('R',-1)]:
  x=s*.16
  boot_clearance=.10 if slug=='default_vanguard' else 0
  plate('layered shin',side+' Calf',[(x-.095,.18+boot_clearance),(x-.12,.54),(x-.06,.68),(x+.095,.57),(x+.08,.2+boot_clearance)],-.245,.065)
  box('shin light',side+' Calf',(x,-.282,.43),(.026,.02,.23),glow,.006)
  orb('knee shell',side+' Calf',(x,-.17 if slug=='default_vanguard' else -.24,.74),(.105,.055 if slug=='default_vanguard' else .10,.08 if slug=='default_vanguard' else .10),trim,1)
  box('forearm bracer',side+' Forearm',(s*.78,-.095,1.99),(.24,.19,.13),armor,.025)
  for j in range(3):box('bracer vent',side+' Forearm',(s*(.71+j*.045),-.232,1.99),(.018,.014,.09),glow,.003)
  plate('chest wing','Spine2',[(s*.025,1.98),(s*.29,1.96),(s*.33,1.78),(s*.09,1.69)],-.43,.07)
 if slug in ('reactor_bastion','default_vanguard'):
  orb('reinforced helmet','Head',(0,-.075,2.24),(.215,.215,.245),armor)
  box('brow guard','Head',(0,-.275,2.30),(.36,.11,.075),trim)
  box('visor slit','Head',(0,-.324,2.25),(.29,.018,.052),dark,.009)
  box('visor filament','Head',(0,-.338,2.25),(.23,.01,.012),glow,.003)
  plate('jaw shield','Head',[(-.14,2.19),(.14,2.19),(.095,2.085),(-.095,2.085)],-.28,.09,trim)
  box('helmet center ridge','Head',(0,-.09,2.478),(.055,.29,.025),trim,.006)
  if slug!='default_vanguard':tube('comms mast','Head',(.2,.045,2.30),(.24,.045,2.62),.014,trim,.008)
  if slug!='default_vanguard':tube('reactor socket','Spine2',(0,-.43,1.86),(0,-.485,1.86),.105,dark)
  if slug!='default_vanguard':tube('reactor core','Spine2',(0,-.488,1.86),(0,-.50,1.86),.064,glow)
  for side,s in [('L',1),('R',-1)]:
   orb('heavy shoulder',side+' UpperArm',(s*.375,-.075,1.98),(.22,.25,.205),armor,1)
   box('shoulder rank',side+' UpperArm',(s*.39,-.305,1.98),(.16,.025,.08),trim,.01)
   tube('back coolant','Spine1',(s*.19,.17,1.52),(s*.19,.17,1.92),.085,trim)
 elif slug=='pestilence_warden':
  orb('sealed hood','Head',(0,-.07,2.235),(.22,.235,.23),dark)
  tube('hat brim','Head',(0,-.06,2.405),(0,-.06,2.442),.32,dark,vertices=12)
  tube('crown','Head',(0,-.06,2.435),(0,-.06,2.60),.22,dark,.19,12)
  # Original faceted respirator mask with a tapered beak, not a copied mesh.
  plate('mask face','Head',[(-.145,2.34),(.145,2.34),(.14,2.17),(0,2.09),(-.14,2.17)],-.302,.065,pale)
  tube('plague respirator beak','Head',(0,-.33,2.21),(0,-.56,2.08),.092,pale,.012,6)
  for s in [-1,1]:
   tube('lens socket','Head',(s*.085,-.327,2.28),(s*.085,-.366,2.28),.055,dark)
   tube('toxic lens','Head',(s*.085,-.367,2.28),(s*.085,-.377,2.28),.036,glow)
   tube('filter','Head',(s*.15,-.22,2.14),(s*.20,-.22,2.14),.04,trim)
  orb('high collar','Spine2',(0,-.015,2.055),(.31,.29,.12),dark)
  for side,s in [('L',1),('R',-1)]:
   plate('split armored coat',side+' Thigh',[(s*.08,1.36),(s*.31,1.32),(s*.41,.67),(s*.1,.80)],.09,.045,dark)
   for j in range(3):tube('alchemical cartridge','Pelvis',(s*(.13+j*.05),-.23,1.25),(s*(.13+j*.05),-.23,1.37),.022,glow)
   orb('pointed shoulder',side+' UpperArm',(s*.365,-.06,1.98),(.19,.20,.16),armor,1)
  for j in range(3):box('rib power line','Spine1',(0,-.38,1.54+j*.08),(.24-j*.03,.02,.022),glow,.004)
 else:
  orb('diving helmet','Head',(0,-.08,2.245),(.225,.24,.245),armor)
  orb('deep glass visor','Head',(0,-.282,2.255),(.185,.09,.145),dark)
  for s in [-1,1]:
   tube('halo side rail','Head',(s*.20,-.23,2.12),(s*.20,-.23,2.39),.025,glow)
   tube('rebreather port','Head',(s*.135,-.29,2.13),(s*.135,-.35,2.13),.044,trim)
   tube('air tank','Spine1',(s*.17,.20,1.44),(s*.17,.20,1.98),.09,trim)
   tube('tank stripe','Spine1',(s*.17,.205,1.70),(s*.17,.205,1.76),.094,glow)
  box('visor crossbar','Head',(0,-.371,2.26),(.29,.012,.018),glow,.004)
  for side,s in [('L',1),('R',-1)]:
   plate('hydrofoil shoulder',side+' UpperArm',[(s*.28,2.08),(s*.58,2.14),(s*.50,1.88),(s*.30,1.84)],-.13,.19,trim)
   plate('fin greave',side+' Calf',[(s*.23,.25),(s*.36,.60),(s*.25,.64)],-.13,.07,trim)
  plate('breast diamond','Spine2',[(0,2.0),(.11,1.84),(0,1.68),(-.11,1.84)],-.47,.065,trim)
  box('core display','Spine2',(0,-.514,1.85),(.05,.017,.11),glow,.008)
 # Merge by material to keep draw calls bounded while preserving per-vertex weights.
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
 bpy.ops.object.select_all(action='DESELECT')
 for o in meshes:o.select_set(True)
 bpy.context.view_layer.objects.active=meshes[0];bpy.ops.object.join();merged=bpy.context.object;merged.name=slug+' authored skin'
 rig.data.pose_position='POSE'
 # Export bind pose geometry; game supplies all thirteen published animations.
 if slug=='default_vanguard':
  for m,n in [(armor,'Armor | gray'),(trim,'Armor | orange'),(dark,'Undersuit | charcoal'),(glow,'Visor and accents | emissive lime')]:m.name=n
 bpy.ops.export_scene.gltf(filepath=str(ASSETS/(slug+'.glb')),export_format='GLB',export_animations=False,export_yup=True,export_extras=True)
 # Relaxed showcase stance for the editable scene and studio thumbnails.
 for side,s in [('L',1),('R',-1)]:
  b=rig.pose.bones.get('Bip001 '+side+' UpperArm');h=b.head.copy();b.matrix=Matrix.Translation(h) @ Matrix.Rotation(s*1.15,4,'Y') @ Matrix.Translation(-h) @ b.matrix
  bpy.context.view_layer.update()
 rig.pose.bones['Bip001 Head'].rotation_mode='XYZ'
 # Studio setup: three lights, subtle floor, generous framing.
 scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
 scene.world=bpy.data.worlds.new('Studio');scene.world.color=(.055,.055,.055)
 for name,loc,power,color,size in [('key',(3,-4,5),450,(.86,.93,1),4),('fill',(-3,-2,3),260,(.40,.65,1),3),('rim',(1,3,4),600,(1,.63,.33),3)]:
  bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.name=name;l.data.energy=power;l.data.color=color;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((0,0,1.3))-l.location).to_track_quat('-Z','Y').to_euler()
 bpy.ops.object.camera_add(location=(3,-6,2.85));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1.27))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3.1;scene.camera=camera
 scene.render.resolution_x=560;scene.render.resolution_y=700;scene.render.resolution_percentage=100;scene.render.film_transparent=True
 scene.view_settings.view_transform='AgX';scene.render.image_settings.file_format='PNG';scene.render.filepath=str(THUMBS/(slug+'.png'))
 bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(slug+'.blend')))
 bpy.ops.render.render(write_still=True)
 print('FINISHED_SKIN',slug,flush=True)
