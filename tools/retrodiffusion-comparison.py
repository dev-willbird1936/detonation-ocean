"""RetroDiffusion column of the image-generator comparison (ocean-style-prototypes/image-gen-comparison): the same three
prompts Codex and Antigravity got (prompts.txt), as RD Plus retro text-to-image at the 128 px game size. The only change is
that the "(style reference refs/...)" notes are dropped: text-to-image cannot read local files. $0.19 gross-admission cap;
reuses the reviewed helpers of the 2D study (price check before every paid call, reservation ledger, no automatic retries).
Free price checks: `plan`; paid: `run`.
"""

import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/image-gen-comparison/retrodiffusion"
LIMIT = 190_000  # Microdollars: the remaining balance.
spec = importlib.util.spec_from_file_location("rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py"))
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
rd.OUT = OUT
rd.LIMIT = LIMIT
STYLE = "rd_plus__retro"


def prompts():
    text = (OUT.parent / "prompts.txt").read_text(encoding="utf-8")
    style = re.search(r"^STYLE: (.+)$", text, re.M).group(1)
    targets = re.findall(r"^\d (\S+) \(style reference [^)]+\): (.+)$", text, re.M)
    return [(name, f"{style} {brief}") for name, brief in targets]


def jobs():
    return [{
        "id": f"compare-{name}", "group": "comparison", "title": f"Comparison: {name}", "subject": name,
        "type": "RD Plus text-to-image",
        "body": {"prompt": prompt, "prompt_style": STYLE, "width": 128, "height": 128, "num_images": 1, "seed": 416,
                 "remove_bg": True, "bypass_prompt_expansion": True},
    } for name, prompt in prompts()]


def plan():
    estimates, total = [], 0
    for job in jobs():
        price = rd.request("/inferences", {**job["body"], "check_cost": True})
        cost = rd.money(price["balance_cost"])
        total += cost
        estimates.append({"id": job["id"], "cost_microdollars": cost})
        print(f"{job['id']}: ${cost / 1e6:.3f} (prompt {len(job['body']['prompt'])} chars)", flush=True)
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
                manifest["failures"].append({"job_id": job["id"], "error": task.get("error")})
                print(f"FAILED {job['id']}: {task.get('error')}; no paid retry", flush=True)
                continue
            result = task["result"]
            charge = rd.money(result["balance_cost"])
            if charge > ledger["reservations"][job["id"]]:
                raise RuntimeError("Provider charged above the checked estimate; stop further submissions")
            ledger["actual_charges"][job["id"]] = charge
            rd.save(ledger_path, ledger)
            manifest["outputs"].extend(rd.collect(job, result))
    finally:
        manifest["reserved_cost"] = sum(ledger["reservations"].values()) / 1e6
        manifest["actual_success_cost"] = sum(ledger["actual_charges"].values()) / 1e6
        rd.save(OUT / "manifest.json", manifest)
    print(f"DONE: {len(manifest['outputs'])}/3 outputs; charged ${manifest['actual_success_cost']:.3f}", flush=True)


if __name__ == "__main__":
    {"plan": plan, "run": run}[sys.argv[1]]()
