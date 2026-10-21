"""Normalize 18 creature forms and build 30 family/depth colour variants, offline.

Python standard library and Pillow only (the packaging tools' existing dependency).
Writes only under ocean-style-prototypes/codex-creature-depth-evolution/depth-colors/
(or --dir). Never overwrites. No network, provider or secret access.

    python tools/build-evolution-depth-colors.py --build [--dir DIR]
    python tools/build-evolution-depth-colors.py --check [--dir DIR]

Every output stays a candidate: the morphology is accepted for the pipeline, the
colour/art result waits for an independent QVL review.
"""
import argparse
import hashlib
import io
import json
import math
import platform
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EVO = ROOT / "ocean-style-prototypes/codex-creature-depth-evolution"
LEGACY = ROOT / "ocean-style-prototypes/codex-creature-palette-base"
DEFAULT_DIR = EVO / "depth-colors"

FORMS = ("anglerfish", "viperfish", "siphonophore", "isopod-host", "cookiecutter", "squid")
PALETTE_FAMILY = {"squid": "octopus"}
STAGES = ("base-rich", "midnight-abyss", "trench")
DEPTHS = (
    ("sunlight", "base-rich"),
    ("twilight", "base-rich"),
    ("midnight", "midnight-abyss"),
    ("abyss", "midnight-abyss"),
    ("trench", "trench"),
)
ROLES = ("primary", "secondary", "tertiary")
SHADES = ("shadow", "base", "highlight")
NEUTRALS = ("outline", "mouth_pupil", "eye_teeth")

# Per-depth transform (k = primary/secondary luminance scale, w = blue pull, c = chroma scale).
STEPS = {
    "sunlight": (1.000, 0.00, 1.00),
    "twilight": (0.867, 0.15, 1.00),
    "midnight": (0.754, 0.30, 1.00),
    "abyss": (0.667, 0.45, 0.85),
    "trench": (0.466, 0.60, 0.75),
}
PIVOT, HUE_DEG, CHROMA_TARGET = 18.0, 274.4, 20.0
WHITE = (0.95047, 1.0, 1.08883)
RGB_TO_XYZ = ((0.4124564, 0.3575761, 0.1804375), (0.2126729, 0.7151522, 0.0721750), (0.0193339, 0.1191920, 0.9503041))
XYZ_TO_RGB = ((3.2404542, -1.5371385, -0.4985314), (-0.9692660, 1.8760108, 0.0415560), (0.0556434, -0.2040259, 1.0572252))

# Key / fit parameters.
KEY_COLOR, KEY_TOLERANCE, DESPILL_RAMP, EDGE_BAND = (255, 0, 255), 120.0, (60.0, 180.0), 2
ALPHA_THRESHOLD, FIT_LONG_SIDE, CANVAS, MIN_MARGIN = 128, 96, 128, 16
MAX_REMOVED_PX, MAX_INDEX_ERROR, MIN_SWATCH_L, MIN_SHADE_GAP, MIN_NEUTRAL_DE = 100, 40.0, 17.0, 5.0, 3.5

# Pinned inputs. New forms are the round-5 QVL replacements; the rest come from the existing manifests.
NEW_SOURCES = {
    ("anglerfish", "trench"): ("revisions/evolution-iteration-02/anglerfish-trench-v2-native.png", "d635c2f571624123b3764dd6481861a9ca6aa32b4cc66454ba215eee1b33ad61", "rgba"),
    ("viperfish", "midnight-abyss"): ("revisions/evolution-iteration-02/viperfish-midnight-abyss-v2-native.png", "002ac9556d75cd7d911d949b5e571d79eff93819dfb4c0f076e5523cd1a8d57c", "rgba"),
    ("viperfish", "trench"): ("revisions/evolution-iteration-02/viperfish-trench-v2-native.png", "f23fbab53747418bde5c1ab73e53c95eb97ea94e294723f1dad8361b6a0f59bc", "rgba"),
    ("siphonophore", "trench"): ("revisions/evolution-iteration-05/siphonophore-trench-v4-native.png", "a6edd95c2b010de671224f55cc3f983b5a141473b26abea944d5b4b86932e28a", "key"),
    ("cookiecutter", "midnight-abyss"): ("revisions/evolution-iteration-03/cookiecutter-midnight-abyss-v3-native.png", "a6c4c1f4076e410fd49f53eb99912e35172d536e05749c58b277f5330baf546a", "key"),
    ("squid", "trench"): ("revisions/evolution-iteration-05/squid-trench-v5-native.png", "a5feab4a08fe0e646bcf9d4ecc17c54dc915eed4596d3e3eec152e6646312557", "key"),
}
INPUT_PINS = {
    "palette-profiles.json": "c1dd02d3c9f7fe8889c173e00628bac9468bd7e62ccdb7148f782c3c5edf9712",
    "variant-manifest.json": "5167317e46d03d913ac8ac4e0dea1fe1f0f4f9f7e04fabbb871bb675bd763312",
    "revisions/squid-kraken-v1/app-preview-manifest.json": "f1ea1c6818991c4f3ab220a63310b8e9e77bd941ac3e37baa88d878f4e1a5454",
}


