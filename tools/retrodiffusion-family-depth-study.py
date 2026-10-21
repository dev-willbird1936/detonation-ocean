"""Thirty original RD Plus Retro sprites; independent approved $1.80 batch cap."""
import importlib.util
import json
from pathlib import Path
import sys
import zipfile

from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("rd_study", Path(__file__).with_name("retrodiffusion-2d-ocean-study.py"))
rd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rd)
ROOT = rd.ROOT
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-family-depth-study"
rd.OUT = OUT
rd.LIMIT = 1_800_000
STYLE = "rd_plus__retro"
FAMILIES = [
    ("anglerfish", "Anglerfish", "Deception & impersonation", "A squat anglerfish facing right, broad head, large toothed mouth, small eye, curved forehead stalk ending in a round luminous lure, distinct fins and fan tail."),
    ("viperfish", "Viperfish", "Intrusion & weaknesses", "A slender elongated viperfish facing right, narrow tapering body, very large needle teeth, clear eye, small fins and forked tail; NOT a squat anglerfish and no forehead lure."),
    ("siphonophore", "Siphonophore", "Coordinated & automated abuse", "One complete siphonophore colony, a gently curved diagonal chain of repeated translucent bell-shaped swimming segments, a visible float, several long delicate trailing feeding filaments; NOT a jellyfish umbrella or a fish."),
    ("isopod-host", "Isopod host fish", "Trusted-source compromise", "One small host fish facing right, with a clearly visible oval segmented parasitic isopod nestled in the open mouth; show BOTH the whole fish and the distinct armored parasite as ONE composition, not a second loose animal."),
    ("cookiecutter", "Cookiecutter shark", "Theft & surveillance", "A compact cookiecutter shark facing right, short cigar-shaped body, blunt rounded snout, large eye, small dorsal fins, strong tail and small circular suction mouth with visible teeth; recognizable SHARK, not an eel or anglerfish."),
    ("octopus", "Octopus / kraken", "Extortion & destruction", "One octopus in three-quarter view, rounded mantle, two visible eyes, exactly eight clearly separated curled arms with suckers, no fish tail; readable full-body silhouette."),
]
DEPTHS = [
    ("sunlight", "Sunlight", "Clean", "Turquoise and sea-green body, warm cream underside, golden highlights from above. Fully illuminated body, clear natural markings, bright fins or arm tips, gentle crisp shading, only a small warm luminous accent."),
    ("twilight", "Twilight", "Risky or inconclusive", "Cobalt-blue body, muted teal midtones, lavender shadows. Shadowed underside with two small separated cyan luminous bands or clusters. Preserve a clear outline and all anatomical identifying features."),
    ("midnight", "Midnight", "Steals", "Indigo and violet body, saturated cyan highlights. Strong light-dark contrast, a clearly visible broken luminous stripe or dotted chain following the body and appendages. Visible body, not just glowing eyes."),
    ("abyss", "Abyss", "Takes control", "Deep navy body, cold teal shadows, pale-blue thin rim lighting. Sparse sharply defined luminous spots on the fins, arms or colony segments. Restrained highlights but the ENTIRE silhouette remains readable."),
    ("trench", "Trench", "Destroys", "Near-black blue body, icy-white focal lights and restrained violet accents. Minimal interior illumination, pale structural details and crisp violet-blue contour highlights so the ENTIRE animal remains clearly visible on a dark ocean background. No extra heads or monster mutations."),
]
COMMON = "Full-body isolated marine creature game sprite, centered inside a 256 by 256 canvas with generous empty margins, consistent scale and anatomy. Classic PC98 / 16-bit RETRO PIXEL ART, crisp square pixel clusters and stepped contours, limited palette, no smooth gradients, no 3D render, no watercolor. Transparent background, no scenery, no text, no labels, no icons, no border, no sprite sheet. Depth is an illustrative lighting treatment, NOT a literal habitat claim or a power-level evolution."


def jobs():
    return [
        {"id": f"{family[0]}-{depth[0]}", "subject": family[0], "group": depth[0], "title": f"{family[1]} / {depth[1]}", "family": family[2], "depth": depth[0], "type": "Retro pixel sprite", "body": {"prompt": f"{family[3]} {depth[3]} {COMMON}", "prompt_style": STYLE, "width": 256, "height": 256, "num_images": 1, "seed": 416 + i * 101, "remove_bg": True, "bypass_prompt_expansion": True}}
        for i, family in enumerate(FAMILIES) for depth in DEPTHS
    ]


def previous():
    return sum(sum(json.loads((ROOT / f"ocean-style-prototypes/{folder}/ledger.json").read_text())["reservations"].values()) for folder in ("retrodiffusion-2d-study", "retrodiffusion-mini-study"))


