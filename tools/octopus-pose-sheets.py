"""Game sheets for the octopus poses made with Gemini in Antigravity (ocean-style-prototypes/gemini-octopus-poses), for the
ocean show (ui/job/ocean-show.mjs). Each pose: magenta keyed out, the whole 1024 px image scaled to the 128 px cell (so every
pose keeps the reference's body size and position), mapped to the colours of the existing octopus sheet, then a 14-frame
procedural ripple. Writes ui/abyss/pixel/creatures/octopus-<pose>-pose-spritesheet.png, anchor points in
ui/abyss/pixel/creatures/octopus-poses.json, and provenance entries.

  python tools/octopus-pose-sheets.py
"""
import datetime
import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "ocean-style-prototypes/gemini-octopus-poses"
CREATURES = ROOT / "ui/abyss/pixel/creatures"
REFERENCE = CREATURES / "octopus-sunlight-spritesheet.png"
spec = importlib.util.spec_from_file_location("det", Path(__file__).with_name("retrodiffusion-detonation-set.py"))
det = importlib.util.module_from_spec(spec)
spec.loader.exec_module(det)

CELL, FRAMES = 128, det.FRAMES
# Pose -> accepted file (checked by eye: eight arms, pose readable, matches the reference) and its motion.
PICKS = {
    "swim": ("swim-attempt-1.jpg", "swim"),
    "reach": ("reach-attempt-1.png", "ring"),
    "carry": ("carry-attempt-1.png", "ring"),
    "pry": ("pry-attempt-1.png", "ring"),
    "type": ("type-attempt-1.png", "ring"),
    "wave": ("wave-attempt-2.png", "ring"),
    # In-between frames, played in sequence so the arms visibly extend (ui/job/ocean-show.mjs: SEQ).
    "reach-mid": ("reach-mid-attempt-1.png", "ring"),
    "down-mid": ("down-mid-attempt-4.png", "ring"),
    "down-far": ("down-far-attempt-1.png", "ring"),
    "lift": ("lift-attempt-1.png", "ring"),
    "push": ("push-attempt-1.png", "ring"),
    "dip-far": ("dip-far-attempt-1.png", "ring"),  # two arms scoop down (asked for one); no dip-mid passed review
}
STILL = {"swim"}  # side-on: no mantle to register against the top-down idle sheet


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def reference_palette():
    sheet = Image.open(REFERENCE).convert("RGBA")
    colours = sorted({p[:3] for p in sheet.get_flattened_data() if p[3] >= 128})
    pal = Image.new("P", (1, 1))
    flat = [c for rgb in colours for c in rgb]
    pal.putpalette(flat + flat[-3:] * (256 - len(colours)))
    return pal, len(colours)


def keyed(path):
    """Magenta background out; returns RGBA at the source size."""
    arr = np.asarray(Image.open(path).convert("RGB")).astype(int)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    background = (r - g > 90) & (b - g > 90)
    alpha = np.where(background, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr.astype(np.uint8), alpha]), "RGBA")


def to_cell(img, pal):
    """Box-filter the whole square image to 128 px, keep pixels at least half covered, snap to the reference colours."""
    small = img.resize((CELL, CELL), Image.Resampling.BOX)
    alpha = small.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    arr = np.asarray(small).astype(float)
    a = arr[..., 3:4] / 255
    rgb = np.where(a > 0, arr[..., :3] / np.maximum(a, 1e-6), 0).clip(0, 255).astype(np.uint8)  # un-premultiply the edge mix
    snapped = Image.fromarray(rgb, "RGB").quantize(palette=pal, dither=Image.Dither.NONE).convert("RGBA")
    snapped.putalpha(alpha)
    return snapped


def keep_paper(img_cell, source):
    """The carried document is not in the octopus palette: put its own colours back (near-white, grey, yellow)."""
    small = source.resize((CELL, CELL), Image.Resampling.BOX).convert("RGBA")
    a, s = np.asarray(img_cell).copy(), np.asarray(small)
    r, g, b = s[..., 0].astype(int), s[..., 1].astype(int), s[..., 2].astype(int)
    paper = (s[..., 3] >= 128) & (((r > 200) & (g > 200) & (b > 200)) | ((r > 200) & (g > 170) & (b < 140)) | ((abs(r - g) < 14) & (abs(g - b) < 14) & (r > 120)))
    a[paper, :3] = s[paper, :3]
    return Image.fromarray(a, "RGBA"), paper


