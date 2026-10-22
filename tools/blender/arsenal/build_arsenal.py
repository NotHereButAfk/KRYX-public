"""Original Blender weapons with distinct firing roles and a shared palette."""
import bpy, bmesh, math, json, os
from pathlib import Path
from mathutils import Vector, Matrix

SOURCE=Path(__file__).resolve().parent
BASE=Path(os.environ.get('KYX_ARSENAL_OUTPUT', str(SOURCE))).resolve()
BASE.mkdir(parents=True,exist_ok=True)
HELPERS=(SOURCE/'model_helpers.py').read_text()
REPORTS=[]

def init(weapon_id):
    global OUT, parts, root, plasma
    exec(compile(HELPERS,'model_helpers.py','exec'),globals())
    OUT=BASE/weapon_id;OUT.mkdir(exist_ok=True)
    root.name='weapon_'+weapon_id
    root['design']='ARC energy family / Blender-authored low-poly model'
    scene.cycles.samples=20
    scene.render.resolution_x=1500;scene.render.resolution_y=950
    for material,color,metal,rough in [(gray,(.28,.34,.38),.25,.65),(edge,(.09,.13,.16),.4,.6),(dark,(.025,.04,.05),.2,.72),(orange,(.9,.19,.012),.12,.64)]:
        bs=material.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1)
        bs.inputs['Metallic'].default_value=metal;bs.inputs['Roughness'].default_value=rough;material.diffuse_color=(*color,1)
    bs=lime.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(.16,.9,.11,1)
    bs.inputs['Emission Color'].default_value=(.12,1,.16,1);bs.inputs['Emission Strength'].default_value=1.8
    plasma=mat('08 | plasma heart',(.40,1,.48),0,.45,3,'energy')

def core(z,y=.070,x=.066,r=.035):
    for s in [-1,1]:
        cyl('Reactor gray armor',r,.010,(s*x,y,z),gray,'x',8)
        cyl('Reactor graphite face',r*.81,.011,(s*(x+.003),y,z),dark,'x',8)
        cyl('Reactor luminous ring',r*.65,.003,(s*(x+.010),y,z),lime,'x',8)
        cyl('Reactor recessed face',r*.48,.004,(s*(x+.012),y,z),dark,'x',8)
        cyl('Reactor plasma crystal',r*.29,.005,(s*(x+.015),y,z),plasma,'x',6)

def grip(z=.060,pistol=False):
    dz=z-.06
    def p(points):return [(zz+dz,yy) for zz,yy in points]
    plate('Swept trigger grip',p([(.007,-.009),(.052,-.009),(.097,-.129),(.087,-.153),(.052,-.16),(.025,-.14),(.002,-.037)]),.046 if pistol else .043,dark,bevel=.002)
    for s in [-1,1]:
        plate('Grip orange inset' if pistol else 'Grip polymer inset',p([(.017,-.048),(.047,-.039),(.079,-.128),(.06,-.143),(.038,-.128)]),.003,orange if pistol else rubber,s*(.024 if pistol else .022),.001)
        for i in range(3):
            yy=-.066-i*.025;zz=.032+i*.01
            plate('Grip angular tread',p([(zz,yy),(zz+.025,yy+.003),(zz+.028,yy-.003),(zz+.003,yy-.006)]),.002,edge,s*(.026 if pistol else .024),.0005)
    plate('Open trigger guard',p([(-.069,-.004),(-.08,-.015),(-.071,-.046),(-.057,-.058),(.022,-.058),(.032,-.046),(.018,-.049),(-.053,-.049),(-.062,-.039),(-.065,-.014)]),.018,dark,bevel=.001)
    plate('Trigger',p([(-.014,-.004),(-.022,-.026),(-.011,-.039),(-.006,-.036),(-.014,-.025),(-.006,-.006)]),.008,edge,bevel=.0007)

def cell(z,y=-.032,length=.145,width=.060):
    plate('Magazine power cell frame',[(z-.042,y),(z+.032,y),(z+.046,y-.04),(z+.042,y-length+.014),(z+.024,y-length),(z-.038,y-length),(z-.049,y-length+.025)],width,dark,bevel=.0015)
    for s in [-1,1]:
        plate('Magazine power cell armor',[(z-.035,y-.02),(z+.023,y-.02),(z+.034,y-.046),(z+.028,y-length+.02),(z-.03,y-length+.02),(z-.040,y-length+.033)],.003,gray,s*(width/2+.002),.001)
        plate('Magazine charge recess',[(z-.023,y-.038),(z+.015,y-.038),(z+.023,y-length+.033),(z-.025,y-length+.033)],.002,dark,s*(width/2+.004),.0007)
        for i in range(3):box('Magazine charge segment',(.002,.011,.023),(s*(width/2+.006),y-.05-i*(length-.095)/2,z-.002),lime,.0005)
    plate('Magazine orange heel',[(z-.049,y-length+.022),(z-.036,y-length-.009),(z+.028,y-length-.009),(z+.045,y-length+.015),(z+.042,y-length+.028),(z+.021,y-length+.003),(z-.03,y-length+.003)],width+.009,orange,bevel=.001)
    box('Magazine coupling',(width+.01,.022,.104),(0,y+.002,z),edge,.002)

def stock(start,end,heavy=False):
    hull('Stock support spine',[(start,.045,.043,.058),(end-.07,.045,.043,.058)],dark)
    plate('Stock cheek armor',[(start+.035,.055),(start+.05,.10),(end-.036,.10),(end-.012,.075),(end-.023,.042),(start+.064,.037)],.065 if heavy else .055,gray,bevel=.0015)
    plate('Stock lower brace',[(start+.048,.046),(start+.06,.023),(end-.073,-.061),(end-.023,-.07),(end-.023,-.047),(end-.06,-.034),(start+.076,.043)],.028,edge,bevel=.001)
    plate('Stock orange heel',[(end-.044,.092),(end-.021,.078),(end-.018,-.081),(end-.040,-.090),(end-.056,-.065),(end-.052,.073)],.061,orange,bevel=.0015)
    plate('Stock recoil pad',[(end-.019,.077),(end-.002,.069),(end,-.083),(end-.017,-.096),(end-.026,-.078)],.065,rubber,bevel=.0015)

def emit(muzzle,end,y=.075,half=.047,width=.025):
    # Split front prongs, central energy focus; no ballistic muzzle bore.
    for s in [-1,1]:
        plate('Emitter split gray prong',[(muzzle,y-.024),(muzzle,y+.022),(muzzle+.032,y+.060),(end-.015,y+.053),(end,y+.012),(end-.02,y-.040),(muzzle+.035,y-.048)],width,gray,s*half,.001)
        plate('Emitter orange inset',[(muzzle+.018,y-.019),(muzzle+.032,y+.028),(end-.033,y+.029),(end-.016,y+.005),(end-.033,y-.025)],.003,orange,s*(half+width/2+.001),.0007)
        plate('Emitter inner green strip',[(muzzle+.013,y-.02),(muzzle+.016,y+.027),(muzzle+.028,y+.034),(muzzle+.026,y-.028)],.002,lime,s*(half-width/2-.001),.0004)
    cyl('Emitter focus cage',half*.68,.026,(0,y,muzzle+.050),dark,'z',8)
    cyl('Emitter luminous lens',half*.51,.005,(0,y,muzzle+.034),plasma,'z',8)

def conduit(start,end,x=.060,y=.054):
    for s in [-1,1]:
        plate('Recessed power bus',[(start,y-.01),(start+.019,y+.02),(end-.012,y+.02),(end,y+.007),(end-.012,y-.008)],.003,dark,s*x,.0008)
        plate('Green energy conduit',[(start+.01,y-.001),(start+.022,y+.01),(end-.016,y+.01),(end-.005,y+.002),(end-.015,y-.001),(start+.026,y+.004)],.002,lime,s*(x+.0025),.0003)

def sight(z,y=.14):
    for s in [-1,1]:box('Rear sight fork',(.006,.012,.016),(s*.010,y,z),dark,.0006)

