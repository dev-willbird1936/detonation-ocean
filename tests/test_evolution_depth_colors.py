"""Offline tests for tools/build-evolution-depth-colors.py: no API requests, no secrets read.

Standard library and Pillow only.
"""

import importlib.util
import json
import random
import shutil
import subprocess
import sys
import tempfile
import unittest
from collections import deque
from pathlib import Path

from PIL import Image

TOOL = Path(__file__).resolve().parents[1] / "tools/build-evolution-depth-colors.py"
spec = importlib.util.spec_from_file_location("depth_colors", TOOL)
dc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dc)

KEY = dc.KEY_COLOR
_cache = {}


def result():
    if "result" not in _cache:
        _cache["result"] = dc.compute()
    return _cache["result"]


def built_dir():
    """Build once into a temp dir shared by the integration tests."""
    if "built" not in _cache:
        _cache["tmp"] = tempfile.TemporaryDirectory()
        _cache["built"] = Path(_cache["tmp"].name) / "depth-colors"
        dc.write(result(), _cache["built"])
    return _cache["built"]


def tearDownModule():
    if "tmp" in _cache:
        _cache["tmp"].cleanup()


def solid(size, color, mode="RGB"):
    return Image.new(mode, size, color)


def brute_label(mask, width, height, eight):
    """Reference flood-fill labelling (first raster appearance numbering), used only to test dc.label."""
    out, count = [0] * (width * height), 0
    steps = [(-1, 0), (1, 0), (0, -1), (0, 1)] + ([(-1, -1), (-1, 1), (1, -1), (1, 1)] if eight else [])
    for start in range(width * height):
        if mask[start] and not out[start]:
            count += 1
            out[start] = count
            queue = deque([divmod(start, width)])
            while queue:
                cy, cx = queue.popleft()
                for dy, dx in steps:
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < height and 0 <= nx < width and mask[ny * width + nx] and not out[ny * width + nx]:
                        out[ny * width + nx] = count
                        queue.append((ny, nx))
    return out, count


def synthetic_key_field():
    """Noisy near-magenta field, a creature block with two enclosed pockets, a speck and pink details."""
    rng = random.Random(7)
    image = Image.new("RGB", (80, 80))
    image.putdata([tuple(min(255, max(0, c + rng.randint(-8, 8))) for c in KEY) for _ in range(80 * 80)])
    image.paste((236, 12, 240), (0, 0, 12, 12))  # corner drift
    image.paste((30, 60, 70), (20, 20, 60, 60))
    image.paste(KEY, (28, 28, 34, 34))  # enclosed pocket 1 (36 px)
    image.paste((250, 4, 252), (44, 44, 50, 48))  # enclosed pocket 2 (24 px), slightly off-key
    image.paste((30, 60, 70), (70, 2, 72, 4))  # stray speck outside the creature
    image.putpixel((38, 40), (230, 100, 160))  # legitimate pink interior detail (key distance about 140)
    image.putpixel((22, 22), (23, 35, 45))  # dark outline pixel
    return image


def alpha_values(image):
    return set(image.getchannel("A").tobytes())


class LabelTests(unittest.TestCase):
    def test_matches_flood_fill_reference(self):
        rng = random.Random(3)
        width, height = 14, 11
        for _ in range(40):
            mask = bytes(int(rng.random() < 0.45) for _ in range(width * height))
            for eight in (False, True):
                runs, sizes = dc.label(mask, width, height, eight)
                got = [0] * (width * height)
                for y, start, end, lab in runs:
                    got[y * width + start : y * width + end] = [lab] * (end - start)
                want, want_count = brute_label(mask, width, height, eight)
                self.assertEqual(len(sizes) - 1, want_count)
                self.assertEqual(got, want)
                self.assertEqual(sizes[1:], [want.count(i) for i in range(1, want_count + 1)])


