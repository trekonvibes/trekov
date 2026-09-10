"""Crop top-down Blender renders into the map-marker sprites.

Renders come from render_vehicle.py (512px, transparent, soft shadow, front
pointing up). Each sprite is a square centred on the vehicle body, so the
marker spins about the vehicle's middle when it turns.

    python3 scripts/vehicles/sprites.py <renders dir> [src/assets/vehicles]

Sources and licences are listed in MODELS in src/lib/vehicleArt.js.
"""
import os
import sys
from PIL import Image

# sprite id -> render file
SRC = {
    'sedan': 'sedan-kenney.png', 'hatchback': 'hatchback.png', 'suv': 'suv-rangey.png', 'pickup': 'pickup-l200.png',
    'classic': 'moto-military.png', 'sport': 'moto-a.png', 'cruiser': 'moto-b.png', 'commuter': 'moto-c.png',
    'scooter': 'vespa.png',
}
SIZE = 144  # 3x the ~48px the marker is drawn at

renders = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'src/assets/vehicles'
os.makedirs(out, exist_ok=True)
for sid, name in SRC.items():
    im = Image.open(os.path.join(renders, name)).convert('RGBA')
    # The shadow never passes ~65% alpha; the body is opaque.
    x0, y0, x1, y1 = im.split()[3].point(lambda v: 255 if v > 200 else 0).getbbox()
    cx, cy, half = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 0.54
    sq = im.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half)))
    sq.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(out, f'{sid}.webp'), 'WEBP', quality=85, method=6)
    print(f'{sid:10} {os.path.getsize(os.path.join(out, sid + ".webp")):6d} B')
