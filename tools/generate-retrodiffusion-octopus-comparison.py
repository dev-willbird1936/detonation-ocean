"""Generate two controlled octopus variants; six bounded paid jobs, no retries with new keys."""

import json
from pathlib import Path
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid

API = "https://api.retrodiffusion.ai/v2/lowpoly"
OUT = Path(__file__).resolve().parents[1] / "ui/abyss/models/ps1-octopus-comparison"
PROMPT = "A blue-ringed octopus for a PS1 ocean menu: golden ochre rounded mantle, electric blue ring markings, two dark eyes, exactly eight distinct curled arms with visible suckers. Hand-painted pixel textures, faceted silhouette, separate articulated arms."
ANIMATIONS = {
    "Idle": "Looping idle hover in place. Mantle gently breathes, all eight arms slowly curl and uncurl with staggered phases, tips sway softly. Keep body centered. No forward travel, no camera motion.",
    "Swim": "Looping swim in place. All eight arms draw together then fan outward in a coordinated gentle propulsion cycle, with delayed curling at the tips and subtle mantle pulses. Keep body centered. No forward travel, no camera motion.",
}
VARIANTS = [
    ("detailed", "rd_lowpoly__detailed", 0.85, 0.35),
    ("lite", "rd_lowpoly__detailed_lite", 0.10, 0.08),
]
assert len(PROMPT) <= 250 and all(len(p) <= 250 for p in ANIMATIONS.values())


def request(path, body=None, key=None):
    token = (
        (Path.home() / ".brain/secrets/retrodiffusion-api-key.txt").read_text().strip()
    )
    headers = {"X-RD-Token": token}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if key:
        headers["Idempotency-Key"] = key
    req = urllib.request.Request(
        API + path, json.dumps(body).encode() if body is not None else None, headers
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(
            f"API HTTP {error.code}: {error.read().decode()[:600]}"
        ) from None


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def paid(folder, name, path, body, cap):
    admission_path = folder / f"{name}-admission.json"
    if admission_path.exists():
        admission = json.loads(admission_path.read_text())
        assert admission["path"] == path and admission["body"] == body
    else:
        admission = {"key": str(uuid.uuid4()), "path": path, "body": body, "cap": cap}
        save(admission_path, admission)
    job_path = folder / f"{name}-job.json"
    if job_path.exists():
        return json.loads(job_path.read_text())
    if name == "generate":
        estimate_body = {"operation": "generate", **body}
    else:
        estimate_body = {"operation": "animate", "asset_id": path.split("/")[2]}
    estimate = request("/estimate", estimate_body)
    if estimate["cost"] > cap + 1e-9:
        raise RuntimeError(f"Cost exceeds approved cap: {estimate}")
    job = request(path, body, admission["key"])
    save(job_path, job)
    print(
        f"Accepted {folder.name}/{name}: ${job['cost']:.2f}, task {job['task_id']}",
        flush=True,
    )
    return job


def wait(folder, name, job):
    result_path = folder / f"{name}-status.json"
    if result_path.exists():
        task = json.loads(result_path.read_text())
        if task["status"] == "succeeded":
            return task
    last = None
    while True:
        task = request("/tasks/" + job["task_id"])
        save(result_path, task)
        status = task["status"]
        if status != last:
            print(f"{folder.name}/{name}: {status}", flush=True)
            last = status
        if status == "succeeded":
            return task
        if status == "failed":
            raise RuntimeError(
                f"Provider job failed (no automatic resubmission): {task.get('error')}"
            )
        if status not in ("pending", "running"):
            raise RuntimeError(f"Unknown job state: {status}")
        time.sleep(15)


def download(url, path):
    if not url.startswith("https://"):
        raise ValueError("Expected HTTPS output URL")
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    path.write_bytes(data)
    return data


def normalize_glb(data, mapping):
    magic, version, length = struct.unpack_from("<III", data)
    assert magic == 0x46546C67 and version == 2 and length == len(data)
    size = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20 : 20 + size])
    names = []
    for animation in doc.get("animations", []):
        animation["name"] = mapping[animation["name"]]
        names.append(animation["name"])
    assert set(names) == set(ANIMATIONS)
    encoded = json.dumps(doc, separators=(",", ":")).encode()
    encoded += b" " * ((-len(encoded)) % 4)
    rest = data[20 + size :]
    normalized = (
        struct.pack("<III", magic, version, 20 + len(encoded) + len(rest))
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + rest
    )
    return normalized, doc


def run():
    summary = {
        "prompt": PROMPT,
        "size": 64,
        "animation_prompts": ANIMATIONS,
        "comparison_note": "Identical prompts, independently generated geometry and animation curves. Local clip names normalized only.",
        "variants": [],
        "total_cost": 0,
    }
    # Deliberate order: complete Detailed before submitting Detailed Lite.
    for label, style, generate_cap, animate_cap in VARIANTS:
        folder = OUT / label
        body = {"prompt": PROMPT, "size": 64, "style": style}
        job = paid(folder, "generate", "/generate", body, generate_cap)
        wait(folder, "generate", job)
        asset_id = job["asset_id"]
        mapping = {}
        cost = job["cost"]
        for name, prompt in ANIMATIONS.items():
            animation_job = paid(
                folder,
                name.lower(),
                f"/assets/{asset_id}/animate",
                {"prompt": prompt},
                animate_cap,
            )
            task = wait(folder, name.lower(), animation_job)
            mapping[task["animation"]] = name
            cost += animation_job["cost"]
        asset = request("/assets/" + asset_id)
        save(folder / "asset.json", asset)
        export = request(f"/assets/{asset_id}/export", {"target": "web"})
        save(folder / "export.json", export)
        data = download(export["url"], folder / "provider-original.glb")
        normalized, doc = normalize_glb(data, mapping)
        (folder / "octopus.glb").write_bytes(normalized)
        version = asset["versions"][-1]
        if version.get("render_url"):
            download(version["render_url"], folder / "preview.png")
        variant = {
            "label": label,
            "style": style,
            "asset_id": asset_id,
            "cost": round(cost, 2),
            "stats": version.get("stats"),
            "bytes": len(normalized),
            "clip_names": mapping,
            "controls": sum(
                "mesh" not in n and "extensions" not in n for n in doc["nodes"]
            ),
            "mesh_parts": len(doc["meshes"]),
            "skins": len(doc.get("skins", [])),
        }
        summary["variants"].append(variant)
        summary["total_cost"] = round(summary["total_cost"] + cost, 2)
        save(OUT / "comparison.json", summary)
        print(json.dumps(variant, indent=2), flush=True)
    print(f"DONE: ${summary['total_cost']:.2f} total", flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "estimate":
        for label, style, generate_cap, animate_cap in VARIANTS:
            estimate = request(
                "/estimate",
                {"operation": "generate", "prompt": PROMPT, "size": 64, "style": style},
            )
            assert estimate["cost"] <= generate_cap + 1e-9
            print(json.dumps({"label": label, **estimate}))
    elif sys.argv[1] == "run":
        run()
    else:
        raise ValueError(sys.argv[1])
