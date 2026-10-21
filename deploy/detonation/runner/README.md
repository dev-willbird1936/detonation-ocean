# Detonate runner (M4, M4b)

`run.sh` is the entrypoint of `detonation-ocean/detonate`. The controller passes the runner kind as the first argument
(`backend/detonation/stages.mjs`) and reads one JSON status line from the end of stdout (`backend/detonation/runner-result.mjs`).
Every container runs under the SPEC 6.3 flags and the `runsc-trace` runtime; the runner adds no privilege and no network.

| Kind | Tool | What it prints (besides the status keys) |
|---|---|---|
| `py` `sh` `node` | python3, bash, node | nothing: the sample runs for real; the syscall trace is the evidence |
| `ps1` | PowerShell 7.6.6 (`pwsh -File`); `ps1_static.py` scans the text first | `static.hits` |
| `html` `svg` `pdf` | `browser.mjs`: Playwright 1.64.0 + Chromium 1248 headless shell; `pdf_static.py` adds pdfid 0.2.10 and pdf-parser | `browser` (requests, downloads, dialogs, forms, screenshots) and `static` |
| `office` | `office.py`: olevba (oletools 0.60.2), then LibreOffice 7.4.7 headless | `office.olevba`, `office.libreoffice` |
| `exe` | `emulate.py`: Speakeasy 1.6.1, 30 s and 5 M instructions; the file never runs natively | `emulation` |
| `zip` `eml` | `unpack.py`: 7-Zip 26.04 (`7zz`) or python `email` | `unpack` (entries with name, size, first 32 KB) |
| `identify` | `identify.py`: pefile, LIEF, osslsigncode, dnfile; unwraps UPX (`upx -d`), Inno Setup (innoextract), NSIS and self-extracting archives (7zz), PyInstaller (pyinstxtractor) in the same container | `identify`, `unwrap`, `dotnet` |
| `unwrap --method asar\|msi\|7z` | `unwrap.py`: `@electron/asar extract`, 7zz | `unpack` |
| `static --format pe` | `static.py`: capa 9.4.0 (22 s limit, rule cache built into the image, no FLIRT signatures) and YARA with signature-base | `static.capa`, `static.yara` |
| `generic` | `generic.py`: strings, entropy, binwalk 3.1.0, YARA; the first 4 KB come back as base64 for the model-written parser | `generic` |

The `identify`, `unwrap`, `static` and `generic` kinds run in `/opt/static-venv` (LIEF, dnfile, pefile, yara-python); Speakeasy stays in `/opt/venv`.
The controller starts one container per step of the compatibility chain (`backend/detonation/chain.mjs`), each with its own 30 s wall clock.
`wine_run.py`, `wine_evidence.py` and `wine_prefix.sh` belong to the separate `detonation-ocean/wine` image (`Dockerfile.wine`, runc, seccomp-wine.json) and are removed from this one.

`extract-msg` 0.56.1 is installed for `.msg`; no runner kind uses it yet (`filetype.mjs` does not route `.msg`).

## Rules the runner keeps

- Tool scratch (Chromium profile, LibreOffice profile, .NET temp files) is `/tmp/dt`, never the home volume, so it stays out of the
  file diff. `trace.mjs` treats `/tmp/dt` as noise. Known gap: a macro that writes under `/tmp/dt` is not seen by the trace, and the
  diff covers only the home volume.
- Only `py`, `sh` and `js` copies of the sample are skipped by the collector's `RUNNER_COPY` list. Scripts, Office files, html, svg
  and pdf are copied to `~/Downloads/sample.<ext>` (not executable, not an archive name, so the diff reads them as plain new files).
  `exe`, `zip`, `eml` and every child are copied to `/tmp/dt/sample.<ext>`: a PE, an ELF or a `.zip` added to the home volume reads as
  a second stage or a staged archive.
- Unpacked children are stored gzipped as `~/Downloads/.unpacked/<item>/<n>.dat` for the same reason. A child runs with
  `--from <that file> --ext <ext>`; the runner gunzips it to `/tmp/dt/sample.<ext>` (limit 64 MB).
