"""Blender-authored Survival roster. Retains the shipped articulated zombie rig.
Run with Blender --background --python tools/blender/build_zombie_roster.py.
Exports a shared GLB library, editable .blend, and a labelled studio contact sheet.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'art/zombies'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/zombie.glb'))
base = list(bpy.context.scene.objects)
for o in base:
    o['rigName'] = o.name

DESIGNS = [
 ('quarantine','Quarantine', '#c7a139','#94a479','hazmat'),
 ('riot','Riot Breaker','#394555','#869280','riot'),
 ('miner','Deep Miner','#b36928','#8f977a','miner'),
 ('medic','Lost Medic','#d5d3be','#949681','medic'),
 ('cinder','Cinder Husk','#3c3634','#5c6257','fire'),
 ('bloom','Spore Bloom','#696446','#8b9e64','mushroom'),
 ('thorn','Thornwalker','#304f3b','#7d9266','garden'),
 ('cryo','Cryo Subject','#698a9c','#b4c5bb','ice'),
 ('reactor','Reactor Leak','#454b27','#94af67','toxic'),
 ('diver','Sunken Diver','#375b5c','#879d91','diver'),
 ('scrapper','Scrap Collector','#775144','#8e947c','scrap'),
 ('warden','Prison Warden','#5a5256','#939b87','warden'),
 ('runner','Track Runner','#994638','#b4ac8a','runner'),
 ('engineer','Dead Engineer','#687b8b','#909d7a','engineer'),
 ('parasite','Parasite Host','#643e62','#a0a881','parasite'),
 ('bone','Bone Carapace','#858675','#9da584','bone'),
 ('signal','Signal Lost','#36424f','#869982','antenna'),
 ('breacher','Breach Unit','#736948','#929773','breacher'),
 ('crystal','Crystal Revenant','#594e79','#9da7a0','crystal'),
 ('scavenger','Wasteland Scavenger','#776545','#a4a487','scavenger'),
]
def rgb(h): return tuple(int(h[i:i+2],16)/255 for i in (1,3,5))
def material(name,color,metal=0,glow=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*rgb(color),1);m.use_nodes=True
    n=m.node_tree.nodes.get('Principled BSDF');n.inputs['Base Color'].default_value=m.diffuse_color
    n.inputs['Metallic'].default_value=metal;n.inputs['Roughness'].default_value=.72
    if glow:
        n.inputs['Emission Color'].default_value=m.diffuse_color;n.inputs['Emission Strength'].default_value=glow
    return m
dark=material('Graphite straps','#242d2c',.3)
bone=material('Exposed bone','#c5bd92')
blood=material('Dry wound','#633f34')
roots=[];manifest=[]
def v(p): return Vector((p[0],p[2],p[1]))  # shipped zombie faces +Z; detail coordinates use -Z forward
for index,(slug,name,coat,skin,design) in enumerate(DESIGNS):
    copies={o:o.copy() for o in base}
    for old,o in copies.items():
        bpy.context.collection.objects.link(o)
        o.parent=copies.get(old.parent)
        if old.type=='MESH': o.data=old.data.copy()
    rig={o['rigName']:o for o in copies.values()}
    root=rig['zroot'];root.name='zombie_'+slug;root['variantId']=index;root['displayName']=name
    roots.append(root)
    armor=material(name+' worn equipment',coat,.18)
    flesh=material(name+' decayed hide',skin)
    glowcolor=('#ff6720' if design=='fire' else '#85edc3' if design in ('diver','cryo','ice') else '#c97cff' if design in ('parasite','crystal') else '#c8ed42')
    glow=material(name+' infection',glowcolor,0,1.4)
    for o in copies.values():
        if o.type!='MESH':continue
        n=o['rigName']
        m=glow if any(k in n for k in ('EyeGlow','Plasma')) else bone if any(k in n for k in ('Bone','Tooth','Rib','Sternum')) else blood if any(k in n for k in ('Wound','Rot')) else dark if any(k in n for k in ('Suit','Hair','Strap','Socket','Dark','Claw','Bolt')) else armor if any(k in n for k in ('Plate','Armor','Guard','Greave','Pauld','Gaunt','Boot','Trim','Belt','Pant')) else flesh
        o.data.materials.clear();o.data.materials.append(m)
        for poly in o.data.polygons: poly.material_index=0
        # Change surfaces, never joint origins: the animation remains grounded.
        factor=1.13 if design in ('riot','breacher','bone') else .91 if design=='runner' else 1
        if o.parent and o.parent.get('rigName')=='spineGroup':
            for vert in o.data.vertices: vert.co.x*=factor
    added=[]
    def finish(o,label,parent,loc,mat):
        o.name=name+' '+label;o.parent=rig[parent];o.location=v(loc)
        o.data.materials.append(mat);o['authoredDetail']=label;added.append(o);return o
    def box(label,parent,loc,size,mat=armor):
        bpy.ops.mesh.primitive_cube_add(size=1)
        o=bpy.context.object;o.dimensions=(size[0],size[2],size[1])
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        bevel=o.modifiers.new('Chipped bevel','BEVEL');bevel.width=.012;bevel.segments=1
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=bevel.name)
        return finish(o,label,parent,loc,mat)
    def orb(label,parent,loc,size,mat=flesh):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=1)
        o=bpy.context.object;o.scale=(size[0],size[2],size[1]);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        return finish(o,label,parent,loc,mat)
    def rod(label,parent,start,end,r=.025,mat=dark,tip=None):
        a,b=v(start),v(end)
        bpy.ops.mesh.primitive_cone_add(vertices=8,radius1=r,radius2=r if tip is None else tip,depth=(b-a).length)
        o=bpy.context.object;finish(o,label,parent,(0,0,0),mat);o.location=(a+b)/2
        o.rotation_mode='QUATERNION';o.rotation_quaternion=(b-a).to_track_quat('Z','Y');return o
    def pack(mat=armor):box('backpack','spineGroup',(0,.38,.18),(.34,.4,.16),mat)
    def visor():box('visor frame','headGroup',(0,.08,-.15),(.34,.18,.09),armor);box('dark visor','headGroup',(0,.08,-.203),(.27,.09,.018),dark)
    def tanks(mat=armor):
        for x in [-.13,.13]:rod('canister','spineGroup',(x,.17,.25),(x,.63,.25),.095,mat)
    def spikes(parent='spineGroup',mat=bone):
        for i in range(5):
            x=(i-2)*.10
            rod('outgrowth',parent,(x,.55,.13),(x*1.6,.79+abs(x),.32),.06,mat,.007)
    def straps():
        for x in [-.12,.12]:box('harness','spineGroup',(x,.37,-.155),(.045,.43,.035),dark)
    if design=='hazmat':
        orb('sealed hood','headGroup',(0,.10,.01),(.24,.27,.22),armor);visor();tanks();straps()
        for x in [-.10,.10]:rod('respirator filter','headGroup',(x,-.025,-.17),(x,-.025,-.29),.06,dark)
    elif design=='riot':
        visor();box('helmet crown','headGroup',(0,.23,.01),(.37,.12,.31));box('chest slab','spineGroup',(0,.37,-.16),(.43,.32,.09));box('forearm shield','L_elbow',(-.07,-.12,-.07),(.36,.52,.08));straps()
    elif design=='miner':
        orb('hardhat','headGroup',(0,.22,.01),(.25,.13,.23),armor);box('hat brim','headGroup',(0,.18,-.035),(.46,.045,.46));orb('headlamp','headGroup',(0,.23,-.22),(.07,.065,.035),glow);pack();rod('tool handle','spineGroup',(-.20,.05,.25),(.25,.67,.25),.024);rod('pick head','spineGroup',(.08,.65,.25),(.38,.52,.25),.06,armor,.01)
    elif design=='medic':
        box('medical case','spineGroup',(0,.34,.23),(.45,.38,.15));box('cross vertical','spineGroup',(0,.38,-.175),(.055,.20,.026),blood);box('cross horizontal','spineGroup',(0,.38,-.178),(.17,.055,.026),blood);box('head band','headGroup',(0,.18,-.14),(.34,.085,.065),armor)
    elif design=='fire':
        tanks(dark);spikes(mat=dark)
        for i in range(7):orb('ember fissure','spineGroup',((i%3-1)*.12,.15+(i//3)*.13,-.17),(.055,.075,.028),glow)
    elif design=='mushroom':
        for i in range(7):
            x=(i%3-1)*.14;y=.28+(i//3)*.17;z=.17
            rod('fungal stalk','spineGroup',(x,y,z),(x,y+.15,z+.05),.04,flesh)
            orb('fungal cap','spineGroup',(x,y+.16,z+.05),(.15,.06,.14),armor)
        orb('head fungus','headGroup',(-.15,.25,.02),(.20,.07,.18),glow)
    elif design=='garden':
        spikes(mat=armor)
        for i in range(7):
            x=(-1 if i%2 else 1)*.19;y=.12+i*.065
            rod('root vine','spineGroup',(x*.65,y-.12,-.14),(x,y+.10,-.17),.028,armor)
            orb('leaf cluster','spineGroup',(x,y,-.17),(.095,.04,.035),glow if i==5 else armor)
    elif design=='ice':
        for i in range(6):rod('ice shard','spineGroup',((i%3-1)*.16,.36,.17),((i%3-1)*.23,.65+i*.045,.3),.06,glow,.004)
        visor();box('thermal collar','spineGroup',(0,.58,.0),(.41,.12,.30))
    elif design=='toxic':
        tanks(glow);straps();box('reactor chest','spineGroup',(0,.33,-.17),(.28,.27,.09));orb('reactor core','spineGroup',(0,.34,-.23),(.09,.10,.045),glow)
        rod('exhaust stack','spineGroup',(.22,.25,.15),(.22,.87,.15),.065,dark)
    elif design=='diver':
        orb('pressure helmet','headGroup',(0,.09,0),(.255,.26,.24),armor);visor();box('neck seal','neckGroup',(0,.02,0),(.41,.10,.35),dark);tanks();straps()
    elif design=='scrap':
        pack();straps()
        for i in range(5):box('salvaged plate','spineGroup',((i%2-.5)*.26,.17+i*.09,-.16),(.22,.14,.055),armor if i%2 else dark).rotation_euler.y=(i-2)*.14
        box('welded brow','headGroup',(.02,.15,-.15),(.38,.08,.06),bone)
    elif design=='warden':
        box('peaked cap','headGroup',(0,.23,0),(.38,.13,.30));box('cap peak','headGroup',(0,.17,-.15),(.38,.035,.19),dark);straps();box('badge','spineGroup',(-.12,.46,-.18),(.085,.11,.028),bone)
        for x in [-.22,.22]:box('coat skirt','spineGroup',(x,-.04,.05),(.12,.34,.24))
    elif design=='runner':
        box('race bib','spineGroup',(0,.30,-.17),(.24,.24,.025),bone);box('bandana','headGroup',(0,.16,-.13),(.35,.075,.055),armor)
        for side in ['L','R']:box('shin brace',side+'_knee',(0,-.20,-.065),(.10,.34,.045),dark)
        for x in [-.055,0,.055]:box('bib stripe','spineGroup',(x,.30,-.19),(.021,.14,.012),dark)
    elif design=='engineer':
        visor();pack();straps();rod('antenna tool','spineGroup',(.2,.2,.24),(.2,.78,.24),.03,armor)
        for i in range(4):box('belt tool','spineGroup',(-.18+i*.12,.015,-.14),(.075,.18,.08),dark)
    elif design=='parasite':
        for i in range(6):orb('parasite sac','spineGroup',((i%3-1)*.16,.25+(i//3)*.21,.19),(.12,.15,.13),glow if i%3==0 else armor)
        for x in [-.19,.19]:rod('mandible','headGroup',(x,.01,-.11),(x*.5,-.16,-.25),.05,armor,.012)
    elif design=='bone':
        for i in range(4):
            for sign in [-1,1]:rod('external rib','spineGroup',(0,.24+i*.08,-.19),(sign*.23,.18+i*.08,-.12),.035,bone)
        spikes();orb('bone brow','headGroup',(0,.18,-.15),(.25,.065,.08),bone)
    elif design=='antenna':
        pack();visor()
        for x in [-.16,.16]:rod('radio mast','spineGroup',(x,.33,.23),(x,.97,.23),.019,dark);orb('mast light','spineGroup',(x,.97,.23),(.03,.035,.03),glow)
        box('receiver','L_elbow',(0,-.12,-.1),(.17,.25,.09))
    elif design=='breacher':
        box('heavy chest','spineGroup',(0,.36,-.16),(.48,.40,.13));visor()
        for side,sign in [('L',-1),('R',1)]:box('shoulder shell',side+'_shoulder',(sign*.06,.02,0),(.31,.22,.32));box('knuckle ram',side+'_wrist',(0,-.09,-.055),(.22,.20,.20))
    elif design=='crystal':
        spikes(mat=glow)
        for i in range(5):rod('faceted crystal','headGroup',((i-2)*.06,.18,0),((i-2)*.10,.4+(.12 if i==2 else 0),.04),.055,glow,.002)
        for x in [-.19,.19]:orb('crystal chest','spineGroup',(x,.38,-.15),(.10,.16,.09),armor)
    else:
        pack();straps();box('face wrap','headGroup',(0,-.015,-.16),(.29,.14,.08),armor);box('hood top','headGroup',(0,.24,.025),(.38,.14,.32),dark)
        for side in ['L','R']:box('wrapped wrist',side+'_wrist',(0,-.06,0),(.17,.18,.15),armor)
        for i in range(3):box('supply pouch','spineGroup',(-.17+i*.17,.04,-.17),(.13,.14,.10))
    # Merge rigid surfaces by animated joint/material. Animation pivots stay
    # independent, while the horde avoids hundreds of tiny draw calls per body.
    buckets={}
    for o in list(copies.values())+added:
        if o.type=='MESH' and o.get('rigName')!='ZJawBone':
            buckets.setdefault((o.parent,o.data.materials[0]),[]).append(o)
    for (parent,mat),objects in buckets.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        bpy.ops.object.join();bpy.context.object.name=name+' '+parent.get('rigName',parent.name)+' '+mat.name
    manifest.append({'id':index,'slug':slug,'name':name,'design':design,'details':len(added)})
for o in base:bpy.data.objects.remove(o,do_unlink=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/zombie-roster.glb'),export_format='GLB',use_selection=True,export_extras=True)
(OUT/'roster.json').write_text(json.dumps(manifest,indent=2))

# Editable studio layout and labels live in the source file, not in game assets.
for i,root in enumerate(roots):
    root.location=((i%5-2)*1.5, (i//5)*2.6, 0)
    bpy.ops.object.text_add(location=(root.location.x-.6,root.location.y-.4,-.05))
    label=bpy.context.object;label.name='Label '+DESIGNS[i][1];label.data.body=f'{i+1:02}  '+DESIGNS[i][1];label.data.size=.13;label.rotation_euler=(math.radians(72),0,0)
    label.data.materials.append(bone)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
scene.render.resolution_x=2000;scene.render.resolution_y=1500;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Zombie studio');scene.world.color=(.22,.22,.22)
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object;floor.location.z=-.13;floor.data.materials.append(material('Studio floor','#171d24'))
def point_at(obj,point):obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(2,-13,16));camera=bpy.context.object;point_at(camera,(0,3.7,.65));camera.data.type='ORTHO';camera.data.ortho_scale=12.3;scene.camera=camera
for loc,power,size in [((-5,-4,9),1900,8),((6,2,9),2400,8),((0,12,7),1900,6)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;point_at(light,(0,3,.8))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'survival-zombies.blend'))
scene.render.filepath=str(OUT/'roster-preview.png');bpy.ops.render.render(write_still=True)
print('ZOMBIE_ROSTER_COMPLETE',len(roots))
