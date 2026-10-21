"""Offline palette variants of provider motion; no API calls or local animation synthesis."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import zipfile

from PIL import Image, ImageDraw, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "ocean-style-prototypes/retrodiffusion-creature-animation"
STILLS = ROOT / "ocean-style-prototypes/codex-creature-refinement"
DEPTHS = ["sunlight", "twilight", "midnight", "abyss", "trench"]
TARGETS = [130,95,75,55,38]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def nearest(rgb, colours):
    return min(colours, key=lambda c:sum((a-b)**2 for a,b in zip(rgb,c)))


def export(family):
    manifest = json.loads((OUT / "manifest.json").read_text(encoding="utf-8"))
    master = next(m for m in manifest["masters"] if m["subject"] == family)
    path = OUT / master["file"]
    if sha(path) != master["sha256"]:
        raise RuntimeError("Native animation bytes changed")
    native = Image.open(path)
    frames, durations, boxes = [], [], []
    for frame in ImageSequence.Iterator(native):
        frame = frame.convert("RGBA")
        durations.append(frame.info.get("duration",native.info.get("duration",100)))
        alpha = frame.getchannel("A").point(lambda v:255 if v >= 64 else 0)
        if not alpha.getbbox():
            raise RuntimeError("Empty native animation frame")
        boxes.append(alpha.getbbox())
        frames.append(frame)
    if len(frames) < 2 or len(set(f.tobytes() for f in frames)) < 2:
        raise RuntimeError("Not a moving animation")
    native_count = len(frames)
    # Reuse actual provider poses in reverse; no interpolation or invented frames.
    # The generated eight-pose sequence does not itself return to frame zero.
    loop_order = list(range(native_count))+list(range(native_count-2,0,-1))
    frames = [frames[i] for i in loop_order]
    durations = [durations[i] for i in loop_order]
    bounds = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    if bounds[0] == 0 or bounds[1] == 0 or bounds[2] == native.width or bounds[3] == native.height:
        raise RuntimeError("Native motion touches frame edge: possible source clipping, preserve and review")
    scale = min(96/(bounds[2]-bounds[0]),96/(bounds[3]-bounds[1]))
    size = (max(1,round((bounds[2]-bounds[0])*scale)),max(1,round((bounds[3]-bounds[1])*scale)))
    framed, alphas = [], []
    for frame in frames:
        canvas = Image.new("RGBA",(128,128))
        small = frame.crop(bounds).resize(size, Image.Resampling.NEAREST)
        canvas.alpha_composite(small,((128-size[0])//2,(128-size[1])//2))
        alphas.append(canvas.getchannel("A").point(lambda v:255 if v>=64 else 0))
        framed.append(canvas.convert("RGB"))
    strip = Image.new("RGB",(128*len(framed),128))
    for i,frame in enumerate(framed):
        strip.paste(frame,(128*i,0))
    global_palette = strip.quantize(colors=24, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    indexed = [f.quantize(palette=global_palette,dither=Image.Dither.NONE) for f in framed]
    pal = global_palette.getpalette()
    used = sorted({v for f,a in zip(indexed,alphas) for v,alpha in zip(f.get_flattened_data(),a.get_flattened_data()) if alpha})
    source_colours = {i:tuple(pal[i*3:i*3+3]) for i in used}
    records = json.loads((STILLS / "selection.json").read_text(encoding="utf-8"))["selections"]
    refs = {d:next(s for s in records if s["family"] == family and s["depth"] == d) for d in DEPTHS}
    sun = Image.open(STILLS / refs["sunlight"]["logical_file"]).convert("RGBA")
    sun_pixels = list(sun.get_flattened_data())
    sun_colours = sorted({p[:3] for p in sun_pixels if p[3]})
    entries = []
    folder = OUT / "animations"
    folder.mkdir(exist_ok=True)
    for depth,target in zip(DEPTHS,TARGETS):
        reference = Image.open(STILLS / refs[depth]["logical_file"]).convert("RGBA")
        target_pixels = list(reference.get_flattened_data())
        target_colours = sorted({p[:3] for p in target_pixels if p[3]})
        correspondences = {c:Counter() for c in sun_colours}
        for src,dst in zip(sun_pixels,target_pixels):
            if src[3] and dst[3]:
                correspondences[src[:3]][dst[:3]] += 1
        mapping = {c:counter.most_common(1)[0][0] if counter else nearest(c,target_colours) for c,counter in correspondences.items()}
        colours = {i:source_colours[i] if depth == "sunlight" else mapping[nearest(source_colours[i],sun_colours)] for i in used}
        counts = Counter(v for f,a in zip(indexed,alphas) for v,alpha in zip(f.get_flattened_data(),a.get_flattened_data()) if alpha)
        mean = sum(counts[i]*(.2126*c[0]+.7152*c[1]+.0722*c[2]) for i,c in colours.items())/sum(counts.values())
        gain = target/mean
        colours = {i:tuple(max(0,min(255,round(v*gain))) for v in c) for i,c in colours.items()}
        unique = sorted(set(colours.values()))
        rgb_index = {c:i+1 for i,c in enumerate(unique)}
        final_palette = [0,0,0]+[v for c in unique for v in c]
        final_palette += [0]*(768-len(final_palette))
        outframes = []
        for f,a in zip(indexed,alphas):
            image = Image.new("P",(128,128))
            image.putpalette(final_palette)
            image.putdata([rgb_index[colours[v]] if alpha else 0 for v,alpha in zip(f.get_flattened_data(),a.get_flattened_data())])
            image.info["transparency"] = 0
            outframes.append(image)
        name = family+"-"+depth
        gif = folder/(name+"-128.gif")
        outframes[0].save(gif,save_all=True,append_images=outframes[1:],duration=durations,loop=0,transparency=0,disposal=2,optimize=False)
        big = [f.resize((256,256),Image.Resampling.NEAREST) for f in outframes]
        display = folder/(name+"-256.gif")
        big[0].save(display,save_all=True,append_images=big[1:],duration=durations,loop=0,transparency=0,disposal=2,optimize=False)
        sheet = Image.new("RGBA",(128*len(outframes),128))
        for i,frame in enumerate(outframes):
            sheet.paste(frame.convert("RGBA"),(i*128,0))
        sheet.save(folder/(name+"-spritesheet.png"))
        # Verify serialized GIF, including transparency, frame count and moving pixels.
        reread = Image.open(gif)
        if reread.n_frames != len(outframes):
            raise RuntimeError("GIF encoder merged frame timings: verify before publishing")
        decoded = [f.convert("RGBA") for f in ImageSequence.Iterator(reread)]
        if len(set(f.tobytes() for f in decoded)) < 2:
            raise RuntimeError("Export lost motion")
        colour_count = len({p[:3] for f in decoded for p in f.get_flattened_data() if p[3]})
        if colour_count > 24 or any(set(f.getchannel("A").get_flattened_data()) != {0,255} for f in decoded):
            raise RuntimeError("Palette/alpha invariants failed")
        entry = {"id":name,"family":family,"depth":depth,"file":display.relative_to(OUT).as_posix(),"logical_file":gif.relative_to(OUT).as_posix(),"spritesheet":(folder/(name+"-spritesheet.png")).relative_to(OUT).as_posix(),"frames":len(decoded),"native_frames":native_count,"loop_frame_order":loop_order,"durations_ms":durations,"native_file":master["file"],"native_sha256":master["sha256"],"display_sha256":sha(display),"visible_colours":colour_count,"native_union_bounds":list(bounds),"palette_reference":refs[depth]["logical_file"],"exposure_gain":gain,"mean_srgb_luma":round(sum(.2126*p[0]+.7152*p[1]+.0722*p[2] for f in decoded for p in f.get_flattened_data() if p[3])/sum(sum(a>0 for a in f.getchannel('A').get_flattened_data()) for f in decoded),2),"provenance":"Native RetroDiffusion family motion; common whole-clip framing, global 24-colour palette, binary alpha, locally transferred depth palette/exposure, nearest-neighbour 2x display. Forward/reverse playback of actual native poses closes the open native sequence; no interpolation, local motion synthesis or extra paid depth animation."}
        still_path = OUT/"inputs"/(name+"-still.png")
        still_path.write_bytes((STILLS/refs[depth]["logical_file"]).read_bytes())
        entry["still_file"] = still_path.relative_to(OUT).as_posix()
        entry["still_sha256"] = sha(still_path)
        entries.append(entry)
    # All derivatives must preserve exactly the same alpha motion/timing across depths.
    masks = []
    for e in entries:
        masks.append([f.convert('RGBA').getchannel('A').tobytes() for f in ImageSequence.Iterator(Image.open(OUT/e['logical_file']))])
    if not all(m == masks[0] for m in masks):
        raise RuntimeError("Depth reskins changed shared motion masks")
    manifest["derivatives"] = [e for e in manifest.get("derivatives",[]) if e["family"] != family]+entries
    (OUT/"manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf-8")
    review = Image.new("RGB",(4*256,((len(frames)+3)//4)*282),"#243b4b")
    draw = ImageDraw.Draw(review)
    for i,f in enumerate(ImageSequence.Iterator(Image.open(OUT/entries[0]["file"]))):
        frame = f.convert("RGBA")
        x,y=i%4*256,i//4*282
        review.paste(frame,(x,y),frame)
        draw.text((x+8,y+260),f"{family} exported frame {i}",fill="white")
    review.save(OUT/"review"/(family+"-game-frames.png"))
    print(f"OFFLINE EXPORT {family}: {len(entries)} palette variants, {len(frames)} frames each")


def package():
    manifest = json.loads((OUT/"manifest.json").read_text(encoding="utf-8"))
    with zipfile.ZipFile(OUT/"all-animations.zip","w",zipfile.ZIP_DEFLATED) as z:
        for m in manifest["masters"]:
            z.write(OUT/m["file"],m["file"])
        for e in manifest.get("derivatives",[]):
            for key in ("file","logical_file","spritesheet","still_file"):
                z.write(OUT/e[key],e[key])
        for family in {m["subject"] for m in manifest["masters"]}:
            for suffix in ("-source.png","-upload.png","-request.json"):
                name = "inputs/"+family+suffix
                z.write(OUT/name,name)
        for name in ("manifest.json","plan.json","ledger.json","pilot-review.json","review-scores.json","README.md","index.html","gallery.js","start-viewer.bat","browser-verification.json"):
            if (OUT/name).exists():
                z.write(OUT/name,name)


if __name__ == "__main__":
    if sys.argv[1] == "package":
        package()
    else:
        export(sys.argv[1])
