# Detonation tool licences and maintenance

Checked 2026-10-07 for SPEC §14 items 3, 10, 12 and 13. Sources and evidence: [REPORT.md](../../docs/evidence/licence-check/REPORT.md).

- **Maintained:** a commit or release on or after 2025-10-07 (12 months before this check).
- **Ship:** permissive licence, maintained, no extra condition.
- **Ship-with-note:** may ship once the conditions in the Docker column are met.
- **Fall back to Inspect:** drop the run or emulate role and keep static inspection only (SPEC §6.5, "Inspect-only"). This reading of "Inspect" is an assumption; see decision 1.
- **Unverified:** not confirmed from source. A tool with an unverified licence or maintenance state does not ship.
- Versions are the latest upstream seen on 2026-10-07. No pins are chosen yet (decision 8).
- Tags: [3] SPEC §6.1 image tool, [6.6] compatibility tool, [10] SPEC §14 item 10, [12] item 12, [13] item 13.

| Tool | Upstream URL | Licence (SPDX) | Latest release | Last commit | Maintained | Docker redistribution | Verdict |
|---|---|---|---|---|---|---|---|
| [3] Speakeasy | https://github.com/mandiant/speakeasy | MIT | v1.6.1 (2025-02-19); beta v2.0.0b8 (2026-09-15); PyPI speakeasy-emulator 1.5.11 (2022-06-08) | 2026-10-07 | Yes | Yes, with MIT notice. Pin a version (PyPI build is from 2022). Repo holds four decoy PE files (provenance unverified). Needs Unicorn (see the Unicorn row). | ship-with-note |
| [3] ViperMonkey | https://github.com/decalage2/ViperMonkey | BSD-2-Clause | No GitHub release; not on PyPI | 2024-04-25 | No | Yes, with BSD notice; `thirdparty/` keeps its own licences | fall back to Inspect (unmaintained since 2024-04-25) |
| [3] box-js | https://github.com/CapacitorSet/box-js | MIT | npm 1.9.29 (2026-07-02); GitHub tag v1.9.7 (2017-10-11) | 2026-07-02 | Yes | Yes, with MIT notice. npm dependency licences not audited. | ship-with-note |
| [3] capa | https://github.com/mandiant/capa | Apache-2.0 | v9.4.0 (2026-04-01) | 2026-10-06 | Yes | Yes, with Apache-2.0 notice | ship |
| [3] capa-rules | https://github.com/mandiant/capa-rules | Apache-2.0 | v9.4.0 (2026-04-01) | 2026-09-08 | Yes | Yes, with Apache-2.0 notice | ship |
| [3] oletools (olevba) | https://github.com/decalage2/oletools | BSD-2-Clause; MIT for officeparser code in olevba | v0.60.2 (2024-07-02) | 2026-01-26 | Yes (commits; no release since 2024) | Yes; keep LICENSE.md | ship |
| [3] rtfobj (in oletools) | https://github.com/decalage2/oletools (oletools/rtfobj.py) | BSD-style (per-file header) | With oletools v0.60.2 (2024-07-02) | 2026-01-26 | Yes | Yes; keep the file header | ship |
| [3] pdfid, pdf-parser | https://github.com/DidierStevens/DidierStevensSuite | Public domain by author statement in source headers (no SPDX id). pdf-parser.py includes an MIT-style notice (Yusuke Shinyama). | No releases; dated commit 20260923a | 2026-09-23 | Yes | Yes; keep the MIT notice in pdf-parser.py | ship-with-note |
| [6.6] pefile | https://github.com/erocarrera/pefile | MIT | 2024.8.26 (2024-08-26) | 2026-10-06 | Yes | Yes, with MIT notice | ship |
| [6.6] LIEF | https://github.com/lief-project/LIEF | Apache-2.0 | 1.0.0 (2026-07-12) | 2026-10-04 | Yes | Yes, with Apache-2.0 notice | ship |
| [3] LnkParse3 | https://github.com/Matmaus/LnkParse3 | MIT | v1.6.0 (2026-02-27) | 2026-02-27 | Yes | Yes, with MIT notice | ship |
| [3] extract-msg | https://github.com/TeamMsgExtractor/msg-extractor | GPL-3.0 | v0.56.1 (2026-08-14) | 2026-09-24 | Yes | Conditions: include the GPL-3.0 text and offer source | ship-with-note |
| [3] Playwright and Chromium | https://github.com/microsoft/playwright | Apache-2.0 (Playwright); Chromium BSD-style | v1.64.0 (2026-10-07); PyPI 1.63.0 (2026-09-15) | 2026-10-07 | Yes | Conditions: Apache notice; pin Playwright and its Chromium build; keep Chromium third-party notices (list not read) | ship-with-note |
| [3] PowerShell 7 | https://github.com/PowerShell/PowerShell | MIT | v7.6.6 (2026-09-08); preview v7.7.0-preview.5 (2026-09-23) | 2026-10-07 | Yes | Yes, with MIT notice | ship |
| [3] OpenJDK | https://github.com/openjdk/jdk | GPL-2.0 with Classpath exception | Mainline tag jdk-28+18 (2026-10-01); stable line not chosen | 2026-10-07 | Yes | Conditions: GPL-2.0 text and source offer; choose the JDK line (decision 8) | ship-with-note |
| [3] 7-Zip | https://github.com/ip7z/7zip | LGPL with unRAR restriction; BSD-3-Clause for some files | 26.04 (2026-10-06) | 2026-10-06 | Yes | Conditions: LGPL source offer; the unRAR restriction bars using the code to rebuild a RAR encoder | ship-with-note |
| [3] p7zip | https://github.com/p7zip-project/p7zip | LGPL with unRAR restriction; BSD-3-Clause and public-domain files (License.txt) | v17.06 (2024-10-17) | 2025-05-20 | No | Not used; 7-Zip replaces it | fall back to Inspect (replaced by 7-Zip) |
| [3] XLMMacroDeobfuscator | https://github.com/DissectMalware/XLMMacroDeobfuscator | Apache-2.0 | v0.2.7 (2022-09-21) | 2022-08-10 | No | Yes, with Apache-2.0 notice | fall back to Inspect (unmaintained since 2022-08-10) |
| [3] Xvfb (X.Org xserver) | https://gitlab.freedesktop.org/xorg/xserver | MIT/X11 notice plus other notices in COPYING | Snapshot tag xorg-server-26.0.99.903 (2026-10-06) | 2026-10-06 | Yes | Conditions: keep COPYING notices | ship-with-note |
| [12] Wine | https://gitlab.winehq.org/wine/wine | LGPL-2.1 (COPYING.LIB; "or later" not checked) | wine-11.19 (2026-10-02) | 2026-10-07 | Yes | Conditions: LGPL source offer. Prefix uses Wine's own DLLs only; no Microsoft redistributables (decision 4) | ship-with-note |
| [12] Wine Mono | https://github.com/wine-mono/wine-mono | Mixed: MIT X11 and LGPL for most; GPL with exception (SharpZipLib); MSPL (FNA parts) | wine-mono-11.3.0 (2026-08-17); not installed in the M4b wine image (size) | 2026-10-06 | Yes | Conditions: ship COPYING; check whether the GPL and MSPL parts are in the built package (not checked) | ship-with-note |
| [12] LibreOffice | https://github.com/LibreOffice/core | MPL-2.0 (official licence page). Repo root COPYING is the GPL-3.0 text. | libreoffice-26.8.1.1 (2026-09-16) | 2026-10-07 | Yes | Conditions: MPL-2.0 notices and source for MPL files; third-party components not listed | ship-with-note |
| [3] Node.js (§6.1 base) | https://github.com/nodejs/node | MIT (LICENSE includes bundled third-party notices) | v26.11.0 (2026-10-07); 22.x line not checked | 2026-10-07 | Yes | Yes; ship the full LICENSE; use upstream 22.x (Debian bookworm has 18.20.4) | ship |
| [3] Python 3 (§6.1 base) | https://github.com/python/cpython | PSF-2.0 (some parts also 0BSD) | v3.15.0rc3 pre-release (2026-10-02); stable line not checked | 2026-10-07 | Yes | Yes, with PSF notice | ship |
| [10] Detect It Easy (diec) | https://github.com/horsicq/DIE-engine (numbered releases); https://github.com/horsicq/Detect-It-Easy (repo; db releases) | MIT (both LICENSE files) | DIE-engine 3.21 (2026-04-21) | 2026-10-07 | Yes | Conditions: MIT notice. Blocked until the Qt dependency and db licence are verified. | ship-with-note (blocked) |
| [10] innoextract | https://github.com/dscharrer/innoextract | zlib | 1.9 (2020-08-09); the image builds git `6e9e34e` (2025-02-06), which reads Inno Setup up to 6.3.3 (1.9 stops at 6.0.5) | 2025-02-06 | No | Yes, with zlib notice | fall back to Inspect (unmaintained since 2025-02-06) |
| [10] UPX | https://github.com/upx/upx | GPL-2.0 with UPX special exception for compressed executables | v5.2.1 (2026-08-27) | 2026-10-06 | Yes | Conditions: GPL-2.0 text and source offer; the exception covers executables compressed with UPX | ship-with-note |
| [10][6.6] msitools | https://gitlab.gnome.org/GNOME/msitools | LGPL-2.1-or-later (Debian copyright; upstream COPYING not read). Debian also lists GPL-2+ and GPL-3+ build helpers. | v0.106 (2025-03-20) | 2026-09-11 | Yes | Conditions: LGPL source offer; licence taken from Debian's copyright file | ship-with-note |
| [10][6.6] osslsigncode | https://github.com/mtrojnar/osslsigncode | GPL-3.0-or-later with OpenSSL linking exception | 2.14 (2026-07-20) | 2026-09-30 | Yes | Conditions: GPL-3.0 text and source offer; keep the OpenSSL exception | ship-with-note |
| [10] cabextract | https://www.cabextract.org.uk/ | GPL (version not stated on site) | 1.11 (2023-02-24) | Not checked | No (last release over 12 months ago; no commit date found) | Not shipped; SPEC §6.6 already lists 7z for CAB (confirm 7-Zip covers the CAB files needed) | fall back to Inspect |
| [10][6.6] pyinstxtractor | https://github.com/extremecoders-re/pyinstxtractor | GPL-3.0 | 2026.07 (2026-07-22) | 2026-07-03 | Yes | Conditions: GPL-3.0 text and source offer. Use this or pyinstxtractor-ng, not both. | ship-with-note |
| [10] pyinstxtractor-ng | https://github.com/pyinstxtractor/pyinstxtractor-ng | GPL-3.0 (LICENSE); depends on xdis 6.3.0 (GPL-2.0 per PyPI and COPYING) | PyPI 2026.7.3 (2026-07-03) | Not checked | Yes (PyPI release) | Blocked: a GPL-2.0 dependency in a GPL-3.0 tool needs a licence decision; xdis version clause not checked | fall back to Inspect (pending decision 10; use pyinstxtractor) |
| [10][6.6] asar (@electron/asar) | https://github.com/electron/asar | MIT | 4.3.1 (2026-09-26) | 2026-10-07 | Yes | Yes, with MIT notice | ship |
| [10][6.6] ILSpy and ilspycmd | https://github.com/icsharpcode/ILSpy | MIT | ILSpy 11.1 (2026-10-07); ilspycmd NuGet 11.1.0.9782 | 2026-10-07 | Yes | Conditions: MIT notice. Not checked: NuGet licence expression and the .NET runtime licence. | ship-with-note |
| [10][6.6] dnfile | https://github.com/malwarefrank/dnfile | MIT | v0.18.0 (2026-01-31) | 2026-07-26 | Yes | Yes, with MIT notice | ship |
| [10][6.6] Qiling | https://github.com/qilingframework/qiling | GPL-2.0 | v1.4.11 (2026-09-06); PyPI 1.4.6 (2023-08-04) | 2026-09-05 | Yes | Package: GPL-2.0 source offer. No shippable Windows or Mach-O rootfs: PE needs Windows DLLs (none in the rootfs repo; Microsoft DLLs cannot be redistributed); the Mach-O rootfs holds Apple system binaries. | fall back to Inspect (PE and Mach-O roles; decision 3) |
| [10] Unicorn (dependency of Speakeasy and Qiling) | https://github.com/unicorn-engine/unicorn | GPL-2.0 (COPYING); PyPI says BSD for bindings | v2.1.4 (2025-09-11) | 2026-02-17 | Yes | Conditions: GPL-2.0 text and source offer; engine/binding split not verified | ship-with-note |
| [10] YARA | https://github.com/VirusTotal/yara | BSD-3-Clause | v4.5.8 (2026-07-28) | 2026-09-23 | Yes | Yes, with BSD notice | ship |
| [10] YARA-Forge rule packages | https://yarahq.github.io/ (packages); tool: https://github.com/YARAHQ/yara-forge | Tool: GPL-3.0. Rules carry per-source licences; the site's example header lists Elastic License 2.0. | Release 20261004 (2026-10-04) | 2026-10-03 | Yes (tool) | Not as a bundle: mixed per-source licences, Elastic License 2.0 among the sources, and some sources undecided per the site. Package files not downloaded. | fall back to Inspect (bundle; decision 5) |
| [10] signature-base | https://github.com/Neo23x0/signature-base | DRL 1.1 (rules; a rule may name another licence in its meta) | No release since v2.0 (2021-08-03, CC BY-NC); DRL since 2021-08-13 | 2026-09-08 | Yes | Conditions: keep author attribution, a link to the rule set and the DRL text; drop rules whose meta licence differs; never use v2.0 or earlier | ship-with-note |
| [10] binwalk (v3) | https://github.com/ReFirmLabs/binwalk | MIT | v3.1.0 (2024-10-31); PyPI 2.1.0 (2015, licence UNKNOWN); Debian bookworm 2.3.4 (v2) | 2026-08-11 | Yes | Yes, with MIT notice. Use v3 only; the PyPI and Debian builds are old. | ship-with-note |
| [6.6] androguard | https://github.com/androguard/androguard | Apache-2.0 | v4.1.4 (2026-06-05) | 2026-10-03 | Yes | Yes, with Apache-2.0 notice. PyPI classifier conflicts; the LICENCE file governs. | ship |
| [6.6] CFR | https://github.com/leibnitz27/cfr | MIT | 0.152 (2021-12-11) | 2026-06-04 | Yes | Yes, with MIT notice | ship |
| [6.6] pyOneNote | https://github.com/DissectMalware/pyOneNote | Apache-2.0 (LICENSE file on main) | PyPI 0.0.2 (2023-03-19) | 2023-03-19 | No | Yes, with Apache-2.0 notice | fall back to Inspect (unmaintained since 2023-03-19) |
| [13] Win11React code | https://github.com/blueedgetechno/win11React | CC0-1.0 | Win11inReact v0.2.9 (2022-06-09) | 2024-08-11 | No (upstream dormant; this repo's copy is maintained locally) | Yes, for code (CC0-1.0) | ship-with-note (code only) |
| [13] Win11React artwork (public/img: icons, wallpapers, logos) | https://github.com/blueedgetechno/win11React/tree/master/public/img | No artwork licence in the repo. Upstream says it is not affiliated with Microsoft. | — | 2024-08-11 | No | Not cleared. Includes icons named after Microsoft products (Cortana, Defender, Edge, Excel) and Windows-style wallpapers. CC0 on the code does not cover them. | fall back (replace artwork before public deployment; decision 6) |
| [13] Font Awesome (if its icons are used) | https://github.com/FortAwesome/Font-Awesome | Icons CC BY 4.0; fonts SIL OFL 1.1 (6.x LICENSE.txt read; 7.x not read) | 7.3.1 (2026-07-15) | 2025-08-21 (6.x branch) | Yes (releases) | Yes, with CC BY 4.0 attribution. Read the 7.x licence before pinning. | ship-with-note |

