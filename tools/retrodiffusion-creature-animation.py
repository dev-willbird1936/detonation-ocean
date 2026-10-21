"""Six paid family loops under $1.50; 30 labelled local palette derivatives."""
import base64
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-creature-animation"
STILLS = ROOT / "ocean-style-prototypes/codex-creature-refinement"
LIMIT = 1_500_000
STYLE = "rd_advanced_animation__custom_action"
FAMILIES = ["octopus", "anglerfish", "viperfish", "siphonophore", "isopod-host", "cookiecutter"]
MOTION = {
    "octopus": "Eight arms make very small slow coordinated curls and relax back. Exactly eight connected arms and eight separately visible curled tips in EVERY frame, each remaining in its original radial slot. Keep clear gaps between all arms. Mantle gently breathes; eyes and suckers stay fixed to the body. No arm crosses another or hides behind the mantle.",
    "anglerfish": "Small tail swishes, fins paddle gently, forehead-mounted lure stalk softly sways and its bulb subtly pulses. Keep the same head, toothed jaw and all fins attached.",
    "viperfish": "Small traveling tail undulation and gentle fin paddling. Preserve the slender fish, large needle-toothed jaw, eye and complete forked tail. No lure, no additional fins.",
    "siphonophore": "The entire one connected colony makes a small traveling wave along its shared stem. Attached swimming bells gently pulse; feeding filaments softly trail. Keep ALL original units attached to the same continuous stem, never detached jellyfish or an umbrella.",
    "isopod-host": "The host fish gently paddles its fins and swishes its tail. The single segmented isopod stays nestled in its open mouth, firmly attached and clearly recognizable. No chewing, no ejecting the parasite, no gill attachment, no second loose animal.",
    "cookiecutter": "A compact shark gently swishes its tail and paddles its small rear fins. Keep its dark collar and circular underside suction mouth fixed to the head; no large dorsal sail or gaping horizontal jaw."
}
COMMON = "Gentle seamless underwater idle loop in place. Use the uploaded character's EXACT silhouette, proportions, orientation and pixel-art style, no redesign. Extremely small motion; entire body stays centered and inside generous margins. No camera movement, rotation, zoom, scene, text or particles. Return to starting pose with no loop jump. Transparent background."
spec = importlib.util.spec_from_file_location("rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py"))
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
rd.OUT, rd.LIMIT = OUT, LIMIT


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def baseline():
    return sum(sum(json.loads((ROOT / "ocean-style-prototypes" / folder / "ledger.json").read_text(encoding="utf-8"))["reservations"].values()) for folder in ["retrodiffusion-2d-study", "retrodiffusion-mini-study", "retrodiffusion-family-depth-study"])


def jobs():
    return [{"id": "motion-"+f, "subject": f, "group": "family-loop", "title": f+" / custom idle", "type": "Provider native animation", "body": json.loads((OUT / "inputs" / (f+"-request.json")).read_text(encoding="utf-8"))} for f in FAMILIES]


def plan():
    if (OUT / "plan.json").exists():
        raise RuntimeError("Existing plan: preserve inputs and admissions; do not re-plan")
    selections = json.loads((STILLS / "selection.json").read_text(encoding="utf-8"))["selections"]
    estimates = []
    for f in FAMILIES:
        item = next(s for s in selections if s["family"] == f and s["depth"] == "sunlight")
        source = STILLS / item["logical_file"]
        raw = source.read_bytes()
        folder = OUT / "inputs"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / (f+"-source.png")).write_bytes(raw)
        rgba = Image.open(source).convert("RGBA")
        if rgba.size != (128,128):
            raise RuntimeError("Unexpected selected logical resolution")
        rgb = Image.new("RGB", rgba.size, "#243b4b")
        rgb.paste(rgba, mask=rgba.getchannel("A"))
        rgb.save(folder / (f+"-upload.png"))
        buf = io.BytesIO()
        rgb.save(buf, format="PNG")
        body = {"prompt": MOTION[f]+" "+COMMON, "prompt_style": STYLE, "width":128, "height":128, "num_images":1, "frames_duration":8, "input_image":base64.b64encode(buf.getvalue()).decode(), "remove_bg":True, "seed":6713+FAMILIES.index(f)*97}
        price = rd.request("/inferences", {**body, "check_cost":True})
        cost = rd.money(price["balance_cost"])
        if not 0 < cost <= 250_000:
            raise RuntimeError("Quote outside approved per-loop cap; no paid requests")
        rd.save(folder / (f+"-request.json"), body)
        estimates.append({"id":"motion-"+f, "cost_microdollars":cost, "source_file":str(source.relative_to(ROOT)), "source_sha256":sha(source), "upload_sha256":sha(folder / (f+"-upload.png"))})
        print(f"FREE QUOTE {f}: ${cost/1e6:.2f}", flush=True)
    total = sum(e["cost_microdollars"] for e in estimates)
    if total > LIMIT:
        raise RuntimeError("Plan exceeds authorized $1.50")
    rd.save(OUT / "plan.json", {"budget_microdollars":LIMIT, "estimated_microdollars":total, "previous_reserved_microdollars":baseline(), "jobs":estimates, "user_authorization":"User said yea to new $1.50 cap for six custom loops, octopus pilot included; no automatic retries or purchases."})


