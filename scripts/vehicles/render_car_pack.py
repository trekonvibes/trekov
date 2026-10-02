# Realistic cars (Punit, 2026-09-14): the "Generic Passenger Car Pack" in
# ~/Downloads, rendered top-down one car per frame, front up.
#   blender -b -P scripts/vehicles/render_car_pack.py -- brand/vehicle-models/renders "" \
#     "coupe:180,hatchback:180,minivan:180,pickup:180,sport:180"
# The last argument turns the cars whose front ended up at the bottom.
import bpy, sys, os, math, mathutils, glob
args = sys.argv[sys.argv.index("--") + 1:]
out_dir = args[0]; only = args[1].split(",") if len(args) > 1 and args[1] else None
TEX = "/Users/punit/Downloads/generic-passenger-car-pack/textures"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath="/Users/punit/Downloads/generic-passenger-car-pack/source/fab.fbx")
sc = bpy.context.scene
files = {os.path.basename(p).lower(): p for p in glob.glob(TEX + "/*")}

def find_tex(stem):
    return files.get(stem.lower())

# Relink textures: exact name first, else any colour of the same model.
for img in list(bpy.data.images):
    base = os.path.basename(img.filepath)
    p = find_tex(base)
    if not p:
        model = os.path.basename(os.path.dirname(img.filepath))
        if "wheel" in base.lower():
            cands = [v for k, v in files.items() if k.startswith("wheel") and k.endswith("_diffuse.png")]
        else:
            cands = [v for k, v in files.items() if k.startswith(model.lower()) and "_" not in k]
        p = cands[0] if cands else None
    if p:
        img.filepath = p; img.reload()

def pbr(mat, stem):
    nt = mat.node_tree; b = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    for kind, sock, cs in (("Metallic", "Metallic", "Non-Color"), ("Glossiness", "Roughness", "Non-Color")):
        p = find_tex(f"{stem}_{kind}.png")
        if not p: continue
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(p, check_existing=True)
        t.image.colorspace_settings.name = cs
        if kind == "Glossiness":
            inv = nt.nodes.new("ShaderNodeInvert"); nt.links.new(t.outputs[0], inv.inputs[1]); nt.links.new(inv.outputs[0], b.inputs[sock])
        else:
            nt.links.new(t.outputs[0], b.inputs[sock])

for m in bpy.data.materials:
    if not m.use_nodes: continue
    b = [n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]
    if not b: continue
    b = b[0]
    if m.name.startswith("Glass"):
        b.inputs["Base Color"].default_value = (0.02, 0.025, 0.03, 1); b.inputs["Roughness"].default_value = 0.05
        b.inputs["Metallic"].default_value = 0.0
        if "Coat Weight" in b.inputs: b.inputs["Coat Weight"].default_value = 1.0
    elif m.name.startswith("Body"):
        imgs = [n.image for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
        if imgs:
            stem = os.path.basename(os.path.dirname(imgs[0].filepath)) or ""
            name = os.path.basename(imgs[0].filepath)
            model = next((k for k in ["Compact","Coupe","Hatchback","Minivan","Offroad","Pickup","Sedan","Sport","SUV","Wagon"] if name.lower().startswith(k.lower())), None)
            if model: pbr(m, model)
        if "Coat Weight" in b.inputs: b.inputs["Coat Weight"].default_value = 0.6; b.inputs["Coat Roughness"].default_value = 0.08

bodies = [o for o in sc.objects if o.type == "MESH" and "body" in o.name.lower()]
wheels = [o for o in sc.objects if o.type == "MESH" and o.name.lower().startswith("wheel")]
for o in sc.objects:
    if o.name.startswith("Cylinder"): o.hide_render = True

def centre(o):
    return sum((o.matrix_world @ mathutils.Vector(c) for c in o.bound_box), mathutils.Vector()) / 8

cam = bpy.data.cameras.new("cam"); cam.type = "ORTHO"
co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co); sc.camera = co
sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.2; sun.angle = math.radians(25)
so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(14), math.radians(-8), math.radians(30))
fill = bpy.data.lights.new("fill", "SUN"); fill.energy = 0.8
fo = bpy.data.objects.new("fill", fill); sc.collection.objects.link(fo); fo.rotation_euler = (math.radians(-35), math.radians(25), 0)
world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]
# An even overcast sky: the physical sky carried a low sun of its own and threw
# long shadows across the frame.
bg.inputs[0].default_value = (0.62, 0.66, 0.72, 1); bg.inputs[1].default_value = 0.55
bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0)); plane = sc.objects["Plane"]; plane.is_shadow_catcher = True

sc.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"; prefs.get_devices()
    for d in prefs.devices: d.use = True
    sc.cycles.device = "GPU"
except Exception: sc.cycles.device = "CPU"
sc.cycles.samples = 96; sc.cycles.use_denoising = True
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = 768
sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"

os.makedirs(out_dir, exist_ok=True)
FLIP = {x.split(":")[0].lower(): float(x.split(":")[1]) for x in (args[2].split(",") if len(args) > 2 and args[2] else [])}
import numpy as np
for body in bodies:
    name = body.name.split()[0].capitalize()
    if only and name.lower() not in [x.lower() for x in only]: continue
    c = centre(body)
    dims = body.dimensions
    length = max(dims.x, dims.y)
    # The car's long axis from its own vertices, not the object's rotation:
    # some bodies carry their turn in the mesh.
    pts = np.array([(body.matrix_world @ v.co).xy[:] for v in body.data.vertices])
    mid = pts.mean(axis=0)
    evals, evecs = np.linalg.eigh(np.cov((pts - mid).T))
    axis = evecs[:, int(np.argmax(evals))]
    proj = (pts - mid) @ axis
    length = float(proj.max() - proj.min())
    c = mathutils.Vector((float(mid[0]), float(mid[1]), c.z))
    mine = [w for w in wheels if (centre(w).xy - c.xy).length < length * 0.5]
    keep = set([body] + mine)
    for o in sc.objects:
        if o.type == "MESH" and o is not plane:
            o.hide_render = o not in keep
            o.visible_shadow = o in keep
    rz = math.atan2(axis[1], axis[0]) - math.pi / 2 + math.radians(FLIP.get(name.lower(), 0))
    cam.ortho_scale = length * 1.12
    co.location = (c.x, c.y, 30); co.rotation_euler = (0, 0, rz)
    sc.render.filepath = os.path.join(out_dir, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", name, "wheels", len(mine), "len", round(length, 2))
