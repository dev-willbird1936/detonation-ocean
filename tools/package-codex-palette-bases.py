"""Create indexed, exact-RGB game exports from six untouched Codex base sprites."""

import hashlib
import json
from pathlib import Path
import zipfile

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/codex-creature-palette-base"
FAMILIES = [
    "anglerfish",
    "viperfish",
    "siphonophore",
    "isopod-host",
    "cookiecutter",
    "octopus",
]
ROLES = {
    "primary": (255, 0, 168),
    "secondary": (0, 229, 255),
    "tertiary": (182, 255, 0),
}
NEUTRALS = {
    "outline": (16, 24, 32),
    "dark_detail": (8, 13, 16),
    "light_detail": (244, 240, 216),
}


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def distance(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b))


def classify(rgb):
    if max(rgb) <= 56:
        return "dark_detail"
    palette = {**ROLES, **NEUTRALS}
    return min(palette, key=lambda key: distance(rgb, palette[key]))


def connected_components(mask):
    w, h = mask.size
    data = mask.load()
    remaining = {(x, y) for y in range(h) for x in range(w) if data[x, y]}
    sizes = []
    while remaining:
        point = remaining.pop()
        todo = [point]
        size = 1
        while todo:
            x, y = todo.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    q = (x + dx, y + dy)
                    if q in remaining:
                        remaining.remove(q)
                        todo.append(q)
                        size += 1
        sizes.append(size)
    return sorted(sizes, reverse=True)