def run(which):
    planned = json.loads((OUT / "plan.json").read_text(encoding="utf-8"))
    if planned["budget_microdollars"] != LIMIT or sum(e["cost_microdollars"] for e in planned["jobs"]) > LIMIT:
        raise RuntimeError("Invalid approved plan")
    if baseline() != planned["previous_reserved_microdollars"]:
        raise RuntimeError("Prior admission ledger changed")
    ledger = json.loads((OUT / "ledger.json").read_text()) if (OUT / "ledger.json").exists() else {"reservations":{}, "actual_charges":{}}
    manifest = json.loads((OUT / "manifest.json").read_text()) if (OUT / "manifest.json").exists() else {"masters":[], "failures":[], "derivatives":[], "budget":1.50, "style":STYLE, "notes":"Six provider-generated family loops; depth variants are explicitly local palette derivatives sharing the master motion. Original stills and untouched native animation bytes retained."}
    if which == "rest":
        review = json.loads((OUT / "pilot-review.json").read_text(encoding="utf-8"))
        pilot = next(m for m in manifest["masters"] if m["subject"] == "octopus")
        if review.get("status") != "keep" or review.get("native_sha256") != pilot["sha256"]:
            raise RuntimeError("Actual octopus pilot must be approved before other paid calls")
    estimates = {e["id"]:e["cost_microdollars"] for e in planned["jobs"]}
    selected = [j for j in jobs() if (j["subject"] == "octopus") == (which == "pilot")]
    try:
        for job in selected:
            entry = next(e for e in planned["jobs"] if e["id"] == job["id"])
            if sha(ROOT / entry["source_file"]) != entry["source_sha256"]:
                raise RuntimeError("Approved source changed")
            if any(m["subject"] == job["subject"] for m in manifest["masters"]):
                continue
            accepted = rd.paid(job, ledger, estimates)
            task = rd.wait(job, accepted)
            if task["status"] == "failed":
                manifest["failures"].append({"id":job["id"], "error":task.get("error")})
                raise RuntimeError("Provider task failed; no paid retry")
            result = task["result"]
            charge = rd.money(result["balance_cost"])
            if not 0 <= charge <= ledger["reservations"][job["id"]]:
                raise RuntimeError("Provider charge exceeds reservation")
            ledger["actual_charges"][job["id"]] = charge
            rd.save(OUT / "ledger.json", ledger)
            output = rd.collect(job, result)[0]
            manifest["masters"].append(output)
            rd.save(OUT / "manifest.json", manifest)
            if output["dimensions"] != [128,128] or output["frames"] < 2:
                raise RuntimeError("Unexpected non-animated/dimension output; preserve and stop")
            frames = [frame.convert("RGBA") for frame in ImageSequence.Iterator(Image.open(OUT / output["file"]))]
            sheet = Image.new("RGB", (4*256, ((len(frames)+3)//4)*282), "#243b4b")
            draw = ImageDraw.Draw(sheet)
            for i,frame in enumerate(frames):
                x,y = i%4*256, i//4*282
                big = frame.resize((256,256), Image.Resampling.NEAREST)
                sheet.paste(big, (x,y), big)
                draw.text((x+8,y+260), f"{job['subject']} frame {i}", fill="white")
            (OUT / "review").mkdir(exist_ok=True)
            sheet.save(OUT / "review" / (job["subject"]+"-native-frames.png"))
            print(f"SAVED {job['subject']} {len(frames)} native frames", flush=True)
    finally:
        manifest["reserved_cost"] = sum(ledger["reservations"].values())/1e6
        manifest["actual_success_cost"] = sum(ledger["actual_charges"].values())/1e6
        rd.save(OUT / "manifest.json", manifest)


if __name__ == "__main__":
    action = sys.argv[1]
    if action == "plan":
        plan()
    elif action in ("pilot", "rest"):
        run(action)
    else:
        raise ValueError("Expected plan, pilot or rest")
