#!/usr/bin/env python3
"""Lit copies of the ocean creature animations and depth-colour creatures, served to the desktops and the creature matrix.

Sources (the pipeline's originals, not edited):
  ocean-style-prototypes/retrodiffusion-creature-animation/animations/<name>-256.gif   14 frames, 256 px
  ocean-style-prototypes/codex-creature-depth-evolution/depth-colors/<name>-256.png    256 px
Outputs in ocean-style-prototypes/lit-ocean/:
  creatures/<name>.gif and morphology/<name>-256.png   the lit copies the backend serves
  normals/creatures/<name>.png and normals/morphology/<name>-256.png   normal maps (atlas for animations)
  lit-manifest.json   sha256 of every output and of its source, frame count and timing

Lighting is the model in ui/abyss/pixel-lit.js (bake): the same light, threshold and formula. Keep them in step.
Normal maps come from Sprite Fusion Sprite Normals (see tools/build-pixel-normals.py for how to install it).

Usage: python tools/build-lit-ocean-sprites.py [--tool PATH]
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ANIM_SRC = ROOT / 'ocean-style-prototypes/retrodiffusion-creature-animation/animations'
MORPH_SRC = ROOT / 'ocean-style-prototypes/codex-creature-depth-evolution/depth-colors'
OUT = ROOT / 'ocean-style-prototypes/lit-ocean'
EXE = 'spritefusion-sprite-normals.exe' if os.name == 'nt' else 'spritefusion-sprite-normals'
LIGHT = np.array([-0.45, 0.6, 0.66])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def find_tool(explicit):
    candidates = [explicit, os.environ.get('SPRITEFUSION_NORMALS'), shutil.which(EXE), Path.home() / '.cargo/bin' / EXE]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    sys.exit('spritefusion-sprite-normals not found: pass --tool, set SPRITEFUSION_NORMALS, or install it')


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def shade(color, normal):
    """RGBA uint8 colour frame and RGB uint8 normal map -> lit RGBA, as bake() in ui/abyss/pixel-lit.js."""
    keep = color[..., 3] >= 127.5
    m = normal.astype(float) / 127.5 - 1
    length = np.linalg.norm(m, axis=-1)
    length[length == 0] = 1
    lam = np.maximum((m / length[..., None]) @ LIGHT, 0)
    k = 0.28 + 1.35 * lam
    out = np.zeros_like(color)
    out[..., :3] = np.clip(np.rint(color[..., :3] * k[..., None]), 0, 255)
    out[keep, 3] = 255
    return out


def run_tool(tool, src, work, frame_size=None):
    """Run the generator into a scratch folder; return (normal atlas path, frames metadata or None)."""
    out = work / (src.stem + '.png')
    cmd = [tool, str(src), '-o', str(out), '--force']
    if frame_size:
        cmd += ['--frame-size', f'{frame_size}x{frame_size}']
    subprocess.run(cmd, check=True, capture_output=True)
    frames = work / (src.stem + '.frames.json')
    meta = json.loads(frames.read_text(encoding='utf8'))['animation'] if frames.exists() else None
    return out, meta


def delays_of(meta, count):
    if meta is None:
        return [100] * count
    return [round(num / den) for num, den in meta['delays_ms']]


def lit_animation(tool, src, work, normal_dest, lit_dest):
    atlas, meta = run_tool(tool, src, work)
    if meta is None:
        sys.exit(f'{src.name}: the generator returned no frame layout')
    fw, fh, cols, count = meta['frame_width'], meta['frame_height'], meta['columns'], meta['frame_count']
    atlas_rgb = np.array(Image.open(atlas).convert('RGB'))
    gif = Image.open(src)
    if gif.n_frames != count:
        sys.exit(f'{src.name}: {gif.n_frames} GIF frames, generator reports {count}')
    frames = []
    for i in range(count):
        gif.seek(i)
        color = np.array(gif.convert('RGBA'))
        x, y = (i % cols) * fw, (i // cols) * fh
        frames.append(shade(color, atlas_rgb[y:y + fh, x:x + fw]))
    durations = delays_of(meta, count)
    write_gif(frames, durations, lit_dest)
    shutil.copy(atlas, normal_dest)
    return {'frames': count, 'frame_size': fw, 'delays_ms': durations}


def write_gif(frames, durations, dest):
    """Palette GIF: one palette for the whole animation, index 255 kept for transparency, frames verified against the alpha."""
    visible = np.concatenate([f[..., :3][f[..., 3] > 0] for f in frames])
    if len(visible) > 200_000:
        visible = visible[np.random.default_rng(0).choice(len(visible), 200_000, replace=False)]
    palette = Image.fromarray(visible.reshape(-1, 1, 3), 'RGB').quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    table = palette.getpalette()[:255 * 3] + [0, 0, 0]
    indexed = []
    for f in frames:
        p = Image.fromarray(f[..., :3], 'RGB').quantize(palette=palette, dither=Image.Dither.NONE)
        idx = np.array(p)
        idx[f[..., 3] == 0] = 255
        frame = Image.fromarray(idx, 'P')
        frame.putpalette(table)
        indexed.append(frame)
    # optimize=False keeps every frame full size: Pillow's diff cropping can leave stale pixels under transparency.
    indexed[0].save(dest, save_all=True, append_images=indexed[1:], duration=durations, loop=0, disposal=2, transparency=255, optimize=False)
    back = Image.open(dest)
    for i, f in enumerate(frames):
        back.seek(i)
        mask = np.array(back.convert('RGBA'))[..., 3] > 0
        if not np.array_equal(mask, f[..., 3] > 0):
            sys.exit(f'{dest.name}: frame {i} transparency differs from the lit frame')


def lit_still(tool, src, work, normal_dest, lit_dest):
    atlas, _ = run_tool(tool, src, work)
    color = np.array(Image.open(src).convert('RGBA'))
    normal = np.array(Image.open(atlas).convert('RGB'))
    if normal.shape[:2] != color.shape[:2]:
        sys.exit(f'{src.name}: normal map {normal.shape[:2]} does not match {color.shape[:2]}')
    lit = shade(color, normal)
    Image.fromarray(lit, 'RGBA').save(lit_dest)
    shutil.copy(atlas, normal_dest)
    return {}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tool')
    tool = find_tool(parser.parse_args().tool)
    for sub in ('creatures', 'morphology', 'normals/creatures', 'normals/morphology'):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    manifest = {
        'schema': 'lit-ocean-v1',
        'lighting': 'ui/abyss/pixel-lit.js bake(): light [-0.45, 0.6, 0.66], 0.28 + 1.35 * lambert, alpha below 50% dropped',
        'creatures': [],
        'morphology': [],
    }
    work = Path(tempfile.mkdtemp(prefix='lit-ocean-'))
    try:
        for src in sorted(ANIM_SRC.glob('*-256.gif')):
            name = src.stem[: -len('-256')]
            lit_path = OUT / 'creatures' / f'{name}.gif'
            info = lit_animation(tool, src, work, OUT / 'normals/creatures' / f'{name}.png', lit_path)
            manifest['creatures'].append({
                'name': name, 'file': f'creatures/{name}.gif', 'sha256': sha256(lit_path), 'bytes': lit_path.stat().st_size,
                'source': f'retrodiffusion-creature-animation/animations/{src.name}', 'source_sha256': sha256(src),
                'normal': f'normals/creatures/{name}.png', **info,
            })
            print('creature', name, info['frames'], 'frames')
        for src in sorted(MORPH_SRC.glob('*-256.png')):
            name = src.stem
            lit_path = OUT / 'morphology' / f'{name}.png'
            lit_still(tool, src, work, OUT / 'normals/morphology' / f'{name}.png', lit_path)
            manifest['morphology'].append({
                'name': name, 'file': f'morphology/{name}.png', 'sha256': sha256(lit_path), 'bytes': lit_path.stat().st_size,
                'source': f'codex-creature-depth-evolution/depth-colors/{src.name}', 'source_sha256': sha256(src),
                'normal': f'normals/morphology/{name}.png',
            })
        print('morphology', len(manifest['morphology']), 'images')
    finally:
        shutil.rmtree(work, ignore_errors=True)
    (OUT / 'lit-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    print(f"{len(manifest['creatures'])} creature animations, {len(manifest['morphology'])} morphology images -> {OUT.relative_to(ROOT).as_posix()}")


if __name__ == '__main__':
    main()
