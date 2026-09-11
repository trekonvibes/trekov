# Builds a synced cut of the Trekov ad from one voice clip per line
# (assets/lines/Lxx.mp3). Every scene lasts exactly as long as its line plus a
# short breath, and the line starts when the scene does — so picture and voice
# can't drift apart.  Run: python3 build_cut.py 60   (or 30)
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, "assets"); P = os.path.join(A, "prep"); R = os.path.join(A, "rec"); T = os.path.join(A, "text"); L = os.path.join(A, "lines")
CUT = sys.argv[1] if len(sys.argv) > 1 else "60"
TMP = os.path.join(A, f"build{CUT}"); os.makedirs(TMP, exist_ok=True)
W, H, FPS = 1080, 1920, 30
LEAD, BREATH = 0.08, 0.22          # voice starts 0.08 s into its scene; 0.22 s of air after
END_MIN = 1.2                      # end card holds at least this long after the last word
def run(cmd): subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
def dur(f): return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], capture_output=True, text=True).stdout)

b1, stop, lake, dhaba, tea, convoy = (os.path.join(P, f) for f in
    ("broll1-riders.mp4", "broll-stop.mp4", "broll2-lake.mp4", "broll-dhaba.mp4", "broll3-tea.mp4", "broll-convoy.mp4"))
rec = lambda n: os.path.join(R, f"{n}.mp4")
END = ("end", os.path.join(T, "endcard.png"), 0)

# line -> (shots, caption). A shot is (kind, src, in-point[, fixed seconds]);
# the last shot of a scene takes whatever time the line leaves.
SCENES = {
    "L01": ([("broll", b1, 0.0, 4.0), ("broll", stop, 0.0)], "t01"),
    "L02": ([("app", rec("nav"), 0.3)], "t02"),
    "L03": ([("app", rec("nav"), 5.2)], "t03"),
    "L04": ([("app", rec("nav"), 10.2)], "t04"),
    "L05": ([("broll", stop, 2.2, 1.8), ("app", rec("alert"), 0.5)], "t05"),
    "L06": ([("broll", lake, 0.8)], "t06"),
    "L07": ([("broll", dhaba, 0.4, 1.5), ("app", rec("trip"), 1.7)], "t07"),
    "L08": ([("app", rec("invite"), 0.5)], "t08"),
    "L09": ([("app", rec("offline"), 1.6)], "t09"),
    "L10": ([("app", rec("discover"), 0.4)], "t10"),
    # live camera, then straight to "Location confirmed" — skipping the shutter's black flash (2.77–3.07 s)
    "L11": ([("broll", tea, 0.6, 1.2), ("app", rec("post"), 1.05, 1.7), ("app", rec("post"), 3.1)], "t11"),
    "L12": ([("app", rec("post"), 6.2)], "t12"),
    "L13": ([("app", rec("map"), 0.8)], "t13"),
    "L14": ([("broll", convoy, 0.0, 1.1), END], None),
    "H30": ([("broll", b1, 0.2)], "t01"),
    "HOOK": ([("broll", b1, 0.0)], "t01"),   # music only, no voice
}
FIXED = {"HOOK": 2.5}                       # scenes without a voice line
ORDER = {"60": [f"L{i:02d}" for i in range(1, 15)],
         "30": ["HOOK", "L02", "L05", "L07", "L11", "L14"]}[CUT]
TARGET = float(CUT)

# Inset for app recordings: 84% size, rounded corners, soft shadow.
IW, IH = int(W * 0.84) // 2 * 2, int(H * 0.84) // 2 * 2
IX, IY = (W - IW) // 2, 292
mask = Image.new("L", (IW, IH), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, IW - 1, IH - 1], radius=54, fill=255)
mask.save(os.path.join(TMP, "mask.png"))
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle([IX + 6, IY + 26, IX + IW + 6, IY + IH + 26], radius=60, fill=(0, 0, 0, 170))
sh.filter(ImageFilter.GaussianBlur(28)).save(os.path.join(TMP, "shadow.png"))
HOLD = "tpad=stop_mode=clone:stop_duration=8"   # if a clip runs out, hold its last frame rather than end early

def broll(src, ss, d, out):
    run(["ffmpeg", "-y", "-ss", f"{ss}", "-i", src, "-vf",
         f"{HOLD},scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},zoompan=z='min(1.0+0.0009*on,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={FPS},format=yuv420p",
         "-t", f"{d:.3f}", "-an", "-c:v", "libx264", "-crf", "17", out])

def app(src, ss, d, out):
    run(["ffmpeg", "-y", "-ss", f"{ss}", "-i", src, "-i", os.path.join(TMP, "mask.png"), "-i", os.path.join(TMP, "shadow.png"), "-filter_complex",
         f"[0:v]{HOLD},setpts=PTS-STARTPTS,fps={FPS},split[a][b];"
         f"[a]scale={W}:{H},boxblur=40:2,eq=brightness=-0.12:saturation=1.15[bg];"
         f"[b]scale={IW}:{IH}[fg0];[fg0][1:v]alphamerge[fg];[bg][2:v]overlay=0:0[bgs];[bgs][fg]overlay={IX}:{IY},format=yuv420p",
         "-t", f"{d:.3f}", "-an", "-c:v", "libx264", "-crf", "17", out])

