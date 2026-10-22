"""Author articulated first-person gloves while retaining the published sleeves.

blender --background --python tools/blender/remodel_viewmodel_gloves.py
The input is idempotent: only the two hand meshes are replaced.
"""
from pathlib import Path
from mathutils import Vector
import bpy

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'ev-view-arms.glb'
BLEND = ROOT / 'art' / 'viewmodel' / 'detailed-gloves.blend'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(OUT))
bpy.context.preferences.filepaths.save_version = 0


def material(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    return mat


glove = material('KYX glove | charcoal leather', (.085, .105, .130), .73)
pad = material('KYX glove | knuckle pads', (.095, .118, .145), .57)
seam = material('KYX glove | recessed flex seams', (.015, .021, .029), .88)

for side, mirror, center in [
    ('Left', -1, (.02469817, .01357908, -.05306750)),
    ('Right', 1, (-.02770274, .08765392, -.05004015)),
]:
    root = bpy.data.objects[f'KYX_ViewArm_{side}']
    old = [o for o in root.children_recursive if o.type == 'MESH' and '_Hand' in o.name]
    # Geometry coordinates stay in the imported GLTF root's local Y-up basis.
    basis = old[0].matrix_world.copy()
    for obj in old:
        bpy.data.objects.remove(obj, do_unlink=True)
    parts = []

    def block(name, location, size, mat, bevel=.006):
        bpy.ops.mesh.primitive_cube_add(size=1)
        obj = bpy.context.object
        obj.name = name
        obj.location = location
        obj.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.materials.append(mat)
        mod = obj.modifiers.new('Tailored rounded edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        bpy.ops.object.modifier_apply(modifier=mod.name)
        parts.append(obj)
        return obj

    def phalanx(name, a, b, width, depth, mat=glove):
        a, b = Vector(a), Vector(b)
        obj = block(name, (a+b)/2, (width, depth, (b-a).length+.008), mat, .005)
        obj.rotation_mode = 'QUATERNION'
        obj.rotation_quaternion = (b-a).to_track_quat('Z', 'Y')
        return obj

    # Palm faces up under the handguard, wrist comes back toward the body.
    # A LEFT hand has its thumb on -X and curled fingers on +X in this pose.
    # The previous mirror assignment put right-hand anatomy on the left sleeve.
    # A tapered palm with a rounded heel, rather than a rectangular claw base.
    # Keep the contact face flat enough to support the fore-end.
    palm = block('Palm heel', (0, -.035, -.013), (.108, .042, .119), glove, .017)
    for vertex in palm.data.vertices:
        toward_wrist = max(0, min(1, (vertex.co.z + .005) / .060))
        vertex.co.x *= 1 - .24 * toward_wrist
    block('Palm pressure pad', (0, -.016, -.018), (.078, .012, .089), glove, .006)
    phalanx('Connected wrist', (0, -.036, .035), (-.005, -.045, .100), .086, .060)
    for index, (z, reach) in enumerate([(-.069, .057), (-.037, .065), (-.005, .062), (.027, .051)]):
        points = [(-.043,-.027,z), (-.063,.008,z), (-.050,reach,z), (-.013,reach+.004,z)]
        for joint in range(3):
            phalanx(f'Finger {index+1} joint {joint+1}', points[joint], points[joint+1], .024, .025)
        # Raised individual knuckle pads and two narrow flex grooves per digit.
        block(f'Knuckle {index+1}', (-.066,.014,z), (.008,.021,.020), pad, .004)
        block(f'Finger crease {index+1}', (-.058,.041,z), (.008,.004,.023), seam, .001)
    phalanx('Thumb root', (.031,-.025,.015), (.064,.001,-.019), .034, .030)
    phalanx('Thumb middle', (.064,.001,-.019), (.062,.026,-.060), .029, .026)
    phalanx('Thumb tip', (.062,.026,-.060), (.039,.031,-.087), .025, .023)
    block('Thumb pad', (.066,.014,-.044), (.009,.022,.036), pad, .004)
    # Flex strips on the visible thumb and heel separate the glove from the cuff.
    block('Thumb flex seam', (.065,.012,-.065), (.010,.004,.024), seam, .001)
    block('Heel pad', (.019,-.055,.010), (.062,.008,.049), pad, .004)

    # Merge the connected glove surfaces into one low-cost draw hierarchy.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    hand = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    lo = Vector(tuple(min(v.co[i] for v in hand.data.vertices) for i in range(3)))
    hi = Vector(tuple(max(v.co[i] for v in hand.data.vertices) for i in range(3)))
    midpoint = (lo+hi)/2
    def fitted_point(point):
        point = Vector(point) - midpoint
        point.x *= mirror
        return point + Vector(center)

    for v in hand.data.vertices:
        v.co -= midpoint
        v.co.x *= mirror
        v.co += Vector(center)
        # The fitting coordinates above are game Y-up. Blender exports Z-up
        # coordinates to glTF Y-up, so convert before attaching to the arm.
        v.co = Vector((v.co.x, -v.co.z, v.co.y))
    if mirror < 0:
        import bmesh
        bm = bmesh.new(); bm.from_mesh(hand.data)
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces)); bm.to_mesh(hand.data); bm.free()
    hand.name = f'KYX_View{side}_Hand'
    hand.parent = root
    hand.matrix_world = basis
    hand['sourceCharacter'] = 'ev-default'
    hand['fingerCount'] = 5
    hand['authoredGlove'] = 'KYX underhand glove v5'
    # Game-space landmarks allow a regression check of palm-up handedness.
    hand['thumbContact'] = list(fitted_point((.062, .026, -.060)))
    hand['fingerContact'] = list(fitted_point((-.050, .065, -.037)))
    hand['palmContact'] = list(fitted_point((0, -.016, -.018)))
    hand['wristContact'] = list(fitted_point((-.005, -.045, .100)))
    # Vertex shading retains leather/pad/seam contrast when the equipped skin
    # tints the glove, and exports one palm mesh for the runtime grip anchor.
    colors = hand.data.color_attributes.new(name='Glove details', type='FLOAT_COLOR', domain='CORNER')
    for polygon in hand.data.polygons:
        mat = hand.data.materials[polygon.material_index]
        shade = 1.0 if mat == pad else .35 if mat == seam else .80
        for index in polygon.loop_indices:
            colors.data[index].color = (shade, shade, shade, 1)
        polygon.material_index = 0
    hand.data.materials.clear()
    hand.data.materials.append(glove)
    hand.data.name = hand.name
    print(side, 'glove vertices:', len(hand.data.vertices))

BLEND.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.export_scene.gltf(filepath=str(OUT), export_format='GLB', export_animations=False,
                          export_extras=True, export_yup=True, export_apply=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=True)
print('Exported', OUT)