class KeyTests(unittest.TestCase):
    def setUp(self):
        self.image = synthetic_key_field()
        self.rgba, self.report = dc.key_source(self.image)

    def test_background_and_enclosed_pockets_removed_without_flood_fill(self):
        self.assertEqual(alpha_values(self.rgba), {0, 255})
        self.assertEqual(self.rgba.crop((0, 0, 12, 12)).getchannel("A").getextrema(), (0, 0))
        self.assertEqual(self.rgba.crop((28, 28, 34, 34)).getchannel("A").getextrema(), (0, 0))
        self.assertEqual(self.rgba.crop((44, 44, 50, 48)).getchannel("A").getextrema(), (0, 0))
        self.assertEqual(self.report["enclosed_pockets"], 2)
        self.assertEqual(self.report["enclosed_pocket_px"], 36 + 24)

    def test_speck_discarded_and_reported(self):
        self.assertEqual(self.rgba.crop((70, 2, 72, 4)).getchannel("A").getextrema(), (0, 0))
        self.assertEqual(self.report["discarded_components_px"], [4])
        self.assertEqual(self.report["removed_component_px"], 4)
        self.assertEqual(self.report["retained_component_px"], 1600 - 36 - 24)

    def test_creature_pixels_protected_from_false_positives(self):
        self.assertEqual(self.rgba.getpixel((22, 22)), (23, 35, 45, 255))  # dark outline
        self.assertEqual(self.rgba.getpixel((38, 40)), (230, 100, 160, 255))  # pink interior detail kept, not despilled
        self.assertEqual(self.rgba.getpixel((30, 50)), (30, 60, 70, 255))
        self.assertGreaterEqual(self.report["protected_interior_soft_px"], 1)

    def test_tolerance_boundary(self):
        for distance, opaque in ((110, False), (119, False), (121, True), (130, True)):
            image = solid((20, 20), KEY)
            image.paste((30, 60, 70), (5, 5, 15, 15))
            image.putpixel((4, 10), (255, 0, 255 - distance))  # blue-only offset => key distance == offset
            rgba, _ = dc.key_source(image)
            self.assertEqual(bool(rgba.getpixel((4, 10))[3]), opaque, distance)

    def test_antialiased_edge_is_depinked_by_unmixing(self):
        body, alpha = (30, 60, 70), 0.45  # key distance about 134, inside the soft ramp
        edge = tuple(round(alpha * b + (1 - alpha) * k) for b, k in zip(body, KEY))
        image = solid((20, 20), KEY)
        image.paste(body, (5, 5, 15, 15))
        image.putpixel((4, 10), edge)  # one soft pixel on the left border of the creature
        rgba, _ = dc.key_source(image)
        got = rgba.getpixel((4, 10))
        self.assertEqual(got[3], 255)
        dist = lambda a, b: sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5
        self.assertLess(dist(got[:3], body), 0.6 * dist(edge, body))  # moves toward the creature colour
        self.assertGreater(dist(got[:3], KEY), dist(edge, KEY))  # and away from the key

    def test_no_pixels_outside_mask_keep_colour(self):
        self.assertTrue(all(p == (0, 0, 0, 0) for p in dc.pixels(self.rgba) if not p[3]))


class AlphaThresholdTests(unittest.TestCase):
    def test_binary_alpha_and_haze_removed(self):
        image = Image.new("RGBA", (20, 20), (0, 0, 0, 0))
        image.paste((40, 80, 120, 254), (5, 5, 15, 15))
        image.putpixel((6, 6), (40, 80, 120, 128))  # kept (>= threshold)
        image.putpixel((7, 7), (40, 80, 120, 127))  # dropped, but interior => pocket
        image.paste((10, 10, 10, 15), (0, 0, 3, 3))  # haze
        image.putpixel((18, 18), (10, 10, 10, 1))
        out, report = dc.threshold_alpha(image)
        self.assertEqual(alpha_values(out), {0, 255})
        self.assertEqual(out.getpixel((6, 6))[3], 255)
        self.assertEqual(out.getpixel((7, 7))[3], 0)
        self.assertEqual(out.crop((0, 0, 3, 3)).getchannel("A").getextrema(), (0, 0))
        self.assertEqual(out.getpixel((18, 18))[3], 0)
        self.assertEqual(out.getpixel((10, 10)), (40, 80, 120, 255))
        self.assertEqual(report["haze_px"], 9 + 1 + 1)
        self.assertEqual(report["enclosed_pockets"], 1)
        self.assertEqual(report["removed_component_px"], 0)
        self.assertTrue(all(p == (0, 0, 0, 0) for p in dc.pixels(out) if not p[3]))