def main():
    report = json.loads((OUT / "generation-report.json").read_text(encoding="utf-8"))
    records = {r["family"]: r for r in report["requests"]}
    exportdir = OUT / "indexed"
    maskdir = OUT / "masks"
    exportdir.mkdir(exist_ok=True)
    maskdir.mkdir(exist_ok=True)
    sheet = Image.new("RGB", (6 * 220, 330), "#132b3a")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    analysis = {}
    exports = []
    for i, family in enumerate(FAMILIES):
        record = records[family]
        native = OUT / record["copy_path"]
        raw = native.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != record.get(
            "copy_sha256", record.get("native_sha256")
        ) or digest != record.get("native_sha256"):
            raise RuntimeError(f"Native bytes/hash mismatch: {family}")
        im = Image.open(native).convert("RGBA")
        alpha = im.getchannel("A").point(lambda a: 255 if a >= 128 else 0)
        box = alpha.getbbox()
        if not box:
            raise RuntimeError(f"No visible sprite: {family}")
        sprite = im.crop(box)
        mask = alpha.crop(box)
        scale = min(96 / sprite.width, 96 / sprite.height)
        size = (
            max(1, round(sprite.width * scale)),
            max(1, round(sprite.height * scale)),
        )
        rgb = sprite.convert("RGB").resize(size, Image.Resampling.LANCZOS)
        alpha_small = mask.resize(size, Image.Resampling.LANCZOS).point(
            lambda a: 255 if a >= 128 else 0
        )
        canvas = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
        x0 = (128 - size[0]) // 2
        y0 = (128 - size[1]) // 2
        pixels = rgb.get_flattened_data()
        a_values = alpha_small.get_flattened_data()
        classes = [
            classify(p) if a else "transparent" for p, a in zip(pixels, a_values)
        ]
        outpixels = []
        for key, a in zip(classes, a_values):
            outpixels.append(
                (*ROLES[key], 255)
                if key in ROLES and a
                else (*NEUTRALS.get(key, (0, 0, 0)), 255)
                if a
                else (0, 0, 0, 0)
            )
        quantized = Image.new("RGBA", size)
        quantized.putdata(outpixels)
        canvas.alpha_composite(quantized, (x0, y0))
        counts = {
            key: classes.count(key)
            for key in [
                "primary",
                "secondary",
                "tertiary",
                "outline",
                "dark_detail",
                "light_detail",
            ]
        }
        visible = sum(counts.values())
        role_masks = {}
        for role, color in ROLES.items():
            channel = Image.new("L", size)
            channel.putdata(
                [255 if key == role and a else 0 for key, a in zip(classes, a_values)]
            )
            rolecanvas = Image.new("L", (128, 128))
            rolecanvas.paste(channel, (x0, y0))
            mp = maskdir / f"{family}-{role}.png"
            rolecanvas.save(mp)
            role_masks[role] = {
                "file": mp.relative_to(OUT).as_posix(),
                "sha256": sha(mp),
                "pixels": counts[role],
                "bbox": list(rolecanvas.getbbox()) if rolecanvas.getbbox() else None,
                "components": connected_components(rolecanvas),
            }
        logical = exportdir / f"{family}-indexed-128.png"
        display = exportdir / f"{family}-indexed-256.png"
        canvas.save(logical)
        canvas.resize((256, 256), Image.Resampling.NEAREST).save(display)
        visible_colors = {p[:3] for p in canvas.get_flattened_data() if p[3]}
        if not set(ROLES.values()).issubset(visible_colors):
            raise RuntimeError(f"A replaceable region vanished at 128 px: {family}")
        if not visible_colors.issubset(set(ROLES.values()) | set(NEUTRALS.values())):
            raise RuntimeError(f"Unexpected region colors: {family}")
        abox = canvas.getchannel("A").getbbox()
        if not (abox[0] >= 16 and abox[1] >= 16 and abox[2] <= 112 and abox[3] <= 112):
            raise RuntimeError(f"Margin below 12.5%: {family}")
        ratio = {key: round(counts[key] / visible, 4) for key in counts}
        analysis[family] = {
            "native_sha256": digest,
            "native_size": list(im.size),
            "native_partial_alpha_pixels": sum(
                0 < a < 255 for a in im.getchannel("A").get_flattened_data()
            ),
            "native_rgb_colours": len(
                {p[:3] for p in im.get_flattened_data() if p[3] >= 128}
            ),
            "thresholded_source_bbox": list(box),
            "logical_bbox": list(abox),
            "logical_size": [128, 128],
            "margin_min_pixels": min(abox[0], abox[1], 128 - abox[2], 128 - abox[3]),
            "region_pixels": counts,
            "region_fraction": ratio,
            "visible_rgb_colours": len(visible_colors),
            "roles": role_masks,
            "normalization": "Crop alpha>=128 bounds; proportionally fit whole sprite within 96x96 using LANCZOS; threshold alpha at 128; map interior RGB to nearest exact role/neutral marker, with near-black pixels preserved as dark details; retain original bytes separately.",
        }
        entry = {
            "family": family,
            "native_file": record["copy_path"],
            "native_sha256": digest,
            "file": logical.relative_to(OUT).as_posix(),
            "display_file": display.relative_to(OUT).as_posix(),
            "logical_sha256": sha(logical),
            "display_sha256": sha(display),
            "dimensions": [128, 128],
            "visible_colors": ["#%02X%02X%02X" % c for c in sorted(visible_colors)],
            "role_mask_files": {k: v["file"] for k, v in role_masks.items()},
        }
        exports.append(entry)
        image = canvas.resize((192, 192), Image.Resampling.NEAREST)
        sheet.paste(image, (i * 220 + 14, 22), image)
        draw.text((i * 220 + 14, 225), family, fill="white", font=font)
        for j, (role, color) in enumerate(ROLES.items()):
            x = i * 220 + 14 + j * 62
            draw.rectangle((x, 248, x + 55, 278), fill=color)
            draw.text((x + 1, 282), role[:3], fill="#d9eef5", font=font)
    contact = OUT / "contact-sheet.png"
    sheet.save(contact)
    (OUT / "region-analysis.json").write_text(
        json.dumps(analysis, indent=2), encoding="utf-8"
    )
    package = {
        "assets": exports,
        "palette": {
            "primary": "#FF00A8",
            "secondary": "#00E5FF",
            "tertiary": "#B6FF00",
            "outline": "#101820",
            "dark_detail": "#080D10",
            "light_detail": "#F4F0D8",
        },
        "native_files_untouched": True,
        "analysis_file": "region-analysis.json",
        "region_analysis": analysis,
        "contact_sheet": "contact-sheet.png",
        "native_generation_report": "generation-report.json",
    }
    (OUT / "indexed-manifest.json").write_text(
        json.dumps(package, indent=2), encoding="utf-8"
    )
    archive_path = OUT / "all-six-palette-bases.zip"
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for folder in (
            OUT / "indexed",
            OUT / "masks",
            OUT / "inputs",
            OUT / "depth-variants",
        ):
            for path in sorted(folder.glob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(OUT).as_posix())
        for path in OUT.glob("*-base-native.png"):
            archive.write(path, path.name)
        for name in (
            "README.md",
            "index.html",
            "start-viewer.bat",
            "generation-brief.txt",
            "generation-report.json",
            "indexed-manifest.json",
            "region-analysis.json",
            "depth-palettes.json",
            "depth-variants.json",
            "depth-contact-sheet.png",
            "reference-manifest.json",
            "browser-verification.json",
            "goal-delivery-evidence.json",
            "contact-sheet.png",
        ):
            archive.write(OUT / name, name)
    print(
        json.dumps(
            {
                f: {
                    "pixels": analysis[f]["region_pixels"],
                    "fractions": analysis[f]["region_fraction"],
                    "margin": analysis[f]["margin_min_pixels"],
                    "colours": analysis[f]["visible_rgb_colours"],
                }
                for f in FAMILIES
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
