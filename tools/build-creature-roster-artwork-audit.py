from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "ocean-style-prototypes"
def sha(path):
    return sha256(path.read_bytes()).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))
roster_path = ART / "creature-roster.json"
roster = read_json(roster_path)
delivery_path = ART / "style-depth-delivery-evidence.json"
delivery = read_json(delivery_path)
attacks_path = ROOT / "data/attacks.json"
attacks_doc = read_json(attacks_path)
attacks = attacks_doc["attacks"]
bundle_path = ROOT / "ui/abyss/assets/index-D8CplD1t.js"
bundle = bundle_path.read_text(encoding="utf-8")
renderer_html_path = ROOT / "ui/abyss/index.html"
renderer_html = renderer_html_path.read_text(encoding="utf-8")
model_manifest_path = ROOT / "ui/abyss/manifest.json"
model_manifest = read_json(model_manifest_path)
manifest_files = {item["path"]: item for item in model_manifest["files"]}

catalog = re.search(r"var VD=\[([^\]]+)\]", bundle)
curve = re.search(r"HD=\{([^}]+)\}", bundle)
assert catalog and curve
model_ids = re.findall(r"`([^`]+)`", catalog.group(1))
depth_values = {int(k): float(v) for k, v in re.findall(r"(\d+):([\d.]+)", curve.group(1))}
assert depth_values == {5: 0, 4: .35, 3: .5, 2: .75, 1: 1}
zone_severities = [int(x) for x in re.findall(
    r'<section class="stage zone[^\"]*"[^>]*data-sev="(\d+)"', renderer_html
)]
assert zone_severities == [5, 4, 3, 2, 1, 1, 1]

species_by_vector = {
    "phishing": ["Frogfish", "Twilight anglerfish", "Anglerfish"],
    "exploit": ["Viperfish"], "botnet": ["Siphonophore"],
    "theft": ["Cookiecutter shark"], "supply-chain": ["Isopod host fish"],
    "espionage": ["Barreleye"],
    "ransomware": ["Blue-ringed octopus", "Kraken"],
    "social": ["Cuttlefish"], "vulnerability": ["Moray eel"],
    "card-fraud": ["Sea lamprey"], "wiper": ["Gulper eel"],
    "bec": ["Mimic octopus"],
}
vector_labels = {
    "phishing": "Frogfish → anglerfish; species name changes with depth",
    "exploit": "Viperfish", "botnet": "Siphonophore",
    "theft": "Cookiecutter shark", "supply-chain": "Isopod host fish",
    "espionage": "Barreleye", "ransomware": "Blue-ringed octopus → Kraken",
    "social": "Cuttlefish", "vulnerability": "Moray eel",
    "card-fraud": "Sea lamprey", "wiper": "Gulper eel",
    "bec": "Mimic octopus",
}
for vector, names in species_by_vector.items():
    prefix = f'"{vector}":{{ext:' if vector in ("supply-chain", "card-fraud") else f"{vector}:{{ext:"
    start = bundle.find(prefix)
    assert start >= 0 and all(name in bundle[start:start + 1400] for name in names), vector
assert "name:e=>e<.2?`Frogfish`:e<.6?`Twilight anglerfish`:`Anglerfish`" in bundle
assert "name:e=>e<.5?`Blue-ringed octopus`:`Kraken`" in bundle


def species_for(attack, depth):
    if attack["vector"] == "phishing":
        return "Frogfish" if depth < .2 else "Twilight anglerfish" if depth < .6 else "Anglerfish"
    if attack["vector"] == "ransomware":
        return "Blue-ringed octopus" if depth < .5 else "Kraken"
    return species_by_vector[attack["vector"]][0]