def sha_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha_file(path):
    return sha_bytes(Path(path).read_bytes())


def hex_to_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb):
    return "#%02X%02X%02X" % tuple(rgb)


def pixels(image):
    """Flat list of pixel tuples (Pillow 12 renamed getdata)."""
    return list(image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata())


def from_pixels(size, data):
    image = Image.new("RGBA", size)
    image.putdata(data)
    return image


def alpha_bytes(image):
    return image.getchannel("A").tobytes()


# ---------------------------------------------------------------- connected components / morphology

_RUN = re.compile(rb"\x01+")
_SCALE255 = bytes(255 if v else 0 for v in range(256))


def label(mask, width, height, eight):
    """Label connected components of a 0/1 byte mask (row-major) with row runs and union-find.

    Returns (runs, sizes): runs are (y, start, end_exclusive, label) with labels numbered by first
    raster appearance from 1; sizes[label] is the pixel count (sizes[0] is unused).
    """
    grow = 1 if eight else 0
    parent = [0]

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    spans, prev = [], []
    for y in range(height):
        cur, j = [], 0
        for match in _RUN.finditer(mask, y * width, (y + 1) * width):
            start, end = match.start() - y * width, match.end() - y * width
            rid = len(parent)
            parent.append(rid)
            while j < len(prev) and prev[j][1] + grow <= start:
                j += 1
            k = j
            while k < len(prev) and prev[k][0] < end + grow:
                a, b = find(rid), find(prev[k][2])
                if a != b:
                    parent[max(a, b)] = min(a, b)
                k += 1
            cur.append((start, end, rid))
            spans.append((y, start, end, rid))
        prev = cur
    numbers, sizes, runs = {}, [0], []
    for y, start, end, rid in spans:
        root = find(rid)
        if root not in numbers:
            numbers[root] = len(sizes)
            sizes.append(0)
        sizes[numbers[root]] += end - start
        runs.append((y, start, end, numbers[root]))
    return runs, sizes


def paint(runs, width, height, pick):
    out = bytearray(width * height)
    for y, start, end, lab in runs:
        if pick(lab):
            out[y * width + start : y * width + end] = b"\x01" * (end - start)
    return out


def largest_component(mask, width, height):
    """Return (kept 0/1 mask, discarded component sizes, retained size)."""
    runs, sizes = label(mask, width, height, True)
    if len(sizes) == 1:
        raise RuntimeError("Empty opaque mask")
    keep = sizes.index(max(sizes))
    discarded = sorted((s for i, s in enumerate(sizes) if i not in (0, keep)), reverse=True)
    return paint(runs, width, height, lambda lab: lab == keep), discarded, sizes[keep]


def enclosed_pockets(opaque, width, height):
    """Sizes of 4-connected transparent regions that do not touch the canvas border."""
    runs, sizes = label(bytes(opaque).translate(bytes([1, 0]) + bytes(254)), width, height, False)
    border = {lab for y, start, end, lab in runs if y in (0, height - 1) or start == 0 or end == width}
    return sorted((s for i, s in enumerate(sizes) if i and i not in border), reverse=True)


def mask_of(image):
    """0/1 byte mask of alpha > 0 for a 128-style sprite."""
    return alpha_bytes(image).translate(bytes([0]) + bytes([1] * 255))


def margins(image):
    left, top, right, bottom = image.getchannel("A").getbbox()
    return left, top, image.width - right, image.height - bottom


# ---------------------------------------------------------------- keying, fitting, indexing

