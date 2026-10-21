"""Extract actual native still-sheet cells; assemble disclosed game loop offline."""
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/"ocean-style-prototypes/codex-creature-animation"
PILOT = OUT/"pilot"


def package():
    source = PILOT/"octopus-motion-sheet-native.png"
    raw = source.read_bytes()
    sheet = Image.open(source).convert("RGBA")
    frames = [sheet.crop((round(c*sheet.width/4),round(r*sheet.height/2),round((c+1)*sheet.width/4),round((r+1)*sheet.height/2))) for r in range(2) for c in range(4)]
    boxes = [f.getchannel("A").point(lambda a:255 if a>=64 else 0).getbbox() for f in frames]
    if any(b is None for b in boxes):
        raise RuntimeError("Empty sheet cells; wrong grid or missing poses")
    if any(b[0]==0 or b[1]==0 or b[2]==f.width or b[3]==f.height for f,b in zip(frames,boxes)):
        raise RuntimeError("Cells touch crop edges: inspect native layout/background/clipping before export")
    # All cells use ONE crop/scale/translation; do not hide pose drift by centering individually.
    bounds = (min(b[0] for b in boxes),min(b[1] for b in boxes),max(b[2] for b in boxes),max(b[3] for b in boxes))
    scale = min(96/(bounds[2]-bounds[0]),96/(bounds[3]-bounds[1]))
    size = (max(1,round((bounds[2]-bounds[0])*scale)),max(1,round((bounds[3]-bounds[1])*scale)))
    logical=[]
    for f in frames:
        canvas=Image.new("RGBA",(128,128))
        small=f.crop(bounds).resize(size,Image.Resampling.NEAREST)
        canvas.alpha_composite(small,((128-size[0])//2,(128-size[1])//2))
        logical.append(canvas)
    strip=Image.new("RGB",(1024,128))
    for i,f in enumerate(logical):
        strip.paste(f.convert("RGB"),(i*128,0))
    palette=strip.quantize(colors=24,method=Image.Quantize.MEDIANCUT,dither=Image.Dither.NONE)
    pal=palette.getpalette()
    output=[]
    folder=OUT/"exports"
    folder.mkdir(exist_ok=True)
    for i,f in enumerate(logical):
        indexed=f.convert("RGB").quantize(palette=palette,dither=Image.Dither.NONE)
        alpha=f.getchannel("A").point(lambda a:255 if a>=64 else 0)
        image=Image.new("P",(128,128))
        frame_palette = [0,0,0]+pal[:72]
        image.putpalette(frame_palette+[0]*(768-len(frame_palette)))
        image.putdata([v+1 if a else 0 for v,a in zip(indexed.get_flattened_data(),alpha.get_flattened_data())])
        rgba = image.convert("RGBA")
        rgba.putalpha(alpha)
        rgba.save(folder/f"octopus-frame-{i}.png")
        output.append(image)
    # Explicit native-pose reuse, not locally generated in-between motion.
    order=list(range(8))+list(range(6,0,-1))
    sequence=[output[i].copy() for i in order]
    sequence[0].save(folder/"octopus-codex-128.gif",save_all=True,append_images=sequence[1:],duration=120,loop=0,transparency=0,disposal=2,optimize=False)
    big=[f.resize((256,256),Image.Resampling.NEAREST) for f in sequence]
    big[0].save(folder/"octopus-codex-256.gif",save_all=True,append_images=big[1:],duration=120,loop=0,transparency=0,disposal=2,optimize=False)
    grid=Image.new("RGB",(1024,564),"#243b4b")
    draw=ImageDraw.Draw(grid)
    for i,f in enumerate(output):
        image=Image.open(folder/f"octopus-frame-{i}.png").convert("RGBA").resize((256,256),Image.Resampling.NEAREST)
        x,y=i%4*256,i//4*282
        grid.paste(image,(x,y),image)
        draw.text((x+8,y+260),f"Codex actual pose {i}",fill="white")
    grid.save(OUT/"frame-review.png")
    meta={"native_sheet_file":"pilot/octopus-motion-sheet-native.png","native_sheet_sha256":hashlib.sha256(raw).hexdigest(),"native_sheet_dimensions":list(sheet.size),"native_output_type":"Still PNG spritesheet, not animated GIF/video","grid":{"columns":4,"rows":2,"ordering":"row-major"},"native_pose_count":8,"logical_pose_dimensions":[128,128],"common_cell_crop":list(bounds),"common_scale":scale,"loop_pose_order":order,"playback_duration_ms_per_pose":120,"unique_exported_pose_hashes":len({hashlib.sha256(f.tobytes()).hexdigest() for f in output}),"provenance":"Every source pose cropped from one native Codex sheet; shared framing/global 24-colour palette/binary alpha/nearest-neighbour display, GIF assembly and forward/reverse playback are local derivatives. No creature drawing, procedural deformation, motion interpolation or native animation endpoint claim.","review_status":"pending actual parent review"}
    (OUT/"export-manifest.json").write_text(json.dumps(meta,indent=2),encoding="utf-8")
    print(json.dumps(meta,indent=2))


if __name__ == "__main__":
    package()
