# Detonation evidence schema

The one input to the rule engine ([`backend/detonation/findings.mjs`](../../backend/detonation/findings.mjs), [SPEC §6.5](../SPEC.md#65-rule-engine-r-g3)). Every producer (syscall-trace parser, collector, emulator adapters, browser harness, static tools, identify step, limits reader, Wine registry diff) writes items in this shape. The engine never reads `detail` and never consults a model, so the verdict is a function of the structured fields only (AT-12).

## Item

```json
{"id": "ev-7", "source": "trace", "kind": "file-read", "detail": "read /home/dana/.aws/credentials", "at": "2026-01-01T00:00:07.000Z", "path": "/home/dana/.aws/credentials"}
```

| Field | Rule |
|---|---|
| `id` | Unique within the job (`ev-<n>`). Findings cite items by `id` |
| `source` | `trace` `diff` `emulator` `browser` `static` `limits` `registry` `wine` `identify` |
| `kind` | One of the kinds below. Rules match on `kind`, not `source`, so an emulator may emit `file-read` or `connect` exactly like the trace |
| `detail` | Human text for the report. **Never read by the engine** |
| `at` | ISO 8601 UTC. The list is sorted by `at`; order-dependent rules (clipboard swap, download then run) use list order |
| `item` | Optional. Index of the child item (a file unpacked from an archive or an email) that produced the item; absent for the uploaded file itself ([below](#child-items-and-coverage-m4)) |
| other fields | The structured fields of the kind. Unknown fields are ignored |

## Paths

Absolute. The engine maps `C:\Users\Dana\…` to `/home/dana/…` and `\` to `/`, so Wine and emulator paths match the Linux seed. System paths are `/bin`, `/etc`, `/usr` and `C:\Windows`.

## Kinds

### `trace` (gVisor syscall trace; the emulator may emit the same kinds)

| Kind | Fields | Used by |
|---|---|---|
| `file-read` | `path` | steal-credentials, steal-browser, steal-documents |
| `file-write` | `path` | steal-documents, persistence, traffic-redirect, browser-hijack |
| `unlink` | `path`, `self?` (true when it deletes the sample) | system-wipe, defence-tamper (`/var/log`), anti-analysis |
| `rmdir` | `path` | system-wipe |
| `rename` | `from`, `to` | persistence, traffic-redirect, browser-hijack (by `to`) |
| `execve` | `path`, `argv[]` | persistence, defence-tamper, destroy-files (backup or shadow-copy deletion), second-stage |
| `clone-eagain` | `count` (clone, clone3, fork or vfork calls that failed with errno 11 or 12), `created` (successful calls of the same family, threads included, before the first failure) | resource-hijack (`count` sum ≥ 100, or `count` ≥ 1 with `created` sum ≥ 100) |
| `connect` | `host`, `port`, `payloadPreview`, `download?` (true for a fetch such as HTTP GET) | exfil-attempt, remote-control, resource-hijack (mining pool), second-stage, unknown-hosts |
| `sendto` | `host`, `port`, `payloadPreview` | exfil-attempt, remote-control, resource-hijack, unknown-hosts |
| `mail-send` | `host`, `recipients` | spread (sum ≥ 5) |
| `listen` | `port` | remote-control |
| `setuid` | `uid` | privilege-escalation |
| `capability` | `name` | privilege-escalation |
| `sleep` | `seconds` | anti-analysis (sum ≥ 20) |

### `diff` (collector, after the sample stops)

Kinds `added`, `changed`, `deleted`, `renamed`.

| Field | Meaning |
|---|---|
| `path` | Path in the seed volume (the old path for `renamed`) |
| `to` | New path (`renamed` only) |
| `seeded` | True only if the path is in the seed manifest. Only seeded files count as user data |
| `entropyBefore`, `entropyAfter` | Bits per byte; `null` when absent (added has no before, deleted no after) |
| `sizeBefore`, `sizeAfter` | Bytes; `null` when absent. `changed` with `sizeAfter` 0 is a truncation |
| `executable?` | `added` only: the new file is an executable (second-stage) |
| `copyOfSample?` | `added` only: the new file has the sample's SHA-256 (spread) |

### `emulator` (Speakeasy, Qiling, box-js, ViperMonkey, capa adapters)

| Kind | Fields | Used by |
|---|---|---|
| `api-call` | `api`, `args` (object), `count?` (default 1) | steal-credentials (`CredEnumerate*`, `CredRead*`, `LsaRetrievePrivateData`, `MiniDumpWriteDump`, or `lsass` in `args`), keylog (`SetWindowsHookEx*` with `args.idHook` `WH_KEYBOARD`/`WH_KEYBOARD_LL`/2/13, or `GetAsyncKeyState` ≥ 10 calls), capture (`PrintWindow`, `waveIn*`, `capCreateCaptureWindow*`, `MFCreateDeviceSource`, `BitBlt`/`StretchBlt` with `args.screen` true), clipboard-swap (`GetClipboardData` then `SetClipboardData`), privilege-escalation (`NtLoadDriver`, `ZwLoadDriver`, `CreateService*` with a driver `args.type`), persistence (`CreateService*`), defence-tamper (`ClearEventLog*`, `EvtClearLog`, `SetFileAttributes*` with `args.hidden` true), injection (`WriteProcessMemory`/`NtWriteVirtualMemory` plus `CreateRemoteThread*`/`NtCreateThreadEx`/`RtlCreateUserThread`/`QueueUserAPC`), second-stage (`URLDownloadToFile*` then `CreateProcess*`/`WinExec`/`ShellExecute*`) |
| `key-added`, `key-changed`, `key-deleted` | `hive`, `key`, `value` (value name), `data` | as in `registry` below |
| `dll-hijack` | `dll`, `path` | injection (DLL search-order hijack) |
| `emulation-stopped` | `reason` | incomplete |

Speakeasy items (`backend/detonation/emulator.mjs`): one `api-call` per API name, at its first call, with `count` and `args` as `arg0`, `arg1`, … plus the named arguments the rules read (`idHook`, `hidden`, `type`). File events map to `file-write` (create, write) and `file-read` (open, read); network events to `connect` (`download` when the request is a GET); `create_key` to `key-added`. Speakeasy 1.6.1 does not log registry value writes, so a value written to an existing key is an `api-call` only.

### `registry` (Wine `system.reg`/`user.reg` diff; the emulator emits the same kinds)

| Kind | Fields | Used by |
|---|---|---|
| `key-added`, `key-changed`, `key-deleted` | `hive` (`HKCU` `HKLM` `HKCR` `HKU`), `key`, `value`, `data` | persistence (Run/RunOnce/Winlogon/Services/TaskCache), privilege-escalation (UAC-bypass keys), traffic-redirect (proxy, DNS), browser-hijack (browser policies, start page), defence-tamper (Defender disable), other-harm (HKLM outside `Software\Wine`) |

### `browser` (Playwright harness)

| Kind | Fields | Used by |
|---|---|---|
| `form-submit` | `url`, `fields` (name to value), `typedCredential` (true when the harness typed the synthetic credential). Emitted only when the typed credential left the page in a recorded request, so a password form that posts nowhere is not a fake login | fake-login |
| `request-blocked` | `url`, `body` (every request except `file:` and `data:` is aborted; the body of a POST is kept to 1 KB) | exfil-attempt (canary), unknown-hosts |
| `download` | `url`, `filename` (the sample itself is not a download) | second-stage (download then run) |
| `phishing-indicator` | `indicator` (a password field whose typed credential went nowhere) | phishing-unproven |
| `dialog` | `dialogType`, `message` (`alert`, `confirm`, `prompt`, `beforeunload`; the harness dismisses it) | none (informational) |

### `wine` (`WINEDEBUG` log and prefix checks)

| Kind | Fields | Used by |
|---|---|---|
| `registry-read` | `hive`, `key` | anti-analysis (`HKCU\Software\Wine`) |
| `api-call` | `api`, `args` | anti-analysis (`wine_get_version`) |
| `file-check` | `path` | anti-analysis (Wine-only file probe) |
| `execve` | `path`, `argv[]` | child processes started, as for trace (Wine's own helper processes are left out) |
| `added`, `changed`, `deleted` | `path` (a `C:\\` path), `sizeBefore` (null), `sizeAfter`, `entropyAfter`, `executable`, `seeded` (false) | files the program changed in the Wine prefix outside the shell folders; files in `Documents`, `Downloads`, `Desktop` and `Pictures` land in the home volume and come from the collector |
| `screenshot` | `caption`, `artifact` (job artifact name `wine-i<item>-<2s\|10s\|exit>.png`), `image?` (a `data:` URL, only when the picture is under 30 KB) | none (shown in the report and the replay) |
| `emulation-stopped` | `reason` `wine-timeout` | incomplete (the program was still running at the 12 s limit) |

The registry diff (`registry` source) is computed inside the Wine container before it stops: a second start of the same prefix gives the `system.reg`/`user.reg` copies to compare against, so what Wine rewrites at every start is in both.

### `static` (oletools, pdfid, LnkParse3, pefile, capa, YARA, signature checks)

All have `indicator` (or `technique` / `tool`) text. Static evidence adds Twilight signals only.

| Kind | Fields | Signal |
|---|---|---|
| `exploit-indicator` | `indicator` | `exploit-unproven` |
| `phishing-indicator` | `indicator` | `phishing-unproven` |
| `anti-analysis` | `technique` | `anti-analysis` |
| `adware-indicator` | `indicator` | `adware` |
| `admin-request` | `indicator` | `admin-request` |
| `system-survey` | `indicator` | `system-survey` |
| `hidden-command` | `tool`, `commandPreview` | `hidden-commands` |
| `obfuscation` | `technique` | `obfuscated` |
| `unsigned` | `reason` | `unsigned` (also from `identify`) |
| `suspicious` | `indicator` | `other-suspicious` |

### `identify`

| Kind | Fields | Signal |
|---|---|---|
| `type-mismatch` | `detectedType`, `claimedExtension` | `type-mismatch` |
| `unsigned` | `reason` | `unsigned` |
| `unsupported-type` | `detectedType` | `incomplete` |

### `limits` (Docker and gVisor)

| Kind | Fields | Effect |
|---|---|---|
| `oom` | none | `incomplete`; never `resource-hijack` |
| `time` | none | `incomplete`; never `resource-hijack` |
| `pids` | `crash?` (true when the runsc sandbox itself crashed on process creation: `createSysmsgThread: failed to get clone`) | Informational unless `crash` is true; then `resource-hijack`. Without a crash, `resource-hijack` needs `clone-eagain` as above |

## Rule to evidence map

| Finding | Evidence |
|---|---|
| `steal-credentials` | `file-read` of `.aws/credentials`, `.ssh/id_*`, `.env`, `.electrum/wallets/*`, `AppData/Roaming/Microsoft/Credentials/*`; emulator credential or LSASS `api-call` |
| `steal-browser` | `file-read` of `…/Default/Login Data` or `Cookies` |
| `steal-documents` | ≥ 3 distinct `file-read` of seed-manifest files under `Documents`, plus a `file-write` or `added` of an archive (`.zip .7z .rar .tar .gz .tgz .bz2 .xz`) or a file under `/tmp`, `/var/tmp`, `/dev/shm` |
| `keylog`, `capture`, `clipboard-swap` | emulator `api-call` as listed |
| `fake-login` | `form-submit` with `typedCredential` true, or a canary token in `fields` |
| `exfil-attempt` | a canary token in `connect`/`sendto` `payloadPreview`, or `request-blocked` `url`/`body` |
| `privilege-escalation` | UAC-bypass `key-added`/`key-changed`, driver `api-call`, `setuid`, `capability` |
| `persistence` | Run/service/task `key-*`, `CreateService*`, writes under cron, systemd, init.d, autostart or Startup folders, `/etc/passwd`, `/etc/shadow`, or `execve` of `schtasks /create`, `crontab`, `systemctl enable`, `sc create`, `useradd`, `adduser`, `net user /add` |
| `defence-tamper` | `execve` stopping or killing a security tool, `wevtutil cl`, `Clear-EventLog`, `Set-MpPreference`, `attrib +h`; `unlink` under `/var/log`; log-clearing or hidden-attribute `api-call`; Defender-disable `key-*` |
| `traffic-redirect` | writes to `hosts`, `resolv.conf`, `resolved.conf`; proxy or DNS `key-*` |
| `browser-hijack` | writes under browser `extensions/`, `Preferences`, `Secure Preferences`, `prefs.js`, `user.js`, `policies.json`; browser policy or start-page `key-*` |
| `remote-control` | ≥ 3 `connect` to one host and port; `listen`; ≥ 10 distinct hosts in `connect`/`sendto` |
| `injection` | emulator write-memory plus remote-thread `api-call`; `dll-hijack` |
| `second-stage` | `added` with `executable` followed by `execve` of that path; or a download (`connect` with `download`, `download`, download `api-call`) followed by `execve` or a run `api-call` |
| `resource-hijack` | `clone-eagain` with `count` sum ≥ 100 (a bomb that keeps retrying) or with `count` ≥ 1 and `created` sum ≥ 100 (the sandbox reached its process cap and the program stopped at the first error); a `limits` `pids` item with `crash` true; mining-pool text (`stratum+`, `mining.subscribe`, `mining.authorize`) in `connect`/`sendto` `payloadPreview` |
| `system-wipe` | `unlink` or `rmdir` on a system path |
| `encrypt` | ≥ 3 seeded `changed` with `entropyAfter` ≥ 7.5 or seeded `renamed` with a new extension; or an `added` ransom-note file (name contains ransom, decrypt, recover/restore your files, how to decrypt/recover/restore) |
| `destroy-files` | ≥ 3 seeded `deleted` or truncated (`changed` with `sizeAfter` 0); `execve` of `vssadmin`, `wbadmin`, `wmic shadowcopy`, `bcdedit` deletion forms |
| `spread` | ≥ 3 distinct `added` with `copyOfSample`; `mail-send` `recipients` sum ≥ 5 |
| `other-harm` | seeded honey file `changed`/`deleted`/`renamed` (Midnight); HKLM `key-*` outside `Software\Wine` (Abyss); other seeded `changed`/`deleted`/`renamed` (Trench); only items that no other finding used |

| Twilight signal | Evidence |
|---|---|
| `exploit-unproven` | `exploit-indicator` |
| `phishing-unproven` | `phishing-indicator` |
| `anti-analysis` | `anti-analysis`; wine `registry-read` of `HKCU\Software\Wine`; `api-call` `wine_get_version`; wine `file-check`; `sleep` sum ≥ 20 s; `unlink` with `self` or of `/in/sample` |
| `type-mismatch` | `type-mismatch` |
| `adware` | `adware-indicator` |
| `admin-request` | `admin-request` |
| `unknown-hosts` | `connect`, `sendto` to a non-loopback host; `request-blocked` |
| `system-survey` | `system-survey` |
| `hidden-commands` | `hidden-command` |
| `obfuscated` | `obfuscation` |
| `unsigned` | `unsigned` |
| `incomplete` | engine input `complete` false, inspect-only path, `limits` `oom`/`time`, `emulation-stopped`, `unsupported-type` |
| `other-suspicious` | `suspicious` |

## Child items and coverage (M4)

Every upload is an **item**; an archive or an email adds one **child item** per entry or attachment (SPEC 5.3), and each child goes through its own detonate container. Caps over the whole job: 50 entries, 50 MB unpacked, ratio ≤ 100:1 per entry, archives nested at most 3 levels (the uploaded archive is level 1), 180 s. Evidence of a child carries `item` (its index; the upload is 0 and untagged). The verdict is one `evaluate` over every item's evidence, so its depth is the deepest finding of any child and its signals are the union. A cap that stops unpacking or running an item adds an `emulation-stopped` item, which gives the `incomplete` signal.

`emulation-stopped` `reason` values the controller adds: `unpack-entries`, `unpack-bytes`, `unpack-ratio`, `unpack-encrypted`, `unpack-error` (the unpacker, from the runner), `unpack-depth`, `unpack-limit`, `job-budget` (the pipeline refused to run a child), `browser-failed`, `browser-timeout`, `libreoffice-failed`, `libreoffice-timeout`, `olevba-failed`, `pdfid-failed`, `pdf-static-failed`, `emulator-failed`, `emulator-timeout`, `emulator-error <where>`, `runner-no-result`, `runner-invalid-result` (the runner omitted or malformed required metadata) and `trace-item-cap` (per-kind trace events were omitted). The M4b chain adds `job-budget` (a step no longer fitted in the 180 s job: Wine, emulation, static, generic or the parser), `unpack-depth` (for an executable nested more than three levels), `dotnet-static-only` (a .NET assembly is read with dnfile and not run), `wine-timeout`, `capa-failed`, `yara-failed`, `binwalk-failed`, `parser-failed` (three crashing parsers) and `parser-incomplete` (a parser reported the `incomplete` signal).

Static items added by the M4 runners (all `source` `static`): pdfid names `/JS /JavaScript /OpenAction /AA /Launch /EmbeddedFile /RichMedia /XFA` give `exploit-indicator`; olevba `AutoExec` rows give `exploit-indicator`, `Suspicious` and `IOC` rows `suspicious`, encoded-string rows `obfuscation`; PowerShell text hits give `obfuscation` (base64 decoding, encoded command, character-code strings), `hidden-command` (hidden window, execution-policy bypass) and `suspicious` (download cradle); a missing or malformed PowerShell static report gives `emulation-stopped` with reason `ps1-static-failed` and a failed static coverage step; an email link whose text names another host than its target, or that points at a bare address, gives `phishing-indicator`.

Static items added by the M4b chain ([SPEC §6.6](../SPEC.md#66-compatibility-r-t2); `backend/detonation/{identify,unwrap,static,wine,chain}.mjs`). All add Twilight signals only:

| Producer | Items |
|---|---|
| Identify (pefile, LIEF, osslsigncode) | `identify` `unsigned` for a missing or invalid Authenticode signature; `static` `obfuscation` for a packer name or a high-entropy code section |
| .NET (dnfile) | `emulation-stopped` `dotnet-static-only`; `suspicious` for P/Invoke imports such as `VirtualAlloc`; `obfuscation` when most names are unreadable |
| capa | A rule counts only when it says something on its own: `anti-analysis/packer` gives `obfuscation`, other `anti-analysis` gives `anti-analysis`, `host-interaction/uac` gives `admin-request`, OS-info rules give `system-survey`; `persistence`, `impact`, `c2`, `collection` and any other rule with an ATT&CK technique give `suspicious`. Rules such as "parse PE header" or "contain loop" give nothing |
| YARA (signature-base) | A rule that names an exploit or CVE gives `exploit-indicator`, a packer or obfuscator `obfuscation`, anything else `suspicious` (at most 10) |
| Generic (strings, entropy, binwalk) | `obfuscation` for near-random content; `suspicious` for an embedded executable or archive, a Run key in the text, or a Windows shell tool name |
| Model-written parser (AT-21) | One static item per Twilight signal id the parser reported (`exploit-unproven` gives `exploit-indicator`, `obfuscated` gives `obfuscation`, and so on); ids outside the Twilight list are dropped. `unknown-hosts` becomes `suspicious` because only a run can show a host |

The unwrap step lists its result in the coverage list, never a file name. Parts of a PyInstaller bundle or an Electron app are child items with `path` `inspect`: they are read by the generic step and never run, whatever their type. innoextract lists an installer's files only (its `[Run]` entries are not exposed), and reads Inno Setup up to 6.3.3: a newer installer is a `failed` unwrap step with `unpack-error`, which gives `incomplete`.

### Coverage events

`coverage` ([`EVENTS.md`](EVENTS.md)) is sent once per item that a runner handled, with the item's place in the tree:

```json
{"item": 2, "parent": 0, "steps": [{"step": "identify", "status": "done", "detail": "Identified as html: Executed on Linux."}, {"step": "run", "status": "done", "detail": "Rendered in headless Chromium with no network; screenshots taken."}]}
```

`step` is `identify`, `unwrap`, `run`, `wine`, `emulate`, `static`, `generic` or `parser`; `status` is `done`, `stopped` (ran, then hit a limit: "Stopped at NtQuerySystemInformation after 1200000 instructions"), `skipped` (refused by a cap) or `failed`. `detail` is plain text without a file name or a hash.

The terminal report retains the full private list as `coverage: [{item, parent, steps}]`, using the same records as these events. Item 0 is the upload with `parent: null`; children retain their item and parent indices. First arrival fixes ordering; a repeated update replaces that item's record rather than adding another. No extra coverage event is needed for the report.

The job view keeps these records in `state.coverageItems` and also exposes `state.coverage` as a flat list of `{step, status, detail?}` for existing callers. A legacy event with only `steps` has an itemless list (no inferred item or parent). A report's own coverage field is authoritative, including an empty or malformed value; when it is absent, the view falls back to streamed coverage. Numbered items render only recognised step/status pairs. Itemless legacy lists retain their non-empty string step/status labels verbatim (including the existing `ok` status and descriptive step labels), without translating them into current status names. Non-string details are omitted, and missing or malformed steps do not claim that anything ran.