def key_source(image, tolerance=KEY_TOLERANCE):
    """Global tolerance key (no flood fill) of an RGB image on a near-#FF00FF field.

    Returns an RGBA image (binary alpha, edge-band despill only) and a report dict.
    """
    width, height = image.size
    data = bytearray(image.convert("RGB").tobytes())
    r_sq, g_sq, b_sq = ([(v - c) ** 2 for v in range(256)] for c in KEY_COLOR)
    distance_sq = [r_sq[r] + g_sq[g] + b_sq[b] for r, g, b in zip(data[0::3], data[1::3], data[2::3])]
    limit = tolerance ** 2
    kept, discarded, retained = largest_component(bytes(d >= limit for d in distance_sq), width, height)
    ramp_low, ramp_high = DESPILL_RAMP
    soft = [i for i, (k, d) in enumerate(zip(kept, distance_sq)) if k and d < ramp_high ** 2]
    unmixed = 0
    for i in soft:
        y, x = divmod(i, width)
        window = (kept[yy * width + xx] for yy in range(max(0, y - EDGE_BAND), min(height, y + EDGE_BAND + 1)) for xx in range(max(0, x - EDGE_BAND), min(width, x + EDGE_BAND + 1)))
        if all(window):
            continue  # interior detail: protected from despill
        matte = max(min(max((math.sqrt(distance_sq[i]) - ramp_low) / (ramp_high - ramp_low), 0.0), 1.0), 1e-3)
        for c in range(3):
            data[3 * i + c] = round(min(255.0, max(0.0, (data[3 * i + c] - (1.0 - matte) * KEY_COLOR[c]) / matte)))
        unmixed += 1
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(Image.frombytes("RGB", image.size, bytes(data)).convert("RGBA"), mask=Image.frombytes("L", image.size, bytes(kept).translate(_SCALE255)))
    pockets = enclosed_pockets(kept, width, height)
    report = {
        "method": "global-tolerance-key",
        "key_color": rgb_to_hex(KEY_COLOR),
        "tolerance": tolerance,
        "despill_ramp": list(DESPILL_RAMP),
        "edge_band_px": EDGE_BAND,
        "retained_component_px": retained,
        "discarded_components_px": discarded,
        "removed_component_px": sum(discarded),
        "enclosed_pockets": len(pockets),
        "enclosed_pocket_px": sum(pockets),
        "soft_edge_px": len(soft),
        "despilled_px": unmixed,
        "protected_interior_soft_px": len(soft) - unmixed,
        "min_foreground_key_distance": round(math.sqrt(min(d for k, d in zip(kept, distance_sq) if k)), 3),
    }
    return out, report


def threshold_alpha(image, threshold=ALPHA_THRESHOLD):
    """Binary-alpha an RGBA image; haze (alpha below threshold) is removed, RGB kept as-is."""
    width, height = image.size
    alpha = alpha_bytes(image)
    kept, discarded, retained = largest_component(alpha.translate(bytes([0] * threshold + [1] * (256 - threshold))), width, height)
    solid = image.convert("RGBA")
    solid.putalpha(255)
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    out.paste(solid, mask=Image.frombytes("L", image.size, bytes(kept).translate(_SCALE255)))
    report = {
        "method": "alpha-threshold",
        "alpha_threshold": threshold,
        "haze_px": sum(1 for v in alpha if 0 < v < threshold),
        "retained_component_px": retained,
        "discarded_components_px": discarded,
        "removed_component_px": sum(discarded),
        "enclosed_pockets": len(enclosed_pockets(kept, width, height)),
    }
    return out, report