def hand_cannon():
    # Chunky six-cell energy revolver, short stockless silhouette.
    hull('Cannon upper barrel shroud',[(-.32,.081,.10,.075),(-.28,.108,.116,.075),(-.085,.108,.116,.075),(-.04,.095,.10,.065)],gray)
    for s in [-1,1]:
        plate('Cannon orange shroud plate',[(-.286,.050),(-.278,.111),(-.108,.111),(-.067,.081),(-.11,.039)],.004,orange,s*.056,.001)
        plate('Cannon shroud green conduit',[(-.267,.072),(-.257,.086),(-.12,.086),(-.106,.071),(-.125,.078),(-.251,.078)],.002,lime,s*.059,.0004)
        for i in range(3):box('Cannon heat port',(.003,.009,.018),(s*.059,.052,-.235+i*.036),dark,.0007)
    hull('Cannon lower support',[(-.32,.052,.027,.009),(-.06,.07,.036,.009),(.105,.062,.038,.012)],edge)
    # Visible polygonal capacitor drum along the weapon axis.
    cyl('Capacitor drum casing',.065,.11,(0,.058,.018),edge,'z',10)
    for i in range(6):
        a=i*math.tau/6
        xx=math.cos(a)*.049;yy=.058+math.sin(a)*.049
        cyl('Capacitor energy chamber',.010,.082,(xx,yy,.019),lime,'z',6)
        cyl('Capacitor front collar',.014,.008,(xx,yy,-.028),dark,'z',6)
    core(.014,.060,.068,.041)
    for s in [-1,1]:plate('Cannon cylinder yoke',[(-.075,.106),(-.036,.135),(.063,.125),(.13,.038),(.14,-.005),(.106,-.026),(.057,.019),(-.036,.024)],.012,gray,s*.048,.0015)
    box('Cannon top bridge',(.035,.018,.16),(0,.133,.007),gray,.002)
    grip(.114,True)
    emit(-.365,-.29,.075,.040,.023)
    box('Cannon front blade',(.008,.014,.014),(0,.146,-.25),edge,.001)
    sight(.07,.146)
    return {'muzzle':[0,.075,-.367],'trigger':[.010,-.071,.114],'support':[-.028,-.072,.125],'reload':[-.03,-.17,.10],'carry':'pistol','supportVisible':False}

def burst_rifle():
    # Compact stepped receiver and three distinct charged chambers.
    hull('Burst receiver',[(-.29,.083,.090,.064),(-.24,.132,.130,.064),(-.05,.132,.13,.064),(.14,.087,.10,.055)],gray)
    plate('Burst lower receiver',[(-.258,.012),(-.20,-.045),(-.10,-.04),(-.056,-.008),(.02,-.006),(.039,-.025),(.126,.004),(.136,.032)],.085,edge,bevel=.0015)
    for s in [-1,1]:plate('Burst orange shoulder', [(-.245,.07),(-.214,.129),(-.10,.128),(-.048,.083),(-.079,.047),(-.211,.042)],.005,orange,s*.068,.001)
    core(-.13,.077,.074,.036);conduit(-.04,.112,.057,.062)
    hull('Burst induction spine',[(-.56,.057,.03,.018),(-.27,.071,.045,.027)],dark)
    hull('Burst luminous axis',[(-.54,.020,.02,.073),(-.276,.020,.02,.073)],plasma)
    for i in range(3):
        zz=-.48+i*.063
        cyl('Burst three-shot capacitor',.032,.025,(0,.073,zz),edge,'z',8)
        cyl('Burst three-shot luminous face',.026,.004,(0,.073,zz-.016),lime,'z',8)
        for s in [-1,1]:plate('Burst capacitor orange cover',[(zz-.022,.096),(zz-.012,.13),(zz+.022,.13),(zz+.032,.103),(zz+.015,.09)],.008,orange,s*.034,.0008)
    emit(-.594,-.51,.073,.044,.026)
    grip();cell(-.155,length=.155);stock(.135,.343)
    box('Burst support grip',(.074,.032,.095),(0,.004,-.279),rubber,.003)
    sight(.09,.14)
    return {'muzzle':[0,.073,-.596],'trigger':[.012,-.043,.06],'support':[-.037,0,-.266],'reload':[-.04,-.20,-.11],'carry':'rifle','supportVisible':True}

def sweeper():
    # Broad bullpup scatter weapon; three side-by-side field emitters.
    hull('Sweeper bullpup receiver',[(-.13,.106,.12,.070),(-.07,.166,.157,.066),(.21,.166,.157,.066),(.325,.126,.12,.058)],gray)
    hull('Sweeper wide fore-end',[(-.388,.17,.104,.066),(-.34,.194,.127,.066),(-.16,.194,.127,.066),(-.099,.13,.10,.066)],gray)
    for s in [-1,1]:
        plate('Sweeper orange front armor',[(-.354,.067),(-.339,.118),(-.199,.118),(-.157,.084),(-.18,.038),(-.32,.032)],.005,orange,s*.100,.001)
        plate('Sweeper stock orange armor',[(.182,.027),(.18,.124),(.257,.12),(.306,.082),(.289,.008),(.221,-.005)],.005,orange,s*.085,.001)
    core(.033,.073,.086,.043);conduit(.085,.265,.086,.070)
    box('Sweeper rear buttpad',(.12,.134,.028),(0,.052,.33),rubber,.005)
    hull('Sweeper triple emitter housing',[(-.449,.18,.081,.067),(-.417,.218,.119,.067),(-.365,.207,.12,.067)],dark)
    for xx in [-.062,0,.062]:
        cyl('Sweeper focusing cup',.025,.020,(xx,.067,-.45),gray,'z',8)
        cyl('Sweeper green aperture',.018,.005,(xx,.067,-.462),lime,'z',8)
        cyl('Sweeper plasma lens',.009,.003,(xx,.067,-.465),plasma,'z',6)
    for s in [-1,1]:
        plate('Sweeper emitter jaw',[(-.467,.024),(-.47,.105),(-.425,.133),(-.389,.11),(-.40,.028)],.024,gray,s*.110,.001)
        box('Sweeper muzzle orange shield',(.003,.046,.031),(s*.123,.070,-.43),orange,.001)
    grip(.053);cell(.205,y=-.019,length=.126,width=.074)
    box('Sweeper support palm rest',(.08,.035,.146),(0,-.005,-.277),rubber,.003)
    box('Sweeper flat sight spine',(.032,.014,.31),(0,.158,-.044),edge,.001)
    sight(.061,.171)
    return {'muzzle':[0,.067,-.472],'trigger':[.012,-.043,.053],'support':[-.04,-.004,-.281],'reload':[-.04,-.12,.205],'carry':'shotgun','supportVisible':True}

def laser_rifle():
    # Long twin induction rails and a large rear capacitor: precision silhouette.
    hull('Laser central receiver',[(-.20,.09,.10,.060),(-.12,.135,.123,.060),(.10,.135,.123,.060),(.18,.095,.09,.046)],gray)
    hull('Laser rear power housing',[(.12,.100,.095,.045),(.18,.148,.14,.045),(.326,.148,.14,.045),(.389,.106,.10,.04)],orange)
    for s in [-1,1]:
        plate('Laser rear armor panel',[(.17,.032),(.18,.108),(.302,.108),(.365,.071),(.339,.022),(.235,.007)],.008,gray,s*.076,.001)
    core(.236,.064,.083,.040);conduit(-.12,.075,.069,.064)
    box('Laser rear heel',(.094,.108,.026),(0,.034,.39),rubber,.003)
    hull('Laser lower barrel bridge',[(-.693,.058,.024,.020),(-.56,.068,.03,.020),(-.18,.078,.04,.025)],dark)
    hull('Laser axial light guide',[(-.668,.013,.014,.076),(-.17,.013,.014,.076)],plasma)
    for s in [-1,1]:
        plate('Laser long orange induction rail',[(-.669,.035),(-.655,.10),(-.579,.123),(-.211,.115),(-.176,.089),(-.224,.049),(-.60,.039)],.020,orange,s*.046,.001)
        plate('Laser rail gray upper plate',[(-.634,.102),(-.575,.13),(-.235,.123),(-.203,.11),(-.581,.11)],.022,gray,s*.046,.001)
        plate('Laser lower energized bus',[(-.621,.044),(-.237,.054),(-.219,.065),(-.616,.054)],.002,lime,s*.058,.0004)
        for i in range(5):
            z=-.566+i*.068
            plate('Laser diagonal charge vent',[(z,.070),(z+.008,.071),(z+.019,.101),(z+.011,.103)],.003,lime,s*.057,.0004)
    for z in [-.55,-.37,-.20]:cyl('Laser focus ring',.024,.014,(0,.076,z),edge,'z',8)
    emit(-.735,-.641,.076,.047,.025)
    grip();cell(-.112,length=.118,width=.062)
    box('Laser support shoe',(.073,.034,.17),(0,-.002,-.28),rubber,.003)
    plate('Laser angled charge monitor',[(-.045,.12),(-.043,.174),(.005,.174),(.054,.126)],.044,dark,bevel=.001)
    for i in range(4):
        z=.013+i*.009;y=.174-(z-.005)*(.048/.049)+.004
        seg=box('Laser charge display bar',(.026,.002,.006),(0,y,z),lime,.0004);seg.rotation_euler.x=math.atan(.048/.049)
    return {'muzzle':[0,.076,-.737],'trigger':[.012,-.043,.06],'support':[-.036,0,-.28],'reload':[-.04,-.15,-.112],'carry':'rifle','supportVisible':True}

