"""RetroDiffusion native animations for the depth creatures (rd_advanced_animation__custom_action, 128 px, 8 frames):

- lunge: from the creature's FRONT-facing still (ocean-style-prototypes/front-batch/game/<id>.png) it surges toward the
  viewer and bites. Played once in the ocean show when a creature eats a marked fish.
- swim: from the creature's side sprite (frame 0 of its sheet) a gentle swim loop, replacing the procedural one.

Hard $10.00 gross-admission cap across every run of this tool; price check before every paid call; reservation ledger;
no automatic retries (a reroll is a new attempt number, listed explicitly). Reuses the reviewed helpers of the 2D study.

  python tools/retrodiffusion-front-animation.py plan <kind> <id> [<id> ...]     free price quotes
  python tools/retrodiffusion-front-animation.py run  <kind> <attempt> <id> [<id> ...]
"""
import base64
import importlib.util
import io
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-front-animation"
FRONT = ROOT / "ocean-style-prototypes/front-batch/game"
LIMIT = 10_000_000  # Microdollars, gross reservations over all runs.
STYLE = "rd_advanced_animation__custom_action"
spec = importlib.util.spec_from_file_location("rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py"))
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
rd.OUT, rd.LIMIT = OUT, LIMIT

KEEP = ("Use the uploaded character's EXACT design, colours, markings and pixel-art style, no redesign, same chunky pixel size. "
        "One creature only, no scene, text, particles or camera movement. Transparent background.")
LUNGE = ("The creature, facing the viewer, surges straight toward the viewer: it grows a little larger as it comes closer, "
         "its jaws or mouth open wide, then snap shut in a bite, and it pulls back slightly. The body stays centred; nothing leaves the frame. ")
SWIM = ("Gentle seamless swimming loop in place, facing left: a small travelling wave along the body to the tail, fins paddling softly. "
        "Small motion, the body stays centred inside generous margins, returns to the starting pose with no loop jump. ")


# Attempt 2+ for lunges that showed no clear bite: the creature's own attack motion, spelled out.
BITE = {
    "encrypt": "Its eight arms whip forward toward the viewer and spread wide, its beak opens in the centre between the arms, then the arms snap shut around the viewer. Big obvious motion.",
    "spread": "The five heads rear back, then all strike forward at the viewer one after another with jaws wide open, snapping shut. Big obvious motion.",
    "injection": "The host fish opens its mouth wide and the pale isopod inside lunges out of the mouth toward the viewer with its legs spread, then pulls back in. Big obvious motion.",
    "exfil-attempt": "Its two long thin beak jaws spread wide apart toward the viewer, then snap shut together like tweezers. Big obvious motion.",
    "persistence": "It rises tall on its three stilt fins, its forward feelers spread wide toward the viewer, then it pounces down and forward, snapping its small mouth. Big obvious motion.",
    "remote-control": "The glowing colony pulses brightly from top to bottom, its trailing stinging tendrils lash out wide toward the viewer, then pull back. Big obvious motion.",
}


def roster():
    return {e["findingId"]: e for e in json.loads((ROOT / "data/creatures.json").read_text(encoding="utf-8"))["creatures"]}


def source(kind, cid):
    if kind == "lunge":
        img = Image.open(FRONT / f"{cid}.png").convert("RGBA")
    else:
        sheet = roster()[cid]["sprite"]
        img = Image.open(ROOT / sheet).convert("RGBA").crop((0, 0, 128, 128))
    if img.size != (128, 128):
        raise RuntimeError(f"{kind} source for {cid} is {img.size}, expected 128 x 128")
    rgb = Image.new("RGB", img.size, "#243b4b")
    rgb.paste(img, mask=img.getchannel("A"))
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def job(kind, cid, attempt):
    entry = roster()[cid]
    motion = BITE.get(cid, LUNGE) + " " if kind == "lunge" and attempt >= 2 else (LUNGE if kind == "lunge" else SWIM)
    prompt = motion + f"The creature is a {entry['creature']}. " + KEEP
    return {"id": f"{kind}-{cid}-a{attempt}", "group": kind, "subject": cid, "title": f"{entry['creature']} {kind}", "type": "Provider native animation",
            "body": {"prompt": prompt, "prompt_style": STYLE, "width": 128, "height": 128, "num_images": 1, "frames_duration": 8,
                     "input_image": source(kind, cid), "remove_bg": True, "seed": 4100 + 37 * attempt + sum(map(ord, cid))}}


def ledger():
    path = OUT / "ledger.json"
    return json.loads(path.read_text()) if path.exists() else {"reservations": {}, "actual_charges": {}}


def plan(kind, ids):
    total = 0
    for cid in ids:
        j = job(kind, cid, 0)
        cost = rd.money(rd.request("/inferences", {**j["body"], "check_cost": True})["balance_cost"])
        total += cost
        print(f"{kind} {cid}: ${cost / 1e6:.3f}", flush=True)
    spent = sum(ledger()["reservations"].values())
    print(f"PLAN {kind}: {len(ids)} jobs ${total / 1e6:.2f}; reserved so far ${spent / 1e6:.2f}; cap ${LIMIT / 1e6:.2f}", flush=True)


def run(kind, attempt, ids):
    led = ledger()
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {"budget": LIMIT / 1e6, "outputs": [], "failures": []}
    try:
        for cid in ids:
            j = job(kind, cid, attempt)
            if j["id"] in led["reservations"]:
                print(f"SKIP {j['id']}: already admitted", flush=True)
                continue
            quote = rd.money(rd.request("/inferences", {**j["body"], "check_cost": True})["balance_cost"])
            if sum(led["reservations"].values()) + quote > LIMIT:
                print(f"STOP before {j['id']}: ${quote / 1e6:.2f} would pass the cap", flush=True)
                break
            accepted = rd.paid(j, led, {j["id"]: quote})
            task = rd.wait(j, accepted)
            if task["status"] == "failed":
                manifest["failures"].append({"job_id": j["id"], "error": task.get("error")})
                print(f"FAILED {j['id']}: {task.get('error')}; no automatic retry", flush=True)
                continue
            charge = rd.money(task["result"]["balance_cost"])
            if charge > led["reservations"][j["id"]]:
                raise RuntimeError("Provider charged above the checked estimate; stop further submissions")
            led["actual_charges"][j["id"]] = charge
            rd.save(OUT / "ledger.json", led)
            manifest["outputs"].extend(rd.collect(j, task["result"]))
            print(f"SAVED {j['id']} (${charge / 1e6:.2f})", flush=True)
    finally:
        manifest["reserved_cost"] = sum(led["reservations"].values()) / 1e6
        manifest["actual_success_cost"] = sum(led["actual_charges"].values()) / 1e6
        rd.save(manifest_path, manifest)
        print(f"TOTAL charged ${manifest['actual_success_cost']:.2f}, reserved ${manifest['reserved_cost']:.2f}", flush=True)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    if sys.argv[1] == "plan":
        plan(sys.argv[2], sys.argv[3:])
    else:
        run(sys.argv[2], int(sys.argv[3]), sys.argv[4:])