- The synthetic credential typed into every password form is `dana@example.invalid` / `CorrectHorse-<canary>`; the canary arrives
  as `--canary`. A form counts as submitted only if that password appears in a recorded request.

## Chromium, gVisor and the `nproc=128` cap

- **`--no-sandbox` is on, and it is acceptable only because gVisor is the boundary.** Chromium's own sandbox needs user namespaces or
  a setuid helper; the container has `--cap-drop ALL`, `no-new-privileges` and no namespaces to give. Playwright adds `--no-sandbox`
  itself (`chromiumSandbox` defaults to false). Renderer isolation inside the page is therefore off; the `runsc-trace` sandbox, the
  read-only root, the dropped capabilities, no network and the non-root user are what contain a page that escapes the renderer.
- **Headless shell, not full Chromium.** Measured under `runsc` with `--ulimit nproc=128:128`: full Chromium (`--headless=new`)
  peaked at 103 to 125 tasks and logged `pthread_create: Resource temporarily unavailable` 14 times in one start; the headless shell
  peaked at about 70 and logged none. Peaks under `runsc-trace` with the final flags (tasks counted from `/proc`, which includes the counting
  loop): Chromium harness 76, LibreOffice `--convert-to pdf` 11, PowerShell 19. None hit `EAGAIN`, so **`nproc` stays 128** and
  `verifyIsolation` and SPEC 6.3 are unchanged. The shell has no PDF viewer: a PDF is loaded (the harness records a download of the
  sample itself, which the mapper drops) but not rendered; pdfid and pdf-parser are the PDF evidence.
- Timing under `runsc-trace` (strace logging): the harness takes about 11 s on a warm host (Chromium launch 2 to 7 s); the first
  run after the host's file cache is cold can take much longer, and then the browser stops at the harness' 25 s limit
  (`browser-timeout`, which gives `incomplete`). LibreOffice takes 5 to 20 s to open a small document; its limit is 24 s. Speakeasy
  takes about 1 s for a small program.
- Screenshots are taken at 2 s and 10 s after the harness starts, and at exit. Only their size and SHA-256 are in the result;
  exporting the images to the report needs an artifact channel and is not built.

## What the emulator and LibreOffice do not show

- Speakeasy 1.6.1 logs `create_key` but not registry value writes; a Run-key value set on an existing key is an `api-call` only.
- LibreOffice runs the VBA it can run when it opens the document (macro security Low, VBA load and executable code on). Calls it
  cannot run are not reported to the controller. File effects show in the file diff; processes a macro starts show in the trace.
  Whether an auto-exec macro actually ran is not reported separately; olevba reports that one exists.
- Qiling, Wine, box-js, ViperMonkey, capa, DIE, ILSpy and msitools are not in this image (TOOLS.md "Decisions taken").

## Pins

| Part | Pin |
|---|---|
| Base images | `debian:bookworm-slim@sha256:7c7b2c96…`, `node:22-bookworm-slim@sha256:c3de60bf…` |
| PowerShell | 7.6.6 tarball, SHA-256 `ddbc4a2d…` |
| 7-Zip | 26.04 `7z2604-linux-x64.tar.xz`, SHA-256 `fc0327ba…` |
| pdfid, pdf-parser | DidierStevensSuite commit `b248e9aa…` (20260923a), SHA-256 `e958a01f…`, `a9fa2faa…` |
| Speakeasy | 1.6.1, commit `35b6600b…`, source archive SHA-256 `c311bcee…` (PyPI 1.5.11 is from 2022) |
| Python packages | `requirements.txt` (exact versions) |
| Playwright | `package-lock.json` (playwright-core 1.64.0, integrity hash) |
| LibreOffice | `4:7.4.7-1+deb12u14` (Debian 12) |

The image needs working DNS at build time. Where Docker's bridge DNS is broken (WSL), build with `docker build --network host`.