class FitTests(unittest.TestCase):
    def test_thin_native_margins_become_16px_margins_and_centred(self):
        image = Image.new("RGBA", (400, 400), (0, 0, 0, 0))
        image.paste((60, 90, 120, 255), (7, 6, 393, 394))  # about 1.5-2% margins
        fitted, bbox, size = dc.fit_to_canvas(image)
        left, top, right, bottom = dc.margins(fitted)
        self.assertEqual(fitted.size, (128, 128))
        self.assertGreaterEqual(min(left, top, right, bottom), dc.MIN_MARGIN)
        self.assertEqual(max(size), 96)
        self.assertLessEqual(abs(left - right), 1)
        self.assertEqual(alpha_values(fitted), {0, 255})
        self.assertEqual(bbox, [7, 6, 393, 394])


class IndexAndRecolorTests(unittest.TestCase):
    def setUp(self):
        profiles, self.neutral = dc.load_profiles()
        self.profile = profiles["anglerfish"]
        self.palette = dc.palette_colors(self.profile, self.neutral)

    def test_index_picks_nearest_swatch(self):
        image = dc.from_pixels((2, 2), [(12, 125, 140, 255), (225, 215, 180, 255), (0, 0, 0, 0), (0, 0, 0, 0)])
        out, _ = dc.index_to_palette(image, self.palette)
        got = dc.pixels(out)
        self.assertEqual(got[0], (*dc.hex_to_rgb(self.profile["primary"]["base"]), 255))
        self.assertEqual(got[1], (*dc.hex_to_rgb(self.profile["secondary"]["highlight"]), 255))
        self.assertEqual(got[3], (0, 0, 0, 0))

    def test_recolor_remaps_swatches_keeps_neutrals_and_alpha(self):
        old = dc.hex_to_rgb(self.profile["primary"]["base"])
        outline = dc.hex_to_rgb(self.neutral["outline"])
        source = dc.from_pixels((3, 1), [(*old, 255), (*outline, 255), (0, 0, 0, 0)])
        out = dc.recolor(source, {old: (1, 2, 3)}, [outline])
        self.assertEqual(dc.pixels(out), [(1, 2, 3, 255), (*outline, 255), (0, 0, 0, 0)])
        self.assertEqual(dc.alpha_bytes(out), dc.alpha_bytes(source))

    def test_recolor_aborts_on_off_palette_colour(self):
        source = dc.from_pixels((1, 1), [(1, 2, 3, 255)])
        with self.assertRaisesRegex(RuntimeError, "outside the indexed palette"):
            dc.recolor(source, {(9, 9, 9): (0, 0, 0)}, [(8, 8, 8)])


def inverse3(m):
    """3x3 inverse by cofactors (reference for the pinned XYZ->RGB matrix)."""
    (a, b, c), (d, e, f), (g, h, i) = m
    det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    cof = [[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]]
    return [[v / det for v in row] for row in cof]


