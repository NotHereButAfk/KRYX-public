"""
Shared Blender (bpy) gun-modeling helpers.

Conventions:
  -Y = muzzle forward, +Z = up, +X = right (glTF export converts to three.js -Z forward).
  Boxes are flat-shaded with crisp chamfer bevels; cylinders/cones smooth-shaded.
  Material NAMES drive the game loader's runtime remap (_buildFromGLB):
    body -> weaponDef.color (furniture)   metal -> steel   dark_metal -> dark parts
    energy -> glowing accents (weaponDef.energyColor)      wood -> brown furniture
  Each finished gun is ONE mesh named weapon_<id> with a muzzle_point empty.
"""
import bpy, math

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def make_mats():
    def mat(name, rgb, rough=0.5, metal=0.2, emit=None, emit_str=0.0):
        m = bpy.data.materials.new(name); m.use_nodes = True
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (*rgb, 1)
        b.inputs["Roughness"].default_value = rough
        b.inputs["Metallic"].default_value = metal
        if emit is not None:
            b.inputs["Emission Color"].default_value = (*emit, 1)
            b.inputs["Emission Strength"].default_value = emit_str
        return m
    return {
        'body':  mat("body",       (0.85, 0.46, 0.16), 0.55, 0.1),   # orange furniture (runtime: def.color)
        'metal': mat("metal",      (0.45, 0.47, 0.50), 0.32, 0.9),
        'dark':  mat("dark_metal", (0.16, 0.17, 0.19), 0.45, 0.65),
        'wood':  mat("wood",       (0.29, 0.18, 0.09), 0.7, 0.0),
        'energy':mat("energy",     (0.1, 0.5, 0.2), 0.2, 0.1, emit=(0.5, 1.0, 0.25), emit_str=4.0),
    }

