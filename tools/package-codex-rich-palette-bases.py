"""Create shaded, role-indexed 128px exports from six preserved Codex-native bases."""

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/codex-creature-rich-palette-bases"
OLD = ROOT / "ocean-style-prototypes/codex-creature-palette-base"
FAMILIES = [
    "anglerfish",
    "viperfish",
    "siphonophore",
    "isopod-host",
    "cookiecutter",
    "octopus",
]
SHADE_NAMES = ["shadow", "base", "highlight"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def rgb(hex_value):
    value = hex_value.removeprefix("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def components(mask):
    width, height = mask.size
    data = mask.load()
    remaining = {(x, y) for y in range(height) for x in range(width) if data[x, y]}
    result = []
    while remaining:
        start = remaining.pop()
        todo, size = [start], 1
        while todo:
            x, y = todo.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    point = (x + dx, y + dy)
                    if point in remaining:
                        remaining.remove(point)
                        todo.append(point)
                        size += 1
        result.append(size)
    return sorted(result, reverse=True)


def main():
    report = json.loads((OUT / "generation-report.json").read_text(encoding="utf-8"))
    profile_data = json.loads(
        (OUT / "palette-profiles.json").read_text(encoding="utf-8")
    )
    old_manifest = json.loads(
        (OLD / "indexed-manifest.json").read_text(encoding="utf-8")
    )
    old_assets = {entry["family"]: entry for entry in old_manifest["assets"]}
    report_entries = {entry["family"]: entry for entry in report["requests"]}
    profiles = profile_data["families"]
    neutrals = {key: rgb(value) for key, value in profile_data["neutral"].items()}
    colors = {
        family: {
            role: {
                shade: rgb(hex_value)
                for shade, hex_value in shades.items()
                if shade != "role"
            }
            for role, shades in roles.items()
        }
        for family, roles in profiles.items()
    }
    indexed = OUT / "rich-indexed"
    masks = OUT / "masks"
    indexed.mkdir(exist_ok=True)
    masks.mkdir(exist_ok=True)
    contact = Image.new("RGB", (6 * 220, 330), "#132b3a")
    draw = ImageDraw.Draw(contact)
    font = ImageFont.load_default()
    entries, analyses = [], {}
    for column, family in enumerate(FAMILIES):
        request = report_entries[family]
        source = OUT / request["copy_path"]
        native_hash = sha(source)
        if (
            native_hash != request["native_sha256"]
            or native_hash != request["copy_sha256"]
        ):
            raise RuntimeError(f"Native bytes/hash changed: {family}")
        source_image = Image.open(source).convert("RGBA")
        alpha = source_image.getchannel("A").point(
            lambda value: 255 if value >= 128 else 0
        )
        bounds = alpha.getbbox()
        if not bounds:
            raise RuntimeError(f"Empty base sprite: {family}")
        crop = source_image.crop(bounds)
        alpha_crop = alpha.crop(bounds)
        scale = min(96 / crop.width, 96 / crop.height)
        size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
        artwork = crop.convert("RGB").resize(size, Image.Resampling.LANCZOS)
        opacity = alpha_crop.resize(size, Image.Resampling.LANCZOS).point(
            lambda value: 255 if value >= 128 else 0
        )
        source_pixels = list(artwork.get_flattened_data())
        alphas = list(opacity.get_flattened_data())
        color_classes = {
            color: (role, shade)
            for role, shades in colors[family].items()
            for shade, color in shades.items()
        }
        palette_colors = set(color_classes) | set(neutrals.values())
        neutral_classes = {color: role for role, color in neutrals.items()}
        pixel_classes = []
        for pixel, visible in zip(source_pixels, alphas):
            if not visible:
                pixel_classes.append(None)
            elif max(pixel) <= 42:
                pixel_classes.append(("neutral", "mouth_pupil"))
            else:
                chosen = min(
                    palette_colors,
                    key=lambda color: sum((a - b) ** 2 for a, b in zip(pixel, color)),
                )
                pixel_classes.append(
                    color_classes[chosen]
                    if chosen in color_classes
                    else ("neutral", neutral_classes[chosen])
                )
        framed = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
        x0, y0 = (128 - size[0]) // 2, (128 - size[1]) // 2
        rendered = []
        for category, shade in pixel_classes:
            if category is None:
                rendered.append((0, 0, 0, 0))
            elif category == "neutral":
                rendered.append((*neutrals[shade], 255))
            else:
                rendered.append((*colors[family][category][shade], 255))
        small = Image.new("RGBA", size)
        small.putdata(rendered)
        framed.alpha_composite(small, (x0, y0))
        mask_entries = {}
        counts = {}
        for role, shades in colors[family].items():
            region_mask = Image.new("L", size)
            region_mask.putdata(
                [255 if category == role else 0 for category, shade in pixel_classes]
            )
            role_mask = Image.new("L", (128, 128))
            role_mask.paste(region_mask, (x0, y0))
            if role_mask.getbbox() is None:
                raise RuntimeError(
                    f"Semantic role vanished at export size: {family}/{role}"
                )
            filename = f"{family}-{role}.png"
            path = masks / filename
            role_mask.save(path)
            shade_counts = {}
            for shade in SHADE_NAMES:
                shade_mask_small = Image.new("L", size)
                shade_mask_small.putdata(
                    [
                        255 if category == role and value == shade else 0
                        for category, value in pixel_classes
                    ]
                )
                shade_mask = Image.new("L", (128, 128))
                shade_mask.paste(shade_mask_small, (x0, y0))
                shade_file = masks / f"{family}-{role}-{shade}.png"
                shade_mask.save(shade_file)
                shade_counts[shade] = sum(
                    value > 0 for value in shade_mask.get_flattened_data()
                )
            counts[role] = sum(shade_counts.values())
            mask_entries[role] = {
                "file": path.relative_to(OUT).as_posix(),
                "sha256": sha(path),
                "pixels": counts[role],
                "shade_pixels": shade_counts,
                "components": components(role_mask),
            }
        logical = indexed / f"{family}-rich-128.png"
        display = indexed / f"{family}-rich-256.png"
        framed.save(logical)
        framed.resize((256, 256), Image.Resampling.NEAREST).save(display)
        alpha_output = framed.getchannel("A").getbbox()
        if (
            alpha_output is None
            or alpha_output[0] < 16
            or alpha_output[1] < 16
            or 128 - alpha_output[2] < 16
            or 128 - alpha_output[3] < 16
        ):
            raise RuntimeError(f"Margin invariant failed: {family}")
        used_colors = {pixel[:3] for pixel in framed.get_flattened_data() if pixel[3]}
        expected_colors = set(neutrals.values()) | {
            value for role in colors[family].values() for value in role.values()
        }
        if not used_colors.issubset(expected_colors) or len(used_colors) > 12:
            raise RuntimeError(f"Rich palette map invariant failed: {family}")
        analyses[family] = {
            "native_sha256": native_hash,
            "native_dimensions": list(source_image.size),
            "native_unique_rgb_colors": len(
                {
                    pixel[:3]
                    for pixel in source_image.get_flattened_data()
                    if pixel[3] >= 128
                }
            ),
            "native_partial_alpha_pixels": sum(
                0 < a < 255 for a in source_image.getchannel("A").get_flattened_data()
            ),
            "visible_source_bounds": list(bounds),
            "logical_visible_bounds": list(alpha_output),
            "logical_margin_min": min(
                alpha_output[0],
                alpha_output[1],
                128 - alpha_output[2],
                128 - alpha_output[3],
            ),
            "logical_visible_color_count": len(used_colors),
            "role_pixels": counts,
            "roles": mask_entries,
            "palette": {
                role: {
                    shade: "#%02X%02X%02X" % color for shade, color in shades.items()
                }
                for role, shades in colors[family].items()
            },
            "neutral": {
                key: "#%02X%02X%02X" % color for key, color in neutrals.items()
            },
        }
        entry = {
            "family": family,
            "native_file": request["copy_path"],
            "native_sha256": native_hash,
            "base_reference": old_assets[family]["file"],
            "base_reference_sha256": old_assets[family]["logical_sha256"],
            "file": logical.relative_to(OUT).as_posix(),
            "display_file": display.relative_to(OUT).as_posix(),
            "logical_sha256": sha(logical),
            "display_sha256": sha(display),
            "dimensions": [128, 128],
            "visible_rgb_color_count": len(used_colors),
            "masks": {role: info["file"] for role, info in mask_entries.items()},
            "shade_masks": {
                role: {
                    shade: f"masks/{family}-{role}-{shade}.png" for shade in SHADE_NAMES
                }
                for role in colors[family]
            },
        }
        entries.append(entry)
        preview = framed.resize((192, 192), Image.Resampling.NEAREST)
        contact.paste(preview, (column * 220 + 14, 22), preview)
        draw.text((column * 220 + 14, 225), family, fill="white", font=font)
        shades = list(colors[family].values())
        swatches = [
            (shade, value) for region in shades for shade, value in region.items()
        ]
        for index, (shade, value) in enumerate(swatches):
            x = column * 220 + 14 + (index % 3) * 62
            y = 248 + (index // 3) * 27
            draw.rectangle((x, y, x + 54, y + 18), fill=value)
            draw.text((x + 1, y + 19), shade[:1], fill="#d9eef5", font=font)
    contact_path = OUT / "rich-contact-sheet.png"
    contact.save(contact_path)
    (OUT / "rich-region-analysis.json").write_text(
        json.dumps(analyses, indent=2), encoding="utf-8"
    )
    result = {
        "assets": entries,
        "color_roles_per_family": 3,
        "shades_per_role": 3,
        "palette_profiles": {
            family: {
                role: {
                    "region": profiles[family][role]["role"],
                    "colors": {
                        shade: "#%02X%02X%02X" % color
                        for shade, color in colors[family][role].items()
                    },
                }
                for role in colors[family]
            }
            for family in FAMILIES
        },
        "neutral_colors": {
            key: "#%02X%02X%02X" % value for key, value in neutrals.items()
        },
        "native_originals_untouched": True,
        "color_regions": "Every indexed region retains shadow/base/highlight shade variation; use its aggregate role mask to recolor the whole region or shade-specific mask for fine control.",
        "analysis_file": "rich-region-analysis.json",
        "contact_sheet": "rich-contact-sheet.png",
    }
    (OUT / "rich-indexed-manifest.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
