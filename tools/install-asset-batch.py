"""Install the reviewed Codex / Antigravity asset batch (ocean-style-prototypes/asset-batch/selection.json) as game art:

- 13 depth creatures -> ui/abyss/pixel/creatures/<slug>-spritesheet.png (14 x 128 px, procedural swim, facing left)
- 4 Trench eye sets  -> ui/abyss/pixel/creatures/eyes-<slug>-spritesheet.png (14 x 128 px, glow pulse and one blink)
- 3 food marks       -> ui/abyss/pixel/marks/mark-<depth>.png (48 px)
- 15 one-arm octopus poses -> octopus-<pose>-pose-spritesheet.png + octopus-poses.json, via tools/octopus-pose-sheets.py

Every output gets a provenance entry. Run: python tools/install-asset-batch.py   (or `... marks` for the stamps only:
tools/install-front-batch.py later replaced some creature sheets, which a full rerun would undo)
"""
import datetime
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BATCH = ROOT / "ocean-style-prototypes/asset-batch"
CREATURES = ROOT / "ui/abyss/pixel/creatures"
MARKS = ROOT / "ui/abyss/pixel/marks"


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), Path(__file__).with_name(f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


det = load("retrodiffusion-detonation-set")
poses = load("octopus-pose-sheets")
FRAMES, CELL = det.FRAMES, 128

# slug -> (selection key, motion). Motion "swim" = tail-ward body wave; "ring" = ripple round the body (hydra, squid).
CREATURE_SLUGS = {
    "black-swallower": "swim", "megamouth-shark": "swim", "barreleye": "swim", "telescopefish": "swim", "cuckoo-wrasse": "swim",
    "tripod-fish": "swim", "hatchetfish": "swim", "lanternfish": "swim", "sea-lamprey": "swim", "gulper-eel": "swim",
    "leviathan": "ring", "hydra": "ring", "giant-squid": "swim",
}
MIRROR = {"leviathan", "giant-squid"}  # leviathan: the RetroDiffusion still faces right; squid: mantle-first means swimming right
EYES = ["jormungandr", "kraken", "leviathan", "hydra"]
MARK_DEPTHS = ["midnight", "abyss", "trench"]
# The site's tier palette (retro-pixel.css --t3..--t1); stamps are recoloured onto it, keeping their own light and dark.
TIER = {"midnight": (0xff, 0xd1, 0x66), "abyss": (0xff, 0x9a, 0x5a), "trench": (0xff, 0x4f, 0x6d)}
OCTOPUS = ["reach1-left-mid", "reach1-left-far", "reach1-upleft-mid", "reach1-upleft-far", "reach1-up-mid", "reach1-up-far",
           "reach1-downleft-mid", "reach1-downleft-far", "reach1-down-mid", "reach1-down-far", "carry1", "dip1-mid", "dip1-far",
           "type1", "guide1"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def rel(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def keyed(path):
    """RGBA with the background removed: real alpha is kept; a solid magenta or near-white backdrop is keyed out."""
    img = Image.open(path).convert("RGBA")
    a = np.asarray(img).copy()
    rgb = a[..., :3].astype(int)
    if a[..., 3].min() == 255:
        corner = rgb[3, 3]
        a[np.abs(rgb - corner).sum(-1) < 70, 3] = 0
        a[(rgb[..., 0] - rgb[..., 1] > 90) & (rgb[..., 2] - rgb[..., 1] > 90), 3] = 0
    return Image.fromarray(a)


def fit(img, size, colours=24):
    """Crop to the art, box-filter so the longer side is `size`, hard alpha, quantise; centred in a CELL square."""
    box = img.getchannel("A").point(lambda v: 255 if v >= 64 else 0).getbbox()
    art = img.crop(box)
    k = size / max(art.size)
    art = art.resize((max(1, round(art.width * k)), max(1, round(art.height * k))), Image.Resampling.BOX)
    alpha = art.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
    arr = np.asarray(art).astype(float)
    a = arr[..., 3:4] / 255
    rgb = np.where(a > 0, arr[..., :3] / np.maximum(a, 1e-6), 0).clip(0, 255).astype(np.uint8)
    q = Image.fromarray(rgb, "RGB").quantize(colors=colours, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    q.putalpha(alpha)
    cell = Image.new("RGBA", (CELL, CELL))
    cell.alpha_composite(q, ((CELL - q.width) // 2, (CELL - q.height) // 2))
    return cell


def tint(img, rgb):
    """Map each pixel's lightness onto `rgb`: dark outline stays dark, highlights go toward white."""
    a = np.asarray(img).astype(float)
    lum = (0.3 * a[..., 0] + 0.59 * a[..., 1] + 0.11 * a[..., 2]) / 255
    lum = lum / max(1e-6, lum[a[..., 3] > 0].max()) if (a[..., 3] > 0).any() else lum
    col = np.array(rgb, float)
    out = np.where(lum[..., None] < 0.75, col * (lum[..., None] / 0.75), col + (255 - col) * ((lum[..., None] - 0.75) / 0.25))
    a[..., :3] = out.clip(0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def sheet_of(frames):
    out = Image.new("RGBA", (CELL * FRAMES, CELL))
    for i, f in enumerate(frames):
        out.alpha_composite(f, (i * CELL, 0))
    return out


def animate(cell, motion):
    pad = Image.new("RGBA", (CELL + 32, CELL + 32))
    pad.alpha_composite(cell, (16, 16))
    box = det.opaque_box(pad)
    step = det.swim(box, 2.4, waves=0.9, power=1.5, fins=0.6) if motion == "swim" else det.ring(box, 1.6, 6)
    return [step(pad, 2 * math.pi * i / FRAMES).crop((16, 16, 16 + CELL, 16 + CELL)) for i in range(FRAMES)]


def eye_frames(cell):
    """Glow pulse (brightness of the warm eye pixels) and one blink at frames 9-10 (eye rows squashed)."""
    arr = np.asarray(cell).astype(float)
    rgb = arr[..., :3]
    warm = (rgb[..., 0] > 150) & (rgb[..., 0] > rgb[..., 2] + 40) & (arr[..., 3] > 0)
    ys = np.nonzero(warm)[0]
    eye_mid = ys.mean() if len(ys) else CELL / 2
    frames = []
    for i in range(FRAMES):
        glow = 0.75 + 0.25 * math.sin(2 * math.pi * i / FRAMES)
        f = arr.copy()
        f[warm, :3] = (rgb[warm] * glow).clip(0, 255)
        if i in (9, 10):  # blink: hide warm pixels farther than 1-2 rows from the eye line
            band = np.abs(np.arange(CELL)[:, None] - eye_mid) > (1 if i == 9 else 2.5)
            f[warm & band, 3] = 0
        frames.append(Image.fromarray(f.astype(np.uint8), "RGBA"))
    return frames


def main():
    sel = json.loads((BATCH / "selection.json").read_text(encoding="utf-8"))
    picks = {k: BATCH / v["file"] for k, v in sel["picks"].items()}
    picks.update({k: (BATCH / v).resolve() for k, v in sel["reused_from_comparison"].items()})
    gen = {k: v["generator"] for k, v in sel["picks"].items()}
    gen.update({"barreleye": "codex", "tripod-fish": "codex", "leviathan": "retrodiffusion"})
    model = {"codex": "Codex built-in image generation (ChatGPT authentication)",
             "antigravity": "Gemini (gemini-3.8-flash agent) image generation via Antigravity ACP in Pi",
             "retrodiffusion": "RetroDiffusion rd_plus__retro text-to-image ($0.06)"}
    licence = {"codex": "OpenAI generated output; no CC0 claim", "antigravity": "Google generative AI output; no CC0 claim",
               "retrodiffusion": "provider terms apply, no CC0 claim"}
    brief = {"codex": "ocean-style-prototypes/asset-batch/brief-a-creatures.txt", "antigravity": "ocean-style-prototypes/asset-batch/brief-a-creatures.txt",
             "retrodiffusion": "ocean-style-prototypes/image-gen-comparison/prompts.txt"}
    today = datetime.date.today().isoformat()
    prov_path = ROOT / "ui/abyss/pixel/provenance.json"
    prov = json.loads(prov_path.read_text(encoding="utf-8"))
    entries = []

    def record(out, key, transform, prompt=None):
        src = picks[key]
        g = gen[key]
        entries.append({"output": rel(out), "output_sha256": sha(out), "source": rel(src), "source_sha256": sha(src),
                        "prompt": prompt or f"see {brief[g]} (target {key})", "model": model[g], "transform": transform,
                        "licence": licence[g], "date": today})
        print("WROTE", rel(out), flush=True)

    marks_only = sys.argv[1:] == ["marks"]
    for slug, motion in ({} if marks_only else CREATURE_SLUGS).items():
        img = keyed(picks[slug])
        if slug in MIRROR:
            img = img.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        out = CREATURES / f"{slug}-spritesheet.png"
        sheet_of(animate(fit(img, 96), motion)).save(out)
        record(out, slug, f"background keyed{', mirrored to face left' if slug in MIRROR else ''}, fitted to 96 px in a 128 px cell, "
                          f"24 colours, 14-frame procedural {'swim wave' if motion == 'swim' else 'body ripple'}")

    for slug in ([] if marks_only else EYES):
        key = f"eyes-{slug}"
        out = CREATURES / f"eyes-{slug}-spritesheet.png"
        sheet_of(eye_frames(fit(keyed(picks[key]), 100, colours=20))).save(out)
        record(out, key, "fitted to 100 px in a 128 px cell, 20 colours, 14-frame procedural glow pulse with one blink")

    MARKS.mkdir(parents=True, exist_ok=True)
    for depth in MARK_DEPTHS:
        key = f"mark-{depth}"
        img = tint(fit(keyed(picks[key]), 44, colours=16).crop((42, 42, 86, 86)), TIER[depth])
        out = MARKS / f"mark-{depth}.png"
        img.save(out)
        record(out, key, f"fitted to 44 px, 16 colours, hard alpha, lightness mapped onto the site's {depth} colour")

    other = {e["output"] for e in entries}
    prov["files"] = [f for f in prov["files"] if f["output"] not in other] + entries
    prov_path.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if marks_only:
        return
    # One-arm octopus poses go through the pose pipeline (mantle registration, reference palette, anchors).
    for pose in OCTOPUS:
        poses.PICKS[pose] = (str(picks[pose]), "ring")
    poses.main()


if __name__ == "__main__":
    main()
