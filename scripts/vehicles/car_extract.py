# One car from the Generic Passenger Car Pack as its own .blend, facing +Y,
# centred on the origin, wheels on z = 0 — the same layout bike_builder.py
# makes, so sprites.py renders every vehicle the same way.
#   blender -b -P scripts/vehicles/car_extract.py -- <Body name prefix> <out.blend> [flip_deg]
import bpy, sys, os, math, glob, mathutils
import numpy as np

args = sys.argv[sys.argv.index("--") + 1:]
want, out = args[0].lower(), args[1]
flip = math.radians(float(args[2])) if len(args) > 2 else 0.0
PACK = os.path.expanduser("~/Downloads/generic-passenger-car-pack")
TEX = os.path.join(PACK, "textures")
MODELS = ["Compact", "Coupe", "Hatchback", "Minivan", "Offroad", "Pickup", "Sedan", "Sport", "SUV", "Wagon"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(PACK, "source", "fab.fbx"))
sc = bpy.context.scene
files = {os.path.basename(p).lower(): p for p in glob.glob(TEX + "/*")}

# The FBX points at a folder layout the download doesn't have; relink by name.
for img in list(bpy.data.images):
    base = os.path.basename(img.filepath).lower()
    p = files.get(base)
    if not p:
        model = os.path.basename(os.path.dirname(img.filepath)).lower()
        cands = sorted(v for k, v in files.items() if (k.startswith("wheel") and k.endswith("_diffuse.png")) if "wheel" in base) \
            or sorted(v for k, v in files.items() if k.startswith(model) and "_" not in k)
        p = cands[0] if cands else None
    if p:
        img.filepath = p; img.reload()

def pbr(mat, model):
    nt = mat.node_tree; b = [n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    for kind, sock in (("Metallic", "Metallic"), ("Glossiness", "Roughness")):
        p = files.get(f"{model}_{kind}.png".lower())
        if not p: continue
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(p, check_existing=True)
        t.image.colorspace_settings.name = "Non-Color"
        if kind == "Glossiness":
            inv = nt.nodes.new("ShaderNodeInvert"); nt.links.new(t.outputs[0], inv.inputs[1]); nt.links.new(inv.outputs[0], b.inputs[sock])
        else:
            nt.links.new(t.outputs[0], b.inputs[sock])

for m in bpy.data.materials:
    if not m.use_nodes: continue
    bs = [n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]
    if not bs: continue
    b = bs[0]
    if m.name.startswith("Glass"):
        b.inputs["Base Color"].default_value = (0.02, 0.025, 0.03, 1); b.inputs["Roughness"].default_value = 0.05
        b.inputs["Coat Weight"].default_value = 1.0
    elif m.name.startswith("Body"):
        imgs = [n.image for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
        name = os.path.basename(imgs[0].filepath).lower() if imgs else ""
        model = next((k for k in MODELS if name.startswith(k.lower())), None)
        if model: pbr(m, model)
        b.inputs["Coat Weight"].default_value = 0.6; b.inputs["Coat Roughness"].default_value = 0.08

def centre(o):
    return sum((o.matrix_world @ mathutils.Vector(c) for c in o.bound_box), mathutils.Vector()) / 8

body = next(o for o in sc.objects if o.type == "MESH" and "body" in o.name.lower() and o.name.lower().startswith(want))
pts = np.array([(body.matrix_world @ v.co).xy[:] for v in body.data.vertices])
mid = pts.mean(axis=0)
evals, evecs = np.linalg.eigh(np.cov((pts - mid).T))
axis = evecs[:, int(np.argmax(evals))]
length = float(np.ptp((pts - mid) @ axis))
wheels = [o for o in sc.objects if o.type == "MESH" and o.name.lower().startswith("wheel")
          and (centre(o).xy - mathutils.Vector(mid)).length < length * 0.5]
keep = [body] + wheels
for o in list(sc.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)

root = bpy.data.objects.new("root", None); sc.collection.objects.link(root)
root.location = (float(mid[0]), float(mid[1]), 0)
bpy.context.view_layer.update()
for o in keep:
    o.parent = root; o.matrix_parent_inverse = root.matrix_world.inverted()
# The car's front up +Y, then any per-model turn.
root.rotation_euler = (0, 0, -(math.atan2(axis[1], axis[0]) - math.pi / 2) - flip)
root.location = (0, 0, 0)
bpy.context.view_layer.update()
lo = min((o.matrix_world @ mathutils.Vector(c)).z for o in keep for c in o.bound_box)
root.location.z = -lo
bpy.ops.wm.save_as_mainfile(filepath=out)
print("EXTRACTED", want, "length", round(length, 2), "wheels", len(wheels))
