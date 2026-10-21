# AGENTS.md - Vultr Phishing Sandbox

> Slack project: `vultr-phishing-sandbox`.
> **When:** general updates: meaningful completed work, decisions or blocker changes.
> **With:** text only.
> This project has no Git forwarding: every update is queued manually.
> Write each summary as a Minto pyramid: headline is the governing outcome; bullets follow in descending change size, headline only for a small change. Use Added, Improved, Fixed or Heads-up when useful. Keep material limitations; label decisions and blockers honestly, never as shipped. No dates, source lines, IDs, raw logs, process narration or unchanged-status messages. Queue with `slack_update` (stable event ID, original timestamp, source); MCP unavailable: shared slack-project CLI. Report queue failures; queued is not delivered.

## Pixel sprites are always lit

Every pixel sprite in `ui/abyss/pixel/` appears with its normal map. Never show a flat sprite: not in the ocean, the job view, the bestiary, the menu octopus, the depth marks, the legend cards or the loader.

- Normal maps sit at `ui/abyss/pixel/normals/<same relative path>`, with the same size, alpha and frame layout. After adding or changing a pixel PNG, run `python tools/build-pixel-normals.py`, then `node tools/refresh-abyss-manifest.mjs`.
- The generator is Sprite Fusion Sprite Normals (MIT, https://github.com/Hugo-Dz/spritefusion-sprite-normals). On Windows, build it with the MSVC toolchain: `cargo +1.88.0-x86_64-pc-windows-msvc install --path <clone> --locked`. The GNU toolchain fails on `dlltool`.
- The renderer lights sprites per frame with `PixelLit.LIT_FRAG` (`ui/abyss/retro-pixel.js`). Every other view uses `PixelLit.image(url)`, `PixelLit.dataUrl(url)` or an element with `data-pixel-bg="<url>"`. Never point a view at a pixel PNG directly.
- Normal maps are data. Never colour-convert or sRGB-sample them.
- A sprite without a normal map renders from a silhouette-derived normal and logs `pixel-lit: no normal map`. Treat that warning as a failed check and generate the map.
- Code-drawn sprites with no file use `PixelLit.normalFromAlpha`.
- The desktop and creature-matrix creatures are lit too: the backend serves `ocean-style-prototypes/lit-ocean/` only (creature GIFs at `/ocean-creatures/…`, depth-colour PNGs at `/ocean-morphology/…`). Rebuild it with `python tools/build-lit-ocean-sprites.py` whenever a pipeline original changes; never serve the originals.
- `PixelLit.LIT_FRAG` (GPU) and `PixelLit.bake()` (CPU) implement one model. Change them together.

## Desktop simulations

Before you build or change an attack or exploit simulation, or touch the Windows or macOS training desktops, read `docs/desktop-parity/README.md`. It names the files to build on and the rules a simulation must keep.

- Write scenes as data in `desktop-comparison/previews/ocean-scenes.js`, following `docs/desktop-parity/SCENE-AUTHORING.md`.
- Configure a desktop per scene with `data/desktop-profiles/<family-depth>.json`. Do not edit shell code for theme, wallpaper, apps, user or data.
- There is one Windows 11 desktop (`previews/win11-final`) and one macOS desktop (`previews/macos-final`). **macOS is the standard:** its apps, features and behaviour define both desktops, and Windows matches them in Windows idiom.
- `ui/desktop/world-model.js` is the only world validator. Both shells must stay in parity: never add an app or capability to one OS only.
- Anything a trainee or scene can see or change must live in the shared world and survive an OS switch. Only transient UI stays local. See `docs/desktop-parity/SYNC-AUDIT.md`.
- `desktop-comparison/archive/` is superseded. Do not build on it.
- Edit `desktop-comparison/win11-final/` and `desktop-comparison/make-macos-final.mjs` (with `previews/macos-final/src/`), never their built outputs. Rebuild, then run `node --test tests/*.test.mjs` and `node tools/e2e/desktops-e2e.mjs`.
