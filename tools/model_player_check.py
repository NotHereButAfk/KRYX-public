"""Static check of tools/model_player.py — runs WITHOUT Blender.

    python3 tools/model_player_check.py

Fakes just enough of bpy/mathutils to execute build_mesh() and the bone tables,
then verifies the things that would only show up when you opened the .blend:
every part references a bone that exists, names are unique, the triangle count
is under budget, connected bones actually touch, and the model stands on z=0.
"""
import sys, types, math, os

# ── fake bpy ────────────────────────────────────────────────────────────────
class _Node:
    def __init__(self): self.inputs = {}
class _Inputs(dict):
    def get(self, k, d=None): return dict.get(self, k, d)
class _Sock:
    def __init__(self): self.default_value = None
class _NodeTree:
    def __init__(self):
        n = _Node()
        n.inputs = _Inputs({k: _Sock() for k in
            ("Base Color", "Roughness", "Metallic", "Emission Color", "Emission Strength")})
        self.nodes = {"Principled BSDF": n}
        self.nodes = types.SimpleNamespace(get=lambda k, n=n: n)
class _Mat:
    def __init__(self, name):
        self.name = name; self.use_nodes = False
        self.node_tree = _NodeTree()
        self.diffuse_color = None; self.roughness = None
        self.use_backface_culling = None
class _Mesh:
    def __init__(self, name):
        self.name = name; self.verts = []; self.faces = []
        self.polygons = []; self.materials = []
        self.loop_triangles = []
    def from_pydata(self, v, e, f):
        self.verts, self.faces = v, f
        self.polygons = [types.SimpleNamespace(use_smooth=True) for _ in f]
    def validate(self): pass
    def update(self): pass
    def calc_loop_triangles(self):
        self.loop_triangles = [None] * sum(len(f) - 2 for f in self.faces)
class _Obj:
    def __init__(self, name, data):
        self.name = name; self.data = data
        self.location = (0, 0, 0); self.rotation_euler = (0, 0, 0)
        self.parent = None; self.parent_type = None; self.parent_bone = None
    def matrix_world_copy(self): return None

MESHES, OBJECTS, MATS = [], [], []
bpy = types.ModuleType("bpy")
bpy.data = types.SimpleNamespace(
    materials=types.SimpleNamespace(new=lambda n: MATS.append(_Mat(n)) or MATS[-1]),
    meshes=types.SimpleNamespace(new=lambda n: MESHES.append(_Mesh(n)) or MESHES[-1]),
    objects=types.SimpleNamespace(new=lambda n, d: OBJECTS.append(_Obj(n, d)) or OBJECTS[-1]),
    armatures=types.SimpleNamespace(new=lambda n: types.SimpleNamespace(name=n)),
)
bpy.context = types.SimpleNamespace(
    scene=types.SimpleNamespace(collection=types.SimpleNamespace(
        objects=types.SimpleNamespace(link=lambda o: None))),
    view_layer=types.SimpleNamespace(objects=types.SimpleNamespace(active=None)),
    window_manager=types.SimpleNamespace(windows=[]),
)
bpy.ops = types.SimpleNamespace()
sys.modules["bpy"] = bpy
mu = types.ModuleType("mathutils")
mu.Euler = lambda v, order='XYZ': v
mu.Vector = lambda v: tuple(v)
sys.modules["mathutils"] = mu

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import model_player as MP

fails = 0
def ok(cond, msg, detail=""):
    global fails
    if not cond: fails += 1
    print(f"  {'ok  ' if cond else 'FAIL'}  {msg}{'   ' + detail if detail else ''}")

# ── run the build ───────────────────────────────────────────────────────────
mats = MP.make_materials()
MP.PARTS.clear()
MP.build_mesh(mats)

# ── bones the rig will actually contain ─────────────────────────────────────
bones, order = [], []
for name, head, tail, parent, conn, _g in MP.BONES:
    order.append((name, head, tail, parent, conn)); bones.append(name)
    if name.endswith(".L"):
        r = name[:-2] + ".R"
        rp = parent[:-2] + ".R" if parent and parent.endswith(".L") else parent
        mx = lambda v: (-v[0], v[1], v[2])
        order.append((r, mx(head), mx(tail), rp, conn)); bones.append(r)

# The brief's list, plus the Hand and Foot bones the game drives.
SPEC = ["Root", "Pelvis", "Spine", "Chest", "Neck", "Head",
        "Clavicle.L", "Clavicle.R", "UpperArm.L", "UpperArm.R",
        "LowerArm.L", "LowerArm.R", "Hand.L", "Hand.R",
        "Thigh.L", "Thigh.R", "Shin.L", "Shin.R", "Foot.L", "Foot.R"]
print("\n── rig ──")
ok(sorted(bones) == sorted(SPEC), "every bone the brief asks for, and no others",
   f"{len(bones)} bones")
ok(len(set(bones)) == len(bones), "bone names unique")

