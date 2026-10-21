"""Bounded RetroDiffusion Detailed Lite client. Never logs the API key."""

import json
from pathlib import Path
import struct
import sys
import urllib.error
import urllib.request
import uuid

API = "https://api.retrodiffusion.ai/v2/lowpoly"
OUT = (
    Path(__file__).resolve().parents[1]
    / "ui/abyss/models/ps1-anglerfish/retrodiffusion"
)
KEY = (Path.home() / ".brain/secrets/retrodiffusion-api-key.txt").read_text().strip()
PROMPT = "PS1 anglerfish, squat dark teal faceted body, huge open mouth with ivory needle teeth, small eyes, curved forehead stalk with mint glowing bulb, paired fins and fan tail. Hand-painted pixel texture. Separate jaw, tail, fins and lure for animation."
BODY = {"prompt": PROMPT, "size": 64, "style": "rd_lowpoly__detailed_lite"}


def request(path, body=None, admission=None):
    headers = {"X-RD-Token": KEY}
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
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"API HTTP {exc.code}: {exc.read().decode()[:800]}"
        ) from None


def save(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(data, indent=2), encoding="utf-8")


def paid(operation, path, body):
    state = OUT / (operation + "-admission.json")
    if state.exists():
        admission = json.loads(state.read_text())
        assert admission["body"] == body and admission["path"] == path
    else:
        admission = {"key": str(uuid.uuid4()), "path": path, "body": body}
        save(state.name, admission)
    jobfile = OUT / (operation + "-job.json")
    if jobfile.exists():
        return json.loads(jobfile.read_text())
    job = request(path, body, admission["key"])
    save(jobfile.name, job)
    return job


def download(url, filename):
    if not url.startswith("https://"):
        raise ValueError("Expected HTTPS output URL")
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read()
    if filename.endswith(".glb"):
        magic, version, length = struct.unpack("<III", data[:12])
        assert magic == 0x46546C67 and version == 2 and length == len(data)
    (OUT / filename).write_bytes(data)
    return len(data)


command = sys.argv[1]
if command == "estimate":
    print(json.dumps(request("/estimate", {"operation": "generate", **BODY}), indent=2))
elif command == "generate":
    estimate = request("/estimate", {"operation": "generate", **BODY})
    assert estimate["cost"] <= 0.10, estimate
    print(json.dumps(paid("generate", "/generate", BODY), indent=2))
elif command == "status":
    operation = sys.argv[2] if len(sys.argv) > 2 else "generate"
    job = json.loads((OUT / (operation + "-job.json")).read_text())
    task = request("/tasks/" + job["task_id"])
    save(operation + "-status.json", task)
    result = task.get("result") or {}
    versions = result.get("versions") or []
    print(
        json.dumps(
            {
                "status": task["status"],
                "asset_id": result.get("asset_id", job.get("asset_id")),
                "animation": task.get("animation"),
                "versions": [
                    {
                        "number": v["number"],
                        "rigged": v.get("rigged"),
                        "animations": v.get("animations"),
                        "stats": v.get("stats"),
                    }
                    for v in versions
                ],
                "error": task.get("error"),
            },
            indent=2,
        )
    )
elif command == "animate":
    job = json.loads((OUT / "generate-job.json").read_text())
    path = "/assets/" + job["asset_id"] + "/animate"
    body = {
        "prompt": "Looping idle swim in place: tail swishes side to side, paired fins gently paddle, lure sways softly; body stays centered, mouth slightly open. No forward travel or camera movement."
    }
    estimate = request(
        "/estimate", {"operation": "animate", "asset_id": job["asset_id"]}
    )
    assert estimate["cost"] <= 0.08, estimate
    print(json.dumps(paid("animate", path, body), indent=2))
elif command == "export":
    job = json.loads((OUT / "generate-job.json").read_text())
    result = request("/assets/" + job["asset_id"])
    save("asset.json", result)
    export = request("/assets/" + job["asset_id"] + "/export", {"target": "web"})
    save("export.json", export)
    count = download(export["url"], "anglerfish.glb")
    version = result["versions"][-1]
    if version.get("render_url"):
        download(version["render_url"], "preview.png")
    print(
        json.dumps(
            {
                "glb_bytes": count,
                "path": str(OUT / "anglerfish.glb"),
                "stats": version.get("stats"),
                "animations": version.get("animations"),
            },
            indent=2,
        )
    )
else:
    raise ValueError(command)
