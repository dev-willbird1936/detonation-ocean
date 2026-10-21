"""RetroDiffusion fallback for the front-facing creature stills (ocean-style-prototypes/front-batch): rd_plus__retro
img2img from the creature's existing side sprite, 128 px, $0.10 gross cap per run, price check first, no automatic retry.
  python tools/retrodiffusion-front-still.py run <id> "<extra prompt>"
"""
import base64, importlib.util, io, json, sys
from pathlib import Path
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/front-batch/retrodiffusion"
spec = importlib.util.spec_from_file_location("rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py"))
rd = importlib.util.module_from_spec(spec); spec.loader.exec_module(rd)
rd.OUT, rd.LIMIT = OUT, 10_000_000
cid, extra = sys.argv[2], sys.argv[3]
entry = {e["findingId"]: e for e in json.loads((ROOT / "data/creatures.json").read_text(encoding="utf-8"))["creatures"]}[cid]
img = Image.open(ROOT / entry["sprite"]).convert("RGBA").crop((0, 0, 128, 128))
rgb = Image.new("RGB", img.size, "#243b4b"); rgb.paste(img, mask=img.getchannel("A"))
buf = io.BytesIO(); rgb.save(buf, format="PNG")
job = {"id": f"front-{cid}", "group": "front", "subject": cid, "title": f"{entry['creature']} front", "type": "RD Plus img2img",
       "body": {"prompt": f"The same {entry['creature']} seen from the FRONT, head-on, facing the viewer, both eyes looking at the viewer, body foreshortened behind the head. {extra} Same colours and pixel-art style as the input. Single creature, transparent background, no scenery or text.",
                "prompt_style": "rd_plus__retro", "width": 128, "height": 128, "num_images": 1, "seed": 917, "input_image": base64.b64encode(buf.getvalue()).decode(),
                "strength": 0.85, "remove_bg": True}}
quote = rd.money(rd.request("/inferences", {**job["body"], "check_cost": True})["balance_cost"])
print(f"quote ${quote / 1e6:.3f}", flush=True)
if quote > 100_000: raise SystemExit("over the $0.10 cap")
led_path = OUT / "ledger.json"; OUT.mkdir(parents=True, exist_ok=True)
led = json.loads(led_path.read_text()) if led_path.exists() else {"reservations": {}, "actual_charges": {}}
task = rd.wait(job, rd.paid(job, led, {job["id"]: quote}))
if task["status"] == "failed": raise SystemExit(f"FAILED {task.get('error')}")
led["actual_charges"][job["id"]] = rd.money(task["result"]["balance_cost"]); rd.save(led_path, led)
print(json.dumps(rd.collect(job, task["result"]))[:300])