def thicker_rifle():
    global scene,parts,root,gray,edge,dark,orange,rubber,lime,white,plasma
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE/'source/auto-rifle-base.blend'))
    scene=bpy.context.scene;parts=bpy.data.collections['AUTO RIFLE | editable components'];root=bpy.data.objects['weapon_m4']
    # Delete only the old presentation setup, preserving the authored weapon.
    for obj in list(scene.objects):
        if obj.name not in parts.objects:bpy.data.objects.remove(obj,do_unlink=True)
    for obj in list(parts.objects):
        if obj.type=='EMPTY' and obj!=root:bpy.data.objects.remove(obj,do_unlink=True)
    deps=bpy.context.evaluated_depsgraph_get()
    preserved=('Magazine','Grip','Swept grip','Trigger','Stock','Selector')
    for obj in list(parts.objects):
        if obj.type!='MESH':continue
        world=obj.matrix_world.copy();mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
        mesh.transform(world);obj.modifiers.clear();obj.data=mesh;obj.matrix_world=Matrix.Identity(4)
        if not obj.name.startswith(preserved) and 'grip' not in obj.name.lower():
            for v in mesh.vertices:
                v.co.x*=1.08;v.co.z=.064+(v.co.z-.064)*1.04
    root['design']='ARC-06 Auto Rifle / reduced receiver width and height, original grips'
    gray=bpy.data.materials['01 | ceramic gray receiver'];edge=bpy.data.materials['02 | machined edge metal'];dark=bpy.data.materials['03 | graphite steel'];orange=bpy.data.materials['04 | burnt orange enamel'];rubber=bpy.data.materials['05 | charcoal grip polymer'];lime=bpy.data.materials['06 | lime status emitters'];white=bpy.data.materials['07 | technical markings'];plasma=bpy.data.materials['08 | plasma heart']
    # Extend only the forward assembly, preserving both hand contacts and stock.
    for obj in parts.objects:
        if obj.type != 'MESH': continue
        for vertex in obj.data.vertices:
            if vertex.co.y > .36:
                vertex.co.y = .36 + (vertex.co.y - .36) * 1.40
    # Layered heat shields leave glimpses of the illuminated induction barrel.
    for side in [-1, 1]:
        for mount_z in [-.85,-.61,-.43]:
            box('Heat shield barrel mount',(.075,.025,.026),(side*.032,.054,mount_z),dark,.001)
        plate('ARC long faceted heat shield',[(-.90,.031),(-.87,.104),(-.42,.112),(-.37,.074),(-.43,.033)],.009,edge,side*.056,.001)
        plate('ARC inset ceramic panel',[(-.84,.050),(-.82,.094),(-.47,.099),(-.43,.073),(-.48,.052)],.004,gray,side*.063,.001)
        for i in range(8):
            z=-.80+i*.045
            plate('ARC angled cooling recess',[(z,.058),(z+.012,.058),(z+.024,.089),(z+.012,.089)],.003,dark,side*.066,.0005)
            plate('ARC luminous cooling slot',[(z+.004,.061),(z+.009,.061),(z+.016,.079),(z+.011,.079)],.002,lime,side*.068,.0003)
        for z in [-.86,-.43]:
            cyl('ARC flush shield fastener',.004,.003,(side*.070,.054,z),dark,'x',6)
        plate('ARC receiver service panel',[(-.10,.043),(-.09,.078),(.035,.078),(.047,.052),(.025,.038)],.003,edge,side*.059,.001)
        for i in range(4):
            box('ARC receiver heat sink',(.007,.022,.006),(side*.064,.059,-.075+i*.022),dark,.0006)
    for z in [-.89,-.73,-.57]:
        cyl('ARC induction barrel collar',.025,.022,(0,.064,z),edge,'z',10)
        cyl('ARC energized collar rim',.022,.004,(0,.064,z-.013),lime,'z',10)
    root['design']='ARC-07 extended induction rifle / vented ceramic shroud / preserved hand anchors'
    return {'muzzle':[0,.064,-.9886],'trigger':[.012,-.043,.06],'support':[-.032,0,-.29],'reload':[-.04,-.20,-.11],'carry':'rifle','supportVisible':True}

def point_at(obj,target):obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()

def save_weapon(wid,title,pose):
    global scene
    root['authoredHandPose']={k:v for k,v in pose.items() if k!='muzzle'}
    for name,key in [('BIND_BULLET','muzzle'),('BIND_RIGHTHAND','trigger'),('BIND_LEFTHAND','support'),('BIND_RELOAD','reload')]:
        obj=bpy.data.objects.new(name,None);parts.objects.link(obj);obj.parent=root;obj.location=vec(pose[key]);obj.empty_display_size=.018
    # Source stays editable; UVs are included even though the style uses flat colors.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts.objects:
        if obj.type=='MESH' and not obj.data.uv_layers:
            obj.select_set(True);bpy.context.view_layer.objects.active=obj;bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT');obj.select_set(False)
    scene.cycles.samples=20;scene.render.resolution_x=1500;scene.render.resolution_y=950;scene.render.resolution_percentage=100
    floor=mat('Studio floor',(.019,.028,.038),.08,.7)
    deps=bpy.context.evaluated_depsgraph_get();coords=[];triangles=0
    for obj in parts.objects:
        if obj.type=='MESH':
            ev=obj.evaluated_get(deps);mesh=ev.to_mesh();mesh.calc_loop_triangles();triangles+=len(mesh.loop_triangles)
            coords.extend(obj.matrix_world@v.co for v in mesh.vertices);ev.to_mesh_clear()
    minimum=Vector([min(v[i] for v in coords) for i in range(3)]);maximum=Vector([max(v[i] for v in coords) for i in range(3)]);center=(minimum+maximum)*.5;size=maximum-minimum
    bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,minimum.z-.018));bpy.context.object.data.materials.append(floor)
    for name,pos,power,area,color in [('Key',(1.1,.25,1.4),95,1.3,(.85,.92,1)),('Rim',(-.6,.2,.8),100,.8,(.55,.72,1)),('Fill',(.3,-1,.5),35,1.2,(1,.83,.63))]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=area;data.color=color
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=pos;point_at(obj,center)
    data=bpy.data.cameras.new('Review camera');camera=bpy.data.objects.new('Review camera',data);scene.collection.objects.link(camera);scene.camera=camera
    camera.location=center+Vector((.65,-.5,1.7) if wid=='sword' else (1.5,-.7,.68));point_at(camera,center);data.type='ORTHO'
    bpy.context.view_layer.update();view=camera.matrix_world.inverted();projected=[view@co for co in coords]
    frame_w=max(p.x for p in projected)-min(p.x for p in projected)
    frame_h=max(p.y for p in projected)-min(p.y for p in projected)
    data.ortho_scale=max(frame_w,frame_h*1500/950)*1.16
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'preview.png')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(wid+'.blend')))
    # Bake and batch the export after saving the editable file.
    deps=bpy.context.evaluated_depsgraph_get();groups={}
    for obj in list(parts.objects):
        if obj.type!='MESH':continue
        matrix=obj.matrix_world.copy();mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps));obj.modifiers.clear();obj.data=mesh;obj.matrix_world=matrix
        key=('Magazine' if 'magazine' in obj.name.lower() else 'Body',obj.data.materials[0].name);groups.setdefault(key,[]).append(obj)
    for (part,material),objs in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objs:obj.select_set(True)
        bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();obj=bpy.context.object;obj.name=part+' | '+material
        bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
        mat0=obj.data.materials[0]
        for face in obj.data.polygons:face.material_index=0
        obj.data.materials.clear();obj.data.materials.append(mat0)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts.objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    bpy.ops.export_scene.gltf(filepath=str(OUT/(wid+'.glb')),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True)
    report={'id':wid,'title':title,'triangles':triangles,'meshes':len(groups),'dimensionsMetres':[size.x,size.z,size.y],'pose':pose,'bytes':(OUT/(wid+'.glb')).stat().st_size,'installed':False}
    (OUT/'model-report.json').write_text(json.dumps(report,indent=2));REPORTS.append(report)
    bpy.ops.render.render(write_still=True)
    print('WEAPON_COMPLETE',wid,triangles,flush=True)

