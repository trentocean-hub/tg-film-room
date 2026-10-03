#!/usr/bin/env python3
"""
TG Film Room: turn an iPad screen recording + a camera recording into one branded breakdown video.

What it does
  1. Finds the Sync mark beep in both recordings and lines them up.
  2. Finds the video area in the screen recording (the Sync mark flashes exactly that area).
  3. Lays out a 1920x1080 frame: you on the left, the whole film on the right, both with rounded corners,
     on the night ground with slowly drifting forest-glow nodes behind them.
  4. Adds the TG monogram, uses your camera's audio, evens out loudness, exports an MP4.

Needs only Python 3 and ffmpeg (brew install ffmpeg). No other packages.

Usage
  python3 make_video.py                       # uses the two videos in pipeline/input/
  python3 make_video.py --screen S.mov --camera C.mov -o output/breakdown.mp4
  python3 make_video.py --help                # all options
"""
import argparse
import array
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))

# Brand (Evergreen)
NIGHT = "0x0E1511"
GLOW_RGB = (140, 196, 164)

# Layout: margin, gap between the two panels, face-cam shape (width / height), corner radius
MARGIN, GAP, CAM_AR, RADIUS = 64, 40, 3 / 4, 18

OUT_W, OUT_H, OUT_FPS = 1920, 1080, 30
SYNC_SKIP = 0.5          # seconds after the beep where the final video starts (cuts the flash out)
BEEP_HZ = 1000.0
VIDEO_EXT = (".mov", ".mp4", ".m4v", ".mkv", ".webm")


def die(msg):
    print(f"\n  Stopped: {msg}\n", file=sys.stderr)
    sys.exit(1)


def run(cmd, binary=False):
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        die("ffmpeg failed:\n" + p.stderr.decode(errors="replace")[-1500:])
    return p.stdout if binary else p.stdout.decode()


def probe(path):
    out = json.loads(run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path]))
    v = next((s for s in out["streams"] if s["codec_type"] == "video"), None)
    if not v:
        die(f"{os.path.basename(path)} has no video track.")
    w, h = int(v["width"]), int(v["height"])
    rot = 0
    for sd in v.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(float(sd["rotation"]))
    rot = rot or int(v.get("tags", {}).get("rotate", 0) or 0)
    if abs(rot) % 180 == 90:
        w, h = h, w      # ffmpeg auto-rotates, so use the displayed size
    has_audio = any(s["codec_type"] == "audio" for s in out["streams"])
    return dict(w=w, h=h, dur=float(out["format"]["duration"]), audio=has_audio)


# ---------------------------------------------------------------- sync beep

