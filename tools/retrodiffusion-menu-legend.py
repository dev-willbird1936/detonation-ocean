"""Six RetroDiffusion legend sprites for the main-menu pixel theme. $0.60 gross-admission cap; no automatic retries.

The six legend species without an existing family sprite: mimic octopus, sea lamprey, barreleye, cuttlefish,
moray eel and gulper eel. Reuses the reviewed helpers of the earlier 2D study (price check before every paid call,
reservation ledger, idempotency key, refusal of uncertain admissions). Free price checks: `plan`; paid: `run`.
"""

import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-menu-legend"
LIMIT = 600_000  # Microdollars.
spec = importlib.util.spec_from_file_location(
    "rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py")
)
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
rd.OUT = OUT
rd.LIMIT = LIMIT

STYLE = "rd_plus__retro"
SUFFIX = (
    " Isolated single creature on a transparent background, 16-bit game sprite, crisp square pixel clusters, "
    "stepped contours, restrained deep-sea palette of dark teal, navy, cyan and cream with a dark outline, "
    "no scenery, no text, no border."
)
SUBJECTS = {
    "bec": "One mimic octopus: rounded mantle and eight flowing arms banded in cream and dark brown stripes, two small eyes, side view, compact readable silhouette.",
    "card-fraud": "One sea lamprey: long slender eel-like olive teal body with mottled spots, round sucker-disc mouth ringed with many small ivory teeth, small eye, gentle S-curve, side view.",
    "espionage": "One barreleye fish: dark navy teal body, transparent glassy dome head with two upward-pointing green tubular eyes visible inside it, small fins and forked tail, side view.",
    "social": "One cuttlefish: oval teal mantle with a wavy fin skirt along both sides, W-shaped pupils, eight short arms and two longer feeding tentacles, bands of colour rolling over its skin, three-quarter view.",
    "vulnerability": "One moray eel peeking out of a dark rocky crevice: mottled olive green head and neck with open toothed jaws coming out of the rock hole, side view.",
    "wiper": "One gulper eel: small body with an enormous loose open mouth pouch, thin whip-like tail ending in a glowing pink-white light tip, dark teal, side view.",
}


def jobs():
    return [
        {
            "id": f"legend-{vector}",
            "group": "legend-sprite",
            "title": f"Legend sprite: {vector}",
            "subject": vector,
            "type": "RD Plus text-to-image",
            "body": {
                "prompt": brief + SUFFIX,
                "prompt_style": STYLE,
                "width": 128,
                "height": 128,
                "num_images": 1,
                "seed": 416,
                "remove_bg": True,
                "bypass_prompt_expansion": True,
            },
        }
        for vector, brief in SUBJECTS.items()
    ]


def plan():
    estimates, total = [], 0
    for job in jobs():
        price = rd.request("/inferences", {**job["body"], "check_cost": True})
        cost = rd.money(price["balance_cost"])
        total += cost
        estimates.append({"id": job["id"], "cost_microdollars": cost})
        print(f"{job['id']}: ${cost / 1e6:.3f}", flush=True)
    if total > LIMIT:
        raise RuntimeError(f"Planned ${total / 1e6:.3f} exceeds the cap; no generation submitted")
    rd.save(OUT / "plan.json", {"budget_microdollars": LIMIT, "estimated_microdollars": total, "jobs": estimates})
    print(f"PLAN: {len(estimates)} images, ${total / 1e6:.3f}, cap ${LIMIT / 1e6:.2f}", flush=True)


def run():
    planned = json.loads((OUT / "plan.json").read_text())
    if planned["estimated_microdollars"] > LIMIT:
        raise RuntimeError("Invalid plan")
    estimates = {j["id"]: j["cost_microdollars"] for j in planned["jobs"]}
    ledger_path = OUT / "ledger.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {"reservations": {}, "actual_charges": {}}
    manifest = {"budget": LIMIT / 1e6, "style": STYLE, "outputs": [], "failures": []}
    try:
        for job in jobs():
            accepted = rd.paid(job, ledger, estimates)
            task = rd.wait(job, accepted)
            if task["status"] == "failed":
                manifest["failures"].append({"job_id": job["id"], "error": task.get("error"), "reserved_microdollars": ledger["reservations"][job["id"]]})
                print(f"FAILED {job['id']}; no new paid retry", flush=True)
            else:
                result = task["result"]
                charge = rd.money(result["balance_cost"])
                if charge > ledger["reservations"][job["id"]]:
                    raise RuntimeError("Provider charged above the checked estimate; stop further submissions")
                ledger["actual_charges"][job["id"]] = charge
                rd.save(ledger_path, ledger)
                manifest["outputs"].extend(rd.collect(job, result))
            manifest["reserved_cost"] = sum(ledger["reservations"].values()) / 1e6
            manifest["actual_success_cost"] = sum(ledger["actual_charges"].values()) / 1e6
            rd.save(OUT / "manifest.json", manifest)
    finally:
        manifest["reserved_cost"] = sum(ledger["reservations"].values()) / 1e6
        manifest["actual_success_cost"] = sum(ledger["actual_charges"].values()) / 1e6
        rd.save(OUT / "manifest.json", manifest)
    print(f"DONE: {len(manifest['outputs'])}/{len(SUBJECTS)} outputs; success cost ${manifest['actual_success_cost']:.3f}; gross reserved ${manifest['reserved_cost']:.3f}", flush=True)


if __name__ == "__main__":
    {"plan": plan, "run": run}[sys.argv[1]]()
