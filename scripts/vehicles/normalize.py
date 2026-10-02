# Any downloaded vehicle model (.glb .gltf .fbx .obj .3ds) as a .blend facing
# +Y, centred on the origin, wheels on z = 0, scaled to a real length — the
# layout sprites3d.py expects.
#   blender -b -P scripts/vehicles/normalize.py -- <model file> <out.blend> <length_m> [turn_deg] [drop names,comma]
import bpy, sys, os, math, glob, mathutils
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
src, out, length_m = args[0], args[1], float(args[2])
turn = math.radians(float(args[3])) if len(args) > 3 and args[3] else 0.0
drop = [d.lower() for d in args[4].split(",")] if len(args) > 4 and args[4] else []

bpy.ops.wm.read_factory_settings(use_empty=True)
# Blender 5.1's FBX importer still sets a light property Cycles has dropped, and
# the whole import fails on any file with a light in it.
try:
    import io_scene_fbx.import_fbx as _fbx
    _read_light = _fbx.blen_read_light
    def _safe_light(*a, **k):
        try:
            return _read_light(*a, **k)
        except AttributeError:
            return bpy.data.lights.new("light", "POINT")   # lights are thrown away below anyway
    _fbx.blen_read_light = _safe_light
except Exception as e:
    print("could not patch the FBX importer:", e)
ext = os.path.splitext(src)[1].lower()
if ext in (".glb", ".gltf"): bpy.ops.import_scene.gltf(filepath=src)
elif ext == ".fbx": bpy.ops.import_scene.fbx(filepath=src)
elif ext == ".obj": bpy.ops.wm.obj_import(filepath=src)
elif ext == ".3ds": bpy.ops.import_scene.max3ds(filepath=src)
else: raise SystemExit("unknown format " + ext)
sc = bpy.context.scene

# Textures the file points at somewhere else: look for them by name next to it.
root_dir = os.path.dirname(os.path.dirname(src)) if os.path.basename(os.path.dirname(src)) == "source" else os.path.dirname(src)
found = {os.path.basename(p).lower(): p for p in glob.glob(os.path.join(root_dir, "**", "*"), recursive=True)
         if os.path.splitext(p)[1].lower() in (".png", ".jpg", ".jpeg", ".tga", ".bmp", ".tif", ".tiff")}
for img in bpy.data.images:
    if img.packed_file or (img.filepath and os.path.exists(bpy.path.abspath(img.filepath))):
        continue
    p = found.get(os.path.basename(img.filepath.replace("\\", "/")).lower())
    if p:
        img.filepath = p; img.reload()

for o in list(sc.objects):
    if o.type in {"CAMERA", "LIGHT"} or any(d in o.name.lower() for d in drop):
        bpy.data.objects.remove(o, do_unlink=True)
def world_box(objs):
    lo = mathutils.Vector((1e18,) * 3); hi = -lo
    for o in objs:
        for c in o.bound_box:
            w = o.matrix_world @ mathutils.Vector(c)
            lo = mathutils.Vector(map(min, lo, w)); hi = mathutils.Vector(map(max, hi, w))
    return lo, hi

# Things that came with the model but are not the vehicle: a floor, a studio
# sphere, a backdrop, a stray curve. They wrecked the scale and the centre.
for _ in range(4):
    meshes = [o for o in sc.objects if o.type in {"MESH", "CURVE"}]
    if len(meshes) < 4:
        break
    lo, hi = world_box(meshes)
    size = hi - lo
    worst = None
    for o in meshes:
        olo, ohi = world_box([o])
        d = ohi - olo
        flat = d.z < 0.02 * max(d.x, d.y) and max(d.x, d.y) > 0.5 * max(size.x, size.y)
        enclosing = d.x >= 0.9 * size.x and d.y >= 0.9 * size.y and d.z >= 0.9 * size.z
        rlo, rhi = world_box([m for m in meshes if m is not o])
        shrink = 1 - max(rhi - rlo) / max(size)
        if flat or enclosing or shrink > 0.3:
            if worst is None or shrink > worst[1]:
                worst = (o, shrink)
    if not worst:
        break
    print("DROPPED", worst[0].name, round(worst[1], 2))
    bpy.data.objects.remove(worst[0], do_unlink=True)

meshes = [o for o in sc.objects if o.type == "MESH"]
dg = bpy.context.evaluated_depsgraph_get()
pts = []
for o in meshes:
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    mw = o.matrix_world
    pts.extend((mw @ v.co)[:] for v in me.vertices)
    ev.to_mesh_clear()
pts = np.array(pts)
# Which way is up: glTF files come in Y-up already converted; the smallest spread
# of the three axes after dropping outliers is not reliable for bikes, so trust z.
xy = pts[:, :2]
mid = (xy.min(axis=0) + xy.max(axis=0)) / 2
evals, evecs = np.linalg.eigh(np.cov((xy - mid).T))
axis = evecs[:, int(np.argmax(evals))]
proj = (xy - mid) @ axis
cur_len = float(proj.max() - proj.min())
zmin = float(pts[:, 2].min())

rootobj = bpy.data.objects.new("root", None); sc.collection.objects.link(rootobj)
rootobj.location = (float(mid[0]), float(mid[1]), zmin)
bpy.context.view_layer.update()
for o in list(sc.objects):
    if o is not rootobj and o.parent is None:
        o.parent = rootobj; o.matrix_parent_inverse = rootobj.matrix_world.inverted()
rootobj.location = (0, 0, 0)
rootobj.rotation_euler = (0, 0, -(math.atan2(axis[1], axis[0]) - math.pi / 2) + turn)
s = length_m / cur_len
rootobj.scale = (s, s, s)
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=out)
print("NORMALIZED", os.path.basename(src), "meshes", len(meshes), "raw length", round(cur_len, 2), "scale", round(s, 4),
      "height", round(float(pts[:, 2].max() - zmin) * s, 2))
