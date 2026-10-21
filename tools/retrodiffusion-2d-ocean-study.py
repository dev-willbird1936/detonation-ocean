"""32-output RetroDiffusion 2D study. Hard $3.50 gross-admission cap; no automatic retries."""

import base64
from decimal import Decimal
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import time
import urllib.error
import urllib.request
import uuid

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-2d-study"
API = "https://api.retrodiffusion.ai/v2"
LIMIT = 3_500_000  # Microdollars; exact integer accounting.
SUBJECTS = {
    "octopus": "One blue-ringed octopus: rounded golden ochre mantle, two dark eyes, exactly eight distinct curled arms with suckers and electric-blue rings. Full body, readable silhouette, separate arms, generous empty margin.",
    "anglerfish": "One deep-sea anglerfish: squat dark teal body, huge open mouth with ivory needle teeth, small eyes, curved forehead stalk ending in a mint cyan glowing bulb, paired fins and fan tail. Full body, generous empty margin.",
}
STYLES = [
    (
        "minimal-silhouettes",
        "Minimal silhouettes",
        "rd_fast__1_bit",
        "Clean flat silhouette, extremely simplified filled shapes, tiny identifying features, no shading or grain; monochrome graphic icon.",
    ),
    (
        "paper-cut",
        "Layered paper-cut",
        "rd_pro__simple",
        "Layered cut-paper illustration, broad simplified teal coral gold shapes, visible paper edges, tiny soft shadows only between body layers. Flat illustration, not a sculpture or 3D render.",
    ),
    (
        "watercolor",
        "Soft watercolor",
        "rd_plus__watercolor",
        "Translucent watercolor pigment, soft expressive edges, gentle granulation inside the animal, marine anatomy and luminous small accents.",
    ),
    (
        "pixel-art",
        "Retro pixel art",
        "rd_plus__retro",
        "True 16-bit game sprite, crisp square pixel clusters, stepped contours, limited cyan teal gold coral violet palette, no smooth gradients.",
    ),
    (
        "field-guide",
        "Scientific field guide",
        "rd_pro__painterly",
        "Scientific marine specimen ink illustration, fine engraved anatomical linework, sparse pale blue teal gold wash, clear species details, no text or labels.",
    ),
    (
        "screen-print",
        "Atmospheric screen print",
        "rd_plus__textured",
        "Limited-ink screen-print illustration, bold flat graphic shapes, restrained halftone grain only inside the body, deliberate rough edges and overlapping teal indigo coral cyan inks.",
    ),
]
EXTRAS = [
    ("turnaround", "Character turnaround", "rd_plus__character_turnaround"),
    ("spritesheet", "Pose sprite sheet", "rd_pro__spritesheet"),
    ("palette-edit", "Palette-constrained img2img", "rd_plus__default"),
    ("idle-animation", "Animated idle GIF", "rd_advanced_animation__idle"),
]


def money(value):
    return int(Decimal(str(value)) * 1_000_000)


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2), encoding="utf-8")


class NoApiRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError(
            "API redirect refused; credential stays on the documented host"
        )


def request(path, body=None, admission=None):
    key = (
        (Path.home() / ".brain/secrets/retrodiffusion-api-key.txt").read_text().strip()
    )
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
        with urllib.request.build_opener(NoApiRedirect()).open(
            req, timeout=180
        ) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"API HTTP {error.code}: {error.read().decode()[:700]}"
        ) from None


def palette():
    colors = [
        "#0d1825",
        "#163b4b",
        "#216675",
        "#4b9f9c",
        "#9ed7ce",
        "#dae9df",
        "#d5a754",
        "#f0d595",
        "#836078",
        "#554d79",
        "#6ccce0",
        "#effaf0",
    ]
    image = Image.new("RGB", (len(colors) * 8, 8))
    draw = ImageDraw.Draw(image)
    for i, color in enumerate(colors):
        draw.rectangle((i * 8, 0, i * 8 + 7, 7), fill=color)
    data = io.BytesIO()
    image.save(data, format="PNG")
    return data.getvalue()


