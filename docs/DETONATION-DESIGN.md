# Detonation Ocean: upload design

**Status: in progress.** The detonation pipeline is partly built, not complete. Depth labels in the code now use the harm tiers in §3. How to build it, with acceptance tests: [`SPEC.md`](SPEC.md). Uploads stay blocked until [`safety.md`](safety.md) is amended (§8, decision 1); it does not allow them yet.

## 1. Product

A user uploads a suspicious file. A controller on a Vultr VM plans the analysis, runs or emulates the file in a disposable sandbox, and shows its effects replayed on the Windows or macOS desktop. It then explains the result, destroys the sandbox and returns a receipt. The ocean shows the result as a creature at a depth.

### Agent loop (Pattern A)

1. The user uploads a file. The controller detects its type from content (magic bytes), not the extension.
2. The **detonation container** runs, emulates or inspects the file. The controller records the trace and the file diff.
3. The model (Vultr Serverless Inference) writes Python to analyse the trace or deobfuscate the payload.
4. The **analysis container** runs that script and produces the timeline, chart and before/after diff.
5. On an error, stderr goes back to the model. At most 3 retries, shown on screen.
6. The model explains the result. Trace events replay on the desktop as world patches through `/api/desktop/events`.
7. The job's containers are torn down. On confirmed teardown and canary agreement, the receipt says "Sandbox destroyed · Host canary unchanged". It states that the canary observation applies only to that file, not proof about the whole host. Missing/changed checks or unconfirmed teardown remain explicit; supplied receipt notes and each Wine container's recorded AppArmor state remain visible.

### Paths

| Path | Meaning | Label shown |
|---|---|---|
| Run | Linux-native execution inside a required gVisor container | "Executed" |
| Run under Wine | Disabled pending separate user approval. If approved, a Windows file executes under Wine in a dedicated runc container without gVisor, with the verified Wine seccomp profile and common isolation controls (§7). The receipt displays that note and each Wine container's recorded AppArmor state (`docker-default`, or `unavailable` meaning no AppArmor protection; absent/unrecognised state is unknown) | "Ran under Wine" |
| Emulate | An emulator runs it; its code never runs natively | "Emulated" |
| Inspect | Static analysis only | "Inspected" |

An inspected-only file can reach Twilight at most. Midnight and deeper need evidence from a run or emulation.

The private terminal report retains the full per-item coverage list (`coverage: [{item, parent, steps}]`): upload item 0 has no parent, and children keep their item/parent association. First arrival fixes ordering; repeated updates replace the same item. The report works without earlier coverage events. The UI renders these untrusted fields as text, keeps root-only and itemless legacy lists usable, and does not imply that absent or malformed steps ran.

## 2. File types

| File type | Path | Tools (Linux container) |
|---|---|---|
| `.zip`, `.rar`, `.7z`, `.iso`, `.img` | Unpack, analyse each file | `7z`, with size, count, depth and ratio caps; password `infected` or user-supplied |
| `.pdf` | Run (render) + inspect | `pdfid`, `pdf-parser`, headless Chromium |
| Office (`.docx`, `.docm`, `.xlsx`, `.xlsm`, `.doc`, `.xls`, `.pptx`) | Run macros + inspect, then emulate | LibreOffice headless, `oletools`, ViperMonkey |
| `.exe`, `.dll`, `.scr`, `.com`, `.cpl` | Run under Wine, then emulate | Wine, Speakeasy, Qiling, capa, pefile |
| `.rtf` | Inspect | `rtfobj` (oletools); embedded objects analysed in turn |
| `.html`, `.htm`, `.svg` | Run in a browser | Playwright Chromium, no network, synthetic form input |
| `.eml`, `.msg` | Inspect + unpack | Python `email`, `extract-msg`; links and attachments analysed in turn |
| `.js`, `.vbs`, `.hta`, `.wsf` (Windows Script Host) | Run under Wine, then emulate + model-written deobfuscator | Wine `wscript`/`mshta`, box-js, ViperMonkey |
| `.bat`, `.cmd` | Run under Wine + model-written deobfuscator | Wine `cmd` |
| `.ps1` | Run (partly) + deobfuscate | PowerShell 7 on Linux |
| `.lnk` | Inspect | `LnkParse3`; the target command is analysed in turn |
| `.py`, `.sh`, Node `.js`, ELF | Run | gVisor container |
| `.msi` | Run under Wine + inspect | Wine `msiexec`, `msitools` |
| `.apk` | Inspect | `androguard` |
| `.dmg`, `.pkg`, Mach-O | Inspect | `7z`, LIEF |
| `.jar` | Run or inspect | JVM, CFR |
| `.one` | Inspect + unpack | `pyOneNote` |
| Images, `.txt`, `.csv` | Quick inspection | Type, size and polyglot checks |