def plan():
    if (OUT / "ledger.json").exists():
        raise RuntimeError("Existing admissions: do not re-plan a paid batch")
    estimates = []
    for job in jobs():
        cost = rd.money(rd.request("/inferences", {**job["body"], "check_cost": True})["balance_cost"])
        if cost < 0:
            raise RuntimeError("Invalid quote")
        estimates.append({"id": job["id"], "cost_microdollars": cost})
        print(f"QUOTE {job['id']}: ${cost / 1e6:.2f}", flush=True)
    total = sum(j["cost_microdollars"] for j in estimates)
    if total > rd.LIMIT:
        raise RuntimeError("Plan exceeds approved $1.80; no paid requests issued")
    rd.save(OUT / "plan.json", {"budget_microdollars": rd.LIMIT, "previous_microdollars": previous(), "estimated_microdollars": total, "expected_outputs": 30, "jobs": estimates})
    print(f"FREE PLAN: 30 images, ${total / 1e6:.2f}; new batch cap $1.80", flush=True)


def run():
    planned = json.loads((OUT / "plan.json").read_text())
    batch = jobs()
    estimates = {j["id"]: j["cost_microdollars"] for j in planned["jobs"]}
    if planned["budget_microdollars"] != rd.LIMIT or set(estimates) != {j["id"] for j in batch} or any(c < 0 for c in estimates.values()) or sum(estimates.values()) > rd.LIMIT:
        raise RuntimeError("Invalid paid plan; no admission")
    ledger_path = OUT / "ledger.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {"reservations": {}, "actual_charges": {}}
    manifest = {"budget": 1.8, "previous_cost": planned["previous_microdollars"] / 1e6, "expected_outputs": 30, "style": STYLE, "families": [list(f[:3]) for f in FAMILIES], "depths": [list(d[:3]) for d in DEPTHS], "outputs": [], "failures": [], "notes": "Original text-to-image outputs; matched family prompts and seeds. Retro preset does not support reference_images; identical anatomy is not guaranteed. No paid retries or animations."}
    try:
        for job in batch:
            if previous() != planned["previous_microdollars"]:
                raise RuntimeError("Prior batch ledger changed; stopping admissions")
            accepted = rd.paid(job, ledger, estimates)
            task = rd.wait(job, accepted)
            if task["status"] == "failed":
                manifest["failures"].append({"job_id": job["id"], "error": task.get("error")})
                print(f"FAILED {job['id']}; no paid retry", flush=True)
            else:
                result = task["result"]
                cost = rd.money(result["balance_cost"])
                if cost < 0 or cost > ledger["reservations"][job["id"]]:
                    raise RuntimeError("Provider charge exceeded checked quote; stopping")
                ledger["actual_charges"][job["id"]] = cost
                rd.save(ledger_path, ledger)
                entries = rd.collect(job, result)
                for entry in entries:
                    if entry["dimensions"] != [256, 256] or entry["frames"] != 1:
                        raise RuntimeError("Unexpected image dimensions or animation")
                    entry.update(family=job["family"], depth=job["depth"])
                manifest["outputs"].extend(entries)
            rd.save(OUT / "manifest.json", manifest)
    finally:
        manifest["reserved_cost"] = sum(ledger["reservations"].values()) / 1e6
        manifest["actual_success_cost"] = sum(ledger["actual_charges"].values()) / 1e6
        manifest["combined_reserved_cost"] = manifest["previous_cost"] + manifest["reserved_cost"]
        rd.save(OUT / "manifest.json", manifest)
        package(manifest)
    print(f"DONE {len(manifest['outputs'])}/30; actual ${manifest['actual_success_cost']:.2f}, reserved ${manifest['reserved_cost']:.2f}", flush=True)


def package(manifest):
    lookup = {(o["subject"], o["depth"]): o for o in manifest["outputs"]}
    sheet = Image.new("RGB", (1220, 1490), "#0c1926")
    draw = ImageDraw.Draw(sheet)
    for col, depth in enumerate(DEPTHS):
        draw.text((col * 244 + 18, 10), depth[1], fill="white")
    for row, family in enumerate(FAMILIES):
        for col, depth in enumerate(DEPTHS):
            x, y = col * 244, 35 + row * 242
            draw.rectangle((x + 8, y + 8, x + 236, y + 212), fill="#2a4251")
            item = lookup.get((family[0], depth[0]))
            if item:
                image = Image.open(OUT / item["file"]).convert("RGBA")
                image.thumbnail((220, 198), Image.Resampling.NEAREST)
                sheet.paste(image, (x + 122 - image.width // 2, y + 110 - image.height // 2), image)
            else:
                draw.text((x + 28, y + 90), "Not generated", fill="#ffb7ae")
            draw.text((x + 12, y + 219), family[1], fill="#b9d9e5")
    sheet.save(OUT / "contact-sheet.png")
    with zipfile.ZipFile(OUT / "all-outputs.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for item in manifest["outputs"]:
            archive.write(OUT / item["file"], item["file"])
        for name in ("manifest.json", "plan.json", "ledger.json", "contact-sheet.png", "README.md", "index.html", "gallery.js", "start-viewer.bat"):
            if (OUT / name).exists():
                archive.write(OUT / name, name)


if __name__ == "__main__":
    if sys.argv[1] == "plan":
        plan()
    elif sys.argv[1] == "run":
        run()
    elif sys.argv[1] == "package":
        package(json.loads((OUT / "manifest.json").read_text()))
    else:
        raise ValueError("Expected plan, run or package")