def sheriff_cannon():
    # Sheriff-inspired silhouette: conventional cylinder, hammer, heavy barrel.
    hull('Sheriff squared barrel',[(-.286,.061,.079,.077),(-.259,.086,.096,.077),(-.057,.086,.096,.077),(-.023,.077,.086,.070)],gray)
    hull('Sheriff full underlug',[(-.279,.050,.030,.021),(-.075,.060,.039,.018),(-.026,.052,.027,.018)],edge)
    for s in [-1,1]:
        plate('Sheriff orange barrel inlay',[(-.26,.061),(-.253,.105),(-.081,.105),(-.052,.082),(-.076,.052)],.003,orange,s*.045,.001)
        plate('Barrel machined side line',[(-.244,.068),(-.086,.068),(-.092,.063),(-.24,.063)],.002,edge,s*.047,.0005)
    cyl('Sheriff muzzle crown',.024,.018,(0,.077,-.29),edge,'z',10)
    cyl('Sheriff muzzle recessed shadow',.016,.001,(0,.077,-.2995),dark,'z',10)
    cyl('Sheriff bore',.009,.001,(0,.077,-.3002),rubber,'z',8)
    cyl('Revolver drum',.050,.093,(0,.066,.028),edge,'z',12)
    for i in range(6):
        a=i*math.tau/6;xx=math.cos(a)*.035;yy=.066+math.sin(a)*.035
        cyl('Six chamber faces',.009,.002,(xx,yy,.076),dark,'z',8)
        cyl('Chamber primer',.003,.003,(xx,yy,.078),orange,'z',6)
        # Flat-cut longitudinal cylinder flutes, not energy reactor discs.
        o=box('Cylinder recessed flute',(.019,.002,.060),(math.cos(a)*.049,.066+math.sin(a)*.049,.026),dark,.001)
        o.rotation_euler.y=a-math.pi/2
    plate('Cylinder lower cradle',[(-.032,.027),(-.018,.004),(.063,.004),(.095,.027),(.125,-.009),(.101,-.026),(.066,-.011),(-.026,-.011),(-.05,.012)],.061,gray,bevel=.001)
    box('Revolver top strap',(.034,.014,.150),(0,.129,.023),gray,.001)
    hull('Revolver back frame',[(.077,.060,.080,.038),(.112,.069,.092,.021),(.141,.052,.06,-.001)],gray)
    plate('Exposed hammer',[(.095,.082),(.105,.111),(.126,.12),(.14,.112),(.133,.101),(.119,.105),(.113,.079)],.016,dark,bevel=.001)
    for s in [-1,1]:
        box('Cylinder release',(.007,.010,.023),(s*.038,.064,.10),edge,.001)
        cyl('Grip frame pin',.004,.003,(s*.034,.004,.108),dark,'x',6)
    grip(.114,True)
    box('Sheriff front blade',(.008,.018,.018),(0,.134,-.249),dark,.001)
    sight(.05,.141)
    return {'muzzle':[0,.077,-.302],'trigger':[.010,-.071,.114],'support':[-.028,-.072,.125],'reload':[-.03,-.17,.10],'carry':'pistol','supportVisible':False}

def burst_ballistic():
    # A compact ballistic rifle, with a three-round selector instead of coils.
    hull('Burst receiver',[(-.27,.089,.094,.063),(-.218,.132,.124,.065),(-.065,.132,.124,.065),(.137,.083,.094,.057)],gray)
    plate('Burst lower receiver',[(-.238,.023),(-.204,-.039),(-.114,-.043),(-.05,-.004),(.018,-.006),(.04,-.025),(.12,-.006),(.14,.025)],.083,edge,bevel=.001)
    hull('Burst fore-end',[(-.426,.079,.080,.067),(-.385,.109,.101,.067),(-.256,.109,.101,.067),(-.237,.088,.081,.067)],gray)
    for s in [-1,1]:
        plate('Burst orange fore-end',[(-.39,.042),(-.382,.105),(-.287,.105),(-.249,.074),(-.274,.032)],.004,orange,s*.056,.001)
        plate('Burst orange receiver shoulder',[(-.21,.065),(-.18,.115),(-.094,.11),(-.066,.072),(-.098,.044),(-.192,.045)],.003,orange,s*.068,.001)
        for i in range(3):box('Three-shot green selector bars',(.002,.016,.006),(s*.069,.050,-.15+i*.014),lime,.0004)
        for i in range(3):box('Handguard cooling slot',(.003,.010,.022),(s*.057,.05,-.36+i*.031),dark,.0008)
    cyl('Burst exposed barrel',.016,.128,(0,.073,-.471),dark,'z',10)
    cyl('Burst ported muzzle',.025,.044,(0,.073,-.542),edge,'z',8)
    cyl('Burst muzzle opening',.014,.001,(0,.073,-.565),rubber,'z',8)
    for s in [-1,1]:
        for z in [-.551,-.536]:box('Muzzle side port',(.002,.011,.006),(s*.024,.073,z),dark,.0005)
    box('Burst ejection port',(.003,.016,.066),(.054,.085,.014),dark,.001)
    box('Burst bolt handle',(.015,.008,.019),(.060,.09,.056),edge,.001)
    plate('Burst curved magazine',[(-.185,-.033),(-.113,-.033),(-.115,-.105),(-.103,-.162),(-.075,-.208),(-.127,-.235),(-.163,-.182),(-.181,-.112)],.044,dark,bevel=.0015)
    for s in [-1,1]:
        for i in range(3):
            dz=i*.015
            plate('Burst magazine pressing',[(-.17+dz,-.057),(-.166+dz,-.11),(-.15+dz,-.17),(-.121+dz,-.209),(-.115+dz,-.205),(-.143+dz,-.167),(-.158+dz,-.108),(-.163+dz,-.057)],.003,edge,s*.023,.0006)
    plate('Burst magazine orange floorplate',[(-.13,-.235),(-.075,-.208),(-.07,-.219),(-.126,-.247),(-.138,-.241)],.05,orange,bevel=.001)
    grip();stock(.13,.343)
    box('Burst support grip',(.069,.029,.12),(0,.002,-.286),rubber,.002)
    box('Burst low sight rail',(.026,.009,.31),(0,.135,-.24),edge,.001)
    box('Burst front sight',(.009,.022,.014),(0,.147,-.393),dark,.001);sight(.075,.137)
    return {'muzzle':[0,.073,-.567],'trigger':[.012,-.043,.06],'support':[-.033,0,-.266],'reload':[-.04,-.19,-.15],'carry':'rifle','supportVisible':True}

