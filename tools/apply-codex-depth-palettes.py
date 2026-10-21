"""Build six-family/five-depth PNG variants by exact indexed-color replacement."""

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/codex-creature-palette-base"
SOURCE_ROLES = {
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


def rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def main():
    bases = json.loads((OUT / "indexed-manifest.json").read_text(encoding="utf-8"))
    palette_data = json.loads((OUT / "depth-palettes.json").read_text(encoding="utf-8"))
    depths = palette_data["depths"]
    output_dir = OUT / "depth-variants"
    output_dir.mkdir(exist_ok=True)
    sheet = Image.new("RGB", (5 * 220, 35 + 6 * 230), "#101b28")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    entries = []
    for column, depth in enumerate(depths):
        draw.text((column * 220 + 12, 8), depth["name"], fill="white", font=font)
    for row, base in enumerate(bases["assets"]):
        source_path = OUT / base["file"]
        source = Image.open(source_path).convert("RGBA")
        original_alpha = source.getchannel("A").tobytes()
        source_pixels = list(source.get_flattened_data())
        family = base["family"]
        for column, depth in enumerate(depths):
            replacements = {SOURCE_ROLES[key]: rgb(depth[key]) for key in SOURCE_ROLES}
            replacements.update({color: color for color in NEUTRALS.values()})
            result = Image.new("RGBA", source.size)
            output_pixels = [
                (*replacements[pixel[:3]], pixel[3]) if pixel[3] else (0, 0, 0, 0)
                for pixel in source_pixels
            ]
            result.putdata(output_pixels)
            if result.getchannel("A").tobytes() != original_alpha:
                raise RuntimeError(
                    f"Palette pass altered the silhouette: {family}/{depth['id']}"
                )
            used = {pixel[:3] for pixel in output_pixels if pixel[3]}
            expected = set(NEUTRALS.values()) | {
                rgb(depth[key]) for key in SOURCE_ROLES
            }
            if used != expected:
                raise RuntimeError(
                    f"Unexpected/missing role color: {family}/{depth['id']}"
                )
            stem = f"{family}-{depth['id']}"
            logical = output_dir / f"{stem}-128.png"
            display = output_dir / f"{stem}-256.png"
            result.save(logical)
            result.resize((256, 256), Image.Resampling.NEAREST).save(display)
            cell_x = column * 220 + 14
            cell_y = 35 + row * 230
            preview = result.resize((192, 192), Image.Resampling.NEAREST)
            sheet.paste(preview, (cell_x, cell_y), preview)
            draw.text((cell_x, cell_y + 197), family, fill="#d9eef5", font=font)
            entries.append(
                {
                    "id": stem,
                    "family": family,
                    "depth": depth["id"],
                    "depth_name": depth["name"],
                    "file": logical.relative_to(OUT).as_posix(),
                    "display_file": display.relative_to(OUT).as_posix(),
                    "sha256": sha(logical),
                    "display_sha256": sha(display),
                    "source_base": base["file"],
                    "source_base_sha256": base["logical_sha256"],
                    "native_creature_sha256": base["native_sha256"],
                    "palette": {
                        role: "#%02X%02X%02X" % rgb(depth[role])
                        for role in SOURCE_ROLES
                    },
                    "neutral_colors_preserved": {
                        role: "#%02X%02X%02X" % color
                        for role, color in NEUTRALS.items()
                    },
                    "dimensions": [128, 128],
                    "visible_color_count": len(used),
                    "alpha": "unchanged binary transparency mask",
                    "generation_method": "Offline exact-RGB palette replacement on one of the six indexed bases; no new generation/API request.",
                }
            )
    contact = OUT / "depth-contact-sheet.png"
    sheet.save(contact)
    result = {
        "families": len(bases["assets"]),
        "depths": [depth["id"] for depth in depths],
        "variant_count": len(entries),
        "palette_source": "depth-palettes.json",
        "same_shape_per_family": True,
        "method": "Replace only exact primary/secondary/tertiary swatch RGB values; preserve neutral details and source alpha bytes.",
        "variants": entries,
        "contact_sheet": contact.name,
        "retro_diffusion_spend_for_these_derivatives": 0,
    }
    (OUT / "depth-variants.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "families": result["families"],
                "depths": len(depths),
                "variants": len(entries),
                "contact_sheet": contact.name,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
