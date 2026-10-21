"""Detonation Ocean hackathon sprites (R-L3): five finding creatures, the giant clam and twelve fish.

Same model parameters as the existing creature sheets: an rd_plus__retro still (as in retrodiffusion-menu-legend.py),
then a provider-native rd_advanced_animation__custom_action loop of that still (as in retrodiffusion-creature-animation.py),
exported to a 14-frame sheet (8 native poses played forward then back). Creatures: 128 px cell, art fills 96 px.
Fish: 64 px cell, art fills 48 px. Hard $9.00 gross-admission cap; price check before every paid call; no automatic retries.
The API key is read only by the shared helper in retrodiffusion-2d-ocean-study.py; this file never touches it.

  stills  [--n=1] [slug ...]            paid: one still per subject
  anim    [--n=1] [--still=1] [slug ...] paid: native loop of that still
  export  [--n=1] [slug ...]            offline: sheet into the work folder for review
  procedural [--still=1] [slug ...]     offline, $0: animate the accepted still locally (used when native loops are unaffordable)
  install [--n=1] [--procedural] [--still=1] [slug ...]   offline: copy reviewed sheets into ui/abyss/pixel and record provenance
Subjects default to all; `creatures` and `fish` select a group. A rejected subject is redone with a higher --n.
"""
import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import base64
import math

import numpy as np
from PIL import Image, ImageDraw, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-detonation-set"
PIXEL = ROOT / "ui/abyss/pixel"
LIMIT = 9_000_000  # Microdollars.
STILL_CAP, ANIM_CAP = 100_000, 300_000
STILL_STYLE = "rd_plus__retro"
ANIM_STYLE = "rd_advanced_animation__custom_action"
spec = importlib.util.spec_from_file_location("rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py"))
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
rd.OUT, rd.LIMIT = OUT, LIMIT

SUFFIX = (
    " Isolated single creature facing left on a transparent background, 16-bit game sprite, crisp square pixel clusters, "
    "stepped contours, restrained deep-sea palette of dark teal, navy, cyan and cream with a dark outline, "
    "centered with generous empty margin, no scenery, no text, no border."
)
COMMON = "Gentle seamless underwater idle loop in place. Use the uploaded character's EXACT silhouette, proportions, orientation and pixel-art style, no redesign. Extremely small motion; entire body stays centered and inside generous margins. No camera movement, rotation, zoom, scene, text or particles. Return to starting pose with no loop jump. Transparent background."
SWIM = "Smooth swim cycle in place facing left: "
SWIM_END = " Keep the exact silhouette, colours and pixel-art style, no redesign. Small motion; the body stays centered and inside generous margins. No camera movement, rotation, zoom, scene, text or particles. Transparent background."