## Decisions needed

1. Confirm that "fall back to Inspect" means static inspection only, with no run or emulate role (SPEC §6.5). This check assumed it.
2. Approve the fall-backs: ViperMonkey, XLMMacroDeobfuscator, pyOneNote, innoextract, cabextract, p7zip (7-Zip replaces it), pyinstxtractor-ng (see 10), Qiling for PE and Mach-O, and the YARA-Forge bundle.
3. Qiling PE and Mach-O: the image cannot carry Windows DLLs or the Apple system files in the test rootfs. Confirm dropping both roles (SPEC §6.6 allows "skip Qiling for PE").
4. Wine prefix: approve "Wine's own DLLs only, no Microsoft redistributables". Any winetricks step that downloads Microsoft components needs its own licence check first.
5. YARA rules: ship signature-base under DRL 1.1 with attribution. Decide whether to add a YARA-Forge subset after checking each source licence in the package files. Elastic License 2.0 sources stay out.
6. Win11React artwork (SPEC §14 item 13): remove or replace the Microsoft-branded icons and wallpapers in `public/img` and in the win11-final build, or obtain written rights, before public deployment. The CC0 code is fine.
7. Source-offer policy: the image carries GPL-2.0, GPL-3.0, LGPL, MPL-2.0 and BSD-style components (Unicorn, UPX, Qiling, extract-msg, pyinstxtractor, osslsigncode, Wine, 7-Zip, msitools, LibreOffice, OpenJDK). Approve shipping licence texts and pinned source URLs in the image.
8. Version pins: Debian bookworm is well behind upstream (Wine 8.0, LibreOffice 7.4.7, Node 18.20.4, binwalk 2.3.4, yara 4.2.3, osslsigncode 2.5, OpenJDK 17.0.20.1, xorg-server 21.1.7). Approve building pinned upstream releases with hashes, or pinning Debian versions.
9. Speakeasy version: stable 1.6.1, beta 2.0.0b8, or PyPI 1.5.11 (2022). Pick one and pin it.
10. Blocked until checked: DIE's Qt and db licences; xdis version clause (decides pyinstxtractor-ng); ILSpy's NuGet licence and the .NET runtime; box-js npm dependencies; msitools upstream COPYING; Qiling rootfs repo licence; Font Awesome 7.x licence.

