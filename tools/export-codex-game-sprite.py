"""Labelled game-asset export of existing generated art. No drawing or provider calls."""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image


def export_sprite(source, output_dir, name):
    source = Path(source)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    raw = source.read_bytes()
    native = Image.open(source).convert("RGBA")
    solid = native.getchannel("A").point(lambda a: 255 if a >= 64 else 0)
    bbox = solid.getbbox()
    if not bbox:
        raise ValueError("Empty generated art")
    crop = native.crop(bbox)
    crop.thumbnail((96, 96), Image.Resampling.LANCZOS)
    logical = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    logical.alpha_composite(crop, ((128-crop.width)//2, (128-crop.height)//2))
    alpha = logical.getchannel("A").point(lambda a: 255 if a >= 64 else 0)
    pixels = alpha.load()
    remaining = {(x,y) for y in range(128) for x in range(128) if pixels[x,y]}
    components = []
    removed_specks = 0
    while remaining:
        start = remaining.pop()
        component = [start]
        pending = [start]
        while pending:
            x,y = pending.pop()
            for dy in (-1,0,1):
                for dx in (-1,0,1):
                    neighbour = (x+dx,y+dy)
                    if neighbour in remaining:
                        remaining.remove(neighbour)
                        component.append(neighbour)
                        pending.append(neighbour)
        if len(component) <= 2:
            for x,y in component:
                pixels[x,y] = 0
            removed_specks += len(component)
        else:
            components.append(len(component))
    rgb = logical.convert("RGB").quantize(colors=24, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGBA")
    rgb.putalpha(alpha)
    depth = name.rsplit("-",1)[-1]
    target_luma = {"sunlight":130,"twilight":95,"midnight":75,"abyss":55,"trench":38}.get(depth)
    before_pixels = [p for p in rgb.get_flattened_data() if p[3]]
    before_luma = sum(.2126*r+.7152*g+.0722*b for r,g,b,a in before_pixels)/len(before_pixels)
    gain = target_luma / before_luma if target_luma and before_luma else 1.0
    if gain != 1:
        r,g,b,a = rgb.split()
        channels = [c.point(lambda v: max(0,min(255,round(v*gain)))) for c in (r,g,b)]
        rgb = Image.merge("RGBA", (*channels,a))
    after_pixels = [p for p in rgb.get_flattened_data() if p[3]]
    after_luma = sum(.2126*r+.7152*g+.0722*b for r,g,b,a in after_pixels)/len(after_pixels)
    pixel_path = output_dir / f"{name}-128.png"
    display_path = output_dir / f"{name}-256.png"
    rgb.save(pixel_path)
    rgb.resize((256, 256), Image.Resampling.NEAREST).save(display_path)
    visible_colours = {p[:3] for p in rgb.get_flattened_data() if p[3]}
    result = {"source": str(source.resolve()), "source_sha256": hashlib.sha256(raw).hexdigest(), "native_dimensions": list(native.size), "logical_file": str(pixel_path.resolve()), "display_file": str(display_path.resolve()), "logical_dimensions": [128,128], "display_dimensions": [256,256], "visible_colours": len(visible_colours), "depth_exposure": {"target_mean_srgb_luma":target_luma,"native_export_mean_before":round(before_luma,2),"game_mean_after":round(after_luma,2),"brightness_gain":round(gain,4)},  "removed_isolated_speck_pixels": removed_specks, "remaining_alpha_component_sizes": sorted(components, reverse=True), "alpha_values": sorted(set(alpha.get_flattened_data())), "visible_bbox": list(alpha.getbbox()), "transform": "Crop visible alpha bounds; fit into 96x96 within a 128x128 canvas (12.5% minimum margin); palette limit 24 without dithering; binary alpha; remove detached components of at most two logical pixels; approximate per-depth sRGB exposure normalization applied to each independently generated source; nearest-neighbour 2x display export. Generated native original remains unchanged."}
    if result["visible_colours"] > 24 or result["alpha_values"] != [0,255]:
        raise RuntimeError("Export invariants failed")
    (output_dir / f"{name}-export.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: export-codex-game-sprite.py SOURCE OUTPUT_DIR NAME")
    print(json.dumps(export_sprite(*sys.argv[1:]), indent=2))