seen = set()
missing_parent = [n for n, h, t, p, c in order if p and p not in seen and not seen.add(n)]
seen = set()
bad_order = []
for n, h, t, p, c in order:
    if p and p not in seen: bad_order.append(n)
    seen.add(n)
ok(not bad_order, "every bone is created after its parent", str(bad_order))

gaps = []
byname = {n: (h, t) for n, h, t, p, c in order}
for n, h, t, p, c in order:
    if c and p:
        ph, pt = byname[p]
        d = math.dist(h, pt)
        if d > 1e-9: gaps.append(f"{n} {d:.4f}m from {p} tail")
ok(not gaps, "connected bones actually touch their parent's tail", "; ".join(gaps))

# ── parts ───────────────────────────────────────────────────────────────────
print("\n── mesh ──")
names = [o.name for o, b in MP.PARTS]
ok(len(set(names)) == len(names), "part names unique", f"{len(names)} parts")

wrong = sorted({b for o, b in MP.PARTS if b not in bones})
ok(not wrong, "every part is parented to a bone that exists", ", ".join(wrong))

tris = 0
for o, b in MP.PARTS:
    o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
budget = MP.TRI_BUDGETS[MP.DETAIL]
ok(tris < budget, f"detail {MP.DETAIL} is under its {budget}-triangle budget", f"{tris} tris")

flat = all(not p.use_smooth for o, b in MP.PARTS for p in o.data.polygons)
ok(flat, "every polygon is flat-shaded")

quads = all(len(f) == 4 for o, b in MP.PARTS for f in o.data.faces)
ok(quads, "every face is a quad (6 per block)")
ok(all(len(o.data.verts) == 8 for o, b in MP.PARTS), "every block has 8 verts")
ok(all(len(o.data.materials) == 1 for o, b in MP.PARTS), "every part carries a material")

# ── does it stand on the floor and reach 1.8m? ──────────────────────────────
lo = hi = None; wide = 0
for o, b in MP.PARTS:
    cx, cy, cz = o.location
    for vx, vy, vz in o.data.verts:
        z = cz + vz; x = abs(cx + vx)
        lo = z if lo is None else min(lo, z)
        hi = z if hi is None else max(hi, z)
        wide = max(wide, x)
print("\n── figure ──")
ok(abs(lo) < 0.005, "the soles sit on z = 0", f"lowest {lo:.4f}")
ok(1.70 < hi < 1.90, "stature is human", f"{hi:.3f} m")

# the rig has to land on the figure the game solves against
FIG = {"Thigh.L": MP.HIP_Z, "Shin.L": MP.KNEE_Z, "Foot.L": MP.ANKLE_Z,
       "UpperArm.L": MP.SHOULDER_Z, "LowerArm.L": MP.ELBOW_Z,
       "Hand.L": MP.WRIST_Z}
byn = {n: (h, t) for n, h, t, p_, c in order}
off = [f"{n} {byn[n][0][2]:.4f} != {z}" for n, z in FIG.items()
       if abs(byn[n][0][2] - z) > 1e-9]
ok(not off, "every joint sits on the Proportions.js figure", "; ".join(off))
ok(0.25 < wide < 0.45, "half-width is plausible for a hero build", f"{wide:.3f} m")

# material spec
print("\n── materials ──")
byname = {m.name: m for m in MATS}
ok(len(MATS) == 3, "exactly three materials", ", ".join(byname))
a = byname["HERO_Armor_White"]; d = byname["HERO_Undersuit_Charcoal"]; v = byname["HERO_Visor_Emissive"]
bs = lambda m: m.node_tree.nodes.get("Principled BSDF").inputs
ok(abs(bs(a)["Roughness"].default_value - 0.4) < 1e-9, "armour roughness 0.4")
ok(abs(bs(d)["Roughness"].default_value - 0.8) < 1e-9, "undersuit roughness 0.8")
ok(abs(bs(v)["Emission Strength"].default_value - 5.0) < 1e-9, "visor emission strength 5.0")
ok(all(m.use_backface_culling is False for m in MATS), "standard backface settings")
ok(all(m.diffuse_color is not None for m in MATS), "solid-mode viewport colour set")

# ── every detail level builds, and each stays inside its own budget ─────────
print("\n── detail levels ──")
for lvl in sorted(MP.TRI_BUDGETS):
    MP.DETAIL = lvl
    MP.PARTS.clear()
    MESHES.clear(); OBJECTS.clear()
    MP.build_mesh(MP.make_materials())
    t = 0
    for o, b in MP.PARTS:
        o.data.calc_loop_triangles(); t += len(o.data.loop_triangles)
    bad = sorted({b for o, b in MP.PARTS if b not in bones})
    ok(t < MP.TRI_BUDGETS[lvl] and not bad,
       f"detail {lvl}: {len(MP.PARTS)} parts, {t} tris < {MP.TRI_BUDGETS[lvl]}",
       ", ".join(bad))

print(f"\n{fails} check(s) FAILED" if fails else "\nall static checks passed")
sys.exit(1 if fails else 0)