class Gun:
    def __init__(self, mats):
        self.parts = []
        self.M = mats

    def _bake(self, o):
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True); bpy.context.view_layer.objects.active = o
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    def box(self, loc, dim, mat, bevel=0.004, seg=1, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        o = bpy.context.active_object
        o.scale = dim
        o.rotation_euler = rot
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        o.data.materials.append(self.M[mat])
        if bevel > 0:
            b = o.modifiers.new("bev", 'BEVEL'); b.width = bevel; b.segments = seg
            b.limit_method = 'ANGLE'; b.angle_limit = math.radians(40)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier="bev")
        self._bake(o); self.parts.append(o); return o

    def cyl(self, loc, r, length, mat, axis='Y', rot=(0, 0, 0), verts=20, r2=None):
        if r2 is None:
            bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=length, location=loc, vertices=verts)
        else:
            bpy.ops.mesh.primitive_cone_add(radius1=r, radius2=r2, depth=length, location=loc, vertices=verts)
        o = bpy.context.active_object
        base = {'Y': (math.radians(90), 0, 0), 'X': (0, math.radians(90), 0), 'Z': (0, 0, 0)}[axis]
        o.rotation_euler = tuple(a + b for a, b in zip(base, rot))
        o.data.materials.append(self.M[mat])
        bpy.ops.object.shade_smooth()
        self._bake(o); self.parts.append(o); return o

    def cone(self, loc, r, length, mat, axis='Y', rot=(0, 0, 0), verts=16):
        return self.cyl(loc, r, length, mat, axis=axis, rot=rot, verts=verts, r2=0.0)

    def ring(self, loc, major, minor, mat, rot=(0, 0, 0), axis='Y'):
        bpy.ops.mesh.primitive_torus_add(location=loc, major_radius=major, minor_radius=minor,
                                         major_segments=20, minor_segments=8)
        o = bpy.context.active_object
        base = {'Y': (math.radians(90), 0, 0), 'X': (0, math.radians(90), 0), 'Z': (0, 0, 0)}[axis]
        o.rotation_euler = tuple(a + b for a, b in zip(base, rot))
        o.data.materials.append(self.M[mat])
        bpy.ops.object.shade_smooth()
        self._bake(o); self.parts.append(o); return o

    def profile(self, pts, width, mat, bevel=0.005, seg=2):
        # Extruded side-view silhouette: pts = [(y, z), ...] polygon traced in
        # the side view, extruded across X by `width`. Gives the illustrated
        # look — a smooth flowing outline with crisp flat side faces (neither
        # stacked slabs nor an over-beveled balloon).
        import bmesh
        mesh = bpy.data.meshes.new("profile")
        obj = bpy.data.objects.new("profile", mesh)
        bpy.context.collection.objects.link(obj)
        bm = bmesh.new()
        hw = width / 2
        verts = [bm.verts.new((-hw, y, z)) for (y, z) in pts]
        face = bm.faces.new(verts)
        ret = bmesh.ops.extrude_face_region(bm, geom=[face])
        ext_verts = [v for v in ret['geom'] if isinstance(v, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=ext_verts, vec=(width, 0, 0))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(mesh)
        bm.free()
        obj.data.materials.append(self.M[mat])
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        if bevel > 0:
            b = obj.modifiers.new("bev", 'BEVEL'); b.width = bevel; b.segments = seg
            b.limit_method = 'ANGLE'; b.angle_limit = math.radians(40)
            bpy.ops.object.modifier_apply(modifier="bev")
        self._bake(obj)
        self.parts.append(obj)
        return obj

    def _boolean_cut(self, target, cutter):
        bpy.ops.object.select_all(action='DESELECT')
        target.select_set(True); bpy.context.view_layer.objects.active = target
        mod = target.modifiers.new("cut", 'BOOLEAN')
        mod.operation = 'DIFFERENCE'; mod.object = cutter; mod.solver = 'EXACT'
        bpy.ops.object.modifier_apply(modifier="cut")
        bpy.data.objects.remove(cutter, do_unlink=True)

    def hole_ellipse(self, target, cy, cz, ry, rz):
        # punch an elliptical hole through `target` along X (side-view hole)
        bpy.ops.mesh.primitive_cylinder_add(radius=1.0, depth=0.3, location=(0, cy, cz), vertices=36)
        h = bpy.context.active_object
        h.rotation_euler = (0, math.radians(90), 0)
        h.scale = (rz, ry, 1.0)
        bpy.ops.object.transform_apply(rotation=True, scale=True)
        self._boolean_cut(target, h)

    def hole_rect(self, target, cy, cz, hy, hz, bevel=0.015):
        # punch a rounded-rectangle hole through `target` along X
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, cy, cz))
        h = bpy.context.active_object
        h.scale = (0.3, hy, hz)
        bpy.ops.object.transform_apply(scale=True)
        if bevel > 0:
            b = h.modifiers.new("bev", 'BEVEL'); b.width = bevel; b.segments = 4
            b.limit_method = 'ANGLE'; b.angle_limit = math.radians(40)
            bpy.context.view_layer.objects.active = h
            bpy.ops.object.modifier_apply(modifier="bev")
        self._boolean_cut(target, h)

    def row(self, start, step, count, dim, mat, rot=(0, 0, 0), bevel=0.0):
        # a row of identical small boxes (serrations, ribs, checkering, belt links)
        for i in range(count):
            loc = (start[0] + step[0]*i, start[1] + step[1]*i, start[2] + step[2]*i)
            self.box(loc, dim, mat, bevel=bevel, rot=rot)

    def knurl(self, center, radius, count, size, mat, ry=0.0):
        # small studs around a Y-axis cylinder at center (grip/barrel-nut knurling)
        for i in range(count):
            a = i / count * 2 * math.pi
            loc = (center[0] + math.cos(a) * radius, center[1], center[2] + math.sin(a) * radius)
            self.box(loc, size, mat, bevel=0, rot=(0, ry, -a))

    def _audit(self, gun_id, eps=0.0008):
        # Connectivity audit: every part must (transitively) touch the largest
        # component with REAL geometry — BVH face-overlap, not AABB proximity.
        # (AABBs inflate on rotated parts and let visible gaps pass.) A part
        # whose AABB is fully inside another's counts as connected (buried).
        import bmesh
        from mathutils.bvhtree import BVHTree
        def bb(o):
            xs = [v[0] for v in o.bound_box]; ys = [v[1] for v in o.bound_box]; zs = [v[2] for v in o.bound_box]
            return (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))
        def tree(o):
            bm = bmesh.new(); bm.from_mesh(o.data)
            t = BVHTree.FromBMesh(bm, epsilon=eps); bm.free()
            return t
        boxes = [bb(o) for o in self.parts]
        trees = [tree(o) for o in self.parts]
        n = len(boxes)
        m = eps * 2
        def aabb_near(a, b):   # cheap prefilter before the exact test
            return (a[0]-m <= b[1] and b[0]-m <= a[1] and a[2]-m <= b[3] and
                    b[2]-m <= a[3] and a[4]-m <= b[5] and b[4]-m <= a[5])
        def inside(a, b):      # a fully contained in b
            return (a[0] >= b[0]-m and a[1] <= b[1]+m and a[2] >= b[2]-m and
                    a[3] <= b[3]+m and a[4] >= b[4]-m and a[5] <= b[5]+m)
        parent = list(range(n))
        def find(i):
            while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
            return i
        for i in range(n):
            for j in range(i+1, n):
                if not aabb_near(boxes[i], boxes[j]): continue
                if inside(boxes[i], boxes[j]) or inside(boxes[j], boxes[i]) \
                   or trees[i].overlap(trees[j]):
                    parent[find(i)] = find(j)
        comps = {}
        for i in range(n): comps.setdefault(find(i), []).append(i)
        main = max(comps.values(), key=len)
        ok = True
        for comp in comps.values():
            if comp is main: continue
            ok = False
            for i in comp:
                b = boxes[i]
                c = (round((b[0]+b[1])/2, 3), round((b[2]+b[3])/2, 3), round((b[4]+b[5])/2, 3))
                print(f"FLOATING [{gun_id}]: {self.parts[i].name} center={c}")
        if ok:
            print(f"AUDIT OK [{gun_id}]: {n} parts, 1 component")
        return ok

    def finish(self, gun_id, muzzle, scale=1.0):
        self._audit(gun_id)
        bpy.ops.object.select_all(action='DESELECT')
        for p in self.parts: p.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        bpy.ops.object.join()
        gun = bpy.context.active_object
        gun.name = f"weapon_{gun_id}"
        if scale != 1.0:
            # normalise the gun's in-hand size (viewmodel mount expects the
            # procedural-era dimensions); bake the scale into the mesh
            gun.scale = (scale, scale, scale)
            self._bake(gun)
        bpy.ops.object.empty_add(type='PLAIN_AXES',
                                 location=(muzzle[0]*scale, muzzle[1]*scale, muzzle[2]*scale))
        mz = bpy.context.active_object; mz.name = "muzzle_point"; mz.parent = gun
        self.parts = []
        return gun

def export(path):
    import os
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=os.path.abspath(path), export_format='GLB',
                              use_selection=True, export_yup=True, export_apply=True)
    print("EXPORTED", os.path.abspath(path))
