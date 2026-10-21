"""Pose stills of the existing agent octopus (ui/abyss/pixel/creatures/octopus-sunlight-spritesheet.png, frame 0) made with
Gemini image editing, for the ocean show (ui/job/ocean-show.mjs). The reference goes in on flat magenta, which is keyed out
later. Originals and every attempt stay in ocean-style-prototypes/gemini-octopus-poses with a report entry.

  python tools/gemini-octopus-poses.py generate <pose> [<pose> ...]   one new attempt per pose (paid call, no retries)
"""
import base64
import datetime
import hashlib
import io
import json
import pathlib
import sys
import urllib.error
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/gemini-octopus-poses"
MODEL = "gemini-3-pro-image"
SHEET = ROOT / "ui/abyss/pixel/creatures/octopus-sunlight-spritesheet.png"
KEY_COLOUR = (255, 0, 255)

COMMON = (
    "Edit this pixel-art game sprite. Keep it the SAME octopus character: identical retro pixel-art style, identical chunky pixel size, "
    "identical teal-green colours and darker teal shading, the same cream and gold sucker dots along the arms, the same dark outline, "
    "the same rounded mantle seen from above with two small dark eyes near its base, and the same body size. "
    "It must have exactly EIGHT arms, all attached to the body, each with a curled tip. Change ONLY the pose, as described: {pose} "
    "One octopus only, centred with a generous empty margin. Keep the background a single solid flat magenta (#FF00FF) everywhere, "
    "with no gradient, shadow, scenery, bubbles, text or border. Square image."
)
POSES = {
    "swim": "It jet-swims to the LEFT: the mantle leads on the left side, and all eight arms trail together behind it to the right, close together and gently wavy.",
    "reach": "The two arms on its LEFT side stretch far out to the left, almost straight, with their tips curled as if about to grab something. The other six arms stay relaxed as in the original.",
    "carry": "The two arms on its LEFT side curl together in front of the body, at the lower left, holding a small white paper document (a page with a folded top corner, grey text lines and a yellow label stripe). The paper is clearly held in the curled tips. The other six arms stay relaxed.",
    "pry": "Four arms stretch straight DOWN below the body, their tips gripping and pulling as if lifting something heavy underneath. The other four arms spread up and outward for leverage.",
    "type": "Two arms on its LEFT side reach out to the left with their tips bent down and touching, as if tapping on a keyboard. The other six arms stay relaxed.",
    "wave": "One arm on its RIGHT side is raised high and curled, waving hello. The other seven arms stay relaxed as in the original.",
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def reference_png():
    frame = Image.open(SHEET).convert("RGBA").crop((0, 0, 128, 128)).resize((512, 512), Image.Resampling.NEAREST)
    base = Image.new("RGBA", frame.size, KEY_COLOUR + (255,))
    base.alpha_composite(frame)
    buf = io.BytesIO()
    base.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def call(prompt, image):
    key = (pathlib.Path.home() / ".brain/secrets/gemini-api-key.txt").read_text().strip()
    body = {
        "contents": [{"parts": [{"text": prompt}, {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(image).decode()}}]}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "1:1"}},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(), headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Gemini HTTP {error.code}: {error.read().decode()[:600]}") from None


def generate(poses):
    OUT.mkdir(parents=True, exist_ok=True)
    report_path = OUT / "generation-report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {"model": MODEL, "outputs": []}
    ref = reference_png()
    (OUT / "reference-on-magenta.png").write_bytes(ref)
    for pose in poses:
        n = 1 + sum(1 for o in report["outputs"] if o["pose"] == pose)
        prompt = COMMON.format(pose=POSES[pose])
        result = call(prompt, ref)
        parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        images = [p for p in parts if "inlineData" in p or "inline_data" in p]
        if not images:
            print(f"NO IMAGE for {pose}: {json.dumps(result)[:400]}", flush=True)
            continue
        blob = images[0].get("inlineData") or images[0].get("inline_data")
        raw = base64.b64decode(blob["data"])
        ext = "png" if "png" in blob.get("mimeType", blob.get("mime_type", "png")) else "jpg"
        out = OUT / f"{pose}-attempt-{n}.{ext}"
        out.write_bytes(raw)
        size = Image.open(io.BytesIO(raw)).size
        report["outputs"].append({"pose": pose, "attempt": n, "file": out.name, "prompt": prompt, "model": MODEL,
                                  "reference": "reference-on-magenta.png", "reference_sha256": sha(ref), "dimensions": list(size),
                                  "sha256": sha(raw), "date": datetime.date.today().isoformat(),
                                  "usage": result.get("usageMetadata")})
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"SAVED {out.name} {size}", flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "generate":
        generate(sys.argv[2:])
