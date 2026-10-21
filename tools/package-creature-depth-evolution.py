"""Build 18 role-indexed creature forms from six existing bases and 12 new Codex forms."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/codex-creature-depth-evolution"
BASES = ROOT / "ocean-style-prototypes/codex-creature-palette-base"
ROLES = {"primary": (255, 0, 168), "secondary": (0, 229, 255), "tertiary": (182, 255, 0)}
BASE_NEUTRALS = {(16, 24, 32): "outline", (8, 13, 16): "mouth_pupil", (244, 240, 216): "eye_teeth"}
STAGES = ["base-rich", "midnight-abyss", "trench"]
STAGE_DEPTHS = {
    "base-rich": ["sunlight", "twilight"],
    "midnight-abyss": ["midnight", "abyss"],
    "trench": ["trench"],
}
SHADE_NAMES = ["shadow", "base", "highlight"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def as_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def save_image(image, path):
    path = Path(path)
    if path.exists():
        existing = Image.open(path).convert(image.mode)
        if existing.size != image.size or existing.tobytes() != image.tobytes():
            raise RuntimeError(f"Existing output differs; preserving it: {path}")
        return
    image.save(path)


def save_json(path, data):
    path = Path(path)
    contents = json.dumps(data, indent=2)
    if path.exists():
        if path.read_text(encoding="utf-8") != contents:
            raise RuntimeError(f"Existing report differs; preserving it: {path}")
        return
    path.write_text(contents, encoding="utf-8")


def shade_base(indexed_base, family, profile, neutrals):
    source = Image.open(indexed_base).convert("RGBA")
    pixels = list(source.get_flattened_data())
    marker_roles = {color: role for role, color in ROLES.items()}
    regions = {role: [] for role in ROLES}
    neutral_colors = {name: as_rgb(hex_value) for name, hex_value in neutrals.items()}
    assigned = [None] * len(pixels)
    width, height = source.size
    for pos, pixel in enumerate(pixels):
        if not pixel[3]:
            continue
        color = pixel[:3]
        role = marker_roles.get(color)
        if role:
            regions[role].append(pos)
            assigned[pos] = ("role", role)
        elif color in BASE_NEUTRALS:
            assigned[pos] = ("neutral", BASE_NEUTRALS[color])
        else:
            raise RuntimeError(f"Unexpected base palette color {color} in {family}")
    output = []
    for role, positions in regions.items():
        if not positions:
            raise RuntimeError(f"Base mask missing region: {family}/{role}")
        xs = [position % width for position in positions]
        ys = [position // width for position in positions]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        xrange, yrange = max(x1 - x0, 1), max(y1 - y0, 1)
        for pos in positions:
            x, y = pos % width, pos // width
            # Stepped upper-left key light; keeps the original alpha/silhouette and
            # gives each semantic role distinct shadow/base/highlight RGB swatches.
            light = 0.62 * (1 - (y - y0) / yrange) + 0.38 * (1 - (x - x0) / xrange)
            shade = "highlight" if light >= 0.68 else "shadow" if light <= 0.30 else "base"
            output.append((pos, (*as_rgb(profile[role][shade]), 255)))
    mapped = [(0, (0, 0, 0, 0)) if not pixel[3] else (i, pixel) for i, pixel in enumerate(pixels)]
    for pos, color in output:
        mapped[pos] = (pos, color)
    for index, (position, color) in enumerate(mapped):
        if assigned[index] and assigned[index][0] == "neutral":
            mapped[index] = (position, (*neutral_colors[assigned[index][1]], 255))
    result = Image.new("RGBA", source.size)
    result.putdata([color for _, color in mapped])
    return result


def process_generated(source_path, profile, neutrals):
    source = Image.open(source_path).convert("RGBA")
    alpha = source.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    bounds = alpha.getbbox()
    if not bounds:
        raise RuntimeError(f"Empty generated creature: {source_path.name}")
    crop = source.crop(bounds)
    alpha_crop = alpha.crop(bounds)
    scale = min(96 / crop.width, 96 / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    color_image = crop.convert("RGB").resize(size, Image.Resampling.LANCZOS)
    opacity = alpha_crop.resize(size, Image.Resampling.LANCZOS).point(lambda value: 255 if value >= 128 else 0)
    role_colors = {as_rgb(profile[role][shade]): (role, shade) for role in profile for shade in SHADE_NAMES}
    neutral_colors = {as_rgb(color): name for name, color in neutrals.items()}
    palette = list(role_colors) + list(neutral_colors)
    out = []
    for color, alpha_value in zip(color_image.get_flattened_data(), opacity.get_flattened_data()):
        if not alpha_value:
            out.append((0, 0, 0, 0))
            continue
        closest = min(palette, key=lambda candidate: sum((a - b) ** 2 for a, b in zip(color, candidate)))
        out.append((*closest, 255))
    small = Image.new("RGBA", size)
    small.putdata(out)
    framed = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    framed.alpha_composite(small, ((128 - size[0]) // 2, (128 - size[1]) // 2))
    return framed, list(bounds)


def make_masks(image, family, stage, palettes):
    px = list(image.get_flattened_data())
    masks_dir = OUT / "masks"
    masks_dir.mkdir(exist_ok=True)
    entries = {}
    role_swatches = {role: {shade: as_rgb(palettes[role][shade]) for shade in SHADE_NAMES} for role in palettes}
    for role, shades in role_swatches.items():
        role_mask = Image.new("L", image.size)
        role_mask.putdata([255 if pixel[3] and pixel[:3] in shades.values() else 0 for pixel in px])
        role_path = masks_dir / f"{family}-{stage}-{role}.png"
        save_image(role_mask, role_path)
        per_shade = {}
        for shade, color in shades.items():
            mask = Image.new("L", image.size)
            mask.putdata([255 if pixel[3] and pixel[:3] == color else 0 for pixel in px])
            shade_path = masks_dir / f"{family}-{stage}-{role}-{shade}.png"
            save_image(mask, shade_path)
            per_shade[shade] = {"file": shade_path.relative_to(OUT).as_posix(), "pixels": sum(mask.get_flattened_data()) // 255, "sha256": sha(shade_path)}
        entries[role] = {"file": role_path.relative_to(OUT).as_posix(), "pixels": sum(role_mask.get_flattened_data()) // 255, "sha256": sha(role_path), "shades": per_shade}
    return entries


def main():
    palette_doc = json.loads((OUT / "palette-profiles.json").read_text(encoding="utf-8"))
    profiles = palette_doc["families"]
    neutrals = palette_doc["neutral"]
    old_manifest = json.loads((BASES / "indexed-manifest.json").read_text(encoding="utf-8"))
    old_assets = {asset["family"]: asset for asset in old_manifest["assets"]}
    report = json.loads((OUT / "generation-report.json").read_text(encoding="utf-8"))
    if report.get("requests_completed") != 12 or len(report.get("entries", [])) != 12:
        raise RuntimeError("Expected exactly 12 completed native generation entries")
    requests = {f"{item['family']}/{item['stage']}": item for item in report["entries"]}
    folder = OUT / "variants"
    folder.mkdir(exist_ok=True)
    sheet = Image.new("RGB", (3 * 240, 42 + 6 * 225), "#101b28")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for column, stage in enumerate(STAGES):
        label = {"base-rich": "Sunlight / Twilight base", "midnight-abyss": "Midnight / Abyss variant", "trench": "Advanced Trench"}[stage]
        draw.text((column * 240 + 12, 8), label, fill="white", font=font)
    entries = []
    for row, family in enumerate(["anglerfish", "viperfish", "siphonophore", "isopod-host", "cookiecutter", "octopus"]):
        profile = profiles[family]
        for column, stage in enumerate(STAGES):
            if stage == "base-rich":
                old = old_assets[family]
                image = shade_base(BASES / old["file"], family, profile, neutrals)
                original = BASES / old["native_file"]
                native_sha = sha(original)
                if native_sha != old["native_sha256"]:
                    raise RuntimeError(f"Existing base hash mismatch: {family}")
                source_file = original.relative_to(ROOT).as_posix()
                bounds = None
                provenance = "Existing base creature form; role-coded shades applied offline. No new generation or anatomy change."
            else:
                item = requests.get(f"{family}/{stage}")
                if item is None:
                    raise RuntimeError(f"Missing native generation report entry: {family}/{stage}")
                source_file = item["workspace_copy"]["path"]
                source = OUT / source_file
                native_sha = item["native_staging"]["sha256"]
                copy_sha = item["workspace_copy"]["sha256"]
                if sha(source) != copy_sha or copy_sha != native_sha:
                    raise RuntimeError(f"Native copy/hash mismatch: {family}/{stage}")
                image, bounds = process_generated(source, profile, neutrals)
                provenance = "Native Codex-generated morphology; offline exact palette-index/export and framing."
            logical = folder / f"{family}-{stage}-128.png"
            display = folder / f"{family}-{stage}-256.png"
            save_image(image, logical)
            save_image(image.resize((256, 256), Image.Resampling.NEAREST), display)
            alpha_box = image.getchannel("A").getbbox()
            if not alpha_box or alpha_box[0] < 16 or alpha_box[1] < 16 or 128 - alpha_box[2] < 16 or 128 - alpha_box[3] < 16:
                raise RuntimeError(f"Framing/margin invariant failed: {family}/{stage}")
            colors_used = {pixel[:3] for pixel in image.get_flattened_data() if pixel[3]}
            expected = {as_rgb(profile[role][shade]) for role in profile for shade in SHADE_NAMES} | {as_rgb(value) for value in neutrals.values()}
            if not colors_used.issubset(expected):
                raise RuntimeError(f"Unexpected palette color in {family}/{stage}")
            role_masks = make_masks(image, family, stage, profile)
            cell_x, cell_y = column * 240 + 20, 40 + row * 225
            preview = image.resize((192, 192), Image.Resampling.NEAREST)
            sheet.paste(preview, (cell_x, cell_y), preview)
            draw.text((cell_x, cell_y + 196), family, fill="#d9eef5", font=font)
            depth_map = STAGE_DEPTHS[stage]
            entries.append({"id": f"{family}-{stage}", "family": family, "stage": stage, "depths": depth_map, "native_or_base_file": source_file, "native_or_base_sha256": native_sha, "source_native_bounds": bounds, "file": logical.relative_to(OUT).as_posix(), "display_file": display.relative_to(OUT).as_posix(), "sha256": sha(logical), "display_sha256": sha(display), "dimensions": [128, 128], "visible_color_count": len(colors_used), "role_masks": role_masks, "palette": {role: {shade: "#%02X%02X%02X" % as_rgb(profile[role][shade]) for shade in SHADE_NAMES} for role in profile}, "provenance": provenance})
    contact = OUT / "depth-evolution-contact-sheet.png"
    save_image(sheet, contact)
    result = {"families": 6, "morphology_variants_per_family": 3, "stages": [{"id": stage, "depths": STAGE_DEPTHS[stage]} for stage in STAGES], "native_generated_new_variants": 12, "offline_recolored_base_forms": 6, "total_final_forms": len(entries), "variants": entries, "contact_sheet": contact.name, "animation_or_3d": False}
    save_json(OUT / "variant-manifest.json", result)
    print(json.dumps({"families": 6, "forms": len(entries), "native_new": 12, "base_forms": 6, "contact_sheet": contact.name}, indent=2))


if __name__ == "__main__":
    main()