## Decisions taken (orchestrator, 2026-10-08)

1. "Fall back to Inspect" means static inspection only: no run or emulate role.
2. Approved fall-backs: ViperMonkey, XLMMacroDeobfuscator, pyOneNote, p7zip (7-Zip replaces it), pyinstxtractor-ng (use pyinstxtractor), cabextract (7-Zip covers CAB), YARA-Forge bundle. **Not** innoextract: it is a parser that runs only inside the sandbox, has no maintained replacement, and AT-20 needs it; ship it with a "stale upstream" note.
3. Qiling is not shipped. No redistributable Windows DLLs or Apple system files exist for its PE and Mach-O roles, and ELF runs for real. Mach-O stays inspect-only.
4. Wine prefix: Wine's own DLLs only; Wine Mono is not installed because its prefix copy exceeds the prefix tmpfs, and .NET assemblies are analysed statically. No winetricks downloads of Microsoft components.
5. YARA: signature-base only (DRL 1.1, attribution in `THIRD-PARTY.md`). No YARA-Forge subset in v1.
6. Win11React artwork: replaced or withheld before public deployment (SPEC §15.2). Until then production serves the project desktop.
7. Source-offer requirement: released images must include licence texts and exact corresponding-source references under `/usr/share/doc/detonation-ocean/`. The current recipes include selected notices, not yet a complete per-image compliance bundle.
8. Pinning requirement: Debian bookworm package versions should be pinned for the hackathon build. Current recipes still leave some support packages unversioned; Python artifact-hash locks, analyse transitives and browser-download verification also remain incomplete. Do not describe the current build as fully hash-pinned or reproducible.
9. Speakeasy: stable 1.6.1, pinned.
10. Items still unchecked (DIE Qt/db licences, xdis, ILSpy NuGet and .NET runtime, box-js npm dependencies, msitools COPYING) stay out of the image until checked.
