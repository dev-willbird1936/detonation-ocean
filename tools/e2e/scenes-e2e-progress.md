# scenes-e2e progress

## GOAL

Make both final desktops dependable for attack demos: play all 30 scenes through real clicks in both shells, and fix every failure at its root cause.

## DONE WHEN

- `tools/e2e/all-scenes-e2e.mjs` plays all 30 scenes on two paths each. **fell** starts on one OS and swaps OS at the first action step. **safe** runs on the other OS; for trench scenes, which have no safe path, it plays the patched replay. Each run reaches the attack and the debrief, keeps a valid world, has no page errors and makes zero non-loopback requests.
- The coverage table is in `tools/e2e/README.md`.
- `node --test tests/*.test.mjs` and `node tools/e2e/desktops-e2e.mjs` stay green.

## Status: met

- `all-scenes-e2e.mjs`: 60/60 runs passed, 0 non-loopback requests.
- `node --test tests/*.test.mjs`: 276/276 passed.
- `desktops-e2e.mjs`: 67/67 checks passed.
- Root-cause fixes, all in shell code. Scene data, `scene-world.js` and `desktop.js` needed no change.
  - macOS adapter: a dock-opened Safari window adopted by the world now follows the world payload.
  - macOS build patch 67: a `.zip` opens as a world file.
  - Windows toasts: one auto-dismiss timer per shown banner.
- Open: doc follow-ups for the docs owner are in `docs/desktop-parity/requests/scenes-e2e-to-parent.md`.
