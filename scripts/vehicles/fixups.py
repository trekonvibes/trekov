# Materials for the downloaded vehicle models, after normalize.py (Punit,
# 2026-09-14). The downloads arrive with textures pointing at the author's own
# disk, game shaders Blender can't read, or no colours at all; each model's
# parts were identified by rendering its materials one at a time.
# Brand logos are left out: tanks and fairings get plain paint.
#
#   blender -b <model.blend> -P scripts/vehicles/fixups.py -- <id> <models dir>
import bpy, sys, os, glob

args = sys.argv[sys.argv.index("--") + 1:]
vid, models = args[0], args[1]

def bsdf(m):
    m.use_nodes = True
    b = [n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"]
    if not b:
        b = [m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")]
        out = [n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL"]
        if out: m.node_tree.links.new(b[0].outputs[0], out[0].inputs[0])
    return b[0]

def unlink(m, b, *names):
    for name in names:
        for l in list(b.inputs[name].links):
            m.node_tree.links.remove(l)

def look(m, colour=None, metal=None, rough=None, coat=None, alpha=None, emit=None, keep_texture=False):
    b = bsdf(m)
    if colour is not None:
        if not keep_texture: unlink(m, b, "Base Color")
        b.inputs["Base Color"].default_value = (*colour, 1)
    if metal is not None: unlink(m, b, "Metallic"); b.inputs["Metallic"].default_value = metal
    if rough is not None: unlink(m, b, "Roughness"); b.inputs["Roughness"].default_value = rough
    if coat is not None:
        b.inputs["Coat Weight"].default_value = coat; b.inputs["Coat Roughness"].default_value = 0.05
    if alpha is not None:
        unlink(m, b, "Alpha"); b.inputs["Alpha"].default_value = alpha
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = 2.0
    for sock in ("Emission Color",):
        if emit is None:
            unlink(m, b, sock)
            b.inputs["Emission Strength"].default_value = 0.0

def texture(m, path, socket="Base Color", non_color=False):
    b = bsdf(m)
    unlink(m, b, socket)
    t = m.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(path, check_existing=True)
    if non_color: t.image.colorspace_settings.name = "Non-Color"
    if socket == "Normal":
        nm = m.node_tree.nodes.new("ShaderNodeNormalMap")
        m.node_tree.links.new(t.outputs[0], nm.inputs["Color"])
        m.node_tree.links.new(nm.outputs[0], b.inputs["Normal"])
    else:
        m.node_tree.links.new(t.outputs[0], b.inputs[socket])

def mat(name):
    return bpy.data.materials.get(name)

PAINT_BLACK = dict(colour=(0.02, 0.02, 0.022), metal=0.3, rough=0.25, coat=1.0)
MATTE_BLACK = dict(colour=(0.03, 0.03, 0.032), metal=0.1, rough=0.6)
DARK_METAL = dict(colour=(0.12, 0.12, 0.125), metal=0.9, rough=0.35)
ALU = dict(colour=(0.7, 0.71, 0.73), metal=1.0, rough=0.3)
CHROME = dict(colour=(0.92, 0.92, 0.94), metal=1.0, rough=0.06)
RUBBER = dict(colour=(0.02, 0.02, 0.022), metal=0.0, rough=0.85)
LEATHER = dict(colour=(0.035, 0.03, 0.028), metal=0.0, rough=0.55)
GLASS = dict(colour=(0.8, 0.85, 0.9), metal=0.0, rough=0.02, coat=1.0)
RED_LAMP = dict(colour=(0.8, 0.03, 0.02), metal=0.0, rough=0.2, emit=(0.9, 0.05, 0.02))
AMBER = dict(colour=(1.0, 0.5, 0.05), metal=0.0, rough=0.2)

def set_all(**k):
    for m in bpy.data.materials:
        if m.users: look(m, **k)

def hunter350():
    set_all(**PAINT_BLACK)
    S = "bike_color:aiStandardSurface"
    look(mat(S + "23"), **PAINT_BLACK)                                   # frame, fenders, panels
    look(mat(S + "27"), **RUBBER)                                        # tyres
    look(mat(S + "28"), colour=(0.06, 0.2, 0.52), metal=0.4, rough=0.22, coat=1.0)   # tank, rebel blue
    look(mat(S + "32"), **DARK_METAL)                                    # wheels, engine, hardware
    look(mat(S + "33"), **LEATHER)                                       # seat
    look(mat(S + "30"), **AMBER)                                         # indicators
    look(mat(S + "31"), **CHROME)                                        # fork details
    look(mat(S + "34"), **RUBBER)                                        # grips
    look(mat(S + "37"), **CHROME)                                        # mirrors

def classic350():
    look(mat("body"), **PAINT_BLACK)
    look(mat("Disk"), **ALU)
    look(mat("ENGINE"), **DARK_METAL)
    look(mat("engine fins"), **ALU)
    look(mat("SEAT"), **LEATHER)                                         # seat and tyres share it
    look(mat("STEEL"), **CHROME)                                         # exhaust, spokes, rims
    look(mat("texture"), colour=(0.2, 0.205, 0.21), metal=0.55, rough=0.25, coat=1.0)  # tank, gunmetal, no logo
    look(mat("SWITCH"), **MATTE_BLACK)
    look(mat("SPEEDOMETER"), **MATTE_BLACK)
    for n in ("Material.003", "Material.004"):
        if mat(n): look(mat(n), **GLASS)
    if mat("Material.005"): look(mat("Material.005"), **RED_LAMP)

def nr750():
    d = glob.glob(os.path.join(models, "honda-nr750-1994", "**"), recursive=True)
    f = {os.path.basename(p): p for p in d}
    for name, tex in (("Bike", "75_$albedo.png"), ("Exhaust", "75_$albedo_1.jpg"), ("Glass", "75_$albedo_2.jpg"),
                      ("Grips", "75_$albedo_3.jpg"), ("Mirrors", "75_$albedo_4.jpg"), ("Chain", "75_$albedo_5.jpg"),
                      ("Tyre", "75_$albedo_6.jpg"), ("Rim", "75_$albedo_7.jpg"), ("brake", "75_$albedo_7.jpg")):
        m = mat(name)
        if not m or tex not in f: continue
        texture(m, f[tex])
        b = bsdf(m)
        b.inputs["Metallic"].default_value = 0.0 if name in ("Tyre", "Grips") else 0.3
        b.inputs["Roughness"].default_value = 0.8 if name in ("Tyre", "Grips") else 0.35
        b.inputs["Alpha"].default_value = 1.0
        if name == "Bike":
            b.inputs["Coat Weight"].default_value = 1.0; b.inputs["Coat Roughness"].default_value = 0.05
    if "75_$normal_0.jpg" in f and mat("Bike"): texture(mat("Bike"), f["75_$normal_0.jpg"], "Normal", non_color=True)

def ninja():
    for m in bpy.data.materials:
        if not m.users: continue
        b = bsdf(m)
        c = b.inputs["Base Color"].default_value
        # Pure-black metal renders as a hole; give it the depth of black chrome.
        if b.inputs["Metallic"].default_value > 0.9 and max(c[:3]) < 0.1:
            b.inputs["Base Color"].default_value = (0.05, 0.05, 0.055, 1)
            b.inputs["Roughness"].default_value = max(0.15, b.inputs["Roughness"].default_value)
        b.inputs["Alpha"].default_value = 1.0
    look(mat("Vt_Liu.001"), colour=(0.06, 0.06, 0.065), metal=0.9, rough=0.12, coat=1.0)   # mirror-black fairing
    look(mat("Vt_Liu.005"), **RUBBER)
    look(mat("Material.001"), **DARK_METAL); look(mat("Material.002"), **DARK_METAL)
    look(mat("Vt_Liu.006"), colour=(0.25, 0.75, 0.05), metal=0.3, rough=0.3, coat=0.8)    # green trellis
    look(mat("Vt_Liu.010"), **LEATHER)
    look(mat("Vt_Liu.012"), **MATTE_BLACK)
    look(mat("Vt_Liu.015"), **GLASS)
    look(mat("Vt_Liu"), colour=(0.45, 0.4, 0.3), metal=1.0, rough=0.3)                      # titanium exhaust

def s1000rr():
    imgs = {i.name.lower(): i for i in bpy.data.images}
    for m in bpy.data.materials:
        if not m.users: continue
        b = bsdf(m)
        base = m.name.split(".")[0].split(" [")[0].lower()
        # Game shaders layer a dirt texture over the paint; keep the clean one.
        img = imgs.get(base) or next((i for n, i in imgs.items() if n.endswith("-" + base)), None)
        for l in list(m.node_tree.links):
            if l.to_node == b: m.node_tree.links.remove(l)
        if img:
            t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = img
            m.node_tree.links.new(t.outputs[0], b.inputs["Base Color"])
        b.inputs["Alpha"].default_value = 1.0
        b.inputs["Emission Strength"].default_value = 0.0
        b.inputs["Metallic"].default_value = 0.2
        b.inputs["Roughness"].default_value = 0.4
    for n in bpy.data.materials:
        low = n.name.lower()
        if "livery" in low: look(n, colour=(0.85, 0.86, 0.88), metal=0.3, rough=0.2, coat=1.0)
        elif "tyre" in low: look(n, **RUBBER, keep_texture=True)
        elif "glass" in low: look(n, **GLASS)
        elif "carbon" in low: look(n, colour=(0.03, 0.03, 0.035), metal=0.4, rough=0.25, coat=1.0, keep_texture=True)
        elif low.startswith("black"): look(n, **PAINT_BLACK)
        elif "exhaust" in low or "brakes" in low: look(n, **ALU, keep_texture=True)
        elif "decal" in low or "dials" in low or "rgbab" in low: look(n, **MATTE_BLACK)

def bros():
    f = {os.path.basename(p).lower(): p for p in glob.glob(os.path.join(models, "honda-nxr-bros-2003", "**", "*.png"), recursive=True)}
    def maps(m, stem):
        for kind, sock, nc in (("color", "Base Color", False), ("color2", "Base Color", False), ("roughness", "Roughness", True),
                               ("metalness", "Metallic", True), ("normal", "Normal", True)):
            p = f.get(f"{stem}_{kind}.png".lower())
            if p: texture(m, p, sock, non_color=nc)
    look(mat("FairingGasTank"), colour=(0.75, 0.05, 0.05), rough=0.3, coat=1.0); maps(mat("FairingGasTank"), "FairingGasTank")
    look(mat("RubberLeatherBros"), **LEATHER); maps(mat("RubberLeatherBros"), "RubberLeatherBros")
    look(mat("TireMat"), **RUBBER); maps(mat("TireMat"), "Tire")
    look(mat("Chrome"), **CHROME); maps(mat("Chrome"), "Chrome")
    look(mat("ScratchedSteel"), **ALU); maps(mat("ScratchedSteel"), "ScratchedSteel")
    look(mat("Engine"), **DARK_METAL); maps(mat("Engine"), "Engine")
    look(mat("FrontSuspension"), **CHROME); maps(mat("FrontSuspension"), "FrontSuspension")
    look(mat("Carburettor"), **ALU)
    look(mat("ChainMat"), **DARK_METAL); look(mat("Sprocket"), **DARK_METAL); look(mat("BrakeDisk"), **ALU)
    look(mat("Mirror"), **MATTE_BLACK); look(mat("PlasticScratch"), **MATTE_BLACK)
    look(mat("Dashboard"), **MATTE_BLACK); look(mat("DashboardSide"), **MATTE_BLACK)
    look(mat("FrontLight"), **GLASS); maps(mat("FrontLight"), "FrontLight")
    look(mat("IndicatorRearLantern"), **AMBER); maps(mat("IndicatorRearLantern"), "IndicatorsLantern")

def vn900():
    pass   # arrives textured

def datsun():
    for m in bpy.data.materials:
        if not m.users: continue
        b = bsdf(m)
        b.inputs["Alpha"].default_value = 1.0
    look(mat("body"), colour=(0.62, 0.08, 0.05), metal=0.4, rough=0.2, coat=1.0)
    look(mat("paint"), colour=(0.62, 0.08, 0.05), metal=0.4, rough=0.2, coat=1.0)
    look(mat("coat"), colour=(0.62, 0.08, 0.05), metal=0.4, rough=0.2, coat=1.0)
    look(mat("chrome"), **CHROME); look(mat("alloy"), **ALU)
    look(mat("black_matte"), **MATTE_BLACK); look(mat("black_paint"), **PAINT_BLACK); look(mat("plastic_mat"), **MATTE_BLACK)
    look(mat("opona"), **RUBBER); look(mat("tire"), **RUBBER)
    look(mat("glass"), colour=(0.02, 0.025, 0.03), metal=0.0, rough=0.03, coat=1.0)
    look(mat("headlights"), **GLASS)
    look(mat("orange_glass"), **AMBER); look(mat("red_glass"), **RED_LAMP)
    if mat("stickers"): look(mat("stickers"), colour=(0.62, 0.08, 0.05), metal=0.4, rough=0.2, coat=1.0)
    if mat("license"): look(mat("license"), **MATTE_BLACK)

globals()[vid]()
bpy.ops.wm.save_mainfile()
print("FIXED", vid)
