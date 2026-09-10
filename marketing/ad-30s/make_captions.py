# Renders the ad's on-screen text as transparent 1080x1920 PNGs (this ffmpeg
# has no drawtext), plus the end card. Run: python3 make_captions.py
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1080, 1920
BRAND = (0, 192, 139)
INK = (11, 16, 15)
OUT = os.path.join(os.path.dirname(__file__), "assets", "text")
os.makedirs(OUT, exist_ok=True)

def face(style):
    path = "/System/Library/Fonts/Avenir Next.ttc"
    for i in range(16):
        try:
            f = ImageFont.truetype(path, 10, index=i)
        except OSError:
            break
        if f.getname()[1] == style:
            return lambda size, i=i: ImageFont.truetype(path, size, index=i)
    return lambda size: ImageFont.truetype(path, size)

BOLD, DEMI, MED = face("Bold"), face("Demi Bold"), face("Medium")

CAPTIONS = [
    ("c1", "Ride together.", "Live."),
    ("c2", "Live group trip", "Everyone on one map"),
    ("c3", "Push-to-talk voice", "Talk while you ride"),
    ("c4", "Plan in seconds", "Stops, route & tolls"),
    ("c5", "Invite by @username", "Or just send the link"),
    ("c6", "Live photos.", "GPS verified."),
    ("c7", "Latest photo", "becomes the banner"),
]

def caption(name, line1, line2):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f1, f2 = BOLD(84), DEMI(50)
    w1 = d.textlength(line1, font=f1); w2 = d.textlength(line2, font=f2)
    box_w = int(max(w1, w2) + 120); box_h = 250
    x0 = (W - box_w) // 2; y0 = 1440
    d.rounded_rectangle([x0, y0, x0 + box_w, y0 + box_h], radius=48, fill=(11, 16, 15, 215))
    d.rounded_rectangle([x0, y0, x0 + 14, y0 + box_h], radius=7, fill=BRAND + (255,))
    d.text(((W - w1) / 2, y0 + 38), line1, font=f1, fill=(255, 255, 255, 255))
    d.text(((W - w2) / 2, y0 + 150), line2, font=f2, fill=BRAND + (255,))
    im.save(os.path.join(OUT, f"{name}.png"))

def pin(d, cx, cy, s):
    # The Trekov pin: a teardrop with a mountain cut-out.
    r = s * 0.42
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BRAND)
    d.polygon([(cx - r * 0.86, cy + r * 0.5), (cx + r * 0.86, cy + r * 0.5), (cx, cy + s * 0.95)], fill=BRAND)
    d.polygon([(cx - r * 0.62, cy + r * 0.3), (cx - r * 0.18, cy - r * 0.35), (cx + r * 0.05, cy + r * 0.02),
               (cx + r * 0.3, cy - r * 0.55), (cx + r * 0.66, cy + r * 0.3)], fill=INK)

def end_card():
    im = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(im)
    # soft brand glow
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
    for i, a in enumerate(range(60, 0, -4)):
        rr = 520 - i * 26
        g.ellipse([W / 2 - rr, 760 - rr, W / 2 + rr, 760 + rr], fill=BRAND + (a // 6,))
    im.paste(glow, (0, 0), glow)
    d = ImageDraw.Draw(im)
    pin(d, W / 2 - 250, 690, 150)
    fw = BOLD(170); d.text((W / 2 - 150, 610), "trekov", font=fw, fill=(255, 255, 255))
    t1 = "The map is the feed."; f1 = DEMI(64)
    d.text(((W - d.textlength(t1, font=f1)) / 2, 900), t1, font=f1, fill=(255, 255, 255))
    t2 = "Live group trips · Easy planning · GPS-verified photos"; f2 = MED(40)
    d.text(((W - d.textlength(t2, font=f2)) / 2, 1000), t2, font=f2, fill=(170, 185, 180))
    bw, bh = 620, 130; bx = (W - bw) // 2; by = 1180
    d.rounded_rectangle([bx, by, bx + bw, by + bh], radius=65, fill=BRAND)
    t3 = "trekov.com"; f3 = BOLD(72)
    d.text(((W - d.textlength(t3, font=f3)) / 2, by + 22), t3, font=f3, fill=INK)
    im.save(os.path.join(OUT, "endcard.png"))

for c in CAPTIONS: caption(*c)
end_card()
print("rendered", len(CAPTIONS), "captions + end card into", OUT)
