# Desktops end-to-end harness

`desktops-e2e.mjs` drives real clicks in both final shells (`previews/win11-final`, `previews/macos-final`) inside the training parent page (`desktop.html`):

- three scenes (`network-abuse-abyss`, `deception-twilight`, `intrusion-sunlight`) on the attack and safe paths, each with a mid-scene Windows ↔ macOS swap;
- runtime configuration (`deception-midnight` overlay, `patchWorld`, `replaceWorld`, external wallpaper refusal);
- no page or console errors, and zero non-loopback requests (every other request is aborted and counted).

Screenshots go to `docs/desktop-parity/screens/final-integrate-*.png`.

## Run

```sh
# from the project root; build the shells first if their sources changed
node tools/e2e/desktops-e2e.mjs            # all runs
node tools/e2e/desktops-e2e.mjs worm       # only runs whose label starts with "worm"
```

The harness starts its own servers in-process (`createAppServer` from `server.mjs`, `createComparisonServer` from `desktop-comparison/server.mjs`) on loopback. It does not need `node server.mjs` and does not use ports 4173/4189.

The comparison server only allows `http://127.0.0.1:4173` to frame the shells. The harness rewrites the `Content-Security-Policy` response header of shell responses to add the test parent origin to `frame-ancestors` (headers only; bodies and server files are unchanged).

Exit code is `1` when any check fails. A failing run saves `fail-<label>.png` in `E2E_FAIL_DIR`.

## All 30 scenes: `all-scenes-e2e.mjs`

`all-scenes-e2e.mjs` plays every creature scene (the 30 ids from `backend/ocean-profiles.mjs`) twice, through real clicks in the shells:

- **fell**: the attack path. It starts on one OS and swaps to the other when the first `action` step is reached. The fell OS alternates per scene, so every depth runs on both OSes.
- **safe**: the safe path on the other OS. The run takes the forward choice until the last step that offers a safe choice, then takes that safe choice. Trench scenes have no safe path. For these, the run plays the debrief's **Replay with the patch applied**, which ends on the safe (patched) debrief.

The driver is generic. It reads `world.scene.highlight` and the `data.web` page choices, then makes the gesture a trainee would make:

| Highlight | Fell | Safe |
|---|---|---|
| toast step | opens the announced app from the taskbar or dock; passive (trench) toasts are left to auto-dismiss | same |
| `mail` | message link, or the attachment; journey messages: link, then the page's primary button | Delete (Windows) / Move to Junk (macOS) |
| `browser` | the page's primary choice button | the page's first secondary choice button |
| `mfa` | Authenticator Approve | Deny |
| `files` | double-clicks the file in Explorer / Finder | Delete (Explorer toolbar) / Move to Trash (Finder context menu) |
| `updates` (trench task) | waits | waits |

Each run asserts that the attack (with `sc-proc` in the world) and the debrief on the expected path are reached. It also asserts a valid world at every step and at the end, no page or console errors, zero non-loopback requests and a swap that keeps the step and the rendered revision. A failing run saves `fail-scenes-<scene>-<path>.png` in `E2E_FAIL_DIR`. Passing runs take no screenshots.

```sh
node tools/e2e/all-scenes-e2e.mjs                     # 60 runs, about 25 minutes
node tools/e2e/all-scenes-e2e.mjs intrusion-twilight  # scene ids that start with the argument
```

Default ports are `4386` (parent) and `4387` (shells), so it can run beside `desktops-e2e.mjs`. The script prints the coverage table below.

### Coverage (last run: 60/60 runs passed, 0 non-loopback requests)

