"""18 RetroDiffusion stage loops for the six-family evolution line.

--prepare, --validate and --quote are free (prepare/validate are fully offline). --pilot and --remaining
spend money: $4.50 gross cap, one output per request, no retries, no automatic recovery of ambiguous
admissions, no credit purchase. Never writes API keys or image base64 to disk or logs.
"""

import argparse
import base64
import contextlib
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EVOLUTION = ROOT / "ocean-style-prototypes/codex-creature-depth-evolution"
COLORS = EVOLUTION / "depth-colors"
MANIFEST = COLORS / "depth-color-manifest.json"
# Candidate manifest from the accepted depth-colour pass; a different hash means re-plan and re-review.
MANIFEST_SHA256 = "2828e36737dba619fe691a62074a550d1a6f7e77ad0a65bc6837dfe6ca7bdf51"
OUT = EVOLUTION / "animations/iteration-01"
API = "https://api.retrodiffusion.ai/v2"
KEY_FILE = Path.home() / ".brain/secrets/retrodiffusion-api-key.txt"
STYLE = "rd_advanced_animation__custom_action"
BACKGROUND = "#243b4b"
CAP = 4_500_000  # Microdollars, gross: every reservation counts, refunds are never re-spent.
UNIT = 250_000  # Published per-loop price; live check_cost quotes decide.
QVL_GATE = 8.0
PROMPT_MAX = 1100
FORMS = ["anglerfish", "viperfish", "siphonophore", "isopod-host", "cookiecutter", "squid"]
STAGES = ["base-rich", "midnight-abyss", "trench"]
DEPTHS = ["sunlight", "twilight", "midnight", "abyss", "trench"]
STAGE_DEPTHS = {
    "base-rich": ["sunlight", "twilight"],
    "midnight-abyss": ["midnight", "abyss"],
    "trench": ["trench"],
}
DEPTH_STAGE = {d: s for s, ds in STAGE_DEPTHS.items() for d in ds}
PILOT = "squid-base-rich"
# Provisional exporter gates, pinned in the plan so the exporter and the plan cannot drift apart.
GATES = {
    "native_size": 128,
    "frames_min": 6,
    "frames_max": 16,
    "unique_frames_min": 2,
    "margin_min_px": 8,
    "shift_max_px": 6,
    "area_ratio": [0.75, 1.30],
    "iou_min": 0.60,
    "mean_colour_distance_max": 36.0,
    "far_colour_distance": 64.0,
    "far_colour_fraction_max": 0.20,
}