def still(img, d, out):
    n = max(1, round(d * FPS))
    run(["ffmpeg", "-y", "-loop", "1", "-i", img, "-vf",
         f"scale={W*2}:{H*2},zoompan=z='1+0.03*on/{n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={n}:s={W}x{H}:fps={FPS},format=yuv420p",
         "-frames:v", str(n), "-an", "-c:v", "libx264", "-crf", "17", out])

def caption(src, cap, out):
    run(["ffmpeg", "-y", "-i", src, "-loop", "1", "-i", cap, "-filter_complex",
         f"[1:v]format=rgba,fps={FPS},fade=t=in:st=0:d=0.25:alpha=1[c];[0:v][c]overlay=0:0:shortest=1,format=yuv420p",
         "-an", "-c:v", "libx264", "-crf", "17", out])

# Each line trimmed of the silence the voice model pads it with, then — only if
# the cut would still overrun — sped up just enough (pitch kept, capped 1.15x).
def trim(src, out, tempo):
    run(["ffmpeg", "-y", "-i", src, "-af",
         "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,"
         "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse,"
         f"atempo={tempo:.4f},aresample=44100", out])
voiced = [k for k in ORDER if k not in FIXED]
PROC = os.path.join(TMP, "lines"); os.makedirs(PROC, exist_ok=True)
lines = {k: os.path.join(PROC, f"{k}.wav") for k in voiced}
for k in voiced: trim(os.path.join(L, f"{k}.mp3"), lines[k], 1.0)
speech = sum(dur(lines[k]) for k in voiced)
room = TARGET - sum(FIXED.get(k, 0) for k in ORDER) - len(voiced) * (LEAD + BREATH) - END_MIN
tempo = max(1.0, speech / room)
if tempo > 1.15: sys.exit(f"voice needs {tempo:.2f}x to fit {TARGET:.0f}s — drop a line")
if tempo > 1.0:
    for k in voiced: trim(os.path.join(L, f"{k}.mp3"), lines[k], tempo)
need = {k: FIXED[k] if k in FIXED else LEAD + dur(lines[k]) + BREATH for k in ORDER}
spare = TARGET - sum(need.values())
need[ORDER[-1]] += spare
print(f"{CUT}s cut: speech {speech:.2f}s at {tempo:.3f}x, end card gets +{spare:.2f}s")

parts, t, marks = [], 0.0, []
for k in ORDER:
    shots, cap = SCENES[k]; total = round(need[k] * FPS) / FPS
    fixed = sum(s[3] for s in shots[:-1] if len(s) > 3)
    marks.append((k, t))
    for j, s in enumerate(shots):
        kind, src, ss = s[:3]
        d = s[3] if j < len(shots) - 1 else total - fixed
        raw, out = os.path.join(TMP, f"{k}-{j}-raw.mp4"), os.path.join(TMP, f"{k}-{j}.mp4")
        (broll if kind == "broll" else app if kind == "app" else still)(src, ss, d, raw) if kind != "end" else still(src, d, raw)
        if cap: caption(raw, os.path.join(T, f"{cap}.png"), out)
        else: os.replace(raw, out)
        parts.append(out)
    t += total

lst = os.path.join(TMP, "list.txt"); open(lst, "w").write("".join(f"file '{p}'\n" for p in parts))
video = os.path.join(TMP, "video.mp4")
run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", video])

# Voice: each line placed at its scene's start, then mixed over ducked music.
inputs, chains = [], []
voiced_marks = [(k, st) for k, st in marks if k in lines]
for i, (k, st) in enumerate(voiced_marks):
    inputs += ["-i", lines[k]]
    ms = int((st + LEAD) * 1000)
    chains.append(f"[{i + 2}:a]aresample=44100,adelay={ms}|{ms}[l{i}]")
n = len(voiced_marks)
fc = ";".join(chains) + ";" + "".join(f"[l{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0:duration=longest,volume=1.5,apad=whole_dur={TARGET},asplit=2[vo][vo2];" \
     f"[1:a]volume=0.5,afade=t=in:st=0:d=0.5,afade=t=out:st={TARGET - 3}:d=3[mus];" \
     "[mus][vo]sidechaincompress=threshold=0.04:ratio=7:attack=15:release=350[duck];" \
     "[duck][vo2]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.0:LRA=7[a]"
final = os.path.join(HERE, f"trekov-ad-{CUT}s-vertical.mp4")
run(["ffmpeg", "-y", "-i", video, "-i", os.path.join(P, "music-60.mp3"), *inputs, "-filter_complex", fc,
     "-map", "0:v", "-map", "[a]", "-t", f"{TARGET}", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
     "-maxrate", "4500k", "-bufsize", "9000k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", final])
json.dump(marks, open(os.path.join(TMP, "marks.json"), "w"))
print("built", final, "| scene starts:", ", ".join(f"{k}@{s:.2f}" for k, s in marks))