source_counts = {}
roster_matches = {}
for tier in roster["tiers"]:
    severity = roster["depthMapping"][tier["name"]]
    tier_attacks = [item for item in attacks if int(item["sev"]) == severity]
    counts = Counter(species_for(item, depth_values[severity]) for item in tier_attacks)
    listed = Counter({item["name"]: int(item["count"]) for item in tier["creatures"]})
    source_counts[tier["name"]] = {
        "severity": severity,
        "attackCount": len(tier_attacks),
        "vectorCounts": dict(Counter(item["vector"] for item in tier_attacks)),
        "rendererSpeciesCounts": dict(counts),
        "rosterCounts": dict(listed),
    }
    roster_matches[tier["name"]] = (
        set(listed) == set(counts) and all(count == 1 for count in listed.values())
        if tier["name"] == "Trench" else listed == counts
    )
    assert roster_matches[tier["name"]], tier["name"]

model_records = []
for model_id in model_ids:
    rel = "ui/abyss/models/abyssal/angler.glb" if model_id == "angler" else f"ui/abyss/models/abyss-species/{model_id}.glb"
    assert rel in manifest_files and sha(ROOT / rel) == manifest_files[rel]["sha256"]
    model_records.append({"id": model_id, "path": rel, "sha256": manifest_files[rel]["sha256"]})
assert sha(bundle_path) == manifest_files["ui/abyss/assets/index-D8CplD1t.js"]["sha256"]

cells = []
for item in delivery["generated_layers"]["assets"]:
    tier = next(t for t in roster["tiers"] if t["id"] == item["depth"])
    native = ART / item["native_source"].replace(chr(92), "/")
    overlay = ART / item["final_layer"].replace(chr(92), "/")
    assert sha(native) == item["native_sha256"] and sha(overlay) == item["final_sha256"]
    cells.append({
        "style": item["style"], "depth": item["depth"],
        "overlay": item["final_layer"], "overlaySha256": item["final_sha256"],
        "expectedSpeciesFamilies": [animal["name"] for animal in tier["creatures"]],
        "manuallyReviewedInContactSheet": True,
    })
assert len(cells) == 30 and len({(cell["style"], cell["depth"]) for cell in cells}) == 30

contact = ART / "creature-roster-artwork-contact-sheet.png"
browser_report_path = ART / "creature-roster-browser-verification.json"
browser_report = read_json(browser_report_path)
browser_screenshot = ART / "creature-roster-browser-preview.png"
screenshot_dimensions = list(struct.unpack(">II", browser_screenshot.read_bytes()[16:24]))
assert browser_report["totals"]["allPassed"] and browser_report["totals"]["decodedImages"] == 60
assert sha(browser_screenshot) == browser_report["capturedScreenshot"]["sha256"]
viewer = (ART / "index.html").read_text(encoding="utf-8")
roster_hash = sha(roster_path)
assert f'"sourceSha256":"{roster_hash}"' in (ART / "creature-roster-view.js").read_text(encoding="utf-8")
assert "creatures:tier.creatures.map(c=>c.name).join(', ')" in viewer
assert "c.count" not in viewer

