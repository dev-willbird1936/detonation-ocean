# Evolution depth grid: palettes, forms, variants and animation plan

Six creature families, five ocean depths. Depth is victim interaction, not severity or creature power.

## Shipped (candidate stills, colour QVL pass)

**Three shared morphology stages per family** (18 normalized sources, `depth-colors/morphology/{form}-{stage}-{128,256}.png`):

| Depth | Stage key | Stage label |
|---|---|---|
| Sunlight, Twilight | `base-rich` | Base form |
| Midnight, Abyss | `midnight-abyss` | Mid form |
| Trench | `trench` | Trench form |

**Five depth palettes.** Each family has nine role swatches (primary, secondary, tertiary × shadow, base, highlight) plus three neutrals (outline, mouth/pupil, eye/teeth). The depth transform recolours only the nine swatches, in CIELAB, with a per-depth lightness scale `k`, blue-shift weight `w` and chroma scale `c` (tertiary: `k = 1`, `w / 2`). Neutrals and alpha never change.

| Depth | k | w | c |
|---|---|---|---|
| Sunlight | 1.000 | 0.00 | 1.00 |
| Twilight | 0.867 | 0.15 | 1.00 |
| Midnight | 0.754 | 0.30 | 1.00 |
| Abyss | 0.667 | 0.45 | 0.85 |
| Trench | 0.466 | 0.60 | 0.75 |

**30 variants** = 6 families × 5 depths, `depth-colors/{family}-{depth}-{128,256}.png`. Sunlight is identical to its source stage. Variants of one stage share alpha. Families: `anglerfish`, `viperfish`, `siphonophore`, `isopod-host`, `cookiecutter`, `squid` (shown as `Squid → Kraken`; no Octopus asset is used).

Pages and code that use them:

| Surface | File |
|---|---|
| 6×5 grid (30 stills, animation pending) | `ocean-style-prototypes/codex-creature-palette-base/index.html` |
| 3-form gallery (18 sources) | `ocean-style-prototypes/codex-creature-depth-evolution/index.html` |
| Profile catalog (30 assets, `/ocean-morphology/{form}/{depth}.png`) | `backend/ocean-profiles.mjs`, `ui/desktop/ocean-profiles.js` |

Status: every manifest entry stays `status: candidate`. The independent colour review passed (`docs/evidence/evolution-depth-color-qvl.md`, overall 8.4 against a gate of 8.0). The manifest's own `qvl` field still reads `pending`; the pass is recorded in `codex-creature-palette-base/evolution-grid-status.json`, bound to the manifest SHA-256.

## Pending (not shipped)

- **18 stage loops**: 6 families × 3 stages (Base, Mid, Trench). Depth cells would reuse them (Sunlight/Twilight, Midnight/Abyss). None is generated, authorised or reviewed. The paid generation needs separate authorisation.
- **Animation player** on the grid and a reviewed animation manifest. Until both exist the grid shows `Animation playback pending` and has no Play controls.
- **Final integration QA and promotion** of the candidate stills.
- The legacy RetroDiffusion loops animate earlier sprites that do not match these forms. They are kept unchanged for the main app's scripted scenes and are archived in the grid page's `Legacy` section. They are not the planned animations.
