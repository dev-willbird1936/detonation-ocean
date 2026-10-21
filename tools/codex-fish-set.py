"""Codex-generated stills for the 15 fish without art, animated by RetroDiffusion until its balance runs out.

Steps (run in order; each is resumable):
  prepare    codex-fish-set/<species>.png -> images/still-<species>-a1-01.png (64 px cell, art fills 48 px, 24 colours)
  anim       native rd_advanced_animation__custom_action loops: the 15 new fish first, then the 12 procedural sheets.
             Stops at the first provider refusal (balance exhausted); no retries.
  install    writes ui/abyss/pixel/fish/<species>-swim.png from the native loop, else a procedural swim; updates
             provenance.json and data/fish.json. Replaces an existing sheet only with a native loop.
"""
import base64
import datetime
import hashlib
import importlib.util
import io
import json
import math
import re
import sys
from pathlib import Path

from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("det", Path(__file__).with_name("retrodiffusion-detonation-set.py"))
det = importlib.util.module_from_spec(spec)
spec.loader.exec_module(det)
rd = det.rd
OLD_OUT = det.OUT
OUT = ROOT / "ocean-style-prototypes/codex-fish-set"
LIMIT = 50_000_000  # Ceiling only; the real stop is the provider balance.
rd.LIMIT = LIMIT