SPECS = {
    "snipe-eel": ("creature", "One snipe eel: extremely thin, long ribbon-like body in a gentle S-curve, dark brown-teal back and pale belly, long narrow beak-like jaws curving apart at the tips, small eye, tapering threadlike tail, side view.",
                  "The thin body undulates in a small travelling wave from head to tail; the beak-like jaws gently part and close. Keep the single long body connected and the same length in every frame." + " " + COMMON),
    "vampire-squid": ("creature", "One vampire squid: deep red-black bell-shaped body, webbed cloak joining eight short arms with small cream spines along the inner edge, two large glossy blue eyes, two small ear-like fins on top, side view.",
                      "The cloak of webbing slowly billows and the two ear-like fins paddle. The eight arms stay joined by the web and the blue eyes stay fixed. " + COMMON),
    "kraken": ("creature", "One kraken: huge dark teal sea monster, domed head with two glowing amber eyes and a sharp ivory beak, eight thick curling tentacles lined with cream suckers, menacing, readable silhouette, side view.",
               "The tentacles make slow heavy curls and relax back while the mantle gently breathes. Exactly eight tentacles stay attached to the body; eyes and beak stay fixed. " + COMMON),
    "jormungandr": ("creature", "One Jormungandr, the Norse world serpent: gigantic sea serpent forming a ring and biting its own tail, scaled dark green-teal body with cream belly plates, spiked ridge along the back, horned head with a glowing amber eye and fanged jaws, side view.",
                    "The serpent's body slowly ripples and slides along its ring while the spiked ridge shimmers; the head and the tail it bites stay joined. Keep one continuous ring body. " + COMMON),
    "giant-clam": ("creature", "One giant clam: wide fluted scalloped pale cream shell halves held open, showing a wavy iridescent blue-violet mantle with teal spots between the shell halves, front three-quarter view, hinge at the bottom.",
                   "The two shell halves start fully open showing the wavy mantle, then slowly close until completely shut and the mantle is hidden in the final frame. The hinge and the lower shell stay fixed. Smooth closing motion in place, entire clam stays centered and inside generous margins. No camera movement, rotation, zoom, scene, text or particles. Transparent background."),
    "pufferfish": ("fish", "One pufferfish: round inflated body, cream belly, olive-gold back with dark spots, tiny spines, big eye, small fins and rounded tail, side view.",
                   SWIM + "the small fins flutter and the tail beats gently; the round body barely moves." + SWIM_END),
    "flounder": ("fish", "One flounder: flat oval sandy-brown mottled body with both eyes on top near the head, frilled fin along the whole edge, small tail, side view.",
                 SWIM + "a gentle ripple travels along the frilled fin edge and the tail sways." + SWIM_END),
    "leafy-seadragon": ("fish", "One leafy seadragon floating in water like a seahorse: slender curved golden-green body, long tube-shaped snout, many leaf-shaped green and yellow fronds sprouting from the head, back and belly, tail curling down, no legs, side view. Whole animal visible from snout to curled tail tip, entirely inside the frame.",
                        SWIM + "the leaf-like fronds sway gently and the tiny fins flutter." + SWIM_END),
    "boxfish": ("fish", "One yellow boxfish: boxy rigid cube-shaped body with a hexagon pattern, yellow with black spots, small fins and tail, pursed mouth, side view.",
                SWIM + "the rigid boxy body stays still; only the small fins and tail move." + SWIM_END),
    "barracuda": ("fish", "One barracuda: long slender torpedo body, silver with dark bars, large underbite jaw with sharp teeth, forked tail, side view.",
                  SWIM + "the tail beats side to side and the body flexes slightly." + SWIM_END),
    "mandarin-dragonet": ("fish", "One mandarin dragonet: small stubby body with psychedelic swirling blue, orange and teal wavy stripes, large fan-like fins, side view.",
                          SWIM + "the large fan-like fins flutter and the tail sways." + SWIM_END),
    "flying-fish": ("fish", "One flying fish: slender silver-blue body with big wing-like pectoral fins, forked tail with a longer lower lobe, wings spread wide like a bird, bright and clearly readable silhouette, side view.",
                    SWIM + "the wing-like pectoral fins flap gently and the tail beats." + SWIM_END),
    "pilot-fish": ("fish", "One pilot fish: slim silver-blue body with five dark vertical bars, forked tail, side view.",
                   SWIM + "the tail beats side to side and the body flexes slightly." + SWIM_END),
    "coelacanth": ("fish", "One coelacanth: stout steel-blue body with white speckles, lobed paired fins on short stalks, three-lobed tail, side view.",
                   SWIM + "the lobed fins paddle slowly and the tail sways." + SWIM_END),
    "snake-eel": ("fish", "One snake eel: long thin sandy-tan body with dark spots, pointed snout, small eye, tapering tail, gentle S-curve, side view.",
                  SWIM + "the long body undulates in a small travelling wave from head to tail." + SWIM_END),
    "jack": ("fish", "One jack trevally: deep silver body with a yellow-tinted forked tail, dark spot at the gill cover, steep forehead, side view.",
             SWIM + "the tail beats side to side and the small fins flutter." + SWIM_END),
    "torpedo-ray": ("fish", "One torpedo ray: rounded disc-shaped slate-blue body with pale spots, small eyes, short thick tail with a paddle-shaped fin, side view.",
                    SWIM + "the wide pectoral disc ripples at its edges and the tail sways." + SWIM_END),
}