def register(cell, ref, source=None, pal=None):
    """Scale and shift the pose so its mantle sits on the idle sheet's mantle: frames then differ only in their arms.
    Generators frame the character slightly differently, so the scale is searched too (re-cut from the source)."""
    r = np.asarray(ref).astype(float)
    win = (slice(40, 76), slice(46, 82))  # the mantle in the 128 px cell

    def score(c):
        a = np.asarray(c).astype(float)
        return min((((np.roll(a, (dy, dx), (0, 1))[win] - r[win]) ** 2).sum(), dy, dx) for dy in range(-8, 9) for dx in range(-8, 9))

    best = (*score(cell), 1.0, cell)
    if source is not None:
        for k in np.arange(0.80, 1.26, 0.04):
            side = round(source.width / k)
            canvas = Image.new("RGBA", (side, side))
            canvas.alpha_composite(source, ((side - source.width) // 2, (side - source.height) // 2)) if side >= source.width                 else canvas.alpha_composite(source.crop(((source.width - side) // 2, (source.height - side) // 2, (source.width + side) // 2, (source.height + side) // 2)))
            c = to_cell(canvas, pal)
            sc = score(c)
            if sc[0] < best[0]:
                best = (*sc, float(k), c)
    _, dy, dx, k, cell = best
    out = Image.new("RGBA", (CELL, CELL))
    out.paste(cell, (dx, dy), cell)
    return out, (dx, dy), k


def frames_for(cell, motion):
    padded = Image.new("RGBA", (CELL + 32, CELL + 32))
    padded.alpha_composite(cell, (16, 16))
    box = det.opaque_box(padded)
    step = det.swim(box, 2.0, waves=0.9, power=1.4) if motion == "swim" else det.ring(box, 1.4, 8)
    out = []
    for i in range(FRAMES):
        frame = step(padded, 2 * math.pi * i / FRAMES)
        out.append(frame.crop((16, 16, 16 + CELL, 16 + CELL)))
    return out


def anchors(cell, paper_mask, idle=None):
    a = np.asarray(cell)[..., 3] > 0
    ys, xs = np.nonzero(a)
    left = xs.min(); bottom = ys.max(); right = xs.max(); top = ys.min()
    points = {
        "left": [int(left), float(ys[xs == left].mean())],
        "right": [int(right), float(ys[xs == right].mean())],
        "top": [float(xs[ys == top].mean()), int(top)],
        "bottom": [float(xs[ys == bottom].mean()), int(bottom)],
    }
    if idle is not None:
        # The moving arm's tip: of the pixels this pose adds to the idle frame, the one farthest from the mantle centre.
        new = a & ~(np.asarray(idle)[..., 3] > 0)
        ny, nx = np.nonzero(new)
        if len(nx):
            far = np.argmax((nx - 64.0) ** 2 + (ny - 58.0) ** 2)
            points["tip"] = [float(nx[far]), float(ny[far])]
    if paper_mask is not None and paper_mask.any():
        py, px = np.nonzero(paper_mask)
        points["paper"] = [float(px.mean()), float(py.mean())]
    return {k: [round(v[0], 1), round(v[1], 1)] for k, v in points.items()}


def main():
    pal, ncol = reference_palette()
    print(f"reference palette: {ncol} colours")
    idle0 = Image.open(REFERENCE).convert("RGBA").crop((0, 0, CELL, CELL))
    poses = {"idle": {"sheet": "/ui/abyss/pixel/creatures/octopus-sunlight-spritesheet.png", "anchors": {}}}
    prov_path = ROOT / "ui/abyss/pixel/provenance.json"
    prov = json.loads(prov_path.read_text(encoding="utf-8"))
    report = {e["file"]: e for e in json.loads((SRC / "antigravity-report.json").read_text(encoding="utf-8")) if isinstance(e, dict) and "file" in e} \
        if isinstance(json.loads((SRC / "antigravity-report.json").read_text(encoding="utf-8")), list) else {}
    api = {e["file"]: e for e in json.loads((SRC / "generation-report.json").read_text(encoding="utf-8"))["outputs"]}
    for pose, (name, motion) in PICKS.items():
        if not (SRC / name).exists():
            print(f"skip {pose}: {name} not generated yet")
            continue
        source = keyed(SRC / name)
        cell = to_cell(source, pal)
        paper = None
        if pose.startswith("carry"):
            cell, paper = keep_paper(cell, source)
        if pose not in STILL:
            cell, shift, k = register(cell, idle0, None if paper is not None else source, pal)
            if paper is not None:
                paper = np.roll(paper, (shift[1], shift[0]), (0, 1))
            print(f"{pose}: mantle shift {shift} scale {k:.2f}")
        frames = frames_for(cell, motion)
        sheet = Image.new("RGBA", (CELL * FRAMES, CELL))
        for i, frame in enumerate(frames):
            sheet.alpha_composite(frame, (i * CELL, 0))
        out = CREATURES / f"octopus-{pose}-pose-spritesheet.png"
        sheet.save(out)
        poses[pose] = {"sheet": f"/{out.relative_to(ROOT).as_posix()}", "anchors": anchors(cell, paper, idle0 if pose not in STILL else None)}
        meta = api.get(name) or report.get(name) or {}
        via = ("Gemini gemini-3-pro-image via the Gemini API" if name in api
               else "Codex built-in image generation (ChatGPT authentication)" if "/codex/" in str(name).replace("\\", "/")
               else "Gemini (gemini-3.8-flash agent) image generation via Antigravity ACP in Pi")
        entry = {
            "output": out.relative_to(ROOT).as_posix(), "output_sha256": sha(out),
            "source": (SRC / name).relative_to(ROOT).as_posix(), "source_sha256": sha(SRC / name),
            "reference": REFERENCE.relative_to(ROOT).as_posix(),
            "prompt": meta.get("prompt") or meta.get("exact_prompt") or "see antigravity-brief.txt",
            "model": f"{via}; edit of the reference frame on magenta",
            "transform": f"magenta keyed, box-filtered to {CELL} px, snapped to the {ncol} colours of the reference sheet, "
                         f"14-frame procedural {'swim wave' if motion == 'swim' else 'radial arm ripple'}",
            "licence": "OpenAI generated output; no CC0 claim" if via.startswith("Codex") else "Google generative AI output; no CC0 claim",
            "date": meta.get("date") or datetime.date.today().isoformat(),
        }
        prov["files"] = [f for f in prov["files"] if f["output"] != entry["output"]] + [entry]
        print(f"WROTE {out.name} anchors {poses[pose]['anchors']}")
    (CREATURES / "octopus-poses.json").write_text(json.dumps({"cell": CELL, "frames": FRAMES, "poses": poses}, indent=2) + "\n", encoding="utf-8")
    prov_path.write_text(json.dumps(prov, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