def machine_sweeper():
    # Long sustained-fire machine gun: box receiver, belt feed, large ammo box.
    hull('Sweeper machine gun receiver',[(-.28,.104,.113,.075),(-.236,.146,.145,.075),(.12,.146,.145,.075),(.17,.100,.104,.065)],gray)
    plate('Sweeper lower receiver',[(-.235,.02),(-.20,-.038),(-.09,-.045),(-.04,-.003),(.018,-.008),(.04,-.026),(.13,-.008),(.15,.03)],.09,edge,bevel=.0015)
    for s in [-1,1]:
        plate('Sweeper orange receiver panel',[(-.212,.060),(-.19,.129),(.072,.129),(.114,.087),(.088,.04),(-.172,.037)],.004,orange,s*.076,.001)
        for i in range(3):box('Sweeper green status ticks',(.002,.014,.006),(s*.079,.057,-.16+i*.013),lime,.0004)
    hull('Sweeper heat shroud',[(-.528,.089,.09,.075),(-.49,.115,.108,.075),(-.30,.115,.108,.075),(-.25,.09,.085,.075)],edge)
    for s in [-1,1]:
        plate('Sweeper gray heat panel',[(-.49,.05),(-.48,.112),(-.32,.112),(-.29,.071),(-.32,.039)],.004,gray,s*.059,.001)
        for i in range(5):box('Sweeper barrel cooling cutout',(.003,.012,.019),(s*.062,.077,-.466+i*.034),dark,.0007)
    cyl('Sweeper heavy barrel',.022,.150,(0,.075,-.568),dark,'z',12)
    cyl('Sweeper muzzle brake',.031,.052,(0,.075,-.641),edge,'z',8)
    cyl('Sweeper muzzle bore',.019,.001,(0,.075,-.668),rubber,'z',8)
    for s in [-1,1]:
        for z in [-.648,-.632]:box('Sweeper muzzle vent',(.002,.016,.008),(s*.03,.075,z),dark,.0007)
    # Square ammo box and a visible feeding belt on the right side.
    hull('Magazine ammunition box',[(-.235,.114,.167,-.096),(-.08,.114,.167,-.096)],dark)
    for s in [-1,1]:
        plate('Magazine ammo-box armor',[(-.221,-.028),(-.091,-.028),(-.091,-.159),(-.113,-.175),(-.21,-.175)],.004,gray,s*.059,.001)
        box('Magazine orange box band',(.003,.025,.115),(s*.063,-.14,-.156),orange,.001)
    for i in range(6):
        xx=.083+i*.016;yy=.028-i*i*.0021
        cyl('Visible linked cartridge',.006,.061,(xx,yy,-.145),orange,'z',8)
        cyl('Cartridge bullet tip',.0045,.018,(xx,yy,-.183),edge,'z',6)
        box('Ammo belt link',(.019,.006,.015),(xx,yy+.003,-.139),dark,.0007)
    box('Sweeper feed cover',(.073,.012,.074),(.091,.057,-.13),dark,.001)
    # Carry handle with an open center, plus folded bipod legs along the shroud.
    for z in [-.10,.035]:box('Carry handle support',(.016,.044,.014),(0,.166,z),dark,.001)
    box('Carry handle bridge',(.021,.014,.155),(0,.19,-.032),edge,.002)
    for s in [-1,1]:box('Folded bipod rail',(.009,.010,.19),(s*.068,.017,-.415),dark,.001)
    grip();stock(.153,.385,True)
    box('Sweeper foregrip',(.080,.038,.137),(0,.004,-.31),rubber,.003)
    sight(.095,.159)
    return {'muzzle':[0,.075,-.670],'trigger':[.012,-.043,.06],'support':[-.04,0,-.281],'reload':[-.05,-.16,-.15],'carry':'rifle','supportVisible':True}

def blast_laser():
    # A heavy energy cannon, with a very wide emitter and a capacitor reservoir.
    hull('Blast laser receiver',[(-.21,.103,.116,.069),(-.135,.153,.148,.069),(.116,.153,.148,.064),(.171,.11,.10,.054)],gray)
    hull('Blast laser rear capacitor',[(.118,.109,.11,.053),(.18,.172,.167,.052),(.329,.172,.167,.052),(.39,.118,.12,.046)],orange)
    for s in [-1,1]:plate('Rear capacitor gray armor',[(.171,.026),(.174,.128),(.306,.128),(.365,.083),(.344,.018),(.242,-.012)],.007,gray,s*.088,.001)
    core(.231,.070,.095,.047);conduit(-.12,.075,.078,.066)
    box('Energy cannon heel',(.111,.137,.026),(0,.04,.395),rubber,.004)
    hull('Energy cannon lower sled',[(-.675,.093,.034,.010),(-.30,.103,.043,.013),(-.17,.108,.052,.02)],dark)
    hull('Bright axial plasma core',[(-.63,.035,.035,.084),(-.18,.035,.035,.084)],plasma)
    for i in range(4):
        z=-.53+i*.09
        cyl('Large induction containment ring',.050,.022,(0,.084,z),edge,'z',10)
        cyl('Induction luminous face',.042,.005,(0,.084,z-.014),lime,'z',10)
    for s in [-1,1]:
        plate('Heavy orange accelerator rail',[(-.64,.035),(-.62,.139),(-.53,.16),(-.225,.149),(-.17,.10),(-.23,.032),(-.56,.018)],.027,orange,s*.067,.0015)
        plate('Accelerator gray upper spine',[(-.615,.14),(-.53,.171),(-.239,.16),(-.204,.137),(-.538,.15)],.029,gray,s*.067,.001)
        for i in range(5):
            z=-.54+i*.06
            plate('Energy rail luminous vent',[(z,.064),(z+.011,.065),(z+.023,.127),(z+.012,.13)],.003,lime,s*.082,.0005)
    emit(-.755,-.627,.084,.080,.029)
    cyl('Wide blast focus ring',.055,.025,(0,.084,-.714),gray,'z',10)
    cyl('Big energy blast aperture',.044,.006,(0,.084,-.731),lime,'z',10)
    cyl('Bright blast lens',.030,.003,(0,.084,-.735),plasma,'z',8)
    grip();cell(-.113,length=.145,width=.072)
    box('Laser support shoe',(.084,.043,.17),(0,-.007,-.28),rubber,.003)
    plate('Laser charge monitor',[(-.045,.14),(-.043,.196),(.005,.196),(.054,.148)],.050,dark,bevel=.001)
    for i in range(4):
        z=.013+i*.009;y=.196-(z-.005)*(.048/.049)+.004
        segment=box('Laser charge display',(.03,.002,.006),(0,y,z),lime,.0004);segment.rotation_euler.x=math.atan(.048/.049)
    return {'muzzle':[0,.084,-.757],'trigger':[.012,-.043,.06],'support':[-.04,-.003,-.28],'reload':[-.04,-.18,-.113],'carry':'rifle','supportVisible':True}

def slim_receiver(wid,pose):
    if wid not in ['magnum','battlerifle','energyshotgun','plasmarifle']:return
    # Reduce the upper assembly itself, not the whole gun/hand rig. Keep the
    # length, grip, magazine, stock and support-hand contact geometry intact.
    bpy.context.view_layer.update()
    deps=bpy.context.evaluated_depsgraph_get()
    for obj in list(parts.objects):
        if obj.type!='MESH':continue
        name=obj.name.lower()
        if any(part in name for part in ['grip','trigger','magazine','stock','support shoe']):continue
        world=obj.matrix_world.copy()
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
        mesh.transform(world);obj.modifiers.clear();obj.data=mesh;obj.matrix_world=Matrix.Identity(4)
        for vertex in mesh.vertices:
            vertex.co.x*=.86
            if vertex.co.z>0:vertex.co.z*=.84
    pose['muzzle'][1]*=.84
    root['design']='KYX balanced receiver / 14% slimmer, 16% lower upper assembly'

def open_tube(name,z0,z1,y,outer,inner,material,x=0):
    # True open muzzle: four rings join the outer wall, bore and both rims.
    count=12
    verts=[vec((x+math.cos(i*math.tau/count)*r,y+math.sin(i*math.tau/count)*r,z))
           for z,r in [(z0,outer),(z1,outer),(z0,inner),(z1,inner)] for i in range(count)]
    faces=[]
    for a,b in [(0,1),(2,3),(0,2),(1,3)]:
        for i in range(count):
            j=(i+1)%count;faces.append((a*count+i,a*count+j,b*count+j,b*count+i))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);parts.objects.link(obj);return finish(obj,name,material,0)

