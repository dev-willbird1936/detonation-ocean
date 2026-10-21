#!/usr/bin/env python3
"""Normal maps for every pixel sprite under ui/abyss/pixel.

Writes ui/abyss/pixel/normals/<same relative path>: same size, same alpha, same frame layout.
Sheets (names containing 'spritesheet' or '-swim') use square cells whose side is the image height.
Generator: Sprite Fusion Sprite Normals (MIT), https://github.com/Hugo-Dz/spritefusion-sprite-normals

Install on Windows with the MSVC toolchain (the GNU toolchain fails on dlltool):
  git clone https://github.com/Hugo-Dz/spritefusion-sprite-normals
  cargo +1.88.0-x86_64-pc-windows-msvc install --path spritefusion-sprite-normals --locked

Usage: python tools/build-pixel-normals.py [--tool PATH]
The tool is looked up in --tool, $SPRITEFUSION_NORMALS, PATH, then ~/.cargo/bin.
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PIXEL = ROOT / 'ui/abyss/pixel'
NORMALS = PIXEL / 'normals'
EXE = 'spritefusion-sprite-normals.exe' if os.name == 'nt' else 'spritefusion-sprite-normals'


def find_tool(explicit):
    candidates = [explicit, os.environ.get('SPRITEFUSION_NORMALS'), shutil.which(EXE), Path.home() / '.cargo/bin' / EXE]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return str(candidate)
    sys.exit('spritefusion-sprite-normals not found: pass --tool, set SPRITEFUSION_NORMALS, or install it (see header)')


def is_sheet(name):
    return 'spritesheet' in name or '-swim' in name


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tool')
    tool = find_tool(parser.parse_args().tool)
    sources = [path for path in sorted(PIXEL.rglob('*.png')) if NORMALS not in path.parents]
    for src in sources:
        rel = src.relative_to(PIXEL)
        out = NORMALS / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        color = Image.open(src).convert('RGBA')
        w, h = color.size
        cmd = [tool, str(src), '-o', str(out), '--force']
        if is_sheet(src.name):
            if w % h:
                sys.exit(f'{rel}: width {w} is not a whole number of {h} px cells')
            cmd += ['--frame-size', f'{h}x{h}']
        subprocess.run(cmd, check=True, capture_output=True)
        # The tool also writes a colour copy and, for animations, a frames file. Only the normal map is kept.
        for side in out.parent.glob(f'{out.stem}.*'):
            if side != out:
                side.unlink()
        normal = Image.open(out).convert('RGBA')
        if normal.size != (w, h):
            sys.exit(f'{rel}: normal map is {normal.size}, source is {(w, h)}')
        if not np.array_equal(np.array(normal)[..., 3], np.array(color)[..., 3]):
            sys.exit(f'{rel}: normal map alpha differs from the source')
        print(rel.as_posix())
    print(f'{len(sources)} normal maps in {NORMALS.relative_to(ROOT).as_posix()}')


if __name__ == '__main__':
    main()
