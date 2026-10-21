"""Offline export of the 18 native stage masters into 30 depth-coloured loops.

No network, no secrets, no frame synthesis. Waits for 18 verified native masters and passing, hash-bound
pilot and final QVL records. A master that fails a gate is preserved and the export writes nothing.
Outputs are candidates for review; the depth manifest and every existing asset stay untouched.
"""

import argparse
import importlib.util
import io
import json
from pathlib import Path
import sys

import PIL
from PIL import Image, ImageDraw, ImageSequence

SPEC = importlib.util.spec_from_file_location("stages", Path(__file__).with_name("retrodiffusion-evolution-stages.py"))
stages = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(stages)

SIZE = 128
OPAQUE = [0] * 128 + [255] * 128  # Binary alpha lookup table.
BACKDROP = "#243b4b"


class NotReady(RuntimeError):
    """Inputs are incomplete or unreviewed; nothing is written."""


def readiness():
    out = stages.OUT
    try:
        plan, plan_sha = stages.load_plan()
        stages.verify_plan(plan)
    except (OSError, RuntimeError, ValueError) as error:
        raise NotReady(f"plan is not valid: {error}") from None
    issues = []
    masters = {}
    manifest_path = out / "manifest.json"
    if not manifest_path.exists():
        issues.append("masters manifest missing")
    else:
        manifest = stages.jload(manifest_path)
        if manifest.get("plan_sha256") != plan_sha:
            issues.append("masters manifest belongs to a different plan")
        if manifest.get("failures"):
            issues.append("masters manifest records failures")
        masters = {m["id"]: m for m in manifest.get("masters", [])}
        if len(masters) != len(manifest.get("masters", [])):
            issues.append("duplicate master entries")
    for loop in plan["loops"]:
        entry, path = masters.get(loop["id"]), out / loop["output_file"]
        if entry is None:
            issues.append(f"missing native master {loop['id']}")
        elif not path.exists() or stages.sha256_file(path) != entry["sha256"]:
            issues.append(f"native master {loop['id']} missing or changed")
        for flag in ("failed.json", "ambiguous.json"):
            if (stages.job_dir(loop["id"]) / flag).exists():
                issues.append(f"{loop['id']} has {flag}")
    ledger_path = out / "ledger.json"
    if not ledger_path.exists():
        issues.append("ledger missing")
    else:
        ledger = stages.jload(ledger_path)
        if ledger.get("plan_sha256") != plan_sha:
            issues.append("ledger belongs to a different plan")
        missing = [l["id"] for l in plan["loops"] if l["id"] not in ledger["actual_charges"]]
        if missing:
            issues.append(f"no recorded charge for {len(missing)} loops")
        if stages.committed(ledger) > stages.CAP or sum(ledger["actual_charges"].values()) > stages.CAP:
            issues.append("ledger exceeds the cap")
    if len(masters) == 18 and not issues:
        pilot = masters[stages.PILOT]["sha256"]
        records = (
            (stages.pilot_qvl_path(), "pilot", {"loop_id": stages.PILOT, "native_sha256": pilot}),
            (
                stages.final_qvl_path(),
                "final",
                {"masters_manifest_sha256": stages.sha256_file(manifest_path), "masters": {i: m["sha256"] for i, m in masters.items()}},
            ),
        )
        for path, scope, expected in records:
            try:
                stages.read_qvl(path, scope, plan_sha, expected)
            except RuntimeError as error:
                issues.append(str(error))
    if (out / "exports").exists():
        issues.append("exports/ exists; not overwriting")
    if issues:
        raise NotReady("; ".join(issues))
    return plan, plan_sha, stages.sha256_file(manifest_path)


