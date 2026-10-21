"""Offline verification/package only; no image generation or network calls."""
import hashlib
import json
from pathlib import Path
import shutil
import zipfile
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/codex-siphonophore-depth-study"
OLD = ROOT / "ocean-style-prototypes/retrodiffusion-family-depth-study/images"
DEPTHS = ["sunlight", "twilight", "midnight", "abyss", "trench"]
report = json.loads((OUT / "generation-report.json").read_text())
outputs = []
for index, depth in enumerate(DEPTHS, 1):
    path = OUT / f"{index:02d}-{depth}.png"
    raw = path.read_bytes()
    im = Image.open(path)
    im.verify()
    im = Image.open(path).convert("RGBA")
    asset = next(a for a in report["assets"] if a["file"] == path.name)
    digest = hashlib.sha256(raw).hexdigest()
    if digest.lower() != asset["native"]["sha256"].lower():
        raise RuntimeError(f"Reported hash mismatch: {path.name}")
    source = Path(asset["native_source"])
    if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != digest:
        raise RuntimeError(f"Native-source mismatch: {path.name}")
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError(f"Empty image: {path.name}")
    pixels = list(im.get_flattened_data())
    weight = sum(a for r, g, b, a in pixels)
    luma = sum((0.2126*r + 0.7152*g + 0.0722*b)*a for r, g, b, a in pixels) / weight
    outputs.append({"depth": depth, "file": path.name, "provider": "Codex", "tool": "image_gen.imagegen", "native_dimensions": list(im.size), "alpha_extrema": list(im.getchannel("A").getextrema()), "visible_bbox": list(bbox), "alpha_weighted_luma": round(luma, 2), "sha256": digest, "native_source": str(source), "prompt": asset["prompt"], "reference_images": asset["reference_images"]})
    original = OLD / f"siphonophore-{depth}-01.png"
    target = OUT / "comparison-originals" / original.name
    target.parent.mkdir(exist_ok=True)
    if not target.exists():
        shutil.copyfile(original, target)
    if target.read_bytes() != original.read_bytes():
        raise RuntimeError("Comparison copy changed")

manifest = {"expected_outputs": 5, "outputs": outputs, "originals_preserved": True, "native_copy_hashes_verified": True, "billing": "Codex native generation through existing ChatGPT login. No RetroDiffusion API requests; no monetary price was returned for native calls.", "review": {"colony_identity": 8.5, "cross_depth_structure": 9.0, "depth_readability": 8.0, "strict_coarse_pixel_style": 5.5, "overall": 7.8, "status": "Comparison batch, not production-approved coarse pixel sprites", "limitations": ["Native rendering is finely pixel-textured and softly shaded, not strict low-resolution 16-bit pixel clusters.", "Exact biological anatomy and attachment count are not independently validated.", "Adjacent deep tiers remain visually similar; body rendering is not perfectly pixel-aligned across outputs."]}}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
sheet = Image.new("RGB", (1500, 660), "#0b1825")
draw = ImageDraw.Draw(sheet)
for col, depth in enumerate(DEPTHS):
    x = col * 300
    draw.text((x + 18, 8), depth.title(), fill="white")
    for row in range(2):
        y = 30 + row * 315
        draw.rectangle((x + 8, y + 6, x + 290, y + 278), fill="#203746")
        path = OUT / outputs[col]["file"] if row == 0 else OUT / "comparison-originals" / f"siphonophore-{depth}-01.png"
        im = Image.open(path).convert("RGBA")
        im.thumbnail((264, 264), Image.Resampling.NEAREST)
        sheet.paste(im, (x + 150 - im.width//2, y + 142 - im.height//2), im)
        draw.text((x + 16, y + 288), "Codex native" if row == 0 else "RetroDiffusion original", fill="#c0dee8")
sheet.save(OUT / "contact-sheet.png")
with zipfile.ZipFile(OUT / "all-outputs.zip", "w", zipfile.ZIP_DEFLATED) as archive:
    for output in outputs:
        archive.write(OUT / output["file"], output["file"])
    for path in sorted((OUT / "comparison-originals").glob("*.png")):
        archive.write(path, path.relative_to(OUT))
    for name in ("manifest.json", "generation-report.json", "generation-brief.txt", "README.md", "index.html", "start-viewer.bat", "contact-sheet.png", "browser-verification.json"):
        if (OUT / name).exists():
            archive.write(OUT / name, name)
print(json.dumps({"verified": len(outputs), "dimensions": [o["native_dimensions"] for o in outputs], "alpha": [o["alpha_extrema"] for o in outputs], "luminance": [o["alpha_weighted_luma"] for o in outputs], "original_comparisons": 5, "monetary_native_price": "not reported"}, indent=2))
