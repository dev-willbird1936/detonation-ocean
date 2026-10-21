"""Offline export of the main-menu pixel sprites (no API calls).

Scene creatures: the thirty family/depth animation spritesheets (14 frames of 128 px) are copied unchanged into
ui/abyss/pixel/creatures/, plus six single-pose sprites (the new menu legend outputs) re-centred on a 128 px cell.

Legend: six existing RetroDiffusion family stills (twilight palette) plus six `retrodiffusion-menu-legend` outputs,
each cropped to its opaque bounds, padded and enlarged 2x with nearest-neighbour. Loader: the existing abyss-palette
anglerfish still, copied unchanged. Writes ui/abyss/pixel/ and its provenance.json (source and output SHA-256).
"""

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FAMILY = ROOT / "ocean-style-prototypes/retrodiffusion-creature-animation/inputs"
MENU = ROOT / "ocean-style-prototypes/retrodiffusion-menu-legend/images"
OUT = ROOT / "ui/abyss/pixel"
SOURCES = {
    "phishing": FAMILY / "anglerfish-twilight-still.png",
    "exploit": FAMILY / "viperfish-twilight-still.png",
    "botnet": FAMILY / "siphonophore-twilight-still.png",
    "theft": FAMILY / "cookiecutter-twilight-still.png",
    "supply-chain": FAMILY / "isopod-host-twilight-still.png",
    "ransomware": FAMILY / "octopus-twilight-still.png",
    "bec": MENU / "legend-bec-01.png",
    "card-fraud": MENU / "legend-card-fraud-01.png",
    "espionage": MENU / "legend-espionage-01.png",
    "social": MENU / "legend-social-01.png",
    "vulnerability": MENU / "legend-vulnerability-01.png",
    "wiper": MENU / "legend-wiper-01.png",
}
LOADER = FAMILY / "anglerfish-abyss-still.png"
PAD = 8
ANIMATIONS = ROOT / "ocean-style-prototypes/retrodiffusion-creature-animation/animations"
FAMILIES = ["anglerfish", "viperfish", "siphonophore", "cookiecutter", "isopod-host", "octopus"]
DEPTHS = ["sunlight", "twilight", "midnight", "abyss", "trench"]
SINGLES = ["bec", "card-fraud", "espionage", "social", "vulnerability", "wiper"]
CELL, FIT = 128, 96


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    (OUT / "legend").mkdir(parents=True, exist_ok=True)
    records = []
    for vector, source in SOURCES.items():
        image = Image.open(source).convert("RGBA")
        sprite = image.crop(image.getchannel("A").point(lambda a: 255 if a else 0).getbbox())
        sprite = sprite.resize((sprite.width * 2, sprite.height * 2), Image.Resampling.NEAREST)
        canvas = Image.new("RGBA", (sprite.width + 2 * PAD, sprite.height + 2 * PAD), (0, 0, 0, 0))
        canvas.alpha_composite(sprite, (PAD, PAD))
        target = OUT / "legend" / f"{vector}.png"
        canvas.save(target, optimize=True)
        records.append({"output": target.relative_to(ROOT).as_posix(), "output_sha256": sha(target), "source": source.relative_to(ROOT).as_posix(), "source_sha256": sha(source), "transform": "crop to opaque bounds, 2x nearest-neighbour, 8px transparent margin"})
    (OUT / "creatures").mkdir(parents=True, exist_ok=True)
    for family in FAMILIES:
        for depth in DEPTHS:
            source = ANIMATIONS / f"{family}-{depth}-spritesheet.png"
            target = OUT / "creatures" / source.name
            target.write_bytes(source.read_bytes())
            records.append({"output": target.relative_to(ROOT).as_posix(), "output_sha256": sha(target), "source": source.relative_to(ROOT).as_posix(), "source_sha256": sha(source), "transform": "copied unchanged (14 frames x 128 px)"})
    for vector in SINGLES:
        source = SOURCES[vector]
        image = Image.open(source).convert("RGBA")
        sprite = image.crop(image.getchannel("A").point(lambda a: 255 if a else 0).getbbox())
        if max(sprite.size) > FIT:
            ratio = FIT / max(sprite.size)
            sprite = sprite.resize((max(1, round(sprite.width * ratio)), max(1, round(sprite.height * ratio))), Image.Resampling.NEAREST)
        cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        cell.alpha_composite(sprite, ((CELL - sprite.width) // 2, (CELL - sprite.height) // 2))
        target = OUT / "creatures" / f"{vector}.png"
        cell.save(target, optimize=True)
        records.append({"output": target.relative_to(ROOT).as_posix(), "output_sha256": sha(target), "source": source.relative_to(ROOT).as_posix(), "source_sha256": sha(source), "transform": f"crop to opaque bounds, fit within {FIT} px (nearest) and centre on a {CELL} px transparent cell"})
    loader = OUT / "loader-angler.png"
    loader.write_bytes(LOADER.read_bytes())
    records.append({"output": loader.relative_to(ROOT).as_posix(), "output_sha256": sha(loader), "source": LOADER.relative_to(ROOT).as_posix(), "source_sha256": sha(LOADER), "transform": "copied unchanged"})
    (OUT / "provenance.json").write_text(json.dumps({"note": "Existing RetroDiffusion family stills plus six menu legend sprites generated with tools/retrodiffusion-menu-legend.py (rd_plus__retro, $0.36). Provider terms apply; no CC0 claim.", "files": records}, indent=2) + "\n", encoding="utf-8")
    print(f"{len(records)} sprites written")


if __name__ == "__main__":
    main()