def analyse(loop, gates):
    """Decode one native master, apply one clip-wide shift and index colours. No per-frame reframing."""
    out, problems = stages.OUT, []
    native = Image.open(io.BytesIO((out / loop["output_file"]).read_bytes()))
    frames, durations = [], []
    for frame in ImageSequence.Iterator(native):
        durations.append(int(frame.info.get("duration") or native.info.get("duration") or 100))
        frames.append(frame.convert("RGBA"))
    count = len(frames)
    result = {"id": loop["id"], "frames": count, "problems": problems}
    if native.size != (gates["native_size"],) * 2:
        problems.append(f"native size {native.size}")
    if not gates["frames_min"] <= count <= gates["frames_max"]:
        problems.append(f"{count} frames outside {gates['frames_min']}..{gates['frames_max']}")
    boxes = [f.getchannel("A").point(OPAQUE).getbbox() for f in frames]
    if None in boxes:
        problems.append("empty frame")
    if problems:
        return result
    source = Image.open(io.BytesIO((stages.COLORS / loop["source_file"]).read_bytes())).convert("RGBA")
    sbox = source.getchannel("A").getbbox()
    ub = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    dx = round((sbox[0] + sbox[2]) / 2 - (ub[0] + ub[2]) / 2)
    dy = round((sbox[1] + sbox[3]) / 2 - (ub[1] + ub[3]) / 2)
    margin = min(ub[0] + dx, ub[1] + dy, SIZE - ub[2] - dx, SIZE - ub[3] - dy)
    result["shift"] = [dx, dy]
    result["margin_px"] = margin
    if max(abs(dx), abs(dy)) > gates["shift_max_px"]:
        problems.append(f"clip drift {dx},{dy} beyond {gates['shift_max_px']} px")
    if margin < gates["margin_min_px"]:
        problems.append(f"margin {margin} px below {gates['margin_min_px']}")
    if problems:
        return result
    sraw = source.tobytes()
    source_alpha = [a >= 128 for a in sraw[3::4]]
    colours = sorted({tuple(sraw[i : i + 3]) for i in range(0, len(sraw), 4) if sraw[i + 3] >= 128})
    palette = {c: k + 1 for k, c in enumerate(colours)}
    cache, indexed, alphas = {}, [], []
    areas, ious, total_distance, far, opaque = [], [], 0.0, 0, 0
    for frame in frames:
        canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        canvas.paste(frame, (dx, dy))
        raw = canvas.tobytes()
        index, alpha = bytearray(SIZE * SIZE), bytearray(SIZE * SIZE)
        inter = union = 0
        for p in range(SIZE * SIZE):
            solid = raw[4 * p + 3] >= 128
            inside = source_alpha[p]
            inter += solid and inside
            union += solid or inside
            if not solid:
                continue
            alpha[p] = 255
            rgb = tuple(raw[4 * p : 4 * p + 3])
            if rgb not in cache:
                best = min(colours, key=lambda c: sum((a - b) ** 2 for a, b in zip(rgb, c)))
                cache[rgb] = (palette[best], sum((a - b) ** 2 for a, b in zip(rgb, best)) ** 0.5)
            slot, distance = cache[rgb]
            index[p] = slot
            opaque += 1
            total_distance += distance
            far += distance > gates["far_colour_distance"]
        areas.append(sum(1 for a in alpha if a) / sum(source_alpha))
        ious.append(inter / union)
        indexed.append(bytes(index))
        alphas.append(bytes(alpha))
    metrics = {
        "area_ratio": [round(min(areas), 3), round(max(areas), 3)],
        "min_iou": round(min(ious), 3),
        "mean_colour_distance": round(total_distance / opaque, 2),
        "far_colour_fraction": round(far / opaque, 4),
        "unique_frames": len(set(indexed)),
    }
    lo, hi = gates["area_ratio"]
    if min(areas) < lo or max(areas) > hi:
        problems.append(f"area ratio {metrics['area_ratio']} outside {gates['area_ratio']}")
    if min(ious) < gates["iou_min"]:
        problems.append(f"silhouette IoU {metrics['min_iou']} below {gates['iou_min']}")
    if metrics["mean_colour_distance"] > gates["mean_colour_distance_max"]:
        problems.append(f"mean colour distance {metrics['mean_colour_distance']} above {gates['mean_colour_distance_max']}")
    if metrics["far_colour_fraction"] > gates["far_colour_fraction_max"]:
        problems.append(f"{metrics['far_colour_fraction']} of pixels far from the source palette")
    if metrics["unique_frames"] < gates["unique_frames_min"]:
        problems.append("not a moving animation")
    # Real native poses only: forward, then back without repeating the end frames.
    order = list(range(count)) + list(range(count - 2, 0, -1))
    result.update(
        colours=colours,
        indexed=indexed,
        durations=durations,
        order=order,
        metrics=metrics,
        alpha_sha256=stages.sha256_bytes(b"".join(alphas[k] for k in order)),
    )
    return result