A type that does not match its extension is a Disguise finding.

**Hackathon scope:** `.zip`, `.pdf`, Office with macros, `.exe`, `.html`/`.svg`, `.eml`, and scripts (`.py`, `.ps1`, `.js`, `.vbs`, `.bat`). Other types return "unsupported type: inspected only". Limits: 100 MB upload (full analysis up to 10 MB, static only above), 50 files after unpacking, 30 s per item, 3 minutes per job. Executables and other hard cases use the fallback chain in [`SPEC.md` §6.6](SPEC.md#66-compatibility-r-t2).

**Unverified:** maintenance and licences of Speakeasy, ViperMonkey and box-js. If one is stale, its types fall back to Inspect.

## 3. Depth tiers: how harmful the file proved to be

| Tier | Meaning | What puts a file here |
|---|---|---|
| 1. Sunlight | **Clean** | The run completed and no harmful or suspicious behaviour was observed |
| 2. Twilight | **Risky or inconclusive** | Suspicious but unproven: obfuscated or packed, unsigned, asks for admin, contacts unknown hosts, adds itself to startup like adware. Also any incomplete run or inspect-only result |
| 3. Midnight | **Steals** | Reads honey credentials, browser data or keys; logs keystrokes; captures the screen; tries to send data out |
| 4. Abyss | **Takes control** | Persistence plus remote control, process injection, disabling defences, downloading a second stage |
| 5. Trench | **Destroys** | Encrypts, wipes or deletes files; drops a ransom note; tries to spread |

Rules:

- **Depth** is the worst harm proven.
- Sunlight needs a complete run. A partial run is Twilight, "inconclusive".
- Say "No harmful behaviour observed" and list the checks run. Never say "safe" or "clean" in the verdict text.
- Midnight and deeper need trace evidence (a honey-file read, a file diff, a blocked connection), not the model's opinion.
- **Only harm to the user's data counts.** A file is damaged only if it was in the seeded user profile. Files the program created itself (installers, temp files, cleanup) do not count.
- **Some cases stop at Twilight.** v1 cannot prove harm for a phishing email that only links out (no live URLs) or for an exploit document that targets a software flaw rather than using macros. The report says "risky, unproven".
- Hitting only the time or memory cap is inconclusive (Twilight). A buggy script can do that too. Resource hijack needs the process cap or mining evidence.

## 4. Families: what the file does

Each family is a kind of behaviour, so clean files have one too. The neutral name is shown at Sunlight and Twilight, the attack name at Midnight and deeper.

| Neutral name | Attack name | Trace that assigns it |
|---|---|---|
| Disguise | Deception | Fake extension or icon, type/extension mismatch, decoy window, hidden behaviour |
| Access | Intrusion | Admin requests, services or scheduled tasks, startup entries, remote control |
| Network | Coordinated abuse | Outbound connections, mass sends, scanning, self-copying |
| Loader | Trusted-source compromise | Downloads or unpacks more code, process injection, plugin loading |
| Data access | Theft / surveillance | Reads credentials, browser data, keys, clipboard, screen, keystrokes |
| File changes | Extortion / destruction | Writes, encrypts, deletes or overwrites files |
| Drifter | — | Computes only; touches nothing. Sunlight only |

**Family** is what the file is mainly for: the behaviour with the most evidence. Family and depth are set independently, so every cell can be reached.

## 5. Creatures

Every upload is shown as its **file-type fish** (section 6). Sunlight and Twilight use only that fish. The bottom three depths add the finding creature, which eats the fish.

| Depth | What happens |
|---|---|
| Sunlight | The file-type fish swims down freely |
| Twilight | The file-type fish swims down, darker, with a mark naming its strongest signal |
| Midnight, Abyss, Trench | **The finding creature eats the file-type fish** |

The eating is driven by evidence, not a script. It plays when the sandbox event that proves the finding arrives. With several findings, each earlier finding's creature takes a bite as its evidence arrives, and the deepest one eats the fish.

The family sets the colour palette. When several signals or findings apply, the deepest tier wins, then the first row in that tier's table. The others are listed in the debrief, each linked to its evidence.

### Twilight signals (shown as a mark on the fish)

In priority order:

1. Exploit document, harm unproven
2. Phishing link or scareware page, harm unproven
3. Anti-analysis: detects the sandbox, sleeps it out, deletes itself
4. Type does not match the extension
5. Adds itself to startup or bundles extra software (adware)
6. Asks for admin rights
7. Contacts unknown hosts (blocked)
8. Obfuscated, encoded or packed
9. Unsigned or invalid signature
10. Surveys the system: lists users, processes, installed security software
11. Runs system tools with hidden or encoded commands (PowerShell, `mshta`, `rundll32`)
12. Incomplete run: inspect-only, unsupported, emulation stopped, time or memory cap hit
13. Other suspicious behaviour not listed above

### Midnight: steals

| Finding | Family | Creature | Why |
|---|---|---|---|
| Reads honey credentials, keys or crypto wallet files, or dumps passwords from memory | Data access | Cookiecutter shark (existing) | A quiet bite out of something valuable |
| Reads browser passwords, cookies or session tokens | Data access | Black swallower | Swallows prey bigger than itself |
| Collects or packs up user documents | Data access | Megamouth shark | A deep filter feeder that sweeps up everything |
| Keylogging | Data access | Barreleye | A see-through head with eyes always watching |
| Captures the screen, microphone or camera | Data access | Telescopefish | Long tube eyes that record everything |
| Swaps clipboard contents (for example a wallet address) | Data access | Cuckoo wrasse | A quiet swap |
| Fake login form captures the typed text | Disguise | Anglerfish (existing) | A lure that leads you to the jaws |
| Tries to send data out (blocked) | Network | Snipe eel | Thin and slippery; slides away with the catch |

### Abyss: takes control

| Finding | Family | Creature | Why |
|---|---|---|---|
| Privilege escalation attempt, including installing a driver | Access | Viperfish (existing) | Forces its way in |
| Persistence: Run key, service, scheduled task, cron, new user account | Access | Tripod fish | Plants itself on the seabed and stays |
| Disables security tools, clears logs, or hides its files or processes | Access | Hatchetfish | Uses its own light to become invisible |
| Redirects traffic: hosts file, proxy, DNS changes or web injects | Access | Lanternfish | Draws traffic toward a false light |
| Hijacks the browser: installs extensions, changes the homepage or search | Access | Sea lamprey | Latches on and will not let go |
| Remote control, botnet beacon, proxying, traffic flooding, network scan or lateral movement | Network | Siphonophore (existing) | One member of a coordinated colony |
| Process injection or DLL side-loading | Loader | Tongue-eating isopod (existing) | Lives inside the host and replaces part of it |
| Downloads or drops a second stage | Loader | Gulper eel | A huge mouth that takes in a payload |
| Hijacks resources: mining, hidden ad clicking, or a fork bomb that hits the process cap | Access | Vampire squid | Its name says "drains". It is not a true squid |

### Trench: destroys

| Finding | Family | Creature | Why |
|---|---|---|---|
| Attempts a system wipe (`rm -rf /`, deleting system files) | File changes | Jörmungandr | The world serpent that ends the world |
| Encrypts user files, drops a ransom note or sets a ransom wallpaper | File changes | Kraken (existing) | Seizes the ship and holds it |
| Deletes or overwrites user files, backups or shadow copies | File changes | Leviathan | Swallows everything whole |
| Spreads to other hosts or shares, or mass-mails the user's contacts | Network | Hydra | Cut one off and two more grow |

### Other: proven harm that fits no finding above

| Creature | Why | Tier |
|---|---|---|
| Giant squid (existing) | The real deep-sea legend, seen only in glimpses | Set by the kind of evidence: data touched or sent out is Midnight, system settings changed is Abyss, user data damaged is Trench |

The debrief says "Unclassified harmful behaviour" and links the evidence. It plays the same role for findings that the coelacanth plays for file types. A recurring "other" result should become a new finding row.

### The system itself

| Part | Creature | Why |
|---|---|---|
| The agent (plans, writes analysis code) | Octopus | Clever, uses tools, many arms at work |
| The sandbox | Giant clam | Closes around the creature and holds it. Teardown: the clam shuts and sinks |

### Art

- Existing art used: anglerfish, viperfish, siphonophore, tongue-eating isopod, cookiecutter shark, kraken, giant squid. Check the other existing variant sprites before drawing new ones: the apex siphonophore may already suit the Hydra. The 12 Standard sprites have no role yet.
- New art: 6 Midnight, 6 Abyss, 3 Trench, 2 system = 17 creatures, plus the file-type fish (section 6).
- Until a finding creature is drawn, show the existing deep creature of its family, with the finding's name.
- Each deep-tier creature needs one consume animation. It is generic: the fish sprite is drawn into the mouth in code, so no animation is needed per fish.
- Hackathon set: the demo sample's findings (cookiecutter shark, snipe eel, vampire squid, kraken, Jörmungandr), octopus and giant clam, plus the hackathon fish in section 6.

## 6. Per-upload fish

Every upload starts as one small fish: the standard creature for its file type. After the run it stays in the ocean as a marker.

- **Species** comes from the file type (table below).
- **Sunlight and Twilight:** the fish stays in its depth band, darkened and marked by the result's depth and family. Fish gather in **schools by file type**, so busy types make bigger schools. Show at most about 30 fish per school; hovering shows the true count.
- **Midnight, Abyss and Trench:** the fish was eaten, so it leaves no marker. Instead, **each finding has one creature that grows as it eats more files**. Size grows with the log of the count, capped at about 3× the base size. Hovering shows "has eaten N files". A finding that has never happened has no creature, so the deep stays empty until something real is found. The creature does not show the file types it ate.
- **Your own run** always plays at full detail: you see your fish swim down or get eaten. The shared ocean shows only the school or the growth.
- **Batch shared updates** (for example every few minutes), so a new fish or a growth step cannot be timed to one upload.
- **Random traits** (size, pattern, colour shift) come from a random seed. Never seed from the file hash: a hash can be looked up to identify the file.
- Store only species, family, depth, traits and time. Never store the file name, content, trace or verdict text with the public fish.
- With low traffic, show rare types as the coelacanth until enough exist, so a rare fish does not identify an uploader.

| File type | Fish |
|---|---|
| `.zip`, `.rar`, `.7z`, `.iso`, `.img` | Pufferfish |
| `.pdf` | Flounder |
| `.docx`, `.docm`, `.doc` | Leafy seadragon |
| `.xlsx`, `.xlsm`, `.xls`, `.xll` | Boxfish |
| `.pptx` | Lionfish |
| `.rtf` | Ribbonfish |
| `.exe`, `.scr`, `.com`, `.cpl` | Barracuda |
| `.dll` | Remora |
| `.html`, `.htm`, `.chm` | Mandarin dragonet |
| `.svg` | Picasso triggerfish |
| `.eml`, `.msg` | Flying fish |
| `.bat`, `.cmd` | Batfish |
| `.js`, `.vbs`, `.hta`, `.wsf` (Windows Script Host) | Pilot fish |
| `.ps1` | Torpedo ray |
| `.lnk`, `.url` | Archerfish |
| `.py` | Snake eel |
| `.js` (Node) | Jack |
| `.sh` | Sea bass |
| ELF | Goblin shark |
| `.msi` | Jawfish |
| `.apk` | Pocket shark |
| `.dmg`, `.pkg`, Mach-O | Mackerel |
| `.jar` | Java rabbitfish |
| `.one` | Sole |
| Images | Butterflyfish |
| `.txt`, `.csv` | Plaice |
| Unknown, unsupported or rare | Coelacanth |

Hackathon sprites: pufferfish, flounder, leafy seadragon, boxfish, barracuda, mandarin dragonet, flying fish, pilot fish, coelacanth. One small swim cycle each; depth changes are recoloured in code.

## 7. Containment

| Requirement | Approach |
|---|---|
| Process isolation | Non-Wine roles require gVisor (`runsc`/`runsc-trace`) and Docker: non-root, `--cap-drop ALL`, `no-new-privileges`, read-only root, tmpfs home, `--network none`, no Docker socket or host mounts beyond the verified fixed per-job allowlist in SPEC §6.3. Linux-native execution uses this boundary; Windows files are emulated or inspected unless the separately approved Wine exception is enabled. Wine remains disabled pending that decision; if approved, its dedicated runc container must verify the Wine seccomp profile and common isolation controls, but has no gVisor kernel boundary or syscall trace ([recorded limitations](evidence/gvisor-wsl/PIDS-AND-WINE.md#b6-what-is-lost-versus-gvisor)). The [safety amendment and separate Wine approval](safety-amendment-DRAFT.md) both remain pending |
| Secret hygiene | The inference key lives only in the controller environment. Containers start with an empty environment. Fake honey credentials are planted in the sandbox. Uploaded content reaches the model only as quoted, size-capped data |
| Resource limits | 512 MB memory, no swap, 1 CPU, 128 processes, 64 MB tmpfs, 30 s wall clock, 64 KB output, 3 retries, a run queue, a per-user rate limit, a daily inference spend cap |
| Lifecycle | A fresh container per run. Forced removal in `finally`, then a check that it is gone. If removal is unconfirmed, accept no new runs. A reaper removes stale containers. The upload is deleted after the run |

The conditional Wine exception retains common isolation controls, not an identical flag set: its process cap is 128 and its temporary `/prefix` is a 192 MB tmpfs (SPEC §6.3). Wine serialization covers one controller process only, not other controller processes or unrelated host processes sharing the UID. Wine logs and prefix snapshots are weaker evidence: logs can be influenced or flooded, and snapshots can miss write-then-delete activity (SPEC §6.6). A Wine receipt entry does not prove program completion or approve the exception (SPEC §7.5).

## 8. Open decisions

1. Amend [`safety.md`](safety.md) to allow uploads and model-written code inside the sandbox.
2. Check Vultr's acceptable use policy on malware analysis.
3. Check maintenance and licences of Speakeasy, ViperMonkey and box-js.
4. Approve spend for the VM and inference.
5. Update the code and generated docs from the old depth ladder.
6. Write the mapping from trace events to desktop changes (file write → Explorer/Finder, process → Task Manager/Activity Monitor, blocked connection → banner).
7. Upload handling: consent checkbox, encrypted temporary storage, deletion after the run, files never served back; per-IP limits and upload caps.
8. Without inference, verdicts still come from evidence; only the explanation is missing. Sunlight results carry a "not a guarantee" disclaimer.
9. Replace the macOS shell (unlicensed mirror) before any public deployment.
10. Decide whether the 30 scripted scenes become a sample-upload gallery or are removed.
11. Hackathon deliverables: Git repository, public URL, architecture diagram, video script.