class TransformTests(unittest.TestCase):
    def test_constants(self):
        self.assertEqual((dc.PIVOT, dc.HUE_DEG, dc.CHROMA_TARGET), (18.0, 274.4, 20.0))
        self.assertEqual(dc.STEPS["sunlight"], (1.0, 0.0, 1.0))
        self.assertEqual(dc.STEPS["twilight"], (0.867, 0.15, 1.0))
        self.assertEqual(dc.STEPS["midnight"], (0.754, 0.30, 1.0))
        self.assertEqual(dc.STEPS["abyss"], (0.667, 0.45, 0.85))
        self.assertEqual(dc.STEPS["trench"], (0.466, 0.60, 0.75))
        for got_row, want_row in zip(dc.XYZ_TO_RGB, inverse3(dc.RGB_TO_XYZ)):
            for got, want in zip(got_row, want_row):
                self.assertAlmostEqual(got, want, delta=2e-6)

    def test_sunlight_step_round_trips_all_54_swatches(self):
        profiles, _ = dc.load_profiles()
        count = 0
        for profile in profiles.values():
            for role in dc.ROLES:
                for shade in dc.SHADES:
                    rgb = dc.hex_to_rgb(profile[role][shade])
                    self.assertEqual(dc.transform_swatch(rgb, role, "sunlight")[0], rgb)
                    count += 1
        self.assertEqual(count, 54)

    def test_golden_swatches_from_the_plan(self):
        # Plan samples. Anglerfish Trench secondary highlight is #72757D here: the plan lists #72757C,
        # 1 LSB lower, but the documented constants give 124.54 in blue, which rounds to 125.
        golden = {
            ("squid", "twilight"): "#5A3947 #965150 #C67E69 | #22395E #376188 #7999BD | #786133 #BFA34B #EFD07F",
            ("squid", "trench"): "#3C3545 #58444F #6F5A5F | #25334B #344861 #52637C | #70624F #B5A47A #E4D1AB",
            ("anglerfish", "abyss"): "#1F3D4D #325F6F #53828B | #435462 #6A7E89 #979899 | #975F4B #C68F66 #E7C896",
            ("anglerfish", "trench"): "#223848 #304F5F #466772 | #3A4757 #546471 #72757D | #906255 #BE9173 #E1C9A4",
        }
        profiles, _ = dc.load_profiles()
        for (form, depth), want in golden.items():
            palette, clipped = dc.transformed_profile(profiles[form], depth)
            got = " | ".join(" ".join(dc.rgb_to_hex(palette[r][s]) for s in dc.SHADES) for r in dc.ROLES)
            self.assertFalse(clipped)
            self.assertEqual(got, want, (form, depth))

    def test_tertiary_keeps_luminance(self):
        rgb = dc.hex_to_rgb("#D7883E")
        out, _ = dc.transform_swatch(rgb, "tertiary", "trench")
        self.assertAlmostEqual(dc.rgb_to_lab(out)[0], dc.rgb_to_lab(rgb)[0], delta=0.6)


