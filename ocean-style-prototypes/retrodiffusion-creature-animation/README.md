# Shared family creature animations

Six native RetroDiffusion custom family animations, thirty explicitly labelled depth-palette derivatives. User approved a new $1.50 cap, octopus pilot included; all six completed at $0.25 each, with no paid retries, credit purchases or provider fallback. Historical RD reserved spend was $5.26; the combined reserved total is now $6.76. Codex-native image pricing is not included in that RD-only figure.

Open http://127.0.0.1:8775/index.html while the server runs, or use `start-viewer.bat`. Animated table uses synchronized actual spritesheet poses, with play/pause, still-reference comparison, ocean/light/dark backdrops, preview, native GIF links and game GIF downloads. `all-animations.zip` contains six untouched native GIFs, thirty logical/display GIF pairs, spritesheets, still references and provenance. It contains no API credential.

## Money saved

| Strategy | Paid loops | Cost at checked unit rate |
|---|---:|---:|
| Separate custom loop per creature/depth | 30 | $7.50 |
| One custom family loop, five local palette variants | 6 | $1.50 |
| Avoided generation | 24 | $6.00 (80%) |

The $7.50 comparison is hypothetical, not money spent. There are six genuine provider-generated motions, not thirty independent native animations. Each family/depth derivative shares exactly the same alpha masks, frame order and timing as the other four members of its family. Existing depth stills are near-matched rather than pixel-identical: animation reuse intentionally standardizes the master pose, not a promise to reproduce all old small geometric differences. All old source/selected stills and the main app are unchanged.

## Actual motion and loop handling

Each native output has eight actual poses at 128×128. Parent inspected every unique pose, not just the worker's output count. The octopus retains eight separately visible tips in all eight. Other defining features (lure, toothed slender jaw, shared colony stem, mouth parasite and circular shark mouth) remain.

Generated sequences do not consistently return to the initial pose. To avoid an abrupt native last-to-first reset, game playback uses the original poses forward 0..7 then reverse 6..1, 14 playback frames. This is disclosed pose reuse, not interpolation, procedural motion, invented images or additional provider generation. The raw native GIF bytes are preserved unchanged and may show their original reset.

Production export uses ONE bounding rectangle/scale/translation for the whole clip to avoid per-frame reframing jitter: fit into 96×96 within 128×128. Global palette across the clip is limited to 24 opaque colours, plus one transparent index. Alpha is binary. Depth palettes are locally transferred using the selected still references and approximately normalized to clip-average foreground sRGB luma 130/95/75/55/38. Display GIFs are nearest-neighbour 2× (256×256); spritesheets contain the exact playback poses. Every derivative records source native SHA, frame order, timing, transformation, palette reference, colour count and display SHA.

## Art review (game exports, not untouched native file-property ratings)

| Family | Overall |
|---|---:|
| Anglerfish | 8.4/10 |
| Viperfish | 8.2/10 |
| Siphonophore | 8.5/10 |
| Isopod host fish | 8.3/10 |
| Cookiecutter shark | 8.6/10 |
| Octopus / kraken | 8.5/10 |

Mean 8.42/10. These are subjective prototype art-fit judgments, not scientific animal validation. Viperfish closes its jaw during several poses, so its teeth are temporarily less prominent. Hostfish parasite detail is small at icon scale. Motion is deliberately gentle idle, not attacks, directional locomotion or a production character-animation pack. Native sequences' original resets are a known limitation repaired only in the labelled game playback.

## Budget, preservation and verification

`plan.json` stores live free quotes and approval; `ledger.json` stores gross reservations and reported successful charges. The uploader uses existing authenticated RD API helpers, refuses credential redirects and reserves before submitting. Accepted task IDs, request digests and receipts remain under `jobs/`. Ambiguous submissions are not automatically repeated. `inputs/` preserves selected source frames and RGB upload images, requests/prompts/seeds, and selected depth still references. Native bytes are under `images/`; source and export review grids under `review/`.

`pilot-review.json` binds the actual octopus parent review to its native SHA before other payments were admitted. `review-scores.json` gives final family ratings/reasons. See `browser-verification.json` for actual browser checks. Offline tests cover live-price increases, gross cap exhaustion and refusing uncertain paid repeats. Ruff diagnostics passed for both Python scripts and budget tests; JavaScript passed node syntax check. Optional configured Biome/ty LSP commands were unavailable: install them or update their commands in `pi-lsp.json` if needed; shared configuration was not changed.

Tools: `tools/retrodiffusion-creature-animation.py` handles paid admissions; `tools/export-retrodiffusion-creature-animation.py` is offline only. Source API docs: https://www.retrodiffusion.ai/app/guide/api and https://github.com/Retro-Diffusion/api-examples . Account/provider terms govern outputs; no CC0 claim.
