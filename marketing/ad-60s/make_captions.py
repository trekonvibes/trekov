# Caption cards for the 60 s ad: a bold two-line title in a dark band at the
# top of the 1080x1920 frame, over the video. Run: python3 make_captions.py
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "text"); os.makedirs(OUT, exist_ok=True)
W, H = 1080, 1920
BRAND = (0, 192, 139)
FONT = "/System/Library/Fonts/Avenir Next.ttc"
bold = lambda n: ImageFont.truetype(FONT, n, index=8)     # Heavy
demi = lambda n: ImageFont.truetype(FONT, n, index=2)     # Demi Bold

CAPS = [
    ("t01", "Ride together.", "Live."),
    ("t02", "Live group trip", "Everyone on one map"),
    ("t03", "Pick your ride", "Classic · Cruiser · SUV"),
    ("t04", "Turn-by-turn", "with live traffic"),
    ("t05", "One tap: STOP", "The whole group knows"),
    ("t06", "Push-to-talk", "Talk while you ride"),
    ("t07", "Plan in seconds", "Distance · time · tolls"),
    ("t08", "Invite by @username", "Or just send the link"),
    ("t09", "No network?", "Save the map offline"),
    ("t10", "Petrol · garages · stays", "Nearby, on the way"),
    ("t11", "Live photos only", "GPS verified"),
    ("t12", "Newest photo", "becomes the banner"),
    ("t13", "~300 places", "across India, with photos"),
]

for key, l1, l2 in CAPS:
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    band = Image.new("RGBA", (W, 380), (0, 0, 0, 0)); bd = ImageDraw.Draw(band)
    for y in range(380):  # dark gradient so white text reads on any footage
        bd.line([(0, y), (W, y)], fill=(6, 10, 9, int(205 * (1 - y / 380) ** 1.2)))
    im.alpha_composite(band, (0, 0))
    d = ImageDraw.Draw(im)
    f1, f2 = bold(92), demi(52)
    y = 58
    for text, f, col in ((l1, f1, (255, 255, 255)), (l2, f2, BRAND)):
        w = d.textlength(text, font=f)
        sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).text(((W - w) / 2 + 3, y + 4), text, font=f, fill=(0, 0, 0, 160))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(6)))
        d.text(((W - w) / 2, y), text, font=f, fill=col)
        y += int(f.size * 1.18)
    im.save(os.path.join(OUT, f"{key}.png"))

# End card: logo mark, name, line, URL.
im = Image.new("RGB", (W, H), (8, 12, 11)); d = ImageDraw.Draw(im)
glow = Image.new("RGB", (W, H), (8, 12, 11)); gd = ImageDraw.Draw(glow)
for r in range(900, 0, -8):
    a = int(70 * (1 - r / 900) ** 1.6); gd.ellipse([W / 2 - r, 820 - r, W / 2 + r, 820 + r], fill=(8, 12 + a, 11 + int(a * .8)))
im.paste(glow.filter(ImageFilter.GaussianBlur(60))); d = ImageDraw.Draw(im)
cx, cy = W // 2, 700
d.ellipse([cx - 70, cy - 110, cx + 70, cy + 30], fill=BRAND); d.polygon([(cx - 58, cy - 10), (cx + 58, cy - 10), (cx, cy + 90)], fill=BRAND)
d.ellipse([cx - 28, cy - 68, cx + 28, cy - 12], fill=(8, 12, 11))
for text, f, col, y in (("trekov", bold(150), (255, 255, 255), 830), ("The map is the feed.", demi(62), (255, 255, 255), 1030),
                        ("Live group trips · Easy planning · GPS-verified photos", demi(38), (170, 190, 184), 1130)):
    w = d.textlength(text, font=f); d.text(((W - w) / 2, y), text, font=f, fill=col)
bw, bh = 560, 130; x0 = (W - bw) // 2
d.rounded_rectangle([x0, 1290, x0 + bw, 1290 + bh], radius=65, fill=BRAND)
f = bold(64); w = d.textlength("trekov.com", font=f); d.text(((W - w) / 2, 1318), "trekov.com", font=f, fill=(6, 20, 15))
im.save(os.path.join(OUT, "endcard.png"))
print("captions", len(CAPS), "+ endcard ->", OUT)