| Scene | Fell path | Safe path |
|---|---|---|
| `deception-sunlight` | pass · Windows → macOS | pass · macOS |
| `deception-twilight` | pass · macOS → Windows | pass · Windows |
| `deception-midnight` | pass · Windows → macOS | pass · macOS |
| `deception-abyss` | pass · macOS → Windows | pass · Windows |
| `deception-trench` | pass · Windows → macOS | no safe path; pass · macOS (patched replay) |
| `intrusion-sunlight` | pass · macOS → Windows | pass · Windows |
| `intrusion-twilight` | pass · Windows → macOS | pass · macOS |
| `intrusion-midnight` | pass · macOS → Windows | pass · Windows |
| `intrusion-abyss` | pass · Windows → macOS | pass · macOS |
| `intrusion-trench` | pass · macOS → Windows | no safe path; pass · Windows (patched replay) |
| `network-abuse-sunlight` | pass · Windows → macOS | pass · macOS |
| `network-abuse-twilight` | pass · macOS → Windows | pass · Windows |
| `network-abuse-midnight` | pass · Windows → macOS | pass · macOS |
| `network-abuse-abyss` | pass · macOS → Windows | pass · Windows |
| `network-abuse-trench` | pass · Windows → macOS | no safe path; pass · macOS (patched replay) |
| `trusted-source-sunlight` | pass · macOS → Windows | pass · Windows |
| `trusted-source-twilight` | pass · Windows → macOS | pass · macOS |
| `trusted-source-midnight` | pass · macOS → Windows | pass · Windows |
| `trusted-source-abyss` | pass · Windows → macOS | pass · macOS |
| `trusted-source-trench` | pass · macOS → Windows | no safe path; pass · Windows (patched replay) |
| `theft-surveillance-sunlight` | pass · Windows → macOS | pass · macOS |
| `theft-surveillance-twilight` | pass · macOS → Windows | pass · Windows |
| `theft-surveillance-midnight` | pass · Windows → macOS | pass · macOS |
| `theft-surveillance-abyss` | pass · macOS → Windows | pass · Windows |
| `theft-surveillance-trench` | pass · Windows → macOS | no safe path; pass · macOS (patched replay) |
| `extortion-destruction-sunlight` | pass · macOS → Windows | pass · Windows |
| `extortion-destruction-twilight` | pass · Windows → macOS | pass · macOS |
| `extortion-destruction-midnight` | pass · macOS → Windows | pass · Windows |
| `extortion-destruction-abyss` | pass · Windows → macOS | pass · macOS |
| `extortion-destruction-trench` | pass · macOS → Windows | no safe path; pass · Windows (patched replay) |

Shell bugs this suite found and fixed:

- **macOS Safari opened from the dock during a browser toast showed the Start Page, not the lure page.** The adapter adopted the native window without its world payload. `previews/macos-final/src/adapter.js` now reopens an adopted window on the world payload when the two differ.
- **macOS Finder "extracted" a `.zip` lure.** It created a folder outside the world contract, and no `run-file` was sent. A build patch in `make-macos-final.mjs` makes a `.zip` open like any other world file.
- **Windows toasts did not auto-dismiss a banner id seen before.** A trench patched replay reuses `sc-toast`, so that scene stopped at the toast. A second banner within 7 s also cancelled the first banner's timer. `win11-final/src/components/ocean/index.jsx` now keeps one timer per shown banner.

## Environment

| Variable | Default |
|---|---|
| `PLAYWRIGHT_CORE` | `C:/Temp/pw-kimi/node_modules/playwright-core` (path or package name) |
| `CHROME_PATH` | `C:/Users/warcr/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe`; if missing, Playwright's own Chromium |
| `E2E_HOST` | `127.0.0.1` |
| `E2E_PARENT_PORT` | `4370` (training parent / app server); `4386` for `all-scenes-e2e.mjs` |
| `E2E_SHELLS_PORT` | `4371` (comparison server serving the shells); `4387` for `all-scenes-e2e.mjs` |
| `E2E_PARENT_URL` | `http://$E2E_HOST:$E2E_PARENT_PORT` |
| `E2E_SHELLS_URL` | `http://$E2E_HOST:$E2E_SHELLS_PORT` |
| `SHOTS_DIR` | `docs/desktop-parity/screens` |
| `E2E_FAIL_DIR` | OS temp directory |
