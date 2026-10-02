# A three-quarter studio preview of a built vehicle .blend, to check the model.
#   blender -b <vehicle.blend> -P scripts/vehicles/preview.py -- out.png [azimuth_deg] [elevation_deg]
import bpy, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
out = args[0]
az = math.radians(float(args[1]) if len(args) > 1 else 35)
el = math.radians(float(args[2]) if len(args) > 2 else 18)
sc = bpy.context.scene

meshes = [o for o in sc.objects if o.type == "MESH"]
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
centre = (lo + hi) / 2
size = max(hi - lo)

cam = bpy.data.cameras.new("cam"); cam.lens = 60
co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co
dist = size * 2.6
co.location = centre + Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el))) * dist
t = co.constraints.new("TRACK_TO"); tgt = bpy.data.objects.new("tgt", None); sc.collection.objects.link(tgt)
tgt.location = centre; t.target = tgt; t.track_axis = "TRACK_NEGATIVE_Z"; t.up_axis = "UP_Y"

sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.5; sun.angle = math.radians(12)
so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(40), math.radians(10), math.radians(40))
area = bpy.data.lights.new("key", "AREA"); area.energy = 400; area.size = 3
ao = bpy.data.objects.new("key", area); sc.collection.objects.link(ao); ao.location = centre + Vector((-2, 1.5, 2.5))
ao.rotation_euler = (math.radians(45), 0, math.radians(-130))
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.85, 0.87, 0.9, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
floor = bpy.context.active_object
fm = bpy.data.materials.new("floor"); fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.8, 0.8, 0.82, 1)
floor.data.materials.append(fm)

sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = "GPU"
except Exception:
    sc.cycles.device = "CPU"
sc.cycles.samples = 64; sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 960, 640
sc.view_settings.view_transform = "AgX"
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("PREVIEW", out)
