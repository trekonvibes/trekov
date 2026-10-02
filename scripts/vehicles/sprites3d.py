# The 3D map vehicle: one model seen from 36 directions at the navigation
# camera's tilt, laid out as a 6 x 6 sheet (Punit, 2026-09-14: "the car and
# bikes should be in 3d on the map, not look like 2d").
#
# A map can only draw flat images, so the app picks the frame for (vehicle
# heading - map bearing) as either one changes — you see the side of the car
# as the road bends, the way a racing game's sprites work. Frame k shows the
# vehicle turned k * 10 degrees clockwise on screen. Also writes a top-down
# frame for the flat, north-up map.
#
#   blender -b <vehicle.blend> -P scripts/vehicles/sprites3d.py -- <out_dir> <id> [tilt_deg] [cell_px]
import bpy, sys, os, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
out_dir, vid = args[0], args[1]
tilt = float(args[2]) if len(args) > 2 else 50.0      # degrees from straight down, as Google Maps counts it
cell = int(args[3]) if len(args) > 3 else 224
FRAMES = 36
sc = bpy.context.scene

meshes = [o for o in sc.objects if o.type == "MESH"]
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
length = max(hi.y - lo.y, hi.x - lo.x)
height = hi.z - lo.z

# Everything hangs off a turntable at the ground centre.
turn = bpy.data.objects.new("turntable", None); sc.collection.objects.link(turn)
turn.location = ((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, 0)
bpy.context.view_layer.update()
for o in list(sc.objects):
    if o is not turn and o.parent is None and o.type in {"MESH", "EMPTY"}:
        o.parent = turn; o.matrix_parent_inverse = turn.matrix_world.inverted()
turn.location = (0, 0, 0)

cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"
# Room for the length plus the height leaning into view, the same for every frame.
cam.ortho_scale = max(length, height) * 1.25
co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co

def aim(tilt_deg):
    t = math.radians(tilt_deg)
    # Behind the vehicle (-Y) and above it, looking at the ground centre: screen up is +Y.
    co.location = Vector((0, -math.sin(t), math.cos(t))) * 30
    co.rotation_euler = (t, 0, 0)

# Light fixed to the camera, so every frame is lit as the map would be: sun
# high over the viewer's left shoulder, a soft sky fill.
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.4; sun.angle = math.radians(18)
so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so)
so.rotation_euler = (math.radians(24), math.radians(-12), math.radians(-20))
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.66, 0.72, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
plane = bpy.context.active_object; plane.is_shadow_catcher = True

sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = "GPU"
except Exception:
    sc.cycles.device = "CPU"
sc.cycles.samples = 32; sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = cell * 2     # rendered at 2x, shrunk when the sheet is made
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "AgX"

frames_dir = os.path.join(out_dir, vid)
os.makedirs(frames_dir, exist_ok=True)
aim(tilt)
for k in range(FRAMES):
    turn.rotation_euler = (0, 0, -math.radians(k * 360 / FRAMES))    # clockwise on screen
    sc.render.filepath = os.path.join(frames_dir, f"f{k:02d}.png")
    bpy.ops.render.render(write_still=True)
aim(0.0001)
turn.rotation_euler = (0, 0, 0)
sc.render.filepath = os.path.join(frames_dir, "top.png")
bpy.ops.render.render(write_still=True)
print("SPRITES", vid, "length", round(length, 2), "height", round(height, 2), "scale", round(cam.ortho_scale, 2))