def rocket_launcher():
    # Open launch tube with foregrip, shoulder saddle and a compact offset optic.
    open_tube('Rocket launch tube',-.54,.32,.108,.074,.061,edge)
    open_tube('Rocket muzzle collar',-.571,-.512,.108,.083,.061,dark)
    open_tube('Rocket muzzle lip',-.579,-.565,.108,.084,.064,gray)
    open_tube('Rear exhaust collar',.284,.363,.108,.079,.064,dark)
    open_tube('Rear exhaust rim',.35,.369,.108,.085,.067,gray)
    hull('Launcher control receiver',[(-.15,.084,.053,.039),(.12,.084,.053,.039)],dark)
    for s in [-1,1]:
        plate('Rocket gray launch armor',[(-.488,.081),(-.47,.164),(-.235,.174),(-.168,.14),(-.184,.065),(-.428,.058)],.009,gray,s*.068,.001)
        plate('Rocket orange tube panel',[(-.461,.091),(-.441,.146),(-.273,.153),(-.207,.13),(-.233,.09)],.004,orange,s*.075,.001)
        plate('Rocket rear armor',[(.013,.079),(.046,.168),(.238,.17),(.281,.145),(.25,.066),(.07,.061)],.009,gray,s*.069,.001)
        for z in [.085,.119,.153,.187]:box('Exhaust armor heat slot',(.003,.012,.019),(s*.075,.109,z),dark,.0005)
        for z in [-.402,-.370,-.338]:box('Rocket warning tick',(.003,.018,.009),(s*.079,.116,z),white,.0004)
    box('Rocket trigger housing connection',(.052,.044,.16),(0,-.003,.025),dark,.002)
    grip(.06)
    hull('Rocket shoulder pad',[(.118,.10,.049,.006),(.291,.10,.049,.006)],rubber)
    box('Rocket support grip',(.049,.100,.058),(0,-.025,-.28),rubber,.004)
    for i in range(3):box('Rocket support grip rib',(.054,.008,.064),(0,-.007-i*.022,-.28),dark,.001)
    box('Launcher optic bracket',(.05,.024,.07),(.087,.151,-.076),dark,.001)
    cyl('Launcher offset optic',.022,.10,(.098,.185,-.075),dark,'z',10)
    cyl('Launcher rear optic lens',.016,.003,(.098,.185,-.023),lime,'z',10)
    box('Launcher targeting plate',(.045,.006,.10),(.098,.211,-.075),gray,.001)
    for s in [-1,1]:box('Rocket ready indicator',(.003,.010,.025),(s*.075,.087,.047),lime,.0005)
    return {'muzzle':[0,.108,-.584],'trigger':[.012,-.043,.06],'support':[-.022,-.017,-.28],'reload':[-.07,.035,.23],'carry':'launcher','supportVisible':True}

def grenade_launcher():
    # Original heavy drum launcher. A continuous receiver/yoke carries every
    # assembly; all shields, sights and hand grips have intersecting mounts.
    hull('Grenade continuous upper receiver',[(-.245,.130,.100,.139),(-.16,.144,.114,.139),(.125,.132,.114,.127)],gray)
    box('Grenade rear drum yoke',(.138,.143,.120),(0,.032,.080),edge,.006)
    hull('Grenade forward breech',[(-.253,.142,.146,.09),(-.165,.154,.156,.09)],gray)
    cyl('Magazine solid drum body',.101,.191,(0,.025,-.067),dark,'z',12)
    for z in [-.157,.023]:
        cyl('Magazine retaining flange',.108,.022,(0,.025,z),edge,'z',12)
    for i in range(6):
        angle=i*math.tau/6;x=math.cos(angle)*.080;y=.025+math.sin(angle)*.080
        cyl('Magazine armored chamber flute',.032,.160,(x,y,-.067),gray,'z',10)
        cyl('Magazine orange chamber band',.034,.025,(x,y,-.104),orange,'z',10)
        cyl('Magazine rear chamber cap',.025,.012,(x,y,.017),edge,'z',10)
        cyl('Magazine recessed primer',.006,.003,(x,y,.024),white,'z',6)
    open_tube('Grenade heavy launch barrel',-.468,-.232,.09,.069,.044,gray)
    open_tube('Grenade recessed bore',-.481,-.340,.09,.045,.040,dark)
    open_tube('Grenade reinforced muzzle ring',-.491,-.449,.09,.078,.044,edge)
    for z in [-.433,-.266]:
        open_tube('Grenade barrel retaining collar',z-.014,z+.014,.09,.074,.066,dark)
    for s in [-1,1]:
        box('Grenade handguard structural bed',(.024,.066,.163),(s*.062,.09,-.351),edge,.003)
        plate('Grenade orange handguard',[(-.435,.063),(-.417,.122),(-.285,.122),(-.264,.091),(-.289,.057)],.009,orange,s*.075,.002)
        for z in [-.399,-.369,-.339,-.309]:
            box('Grenade handguard recessed vent',(.004,.026,.009),(s*.081,.091,z),dark,.0006)
        plate('Grenade receiver cheek',[(-.152,.131),(-.129,.184),(.085,.174),(.116,.134),(.080,.106),(-.122,.111)],.012,edge,s*.068,.002)
        plate('Grenade receiver identification panel',[(-.113,.153),(-.103,.172),(.060,.162),(.077,.142)],.004,orange,s*.076,.001)
        for z in [-.124,.083]:cyl('Grenade receiver captive bolt',.007,.006,(s*.078,.131,z),gray,'x',8)
        box('Grenade status inset',(.005,.019,.038),(s*.077,.129,.023),dark,.001)
        for z in [.010,.022,.034]:box('Grenade ready lamp',(.004,.010,.006),(s*.081,.130,z),lime,.0004)
        cyl('Grenade drum pivot pin',.018,.017,(s*.074,.040,.068),gray,'x',10)
    box('Grenade grip receiver socket',(.080,.061,.114),(0,-.003,.085),dark,.003)
    grip(.083);stock(.115,.350,True)
    box('Grenade stock reinforced root',(.085,.074,.110),(0,.06,.151),edge,.003)
    box('Grenade foregrip barrel saddle',(.072,.049,.140),(0,.024,-.309),edge,.002)
    box('Grenade support grip',(.065,.036,.122),(0,.005,-.309),rubber,.003)
    for i in range(5):box('Grenade support grip rib',(.070,.038,.009),(0,.005,-.357+i*.024),dark,.001)
    box('Grenade integral sight rail',(.032,.017,.280),(0,.190,-.071),dark,.001)
    sight(.038,.203)
    box('Grenade front sight bridge',(.030,.049,.035),(0,.171,-.288),dark,.001)
    box('Grenade front blade',(.009,.020,.016),(0,.202,-.288),edge,.001)
    root['design']='KYX Breacher drum launcher / connected heavy chassis / revision 2'
    return {'muzzle':[0,.09,-.495],'trigger':[.012,-.043,.083],'support':[-.03,.005,-.303],'reload':[-.111,.025,-.067],'carry':'launcher','supportVisible':True}

