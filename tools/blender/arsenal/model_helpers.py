"""Original KYX Auto Rifle, authored in Blender in metres. No imported gun mesh.
Run: blender --background --python build_autorifle.py
Model coordinates in helper arguments follow the game: X right, Y up, -Z muzzle.
"""
import bpy, bmesh, math, json
from pathlib import Path
from mathutils import Vector

OUT = Path(__file__).resolve().parent
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 1800
scene.render.resolution_y = 1050
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new('Studio world')
scene.world.color = (.15, .15, .15)
scene.view_settings.view_transform = 'AgX'
parts = bpy.data.collections.new('AUTO RIFLE | editable components')
scene.collection.children.link(parts)
root = bpy.data.objects.new('weapon_m4', None)
parts.objects.link(root)
root['design'] = 'KYX AR-01 / original Blender model / video-inspired silhouette'
root['units'] = 'metres; GLB +Y up, muzzle -Z'

def vec(p): return Vector((p[0], -p[2], p[1]))
def mat(name, color, metal=.5, rough=.38, glow=0, role='body'):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    if glow:
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = glow
    m['role'] = role
    return m

gray = mat('01 | ceramic gray receiver', (.32,.37,.40), .62, .30)
edge = mat('02 | machined edge metal', (.12,.17,.20), .75, .28, role='special')
dark = mat('03 | graphite steel', (.025,.037,.047), .62, .34, role='metal')
orange = mat('04 | burnt orange enamel', (.92,.20,.018), .35,.33, role='accent')
rubber = mat('05 | charcoal grip polymer', (.018,.023,.026), .0,.8, role='wood')
lime = mat('06 | lime status emitters', (.52,1,.015), .1,.3,2, 'energy')
white = mat('07 | technical markings', (.65,.74,.76), .15,.55, role='special')

def finish(obj, name, material, bevel=.002):
    obj.name = name
    for coll in list(obj.users_collection): coll.objects.unlink(obj)
    parts.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(material)
    if bevel:
        mod=obj.modifiers.new('Machined edge bevel', 'BEVEL')
        mod.width=bevel; mod.segments=1
        mod=obj.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
        mod.keep_sharp=True; mod.weight=40
    return obj

def box(name, size, position, material=gray, bevel=.002):
    bpy.ops.mesh.primitive_cube_add(size=1, location=vec(position))
    obj=bpy.context.object
    obj.dimensions=(size[0],size[2],size[1])
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,material,bevel)

def plate(name, outline, width, material=gray, x=0, bevel=.002):
    # Authored side profile: list of (longitudinal Z, height Y).
    verts=[vec((sx,y,z)) for sx in [x-width/2,x+width/2] for z,y in outline]
    n=len(outline)
    faces=[tuple(reversed(range(n))), tuple(range(n,2*n))]
    faces += [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    bm=bmesh.new(); bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces)); bm.to_mesh(mesh); bm.free()
    obj=bpy.data.objects.new(name,mesh); parts.objects.link(obj)
    return finish(obj,name,material,bevel)

def cyl(name, radius, depth, position, material, axis='z', vertices=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=vec(position))
    obj=bpy.context.object
    if axis=='z': obj.rotation_euler.x=math.pi/2
    if axis=='x': obj.rotation_euler.y=math.pi/2
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,material,.0007)


def hull(name,stations,material=gray):
    # Eight-sided, flat-shaded cross sections; silhouette is authored per station.
    vertices=[]
    for z,width,height,y in stations:
        x=width/2;h=height/2;b=min(x,h)*.45
        ring=[(-x+b,-h),(x-b,-h),(x,-h+b),(x,h-b),(x-b,h),(-x+b,h),(-x,h-b),(-x,-h+b)]
        vertices.extend(vec((rx,y+ry,z)) for rx,ry in ring)
    n=len(stations);faces=[tuple(reversed(range(8))),tuple(range((n-1)*8,n*8))]
    for k in range(n-1):
        for i in range(8):faces.append((k*8+i,k*8+(i+1)%8,(k+1)*8+(i+1)%8,(k+1)*8+i))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new(name,mesh);parts.objects.link(obj);return finish(obj,name,material,0)