COMMON = (
    "Gentle seamless underwater swimming-idle loop in place. Use the uploaded character's EXACT "
    "silhouette, proportions, facing direction, anatomy, colours and pixel-art style; no redesign, no "
    "species substitution, no limb or fin changes. Extremely small motion; the whole body stays centered "
    "inside generous margins. No camera movement, rotation, zoom, scene, text or particles. Return to the "
    "starting pose with no loop jump. Transparent background."
)
MOTION = {
    "anglerfish": "Only small motions: the tail fan sways, the fins paddle gently, the lure stalk sways softly and the lure bulb pulses slightly. Head, eye, toothed jaw, gill disc and every fin stay attached in place.",
    "viperfish": "Only small motions: a gentle wave travels along the slender body into the forked tail and the fins paddle slightly. The jaw stays open with the same teeth; eye, fins and tail stay attached.",
    "siphonophore": "Only small motions: a slow traveling wave runs along the one connected colony and the tentacles sway and trail softly. Every zooid stays attached to the same stem; none detaches, none is added or removed.",
    "isopod-host": "Only small motions: the fins paddle gently and the tail swishes. The same single brown isopod stays nestled inside the open mouth; no chewing, no ejecting, no second animal.",
    "cookiecutter": "Only small motions: the tail swishes and the small fins paddle gently. The ring-shaped suction mouth and the collar band stay fixed on the head.",
    "squid": "Only small motions: the mantle breathes slightly, the terminal fin ripples, and the arms and the two long tentacles sway slowly in their own slots. Keep the same arms and both tentacles separate and attached; no added, removed or merged limbs.",
}
ANATOMY = {
    ("anglerfish", "base-rich"): "Left-facing anglerfish with a rounded teal head, one white-ringed eye, a wide toothed mouth, a ring-shaped gill disc, two orange marks on the back, blocky grey pectoral and pelvic fins, a scalloped grey fan tail, and one curved forehead stalk ending in a single orange lure bulb.",
    ("anglerfish", "midnight-abyss"): "Left-facing anglerfish with a rounded teal body, one white-ringed eye, a wide mouth full of long needle teeth, a ring-shaped gill disc, two small orange-tipped dorsal fins, pale pectoral and pelvic fins, a rayed fan tail, and one long thin forehead stalk ending in a single orange lure bulb.",
    ("anglerfish", "trench"): "Left-facing anglerfish with a scaled teal body, one white-ringed eye, a wide mouth full of long needle teeth, a ring-shaped gill disc, three tall orange-tipped dorsal spines, pale pectoral and pelvic fins, a rayed fan tail, and one long thin forehead stalk ending in a single orange lure bulb.",
    ("viperfish", "base-rich"): "Slender left-facing viperfish with a wide open jaw of long needle teeth, one white-ringed eye, a tall rayed dorsal fin, small pectoral and pelvic fins, a row of small glowing photophore dots along the flank, and a forked tail. No lure.",
    ("viperfish", "midnight-abyss"): "Slender left-facing viperfish with a wide open jaw of long needle teeth, one white-ringed eye, one thin curved lure stalk rising from behind the head, one hanging chin barbel, a tall rayed dorsal fin, small fins, rows of glowing photophore dots along the flank and underside, and a forked tail.",
    ("viperfish", "trench"): "Slender left-facing viperfish with a wide open jaw of long needle teeth, one white-ringed eye, one thin curved lure stalk rising from behind the head, one hanging chin barbel, a tall rayed dorsal fin, small fins, rows of glowing photophore dots along the flank and underside, and a frilled glowing forked tail.",
    ("siphonophore", "base-rich"): "One continuous diagonal siphonophore colony: a peach float bulb at the upper left, a thin purple stem running to the lower right, and a chain of teal zooid figures along it, each with a small head, one eye, an orange-tipped beak and short hanging tentacles with orange tips.",
    ("siphonophore", "midnight-abyss"): "One continuous diagonal siphonophore colony: a coral-brown float bulb at the upper left, a thin purple stem running to the lower right, and a chain of teal zooid figures along it, each with a small head, one eye, an orange-tipped beak and hanging tentacles with orange tips.",
    ("siphonophore", "trench"): "One continuous diagonal siphonophore colony: a large lumpy coral-brown float cluster at the top, a purple stem running down to the lower right, and a short chain of larger teal zooids along it, each with one dark eye and long curling tentacles ending in pale tips.",
    ("isopod-host", "base-rich"): "Plump left-facing host fish with a smooth banded green and grey body, one white-ringed eye, a wide open toothed mouth holding one brown segmented isopod, small pectoral and pelvic fins, and a forked tail.",
    ("isopod-host", "midnight-abyss"): "Plump left-facing host fish with a scaled teal body, a spiny dorsal fin, one white-ringed eye, a wide open toothed mouth holding one brown segmented isopod, pale pectoral and pelvic fins, and a forked tail.",
    ("isopod-host", "trench"): "Plump left-facing host fish with large overlapping teal scales, a spiny dorsal ridge, one white-ringed eye, a wide open toothed mouth holding one brown segmented isopod, pale pectoral and pelvic fins, and a forked tail.",
    ("cookiecutter", "base-rich"): "Compact left-facing cookiecutter shark swimming on a diagonal down to the right, with a blue-grey back, a pale belly, one white-ringed eye, a round orange-red ring-shaped suction mouth on the head, a red-brown collar band behind the head, a small pale dorsal fin, small pelvic fins and a forked tail.",
    ("cookiecutter", "midnight-abyss"): "Compact left-facing cookiecutter shark swimming on a diagonal down to the right, with a navy back, a pale belly, one white-ringed eye, a ring-shaped toothed suction mouth on the head, a red-orange collar band behind the head, one pale dorsal fin, small pelvic fins and a forked tail.",
    ("cookiecutter", "trench"): "Compact left-facing cookiecutter shark swimming on a diagonal down to the right, with a near-black navy back, a pale belly, one white-ringed eye, a ring-shaped toothed suction mouth with an orange rim, an orange-red collar band behind the head, a tall dorsal fin with a small second dorsal fin, small pelvic fins and a forked tail.",
    ("squid", "base-rich"): "Squid with a torpedo-shaped red-brown mantle, a small olive-yellow fin at the pointed end, a large head with one round eye, a short ruffle of blue arms, and two longer yellow-tipped tentacles; the body is diagonal with the head at the lower left.",
    ("squid", "midnight-abyss"): "Squid with a torpedo-shaped dusty-red mantle with light diagonal stripes, an olive-yellow terminal fin, a large head with one round eye, a ruffle of blue arms with yellow tips, and two longer yellow-clubbed tentacles; the body is diagonal with the head at the lower left.",
    ("squid", "trench"): "Squid with a long dark red-brown mantle marked with fine light lines, a large frilled olive-yellow terminal fin, one dark round eye, a ruffle of blue arms with yellow sucker tips, and two longer yellow-tipped tentacles; the body is diagonal with the head at the lower left.",
}
STRIP_KEYS = {"base64_images", "input_image", "input_palette", "reference_images"}
BASE64_RUN = re.compile(r"[A-Za-z0-9+/=_-]{120,}")


