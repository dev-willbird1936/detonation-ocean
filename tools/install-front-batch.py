"""Install the front-facing creature art and RetroDiffusion animations as game sprites:

- ui/abyss/pixel/creatures/front/<findingId>.png          front-facing still (128 px), from ocean-style-prototypes/front-batch
- ui/abyss/pixel/creatures/front/<findingId>-lunge.png     8 x 128 px lunge-and-bite sheet (RetroDiffusion, played once)
- the creature's side sheet (data/creatures.json sprite) is replaced by the native RetroDiffusion swim, resampled from 8
  to the game's 14 frames, where a swim was generated

Picks: ocean-style-prototypes/front-batch/selection.json for stills; LUNGE_PICK / SWIM below for the animations.
Every output gets a provenance entry. Run: python tools/install-front-batch.py
"""
import datetime
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / "ocean-style-prototypes/front-batch"
ANIM = ROOT / "ocean-style-prototypes/retrodiffusion-front-animation"
OUTDIR = ROOT / "ui/abyss/pixel/creatures/front"
CELL = 128
# Second attempts that beat the first (reviewed in review-a2.png); every other lunge uses attempt 1.
LUNGE_PICK = {"encrypt": 2, "injection": 2, "exfil-attempt": 2, "persistence": 2, "remote-control": 2}
SWIM = ["steal-browser", "steal-documents", "keylog", "capture", "clipboard-swap", "persistence", "defence-tamper",
        "traffic-redirect", "browser-hijack", "second-stage", "other-harm"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def rel(path):
    return Path(path).resolve().relative_to(ROOT).as_posix()


def frames(gif):
    return [f.convert("RGBA").resize((CELL, CELL), Image.Resampling.NEAREST) for f in ImageSequence.Iterator(Image.open(gif))]


def sheet(cells):
    out = Image.new("RGBA", (CELL * len(cells), CELL))
    for i, c in enumerate(cells):
        out.alpha_composite(c, (i * CELL, 0))
    return out


def main():
    OUTDIR.mkdir(parents=True, exist_ok=True)
    roster = json.loads((ROOT / "data/creatures.json").read_text(encoding="utf-8"))
    by_id = {e["findingId"]: e for e in roster["creatures"]}
    picks = json.loads((FRONT / "selection.json").read_text(encoding="utf-8"))["selection"]
    model = {"codex": "Codex built-in image generation (ChatGPT authentication)",
             "antigravity": "Gemini (gemini-3.8-flash agent) image generation via Antigravity ACP in Pi"}
    licence = {"codex": "OpenAI generated output; no CC0 claim", "antigravity": "Google generative AI output; no CC0 claim"}
    today = datetime.date.today().isoformat()
    entries = []
    for cid, pick in picks.items():
        src = FRONT / "game" / f"{cid}.png"
        out = OUTDIR / f"{cid}.png"
        Image.open(src).save(out)
        entries.append({"output": rel(out), "output_sha256": sha(out), "source": rel(FRONT / pick["file"]), "source_sha256": sha(FRONT / pick["file"]),
                        "reference": by_id[cid]["sprite"], "prompt": "see ocean-style-prototypes/front-batch/brief.txt" + (" and brief-retry.txt" if pick["generator"] == "antigravity" else ""),
                        "model": model[pick["generator"]], "transform": "background keyed, fitted to 104 px in a 128 px cell, 24 colours",
                        "licence": licence[pick["generator"]], "date": today})
        attempt = LUNGE_PICK.get(cid, 1)
        gif = ANIM / "images" / f"lunge-{cid}-a{attempt}-01.gif"
        out = OUTDIR / f"{cid}-lunge.png"
        sheet(frames(gif)).save(out)
        entries.append({"output": rel(out), "output_sha256": sha(out), "source": rel(gif), "source_sha256": sha(gif), "reference": rel(OUTDIR / f"{cid}.png"),
                        "prompt": "see tools/retrodiffusion-front-animation.py (LUNGE" + (", BITE" if attempt > 1 else "") + ")",
                        "model": "RetroDiffusion rd_advanced_animation__custom_action, 128 px, 8 frames ($0.25)",
                        "transform": "8 GIF frames laid out as an 8 x 128 px sheet", "licence": "provider terms apply, no CC0 claim", "date": today})
    for cid in SWIM:
        gif = ANIM / "images" / f"swim-{cid}-a1-01.gif"
        src = frames(gif)
        out = ROOT / by_id[cid]["sprite"]
        sheet([src[round(i * len(src) / 14) % len(src)] for i in range(14)]).save(out)
        entries.append({"output": rel(out), "output_sha256": sha(out), "source": rel(gif), "source_sha256": sha(gif), "reference": "previous procedural sheet, frame 0",
                        "prompt": "see tools/retrodiffusion-front-animation.py (SWIM)", "model": "RetroDiffusion rd_advanced_animation__custom_action, 128 px, 8 frames ($0.25)",
                        "transform": "8 GIF frames resampled to the game's 14-frame loop (nearest frame)", "licence": "provider terms apply, no CC0 claim", "date": today})
    prov_path = ROOT / "ui/abyss/pixel/provenance.json"
    prov = json.loads(prov_path.read_text(encoding="utf-8"))
    done = {e["output"] for e in entries}
    prov["files"] = [f for f in prov["files"] if f["output"] not in done] + entries
    prov_path.write_text(json.dumps(prov, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"installed {len(picks)} fronts, {len(picks)} lunges, {len(SWIM)} swims")


if __name__ == "__main__":
    main()