class BuildTests(unittest.TestCase):
    def test_counts_ids_and_validation(self):
        res = result()
        self.assertEqual(len(res["sources"]), 18)
        self.assertEqual(len(res["variants"]), 30)
        self.assertEqual({f"{f}-{d}" for f, d in res["variants"]}, {f"{f}-{d}" for f in dc.FORMS for d, _ in dc.DEPTHS})
        failures = [c for c in dc.validate(res) if not c["passed"]]
        self.assertEqual(failures, [])

    def test_source_pins_and_squid_is_not_octopus(self):
        res = result()
        self.assertEqual(sum(1 for _, r in res["sources"].values() if r["origin"] == "round5-replacement"), 6)
        self.assertTrue(all("octopus" not in r["origin_file"] for _, r in res["sources"].values()))
        self.assertIn("evolution-iteration-02", dc.NEW_SOURCES[("viperfish", "trench")][0])
        self.assertEqual(res["profiles"]["squid"], json.loads((dc.EVO / "palette-profiles.json").read_text(encoding="utf-8"))["families"]["octopus"])

    def test_key_reports_match_review(self):
        reports = {k: r["process"] for k, (_, r) in result()["sources"].items() if k in dc.NEW_SOURCES}
        self.assertEqual(reports[("siphonophore", "trench")]["enclosed_pockets"], 25)
        self.assertEqual(reports[("squid", "trench")]["enclosed_pockets"], 3)
        self.assertEqual(reports[("cookiecutter", "midnight-abyss")]["enclosed_pockets"], 0)
        for process in reports.values():
            self.assertLessEqual(process["removed_component_px"], dc.MAX_REMOVED_PX)

    def test_all_new_outputs_are_candidates(self):
        manifest = json.loads((built_dir() / "depth-color-manifest.json").read_text(encoding="utf-8"))
        self.assertTrue(all(e["status"] == "candidate" for e in manifest["sources"] + manifest["variants"]))
        self.assertTrue(all(v["qvl"] == "pending" for v in manifest["variants"]))

    def test_build_is_deterministic(self):
        with tempfile.TemporaryDirectory() as other:
            dc.write(dc.compute(), Path(other) / "depth-colors")
            first = {p.relative_to(built_dir()).as_posix(): dc.sha_file(p) for p in built_dir().rglob("*") if p.is_file()}
            second = {p.relative_to(Path(other) / "depth-colors").as_posix(): dc.sha_file(p) for p in (Path(other) / "depth-colors").rglob("*") if p.is_file()}
        self.assertEqual(len(first), 97)
        self.assertEqual(first, second)

    def test_write_refuses_to_overwrite(self):
        before = dc.sha_file(built_dir() / "depth-color-manifest.json")
        with self.assertRaisesRegex(RuntimeError, "not overwriting"):
            dc.write(result(), built_dir())
        self.assertEqual(before, dc.sha_file(built_dir() / "depth-color-manifest.json"))

    def test_check_disk_passes_on_fresh_build(self):
        failures = [c for c in dc.check_disk(result(), built_dir()) if not c["passed"]]
        self.assertEqual(failures, [])

    def test_check_cli_passes_and_fails_on_flipped_byte(self):
        run = lambda target: subprocess.run([sys.executable, str(TOOL), "--check", "--dir", str(target)], capture_output=True, text=True)
        self.assertEqual(run(built_dir()).returncode, 0)
        with tempfile.TemporaryDirectory() as other:
            copy = Path(other) / "depth-colors"
            shutil.copytree(built_dir(), copy)
            target = copy / "anglerfish-trench-128.png"
            data = bytearray(target.read_bytes())
            data[-20] ^= 0xFF
            target.write_bytes(bytes(data))
            self.assertEqual(run(copy).returncode, 1)

    def test_check_cli_fails_on_missing_directory(self):
        with tempfile.TemporaryDirectory() as other:
            proc = subprocess.run([sys.executable, str(TOOL), "--check", "--dir", str(Path(other) / "none")], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 1)

    def test_committed_outputs_pass_check_when_present(self):
        if not dc.DEFAULT_DIR.exists():
            self.skipTest("depth-colors/ not built yet")
        failures = [c for c in dc.check_disk(result(), dc.DEFAULT_DIR) if not c["passed"]]
        self.assertEqual(failures, [])

    def test_outputs_stay_under_expected_folder(self):
        names = dc.expected_files(dc.DEFAULT_DIR)
        self.assertEqual(len(names), 97)
        self.assertTrue(all(not n.startswith(("variants/", "masks/", "revisions/")) for n in names))

    def test_tool_and_tests_use_only_stdlib_and_pillow(self):
        allowed = {"argparse", "collections", "hashlib", "importlib", "io", "json", "math", "pathlib", "platform", "random", "re", "shutil", "subprocess", "sys", "tempfile", "unittest", "PIL"}
        for path in (TOOL, Path(__file__)):
            imported = {line.split()[1].split(".")[0] for line in path.read_text(encoding="utf-8").splitlines() if line.startswith(("import ", "from "))}
            self.assertLessEqual(imported, allowed, path.name)


if __name__ == "__main__":
    unittest.main()