def depth_palette(loop, mapping, colours):
    """Exact source-to-depth colour map read from the pinned still pair."""
    source = Image.open(io.BytesIO((stages.COLORS / loop["source_file"]).read_bytes())).convert("RGBA").tobytes()
    path = stages.COLORS / mapping["variant_file"]
    if stages.sha256_file(path) != mapping["variant_sha256"]:
        raise RuntimeError(f"Variant still changed: {mapping['variant_file']}")
    variant = Image.open(io.BytesIO(path.read_bytes())).convert("RGBA").tobytes()
    if source[3::4] != variant[3::4]:
        raise RuntimeError(f"{mapping['id']}: still alpha differs from its source")
    pairs = {}
    for i in range(0, len(source), 4):
        if source[i + 3] >= 128 and pairs.setdefault(tuple(source[i : i + 3]), tuple(variant[i : i + 3])) != tuple(variant[i : i + 3]):
            raise RuntimeError(f"{mapping['id']}: one source colour maps to two depth colours")
    if set(pairs) != set(colours) or len(set(pairs.values())) != len(pairs):
        raise RuntimeError(f"{mapping['id']}: colour map is not one to one")
    return [pairs[c] for c in colours]


def rgba_frames(analysis, palette):
    table = [bytes(4)] + [bytes(c) + b"\xff" for c in palette]
    return [Image.frombytes("RGBA", (SIZE, SIZE), b"".join(table[v] for v in analysis["indexed"][k])) for k in analysis["order"]]


def indexed_frames(analysis, palette, scale=1):
    flat = [0, 0, 0] + [v for c in palette for v in c]
    frames = []
    for k in analysis["order"]:
        frame = Image.frombytes("P", (SIZE, SIZE), analysis["indexed"][k])
        frame.putpalette(flat + [0] * (768 - len(flat)))
        if scale > 1:
            frame = frame.resize((SIZE * scale, SIZE * scale), Image.Resampling.NEAREST)
        frame.info["transparency"] = 0
        frames.append(frame)
    return frames


def encode_gif(frames, durations, expected):
    buffer = io.BytesIO()
    frames[0].save(buffer, format="GIF", save_all=True, append_images=frames[1:], duration=durations, loop=0, transparency=0, disposal=2, optimize=False)
    data = buffer.getvalue()
    gif = Image.open(io.BytesIO(data))
    if gif.n_frames != len(expected):
        raise RuntimeError("GIF encoder merged frames; not publishing")
    for k, frame in enumerate(ImageSequence.Iterator(gif)):
        if frame.convert("RGBA").tobytes() != expected[k].tobytes():
            raise RuntimeError("GIF round trip changed pixels")
    return data


def png_bytes(image):
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def sheet(frames):
    strip = Image.new("RGBA", (frames[0].width * len(frames), frames[0].height))
    for i, frame in enumerate(frames):
        strip.paste(frame, (i * frame.width, 0))
    return strip


def review_sheets(built):
    """Contact sheets as review aids only."""
    files = {}
    cell = SIZE + 24
    contact = Image.new("RGB", (cell * len(stages.DEPTHS), 20 + cell * len(stages.FORMS)), BACKDROP)
    draw = ImageDraw.Draw(contact)
    draw.text((4, 4), "REVIEW AID - frame 0 of every candidate loop - not an asset", fill="white")
    for row, form in enumerate(stages.FORMS):
        for col, depth in enumerate(stages.DEPTHS):
            frame = built[f"{form}-{depth}"]["rgba"][0]
            contact.paste(frame, (col * cell + 12, 20 + row * cell), frame)
            draw.text((col * cell + 12, 20 + row * cell + SIZE + 4), f"{form} {depth}", fill="white")
    files["review/contact-sheet-frame0.png"] = png_bytes(contact)
    for form in stages.FORMS:
        rows = [(s, built[f"{form}-{stages.STAGE_DEPTHS[s][0]}"]["rgba"]) for s in stages.STAGES]
        width = max(len(r[1]) for r in rows) * SIZE
        image = Image.new("RGB", (width, 16 + len(rows) * (SIZE + 16)), BACKDROP)
        draw = ImageDraw.Draw(image)
        draw.text((4, 2), f"REVIEW AID - {form} playback frames - not an asset", fill="white")
        for r, (stage, frames) in enumerate(rows):
            y = 16 + r * (SIZE + 16)
            draw.text((4, y), stage, fill="white")
            for i, frame in enumerate(frames):
                image.paste(frame, (i * SIZE, y + 14), frame)
        files[f"review/{form}-stage-frames.png"] = png_bytes(image)
    return files