def mini_smg():
    # Compact box action and short fore-end; long straight magazine, sliding stock.
    hull('SMG compact action',[(-.228,.053,.065,.058),(-.197,.075,.086,.058),(.109,.075,.086,.058),(.137,.054,.056,.053)],gray)
    hull('SMG lower frame',[(-.13,.05,.038,.011),(.116,.05,.038,.011)],dark)
    for s in [-1,1]:
        plate('SMG orange action insert',[(-.174,.048),(-.169,.092),(-.045,.093),(-.025,.072),(-.058,.033),(-.152,.035)],.003,orange,s*.039,.0008)
        for i in range(3):box('SMG cooling window',(.003,.008,.012),(s*.041,.064,-.173+i*.026),dark,.0005)
        box('SMG status dot',(.003,.008,.012),(s*.039,.061,.068),lime,.0005)
        box('SMG telescoping stock rail',(.009,.014,.126),(s*.027,.068,.190),edge,.001)
    box('SMG ejection port',(.002,.016,.049),(.039,.070,.014),dark,.001)
    box('SMG bolt handle',(.014,.007,.014),(.046,.071,.017),edge,.0006)
    cyl('SMG short exposed barrel',.016,.101,(0,.060,-.248),dark,'z',10)
    open_tube('SMG ported muzzle',-.327,-.285,.060,.022,.011,edge)
    for s in [-1,1]:box('SMG muzzle port',(.002,.01,.011),(s*.021,.060,-.304),dark,.0005)
    hull('Magazine SMG straight box',[(-.11,.033,.187,-.087),(-.054,.033,.187,-.087)],dark)
    for s in [-1,1]:
        box('Magazine SMG armor',(.002,.148,.039),(s*.018,-.08,-.082),gray,.001)
        for i in range(4):box('Magazine SMG witness slot',(.002,.007,.013),(s*.020,-.038-i*.027,-.081),dark,.0004)
    box('Magazine SMG orange base',(.043,.014,.066),(0,-.18,-.082),orange,.001)
    grip(.06)
    box('SMG stock pad',(.065,.076,.019),(0,.041,.255),rubber,.003)
    box('SMG stock top cap',(.067,.011,.027),(0,.080,.251),gray,.001)
    box('SMG support grip',(.063,.028,.089),(0,.005,-.19),rubber,.002)
    box('SMG sight rail',(.021,.008,.204),(0,.107,-.045),dark,.001)
    box('SMG front sight base',(.018,.013,.023),(0,.095,-.219),dark,.0007)
    sight(.058,.119);box('SMG front sight',(.007,.021,.011),(0,.109,-.219),dark,.0007)
    return {'muzzle':[0,.060,-.333],'trigger':[.012,-.043,.06],'support':[-.027,.001,-.187],'reload':[-.04,-.17,-.082],'carry':'compact','supportVisible':True}

def energy_sword():
    # Broad faces lie in XZ, matching the existing upright guard and downstroke.
    def slab(name, outline, thickness, material, y=-.020, bevel=.0008):
        verts=[vec((x,yy,z)) for yy in [y-thickness/2,y+thickness/2] for x,z in outline]
        n=len(outline)
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]
        faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
        bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
        obj=bpy.data.objects.new(name,mesh);parts.objects.link(obj)
        return finish(obj,name,material,bevel)
    slab('Forged angular blade',[(-.023,.041),(-.043,-.095),(-.040,-.635),(-.024,-.825),(.039,-.731),(.034,-.635),(.042,-.61),(.042,-.44),(.033,-.422),(.043,-.40),(.043,-.20),(.032,-.18),(.035,-.08),(.028,.041)],.017,dark)
    slab('Continuous energized cutting edge',[(-.023,.041),(-.045,.014),(-.052,-.02),(-.048,-.10),(-.047,-.638),(-.024,-.825),(-.036,-.633),(-.036,-.102),(-.037,-.024),(-.026,.006)],.018,lime,bevel=.0004)
    for s in [-1,1]:
        yy=-.02+s*.010
        slab('Chamfered blade face',[(-.028,-.083),(-.026,-.621),(-.017,-.75),(.027,-.709),(.025,-.607),(.031,-.585),(.030,-.455),(.02,-.431),(.031,-.391),(.030,-.225),(.018,-.192),(.022,-.086)],.003,gray,yy)
        slab('Recessed blade fuller',[(-.008,-.133),(-.010,-.611),(.000,-.666),(.012,-.61),(.009,-.134)],.002,edge,yy+s*.002)
        slab('Blade orange spine armor',[(.019,-.102),(.027,-.191),(.032,-.212),(.038,-.20),(.027,-.174),(.03,-.10),(.024,-.061),(-.02,-.061),(-.021,-.082)],.004,orange,yy+s*.003)
        for zz in [-.315,-.333]:
            slab('Orange identification stripe',[(-.027,zz),(.029,zz-.016),(.029,zz-.022),(-.027,zz-.006)],.002,orange,yy+s*.003)
        for zz in [-.104,-.122]:cyl('Blade hex fastener',.003,.004,(.008,yy+s*.003,zz),dark,'y',6)
    slab('Swept crossguard',[(-.097,.048),(-.092,.026),(-.072,.023),(-.052,.040),(.054,.040),(.080,.016),(.096,.020),(.089,.060),(.052,.076),(-.054,.076)],.036,edge)
    box('Guard blade collar',(.065,.044,.033),(0,-.02,.04),gray,.003)
    for s in [-1,1]:
        slab('Guard orange inset',[(-.073,.046),(-.05,.052),(.05,.052),(.069,.034),(.076,.036),(.059,.063),(-.05,.063)],.003,orange,-.02+s*.020)
    box('Full tang grip',(.034,.033,.195),(0,-.02,.175),rubber,.003)
    for i in range(8):
        band=box('Grip wrap band',(.043,.042,.010),(0,-.02,.089+i*.024),dark,.001)
        band.rotation_euler.z=.08 if i%2 else -.08
    for s in [-1,1]:box('Grip orange side spine',(.004,.009,.163),(s*.019,-.02,.175),orange,.0008)
    box('Pommel armored cap',(.052,.047,.024),(0,-.02,.284),edge,.003)
    for s in [-1,1]:
        cyl('Pommel power socket',.009,.003,(0,-.02+s*.025,.283),dark,'y',8)
        cyl('Pommel green power core',.005,.004,(0,-.02+s*.027,.283),lime,'y',8)
    root['design']='KYX Arc Blade / single green energy edge / downward slash'
    return {'muzzle':[0,-.02,-.825],'trigger':[0,-.02,.16],'support':[0,-.02,.23],'reload':[0,-.02,.16],'carry':'melee','supportVisible':False}

def field_shotgun():
    hull('Shotgun receiver',[(-.22,.075,.095,.060),(.12,.082,.10,.060)],gray)
    open_tube('Shotgun barrel',-.65,-.20,.085,.026,.018,dark)
    cyl('Shotgun magazine tube',.020,.40,(0,.028,-.43),edge,'z',10)
    open_tube('Shotgun muzzle',-.67,-.63,.085,.031,.018,edge)
    box('Shotgun grip and trigger frame',(.052,.044,.18),(0,-.004,.015),edge,.002)
    grip();stock(.12,.34)
    box('Shotgun pump',(.07,.064,.16),(0,.012,-.30),rubber,.003)
    for i in range(7):box('Shotgun pump rib',(.075,.066,.008),(0,.012,-.37+i*.023),edge,.001)
    for side in [-1,1]:
        plate('Shotgun orange receiver panel',[(-.18,.045),(-.17,.09),(.07,.09),(.10,.045)],.004,orange,side*.044,.001)
    sight(.075,.12)
    return {'muzzle':[0,.085,-.672],'trigger':[.012,-.043,.06],'support':[-.035,.012,-.30],'reload':[-.04,-.10,-.12],'carry':'shotgun','supportVisible':True}


