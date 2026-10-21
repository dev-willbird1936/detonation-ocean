"""Verify native provenance, palette exports, masks, and browser evidence."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/codex-creature-depth-evolution"
BASES = ROOT / "ocean-style-prototypes/codex-creature-palette-base"
FAMILIES = {"anglerfish", "viperfish", "siphonophore", "isopod-host", "cookiecutter", "octopus"}
STAGES = {"base-rich", "midnight-abyss", "trench"}
DEPTHS = {"base-rich": ["sunlight", "twilight"], "midnight-abyss": ["midnight", "abyss"], "trench": ["trench"]}
SHADE_NAMES = ("shadow", "base", "highlight")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[index : index + 2], 16) for index in (0, 2, 4))


def record_check(checks, name, passed, detail=None):
    checks.append({"check": name, "passed": bool(passed), "detail": detail})


def main():
    checks = []
    failures = []
    profiles = json.loads((OUT / "palette-profiles.json").read_text(encoding="utf-8"))
    report = json.loads((OUT / "generation-report.json").read_text(encoding="utf-8"))
    references = json.loads((OUT / "reference-manifest.json").read_text(encoding="utf-8"))
    manifest = json.loads((OUT / "variant-manifest.json").read_text(encoding="utf-8"))
    browser = json.loads((OUT / "browser-verification-palette.json").read_text(encoding="utf-8"))
    recovery = json.loads((OUT / "packaging-recovery.json").read_text(encoding="utf-8"))

    report_entries = {f"{item['family']}/{item['stage']}": item for item in report["entries"]}
    record_check(checks, "native generation count", report.get("requests_completed") == 12 and len(report_entries) == 12, len(report_entries))
    record_check(checks, "generation pairs unique", len(report_entries) == 12)
    reference_results = []
    for reference in references:
        path = ROOT / reference["file"]
        ok = path.exists() and digest(path) == reference["sha256"]
        reference_results.append(ok)
        if not ok:
            failures.append(f"Reference missing/hash mismatch: {reference['file']}")
    record_check(checks, "reference copies match hashes", all(reference_results), {"verified": sum(reference_results), "expected": len(reference_results)})

    new_native_results = []
    for key, item in report_entries.items():
        source = OUT / item["workspace_copy"]["path"]
        actual = digest(source) if source.exists() else None
        expected = item["workspace_copy"]["sha256"]
        native = item["native_staging"]["sha256"]
        ok = source.exists() and actual == expected == native and item["request_count"] == 1
        new_native_results.append(ok)
        if not ok:
            failures.append(f"Native output copy/request mismatch: {key}")
        image = Image.open(source) if source.exists() else None
        if image and (image.mode != "RGBA" or 0 not in image.getchannel("A").getextrema() or 255 not in image.getchannel("A").getextrema()):
            failures.append(f"Native image transparency/format mismatch: {key}")
    record_check(checks, "native image copies equal staged hashes", all(new_native_results), {"verified": sum(new_native_results), "expected": 12})

    pairs = {(entry["family"], entry["stage"]) for entry in manifest["variants"]}
    expected_pairs = {(family, stage) for family in FAMILIES for stage in STAGES}
    record_check(checks, "18 family/form cells", len(manifest["variants"]) == 18 and pairs == expected_pairs, len(pairs))
    record_check(checks, "depth grouping", all(entry["depths"] == DEPTHS[entry["stage"]] for entry in manifest["variants"]))
    palette_colors = {family: {rgb(profiles["families"][family][role][shade]) for role in profiles["families"][family] for shade in SHADE_NAMES} | {rgb(value) for value in profiles["neutral"].values()} for family in FAMILIES}
    base_manifest = json.loads((BASES / "indexed-manifest.json").read_text(encoding="utf-8"))
    base_native = {item["family"]: item for item in base_manifest["assets"]}
    output_results = []
    mask_results = []
    palette_results = []
    for entry in manifest["variants"]:
        family, stage = entry["family"], entry["stage"]
        for field, expected_size in (("file", (128, 128)), ("display_file", (256, 256))):
            path = OUT / entry[field]
            ok = path.exists() and digest(path) == entry["sha256" if field == "file" else "display_sha256"]
            if ok:
                image = Image.open(path).convert("RGBA")
                ok = image.size == expected_size and image.getchannel("A").getextrema() == (0, 255)
            output_results.append(ok)
            if not ok:
                failures.append(f"Variant output missing/hash/dimension/alpha mismatch: {entry['id']}/{field}")
        image = Image.open(OUT / entry["file"]).convert("RGBA")
        pixels = list(image.get_flattened_data())
        colors = {pixel[:3] for pixel in pixels if pixel[3]}
        palette_ok = colors <= palette_colors[family] and len(colors) == entry["visible_color_count"]
        palette_results.append(palette_ok)
        if not palette_ok:
            failures.append(f"Unexpected or mismatched palette: {entry['id']}")
        for role, role_entry in entry["role_masks"].items():
            role_colors = {rgb(profiles["families"][family][role][shade]) for shade in SHADE_NAMES}
            role_path = OUT / role_entry["file"]
            role_mask = Image.open(role_path).convert("L") if role_path.exists() else None
            expected_role = [255 if pixel[3] and pixel[:3] in role_colors else 0 for pixel in pixels]
            role_ok = role_mask is not None and role_mask.size == image.size and list(role_mask.get_flattened_data()) == expected_role and digest(role_path) == role_entry["sha256"]
            mask_results.append(role_ok)
            if not role_ok:
                failures.append(f"Role mask mismatch: {entry['id']}/{role}")
            for shade, shade_entry in role_entry["shades"].items():
                shade_path = OUT / shade_entry["file"]
                shade_mask = Image.open(shade_path).convert("L") if shade_path.exists() else None
                color = rgb(profiles["families"][family][role][shade])
                expected_shade = [255 if pixel[3] and pixel[:3] == color else 0 for pixel in pixels]
                shade_ok = shade_mask is not None and shade_mask.size == image.size and list(shade_mask.get_flattened_data()) == expected_shade and digest(shade_path) == shade_entry["sha256"]
                mask_results.append(shade_ok)
                if not shade_ok:
                    failures.append(f"Shade mask mismatch: {entry['id']}/{role}/{shade}")
        if stage == "base-rich":
            original = BASES / base_native[family]["native_file"]
            ok = original.exists() and digest(original) == base_native[family]["native_sha256"] == entry["native_or_base_sha256"]
            if not ok:
                failures.append(f"Base source hash mismatch: {family}")
    record_check(checks, "18 logical/display exports hash, size and alpha", all(output_results), {"verified": sum(output_results), "expected": 36})
    record_check(checks, "exact per-family role palette", all(palette_results))
    record_check(checks, "role and shade masks match exported pixels", all(mask_results), {"verified": sum(mask_results), "expected": 216})

    record_check(checks, "browser renders all forms", browser.get("cards") == 18 and browser.get("decodedImages") == 18 and browser.get("failedImages") == 0 and not browser.get("horizontalOverflow"))
    recovery_ok = True
    for item in recovery["files"]:
        path = OUT / item["preserved_at"]
        if not path.exists() or digest(path) != item["sha256"]:
            recovery_ok = False
            failures.append(f"Packaging recovery file missing/hash mismatch: {item['preserved_at']}")
    record_check(checks, "failed packaging attempt files preserved", recovery_ok and recovery["count"] == len(recovery["files"]) == 162)

    style_evidence = json.loads((ROOT / "ocean-style-prototypes/style-depth-delivery-evidence.json").read_text(encoding="utf-8"))
    style_assets = style_evidence["generated_layers"]["assets"]
    style_native_ok = all((ROOT / "ocean-style-prototypes" / item["native_source"].replace(chr(92), "/")).exists() and digest(ROOT / "ocean-style-prototypes" / item["native_source"].replace(chr(92), "/")) == item["native_sha256"] for item in style_assets)
    style_exports_ok = all((ROOT / "ocean-style-prototypes" / item["final_layer"].replace(chr(92), "/")).exists() and digest(ROOT / "ocean-style-prototypes" / item["final_layer"].replace(chr(92), "/")) == item["final_sha256"] for item in style_assets)
    record_check(checks, "separate six-style/five-depth native sources", style_native_ok, {"verified": len(style_assets) if style_native_ok else 0, "expected": 30})
    record_check(checks, "separate six-style/five-depth exports", style_exports_ok, {"verified": len(style_assets) if style_exports_ok else 0, "expected": 30})

    evidence = {"verifiedAtUtc": datetime.now(timezone.utc).isoformat(), "checks": checks, "failures": failures, "passed": not failures and all(item["passed"] for item in checks), "scope": {"families": 6, "formsPerFamily": 3, "nativeNewImages": 12, "offlineBaseRecolors": 6, "nativeStyleDepthLayers": 30, "styleDepthPairs": 30}}
    output = OUT / "integrity-verification-recheck.json"
    if output.exists():
        raise RuntimeError(f"Refusing to overwrite {output}")
    output.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps({"passed": evidence["passed"], "checks": len(checks), "failures": failures}, indent=2))
    if not evidence["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
