# e2e scenarios-60 progress

Crash-safe notes. Newest at the bottom.

- Revived after runner crash. Disk state: no e2e edits existed yet (all-scenes-e2e.mjs untouched, no screens/scenarios-60, no requests/e2e-to-*.md).
- Read done: contract, README, e2e lib, all-scenes, engine-core-ready, fx-to-engine-core, controller.mjs, shells' dim/creature code.
- Findings to remember:
  - fx badge says `verified by sandbox (docker|vultr)` only for docker/vultr mode; `simulated` mode shows `simulated`. So the check is mode-aware: docker (E2E_SANDBOX=docker) -> verified badge; simulated -> `simulated` badge + the fx caption shows sandbox event labels (proves no scripted fallback).
  - Windows lock: `[data-testid=lock-screen]`, `[data-testid=lock-user]`, no input. macOS: text `Click to log in`.
  - Shell dim marks: Windows `[data-dim=true]` (taskbar `[data-testid=task-<app>]`), macOS `[data-ocean-dim]` on `button.dock-icon`/`[data-dock-app]`. Creature: Windows `[data-testid=creature]` (data-state), macOS `#ocean-creature` with `data-state`.
  - Parent: `#ocean-intro`, `#intro-title`, `#intro-line`, `#intro-next`, `#intro-dismiss`, `#ocean-brief`, `#ocean-fx-layer`, `#ocean-debrief .ocean-receipt`.
- Implemented: `all-scenes-e2e.mjs --scenarios [prefix]` (env E2E_ONLY_PATH=fell|safe, E2E_SANDBOX=docker). lib `openScene(ctx,id,run)`. mydoom-2004 fell PASS (windows -> macos, creature idle>notice>circle>press>breakthrough, simulated sandbox 24 events, receipt ok).
- Orchestrator: memory is exhausted. Docker stays OFF; simulated sandbox only. One browser at a time, prefer headless-shell, subsets while developing.
- Flake seen once: mac safe path Finder click on returned-text.zip 'not stable' (passed on rerun).
- Full 60 running in background: chunks of 10 via /c/Temp/e2e60/run-rest.sh, logs /c/Temp/e2e60/chunk-0N.log (ALL-DONE marker). chunk-00 started first.
- Full 60 pass done (chunks 0-5, logs /c/Temp/e2e60): 102/120. Failures to resolve: (1) chunk-00 5 ids could-not-open (rerun), (2) twitter-stalkers-2011 safe macOS dimming/creature, (3) bec/aurora-2010/great-cannon-2015/polyfill-io-2024 fell console 404, (4) lockbit-3-drive-by fell post failed, (5) sasser-2004 swap lost state (harness fixed: step may advance in trench; lib now records http>=400 urls).
- r1 DONE: pc-cyborg, melissa, iloveyou, emotet, rsa-securid all PASS on rerun (memory flake).
- r2 DONE: bec, aurora-2010, twitter-stalkers-2011, lockbit-3-drive-by, sasser-2004 all PASS on rerun (404/dim/post-failed not reproducible; now http>=400 urls are recorded by the lib). Next: great-cannon, polyfill, then stability repeat.
- r3 DONE: great-cannon, polyfill PASS (no http>=400 recorded). 404 probable cause: engine-core edited server.mjs/ui/desktop/desktop.js 18:21-18:24 while chunk-03 ran. Next: twitter-stalkers x3 stability, then desktops-e2e + sync-e2e.
- r4 DONE: twitter-stalkers 3x stable. Running desktops-e2e (log /c/Temp/e2e60/desktops.log) then sync-e2e (sync.log).
- desktops-e2e: 67/67 pass, exit 0. sync-e2e: port 4392 held by another process; rerunning on 4410/4411 (log sync.log).