def fit_to_canvas(image):
    """Crop to the opaque bbox, premultiplied LANCZOS to a 96 px long side, centre on 128x128."""
    x0, y0, x1, y1 = image.getchannel("A").getbbox()
    crop = image.crop((x0, y0, x1, y1))
    scale = FIT_LONG_SIDE / max(crop.size)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    small = crop.resize(size, Image.Resampling.LANCZOS)
    opaque = small.getchannel("A").point(lambda v: 255 if v >= ALPHA_THRESHOLD else 0)
    solid = small.copy()
    solid.putalpha(255)
    sprite = Image.new("RGBA", size, (0, 0, 0, 0))
    sprite.paste(solid, mask=opaque)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(sprite, ((CANVAS - size[0]) // 2, (CANVAS - size[1]) // 2))
    return canvas, [x0, y0, x1, y1], list(size)


def palette_colors(profile, neutral):
    swatches = [(f"{role}.{shade}", hex_to_rgb(profile[role][shade])) for role in ROLES for shade in SHADES]
    return swatches + [(name, hex_to_rgb(neutral[name])) for name in NEUTRALS]


def index_to_palette(image, palette):
    """Nearest palette colour (squared RGB, first index wins ties) for every opaque pixel."""
    colors = [c for _, c in palette]
    cache, errors, out = {}, [], []
    for pixel in pixels(image):
        if pixel[3] != 255:
            out.append((0, 0, 0, 0))
            continue
        rgb = pixel[:3]
        if rgb not in cache:
            cache[rgb] = min((sum((a - b) ** 2 for a, b in zip(rgb, color)), i) for i, color in enumerate(colors))
        distance, nearest = cache[rgb]
        errors.append(math.sqrt(distance))
        out.append((*colors[nearest], 255))
    return from_pixels(image.size, out), round(math.fsum(errors) / len(errors), 3)


def swatch_pixels(image, palette):
    counts = {}
    for pixel in pixels(image):
        if pixel[3]:
            counts[pixel[:3]] = counts.get(pixel[:3], 0) + 1
    return {name: counts.get(color, 0) for name, color in palette}


# ---------------------------------------------------------------- CIELAB D65 depth transform

def _compand(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb_to_lab(rgb):
    linear = [_linear(v / 255.0) for v in rgb]
    xyz = [sum(m * c for m, c in zip(row, linear)) / white for row, white in zip(RGB_TO_XYZ, WHITE)]
    delta = 6 / 29
    f = [t ** (1 / 3) if t > delta ** 3 else t / (3 * delta ** 2) + 4 / 29 for t in xyz]
    return 116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])


def lab_to_rgb(lab):
    """Lab -> sRGB ints (Python round, clamp). Second value reports linear-light clipping."""
    L, a, b = lab
    fy = (L + 16) / 116
    f = (fy + a / 500, fy, fy - b / 200)
    delta = 6 / 29
    xyz = [white * (t ** 3 if t > delta else 3 * delta ** 2 * (t - 4 / 29)) for t, white in zip(f, WHITE)]
    linear = [sum(m * c for m, c in zip(row, xyz)) for row in XYZ_TO_RGB]
    clipped = any(v < -1e-6 or v > 1 + 1e-6 for v in linear)
    rgb = tuple(min(255, max(0, round(255 * _compand(min(1.0, max(0.0, v)))))) for v in linear)
    return rgb, clipped


def transform_swatch(rgb, role, depth):
    k, w, c = STEPS[depth]
    if role == "tertiary":
        k, w = 1.0, w / 2
    L, a, b = rgb_to_lab(rgb)
    target_a, target_b = CHROMA_TARGET * math.cos(math.radians(HUE_DEG)), CHROMA_TARGET * math.sin(math.radians(HUE_DEG))
    lab = (PIVOT + k * (L - PIVOT), ((1 - w) * a + w * target_a) * c, ((1 - w) * b + w * target_b) * c)
    return lab_to_rgb(lab)


def transformed_profile(profile, depth):
    """{role: {shade: (r, g, b)}} for a depth, plus whether any swatch clipped in linear light."""
    out, clipped = {}, False
    for role in ROLES:
        out[role] = {}
        for shade in SHADES:
            out[role][shade], bad = transform_swatch(hex_to_rgb(profile[role][shade]), role, depth)
            clipped = clipped or bad
    return out, clipped


def recolor(source, mapping, neutrals):
    """Remap exact indexed swatches; neutrals pass through; any other opaque colour aborts."""
    known = {c: c for c in neutrals}
    known.update(mapping)
    out = []
    for pixel in pixels(source):
        if not pixel[3]:
            out.append(pixel)
        elif pixel[:3] in known:
            out.append((*known[pixel[:3]], pixel[3]))
        else:
            raise RuntimeError("Colour outside the indexed palette: #%02X%02X%02X" % pixel[:3])
    return from_pixels(source.size, out)


# ---------------------------------------------------------------- inputs

def load_profiles(evo=EVO):
    doc = json.loads((evo / "palette-profiles.json").read_text(encoding="utf-8"))
    squid = json.loads((evo / "revisions/squid-kraken-v1/palette-profile.json").read_text(encoding="utf-8"))
    octopus = doc["families"]["octopus"]
    if any({s: squid["roles"][r][s] for s in SHADES} != {s: octopus[r][s] for s in SHADES} for r in ROLES) or squid["neutral"] != doc["neutral"]:
        raise RuntimeError("Squid palette profile differs from families.octopus")
    return {form: doc["families"][PALETTE_FAMILY.get(form, form)] for form in FORMS}, doc["neutral"]


def unchanged_source(form, stage, evo=EVO):
    if form == "squid":
        manifest = json.loads((evo / "revisions/squid-kraken-v1/app-preview-manifest.json").read_text(encoding="utf-8"))
        entry = next(v for v in manifest["variants"] if v["stage"] == stage)
        return evo / "revisions/squid-kraken-v1" / entry["logicalFile"], entry["logicalSha256"]
    manifest = json.loads((evo / "variant-manifest.json").read_text(encoding="utf-8"))
    entry = next(v for v in manifest["variants"] if v["id"] == f"{form}-{stage}")
    return evo / entry["file"], entry["sha256"]


def normalize_source(form, stage, profile, neutral, evo=EVO):
    """Return (128x128 indexed RGBA image, manifest report) for one approved form."""
    palette = palette_colors(profile, neutral)
    if (form, stage) in NEW_SOURCES:
        rel, pin, kind = NEW_SOURCES[(form, stage)]
        path = evo / rel
        if sha_file(path) != pin:
            raise RuntimeError(f"Source hash mismatch: {rel}")
        image = Image.open(path)
        image.load()
        if kind == "key":
            if image.mode != "RGB":
                raise RuntimeError(f"Expected RGB key source: {rel}")
            native, process = key_source(image)
        else:
            if image.mode != "RGBA":
                raise RuntimeError(f"Expected RGBA source: {rel}")
            native, process = threshold_alpha(image)
        fitted, bbox, size = fit_to_canvas(native)
        indexed, error = index_to_palette(fitted, palette)
        report = {"origin": "round5-replacement", "origin_file": rel, "origin_sha256": pin, "native_size": list(image.size), "native_bbox": bbox, "fit_size": size, "process": process, "mean_index_error": error, "morphology": "accepted-for-pipeline"}
    else:
        path, pin = unchanged_source(form, stage, evo)
        if sha_file(path) != pin:
            raise RuntimeError(f"Source hash mismatch: {path}")
        indexed = Image.open(path).convert("RGBA")
        report = {"origin": "unchanged", "origin_file": path.relative_to(evo).as_posix(), "origin_sha256": pin, "morphology": "unchanged"}
    report["swatch_pixels"] = swatch_pixels(indexed, palette)
    report["visible_color_count"] = sum(1 for n in report["swatch_pixels"].values() if n)
    report["alpha_sha256"] = sha_bytes(alpha_bytes(indexed))
    report["status"] = "candidate"
    return indexed, report


def display(image):
    return image.resize((image.width * 2, image.height * 2), Image.Resampling.NEAREST)


def compute(evo=EVO):
    """Build every source and variant in memory from the pinned inputs."""
    profiles, neutral = load_profiles(evo)
    for rel, pin in INPUT_PINS.items():
        if sha_file(evo / rel) != pin:
            raise RuntimeError(f"Input changed: {rel}")
    neutral_rgb = [hex_to_rgb(neutral[n]) for n in NEUTRALS]
    sources, variants = {}, {}
    for form in FORMS:
        for stage in STAGES:
            sources[(form, stage)] = normalize_source(form, stage, profiles[form], neutral, evo)
    for form in FORMS:
        for depth, stage in DEPTHS:
            source, source_report = sources[(form, stage)]
            palette, clipped = transformed_profile(profiles[form], depth)
            mapping = {hex_to_rgb(profiles[form][r][s]): palette[r][s] for r in ROLES for s in SHADES}
            if len(set(mapping.values()) | set(neutral_rgb)) != 12:
                raise RuntimeError(f"Transformed swatches collide: {form}/{depth}")
            image = recolor(source, mapping, neutral_rgb)
            if depth == "sunlight" and image.tobytes() != source.tobytes():
                raise RuntimeError(f"Sunlight is not identical to its source: {form}")
            variants[(form, depth)] = {"image": image, "palette": palette, "clipped": clipped, "stage": stage, "source": (form, stage), "source_alpha_sha256": source_report["alpha_sha256"]}
    return {"profiles": profiles, "neutral": neutral, "sources": sources, "variants": variants}


# ---------------------------------------------------------------- validation

def delta_e(a, b):
    return math.dist(rgb_to_lab(a), rgb_to_lab(b))


def hue_distance(rgb):
    _, a, b = rgb_to_lab(rgb)
    return abs((math.degrees(math.atan2(b, a)) % 360 - HUE_DEG + 180) % 360 - 180)


def mean(values):
    values = list(values)
    return math.fsum(values) / len(values)


def octopus_files(evo=EVO, legacy=LEGACY):
    return sorted(set((evo / "variants").glob("octopus-*-128.png")) | set((legacy / "indexed").glob("octopus*128.png")) | set((legacy / "depth-variants").glob("octopus-*-128.png")))


def record(checks, name, passed, detail=None):
    checks.append({"check": name, "passed": bool(passed), "detail": detail})


def validate(result, evo=EVO, legacy=LEGACY):
    """Machine checks on the in-memory result. Returns a list of {check, passed, detail}."""
    checks, profiles, neutral = [], result["profiles"], result["neutral"]
    sources, variants = result["sources"], result["variants"]
    neutral_rgb = [hex_to_rgb(neutral[n]) for n in NEUTRALS]
    record(checks, "18 source forms and 30 unique family-depth ids", len(sources) == 18 and len(variants) == 30 and len({f"{f}-{d}" for f, d in variants}) == 30, [len(sources), len(variants)])
    record(checks, "no octopus source path", not any("octopus" in str(r["origin_file"]) for _, r in sources.values()))
    record(checks, "viperfish trench source is the iteration-02 file", sources[("viperfish", "trench")][1]["origin_file"] == "revisions/evolution-iteration-02/viperfish-trench-v2-native.png")

    bad = []
    for key, (image, report) in sources.items():
        px = pixels(image)
        palette = palette_colors(profiles[key[0]], neutral)
        left, top, right, bottom = margins(image)
        x0, y0, x1, y1 = image.getchannel("A").getbbox()
        problems = []
        if image.size != (128, 128) or image.mode != "RGBA":
            problems.append("size")
        if set(alpha_bytes(image)) != {0, 255}:
            problems.append("alpha not binary")
        if any(p != (0, 0, 0, 0) for p in px if not p[3]):
            problems.append("transparent pixels not zero")
        if min(left, top, right, bottom) < MIN_MARGIN:
            problems.append(f"margin {(left, top, right, bottom)}")
        if max(x1 - x0, y1 - y0) > FIT_LONG_SIDE:
            problems.append("long side")
        if len(label(mask_of(image), 128, 128, True)[1]) != 2:
            problems.append("components")
        if not {p[:3] for p in px if p[3]} <= {c for _, c in palette}:
            problems.append("palette")
        if report["swatch_pixels"]["outline"] == 0 or any(not any(report["swatch_pixels"][f"{r}.{s}"] for s in SHADES) for r in ROLES):
            problems.append("outline/role coverage")
        if report["origin"] != "unchanged":
            if report["process"]["removed_component_px"] > MAX_REMOVED_PX:
                problems.append("removed component px")
            if report["mean_index_error"] > MAX_INDEX_ERROR:
                problems.append("index error")
        if problems:
            bad.append({"id": f"{key[0]}-{key[1]}", "problems": problems})
    record(checks, "sources: 128 RGBA binary alpha, margins >=16, one component, palette, coverage, gates", not bad, bad)

    bad = []
    for (form, depth), item in variants.items():
        image, source = item["image"], sources[item["source"]][0]
        pal = item["palette"]
        mapping = {hex_to_rgb(profiles[form][r][s]): pal[r][s] for r in ROLES for s in SHADES}
        allowed = set(mapping.values()) | set(neutral_rgb)
        problems = set()
        if alpha_bytes(image) != alpha_bytes(source):
            problems.add("alpha differs from source")
        if min(margins(image)) < MIN_MARGIN:
            problems.add("margin")
        if depth == "sunlight" and image.tobytes() != source.tobytes():
            problems.add("sunlight not identical")
        if item["clipped"]:
            problems.add("linear clipping")
        for s, o in zip(pixels(source), pixels(image)):
            if not s[3]:
                continue
            if o[:3] not in allowed:
                problems.add("palette membership")
            if s[:3] in mapping and o[:3] != mapping[s[:3]]:
                problems.add("swatch positions")
            if s[:3] in neutral_rgb and o[:3] != s[:3]:
                problems.add("neutral changed")
        lab = {r: [rgb_to_lab(pal[r][s]) for s in SHADES] for r in ROLES}
        for role, values in lab.items():
            gap = min(values[1][0] - values[0][0], values[2][0] - values[1][0])
            if gap < MIN_SHADE_GAP:
                problems.add(f"{role} shade gap {gap:.2f}")
        if min(v[0] for values in lab.values() for v in values) < MIN_SWATCH_L:
            problems.add("min swatch L*")
        if min(delta_e(pal[r][s], n) for r in ROLES for s in SHADES for n in neutral_rgb) < MIN_NEUTRAL_DE:
            problems.add("swatch/neutral dE")
        if problems:
            bad.append({"id": f"{form}-{depth}", "problems": sorted(problems)})
    record(checks, "variants: alpha equality, sunlight identity, palette/neutral membership, shade order and >=5 L* gaps, margins", not bad, bad)

    pair_ok = all(alpha_bytes(variants[(f, a)]["image"]) == alpha_bytes(variants[(f, b)]["image"]) and variants[(f, a)]["source"] == variants[(f, b)]["source"] for f in FORMS for a, b in (("sunlight", "twilight"), ("midnight", "abyss")))
    record(checks, "pair-stage geometry identity (Sunlight/Twilight, Midnight/Abyss)", pair_ok)

    ladder_bad, steps = [], {}
    order = [d for d, _ in DEPTHS]
    for form in FORMS:
        means, hues = [], []
        for depth in order:
            pal = variants[(form, depth)]["palette"]
            means.append(mean(rgb_to_lab(pal[r][s])[0] for r in ("primary", "secondary") for s in SHADES))
            hues.append(mean(hue_distance(pal[r][s]) for r in ("primary", "secondary") for s in SHADES))
        if not all(a > b for a, b in zip(means, means[1:])):
            ladder_bad.append(f"{form} luminance {means}")
        if not (hues[1] < hues[0] and hues[3] < hues[2]):
            ladder_bad.append(f"{form} hue {hues}")
        steps[form] = []
        for a, b in zip(order, order[1:]):
            pa, pb = variants[(form, a)]["palette"], variants[(form, b)]["palette"]
            step = mean(delta_e(pa[r][s], pb[r][s]) for r in ROLES for s in SHADES)
            steps[form].append(round(step, 2))
            if not 3.0 <= step <= 9.0:
                ladder_bad.append(f"{form} {a}->{b} dE {step:.2f}")
    record(checks, "strict depth luminance ladder, hue pull, adjacent mean dE in [3, 9]", not ladder_bad, ladder_bad or steps)

    separation, sep_bad = {}, []
    for depth in order:
        mins = []
        for i, first in enumerate(FORMS):
            for second in FORMS[i + 1 :]:
                pa, pb = variants[(first, depth)]["palette"], variants[(second, depth)]["palette"]
                mins.append(sum(delta_e(pa[r]["base"], pb[r]["base"]) for r in ROLES))
        separation[depth] = round(min(mins), 2)
        if min(mins) < 24.0:
            sep_bad.append(depth)
    record(checks, "family separation: summed three-role base dE >= 24 at every depth", not sep_bad, separation)

    found = octopus_files(evo, legacy)
    octopus = [Image.open(p).convert("RGBA").tobytes() for p in found]
    squid_images = [sources[("squid", s)][0] for s in STAGES] + [variants[("squid", d)]["image"] for d in order]
    record(checks, "squid never equals an octopus asset", len(found) >= 8 and not any(s.tobytes() == o for s in squid_images for o in octopus), len(found))
    return checks


# ---------------------------------------------------------------- output

def paths(form, key, outdir):
    return outdir / f"{form}-{key}-128.png", outdir / f"{form}-{key}-256.png"


def expected_files(outdir):
    names = []
    for form in FORMS:
        for stage in STAGES:
            names += [p.relative_to(outdir).as_posix() for p in paths(form, stage, outdir / "morphology")]
        for depth, _ in DEPTHS:
            names += [p.relative_to(outdir).as_posix() for p in paths(form, depth, outdir)]
    return sorted(names + ["depth-color-manifest.json"])


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", compress_level=9)
    return buffer.getvalue()


def build_manifest(result, hashes):
    profiles, neutral = result["profiles"], result["neutral"]
    sources, variants = [], []
    for (form, stage), (image, report) in result["sources"].items():
        low, high = (f"morphology/{form}-{stage}-{n}.png" for n in (128, 256))
        sources.append({"id": f"{form}-{stage}", "form": form, "stage": stage, "palette_family": PALETTE_FAMILY.get(form, form), "file": low, "sha256": hashes[low], "display_file": high, "display_sha256": hashes[high], **report})
    for (form, depth), item in result["variants"].items():
        low, high = (f"{form}-{depth}-{n}.png" for n in (128, 256))
        source_id = "{}-{}".format(*item["source"])
        step = STEPS[depth]
        variants.append({
            "id": f"{form}-{depth}", "form": form, "palette_family": PALETTE_FAMILY.get(form, form), "depth": depth, "stage": item["stage"],
            "file": low, "sha256": hashes[low], "display_file": high, "display_sha256": hashes[high],
            "source_id": source_id, "source_file": f"morphology/{source_id}-128.png", "source_sha256": hashes[f"morphology/{source_id}-128.png"],
            "palette": {r: {s: rgb_to_hex(item["palette"][r][s]) for s in SHADES} for r in ROLES},
            "source_palette": {r: {s: profiles[form][r][s].upper() for s in SHADES} for r in ROLES},
            "neutral": {n: neutral[n].upper() for n in NEUTRALS},
            "transform": {"depth_step": [d for d, _ in DEPTHS].index(depth), "k": step[0], "w": step[1], "c": step[2], "tertiary_k": 1.0, "tertiary_w": step[1] / 2, "linear_clipped": item["clipped"]},
            "alpha": "identical-to-source", "alpha_sha256": item["source_alpha_sha256"], "status": "candidate", "qvl": "pending",
        })
    return {
        "schema": "evolution-depth-colors-v1",
        "status": "candidate",
        "morphology": "accepted-for-pipeline",
        "qvl": "pending",
        "counts": {"sources": len(sources), "variants": len(variants), "png_files": 2 * (len(sources) + len(variants))},
        "tool_versions": {"python": platform.python_version(), "pillow": Image.__version__},
        "colour_math": {
            "space": "CIELAB D65, float64", "P": PIVOT, "H_deg": HUE_DEG, "CT": CHROMA_TARGET, "steps": {d: {"k": k, "w": w, "c": c} for d, (k, w, c) in STEPS.items()},
            "white": list(WHITE), "rgb_to_xyz": [list(r) for r in RGB_TO_XYZ], "xyz_to_rgb": [list(r) for r in XYZ_TO_RGB],
            "rounding": "python round(), clamp 0..255, linear clamp 0..1 before companding",
        },
        "normalization": {"key_color": rgb_to_hex(KEY_COLOR), "key_tolerance": KEY_TOLERANCE, "despill_ramp": list(DESPILL_RAMP), "edge_band_px": EDGE_BAND, "alpha_threshold": ALPHA_THRESHOLD, "fit_long_side": FIT_LONG_SIDE, "canvas": CANVAS, "min_margin_128": MIN_MARGIN, "display": "nearest x2"},
        "inputs": {**INPUT_PINS, "squid-kraken-v1/palette-profile.json": "verified equal to palette-profiles.json#families.octopus"},
        "legacy_untouched": ["variants/", "masks/", "revisions/", "variant-manifest.json", "palette-profiles.json", "../codex-creature-palette-base/depth-variants/"],
        "sources": sources,
        "variants": variants,
    }


def write(result, outdir):
    outdir = Path(outdir)
    files = {}
    for form in FORMS:
        for stage in STAGES:
            files[f"morphology/{form}-{stage}-128.png"] = result["sources"][(form, stage)][0]
        for depth, _ in DEPTHS:
            files[f"{form}-{depth}-128.png"] = result["variants"][(form, depth)]["image"]
    for name in list(files):
        files[name.replace("-128.png", "-256.png")] = display(files[name])
    targets = [outdir / n for n in [*files, "depth-color-manifest.json"]]
    existing = [t for t in targets if t.exists()]
    if existing:
        raise RuntimeError(f"Output exists; not overwriting: {existing[0]}")
    data = {n: png_bytes(a) for n, a in files.items()}
    hashes = {n: sha_bytes(b) for n, b in data.items()}
    manifest = json.dumps(build_manifest(result, hashes), indent=2) + "\n"
    for name, payload in [*data.items(), ("depth-color-manifest.json", manifest.encode("utf-8"))]:
        target = outdir / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "xb") as handle:
            handle.write(payload)
    return len(data)