S, E = det.SWIM, det.SWIM_END
NEW = {
    "lionfish": ("Lionfish with fanned feathery pectoral fins and venomous dorsal spines.", "the long feathery fins and spines wave slowly and the tail beats gently.", dict(amp=2.5, fins=2)),
    "ribbonfish": ("Long thin silver ribbonfish.", "the long ribbon body undulates in a small travelling wave from head to tail.", dict(amp=4, waves=1.6, power=0.7)),
    "remora": ("Remora with a suction disc on its head.", "the tail beats side to side and the body flexes slightly.", dict(amp=3)),
    "picasso-triggerfish": ("Picasso triggerfish with bold geometric bands.", "the small fins flutter and the tail beats gently; the oval body barely moves.", dict(amp=2.5, power=3, fins=1.5)),
    "batfish": ("Tall disc-shaped batfish with very tall fins.", "the tall dorsal and anal fins sway and the tail beats gently.", dict(amp=2, fins=2)),
    "archerfish": ("Archerfish with black blotches.", "the tail beats side to side and the small fins flutter.", dict(amp=3)),
    "sea-bass": ("Grey-silver sea bass.", "the tail beats side to side and the body flexes slightly.", dict(amp=3)),
    "goblin-shark": ("Goblin shark with a long blade-like snout.", "the tail sweeps slowly and the body flexes slightly.", dict(amp=3, power=1.8)),
    "jawfish": ("Jawfish with an oversized head holding a pebble.", "the long dorsal fin ripples and the tail sways; the big head stays still.", dict(amp=2.5, power=2.5, ripple=1.5)),
    "pocket-shark": ("Small dark pocket shark.", "the tail sweeps side to side and the small fins paddle.", dict(amp=3, fins=1)),
    "mackerel": ("Mackerel with wavy tiger stripes.", "the tail beats quickly and the body flexes slightly.", dict(amp=3)),
    "java-rabbitfish": ("Java rabbitfish with blue wavy lines.", "the small fins flutter and the tail beats gently.", dict(amp=2.5, fins=1.5)),
    "sole": ("Flat oval sole with a fringing fin.", "a gentle ripple travels along the fringing fin and the tail sways.", dict(amp=1.5, ripple=2.5)),
    "butterflyfish": ("Round butterflyfish with an eye stripe.", "the small fins flutter and the tail beats gently; the round body barely moves.", dict(amp=2.5, power=3, fins=1.5)),
    "plaice": ("Flat oval plaice with orange spots.", "a gentle ripple travels along the fringing fins and the tail sways.", dict(amp=1.5, ripple=2.5)),
}
PICK = {}  # species -> attempt file, after visual review
EXISTING = [s for s, v in det.SPECS.items() if v[0] == "fish"]  # the 12 procedural sheets, all with RetroDiffusion stills
for slug, (still, motion, _) in NEW.items():
    det.SPECS[slug] = ("fish", still, S + motion + E)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare():
    raw = json.loads((OUT / "generation-report.json").read_text(encoding="utf-8"))
    entries = raw if isinstance(raw, list) else next(v for v in raw.values() if isinstance(v, list))
    # Halo and colour-count failures are fixed here by keying and quantising, so pick the latest attempt whose
    # content passed (one fish, facing left, species features); otherwise the latest attempt. Override with PICK.
    report = {}
    for o in entries:
        ins = o.get("inspection") if isinstance(o.get("inspection"), dict) else {}
        ok = all(ins.get(k) for k in ("one_fish", "facing_left", "species_features_visible"))
        if ok or not report.get(o.get("species"), {}).get("_ok"):
            report[o.get("species")] = {**o, "_ok": ok}
    for slug in NEW:
        meta = report.get(slug, {})
        src = OUT / PICK.get(slug, meta.get("file", f"{slug}.png"))
        if not src.exists():
            print(f"MISSING still {slug}", flush=True)
            continue
        img = Image.open(src).convert("RGBA")
        alpha = img.getchannel("A")
        if alpha.getextrema()[0] == 255:  # no real transparency: key out the corner colour
            bg = img.getpixel((2, 2))[:3]
            px = img.load()
            for y in range(img.height):
                for x in range(img.width):
                    r, g, b, _ = px[x, y]
                    if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) < 60:
                        px[x, y] = (0, 0, 0, 0)
        box = det.opaque_box(img)
        art = img.crop(box)
        k = 48 / max(art.size)
        art = art.resize((max(1, round(art.width * k)), max(1, round(art.height * k))), Image.Resampling.LANCZOS)
        cell = Image.new("RGBA", (64, 64))
        cell.alpha_composite(art, ((64 - art.width) // 2, (64 - art.height) // 2))
        a = cell.getchannel("A").point(lambda v: 255 if v >= 128 else 0)
        rgb = cell.convert("RGB").quantize(colors=24, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
        rgb.putalpha(a)
        out = OUT / "images" / f"still-{slug}-a1-01.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        rgb.save(out)
        stills = load_manifest()
        stills["stills"][slug] = {"file": out.relative_to(OUT).as_posix(), "sha256": sha(out), "codex_source": src.name,
                                  "codex_sha256": sha(src), "prompt": meta.get("prompt") or meta.get("exact_prompt"), "date": datetime.date.today().isoformat()}
        save_manifest(stills)
        print(f"PREPARED {slug}", flush=True)
    det.OUT = OUT
    det.review([OUT / "images" / f"still-{s}-a1-01.png" for s in NEW if (OUT / "images" / f"still-{s}-a1-01.png").exists()],
               OUT / "review" / "stills.png", 3, [s for s in NEW if (OUT / "images" / f"still-{s}-a1-01.png").exists()])


def load_manifest():
    p = OUT / "manifest.json"
    m = json.loads(p.read_text()) if p.exists() else {}
    m.setdefault("stills", {}); m.setdefault("outputs", []); m.setdefault("failures", []); m.setdefault("stopped", None)
    return m


def save_manifest(m):
    rd.save(OUT / "manifest.json", m)


ATTEMPT = 2  # attempt 1 was submitted at 64 px and every job failed with a provider 502


def anim_job(slug, still_root, still_n):
    """The 64 px still upscaled 2x nearest-neighbour: the animation model failed on 64 px inputs."""
    still = Image.open(still_root / "images" / f"still-{slug}-a{still_n}-01.png").convert("RGBA").resize((128, 128), Image.Resampling.NEAREST)
    rgb = Image.new("RGB", still.size, "#243b4b")
    rgb.paste(still, mask=still.getchannel("A"))
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return {"id": f"anim-{slug}-a{ATTEMPT}", "group": "animation", "title": f"{slug} loop", "subject": slug, "type": "Provider native animation",
            "body": {"prompt": det.SPECS[slug][2], "prompt_style": det.ANIM_STYLE, "width": 128, "height": 128, "num_images": 1, "frames_duration": 8,
                     "input_image": base64.b64encode(buf.getvalue()).decode(), "remove_bg": True, "seed": 6713 + 97 * list(det.SPECS).index(slug)}}


def anim(only=None):
    """New fish first, then the 12 procedural ones. All jobs share one ledger in OUT. Stops after two failures in a row."""
    rd.OUT = OUT
    m = load_manifest()
    order = [(s, OUT) for s in NEW if s in m["stills"]] + [(s, OLD_OUT) for s in EXISTING]
    ledger = json.loads((OUT / "ledger.json").read_text()) if (OUT / "ledger.json").exists() else {"reservations": {}, "actual_charges": {}}
    streak = 0
    for slug, still_root in order:
        if only and slug not in only:
            continue
        if any(o["job_id"].startswith(f"anim-{slug}-a") for o in m["outputs"]):
            continue
        still_n = det.STILL_OF.get(slug, 1)
        job = anim_job(slug, still_root, still_n)
        det.OUT = OUT
        try:
            accepted = rd.paid(job, ledger, {job["id"]: det.ANIM_CAP})
            task = rd.wait(job, accepted)
        except RuntimeError as error:
            m["stopped"] = {"at": slug, "error": str(error)[:500]}
            save_manifest(m)
            print(f"STOPPED at {slug}: {error}", flush=True)
            break
        if task["status"] == "failed":
            m["failures"].append({"job_id": job["id"], "error": task.get("error")})
            save_manifest(m)
            print(f"FAILED {slug}: {task.get('error')}", flush=True)
            streak += 1
            if streak >= 2:
                m["stopped"] = {"at": slug, "error": "two provider failures in a row"}
                save_manifest(m)
                print("STOPPED: two failures in a row", flush=True)
                break
            continue
        streak = 0
        result = task["result"]
        ledger["actual_charges"][job["id"]] = rd.money(result["balance_cost"])
        rd.save(OUT / "ledger.json", ledger)
        out = rd.collect(job, result)[0]
        out.update({"cost_microdollars": ledger["actual_charges"][job["id"]], "date": datetime.date.today().isoformat(),
                    "still_root": still_root.relative_to(ROOT).as_posix(), "still_n": still_n})
        m["outputs"].append(out)
        save_manifest(m)
        print(f"SAVED {job['id']} frames={out['frames']} ${out['cost_microdollars'] / 1e6:.2f}", flush=True)
    print(f"TOTAL charged ${sum(ledger['actual_charges'].values()) / 1e6:.2f}", flush=True)


def install():
    det.OUT = OUT
    m = load_manifest()
    native = {o["job_id"][5:o["job_id"].rindex("-a")]: o for o in m["outputs"]}
    prov_path = det.PIXEL / "provenance.json"
    prov = json.loads(prov_path.read_text(encoding="utf-8"))
    fish_path = ROOT / "data/fish.json"
    fish_text = fish_path.read_text(encoding="utf-8")
    for slug in list(NEW) + EXISTING:
        target = det.sheet_path(slug)
        item = native.get(slug)
        if item:
            frames = [f.convert("RGBA") for f in ImageSequence.Iterator(Image.open(OUT / item["file"]))]
            if len(frames) < 2:
                print(f"SKIP {slug}: native output not animated", flush=True)
                item = None
            else:
                n = len(frames)
                sheet = det.sheet_from(slug, frames, list(range(n)) + list(range(n - 2, 0, -1)) if 2 * n - 2 == det.FRAMES else
                                       [round(i * (n - 1) / (det.FRAMES - 1)) for i in range(det.FRAMES)])
        if not item:
            if slug not in NEW or slug not in m["stills"]:
                continue  # existing procedural sheet stays as it is
            if target.exists():
                continue
            still = Image.open(OUT / m["stills"][slug]["file"]).convert("RGBA")
            padded = Image.new("RGBA", (still.width + 32, still.height + 32))
            padded.alpha_composite(still, (16, 16))
            params = dict(NEW[slug][2]); amp = params.pop("amp")
            step = det.swim(det.opaque_box(padded), amp, **params)
            sheet = det.sheet_from(slug, [step(padded, 2 * math.pi * i / det.FRAMES) for i in range(det.FRAMES)], list(range(det.FRAMES)))
        target.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(target)
        det.review_sheet(target, OUT / "review" / f"{slug}-sheet.png", 64)
        layout = "scaled to fit 48 px, centred in a 64 px cell, global 24-colour palette, binary alpha"
        if slug in NEW:
            st = m["stills"][slug]
            entry = {"source": (OUT / st["file"]).relative_to(ROOT).as_posix(), "source_sha256": st["sha256"],
                     "still_source": f"ocean-style-prototypes/codex-fish-set/{st['codex_source']}", "still_source_sha256": st["codex_sha256"],
                     "prompt": st["prompt"], "licence": "OpenAI image generation output via Codex; no CC0 claim", "date": st["date"]}
            model = "Codex built-in image generation (still), downscaled"
        else:
            entry = next(f for f in prov["files"] if f["output"] == target.relative_to(ROOT).as_posix()).copy()
            model = "rd_plus__retro (still)"
        entry["output"] = target.relative_to(ROOT).as_posix()
        entry["output_sha256"] = sha(target)
        if item:
            entry.update({"animation_source": (OUT / item["file"]).relative_to(ROOT).as_posix(), "animation_sha256": item["sha256"],
                          "transform": f"native RetroDiffusion {det.ANIM_STYLE} loop ({item['frames']} poses) resampled to 14 frames; union bounds {layout}",
                          "animation_prompt": item["prompt"], "model": f"{model}; animation {det.ANIM_STYLE} ({item['model']})",
                          "animation_cost_microdollars": item["cost_microdollars"], "animation_date": item["date"]})
            entry.pop("replace_with", None)
            if slug in NEW:
                entry["licence"] += "; animation under RetroDiffusion provider terms"
        else:
            entry.update({"transform": f"procedural nearest-neighbour swim warp over 14 frames; {layout}", "model": f"{model}; animation is procedural",
                          "replace_with": f"native {det.ANIM_STYLE} loop once RetroDiffusion balance allows; planned prompt: {det.SPECS[slug][2]}"})
        prov["files"] = [f for f in prov["files"] if f["output"] != entry["output"]] + [entry]
        fish_text = re.sub(rf'("species": "{re.escape(slug)}".*?"sprite": )(null|"[^"]*")', lambda mt: f'{mt.group(1)}"{entry["output"]}"', fish_text)
        print(f"INSTALLED {slug} ({'native' if item else 'procedural'})", flush=True)
    prov_path.write_text(json.dumps(prov, indent=2) + "\n", encoding="utf-8")
    fish_path.write_text(fish_text, encoding="utf-8")


if __name__ == "__main__":
    step = sys.argv[1]
    {"prepare": prepare, "anim": lambda: anim(sys.argv[2:] or None), "install": install}[step]()
