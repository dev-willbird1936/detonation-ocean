# Demo samples

Written for this project (docs/SPEC.md section 11). Every file is harmless and carries the header "Demo sample for Detonation Ocean. Refuses to run outside the sandbox." Anything that can act refuses to run unless `DETONATION_SANDBOX=1` and the seeded Documents folder exist (`/home/dana/Documents`, or `C:\Users\Dana\Documents` under Wine). Static files that cannot read the environment (PDF, HTML, SVG, EML) are inert instead. **None of these files has been run by the people or tools that wrote them; they are only built and statically checked.**

## Scripts and documents (committed as text or built by a script)

| File | What it is | Expected verdict | Acceptance test |
|---|---|---|---|
| `clean-chart.py` | Reads a seeded CSV, prints a summary | Sunlight, snake eel | AT-8 |
| `obfuscated-hello.ps1` | Base64 harmless command | Twilight (`obfuscated`), torpedo ray | |
| `invoice.py` | Containment moment: credential theft, ransom note, fork bomb, `rm -rf /` | Trench, Jörmungandr | AT-3, AT-5, AT-6 |
| `persist-autostart.py` | Writes a desktop autostart entry that relaunches itself | Abyss, tripod fish (`persistence`) | Local demo recording |
| `invoice.pdf.html` | Fake login page posting to a `.invalid` host | Midnight (`fake-login`, `exfil-attempt`), also `type-mismatch` | AT-14 |
| `bundle.zip` | `clean-chart.py` and `obfuscated-hello.ps1` | Twilight, pufferfish | |
| `loop.js` | Infinite loop | Twilight (`incomplete`), jack | AT-2 |
| `report.pdf` | PDF with an `/OpenAction` that runs `app.alert("hello")` | Twilight: `pdfid` finds `/OpenAction`, `/JS`, `/JavaScript`; exploit document, harm unproven | M4 |
| `budget.docm` | Word document with an `AutoOpen` VBA macro that writes `Documents/macro-note.txt` when the guard passes | Twilight: `oletools` finds an auto-exec macro that opens a file; harm unproven. Under LibreOffice the macro runs and the note shows in the diff | M4, M4b |
| `hello.html` | Static page; one script changes the heading text | Sunlight | M4 |
| `badge.svg` | Static image, no script | Sunlight | M4 |
| `notice.eml` | Text body plus a `bundle.zip` attachment holding `clean-chart.py` | Sunlight when the unpacked attachment's run completes; Twilight if only inspected | M4 |
| `hello.vbs` | Guarded; writes `Documents\hello-vbs.txt` | Sunlight under `wine wscript`; file in the diff | M4 |
| `hello.bat` | Guarded; writes `Documents\hello-bat.txt` | Sunlight under `wine cmd /c`; file in the diff | M4 |

AT-13 uses a zip bomb that `node tools/make-samples.mjs --bomb <dir inside the OS temp directory>` writes outside the repository.

## Test binaries (`bin/`, built from `src/`)

| File | Source | Expected verdict | Acceptance test |
|---|---|---|---|
| `bin/runkey.exe` | `src/runkey.c` | Writes `HKCU\...\Run\DemoSample` (its own path) and `Documents\demo-note.txt`, shows a window titled "Detonation Ocean demo" for 5 s. Abyss (`persistence`), barracuda; label "Ran under Wine"; screenshot shows the window | AT-22 |
| `bin/runkey-upx.exe` | `runkey.exe` packed with `upx --best` | `upx -d` restores `runkey.exe`; the coverage list shows the unpack and the emulation. Same verdict as `runkey.exe` | AT-19 |
| `bin/setup-demo.exe` | `src/setup-demo.iss` (Inno Setup 6.3.3), wraps `runkey.exe` | Unwrapped with `innoextract`; the payload `runkey.exe` and the `[Run]` entry are analysed as a child item | AT-20 |
| `bin/needs-unimplemented.exe` | `src/needs-unimplemented.c` | Fails under Wine within 2 s; the chain moves on to Speakeasy; the coverage list shows both. Twilight (`incomplete`) if the emulator also stops early | AT-23 |
| `bin/wine-check.exe` | `src/wine-check.c` | Reads `HKCU\Software\Wine` and exits. Twilight with the `anti-analysis` signal | AT-24 |

All five carry the guard (`GetEnvironmentVariable("DETONATION_SANDBOX") == "1"` and an existing `%USERPROFILE%\Documents`; the installer checks the same in its `InitializeSetup`). None imports a networking DLL.

### Why `needs-unimplemented.exe` imports `PssCaptureSnapshot`

`PssCaptureSnapshot` (process snapshots, `processsnapshot.h`) is a documented kernel32 function on Windows 8.1 and later. A static scan of the export tables of all 694 builtin DLLs in Debian's Wine 8.0 (`8.0~repack-4`, x86-64) found no DLL that exports it, so the import cannot be resolved under Wine. The program imports it by name, so Wine fails at load or at the first call, well inside 2 s. On real Windows it takes one snapshot and exits. This is a static finding: the program has not been run under Wine, so the exact Wine message (`err:module:import_dll` or `Call from ... to unimplemented function`) is unconfirmed until AT-23 runs.

## How the files are built

| Command | Writes |
|---|---|
| `node tools/make-samples.mjs` | `bundle.zip`, `report.pdf`, `notice.eml` |
| `python tools/make-office-sample.py` | `budget.docm`, from `src/DemoMacro.bas`; Python standard library only |
| `bash tools/build-test-binaries.sh` (where Docker runs) | `bin/*.exe`, from `src/`; images from `deploy/detonation/Dockerfile.builder`, build containers run with `--network none` |

Rebuilding gives byte-identical `report.pdf`, `notice.eml`, `budget.docm`, `runkey.exe`, `runkey-upx.exe`, `wine-check.exe` and `needs-unimplemented.exe` (checked by building twice). `setup-demo.exe` differs between builds because Inno Setup embeds a build time.

### `budget.docm`

`vbaProject.bin` is written by `tools/make-office-sample.py` itself (MS-CFB compound file and MS-OVBA project streams); no third-party VBA writer was used. The macro source is stored without a performance cache, so the VBA engine compiles it on first use. Checked: the compound file opens with `olefile`, the `dir` stream parses record by record, the module streams decompress to the exact source in `src/DemoMacro.bas`, and the `CMG`/`DPB`/`GC` protection fields decrypt back to their inputs (`tests/detonation-samples-m4.test.mjs` repeats the stream and source check). **Not checked:** opening the file in Microsoft Word or LibreOffice, and running `olevba` (the `oletools` package is not in Debian, and nothing outside Debian packages was downloaded). If Word reports a corrupt project, build `vbaProject.bin` with a third-party writer in the builder image instead.

### Build images

`Dockerfile.builder` has two targets. Debian 12 has no `upx-ucl` package, so `compile` (mingw-w64 and `upx-ucl`) is Debian 13 `trixie-slim`; `installer` stays on Debian 12 `bookworm-slim` to carry Wine 8.0 and the Inno Setup 6.3.3 compiler. The installer comes from the official GitHub release `is-6_3_3` of `jrsoftware/issrc` and is checked against the release's published SHA-256 (`0bcb2a40…93c95e6`) at image build. The compiler runs under Wine to build the installer; it never runs a built binary.