def source_image(subject, allow_placeholder):
    path = OUT / "images" / f"pixel-art-{subject}-01.png"
    if path.exists():
        image = Image.open(path).convert("RGBA")
    elif allow_placeholder:
        # Free estimates only: a real valid local image satisfies input validation.
        path = ROOT / (
            "ui/abyss/models/ps1-octopus-comparison/detailed/preview.png"
            if subject == "octopus"
            else "ui/abyss/models/ps1-anglerfish/retrodiffusion/preview.png"
        )
        image = Image.open(path).convert("RGBA")
    else:
        raise RuntimeError(f"Required generated pixel-art source missing: {path}")
    image.thumbnail((224, 224), Image.Resampling.NEAREST)
    padded = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    padded.alpha_composite(image, ((256 - image.width) // 2, (256 - image.height) // 2))
    buffer = io.BytesIO()
    padded.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode()


def jobs(allow_placeholder=False, subject_only=None):
    result = []
    selected = {
        k: v for k, v in SUBJECTS.items() if subject_only is None or k == subject_only
    }
    for group, title, style, direction in STYLES:
        for subject, brief in selected.items():
            body = {
                "prompt": f"{brief} {direction} Isolated animal on transparent background; no scenery, text, labels, panels or border.",
                "prompt_style": style,
                "width": 256,
                "height": 256,
                "num_images": 2,
                "seed": 416,
                "remove_bg": True,
                "bypass_prompt_expansion": True,
            }
            result.append(
                {
                    "id": f"{group}-{subject}",
                    "group": group,
                    "title": title,
                    "subject": subject,
                    "type": "Text-to-image",
                    "body": body,
                }
            )
    for group, title, style in EXTRAS:
        for subject, brief in selected.items():
            body = {
                "prompt": brief,
                "prompt_style": style,
                "width": 256,
                "height": 256,
                "num_images": 1,
                "seed": 416,
                "remove_bg": True,
                "bypass_prompt_expansion": True,
            }
            if group == "turnaround":
                body["prompt"] += (
                    " Character turnaround with front, side and back views of the same creature, consistent proportions. No labels."
                )
            elif group == "spritesheet":
                body["prompt"] += (
                    " A neatly spaced 2 by 2 sprite sheet of four idle and swimming poses of the same animal, identical scale and palette, no text."
                )
                body["reference_images"] = [source_image(subject, allow_placeholder)]
            elif group == "palette-edit":
                body.update(
                    input_image=source_image(subject, allow_placeholder),
                    strength=0.4,
                    input_palette=base64.b64encode(palette()).decode(),
                )
                body["prompt"] += (
                    " Preserve pose and silhouette; redraw as a clean sprite in a restrained ocean palette."
                )
            elif group == "idle-animation":
                body.update(
                    input_image=source_image(subject, allow_placeholder),
                    frames_duration=8,
                )
                body["prompt"] = (
                    "Gentle idle loop: all eight arms slowly curl with subtle mantle breathing; stays centered."
                    if subject == "octopus"
                    else "Gentle idle loop: fins paddle, tail softly swishes and the glowing lure sways; stays centered."
                )
            result.append(
                {
                    "id": f"{group}-{subject}",
                    "group": group,
                    "title": title,
                    "subject": subject,
                    "type": title,
                    "body": body,
                }
            )
    return result


def plan():
    catalog = request("/styles/selector")
    save(OUT / "style-catalog.json", catalog)
    estimates = []
    total = 0
    for job in jobs(True):
        price = request("/inferences", {**job["body"], "check_cost": True})
        cost = money(price["balance_cost"])
        total += cost
        estimates.append(
            {
                "id": job["id"],
                "cost_microdollars": cost,
                "output_count": job["body"]["num_images"],
                "style": job["body"]["prompt_style"],
            }
        )
        print(f"{job['id']}: ${cost / 1e6:.3f}", flush=True)
    if total > LIMIT:
        raise RuntimeError(
            f"Planned ${total / 1e6:.3f} exceeds $3.50; no generation submitted"
        )
    data = {
        "budget_microdollars": LIMIT,
        "estimated_microdollars": total,
        "expected_outputs": 32,
        "jobs": estimates,
    }
    save(OUT / "plan.json", data)
    print(f"PLAN: 32 outputs, ${total / 1e6:.3f}, hard cap $3.50", flush=True)


def paid(job, ledger, estimates):
    folder = OUT / "jobs" / job["id"]
    jobfile = folder / "accepted.json"
    admission_file = folder / "admission.json"
    digest = hashlib.sha256(
        json.dumps(job["body"], sort_keys=True).encode()
    ).hexdigest()
    if admission_file.exists():
        admission = json.loads(admission_file.read_text())
        if admission["body_digest"] != digest:
            raise RuntimeError("Admission inputs changed; refusing paid resubmission")
        if not jobfile.exists():
            raise RuntimeError(
                "Uncertain existing admission: reconcile with free task/activity reads; no paid POST issued"
            )
    else:
        price = request("/inferences", {**job["body"], "check_cost": True})
        cost = money(price["balance_cost"])
        if (
            cost > estimates[job["id"]]
            or sum(ledger["reservations"].values()) + cost > LIMIT
        ):
            raise RuntimeError(
                "Live price increase or budget exhaustion; refusing generation"
            )
        admission = {
            "key": str(uuid.uuid4()),
            "body_digest": digest,
            "estimated_microdollars": cost,
        }
        # Reservation persisted before a paid call. Failures and ambiguous admissions
        # remain reserved: we never spend refunded credits a second time automatically.
        ledger["reservations"][job["id"]] = cost
        save(OUT / "ledger.json", ledger)
        save(admission_file, admission)
    if jobfile.exists():
        return json.loads(jobfile.read_text())
    if job["id"] not in ledger["reservations"]:
        raise RuntimeError("Missing persisted reservation; refusing admission")
    if sum(ledger["reservations"].values()) > LIMIT:
        raise RuntimeError("Budget invariant violated; refusing admission")
    accepted = request("/inferences", job["body"], admission["key"])
    save(jobfile, accepted)
    print(
        f"Accepted {job['id']} at ${admission['estimated_microdollars'] / 1e6:.3f}",
        flush=True,
    )
    return accepted


def wait(job, accepted):
    path = OUT / "jobs" / job["id"] / "task.json"
    if path.exists():
        task = json.loads(path.read_text())
        if task["status"] in ("succeeded", "failed"):
            return task
    last = None
    while True:
        task = request("/inferences/tasks/" + accepted["task_id"])
        save(path, task)
        if task["status"] != last:
            print(f"{job['id']}: {task['status']}", flush=True)
            last = task["status"]
        if task["status"] in ("succeeded", "failed"):
            return task
        if task["status"] not in ("pending", "running"):
            raise RuntimeError(f"Unexpected task status: {task['status']}")
        time.sleep(3)


def collect(job, result):
    images = result.get("base64_images") or []
    urls = result.get("output_urls") or []
    data = [
        base64.b64decode(s.split(",", 1)[-1] if s.startswith("data:") else s)
        for s in images
    ]
    if not data:
        for url in urls:
            if isinstance(url, dict):
                url = url["url"]
            if not url.startswith("https://"):
                raise ValueError("Expected HTTPS output")
            with urllib.request.urlopen(url, timeout=180) as response:
                data.append(response.read())
    if len(data) != job["body"]["num_images"]:
        raise RuntimeError(f"Unexpected output count for {job['id']}: {len(data)}")
    entries = []
    for i, raw in enumerate(data):
        image = Image.open(io.BytesIO(raw))
        image.verify()
        image = Image.open(io.BytesIO(raw))
        suffix = "gif" if image.format == "GIF" else "png"
        filename = f"{job['id']}-{i + 1:02d}.{suffix}"
        path = OUT / "images" / filename
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)
        alpha = image.convert("RGBA").getchannel("A").getextrema()
        entries.append(
            {
                "file": "images/" + filename,
                "job_id": job["id"],
                "group": job["group"],
                "title": job["title"],
                "subject": job["subject"],
                "type": job["type"],
                "style": job["body"]["prompt_style"],
                "variation": i + 1,
                "dimensions": list(image.size),
                "frames": getattr(image, "n_frames", 1),
                "alpha_extrema": list(alpha),
                "bytes": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "prompt": job["body"]["prompt"],
                "seed": job["body"]["seed"],
                "model": result.get("model"),
            }
        )
    return entries


def run():
    planned = json.loads((OUT / "plan.json").read_text())
    if planned["estimated_microdollars"] > LIMIT:
        raise RuntimeError("Invalid plan")
    estimates = {j["id"]: j["cost_microdollars"] for j in planned["jobs"]}
    ledger_path = OUT / "ledger.json"
    ledger = (
        json.loads(ledger_path.read_text())
        if ledger_path.exists()
        else {"reservations": {}, "actual_charges": {}}
    )
    manifest = {
        "budget": 3.5,
        "expected_outputs": 32,
        "interpretation": "Pixel-art interpretations of six existing ocean directions, not exact replicas of their full-resolution art.",
        "outputs": [],
        "failures": [],
    }
    try:
        for job in jobs(True):
            # Build dependencies for this subject only; a missing anglerfish does
            # not prevent collecting unrelated octopus results.
            if job["group"] in ("spritesheet", "palette-edit", "idle-animation"):
                try:
                    job = next(
                        j for j in jobs(False, job["subject"]) if j["id"] == job["id"]
                    )
                except RuntimeError as error:
                    manifest["failures"].append(
                        {"job_id": job["id"], "error": str(error), "skipped": True}
                    )
                    print(f"SKIPPED {job['id']}: missing generated source", flush=True)
                    continue
            accepted = paid(job, ledger, estimates)
            task = wait(job, accepted)
            if task["status"] == "failed":
                manifest["failures"].append(
                    {
                        "job_id": job["id"],
                        "error": task.get("error"),
                        "reserved_microdollars": ledger["reservations"][job["id"]],
                    }
                )
                print(f"FAILED {job['id']}; no new paid retry", flush=True)
            else:
                result = task["result"]
                charge = money(result["balance_cost"])
                if charge > ledger["reservations"][job["id"]]:
                    raise RuntimeError(
                        "Provider charged above checked estimate; stop further submissions"
                    )
                ledger["actual_charges"][job["id"]] = charge
                save(ledger_path, ledger)
                manifest["outputs"].extend(collect(job, result))
            manifest["reserved_cost"] = sum(ledger["reservations"].values()) / 1e6
            manifest["actual_success_cost"] = (
                sum(ledger["actual_charges"].values()) / 1e6
            )
            save(OUT / "manifest.json", manifest)
    finally:
        manifest["reserved_cost"] = sum(ledger["reservations"].values()) / 1e6
        manifest["actual_success_cost"] = sum(ledger["actual_charges"].values()) / 1e6
        save(OUT / "manifest.json", manifest)
        if manifest["outputs"]:
            build_contact_sheet(manifest)
    print(
        f"DONE: {len(manifest['outputs'])}/32 outputs; success cost ${manifest['actual_success_cost']:.3f}; gross reserved ${manifest['reserved_cost']:.3f}",
        flush=True,
    )


def build_contact_sheet(manifest):
    outputs = manifest["outputs"]
    sheet = Image.new("RGB", (1200, math.ceil(len(outputs) / 6) * 235), "#15232e")
    draw = ImageDraw.Draw(sheet)
    for i, item in enumerate(outputs):
        x, y = (i % 6) * 200, (i // 6) * 235
        for a in range(0, 190, 10):
            for b in range(0, 190, 10):
                draw.rectangle(
                    (x + a, y + b, x + a + 9, y + b + 9),
                    fill="#344b54" if (a + b) // 10 % 2 else "#293f48",
                )
        image = Image.open(OUT / item["file"]).convert("RGBA")
        image.thumbnail((184, 184), Image.Resampling.NEAREST)
        sheet.paste(
            image, (x + (190 - image.width) // 2, y + (190 - image.height) // 2), image
        )
        draw.text((x + 4, y + 194), item["group"], fill="white")
        draw.text(
            (x + 4, y + 210), f"{item['subject']} #{item['variation']}", fill="#b7d6d2"
        )
    sheet.save(OUT / "contact-sheet.jpg", quality=92)
    import zipfile

    with zipfile.ZipFile(OUT / "all-outputs.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for item in outputs:
            archive.write(OUT / item["file"], item["file"])
        archive.write(OUT / "manifest.json", "manifest.json")
        archive.write(OUT / "contact-sheet.jpg", "contact-sheet.jpg")
        for name in ("README.md", "index.html", "gallery.js", "start-viewer.bat"):
            if (OUT / name).exists():
                archive.write(OUT / name, name)


if __name__ == "__main__":
    if sys.argv[1] == "plan":
        plan()
    elif sys.argv[1] == "run":
        run()
    elif sys.argv[1] == "package":
        build_contact_sheet(json.loads((OUT / "manifest.json").read_text()))
    else:
        raise ValueError(sys.argv[1])
