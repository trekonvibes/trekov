"""Record the Chrome app window as video by grabbing window frames.

screencapture -l captures the window even when other windows cover it, which
screen recording cannot. ~12 fps; frames are timestamped so the clip keeps
real time. Crops to the phone-width app shell.

    python3 rec.py NAME SECONDS [WINDOW_ID] [crop x0,y0,x1,y1]
"""
import os, subprocess, sys, time, shutil

name, secs = sys.argv[1], float(sys.argv[2])
win = sys.argv[3] if len(sys.argv) > 3 else "2397"
crop = sys.argv[4] if len(sys.argv) > 4 else "165,286,951,1538"
HERE = os.path.dirname(os.path.abspath(__file__))
tmp = f"/private/tmp/claude-501/-Users-punit/d9491b78-997c-436f-975f-f7478e1793e5/scratchpad/rec-{name}"
shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
stamps = []
t0 = time.time()
while time.time() - t0 < secs:
    f = os.path.join(tmp, f"f{len(stamps):05d}.jpg")
    subprocess.run(["screencapture", "-o", "-x", "-l", win, "-t", "jpg", f], check=True)
    stamps.append(time.time() - t0)
# concat list with real durations, so playback runs at wall-clock speed
with open(os.path.join(tmp, "list.txt"), "w") as fh:
    for i, t in enumerate(stamps):
        d = (stamps[i + 1] - t) if i + 1 < len(stamps) else 1 / 12
        fh.write(f"file 'f{i:05d}.jpg'\nduration {d:.4f}\n")
    fh.write(f"file 'f{len(stamps)-1:05d}.jpg'\n")
x0, y0, x1, y1 = map(int, crop.split(","))
out = os.path.join(HERE, "assets", "rec", f"{name}.mp4")
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", os.path.join(tmp, "list.txt"),
                "-vf", f"crop={x1-x0}:{y1-y0}:{x0}:{y0},fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "16", out], check=True)
print(f"{name}: {len(stamps)} frames in {stamps[-1]:.1f}s ({len(stamps)/max(stamps[-1],0.1):.1f} fps) -> {out}")