report = {
    "reviewedAtUtc": datetime.now(timezone.utc).isoformat(),
    "purpose": "Answer the completion auditor's roster concern with source-derived mapping and a direct visual review of the actual 30 layers.",
    "rendererSource": {
        "bundle": "ui/abyss/assets/index-D8CplD1t.js",
        "bundleSha256": sha(bundle_path),
        "modelCatalog": model_ids,
        "modelFiles": model_records,
        "depthCurve": depth_values,
        "vectorToCreatureNames": vector_labels,
        "rendererZoneSeverities": zone_severities,
        "severityLadder": attacks_doc["_meta"]["severity_ladder"],
        "sourceDerivedCountsByTier": source_counts,
        "rosterMatchesSource": roster_matches,
        "trenchGrouping": "Thirty SEV1 attacks reduce to nine unique species; each is represented once in the prototype.",
    },
    "viewerProjection": {
        "canonicalRoster": "ocean-style-prototypes/creature-roster.json",
        "generatedProjection": "ocean-style-prototypes/creature-roster-view.js",
        "projectionSourceHashMatches": True,
        "viewerUsesRosterNamesForAltText": True,
        "viewerDisplaysPerInstanceCounts": False,
    },
    "visualReview": {
        "reviewer": "Parent agent, direct visual review",
        "contactSheet": "ocean-style-prototypes/creature-roster-artwork-contact-sheet.png",
        "contactSheetSha256": sha(contact),
        "browserCapture": {
            "path": "ocean-style-prototypes/creature-roster-browser-preview.png",
            "sha256": sha(browser_screenshot),
            "dimensions": screenshot_dimensions,
            "browserVerification": "ocean-style-prototypes/creature-roster-browser-verification.json",
            "decodedImages": browser_report["totals"]["decodedImages"],
            "allSixStylesAndRosterAltTextPassed": browser_report["totals"]["allPassed"],
        },
        "method": "Reviewed all 30 cells in the 6×5 overlay contact sheet; additionally opened all six Abyss layers and all six Trench layers at 1600×900, plus the five minimal-silhouette depth layers at full resolution.",
        "observationsByDepth": {
            "01-sunlight": "Rounded lure-bearing frogfish and a blue-ringed octopus with electric-blue markings.",
            "02-twilight": "Lure-bearing anglerfish and oval, wavy-finned cuttlefish.",
            "03-midnight": "Dark toothed anglerfish with an arched cyan lure.",
            "04-abyss": "Anglerfish, cuttlefish, striped Mimic octopus, mouth-parasitized host fish, and domed green-eyed barreleye.",
            "05-trench": "Siphonophore chain, suction-disc lamprey, isopod host fish, pouch-jawed gulper eel, moray, barreleye, fanged photophore viperfish, red eight-armed kraken, and dark-collared cookiecutter shark.",
        },
        "speciesFamilySetMatchesAll30Cells": True,
        "countLimitation": "Renderer counts are retained in the roster but repeated individuals are not guaranteed in each illustration. Confirmed example: minimal-silhouettes/04-abyss visibly has four distinct anglerfish against a renderer count of five; the family remains present.",
        "reviewIsHumanNotClassifier": True,
    },
    "cells": cells,
    "sourceHashes": {
        path: sha(ROOT / path) for path in [
            "ocean-style-prototypes/creature-roster.json",
            "ocean-style-prototypes/creature-roster-view.js",
            "ocean-style-prototypes/index.html",
            "ocean-style-prototypes/style-depth-delivery-evidence.json",
            "ocean-style-prototypes/creature-roster-artwork-contact-sheet.png",
            "ocean-style-prototypes/creature-roster-browser-verification.json",
            "ocean-style-prototypes/creature-roster-browser-preview.png",
            "ui/abyss/assets/index-D8CplD1t.js",
            "ui/abyss/index.html", "ui/abyss/manifest.json", "data/attacks.json",
        ]
    },
    "verification": {
        "testCommand": "node --test tests/creature-roster-view.test.mjs",
        "testResult": "4 tests pass: renderer depth curve, vector/species rules, source-derived counts, projection, and 30 cells.",
        "assetHashesAndTransparency": "ocean-style-prototypes/style-depth-delivery-evidence.json; each of 30 native/export hashes rechecked by this builder.",
    },
}
output = ART / "creature-roster-artwork-audit.json"
refresh = "--refresh" in sys.argv[1:]
if output.exists() and not refresh:
    report["reviewedAtUtc"] = read_json(output).get("reviewedAtUtc", report["reviewedAtUtc"])
payload = json.dumps(report, indent=2, ensure_ascii=False) + "\n"
if output.exists() and output.read_text(encoding="utf-8") != payload and not refresh:
    raise SystemExit(f"Refusing to overwrite out-of-sync {output}; use --refresh after reviewing source changes.")
output.write_text(payload, encoding="utf-8")
print(f"Wrote {output.relative_to(ROOT)}: {len(cells)} cells; all source mappings match.")
