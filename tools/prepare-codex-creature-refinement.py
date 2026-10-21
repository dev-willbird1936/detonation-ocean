"""Verify native candidates, export game assets, and prepare a reviewable selection table."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import zipfile

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/codex-creature-refinement"
OLD = ROOT / "ocean-style-prototypes/retrodiffusion-family-depth-study"
FAMILIES = [("anglerfish","Anglerfish","Deception & impersonation"),("viperfish","Viperfish","Intrusion & weaknesses"),("siphonophore","Siphonophore","Coordinated & automated abuse"),("isopod-host","Isopod host fish","Trusted-source compromise"),("cookiecutter","Cookiecutter shark","Theft & surveillance"),("octopus","Octopus / kraken","Extortion & destruction")]
DEPTHS = ["sunlight","twilight","midnight","abyss","trench"]
KEEPERS = {"anglerfish-twilight","viperfish-midnight","isopod-host-sunlight","octopus-sunlight"}
spec = importlib.util.spec_from_file_location("sprite_export", Path(__file__).with_name("export-codex-game-sprite.py"))
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_preserved(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        shutil.copyfile(source, target)
    if sha(target) != sha(source):
        raise RuntimeError(f"Existing comparison file differs: {target}")


def prepare():
    report = json.loads((OUT/"remaining/generation-report.json").read_text(encoding="utf-8"))
    candidates = {f"{a['family']}-{a['depth']}":a for a in report["successfulCandidates"]}
    all_ids = {f"{f[0]}-{d}" for f in FAMILIES for d in DEPTHS}
    expected = all_ids - KEEPERS - {"siphonophore-sunlight"}
    if len(candidates) != 25 or set(candidates) != expected:
        raise RuntimeError("Unexpected generation coverage")
    reviews = json.loads((OUT/"review-scores.json").read_text(encoding="utf-8")) if (OUT/"review-scores.json").exists() else {}
    overrides = json.loads((OUT/"source-overrides.json").read_text(encoding="utf-8")) if (OUT/"source-overrides.json").exists() else {}
    if not set(overrides).issubset(all_ids):
        raise RuntimeError("Unknown override cell")
    selections = []
    for family,title,group in FAMILIES:
        for depth in DEPTHS:
            key = f"{family}-{depth}"
            before = OLD / f"images/{key}-01.png"
            before_copy = OUT / f"before/{key}.png"
            copy_preserved(before, before_copy)
            provider = "Codex"
            if key in overrides:
                item = overrides[key]
                source = OUT / item["file"]
                native_source = Path(item["native_source"])
                if sha(source) != item["sha256"].lower() or sha(native_source) != sha(source):
                    raise RuntimeError("Override native hash mismatch")
                prompt = item["prompt"]
            elif key in KEEPERS:
                source = before_copy
                provider = "RetroDiffusion · retained keeper"
                native_source = before
                prompt = "Previously inspected original retained; game export re-reviewed for palette/frame coherence."
            elif key == "siphonophore-sunlight":
                item = json.loads((OUT/"pilot/generation-report.json").read_text(encoding="utf-8"))
                source = OUT / "pilot/siphonophore-sunlight-candidate.png"
                native_source = Path(item["nativeSourcePath"])
                if sha(source) != item["sha256"].lower() or sha(native_source) != sha(source):
                    raise RuntimeError("Pilot native hash mismatch")
                prompt = item["exactPrompt"]
            else:
                item = candidates[key]
                source = OUT / "remaining" / item["file"]
                native_source = Path(item["native_source"])
                if sha(source) != item["copySha256"].lower() or sha(native_source) != sha(source):
                    raise RuntimeError(f"Native hash mismatch: {key}")
                prompt = item["exactPrompt"]
            image = Image.open(source)
            image.verify()
            image = Image.open(source).convert("RGBA")
            if image.getchannel("A").getextrema()[0] != 0:
                raise RuntimeError(f"No native alpha transparency: {key}")
            exported = exporter.export_sprite(source, OUT / "exports", key)
            review = reviews.get(key, {"status":"pending","reason":"Game export not yet independently rated by parent"})
            accepted = review.get("status") == "keep" and min(review.get("overall",0),review.get("anatomy",0),review.get("pixel_style",0)) > 8
            selections.append({"id":key,"family":family,"creature":title,"group":group,"depth":depth,"provider":provider,"native_file":source.relative_to(OUT).as_posix(),"before_file":before_copy.relative_to(OUT).as_posix(),"before_sha256":sha(before_copy),"display_file":Path(exported["display_file"]).relative_to(OUT).as_posix(),"logical_file":Path(exported["logical_file"]).relative_to(OUT).as_posix(),"native_dimensions":list(image.size),"native_sha256":sha(source),"native_source":str(native_source),"prompt":prompt,"export":exported,"review":review,"accepted":accepted})
    selected = {"total":30,"approved":sum(s["accepted"] for s in selections),"native_codex_cells":sum(s["provider"]=="Codex" for s in selections),"retained_original_cells":sum(s["provider"]!="Codex" for s in selections),"native_prices":"Not reported by native Codex image generation; existing ChatGPT account usage applies. No new purchases or RetroDiffusion API requests.","generation_report_errors":report.get("errors",[]),"selections":selections}
    (OUT/"selection.json").write_text(json.dumps(selected,indent=2),encoding="utf-8")
    row_folder = OUT / "review-rows"
    row_folder.mkdir(exist_ok=True)
    sheet = Image.new("RGB",(1500,1980),"#0b1825")
    for row,(family,title,_) in enumerate(FAMILIES):
        row_image = Image.new("RGB",(1500,330),"#0b1825")
        draw = ImageDraw.Draw(row_image)
        for col,depth in enumerate(DEPTHS):
            item = next(s for s in selections if s["id"]==f"{family}-{depth}")
            x = col*300
            draw.text((x+12,5),f"{title} / {depth}",fill="white")
            draw.rectangle((x+8,28,x+291,288),fill="#254151")
            im = Image.open(OUT/item["display_file"]).convert("RGBA")
            row_image.paste(im,(x+22,30),im)
            note = f"{item['provider']} / " + (str(item["review"].get("overall","pending")))
            draw.text((x+12,302),note,fill="#c0dce8")
        row_image.save(row_folder/f"{family}.png")
        sheet.paste(row_image,(0,row*330))
    sheet.save(OUT/"contact-sheet.png")
    with zipfile.ZipFile(OUT/"all-selected.zip","w",zipfile.ZIP_DEFLATED) as archive:
        archived = set()
        for item in selections:
            for key in ("native_file","display_file","logical_file","before_file"):
                if item[key] not in archived:
                    archive.write(OUT/item[key],item[key])
                    archived.add(item[key])
        for filename in ("selection.json","review-scores.json","initial-review.json","contact-sheet.png","README.md","index.html","gallery.js","start-viewer.bat","browser-verification.json","pilot/generation-report.json","remaining/generation-report.json","matched/generation-report.json","source-overrides.json"):
            if (OUT/filename).exists():
                archive.write(OUT/filename,filename)
    print(json.dumps({"candidate_exports":len(selections),"approved":selected["approved"],"codex":selected["native_codex_cells"],"retained":selected["retained_original_cells"],"unique_native_hashes":len({s['native_sha256'] for s in selections}),"colours_max":max(s["export"]["visible_colours"] for s in selections),"alpha_components":[(s["id"],s["export"]["remaining_alpha_component_sizes"]) for s in selections if len(s["export"]["remaining_alpha_component_sizes"])!=1]},indent=2))


if __name__ == "__main__":
    prepare()