class AmbiguousAdmission(RuntimeError):
    """A paid POST may have been admitted. Never retried; reconcile in API Activity."""


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    return sha256_bytes(Path(path).read_bytes())


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def jload(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_new(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(path, "xb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except FileExistsError:
        raise RuntimeError(f"Output exists; not overwriting: {path}") from None


def write_json_new(path, value):
    write_new(path, (json.dumps(value, indent=2) + "\n").encode("utf-8"))


def replace_json(path, value):
    """Atomic update of mutable state (ledger, masters manifest, task progress)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    with open(temp, "wb") as handle:
        handle.write((json.dumps(value, indent=2) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp, path)


def money(value):
    if isinstance(value, bool):
        raise RuntimeError("Invalid money value")
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        raise RuntimeError("Invalid money value") from None
    if not amount.is_finite() or amount < 0:
        raise RuntimeError("Invalid money value")
    micro = amount * 1_000_000
    if micro != micro.to_integral_value():
        raise RuntimeError("Money value below one microdollar")
    return int(micro)


def usd(micro):
    return f"${micro / 1e6:.2f}"


def authorize(value):
    try:
        amount = Decimal(str(value))
    except InvalidOperation:
        amount = None
    if amount != Decimal("4.50"):
        raise RuntimeError("Paid calls need the exact authorization: --authorized-cap-usd 4.50")


def redact(text, key=None):
    if key:
        text = text.replace(key, "[redacted]")
    return BASE64_RUN.sub("[omitted]", text)[:400]


def sanitize(value):
    """Server JSON as evidence: no image payloads, no signed URL queries, bounded strings."""
    if isinstance(value, dict):
        return {k: "<omitted>" if k in STRIP_KEYS else sanitize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize(v) for v in value]
    if isinstance(value, str):
        if value.startswith(("http://", "https://")):
            return value.split("?", 1)[0]
        return redact(value)
    return value


class NoApiRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("API redirect refused; credential stays on the documented host")


def read_key():
    try:
        key = KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        raise RuntimeError("RetroDiffusion API key file unreadable") from None
    if not key:
        raise RuntimeError("RetroDiffusion API key file is empty")
    return key


def request(path, body=None, admission=None):
    key = read_key()
    headers = {"X-RD-Token": key}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if admission:
        headers["Idempotency-Key"] = admission
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
    )
    try:
        with urllib.request.build_opener(NoApiRedirect()).open(req, timeout=180) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"API HTTP {error.code}: {redact(error.read().decode(errors='replace'), key)}"
        ) from None
    except RuntimeError:
        raise
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise RuntimeError(f"API request failed: {type(error).__name__}") from None


def live_quote(loop):
    """Free check_cost quote in microdollars. Never generates."""
    price = request("/inferences", {**body_for(loop), "check_cost": True})
    cost = money(price.get("balance_cost"))
    if cost <= 0:
        raise RuntimeError(f"Unusable quote for {loop['id']}")
    return cost


def check_price(loop, cost):
    if cost > loop["estimate_microdollars"]:
        raise RuntimeError(
            f"Live price increase for {loop['id']}: {usd(cost)} > {usd(loop['estimate_microdollars'])}; nothing submitted"
        )


def live_balance():
    """Live USD balance in microdollars. The `credits` field is a separate unit and is ignored."""
    reply = request("/inferences/credits")
    if "balance" not in reply:
        raise RuntimeError("Credits reply has no USD balance; credits are not dollars; nothing submitted")
    return money(reply["balance"])


def committed(ledger):
    return sum(ledger["reservations"].values())


def require_funded(label, gross, total, balance):
    if gross + total > CAP:
        raise RuntimeError(
            f"{label}: gross reserved {usd(gross)} + quotes {usd(total)} exceeds the authorized {usd(CAP)} cap; nothing submitted"
        )
    if balance < total:
        raise RuntimeError(
            f"{label}: live USD balance {usd(balance)} is below the {usd(total)} needed for the entire remaining plan; "
            "nothing submitted; fund the balance manually (no purchase, refill or top-up is attempted)"
        )


# ---------------------------------------------------------------- plan (offline)


def build_loops(manifest):
    sources = {s["id"]: s for s in manifest["sources"]}
    loops = []
    for fi, form in enumerate(FORMS):
        for si, stage in enumerate(STAGES):
            source = sources[f"{form}-{stage}"]
            if source["form"] != form or source["stage"] != stage:
                raise RuntimeError(f"Manifest source {source['id']} does not match {form}/{stage}")
            path = COLORS / source["file"]
            data = path.read_bytes()
            if sha256_bytes(data) != source["sha256"]:
                raise RuntimeError(f"Source hash mismatch: {source['file']}")
            image = Image.open(io.BytesIO(data))
            if image.size != (128, 128) or image.mode != "RGBA":
                raise RuntimeError(f"Source is not 128x128 RGBA: {source['file']}")
            index = fi * len(STAGES) + si
            seed = 7100 + 97 * index
            prompt = f"{ANATOMY[(form, stage)]} {MOTION[form]} {COMMON}"
            loops.append(
                {
                    "id": f"{form}-{stage}",
                    "form": form,
                    "stage": stage,
                    "index": index,
                    "depths": STAGE_DEPTHS[stage],
                    "source_id": source["id"],
                    "source_file": source["file"],
                    "source_sha256": source["sha256"],
                    "upload_pixels_sha256": sha256_bytes(upload_rgb_image(image).tobytes()),
                    "seed": seed,
                    "prompt": prompt,
                    "prompt_sha256": sha256_bytes(prompt.encode()),
                    "request": {
                        "prompt": prompt,
                        "prompt_style": STYLE,
                        "width": 128,
                        "height": 128,
                        "num_images": 1,
                        "frames_duration": 8,
                        "remove_bg": True,
                        "seed": seed,
                    },
                    "input_image": f"RGB upload of {source['file']} composited on {BACKGROUND}; built at call time, never stored",
                    "output_file": f"masters/{form}-{stage}-native.gif",
                    "estimate_microdollars": UNIT,
                }
            )
    return loops


def build_mappings(manifest):
    mappings = []
    for variant in manifest["variants"]:
        stage = DEPTH_STAGE[variant["depth"]]
        if variant["stage"] != stage or variant["source_id"] != f"{variant['form']}-{stage}":
            raise RuntimeError(f"Manifest variant {variant['id']} breaks the depth to stage mapping")
        if sha256_file(COLORS / variant["file"]) != variant["sha256"]:
            raise RuntimeError(f"Variant hash mismatch: {variant['file']}")
        mappings.append(
            {
                "id": variant["id"],
                "form": variant["form"],
                "depth": variant["depth"],
                "loop": variant["source_id"],
                "variant_file": variant["file"],
                "variant_sha256": variant["sha256"],
            }
        )
    order = {f: i for i, f in enumerate(FORMS)}
    return sorted(mappings, key=lambda m: (order[m["form"]], DEPTHS.index(m["depth"])))


def upload_rgb_image(rgba):
    rgb = Image.new("RGB", rgba.size, BACKGROUND)
    rgb.paste(rgba, mask=rgba.getchannel("A"))
    return rgb


def build_plan():
    if sha256_file(MANIFEST) != MANIFEST_SHA256:
        raise RuntimeError("Depth-colour manifest changed since the plan was pinned; re-plan and re-review")
    manifest = jload(MANIFEST)
    if manifest.get("schema") != "evolution-depth-colors-v1" or manifest["counts"]["sources"] != 18 or manifest["counts"]["variants"] != 30:
        raise RuntimeError("Unexpected depth-colour manifest")
    loops = build_loops(manifest)
    mappings = build_mappings(manifest)
    plan = {
        "schema": "evolution-stage-animation-plan-v1",
        "status": "prepared-not-generated",
        "provider": "retrodiffusion",
        "endpoint": "POST /v2/inferences",
        "style": STYLE,
        "cap_microdollars": CAP,
        "unit_estimate_microdollars": UNIT,
        "estimated_microdollars": UNIT * len(loops),
        "estimate_basis": "Published unit price; every paid call is guarded by a fresh live check_cost quote.",
        "depth_manifest": {"file": "depth-colors/depth-color-manifest.json", "sha256": MANIFEST_SHA256},
        "pilot": PILOT,
        "stage_depths": STAGE_DEPTHS,
        "loops": loops,
        "variants": mappings,
        "gates": GATES,
        "gates_note": "Provisional exporter gates; a failing master is preserved and the export stops.",
    }
    problems = plan_problems(plan)
    if problems:
        raise RuntimeError("Plan invalid: " + "; ".join(problems))
    return json.loads(json.dumps(plan))


def plan_problems(plan):
    loops, problems = plan["loops"], []
    ids = [l["id"] for l in loops]
    if ids != [f"{f}-{s}" for f in FORMS for s in STAGES] or len(set(ids)) != 18:
        problems.append("loop ids are not the 18 form x stage pairs")
    if len({l["seed"] for l in loops}) != 18:
        problems.append("seeds are not unique")
    if len({l["prompt"] for l in loops}) != 18:
        problems.append("prompts are not unique")
    if len(plan["variants"]) != 30 or len({v["id"] for v in plan["variants"]}) != 30:
        problems.append("variants are not 30 unique ids")
    if sum(l["estimate_microdollars"] for l in loops) != plan["estimated_microdollars"] or plan["estimated_microdollars"] > CAP:
        problems.append("estimate exceeds the cap")
    if PILOT not in ids:
        problems.append("pilot loop missing")
    for loop in loops:
        if len(loop["prompt"]) > PROMPT_MAX:
            problems.append(f"{loop['id']} prompt too long")
    if "octopus" in json.dumps(plan).lower():
        problems.append("octopus reference present")
    return problems


def plan_path():
    return OUT / "plan.json"


def load_plan():
    data = plan_path().read_bytes()
    return json.loads(data), sha256_bytes(data)


def verify_plan(plan):
    if plan != build_plan():
        raise RuntimeError("plan.json differs from the pinned sources, manifest or definitions; do not generate")


def prepare():
    if plan_path().exists():
        raise RuntimeError(f"Plan exists; not overwriting: {plan_path()}")
    plan = build_plan()
    write_json_new(plan_path(), plan)
    print(f"PREPARED {len(plan['loops'])} loops, {len(plan['variants'])} variants, estimate {usd(plan['estimated_microdollars'])}, cap {usd(CAP)}; nothing generated", flush=True)


def validate():
    plan, digest = load_plan()
    verify_plan(plan)
    print(f"VALID plan.json sha256 {digest}: {len(plan['loops'])} loops, {len(plan['variants'])} variants; offline", flush=True)


# ---------------------------------------------------------------- requests, state


def body_for(loop):
    path = COLORS / loop["source_file"]
    data = path.read_bytes()
    if sha256_bytes(data) != loop["source_sha256"]:
        raise RuntimeError(f"Approved source changed: {loop['source_file']}")
    rgb = upload_rgb_image(Image.open(io.BytesIO(data)).convert("RGBA"))
    if rgb.size != (128, 128) or sha256_bytes(rgb.tobytes()) != loop["upload_pixels_sha256"]:
        raise RuntimeError(f"Upload differs from the plan: {loop['id']}")
    buffer = io.BytesIO()
    rgb.save(buffer, format="PNG")
    return {**loop["request"], "input_image": base64.b64encode(buffer.getvalue()).decode()}


def job_dir(loop_id):
    return OUT / "jobs" / loop_id


def master_path(loop):
    return OUT / loop["output_file"]


def load_ledger(plan_sha):
    path = OUT / "ledger.json"
    if not path.exists():
        return {"schema": "evolution-stage-ledger-v1", "cap_microdollars": CAP, "plan_sha256": plan_sha, "reservations": {}, "actual_charges": {}}
    ledger = jload(path)
    if ledger.get("plan_sha256") != plan_sha or ledger.get("cap_microdollars") != CAP:
        raise RuntimeError("Ledger belongs to a different plan or cap")
    return ledger


def save_ledger(ledger):
    replace_json(OUT / "ledger.json", ledger)


def load_masters(plan_sha):
    path = OUT / "manifest.json"
    if not path.exists():
        return {"schema": "evolution-stage-masters-v1", "plan_sha256": plan_sha, "status": "candidate", "masters": [], "failures": []}
    masters = jload(path)
    if masters.get("plan_sha256") != plan_sha:
        raise RuntimeError("Masters manifest belongs to a different plan")
    return masters


def save_masters(masters, ledger):
    masters["reserved_cost_usd"] = committed(ledger) / 1e6
    masters["actual_cost_usd"] = sum(ledger["actual_charges"].values()) / 1e6
    replace_json(OUT / "manifest.json", masters)


def job_state(loop, masters):
    folder = job_dir(loop["id"])
    if any(m["id"] == loop["id"] for m in masters["masters"]):
        return "complete"
    if (folder / "failed.json").exists():
        return "failed"
    if (folder / "ambiguous.json").exists() or (
        (folder / "admission.json").exists() and not (folder / "accepted.json").exists()
    ):
        return "ambiguous"
    if master_path(loop).exists():
        raise RuntimeError(f"Output exists without a manifest entry; not overwriting: {master_path(loop)}")
    return "accepted" if (folder / "accepted.json").exists() else "none"


@contextlib.contextmanager
def run_lock():
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "run.lock"
    try:
        handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise RuntimeError(f"Another run holds {path}; if none is running, reconcile manually before removing it") from None
    try:
        yield
    finally:
        os.close(handle)
        path.unlink()


def wait_task(task_id, polls=240):
    errors = 0
    for _ in range(polls):
        try:
            task = request("/inferences/tasks/" + task_id)
        except RuntimeError:
            errors += 1
            if errors >= 5:
                raise
            time.sleep(3)
            continue
        errors = 0
        status = task.get("status")
        if status in ("succeeded", "failed"):
            return task
        if status not in ("pending", "running"):
            raise RuntimeError(f"Unexpected task status: {status!r}")
        time.sleep(3)
    raise RuntimeError("Task still running; re-run the same command to keep polling; no new submission is made")


def collect(loop, result):
    images = result.get("base64_images") or []
    urls = result.get("output_urls") or []
    try:
        data = [base64.b64decode(s.split(",", 1)[-1] if s.startswith("data:") else s) for s in images]
        if not data:
            for url in urls:
                url = url["url"] if isinstance(url, dict) else url
                if not url.startswith("https://"):
                    raise RuntimeError("Expected an HTTPS output URL")
                with urllib.request.urlopen(url, timeout=180) as response:
                    data.append(response.read(20_000_000))
    except (ValueError, OSError):
        raise RuntimeError(f"Output for {loop['id']} could not be decoded or downloaded; charge is recorded; stopping") from None
    if len(data) != 1:
        raise RuntimeError(f"Unexpected output count for {loop['id']}: {len(data)}")
    return data[0]


def native_report(raw):
    try:
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))
        return {"format": image.format, "dimensions": list(image.size), "frames": getattr(image, "n_frames", 1)}
    except Exception:
        return {"format": "unreadable", "dimensions": [0, 0], "frames": 0}


def finish(loop, ledger, masters, plan_sha):
    """Poll a known task and collect its single output. Never POSTs."""
    folder = job_dir(loop["id"])
    accepted = jload(folder / "accepted.json")
    if loop["id"] not in ledger["reservations"]:
        raise RuntimeError(f"Missing persisted reservation for {loop['id']}; refusing")
    task = wait_task(accepted["task_id"])
    replace_json(folder / "task.json", sanitize(task))
    if task["status"] == "failed":
        write_json_new(folder / "failed.json", {"loop_id": loop["id"], "error": sanitize(task.get("error")), "recorded": utc_now()})
        masters["failures"].append({"id": loop["id"], "error": sanitize(task.get("error"))})
        save_masters(masters, ledger)
        raise RuntimeError(f"Provider task failed for {loop['id']}; no paid retry; reservation stays reserved; reconcile in API Activity")
    result = task.get("result") or {}
    try:
        charge = money(result["balance_cost"])
    except KeyError:
        raise RuntimeError(f"Task result for {loop['id']} has no balance_cost; stopping") from None
    ledger["actual_charges"][loop["id"]] = charge
    save_ledger(ledger)
    raw = collect(loop, result)
    out = master_path(loop)
    write_new(out, raw)  # Preserved even if it later fails a gate.
    report = native_report(raw)
    entry = {
        "id": loop["id"],
        "form": loop["form"],
        "stage": loop["stage"],
        "file": loop["output_file"],
        "sha256": sha256_bytes(raw),
        "bytes": len(raw),
        **report,
        "seed": loop["seed"],
        "prompt_sha256": loop["prompt_sha256"],
        "task_id": accepted["task_id"],
        "model": result.get("model"),
        "quote_microdollars": ledger["reservations"][loop["id"]],
        "charge_microdollars": charge,
        "plan_sha256": plan_sha,
    }
    masters["masters"].append(entry)
    save_masters(masters, ledger)
    if report["format"] != "GIF" or report["dimensions"] != [128, 128] or report["frames"] < 2:
        masters["failures"].append({"id": loop["id"], "error": "native output is not a 128x128 multi-frame GIF", "report": report})
        save_masters(masters, ledger)
        raise RuntimeError(f"Native output for {loop['id']} failed its gate; preserved; stopping")
    if charge > ledger["reservations"][loop["id"]] or sum(ledger["actual_charges"].values()) > CAP:
        masters["failures"].append({"id": loop["id"], "error": "charge exceeds quote or cap", "charge_microdollars": charge})
        save_masters(masters, ledger)
        raise RuntimeError(f"Provider charged {usd(charge)} for {loop['id']}, above its quote or the cap; output preserved; no further submissions")
    print(f"SAVED {loop['id']}: {report['frames']} frames, charge {usd(charge)}", flush=True)


def submit(loop, start_quote, later, ledger, masters, plan_sha):
    folder = job_dir(loop["id"])
    if master_path(loop).exists() or (folder / "admission.json").exists():
        raise RuntimeError(f"{loop['id']} already has output or an admission; not submitting")
    quote = live_quote(loop)  # Fresh for every paid call.
    check_price(loop, quote)
    if quote > start_quote:
        raise RuntimeError(f"Live price rose during the run for {loop['id']}; nothing more submitted")
    require_funded(loop["id"], committed(ledger), quote + later, live_balance())
    body = body_for(loop)
    admission = {
        "schema": "evolution-stage-admission-v1",
        "loop_id": loop["id"],
        "idempotency_key": str(uuid.uuid4()),
        "body_sha256": sha256_bytes(json.dumps(body, sort_keys=True).encode()),
        "quote_microdollars": quote,
        "plan_sha256": plan_sha,
        "reserved": utc_now(),
    }
    # Reservation and idempotency record are durable before the POST. Failures stay reserved.
    write_json_new(folder / "admission.json", admission)
    ledger["reservations"][loop["id"]] = quote
    save_ledger(ledger)
    try:
        accepted = request("/inferences", body, admission["idempotency_key"])
        task_id = accepted.get("task_id") if isinstance(accepted, dict) else None
        if not isinstance(task_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", task_id):
            raise RuntimeError("Accepted reply has no usable task id")
    except Exception as error:
        write_json_new(folder / "ambiguous.json", {"loop_id": loop["id"], "error": redact(str(error)), "recorded": utc_now()})
        raise AmbiguousAdmission(
            f"Paid POST for {loop['id']} ended without a usable task: it may have been admitted. Not retried. "
            f"Reconcile manually in API Activity ({folder / 'ambiguous.json'})"
        ) from None
    write_json_new(folder / "accepted.json", sanitize(accepted))
    print(f"ACCEPTED {loop['id']} reserved {usd(quote)}", flush=True)
    finish(loop, ledger, masters, plan_sha)


def read_qvl(path, scope, plan_sha, expected):
    """A passing QVL record, bound to hashes. Anything missing or different is a refusal."""
    path = Path(path)
    if not path.exists():
        raise RuntimeError(f"QVL record missing: {path}")
    record = jload(path)
    overall = record.get("overall")
    if (
        record.get("schema") != "evolution-stage-qvl-v1"
        or record.get("scope") != scope
        or record.get("status") != "accept"
        or isinstance(overall, bool)
        or not isinstance(overall, (int, float))
        or overall <= QVL_GATE
        or record.get("plan_sha256") != plan_sha
    ):
        raise RuntimeError(f"QVL record is not a passing {scope} acceptance for this plan: {path}")
    for key, value in expected.items():
        if record.get(key) != value:
            raise RuntimeError(f"QVL record is not bound to the current {key}: {path}")
    return record


def pilot_qvl_path():
    return OUT / f"qvl/pilot-{PILOT}.json"


def final_qvl_path():
    return OUT / "qvl/final-18-loops.json"


def require_pilot_acceptance(plan_sha, masters):
    entry = next((m for m in masters["masters"] if m["id"] == PILOT), None)
    if entry is None:
        raise RuntimeError("Pilot has not run; run --pilot first")
    file_hash = sha256_file(OUT / entry["file"])
    if file_hash != entry["sha256"]:
        raise RuntimeError("Pilot master changed since it was recorded")
    read_qvl(pilot_qvl_path(), "pilot", plan_sha, {"loop_id": PILOT, "native_sha256": file_hash})


def quote_command():
    plan, digest = load_plan()
    verify_plan(plan)
    quotes = {}
    for loop in plan["loops"]:
        quotes[loop["id"]] = live_quote(loop)
        print(f"QUOTE {loop['id']}: {usd(quotes[loop['id']])}", flush=True)
    balance = live_balance()
    total = sum(quotes.values())
    over = [i for i, c in quotes.items() if c > UNIT]
    funded = not over and total <= CAP and balance >= total
    report = {
        "schema": "evolution-stage-quote-v1",
        "plan_sha256": digest,
        "quoted": utc_now(),
        "quotes_microdollars": quotes,
        "total_microdollars": total,
        "cap_microdollars": CAP,
        "usd_balance_microdollars": balance,
        "over_estimate": over,
        "funded": funded,
    }
    write_json_new(OUT / f"quotes/quote-{report['quoted'].replace(':', '')}.json", report)
    print(f"TOTAL {usd(total)} vs cap {usd(CAP)}; live USD balance {usd(balance)}", flush=True)
    if not funded:
        print("NOT FUNDED: generation would refuse; nothing was generated", flush=True)
        return 2
    print("FUNDED: the complete batch fits the cap and the balance (nothing was generated)", flush=True)
    return 0


def run(which, authorized):
    authorize(authorized)
    plan, plan_sha = load_plan()
    verify_plan(plan)
    with run_lock():
        ledger, masters = load_ledger(plan_sha), load_masters(plan_sha)
        loops = plan["loops"]
        state = {l["id"]: job_state(l, masters) for l in loops}
        for loop_id, value in state.items():
            if value in ("failed", "ambiguous"):
                raise RuntimeError(f"{loop_id} is {value}: no retry or recovery; reconcile in API Activity first")
        if which == "pilot":
            if state[PILOT] == "complete":
                raise RuntimeError("Pilot already complete; run --remaining after a hash-bound pilot QVL acceptance")
            if any(v != "none" for i, v in state.items() if i != PILOT):
                raise RuntimeError("Pilot must run before any other loop")
            selected = [l for l in loops if l["id"] == PILOT]
        else:
            require_pilot_acceptance(plan_sha, masters)
            selected = [l for l in loops if l["id"] != PILOT]
        for loop in [l for l in selected if state[l["id"]] == "accepted"]:
            finish(loop, ledger, masters, plan_sha)  # Known task: polling only.
        fresh = [l for l in selected if state[l["id"]] == "none"]
        scope = [l for l in loops if state[l["id"]] == "none"]  # Whole unsubmitted plan must stay fundable.
        if not fresh:
            print("Nothing to submit.", flush=True)
            return
        quotes = {l["id"]: live_quote(l) for l in scope}
        for loop in scope:
            check_price(loop, quotes[loop["id"]])
        require_funded(f"{which} batch", committed(ledger), sum(quotes.values()), live_balance())
        for loop in fresh:
            later = sum(quotes[l["id"]] for l in scope if l["index"] > loop["index"])
            submit(loop, quotes[loop["id"]], later, ledger, masters, plan_sha)
        print(f"DONE {which}: {len(masters['masters'])}/18 native masters; gross reserved {usd(committed(ledger))}; spent {usd(sum(ledger['actual_charges'].values()))}", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare", action="store_true", help="offline: write plan.json (refuses to overwrite)")
    mode.add_argument("--validate", action="store_true", help="offline: re-check plan.json against sources")
    mode.add_argument("--quote", action="store_true", help="free: 18 check_cost quotes + credits; never generates")
    mode.add_argument("--pilot", action="store_true", help="PAID: Squid Base only, one call")
    mode.add_argument("--remaining", action="store_true", help="PAID: 17 sequential calls after a pilot QVL acceptance")
    parser.add_argument("--authorized-cap-usd", help="must be exactly 4.50 for paid calls")
    args = parser.parse_args(argv)
    try:
        if args.prepare:
            prepare()
        elif args.validate:
            validate()
        elif args.quote:
            return quote_command()
        else:
            run("pilot" if args.pilot else "remaining", args.authorized_cap_usd)
    except RuntimeError as error:
        print(f"STOPPED: {redact(str(error))}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