def find_beep(path, start=0.0, span=120.0):
    """Time (s) of the first 1 kHz Sync mark beep, or None."""
    sr = 8000
    raw = run(["ffmpeg", "-v", "error", "-ss", str(start), "-t", str(span), "-i", path,
               "-vn", "-ac", "1", "-ar", str(sr), "-f", "s16le", "-"], binary=True)
    x = array.array("h"); x.frombytes(raw[: len(raw) // 2 * 2])
    if sys.byteorder == "big":
        x.byteswap()
    n, hop = 200, 80                      # 25 ms window, 10 ms hop
    k = 2 * math.cos(2 * math.pi * BEEP_HZ / sr)
    ratios, powers = [], []
    for i in range(0, len(x) - n, hop):
        s1 = s2 = 0.0; e = 0.0
        for j in range(i, i + n):
            v = x[j]; e += v * v
            s0 = v + k * s1 - s2; s2 = s1; s1 = s0
        p = s1 * s1 + s2 * s2 - k * s1 * s2          # Goertzel power at 1 kHz
        ratios.append(p / (e * n / 2) if e > 0 else 0.0)
        powers.append(p)
    if not powers:
        return None
    floor = sorted(powers)[len(powers) // 2] + 1.0
    run_len = 0
    for i, (r, p) in enumerate(zip(ratios, powers)):
        if r > 0.25 and p > 20 * floor:              # tone clearly above the room, and dominant in the window
            run_len += 1
            if run_len >= 5:                         # 50 ms of steady tone
                return start + (i - 4) * hop / sr
        else:
            run_len = 0
    return None


# ---------------------------------------------------------------- flash / video area

def gray_frames(path, start, dur, width, fps):
    info = probe(path)
    height = int(round(info["h"] * width / info["w"] / 2) * 2)
    raw = run(["ffmpeg", "-v", "error", "-ss", str(max(0, start)), "-t", str(dur), "-i", path,
               "-vf", f"fps={fps},scale={width}:{height},format=gray", "-f", "rawvideo", "-"], binary=True)
    size = width * height
    return [raw[i:i + size] for i in range(0, len(raw) - size + 1, size)], width, height


def find_flash(path, around):
    """Return (time, (x, y, w, h)) of the Sync mark flash in source pixels."""
    t0 = max(0.0, around - 1.0)
    frames, w, h = gray_frames(path, t0, 2.5, 160, 30)
    best, best_i = 0.0, None
    for i, f in enumerate(frames):
        frac = sum(1 for b in f if b > 200) / len(f)
        if frac > best:
            best, best_i = frac, i
    if best_i is None or best < 0.10:
        return None
    t = t0 + best_i / 30
    frames, w, h = gray_frames(path, t, 0.04, 640, 30)
    f = frames[0]
    cols = [sum(1 for y in range(h) if f[y * w + x] > 200) for x in range(w)]
    rows = [sum(1 for x in range(w) if f[y * w + x] > 200) for y in range(h)]

    def span(counts):
        m = max(counts); idx = [i for i, c in enumerate(counts) if c > 0.6 * m]
        return idx[0], idx[-1] + 1

    x0, x1 = span(cols); y0, y1 = span(rows)
    src = probe(path); sx = src["w"] / w; sy = src["h"] / h
    pad = 3  # stay inside the stage's hairline border
    x, y = int(x0 * sx) + pad, int(y0 * sy) + pad
    rw, rh = int((x1 - x0) * sx) - 2 * pad, int((y1 - y0) * sy) - 2 * pad
    return t, (x - x % 2, y - y % 2, rw - rw % 2, rh - rh % 2)


# ---------------------------------------------------------------- frame assets

def rounded_alpha(w, h, r):
    return (f"255*lte(hypot(max(max({r}-X\\,X-({w}-1-{r}))\\,0)\\,"
            f"max(max({r}-Y\\,Y-({h}-1-{r}))\\,0))\\,{r})")


def make_png(path, w, h, r, rgb=None):
    if rgb:
        src = f"color=c=black:s={w}x{h},format=rgba,geq=r={rgb[0]}:g={rgb[1]}:b={rgb[2]}:a='{rounded_alpha(w, h, r)}'"
    else:
        src = f"color=c=black:s={w}x{h},format=gray,geq=lum='{rounded_alpha(w, h, r)}'"
    run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", src, "-frames:v", "1", path])


# ---------------------------------------------------------------- background nodes

def make_nodes(path, w, h, seed, count, link, dot, dot_a, line_a):
    """Gray PGM of forest-glow nodes (dots joined by faint lines). Used as an alpha mask over the glow colour."""
    rnd = random.Random(seed)
    img = array.array("f", bytes(4 * w * h))

    def splat(x, y, a):
        ix, iy = int(x), int(y); fx, fy = x - ix, y - iy
        for dx, dy, k in ((0, 0, (1 - fx) * (1 - fy)), (1, 0, fx * (1 - fy)), (0, 1, (1 - fx) * fy), (1, 1, fx * fy)):
            px_, py_ = ix + dx, iy + dy
            if 0 <= px_ < w and 0 <= py_ < h:
                img[py_ * w + px_] += a * k

    pts = [(rnd.uniform(0, w), rnd.uniform(0, h), rnd.uniform(0.45, 1.0)) for _ in range(count)]
    for i, (x1, y1, _) in enumerate(pts):
        for x2, y2, _ in pts[i + 1:]:
            d = math.hypot(x2 - x1, y2 - y1)
            if d < link:
                a = line_a * (1 - d / link)
                for j in range(int(d) + 1):
                    t = j / max(1, d); splat(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, a)
    for x, y, k in pts:
        r = dot * k
        for yy in range(int(y - r - 2), int(y + r + 3)):
            for xx in range(int(x - r - 2), int(x + r + 3)):
                if 0 <= xx < w and 0 <= yy < h:
                    e = r + 0.5 - math.hypot(xx - x, yy - y)       # soft-edged disc
                    if e > 0:
                        img[yy * w + xx] += dot_a * k * min(1.0, e)
    with open(path, "wb") as f:
        f.write(b"P5\n%d %d\n255\n" % (w, h))
        f.write(bytes(min(255, int(v * 255)) for v in img))


# ---------------------------------------------------------------- main

def pick_inputs(folder):
    vids = [os.path.join(folder, f) for f in os.listdir(folder) if f.lower().endswith(VIDEO_EXT)]
    screen = [v for v in vids if any(k in os.path.basename(v).lower() for k in ("screenrecording", "rpreplay", "screen"))]
    if len(screen) != 1 or len(vids) != 2:
        die(f"Put exactly two videos in {folder}: the iPad screen recording (its name contains "
            f"'ScreenRecording' or 'screen') and the camera recording. Or pass --screen and --camera.")
    return screen[0], next(v for v in vids if v != screen[0])


def main():
    ap = argparse.ArgumentParser(description="Combine an iPad screen recording and a camera recording into a branded breakdown.")
    ap.add_argument("--screen", help="iPad screen recording of TG Film Room")
    ap.add_argument("--camera", help="camera recording of you")
    ap.add_argument("-o", "--out", help="output file (default: pipeline/output/<screen name>-edit.mp4)")
    ap.add_argument("--audio", choices=["camera", "screen"], default="camera", help="which recording's sound to use")
    ap.add_argument("--screen-sync", type=float, help="beep time in the screen recording, if it isn't found")
    ap.add_argument("--camera-sync", type=float, help="beep time in the camera recording, if it isn't found")
    ap.add_argument("--rect", help="video area in the screen recording as x,y,w,h, if it isn't found")
    ap.add_argument("--no-watermark", action="store_true", help="leave the TG monogram off")
    ap.add_argument("--no-border", action="store_true", help="no glow hairline around the face cam")
    ap.add_argument("--no-nodes", action="store_true", help="plain night background, no drifting nodes")
    ap.add_argument("--fast", action="store_true", help="use the Mac's hardware encoder (quicker, slightly bigger file)")
    ap.add_argument("--preview", type=float, metavar="SECONDS", help="only render the first N seconds, to check the look")
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        die("ffmpeg isn't installed. On a Mac run:  brew install ffmpeg")

    if not (a.screen and a.camera):
        a.screen, a.camera = pick_inputs(os.path.join(HERE, "input"))
    for p in (a.screen, a.camera):
        if not os.path.exists(p):
            die(f"Can't find {p}")

    scr, cam = probe(a.screen), probe(a.camera)
    print(f"Screen: {os.path.basename(a.screen)}  {scr['w']}x{scr['h']}  {scr['dur']:.1f}s")
    print(f"Camera: {os.path.basename(a.camera)}  {cam['w']}x{cam['h']}  {cam['dur']:.1f}s")

    print("Listening for the Sync mark beep...")
    s_sync = a.screen_sync if a.screen_sync is not None else find_beep(a.screen)
    c_sync = a.camera_sync if a.camera_sync is not None else find_beep(a.camera)

    flash = None
    if not a.rect:
        print("Looking for the Sync mark flash...")
        flash = find_flash(a.screen, s_sync if s_sync is not None else 2.0)
        if not flash and s_sync is None:
            # no beep heard: scan the first 2 minutes for the flash
            for t in range(1, 120, 2):
                flash = find_flash(a.screen, float(t))
                if flash:
                    break
    if s_sync is None and flash:
        s_sync = flash[0]
    if s_sync is None:
        die("Couldn't find the Sync mark in the screen recording. Tap Sync mark at the start of the take, "
            "or pass --screen-sync SECONDS.")
    if c_sync is None:
        die("Couldn't hear the Sync mark beep in the camera recording. Make sure the camera was rolling and the "
            "iPad volume was up, or pass --camera-sync SECONDS (the moment you tapped it).")

    if a.rect:
        rx, ry, rw, rh = (int(v) for v in a.rect.split(","))
    elif flash:
        rx, ry, rw, rh = flash[1]
    else:
        die("Couldn't find the video area. Pass --rect x,y,w,h.")

    print(f"Sync: screen {s_sync:.2f}s, camera {c_sync:.2f}s.  Video area: {rw}x{rh} at {rx},{ry}")

    s_start, c_start = s_sync + SYNC_SKIP, c_sync + SYNC_SKIP
    dur = min(scr["dur"] - s_start, cam["dur"] - c_start)
    if a.preview:
        dur = min(dur, a.preview)
    if dur <= 1:
        die("Less than a second of overlap after the Sync mark. Check you sent the right two files.")

    # Layout: camera panel (CAM_AR) on the left, the whole film on the right, same height, centred
    film_ar = rw / rh
    ph = int((OUT_W - 2 * MARGIN - GAP) / (CAM_AR + film_ar)) // 2 * 2
    ph = min(ph, OUT_H - 2 * MARGIN)
    fw, fh = int(ph * CAM_AR) // 2 * 2, ph                     # face cam
    sw, sh = int(ph * film_ar) // 2 * 2, ph                    # film
    total = fw + GAP + sw
    fx = (OUT_W - total) // 2 // 2 * 2
    sx = fx + fw + GAP
    fy = sy = (OUT_H - ph) // 2 // 2 * 2
    b = 0 if a.no_border else 3

    tmp = tempfile.mkdtemp(prefix="tgfilm-")
    cam_mask = os.path.join(tmp, "cam-mask.png"); make_png(cam_mask, fw, fh, RADIUS)
    film_mask = os.path.join(tmp, "film-mask.png"); make_png(film_mask, sw, sh, RADIUS)
    border = os.path.join(tmp, "border.png")
    if b:
        make_png(border, fw + 2 * b, fh + 2 * b, RADIUS + b, GLOW_RGB)

    # two node layers drifting at different speeds (far: small and dim, near: brighter, linked)
    layers = []
    if not a.no_nodes:
        print("Drawing the background nodes...")
        for name, amp, seed, count, link, dot, dot_a, line_a in (("far", 40, 7, 130, 170, 1.8, 0.50, 0.12),
                                                                 ("near", 90, 33, 50, 320, 3.4, 1.0, 0.32)):
            pth = os.path.join(tmp, name + ".pgm")
            make_nodes(pth, OUT_W + 2 * amp, OUT_H + 2 * amp, seed, count, link, dot, dot_a, line_a)
            layers.append((pth, amp))

    mono = os.path.join(HERE, "assets", "tg-monogram.png")
    use_mono = not a.no_watermark and os.path.exists(mono)

    out = a.out or os.path.join(HERE, "output", os.path.splitext(os.path.basename(a.screen))[0] + "-edit.mp4")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)

    cmd = ["ffmpeg", "-v", "error", "-stats", "-y",
           "-ss", f"{s_start:.3f}", "-i", a.screen,
           "-ss", f"{c_start:.3f}", "-i", a.camera,
           "-loop", "1", "-i", cam_mask, "-loop", "1", "-i", film_mask]
    idx = 4
    if b:
        cmd += ["-loop", "1", "-i", border]; bi = idx; idx += 1
    if use_mono:
        cmd += ["-loop", "1", "-i", mono]; mi = idx; idx += 1
    li = []
    for pth, _ in layers:
        cmd += ["-loop", "1", "-framerate", str(OUT_FPS), "-i", pth]; li.append(idx); idx += 1

    f = [f"color=c={NIGHT}:s={OUT_W}x{OUT_H}:r={OUT_FPS}[bg]"]
    last = "bg"
    for n, ((_, amp), i) in enumerate(zip(layers, li)):
        px_, py_ = (83, 107) if n == 0 else (59, 71)          # seconds per drift cycle (slow, never in step)
        f += [f"[{i}:v]crop={OUT_W}:{OUT_H}:x='{amp}+{amp}*sin(2*PI*t/{px_})':y='{amp}+{amp}*cos(2*PI*t/{py_})',format=gray[a{n}]",
              f"color=c=0x{GLOW_RGB[0]:02X}{GLOW_RGB[1]:02X}{GLOW_RGB[2]:02X}:s={OUT_W}x{OUT_H}:r={OUT_FPS},format=rgba[g{n}]",
              f"[g{n}][a{n}]alphamerge[n{n}]",
              f"[{last}][n{n}]overlay=0:0[l{n}]"]
        last = f"l{n}"
    cam_ar = fw / fh
    f += [
        f"[0:v]fps={OUT_FPS},crop={rw}:{rh}:{rx}:{ry},scale={sw}:{sh}:flags=lanczos,setsar=1,format=rgba[clipr]",
        "[3:v]format=gray[fm]",
        "[clipr][fm]alphamerge[clip]",
        # camera: centre-crop to the panel's shape, scale, round the corners
        f"[1:v]fps={OUT_FPS},crop='min(iw\\,ih*{cam_ar:.5f})':'min(ih\\,iw/{cam_ar:.5f})',scale={fw}:{fh}:flags=lanczos,setsar=1,format=rgba[camr]",
        "[2:v]format=gray[m]",
        "[camr][m]alphamerge[cam]",
        f"[{last}][clip]overlay={sx}:{sy}:shortest=1[v0]",
    ]
    last = "v0"
    if b:
        f.append(f"[{last}][{bi}:v]overlay={fx - b}:{fy - b}[v1]"); last = "v1"
    f.append(f"[{last}][cam]overlay={fx}:{fy}:shortest=1[v2]"); last = "v2"
    if use_mono:
        mh = 48
        f.append(f"[{mi}:v]scale=-2:{mh}[mono]")
        f.append(f"[{last}][mono]overlay={fx}:{(fy - mh) // 2}[v3]"); last = "v3"
    f.append(f"[{last}]format=yuv420p[vout]")

    a_src = "1:a" if a.audio == "camera" else "0:a"
    has = cam["audio"] if a.audio == "camera" else scr["audio"]
    if has:
        f.append(f"[{a_src}]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11[aout]")

    cmd += ["-filter_complex", ";".join(f), "-map", "[vout]"]
    if has:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"]
    if a.fast:
        cmd += ["-c:v", "h264_videotoolbox", "-b:v", "12M"]
    else:
        cmd += ["-c:v", "libx264", "-preset", "medium", "-crf", "18"]
    cmd += ["-t", f"{dur:.3f}", "-r", str(OUT_FPS), "-movflags", "+faststart", out]

    print(f"Rendering {dur:.1f}s to {out} ...")
    p = subprocess.run(cmd)
    shutil.rmtree(tmp, ignore_errors=True)
    if p.returncode != 0:
        die("ffmpeg couldn't render the video (see the messages above).")

    report = dict(screen=a.screen, camera=a.camera, screen_sync=round(s_sync, 3), camera_sync=round(c_sync, 3),
                  rect=[rx, ry, rw, rh], duration=round(dur, 2), facecam=[fx, fy, fw, fh], film=[sx, sy, sw, sh])
    with open(os.path.splitext(out)[0] + ".json", "w") as fh_:
        json.dump(report, fh_, indent=2)
    print(f"\nDone: {out}")


if __name__ == "__main__":
    main()
