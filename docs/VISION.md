# The Detonation Ocean: what we are building

This file preserves the scripted-scene project's earlier intent. [`DETONATION-DESIGN.md`](DETONATION-DESIGN.md) is the current product source of truth; [`SPEC.md`](SPEC.md) defines its implementation and acceptance criteria. This legacy document overrides neither.

> **Product change.** The product is now a file detonation sandbox: users upload a file, the Vultr sandbox runs or emulates it, and the result becomes a creature at a depth. Depth now means **how harmful the file proved to be**. [`DETONATION-DESIGN.md`](DETONATION-DESIGN.md) holds the agreed design (file types, depth tiers, families, creatures, per-upload fish, containment) and wins over sections 1 to 4 below, which describe the scripted-scene build. Safety rules in [`safety.md`](safety.md) apply to everything below and are not relaxed by it.

**Current product:** upload a file to an isolated analysis job, inspect its rule-engine evidence and watch a fictional desktop replay; a pixel ocean represents the observed behaviour. The implementation is partial, safety approval is pending, and no public Vultr deployment is claimed. No tests or runtime probes run in the current session.

The sections below describe the earlier scripted-scene build and its historical evidence, not acceptance of the current detonation product.

Entry for the **Vultr: Agent Rush Hackathon, "Blast Radius Zero: Safe Agent Execution on Vultr"** (online build 3 to 8 November 2026).

## 1. The ocean: 5 depths × 6 creatures = 30 scenes

### Depth tiers (harm proven; [design §3](DETONATION-DESIGN.md#3-depth-tiers-how-harmful-the-file-proved-to-be))

| Tier | Harm proven |
|---|---|
| 1. Sunlight | Clean |
| 2. Twilight | Risky or inconclusive |
| 3. Midnight | Steals |
| 4. Abyss | Takes control |
| 5. Trench | Destroys |

Depth is the worst harm proven. It is not historical severity.

### Vulnerability families and their creatures

| Family | Creature |
|---|---|
| Deception | Anglerfish |
| Intrusion | Viperfish |
| Coordinated abuse | Siphonophore |
| Trusted-source compromise | Isopod host fish |
| Theft / surveillance | Cookiecutter shark |
| Extortion / destruction | Squid (kraken at the Trench) |

The squid is the intended creature. Some code and data files still say "Octopus / kraken" and need to be aligned.

### Three variants per creature

The five depths share three looks, and each look is scarier than the last:

| Variant | Depths | Example (squid) |
|---|---|---|
| Standard | Sunlight + Twilight | Standard squid |
| Deep | Midnight + Abyss | A squid of the depths |
| Apex | Trench | Kraken |

Each depth also gets its own darker colour palette, so all 30 cells differ even when they share a variant.

### Art pipeline

- Sprites come from RetroDiffusion. The API key lives in the secrets store and is never committed.
- Animate **one** base per variant, then recolour it for the other depths that share the variant. That is 18 animations to author and 30 sprites to ship.
- Status: all 30 animated sprites exist in `ocean-style-prototypes/retrodiffusion-creature-animation/` and load through `backend/ocean-profiles.mjs`.

## 2. The player journey

1. **Ocean.** The main page is the 3D Abyss ocean (`ui/abyss/`). Pick a creature at a depth.
2. **Matrix.** `/ocean-profiles.html` shows the 30 cells, each with an "inspired by" real incident.
3. **Camera bite.** The creature swallows a drawn camera. This is a visual effect only; no real camera, microphone or location is ever requested.
4. **Desktop.** The player lands on a locked, fictional desktop and signs in as a fixed training user.
5. **Lure and action.** A few things look normal, and one thing is the lure (an email, a download, a consent page). The player chooses, or in the Trench does nothing.
6. **Attack.** The creature swims on screen and the attack is drawn live against the desktop: passwords, accounts, settings and files are shown being taken or changed.
7. **Debrief.** Stages passed, the safe step at each stage, and the containment moment.

### The desktop

- Two final desktops at the same level, with 21 identical apps: Windows 11 (`desktop-comparison/previews/win11-final`, rebuilt from Win11React) and macOS (`desktop-comparison/previews/macos-final`, built from the macos27 reference). Start at [`desktop-parity/README.md`](desktop-parity/README.md).
- **One shared world.** Windows, files, mail and app data, settings, sign-in, scene step and timers belong to the parent page (`ui/desktop/world-model.js`). Switching OS is only a visual swap.
- **Data-driven.** Theme, wallpaper (including per-depth wallpapers), enabled apps, user and hosted data come from `GET /api/desktop/world?profile=…`, which the Vultr controller will serve.
- Status: shared world, OS switching, scene projection, gesture gating and the attack overlay work in both desktops. All 30 scenes are verified end to end with real clicks in both desktops, on the attack path and the safe path (or the patched replay for trench scenes), and in unit tests. Simple per-depth wallpapers exist; richer animated depth wallpapers and chrome recolouring are still to do.

## 3. Vultr: the real backend

The hackathon requires a web agent that does real work with every action contained in a sandbox on Vultr. The ocean is the product skin. The agent loop below is what is judged.

### Hackathon requirements, and our answer