def export():
    plan, plan_sha, masters_sha = readiness()
    gates = plan["gates"]
    analyses = {l["id"]: analyse(l, gates) for l in plan["loops"]}
    failed = {i: a["problems"] for i, a in analyses.items() if a["problems"]}
    if failed:
        raise RuntimeError("Native masters failed gates (masters preserved, nothing exported): " + json.dumps(failed))
    loops = {l["id"]: l for l in plan["loops"]}
    masters = {m["id"]: m for m in stages.jload(stages.OUT / "manifest.json")["masters"]}
    files, built, entries = {}, {}, []
    for mapping in plan["variants"]:
        loop, analysis = loops[mapping["loop"]], analyses[mapping["loop"]]
        palette = depth_palette(loop, mapping, analysis["colours"])
        durations = [analysis["durations"][k] for k in analysis["order"]]
        expected = rgba_frames(analysis, palette)
        expected256 = [f.resize((SIZE * 2, SIZE * 2), Image.Resampling.NEAREST) for f in expected]
        name = mapping["id"]
        outputs = {
            f"{name}-128.gif": encode_gif(indexed_frames(analysis, palette), durations, expected),
            f"{name}-256.gif": encode_gif(indexed_frames(analysis, palette, 2), durations, expected256),
            f"{name}-spritesheet-128.png": png_bytes(sheet(expected)),
            f"{name}-spritesheet-256.png": png_bytes(sheet(expected256)),
        }
        files.update(outputs)
        built[name] = {"rgba": expected}
        entries.append(
            {
                "id": name,
                "form": mapping["form"],
                "depth": mapping["depth"],
                "stage": loop["stage"],
                "loop": loop["id"],
                "native_file": loop["output_file"],
                "native_sha256": masters[loop["id"]]["sha256"],
                "still_file": mapping["variant_file"],
                "still_sha256": mapping["variant_sha256"],
                "palette": ["#%02X%02X%02X" % tuple(c) for c in palette],
                "frames": len(expected),
                "loop_frame_order": analysis["order"],
                "durations_ms": durations,
                "clip_shift": analysis["shift"],
                "alpha_sha256": analysis["alpha_sha256"],
                "files": {n: {"sha256": stages.sha256_bytes(d), "bytes": len(d)} for n, d in outputs.items()},
            }
        )
    if len(entries) != 30:
        raise RuntimeError("Expected 30 variants")
    review = review_sheets(built)
    manifest = {
        "schema": "evolution-stage-animations-v1",
        "status": "candidate",
        "qvl": "pending-export-review",
        "plan_sha256": plan_sha,
        "masters_manifest_sha256": masters_sha,
        "depth_manifest_sha256": plan["depth_manifest"]["sha256"],
        "counts": {"masters": 18, "variants": 30, "loop_files": 120, "review_aids": len(review)},
        "tool_versions": {"python": sys.version.split()[0], "pillow": PIL.__version__},
        "method": "Native provider poses only, one clip-wide integer shift per master, nearest source colour mapped one to one to the depth palette, forward and back playback of native poses, nearest-neighbour 2x. No interpolation, synthesis or reframing per frame.",
        "loops": [
            {"id": i, "frames": a["frames"], "clip_shift": a["shift"], "margin_px": a["margin_px"], "metrics": a["metrics"], "alpha_sha256": a["alpha_sha256"]}
            for i, a in analyses.items()
        ],
        "variants": entries,
        "review_aids": {n: stages.sha256_bytes(d) for n, d in review.items()},
        "notes": "Candidates awaiting export review. Review sheets are aids, not assets. The depth manifest and grid are unchanged.",
    }
    folder = stages.OUT / "exports"
    try:
        folder.mkdir(parents=True)
    except FileExistsError:
        raise RuntimeError("exports/ exists; not overwriting") from None
    for name, data in {**files, **review}.items():
        stages.write_new(folder / name, data)
    stages.write_json_new(folder / "export-manifest.json", manifest)
    print(f"OFFLINE EXPORT: {len(entries)} candidate loops, {len(files)} loop files, {len(review)} review aids", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report readiness; writes nothing")
    mode.add_argument("--export", action="store_true", help="write the 30 candidate loops")
    args = parser.parse_args(argv)
    try:
        if args.check:
            readiness()
            print("READY: 18 verified masters and passing QVL records")
        else:
            export()
    except RuntimeError as error:
        print(f"{'NOT READY' if isinstance(error, NotReady) else 'STOPPED'}: {error}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
