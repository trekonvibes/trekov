# Builds the 60 s vertical ad: AI b-roll full-bleed, real screen recordings of
# the app (assets/rec, from shoot.mjs) inset over a blurred copy of themselves,
# caption cards, the deep-voice Hinglish VO and a 60 s music bed.
# Cuts follow the VO line starts in assets/vo-timing.json. Run: python3 build_60.py
import json, os, subprocess
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "assets"); P = os.path.join(A, "prep"); R = os.path.join(A, "rec"); T = os.path.join(A, "text")
TMP = os.path.join(A, "build"); os.makedirs(TMP, exist_ok=True)
W, H, FPS = 1080, 1920, 30
starts = json.load(open(os.path.join(A, "vo-timing.json")))["starts"] + [60.0]
# the last line's end card runs to 60 s; line 14 is split at "Map ही feed है"
def run(cmd): subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)

# Inset for app recordings: 84% size, rounded corners, soft shadow.
IW, IH = int(W * 0.84) // 2 * 2, int(H * 0.84) // 2 * 2
IX, IY = (W - IW) // 2, 292
mask = Image.new("L", (IW, IH), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, IW - 1, IH - 1], radius=54, fill=255)
mask.save(os.path.join(TMP, "mask.png"))
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([IX + 6, IY + 26, IX + IW + 6, IY + IH + 26], radius=60, fill=(0, 0, 0, 170))
sh.filter(ImageFilter.GaussianBlur(28)).save(os.path.join(TMP, "shadow.png"))

def broll(src, ss, dur, out):
    run(["ffmpeg", "-y", "-ss", f"{ss}", "-i", src, "-t", f"{dur}", "-vf",
         f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},zoompan=z='min(1.0+0.0009*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},format=yuv420p",
         "-an", "-c:v", "libx264", "-crf", "17", out])

def app(src, ss, dur, out, speed=1.0):
    pts = f"setpts=(PTS-STARTPTS)/{speed}"
    run(["ffmpeg", "-y", "-ss", f"{ss}", "-t", f"{dur * speed}", "-i", src,
         "-i", os.path.join(TMP, "mask.png"), "-i", os.path.join(TMP, "shadow.png"), "-filter_complex",
         f"[0:v]{pts},fps={FPS},split[a][b];"
         f"[a]scale={W}:{H},boxblur=40:2,eq=brightness=-0.12:saturation=1.15[bg];"
         f"[b]scale={IW}:{IH}[fg0];[fg0][1:v]alphamerge[fg];"
         f"[bg][2:v]overlay=0:0[bgs];[bgs][fg]overlay={IX}:{IY},format=yuv420p",
         "-t", f"{dur}", "-an", "-c:v", "libx264", "-crf", "17", out])

def still(img, dur, out):
    n = int(dur * FPS)
    run(["ffmpeg", "-y", "-loop", "1", "-i", img, "-vf",
         f"scale={W*2}:{H*2},zoompan=z='1+0.03*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS},format=yuv420p",
         "-frames:v", str(n), "-an", "-c:v", "libx264", "-crf", "17", out])

def caption(src, cap, out):
    # The card is one still image: loop it for the whole shot, or the overlay
    # holds its first frame — which the fade-in leaves fully transparent.
    run(["ffmpeg", "-y", "-i", src, "-loop", "1", "-i", cap, "-filter_complex",
         f"[1:v]format=rgba,fps={FPS},fade=t=in:st=0:d=0.25:alpha=1[c];[0:v][c]overlay=0:0:shortest=1,format=yuv420p",
         "-an", "-c:v", "libx264", "-crf", "17", out])

S = starts
def d(i): return round(S[i + 1] - S[i], 3)   # length of VO line i (0-based)
b1, stop, lake, dhaba, tea, convoy = (os.path.join(P, f) for f in
    ("broll1-riders.mp4", "broll-stop.mp4", "broll2-lake.mp4", "broll-dhaba.mp4", "broll3-tea.mp4", "broll-convoy.mp4"))
rec = lambda n: os.path.join(R, f"{n}.mp4")
end_at = 55.6   # end card lands on "Map ही feed है"

# (kind, src, in-point, seconds, caption)
SHOTS = [
    ("broll", b1, 0.0, 4.6, "t01"), ("broll", stop, 0.0, d(0) - 4.6, "t01"),
    ("app", rec("nav"), 0.3, d(1), "t02"),
    ("app", rec("nav"), 5.2, d(2), "t03"),
    ("app", rec("nav"), 10.4, d(3), "t04"),
    ("broll", stop, 2.2, 1.9, "t05"), ("app", rec("alert"), 0.55, d(4) - 1.9, "t05"),
    ("broll", lake, 0.8, d(5), "t06"),
    ("broll", dhaba, 0.4, 1.6, "t07"), ("app", rec("trip"), 1.7, d(6) - 1.6, "t07"),
    ("app", rec("invite"), 0.5, d(7), "t08"),
    ("app", rec("offline"), 1.8, d(8), "t09"),
    ("app", rec("discover"), 0.4, d(9), "t10"),
    ("broll", tea, 0.6, 1.3, "t11"), ("app", rec("post"), 1.4, d(10) - 1.3, "t11"),
    ("app", rec("post"), 6.2, d(11), "t12"),
    ("app", rec("map"), 0.8, d(12), "t13"),
    ("broll", convoy, 0.0, end_at - S[13], None),
    ("end", os.path.join(T, "endcard.png"), 0, 60.0 - end_at, None),
]

parts = []
for i, (kind, src, ss, dur, cap) in enumerate(SHOTS):
    raw, out = os.path.join(TMP, f"x{i:02d}-raw.mp4"), os.path.join(TMP, f"x{i:02d}.mp4")
    if kind == "broll": broll(src, ss, dur, raw)
    elif kind == "app": app(src, ss, dur, raw)
    else: still(src, dur, raw)
    if cap: caption(raw, os.path.join(T, f"{cap}.png"), out)
    else: os.replace(raw, out)
    parts.append(out)

lst = os.path.join(TMP, "list.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
video = os.path.join(TMP, "video.mp4")
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", video])

final = os.path.join(HERE, "trekov-ad-60s-vertical.mp4")
run(["ffmpeg", "-y", "-i", video, "-i", os.path.join(P, "music-60.mp3"), "-i", os.path.join(A, "vo-b.mp3"), "-filter_complex",
     "[2:a]volume=1.5,apad=pad_dur=3,asplit=2[vo][vo2];"
     "[1:a]volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st=57:d=3[mus];"
     "[mus][vo]sidechaincompress=threshold=0.04:ratio=7:attack=15:release=350[duck];"
     "[duck][vo2]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]",
     "-map", "0:v", "-map", "[a]", "-t", "60", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
     "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final])
print("built", final)