STILL_OF = {"flying-fish": 2, "leafy-seadragon": 3}  # accepted still attempt where it is not the first


def cell(slug):
    return 128 if SPECS[slug][0] == "creature" else 64


def fill(slug):
    return 96 if SPECS[slug][0] == "creature" else 48


def sheet_path(slug):
    return PIXEL / ("creatures" if SPECS[slug][0] == "creature" else "fish") / (slug + ("-spritesheet.png" if SPECS[slug][0] == "creature" else "-swim.png"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_state():
    ledger_path = OUT / "ledger.json"
    return json.loads(ledger_path.read_text()) if ledger_path.exists() else {"reservations": {}, "actual_charges": {}}


def save_cost(ledger):
    rd.save(OUT / "ledger.json", ledger)
    print(f"LEDGER reserved ${sum(ledger['reservations'].values()) / 1e6:.2f}, charged ${sum(ledger['actual_charges'].values()) / 1e6:.2f}", flush=True)


def still_job(slug, n):
    size = cell(slug)
    return {"id": f"still-{slug}-a{n}", "group": "still", "title": f"{slug} still", "subject": slug, "type": "RD Plus text-to-image",
            "body": {"prompt": SPECS[slug][1] + SUFFIX, "prompt_style": STILL_STYLE, "width": size, "height": size, "num_images": 1,
                     "seed": 416 + 101 * n + list(SPECS).index(slug), "remove_bg": True, "bypass_prompt_expansion": True}}


def anim_job(slug, n, still_n):
    size = cell(slug)
    still = Image.open(OUT / "images" / f"still-{slug}-a{still_n}-01.png").convert("RGBA")
    if still.size != (size, size):
        raise RuntimeError(f"Unexpected still size for {slug}")
    rgb = Image.new("RGB", still.size, "#243b4b")
    rgb.paste(still, mask=still.getchannel("A"))
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return {"id": f"anim-{slug}-a{n}", "group": "animation", "title": f"{slug} loop", "subject": slug, "type": "Provider native animation",
            "body": {"prompt": SPECS[slug][2], "prompt_style": ANIM_STYLE, "width": size, "height": size, "num_images": 1, "frames_duration": 8,
                     "input_image": base64.b64encode(buf.getvalue()).decode(), "remove_bg": True, "seed": 6713 + 97 * list(SPECS).index(slug) + 1009 * n}}


def generate(jobs, cap):
    ledger = load_state()
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"budget": LIMIT / 1e6, "outputs": [], "failures": []}
    try:
        for job in jobs:
            if any(o["job_id"] == job["id"] for o in manifest["outputs"]):
                continue
            accepted = rd.paid(job, ledger, {job["id"]: cap})
            task = rd.wait(job, accepted)
            if task["status"] == "failed":
                manifest["failures"].append({"job_id": job["id"], "error": task.get("error"), "reserved_microdollars": ledger["reservations"][job["id"]]})
                rd.save(manifest_path, manifest)
                raise RuntimeError(f"Provider task failed for {job['id']}; stopping, no automatic paid retry")
            result = task["result"]
            charge = rd.money(result["balance_cost"])
            if charge > ledger["reservations"][job["id"]]:
                raise RuntimeError("Provider charged above the checked estimate; stop further submissions")
            ledger["actual_charges"][job["id"]] = charge
            rd.save(OUT / "ledger.json", ledger)
            output = rd.collect(job, result)[0]
            output["cost_microdollars"] = charge
            output["date"] = datetime.date.today().isoformat()
            manifest["outputs"].append(output)
            rd.save(manifest_path, manifest)
            print(f"SAVED {job['id']} {output['dimensions']} frames={output['frames']}", flush=True)
    finally:
        save_cost(ledger)
        rd.save(manifest_path, manifest)


# ---- Procedural animation of the accepted stills ($0) --------------------------------------------------------------
# Nearest-neighbour warps of the provider still, so the pixel grid stays crisp. Fish are mirrored so the head faces left,
# like the existing creature sheets. Frame i uses phase 2*pi*i/14, so the loop is seamless; the clam is a close/reopen
# ping-pong (frame 0 open, frame 7 closed).
MIRROR = {"snipe-eel", "barracuda", "jack", "snake-eel"}  # the still faces right
FRAMES = 14


def warp(img, source):
    arr = np.asarray(img)
    h, w = arr.shape[:2]
    y, x = np.mgrid[0:h, 0:w].astype(float)
    sx, sy = source(x, y)
    sx, sy = np.rint(sx).astype(int), np.rint(sy).astype(int)
    ok = (sx >= 0) & (sx < w) & (sy >= 0) & (sy < h)
    out = np.zeros_like(arr)
    out[ok] = arr[sy[ok], sx[ok]]
    return Image.fromarray(out, "RGBA")


def opaque_box(img):
    return img.getchannel("A").point(lambda v: 255 if v >= 64 else 0).getbbox()


def swim(box, amp, waves=1.0, power=1.6, fins=0.0, flap=0.0, ripple=0.0, ripple_waves=1.5):
    """Head at the left: tail-ward travelling wave, optional fin shimmer, wing flap and edge ripple."""
    x0, y0, x1, y1 = box
    cy, hh = (y0 + y1) / 2, max(1, (y1 - y0) / 2)

    def frame(img, phase):
        def source(x, y):
            u = np.clip((x - x0) / max(1, x1 - x0), 0, 1)
            edge = np.clip(np.abs(y - cy) / hh, 0, 1)
            dy = amp * u ** power * np.sin(2 * math.pi * waves * u - phase)
            dy = dy + ripple * edge ** 2 * np.sin(2 * math.pi * ripple_waves * u - phase)
            dy = dy + flap * math.sin(phase) * np.clip((cy - y) / hh, 0, 1)
            dx = fins * edge ** 2 * np.sin(2 * phase + 0.35 * y)
            return x + dx, y - dy
        return warp(img, source)
    return frame


def sway(box, amp, waves=1.0, shimmer=0.0):
    """Rows swing sideways more towards the bottom (fronds)."""
    x0, y0, x1, y1 = box

    def frame(img, phase):
        def source(x, y):
            v = np.clip((y - y0) / max(1, y1 - y0), 0, 1)
            dx = amp * v ** 1.2 * np.sin(2 * math.pi * waves * v - phase) + shimmer * np.sin(3 * phase + 0.5 * y) * v
            return x - dx, y
        return warp(img, source)
    return frame


def tentacles(box, split, amp, breathe, side_amp):
    """Mantle breathes above `split`; tentacles below swing sideways, outer tentacles also bob."""
    x0, y0, x1, y1 = box
    cx = (x0 + x1) / 2

    def frame(img, phase):
        def source(x, y):
            v = np.clip((y - split) / max(1, y1 - split), 0, 1)
            dx = amp * v ** 1.2 * np.sin(2 * math.pi * 0.9 * v - phase)
            outer = np.clip((np.abs(x - cx) - 0.3 * (x1 - x0)) / (0.25 * (x1 - x0)), 0, 1) * (y > split - 10)
            dy = side_amp * outer * np.sin(phase + np.sign(x - cx) * 1.3 + 0.08 * y)
            scale = 1 + breathe * math.sin(phase)
            sy = np.where(y < split, split + (y - split) / scale, y)
            return x - dx, sy - dy
        return warp(img, source)
    return frame


def ring(box, amp, waves):
    """Body ripples travel round the ring."""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2

    def frame(img, phase):
        def source(x, y):
            theta = np.arctan2(y - cy, x - cx)
            r_src = np.hypot(x - cx, y - cy) - amp * np.sin(waves * theta - phase)
            return cx + r_src * np.cos(theta), cy + r_src * np.sin(theta)
        return warp(img, source)
    return frame


def clam_frames(still):
    """The fan shell folds down over the mantle: frame 0 open, frame 7 closed, then it reopens."""
    arr = np.asarray(still).astype(int)
    row = np.mgrid[0:128, 0:128][0]
    fan = (arr[..., 0] > arr[..., 2] + 20) & (arr[..., 3] >= 64) & (row < 84)
    top0, bot0 = 12, 84
    base = np.asarray(still)
    lower, lump, shell = base.copy(), base.copy(), base.copy()
    lower[row < bot0] = 0
    lump[fan | (row >= bot0)] = 0
    shell[~fan] = 0
    # Gaps below the shell are filled with cream and ridge lines radiating from the hinge, so the shut lid hides the mantle.
    hinge_x, hinge_y = 70, 200
    filled = shell.copy()
    for x in range(33, 108):
        ys = np.where(fan[:, x])[0]
        for y in range(ys.max() + 1 if len(ys) else 56, bot0):
            if ((x - 70) / 37) ** 2 + ((y - bot0) / 30) ** 2 > 1:
                continue
            ridge = ((x - hinge_x) / (hinge_y - y) * 19) % 1 < 0.17
            filled[y, x] = (146, 123, 102, 255) if ridge else (198, 192, 154, 255) if x > hinge_x + 8 else (224, 226, 191, 255)
    frames = []
    for i in range(FRAMES):
        c = (i if i <= 7 else FRAMES - i) / 7
        top, bot = top0 + (58 - top0) * c, bot0 + (106 - bot0) * c
        k = (bot - top) / (bot0 - top0)

        def squash(layer):
            return warp(Image.fromarray(layer, "RGBA"), lambda x, y: (x, top0 + (y - top) / k))
        canvas = Image.fromarray(lower, "RGBA")
        canvas.alpha_composite(squash(lump))
        canvas.alpha_composite(squash(filled if c >= 0.5 else shell))
        frames.append(canvas)
    return frames


def recipe(slug, box):
    return {
        "snipe-eel": swim(box, 7, waves=1.4, power=0.8),
        "vampire-squid": tentacles(box, 58, 9, 0.06, 4),
        "kraken": tentacles(box, 64, 9, 0.05, 6),
        "jormungandr": ring(box, 3, 3),
        "pufferfish": swim(box, 2.5, waves=0.8, fins=1.5),
        "flounder": swim(box, 1.5, ripple=2.5),
        "leafy-seadragon": sway(box, 5, waves=1.0, shimmer=1.5),
        "boxfish": swim(box, 3, power=4, fins=1.5),
        "barracuda": swim(box, 3),
        "mandarin-dragonet": swim(box, 2.5, fins=2),
        "flying-fish": swim(box, 1.5, flap=4),
        "pilot-fish": swim(box, 3),
        "coelacanth": swim(box, 2.5, fins=1.5),
        "snake-eel": swim(box, 4, waves=1.6, power=0.7),
        "jack": swim(box, 3),
        "torpedo-ray": swim(box, 1.0, ripple=3.0, ripple_waves=1.2),
    }[slug]


def procedural_frames(slug, still_n):
    still = Image.open(OUT / "images" / f"still-{slug}-a{still_n}-01.png").convert("RGBA")
    if slug in MIRROR:
        still = still.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    if slug == "giant-clam":
        return clam_frames(still)
    padded = Image.new("RGBA", (still.width + 32, still.height + 32))  # room for the motion to swing past the cell
    padded.alpha_composite(still, (16, 16))
    still = padded
    step = recipe(slug, opaque_box(still))
    return [step(still, 2 * math.pi * i / FRAMES) for i in range(FRAMES)]


def review(paths, out, scale, labels):
    width = 6
    size = max(Image.open(p).size[0] for p in paths) * scale
    sheet = Image.new("RGB", (width * size, ((len(paths) + width - 1) // width) * (size + 18)), "#243b4b")
    draw = ImageDraw.Draw(sheet)
    for i, (p, label) in enumerate(zip(paths, labels)):
        img = Image.open(p).convert("RGBA")
        img = img.resize((img.width * scale, img.height * scale), Image.Resampling.NEAREST)
        x, y = i % width * size, i // width * (size + 18)
        sheet.paste(img, (x, y), img)
        draw.text((x + 4, y + size + 2), label, fill="white")
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)


def native_frames(slug, n):
    manifest = json.loads((OUT / "manifest.json").read_text())
    item = next(o for o in manifest["outputs"] if o["job_id"] == f"anim-{slug}-a{n}")
    path = OUT / item["file"]
    if sha(path) != item["sha256"]:
        raise RuntimeError("Native animation bytes changed")
    gif = Image.open(path)
    frames = [f.convert("RGBA") for f in ImageSequence.Iterator(gif)]
    return item, frames


def sheet_from(slug, frames, order):
    size = cell(slug)
    boxes = [opaque_box(f) for f in frames]
    if not all(boxes):
        raise RuntimeError(f"{slug}: empty frame")
    bounds = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    if bounds[0] == 0 or bounds[1] == 0 or bounds[2] == frames[0].width or bounds[3] == frames[0].height:
        print(f"WARNING {slug}: motion touches the frame edge; check for clipping", flush=True)
    scale = min(fill(slug) / (bounds[2] - bounds[0]), fill(slug) / (bounds[3] - bounds[1]))
    target = (max(1, round((bounds[2] - bounds[0]) * scale)), max(1, round((bounds[3] - bounds[1]) * scale)))
    framed, alphas = [], []
    for i in order:
        canvas = Image.new("RGBA", (size, size))
        canvas.alpha_composite(frames[i].crop(bounds).resize(target, Image.Resampling.NEAREST), ((size - target[0]) // 2, (size - target[1]) // 2))
        alphas.append(canvas.getchannel("A").point(lambda v: 255 if v >= 64 else 0))
        framed.append(canvas.convert("RGB"))
    strip = Image.new("RGB", (size * len(framed), size))
    for i, frame in enumerate(framed):
        strip.paste(frame, (size * i, 0))
    palette = strip.quantize(colors=24, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    sheet = Image.new("RGBA", (size * len(framed), size))
    for i, (frame, alpha) in enumerate(zip(framed, alphas)):
        rgba = frame.quantize(palette=palette, dither=Image.Dither.NONE).convert("RGBA")
        rgba.putalpha(alpha)
        sheet.paste(rgba, (i * size, 0))
    colours = {p[:3] for p in sheet.get_flattened_data() if p[3]}
    if sheet.size != (size * FRAMES, size) or len(colours) > 24 or set(sheet.getchannel("A").get_flattened_data()) != {0, 255}:
        raise RuntimeError(f"{slug}: sheet invariants failed")
    print(f"EXPORT {slug}: {sheet.size}, {len(colours)} colours, bounds {bounds}", flush=True)
    return sheet


def export_path(slug, n, procedural):
    return OUT / "exports" / f"{slug}-{'p' if procedural else 'a'}{n}.png"


def export(slug, n):
    item, frames = native_frames(slug, n)
    if len(frames) != 8 or len({f.tobytes() for f in frames}) < 2:
        raise RuntimeError(f"{slug}: expected 8 distinct-motion native frames, got {len(frames)}")
    out = export_path(slug, n, False)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet_from(slug, frames, list(range(8)) + list(range(6, 0, -1))).save(out)  # same forward/back loop as the existing sheets


def procedural(slug, still_n):
    out = export_path(slug, still_n, True)
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet_from(slug, procedural_frames(slug, still_n), list(range(FRAMES))).save(out)
    review_sheet(out, OUT / "review" / f"{slug}-p{still_n}.png", cell(slug))


def review_sheet(sheet_file, out, size):
    sheet = Image.open(sheet_file)
    per_row = 7
    zoom = 2
    board = Image.new("RGB", (per_row * size * zoom, 2 * size * zoom), "#243b4b")
    for i in range(FRAMES):
        frame = sheet.crop((i * size, 0, (i + 1) * size, size)).resize((size * zoom, size * zoom), Image.Resampling.NEAREST)
        board.paste(frame, (i % per_row * size * zoom, i // per_row * size * zoom), frame)
    board.save(out)


def install(slug, n, from_still, still_n):
    source = export_path(slug, still_n if from_still else n, from_still)
    target = sheet_path(slug)
    if target.exists():
        raise RuntimeError(f"Refusing to overwrite {target.relative_to(ROOT)}")
    outputs = json.loads((OUT / "manifest.json").read_text())["outputs"]
    still = next(o for o in outputs if o["job_id"] == f"still-{slug}-a{still_n}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    path = PIXEL / "provenance.json"
    provenance = json.loads(path.read_text(encoding="utf-8"))
    layout = f"scaled nearest-neighbour to fit {fill(slug)} px, centred in a {cell(slug)} px cell, global 24-colour palette, binary alpha"
    entry = {
        "output": target.relative_to(ROOT).as_posix(),
        "output_sha256": sha(target),
        "licence": "RetroDiffusion provider terms apply; no CC0 claim",
    }
    if from_still:
        entry.update({
            "source": (OUT / still["file"]).relative_to(ROOT).as_posix(),
            "source_sha256": still["sha256"],
            "transform": f"procedural animation of RetroDiffusion still {still['job_id']}: local nearest-neighbour warp over 14 frames"
                         + (", mirrored so the head faces left" if slug in MIRROR else "") + f"; union bounds {layout}",
            "prompt": still["prompt"],
            "model": f"{STILL_STYLE} ({still['model']}); animation is procedural, not provider-native",
            "date": still["date"],
            "seed": still["seed"],
            "cost_microdollars": still["cost_microdollars"],
            "replace_with": f"native {ANIM_STYLE} loop of this still (rd_fast, $0.25) once balance allows; planned prompt: {SPECS[slug][2]}",
        })
    else:
        item, _ = native_frames(slug, n)
        entry.update({
            "source": (OUT / item["file"]).relative_to(ROOT).as_posix(),
            "source_sha256": item["sha256"],
            "transform": f"native 8-pose RetroDiffusion loop played forward then back (14 frames); union bounds {layout}",
            "prompt": item["prompt"],
            "still_prompt": still["prompt"],
            "model": f"{ANIM_STYLE} ({item['model']}); still {STILL_STYLE}",
            "date": item["date"],
            "seed": item["seed"],
            "cost_microdollars": item["cost_microdollars"] + still["cost_microdollars"],
        })
    provenance["files"] = [f for f in provenance["files"] if f["output"] != entry["output"]] + [entry]
    path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(f"INSTALLED {entry['output']}", flush=True)


def select(names):
    if not names or names == ["all"]:
        return list(SPECS)
    if names in (["creatures"], ["fish"]):
        return [s for s, v in SPECS.items() if v[0] == ("creature" if names[0] == "creatures" else "fish")]
    unknown = [s for s in names if s not in SPECS]
    if unknown:
        raise ValueError(f"Unknown subjects: {unknown}")
    return names


def main(argv):
    step, options = argv[0], {a.split("=")[0]: int(a.split("=")[1]) for a in argv[1:] if "=" in a}
    n, still_n = options.get("--n", 1), options.get("--still", 1)
    slugs = select([a for a in argv[1:] if not a.startswith("--")])
    if step == "stills":
        generate([still_job(s, n) for s in slugs], STILL_CAP)
        files = [OUT / "images" / f"still-{s}-a{n}-01.png" for s in slugs if (OUT / "images" / f"still-{s}-a{n}-01.png").exists()]
        review(files, OUT / "review" / f"stills-a{n}.png", 2, [f.stem for f in files])
    elif step == "anim":
        generate([anim_job(s, n, still_n) for s in slugs], ANIM_CAP)
    elif step == "export":
        for s in slugs:
            export(s, n)
    elif step == "procedural":
        for s in slugs:
            procedural(s, STILL_OF.get(s, still_n))
    elif step == "install":
        for s in slugs:
            install(s, n, "--procedural" in argv, STILL_OF.get(s, still_n))
    else:
        raise ValueError("Expected stills, anim, export, procedural or install")


if __name__ == "__main__":
    main(sys.argv[1:])
