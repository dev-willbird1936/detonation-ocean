"""Six RD Mini sprites using only the remaining credits of the earlier $3.50 cap."""

import importlib.util
import json
from pathlib import Path
import sys
import zipfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-mini-study"
BASE = ROOT / "ocean-style-prototypes/retrodiffusion-2d-study/ledger.json"
spec = importlib.util.spec_from_file_location(
    "rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py")
)
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
rd.OUT = OUT
STYLES = [
    ("fast-low-res", "Fast Low Resolution", "rd_mini__fast_low_res"),
    ("classic", "Classic", "rd_mini__classic"),
    ("low-resolution", "Low Resolution", "rd_mini__low_res"),
]
SUBJECTS = {
    "octopus": "One blue-ringed octopus game sprite: gold rounded mantle with blue rings, eight separate curled arms, small eyes. Three-quarter view, compact readable silhouette, limited palette, crisp large pixel clusters, transparent background, no text.",
    "anglerfish": "One deep-sea anglerfish game sprite: squat teal body, large toothed mouth, small eyes, curved forehead stalk with cyan glowing bulb, fins and fan tail. Three-quarter view, compact readable silhouette, crisp large pixel clusters, transparent background, no text.",
}


def baseline():
    ledger = json.loads(BASE.read_text())
    reserved = sum(ledger["reservations"].values())
    if reserved < 0 or reserved > 3_500_000:
        raise RuntimeError("Invalid previous budget ledger")
    rd.LIMIT = 3_500_000 - reserved
    return reserved


def jobs():
    return [
        {
            "id": f"{group}-{subject}",
            "group": group,
            "title": title,
            "subject": subject,
            "type": "RD Mini text-to-image",
            "body": {
                "prompt": prompt,
                "prompt_style": style,
                "width": 64,
                "height": 64,
                "num_images": 1,
                "seed": 416,
                "remove_bg": True,
                "bypass_prompt_expansion": True,
            },
        }
        for group, title, style in STYLES
        for subject, prompt in SUBJECTS.items()
    ]


def plan():
    previous = baseline()
    estimates = []
    for job in jobs():
        price = rd.request("/inferences", {**job["body"], "check_cost": True})
        cost = rd.money(price["balance_cost"])
        estimates.append({"id": job["id"], "cost_microdollars": cost})
        print(f"{job['id']}: ${cost / 1e6:.2f}", flush=True)
    total = sum(j["cost_microdollars"] for j in estimates)
    if total > rd.LIMIT:
        raise RuntimeError(
            "Mini plan exceeds remaining original $3.50 budget; no paid requests issued"
        )
    rd.save(
        OUT / "plan.json",
        {
            "previous_microdollars": previous,
            "budget_microdollars": rd.LIMIT,
            "estimated_microdollars": total,
            "expected_outputs": 6,
            "jobs": estimates,
        },
    )
    print(
        f"PLAN: ${total / 1e6:.2f} new, ${(previous + total) / 1e6:.2f} combined <= $3.50",
        flush=True,
    )


def run():
    previous = baseline()
    planned = json.loads((OUT / "plan.json").read_text())
    if (
        planned["previous_microdollars"] != previous
        or planned["estimated_microdollars"] > rd.LIMIT
    ):
        raise RuntimeError("Baseline budget changed; redo free planning")
    estimates = {j["id"]: j["cost_microdollars"] for j in planned["jobs"]}
    ledger_path = OUT / "ledger.json"
    ledger = (
        json.loads(ledger_path.read_text())
        if ledger_path.exists()
        else {"reservations": {}, "actual_charges": {}}
    )
    manifest = {
        "budget": rd.LIMIT / 1e6,
        "combined_cap": 3.5,
        "previous_cost": previous / 1e6,
        "expected_outputs": 6,
        "outputs": [],
        "failures": [],
    }
    try:
        for job in jobs():
            if baseline() != previous:
                raise RuntimeError("Prior ledger changed; stopping new admissions")
            accepted = rd.paid(job, ledger, estimates)
            task = rd.wait(job, accepted)
            if task["status"] == "failed":
                manifest["failures"].append(
                    {"job_id": job["id"], "error": task.get("error")}
                )
            else:
                result = task["result"]
                cost = rd.money(result["balance_cost"])
                if cost > ledger["reservations"][job["id"]]:
                    raise RuntimeError("Provider cost exceeded estimate; stopping")
                ledger["actual_charges"][job["id"]] = cost
                rd.save(ledger_path, ledger)
                manifest["outputs"].extend(rd.collect(job, result))
            rd.save(OUT / "manifest.json", manifest)
    finally:
        manifest["reserved_cost"] = sum(ledger["reservations"].values()) / 1e6
        manifest["actual_success_cost"] = sum(ledger["actual_charges"].values()) / 1e6
        manifest["combined_reserved_cost"] = previous / 1e6 + manifest["reserved_cost"]
        rd.save(OUT / "manifest.json", manifest)
        if manifest["outputs"]:
            package(manifest)
    print(
        json.dumps(
            {
                "outputs": len(manifest["outputs"]),
                "mini_cost": manifest["actual_success_cost"],
                "combined_cost": manifest["combined_reserved_cost"],
                "routing": [o["model"] for o in manifest["outputs"]],
            },
            indent=2,
        )
    )


def package(manifest):
    sheet = Image.new("RGB", (900, 650), "#10232e")
    draw = ImageDraw.Draw(sheet)
    for i, item in enumerate(manifest["outputs"]):
        # Columns: Fast Low Res / Classic / Low Resolution; rows: each creature.
        x, y = (i // 2) * 300, (i % 2) * 325
        draw.rectangle((x + 18, y + 10, x + 281, y + 273), fill="#304b56")
        image = (
            Image.open(OUT / item["file"])
            .convert("RGBA")
            .resize((256, 256), Image.Resampling.NEAREST)
        )
        sheet.paste(image, (x + 22, y + 14), image)
        draw.text((x + 22, y + 282), item["title"], fill="white")
        draw.text(
            (x + 22, y + 301),
            f"{item['subject']} / native 64 x 64 / {item['model']}",
            fill="#afcfc9",
        )
    sheet.save(OUT / "contact-sheet.png")
    with zipfile.ZipFile(OUT / "all-outputs.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for item in manifest["outputs"]:
            archive.write(OUT / item["file"], item["file"])
        for name in (
            "manifest.json",
            "contact-sheet.png",
            "README.md",
            "index.html",
            "gallery.js",
            "start-viewer.bat",
        ):
            if (OUT / name).exists():
                archive.write(OUT / name, name)


if __name__ == "__main__":
    if sys.argv[1] == "plan":
        plan()
    elif sys.argv[1] == "run":
        run()
    elif sys.argv[1] == "package":
        package(json.loads((OUT / "manifest.json").read_text()))
    else:
        raise ValueError(sys.argv[1])
