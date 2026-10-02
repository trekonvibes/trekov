"""Pack sprites3d.py renders into the app's vehicle images.

    python3 scripts/vehicles/sheets.py <sprites dir>

For each vehicle writes:
  src/assets/vehicles3d/<id>.webp  6 x 7 sheet: frames 0-35 are the vehicle turned
                                   k * 10 degrees clockwise at the navigation
                                   tilt; cell 36 is the same vehicle straight
                                   from above, at the same scale. The ground
                                   centre is the middle of every cell.
  src/assets/vehicles/<id>.webp    the top view cropped to the vehicle, for the
                                   picker and the flat map marker.
"""
import os
import sys
from PIL import Image

IDS = ['hatchback', 'compact', 'sedan', 'suv', 'offroad', 'minivan', 'pickup', 'sportscar', 'coupe', 'classic', 'roadster', 'cruiser', 'trail', 'tourer', 'sport', 'hyper']
CELL, COLS, ROWS = 224, 6, 7
ICON = 192

# The shadow catcher leaves a faint haze over the whole frame, which showed as
# a pale square around the vehicle on a light map (iPhone, 2026-09-14). Alpha
# under this is dropped, and the rest of the shadow is rescaled to match.
HAZE = 26
def clean(im):
    r, g, b, a = im.split()
    a = a.point(lambda v: 0 if v <= HAZE else round((v - HAZE) * 255 / (255 - HAZE)))
    return Image.merge('RGBA', (r, g, b, a))

src = sys.argv[1]
os.makedirs('src/assets/vehicles3d', exist_ok=True)
for vid in IDS:
    d = os.path.join(src, vid)
    if not os.path.exists(os.path.join(d, 'top.png')):
        print(f'{vid:10} missing'); continue
    sheet = Image.new('RGBA', (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
    for k in range(36):
        im = clean(Image.open(os.path.join(d, f'f{k:02d}.png')).convert('RGBA')).resize((CELL, CELL), Image.LANCZOS)
        sheet.alpha_composite(im, ((k % COLS) * CELL, (k // COLS) * CELL))
    top = clean(Image.open(os.path.join(d, 'top.png')).convert('RGBA'))
    sheet.alpha_composite(top.resize((CELL, CELL), Image.LANCZOS), (0, 6 * CELL))
    out = f'src/assets/vehicles3d/{vid}.webp'
    sheet.save(out, 'WEBP', quality=76, alpha_quality=80, method=6)

    # The body is opaque; the soft shadow stays under ~65% alpha.
    x0, y0, x1, y1 = top.split()[3].point(lambda v: 255 if v > 200 else 0).getbbox()
    cx, cy, half = (x0 + x1) / 2, (y0 + y1) / 2, max(x1 - x0, y1 - y0) * 0.54
    icon = top.crop((round(cx - half), round(cy - half), round(cx + half), round(cy + half)))
    icon.resize((ICON, ICON), Image.LANCZOS).save(f'src/assets/vehicles/{vid}.webp', 'WEBP', quality=88, method=6)
    print(f'{vid:10} sheet {os.path.getsize(out) // 1024:4d} KB')