def rail_sniper():
    # Long, connected precision rifle: receiver, rail barrel and mounted optic.
    hull('Rail Driver receiver',[(-.32,.094,.105,.066),(-.25,.108,.12,.066),(.14,.09,.10,.055)],gray)
    hull('Continuous barrel spine',[(-.91,.034,.034,.077),(-.25,.034,.034,.077)],dark)
    hull('Rail accelerator fore-end',[(-.70,.065,.065,.077),(-.65,.086,.087,.077),(-.29,.086,.087,.077)],edge)
    for side in [-1,1]:
        plate('Accelerator ceramic armor',[(-.65,.053),(-.62,.118),(-.34,.118),(-.29,.077),(-.34,.039)],.006,gray,side*.044,.002)
        plate('Orange rail identity stripe',[(-.61,.092),(-.37,.092),(-.33,.075),(-.61,.075)],.003,orange,side*.048,.001)
        for i in range(6):
            z=-.60+i*.043
            box('Recessed accelerator vent',(.003,.018,.016),(side*.049,.057,z),dark,.001)
            box('Rail charge window',(.002,.006,.010),(side*.051,.058,z),lime,.0004)
        plate('Receiver side armor',[(-.24,.034),(-.22,.115),(.08,.10),(.12,.055),(.07,.02)],.004,edge,side*.055,.001)
        for z in [-.20,.07]:cyl('Receiver fastener',.004,.004,(side*.059,.047,z),white,'x',8)
    for z in [-.77,-.83]:cyl('Barrel cooling collar',.024,.02,(0,.077,z),edge,'z',10)
    hull('Faceted muzzle brake',[(-.99,.054,.048,.077),(-.90,.054,.048,.077)],gray)
    cyl('Recessed muzzle bore',.013,.002,(0,.077,-.991),rubber,'z',12)
    for side in [-1,1]:
        for z in [-.968,-.94]:box('Brake port',(.002,.014,.012),(side*.028,.077,z),dark,.0005)
    grip();cell(-.12,-.025,.115,.050);stock(.12,.37,True)
    box('Fore-end hand rest',(.072,.027,.17),(0,.014,-.29),rubber,.002)
    box('Scope receiver rail',(.039,.018,.29),(0,.133,-.03),edge,.001)
    for z in [-.13,.06]:
        box('Scope mounting pedestal',(.049,.050,.030),(0,.165,z),dark,.001)
        cyl('Scope clamp',.033,.028,(0,.205,z),gray,'z',10)
    cyl('Scope tube',.026,.32,(0,.205,-.035),dark,'z',12)
    cyl('Scope objective housing',.042,.075,(0,.205,-.205),edge,'z',12)
    cyl('Scope front lens',.033,.002,(0,.205,-.244),lime,'z',12)
    cyl('Scope eyepiece',.034,.055,(0,.205,.139),rubber,'z',12)
    cyl('Scope rear glass',.026,.002,(0,.205,.167),dark,'z',12)
    cyl('Elevation dial',.021,.018,(0,.239,-.035),edge,'y',10)
    cyl('Windage dial',.018,.018,(.035,.205,-.035),edge,'x',10)
    box('Bolt guide',(.018,.018,.095),(.057,.077,.015),gray,.001)
    cyl('Bolt handle stem',.008,.037,(.078,.077,.045),edge,'x',8)
    cyl('Bolt knob',.014,.022,(.102,.077,.045),rubber,'x',8)
    return {'muzzle':[0,.077,-.995],'trigger':[.012,-.043,.06],'support':[-.035,.005,-.29],'reload':[-.04,-.13,-.12],'carry':'rifle','supportVisible':True}

def detail_pass(wid,pose):
    if wid in ['m4','sword','boltsniper','concussion']:return
    # Bake before extending forward geometry; grips and magazines keep their fit.
    bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
    cutoff={'magnum':.09,'uzi':.22}.get(wid,.35)
    for obj in list(parts.objects):
        if obj.type!='MESH':continue
        world=obj.matrix_world.copy();mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
        mesh.transform(world);obj.modifiers.clear();obj.data=mesh;obj.matrix_world=Matrix.Identity(4)
        for v in mesh.vertices:
            if v.co.y>cutoff:v.co.y=cutoff+(v.co.y-cutoff)*1.18
    pose['muzzle'][2]=-cutoff+(pose['muzzle'][2]+cutoff)*1.18
    # Different panel sizes preserve each weapon's distinct silhouette.
    x,y,z,length={'magnum':(.041,.070,-.20,.14),'uzi':(.039,.065,-.13,.12),
      'battlerifle':(.060,.070,-.15,.20),'energyshotgun':(.072,.075,-.16,.22),
      'plasmarifle':(.076,.070,-.36,.30),'rpg':(.081,.111,-.34,.23),
      'concussion':(.048,.082,-.34,.16),'levershotgun':(.046,.065,-.05,.19)}[wid]
    for side in [-1,1]:
        # Solid mounting bed overlaps the body and the panel's inner face.
        box('Service panel structural backing',(x*.60,.040,length*.88),(side*x*.72,y,z),dark,.001)
        plate('ARC service armor',[(z-length/2,y-.023),(z-length/2+.015,y+.03),(z+length/2-.018,y+.03),(z+length/2,y-.018)],.004,edge,side*x,.001)
        for i in range(5):
            zz=z-length*.34+i*length*.16
            box('ARC recessed cooling slot',(.003,.026,.009),(side*(x+.004),y,zz),dark,.0005)
            box('ARC charge indicator',(.002,.014,.004),(side*(x+.006),y+.002,zz),lime,.0003)
        for zz in [z-length*.4,z+length*.4]:cyl('ARC service fastener',.003,.003,(side*(x+.005),y-.012,zz),white,'x',6)
    if wid == 'plasmarifle':
        for zz in [-.63,-.45,-.24]:
            box('Accelerator structural crossmember',(.145,.030,.026),(0,.035,zz),edge,.001)
    if wid == 'energyshotgun':
        for side in [-1,1]:
            box('Bipod hinge mount',(.028,.035,.028),(side*.052,.025,-.34),edge,.001)
    root['design']=str(root.get('design','ARC'))+' / extended barrel and vented service armor'

def forged_armor_pass(wid):
    if wid in ['sword','boltsniper','concussion']:return
    # Solid beveled clamshells intersect their receiver beds. Leave all hand,
    # shoulder, bore and sight anchors intact; width grows only at the shroud.
    z,length,x,y={'m4':(-.51,.56,.069,.064),'magnum':(-.17,.19,.050,.08),
      'battlerifle':(-.19,.27,.070,.072),'energyshotgun':(-.22,.32,.080,.075),
      'plasmarifle':(-.39,.44,.086,.072),'rpg':(-.37,.26,.093,.11),
      'concussion':(-.34,.21,.058,.081),'uzi':(-.15,.20,.049,.064),
      'levershotgun':(-.08,.26,.054,.066)}[wid]
    for side in [-1,1]:
        # Contiguous graphite bed supports the ceramic outer shell.
        box('Forged structural clamshell',(x*.72,.052,length*.91),(side*x*.69,y,z),dark,.004)
        outline=[(z-length*.50,y-.022),(z-length*.44,y+.039),(z+length*.36,y+.039),
                 (z+length*.50,y+.007),(z+length*.43,y-.026),(z-length*.40,y-.031)]
        plate('Forged faceted receiver shield',outline,.013,gray,side*x,.003)
        plate('Forged orange identification panel',[(z-length*.34,y+.026),(z+length*.22,y+.026),
          (z+length*.33,y+.008),(z-length*.37,y+.008)],.003,orange,side*(x+.008),.001)
        for i in range(3):
            zz=z-length*.27+i*length*.16
            box('Forged dark vent pocket',(.003,.018,.024),(side*(x+.009),y-.009,zz),dark,.001)
            box('Forged inset power bar',(.002,.005,.016),(side*(x+.011),y-.01,zz),lime,.0005)
    root['design']=str(root.get('design',''))+' / Forged Vanguard angular armor'

BUILDERS=[('m4','Auto Rifle',thicker_rifle),('magnum','Hand Cannon',sheriff_cannon),('battlerifle','Burst Rifle',burst_ballistic),('energyshotgun','Sweeper',machine_sweeper),('plasmarifle','Laser Rifle',blast_laser),('rpg','Rocket Launcher',rocket_launcher),('concussion','Grenade Launcher',grenade_launcher),('uzi','Mini SMG',mini_smg),('levershotgun','Shotgun',field_shotgun),('sword','Arc Blade',energy_sword)]
import sys
BUILDERS.append(('boltsniper','Rail Driver',rail_sniper))
selected=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
if selected and (BASE/'arsenal-report.json').exists():REPORTS.extend(r for r in json.loads((BASE/'arsenal-report.json').read_text()) if r['id'] not in selected)
for wid,title,builder in BUILDERS:
    if selected and wid not in selected:continue
    init(wid);pose=builder();slim_receiver(wid,pose);detail_pass(wid,pose);forged_armor_pass(wid);save_weapon(wid,title,pose)
(BASE/'arsenal-report.json').write_text(json.dumps(REPORTS,indent=2))
print('ENERGY_ARSENAL_COMPLETE',flush=True)
