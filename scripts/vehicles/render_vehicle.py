# Blender: render one glTF vehicle top-down on a transparent background with a
# soft ground shadow. Usage: blender -b -P render_vehicle.py -- in.glb out.png [flip_deg]
import bpy, sys, math, mathutils
args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]
flip = math.radians(float(args[2])) if len(args) > 2 else 0.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
scene = bpy.context.scene
meshes = [o for o in scene.objects if o.type == "MESH"]
lo = mathutils.Vector((1e9, 1e9, 1e9)); hi = mathutils.Vector((-1e9, -1e9, -1e9))
for o in meshes:
    for c in o.bound_box:
        w = o.matrix_world @ mathutils.Vector(c)
        lo = mathutils.Vector(map(min, lo, w)); hi = mathutils.Vector(map(max, hi, w))
size = hi - lo; centre = (hi + lo) / 2

root = bpy.data.objects.new("root", None); scene.collection.objects.link(root)
root.location = (centre.x, centre.y, lo.z)
bpy.context.view_layer.update()
for o in list(scene.objects):
    if o is not root and o.parent is None:
        o.parent = root; o.matrix_parent_inverse = root.matrix_world.inverted()
root.location = (0, 0, 0)
# Point the vehicle's length up the frame (+Y), then any per-model flip.
root.rotation_euler = (0, 0, (0 if size.y >= size.x else math.pi / 2) + flip)
bpy.context.view_layer.update()
length = max(size.x, size.y); width = min(size.x, size.y)

# Ground that only catches the shadow.
bpy.ops.mesh.primitive_plane_add(size=length * 6, location=(0, 0, 0))
scene.objects["Plane"].is_shadow_catcher = True

cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"; cam.ortho_scale = length * 1.18
co = bpy.data.objects.new("cam", cam); scene.collection.objects.link(co)
co.location = (0, 0, length * 4); scene.camera = co

sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.2; sun.angle = math.radians(8)
so = bpy.data.objects.new("sun", sun); scene.collection.objects.link(so)
so.rotation_euler = (math.radians(35), math.radians(-18), math.radians(25))
fill = bpy.data.lights.new("fill", "SUN"); fill.energy = 0.9
fo = bpy.data.objects.new("fill", fill); scene.collection.objects.link(fo)
fo.rotation_euler = (math.radians(-40), math.radians(30), 0)
world = bpy.data.worlds.new("w"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.58, 0.6, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.7

scene.render.engine = "CYCLES"; scene.cycles.device = "CPU"; scene.cycles.samples = 64
scene.cycles.use_denoising = True
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 512
scene.render.image_settings.file_format = "PNG"; scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "Standard"
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print(f"RENDERED {out} length={length:.2f} width={width:.2f}")