def doubled(image):
    """Independent 2x nearest-neighbour pixel list (each pixel repeated, each row repeated)."""
    px, width, out = pixels(image), image.width, []
    for y in range(image.height):
        row = [p for p in px[y * width : (y + 1) * width] for _ in (0, 1)]
        out += row + row
    return out


def check_disk(result, outdir, evo=EVO, legacy=LEGACY):
    """Compare files on disk to the in-memory rebuild and the manifest. Writes nothing."""
    checks, outdir = [], Path(outdir)
    expected = expected_files(outdir)
    actual = sorted(p.relative_to(outdir).as_posix() for p in outdir.rglob("*") if p.is_file()) if outdir.exists() else []
    record(checks, "exact file set (36 source + 60 variant PNGs + manifest)", actual == expected, {"expected": len(expected), "found": len(actual), "missing": sorted(set(expected) - set(actual))[:5], "extra": sorted(set(actual) - set(expected))[:5]})
    if actual != expected:
        return checks
    hashes = {n: sha_file(outdir / n) for n in expected if n.endswith(".png")}
    bad = []
    for form in FORMS:
        items = [(f"morphology/{form}-{s}", result["sources"][(form, s)][0]) for s in STAGES] + [(f"{form}-{d}", result["variants"][(form, d)]["image"]) for d, _ in DEPTHS]
        for stem, image in items:
            for suffix, want in (("128", image), ("256", display(image))):
                raw = (outdir / f"{stem}-{suffix}.png").read_bytes()
                got = Image.open(outdir / f"{stem}-{suffix}.png")
                got.load()
                size = int(suffix)
                if raw[25] != 6 or got.mode != "RGBA" or got.size != (size, size) or got.tobytes() != want.tobytes():
                    bad.append(f"{stem}-{suffix}")
                if suffix == "256" and pixels(got) != doubled(image):
                    bad.append(f"{stem}-256 nearest")
    record(checks, "PNG color type 6, dimensions, pixels equal rebuild, 256 = nearest x2", not bad, bad)

    manifest_text = (outdir / "depth-color-manifest.json").read_text(encoding="utf-8")
    manifest = json.loads(manifest_text)
    expected_manifest = build_manifest(result, hashes)
    for doc in (manifest, expected_manifest):
        doc.pop("tool_versions")
    record(checks, "manifest equals rebuild; every file hash matches", manifest == expected_manifest)
    record(checks, "manifest counts 18 sources / 30 variants", len(manifest["sources"]) == 18 and len(manifest["variants"]) == 30 and manifest["counts"]["png_files"] == 96)
    record(checks, "all entries candidate, qvl pending, no approved/final wording", all(e["status"] == "candidate" for e in manifest["sources"] + manifest["variants"]) and all(v["qvl"] == "pending" for v in manifest["variants"]) and not re.search(r"approved|final", manifest_text, re.I))
    originals = [sha_file(evo / s["origin_file"]) == s["origin_sha256"] for s in manifest["sources"]]
    record(checks, "18 original source hashes unchanged", all(originals), sum(originals))
    pinned = [sha_file(evo / rel) == pin for rel, pin in INPUT_PINS.items()]
    legacy_doc = json.loads((legacy / "depth-variants.json").read_text(encoding="utf-8"))
    legacy_ok = [sha_file(legacy / v[f]) == v[h] for v in legacy_doc["variants"] for f, h in (("file", "sha256"), ("display_file", "display_sha256"))]
    record(checks, "legacy depth-variants (60 files) and pinned inputs unchanged", all(pinned) and all(legacy_ok) and len(legacy_ok) == 60, {"legacy": sum(legacy_ok), "pins": sum(pinned)})
    return checks


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--build", action="store_true", help="compute, validate and write new outputs (never overwrites)")
    mode.add_argument("--check", action="store_true", help="recompute and compare with disk; writes nothing")
    parser.add_argument("--dir", type=Path, default=DEFAULT_DIR, help="output directory (default: depth-colors/)")
    args = parser.parse_args(argv)
    result = compute()
    checks = validate(result)
    failures = [c for c in checks if not c["passed"]]
    if args.build:
        if failures:
            print(json.dumps({"passed": False, "failures": failures}, indent=2))
            return 1
        print(json.dumps({"written": write(result, args.dir), "dir": str(args.dir)}))
        return 0
    checks += check_disk(result, args.dir)
    failures = [c for c in checks if not c["passed"]]
    print(json.dumps({"passed": not failures, "checks": checks, "failures": [c["check"] for c in failures]}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