| Requirement | Our answer |
|---|---|
| Public web app | Controller serves the ocean and desktop over HTTPS from the Vultr VM |
| Vultr VM backend runs the whole loop | One Vultr Cloud Compute VM hosts the controller: plans, dispatches, verifies, tears down |
| All agent LLM calls via Vultr Serverless Inference (`https://api.vultrinference.com/v1`) | Planner, vision verifier and debrief narrator all call it; there is no other model provider |
| Sandbox boundary on Vultr, never in the app process | One disposable Docker container per run on the VM, `--network none`, CPU/memory/time caps, read-only root |
| Process isolation, secret hygiene, resource limits, lifecycle | Keys stay on the controller; the worker receives only validated scene and action IDs; the container is destroyed after every run and absence is confirmed |
| Multi-step agentic workflow, real executed results | Plan, act in the sandbox browser, screenshot, vision-verify, repeat |
| One containment moment in the video | The sandbox absorbs the simulated attack, then is destroyed on camera (see below) |
| Repo, public URL, recorded video, architecture write-up | Still to do |

### The agent loop (Pattern B, sandboxed browser use)

1. The player picks a cell. The controller validates the choice.
2. **Plan.** Serverless Inference (text) returns one fixed action ID per step. Anything outside the allowed IDs is rejected. The model never emits shell commands, URLs or credentials.
3. **Dispatch.** The controller starts a fresh sandbox container holding the synthetic scene and a Playwright Chromium.
4. **Act.** The sandbox plays the lure and the chosen action against the fake desktop and mailbox.
5. **Verify.** Screenshots go to a vision model on Serverless Inference. The step only counts if the vision verdict matches the expected outcome.
6. **Repeat** until the scene's attack stage, then **contain**: the creature attack animation is driven by the verified sandbox events, and the sandbox is destroyed.
7. **Receipt.** An event-derived receipt lists what ran, what the vision check saw, and confirmed teardown.

### Where we use more of Vultr

Required items first, then optional ones that make the project more clearly Vultr-native:

- **Vultr Cloud Compute** (required): controller VM, with a VPC and a firewall group.
- **Vultr Serverless Inference** (required): planner, vision verifier, debrief narrator.
- **Vultr API, throwaway instance per task** (optional, strongest signal): for Abyss and Trench scenes, create a VPC-only instance from a pinned snapshot per run and delete it afterwards, so Vultr itself is the sandbox fabric. The adapter exists (`backend/vultr-adapter.mjs`), is mock-tested and has never run live.
- **Vultr Object Storage** (optional): store run receipts and screenshot trails for the debrief and the demo video.
- **Cost control.** The `$200` participant credit is the budget. Cap instance price and lifetime per run.

### The containment moment

The attack is real inside the sandbox and harmless outside it. In the video: the creature's attack plays on the desktop, the sandbox container (or instance) is shown absorbing it, then destroyed, and the receipt confirms the controller, the keys and the host were never touched.

### Honest status of the Vultr side

Nothing is deployed. No Vultr resource, inference call or RetroDiffusion call has been made by this repository's Vultr code. Today:

- A gated, offline-tested proof route runs the 2023 OAuth consent scene in a local Docker browser container and optionally sends screenshots to Serverless Inference.
- `backend/vultr-agent-planner.mjs` asks the model for one fixed action ID per depth. It is mock-tested and not yet called by any route.
- The other 29 scenes (including the worm) are scripted client-side scenes. They are not yet executed in a sandbox.
- It is **not** a valid submission yet. See [`hackathon-vultr-proof.md`](hackathon-vultr-proof.md) and [`vultr-deployment.md`](vultr-deployment.md) for the gates and remaining steps.

## 4. Flagship scene: Google Docs OAuth worm (2017)

First scene built end to end in this shape. It lives at **Coordinated abuse × Abyss** (Siphonophore), because the defining behaviour is a colony copying itself.

- **Lure.** A colleague "shares a document" through a fictional document service, Gleam Docs.
- **Consent.** A look-alike app named after the service asks to read, send and delete mail and manage contacts. No password and no file is involved.
- **Contacts mailed.** The app reads the contact list and sends each contact the same invitation from the victim's address.
- **Attack.** Siphonophore copies fan out across contact nodes on screen; every contact who allows repeats the cycle.
- **Debrief.** Four stages with the safe step at each, plus a containment stage that describes where the Vultr sandbox revokes the token and is destroyed.

Everything is fictional: invented brand, `.example` addresses, no real consent screen or service. The scene is a data-only change in `desktop-comparison/previews/ocean-scenes.js`, with labels in the mailbox renderer made data-driven.

## 5. Rules that never change

- Original toy logic and synthetic data only. No malware, exploit payloads, real vulnerable software, real credentials, real accounts or public targets.
- Loopback by default. Cloud only behind explicit server gates and separate approval.
- No credential collection. No real camera access.
- The macOS shell is built from an unlicensed Kimi mirror and is a private local evaluation asset; Win11React code is CC0 but its bundled artwork keeps its own rights. Resolve redistribution rights before the public deployment, or ship the project desktop instead.
- Full rules: [`safety.md`](safety.md).

## 6. Where things are

| Path | What |
|---|---|
| `ui/abyss/` | 3D ocean main page |
| `ui/desktop/` | Matrix, safety card, desktop host and state machine |
| `desktop-comparison/previews/` | Scene scripts, attack effects and the two OS shells (one Windows 11, one macOS); superseded shells are in `desktop-comparison/archive/` |
| `backend/ocean-profiles.mjs` | Verified 30-profile catalogue |
| `data/ocean-selection.json` | The 60 scenarios (12 per depth) behind the cells |
| `ocean-style-prototypes/retrodiffusion-creature-animation/` | The 30 animated sprites |
| `backend/hackathon-proof.mjs`, `vultr-inference.mjs`, `vultr-agent-planner.mjs`, `vultr-adapter.mjs` | Vultr paths, gated and offline-tested |
| `docs/ocean-selection.md`, `ocean-taxonomy.md`, `ocean-menu-taxonomy.md` | Generated lists; edit the JSON, not the Markdown |
| `docs/source-audit*.md` | Source review for the 50 historical entries |
