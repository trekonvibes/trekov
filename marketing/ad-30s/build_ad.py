# Builds the 30 s vertical ad from assets/: AI b-roll, real app screenshots in a
# phone frame, caption cards, voiceover and music. Run: python3 build_ad.py
import os, subprocess
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "assets"); F = os.path.join(A, "frames"); T = os.path.join(A, "text")
TMP = os.path.join(A, "build"); os.makedirs(TMP, exist_ok=True)
W, H, FPS = 1080, 1920, 30
INK = (11, 16, 15)

def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

def phone_card(shot, out, bg_src=None, crop=None, scale=0.86):
    """App screenshot in a rounded phone frame, centred on a blurred background."""
    im = Image.open(shot).convert("RGB")
    if crop: im = im.crop(crop)
    if bg_src:
        bg = Image.open(bg_src).convert("RGB").resize((W, H))
    else:
        bg = im.resize((W, H))
    bg = bg.filter(ImageFilter.GaussianBlur(40))
    bg = Image.blend(bg, Image.new("RGB", (W, H), INK), 0.45)
    pw = int(W * scale); ph = int(pw * im.height / im.width)
    if ph > int(H * 0.86): ph = int(H * 0.86); pw = int(ph * im.width / im.height)
    screen = im.resize((pw, ph), Image.LANCZOS)
    r = int(pw * 0.08); bez = int(pw * 0.025)
    frame = Image.new("RGBA", (pw + 2 * bez, ph + 2 * bez), (0, 0, 0, 0))
    d = ImageDraw.Draw(frame)
    d.rounded_rectangle([0, 0, frame.width - 1, frame.height - 1], radius=r + bez, fill=(18, 20, 22, 255))
    mask = Image.new("L", (pw, ph), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw - 1, ph - 1], radius=r, fill=255)
    frame.paste(screen, (bez, bez), mask)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x = (W - frame.width) // 2; y = (H - frame.height) // 2 - 60
    ImageDraw.Draw(shadow).rounded_rectangle([x + 10, y + 30, x + frame.width + 10, y + frame.height + 30], radius=r + bez, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(30))
    canvas = bg.convert("RGBA"); canvas.alpha_composite(shadow); canvas.alpha_composite(frame, (x, y))
    canvas.convert("RGB").save(out)

def still_clip(img, secs, out, zoom_to=1.06):
    n = int(secs * FPS)
    run(["ffmpeg", "-y", "-loop", "1", "-i", img, "-vf",
         f"scale={W*2}:{H*2},zoompan=z='1+({zoom_to}-1)*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS},format=yuv420p",
         "-frames:v", str(n), "-an", out])

def broll_clip(src, secs, out, start=0.0):
    run(["ffmpeg", "-y", "-ss", str(start), "-i", src, "-t", str(secs), "-vf",
         f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},fps={FPS},format=yuv420p", "-an", out])

def with_caption(src, cap, out):
    run(["ffmpeg", "-y", "-i", src, "-i", cap, "-filter_complex",
         "[1:v]format=rgba,fade=t=in:st=0.15:d=0.3:alpha=1[c];[0:v][c]overlay=0:0:format=auto,format=yuv420p", "-an", out])

# (clip, seconds, caption) — timings follow the 29.2 s voiceover.
SCENES = [
    ("broll", os.path.join(A, "broll1-riders.mp4"), 3.0, "c1", 0.0),
    ("app",   os.path.join(F, "nav.png"),           4.0, "c2", None),
    ("app",   os.path.join(F, "nav-bar.png"),       2.0, "c3", None),
    ("app",   os.path.join(F, "alert.png"),         1.0, "c3", None),
    ("app",   os.path.join(F, "trip.png"),          4.0, "c4", None),
    ("app",   os.path.join(F, "invite.png"),        3.0, "c5", None),
    ("broll", os.path.join(A, "broll2-lake.mp4"),   2.5, "c6", 0.0),
    ("app",   os.path.join(F, "composer.png"),      2.5, "c6", None),
    ("broll", os.path.join(A, "broll3-tea.mp4"),    1.5, "c7", 0.5),
    ("app",   os.path.join(F, "place.png"),         2.5, "c7", None),
    ("end",   os.path.join(T, "endcard.png"),       4.0, None, None),
]

parts = []
for i, (kind, src, secs, cap, start) in enumerate(SCENES):
    raw = os.path.join(TMP, f"s{i:02d}-raw.mp4"); out = os.path.join(TMP, f"s{i:02d}.mp4")
    if kind == "broll":
        broll_clip(src, secs, raw, start)
    elif kind == "app":
        card = os.path.join(TMP, f"s{i:02d}.png"); phone_card(src, card); still_clip(card, secs, raw)
    else:
        still_clip(src, secs, raw, zoom_to=1.03)
    if cap: with_caption(raw, os.path.join(T, f"{cap}.png"), out)
    else: os.replace(raw, out)
    parts.append(out)

lst = os.path.join(TMP, "list.txt")
open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
video = os.path.join(TMP, "video.mp4")
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", video])

final = os.path.join(HERE, "trekov-ad-30s-vertical.mp4")
music = os.path.join(A, "music-hills-and-highways.mp3")
vo = os.path.join(A, "voiceover-hinglish.mp3")
run(["ffmpeg", "-y", "-i", video, "-i", music, "-i", vo, "-filter_complex",
     "[2:a]adelay=300|300,volume=1.6,apad=pad_dur=2[vo];"
     "[1:a]volume=0.55,afade=t=in:st=0:d=0.4,afade=t=out:st=28:d=2[mus];"
     "[mus][vo]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400[duck];"
     "[duck][vo]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]",
     "-map", "0:v", "-map", "[a]", "-t", "30", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
     "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final])
print("built", final)
