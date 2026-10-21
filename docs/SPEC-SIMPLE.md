# Detonation Ocean: the simple version

This is the plain-English version of [`SPEC.md`](SPEC.md). If the two disagree, `SPEC.md` is right.

**Partly built; not accepted or publicly deployed.** Containment corrections are in progress. Upload and sample execution still require safety approval. No tests or runtime probes run in the current session, at the user's request; earlier results do not verify later changes.

---

## 🌊 What is it?

The planned app lets you upload a file you're unsure about. We open, emulate or inspect it in an isolated box on a Vultr server and show the evidence. Isolation reduces risk; it is not a guarantee of safety.

The result is shown as a sea creature:

- 🐟 **No harmful behaviour observed in a complete run?** Your file stays near the surface. That result is not a guarantee of safety.
- 🦈 **Harmful file?** A deep-sea monster swims up and **eats your fish**.

---

## 🧭 The 5 depths

The deeper your fish ends up, the worse the file is.

| Depth | Means | What happens to your fish |
|---|---|---|
| ☀️ **Sunlight** | Nothing bad seen | Swims freely |
| 🌆 **Twilight** | Looks dodgy, but nothing bad was proven | Swims down, a bit darker |
| 🌑 **Midnight** | **Steals** things (passwords, files) | Gets eaten |
| 🕳️ **Abyss** | **Takes over** your computer | Gets eaten |
| 🐙 **Trench** | **Destroys** things (locks or deletes files) | Gets eaten by a legendary monster |

> ⚠️ "Nothing bad seen" does **not** mean "safe". It means our checks didn't catch anything.

---

## 🐠 Which fish?

Your fish depends on the **type of file**.

| File | Fish |
|---|---|
| Zip | 🐡 Pufferfish |
| PDF | Flounder |
| Word | Leafy seadragon |
| Excel | Boxfish |
| Program (`.exe`) | Barracuda |
| Web page | Mandarin dragonet |
| Email | Flying fish |
| Python | Snake eel |
| Anything weird | Coelacanth |

The full list is in [`DETONATION-DESIGN.md`](DETONATION-DESIGN.md) section 6.

---

## 👹 Which monster eats it?

The monster depends on **what bad thing the file did**. Some examples:

| The file… | Monster |
|---|---|
| Stole passwords | Cookiecutter shark |
| Recorded your typing | Barreleye |
| Tried to send your data away | Snipe eel |
| Made itself start every time the computer starts | Tripod fish |
| Used your computer's power secretly | Vampire squid |
| Locked your files for ransom | 🦑 Kraken |
| Tried to wipe the whole computer | 🐍 Jörmungandr |
| Did something bad we have no name for | Giant squid |

There are 21 monsters in total. The full list is in [`DETONATION-DESIGN.md`](DETONATION-DESIGN.md) section 5.

**More uploads = bigger monsters.** Each monster grows every time it eats another file.

---

## 🔁 What happens when you upload?

1. **Upload.** You drop in a file and tick a box saying you're allowed to test it.
2. **Lock it in a box.** The file goes into a fresh sandbox (a sealed-off mini-computer).
3. **Set it off.** The file runs inside the box. We watch everything it touches.
4. **The AI writes code.** The AI writes a small program to make a chart of what happened.
5. **Fix mistakes.** If the AI's program crashes, the AI sees the error and tries again (up to 3 times). You see this happen on screen.
6. **Explain.** The AI explains the result in plain English.
7. **Show it.** You see the effects on a pretend Windows or Mac desktop: files getting locked, warnings popping up.
8. **Destroy the box.** The box is deleted, and we check that it's really gone.
9. **Receipt.** You get a receipt recording confirmed cleanup and the host-canary check. An unchanged canary is evidence about that file, not proof that the entire server was untouched.

> 🧠 **The AI does not decide if a file is bad.** Fixed rules decide, based on what actually happened. The AI only makes the chart and explains the result.

---

## 🧰 Handling lots of file types (especially `.exe`)

Most people will upload programs (`.exe`). No single tool understands every program, so we **try the best method first, then fall back** to simpler ones. Every file gets *something*.

```
1. Identify → 2. Unwrap → 3. Run for real → 4. Run with Wine → 5. Pretend-run → 6. Read it → 7. Last resort
```

| Step | In plain words | Example |
|---|---|---|
| 1. 🔍 **Identify** | Work out what the file really is and who made it | "This is an installer, and it isn't signed" |
| 2. 📦 **Unwrap** | Many programs are boxes with other files inside. Open them and check each one | Installers, packed programs, Python apps turned into `.exe` |
| 3. ▶️ **Run for real** | If it runs on Linux, just run it in the box. Best proof | Python, shell scripts, Java |
| 4. 🍷 **Run with Wine** | Wine lets many Windows programs **really run** on Linux. We even get screenshots of the windows they open | `.exe`, `.msi`, `.bat`, Windows scripts |
| 5. 🎭 **Pretend-run** | If Wine can't run it, a fake Windows records what it *tries* to do | `.exe`, `.dll`, macros |
| 6. 📖 **Read it** | Look through the file without running it | Spotting "this can encrypt files" |
| 7. 🤖 **Last resort** | For a format nobody knows, the AI writes a small reader for it (and retries if it crashes) | Odd or custom files |

The report shows **which steps worked and where it stopped**, so you know how much to trust it.

> ⚠️ If a file couldn't be fully run, it can only reach **Twilight** (dodgy). We only say "harmful" when we've seen proof.

### Windows, Mac and phone files

Our server runs Linux, so files made for other systems need help:

| File | What we do | Really runs? |
|---|---|---|
| Windows programs (`.exe`, `.msi`) | Wine, then pretend-run | ✅ Mostly |
| Windows scripts (`.bat`, `.js`, `.vbs`) | Wine, then pretend-run | ✅ Partly |
| Office files with macros | LibreOffice runs the macros, then pretend-run | ⚠️ Partly |
| Mac apps (`.dmg`, `.pkg`) | Unpack and read; pretend-run the program | ❌ No |
| Android apps (`.apk`) | Read only | ❌ No |

> 🚫 **We never run uploads in your browser.** That would put the file on *your* computer. Everything runs on our server, inside the box. Your browser only shows a replay of what happened.

> 🍷 Wine is not real Windows. Some programs won't run, and some malware notices Wine and behaves itself. We flag that as dodgy (Twilight).

**Big files:** up to 10 MB get every step. 10–100 MB (big installers) get steps 1, 2 and 5, and anything small inside them gets every step. Over 100 MB is rejected.

**Later (after the hackathon):** a real Windows computer and a real Android phone emulator, reset after every file. This is the only way to see *everything* these programs do, but it costs more and needs extra permissions. Real Mac testing needs actual Apple hardware.

---

## 🎮 What it looks like

The whole site keeps the **retro pixel-art look** of the current main menu: chunky pixels, pixel font (Jersey 10), hard-edged boxes, no blur.

### The main menu (the ocean)

- 🌊 You **scroll down to dive** through the ocean, like now.
- 📏 The depth gauge on the right shows the 5 tiers: **Sunlight · Twilight · Midnight · Abyss · Trench**, with real ocean depths (0 m to 11,000 m).
- 📥 At the top: a big **Drop a file** box.
- 🐟 Near the surface: **schools of fish**, one for each file type people uploaded.
- 🦈 In the deep: **one monster per kind of harm**, bigger the more files it has eaten.
- 🔦 Below 1,000 m your mouse pointer becomes a torch (already built).
- 🔇 Sound is off unless you turn it on.
- Menu buttons: **Upload · Bestiary · How it works · Sound**.

### When you upload (the dive)

1. 🐟 Your file appears as **your fish** at the surface.
2. 🐚 A **giant clam** closes around it: it's sealed in the sandbox.
3. 🐙 An **octopus** writes the analysis code in a little pixel terminal. If the code crashes, you see the error and the retry.
4. ⬇️ Your fish **sinks** as bad things are found. You see a live list like "Read the password file" or "Connection blocked".
5. 🦈 If it's harmful, a **monster rises and eats your fish**, then swallows the camera.
6. 🖥️ You land on the **pretend Windows or Mac desktop** and see what the file did: locked files, pop-ups, warnings.
7. 🐚 The **clam shuts and sinks**: the sandbox is destroyed.
8. 📄 You get a **report card** with the verdict, evidence, chart, code and receipt.

### The Bestiary

A collection book of every fish and monster.

- Each card says what the monster means, why it's that animal, and how to protect yourself.
- 🕳️ Monsters nobody has found yet show as **dark silhouettes**: "Not yet found". The book fills up as real harmful files arrive.

### For everyone

- The verdict is always written in words too, not just shown by a monster or a colour.
- Works with the keyboard.
- If you turn off animations on your device, we skip the eating and just show the result.
- Works on phones.

---

## 🔒 How we keep it safe

The hackathon asks for 4 safety things. Here's how we do each:

| Safety rule | In plain words | How |
|---|---|---|
| 🧱 **Isolation** | The file can't escape the box | Extra-strong box (gVisor), no internet, can't touch our server. Programs (`.exe`) are only pretend-run, never run for real |
| 🔑 **No secrets inside** | No passwords or keys in the box | Our real keys stay outside. We put **fake** passwords in the box as bait. If the file grabs them, we've caught it |
| ⏱️ **Limits** | It can't run forever or eat all the memory | 30 seconds max, 512 MB memory, 128 processes max |
| 🧹 **Clean up** | A fresh box every time, deleted after | We delete it, then double-check. If deleting fails, the site stops taking uploads until someone fixes it |

---

## ☁️ Where Vultr comes in

| Vultr thing | What it does |
|---|---|
| **Cloud Compute (a server)** | Runs the website and all the sandbox boxes |
| **Serverless Inference (the AI)** | Writes the chart code and explains the result |

That's the minimum the hackathon needs.

---

## 🎬 The demo video moment

We upload our own pretend-evil file, `invoice.py`. It tries to:

- 🔓 steal fake passwords → **blocked from sending them**
- 🔐 lock the fake documents → **only the box is affected**
- 💣 crash the box by copying itself endlessly → **stopped by the process limit**
- 🧨 delete everything (`rm -rf /`) → **only the box is affected**

Then the box is destroyed, and Jörmungandr eats the fish.

> 🛡️ `invoice.py` refuses to run anywhere except inside our box, so it's safe for us to keep around.

---

## 🧹 Other work around the project

- 🔄 **Update old code** that still uses the old depth meanings, and hide the 30 old scripted scenes for now.
- 🖥️ **Desktops:** anything new the replay needs goes into **both** Windows and Mac. The Mac desktop must be replaced before going public (licence problem).
- 🎨 **Art:** new pixel creatures from RetroDiffusion, the most-needed ones first. The API key never goes in the code.
- 🛡️ **Website safety:** strict browser security settings, no outside scripts or trackers, uploads never sent back.
- 📊 **Running it:** logs never record file names; an off switch stops uploads; check the bill daily; shut the server down after the hackathon.
- 📚 **GitHub:** a README that lets anyone set it up from scratch, plus a list of every tool's licence.
- 🎬 **Video:** about 3 minutes. Dive, clean file, evil file, monster eats fish, the box absorbs the attack, the receipt, how it works.

---

## 📦 What we must hand in

- [ ] Website anyone can visit
- [ ] Running on a Vultr server
- [ ] AI calls going through Vultr
- [ ] Code on GitHub with setup instructions
- [ ] Demo video, with the safety moment
- [ ] Explanation of how it all works

**Done so far: none.** Only the plans are written.

---

## 🚧 What's blocking us

Before building, we need to:

1. ✍️ Update our own safety rules (`safety.md`) so uploads can run in the box.
2. 📜 Check Vultr allows malware testing.
3. 🧰 Check the tools we want to use are still maintained and free to use (including the extra `.exe` tools), and that Wine works inside our extra-strong box.
4. 💰 Approve spending money on the server and the AI.
5. 📅 Check whether the hackathon allows building before the event week (3–8 November 2026).

---

## 📖 Word list

| Word | Meaning |
|---|---|
| **Sandbox** | A sealed-off space where a file can run without reaching anything real |
| **Container** | One sandbox. We make a new one for every file |
| **gVisor** | An extra wall around the container, so escaping is much harder |
| **Emulate** | Pretend to run a program, without really running it |
| **Unwrap** | Open a file that has other files packed inside it |
| **Static analysis** | Reading a file without running it |
| **Fallback** | A simpler method we use when a better one doesn't work |
| **Wine** | A free tool that lets many Windows programs run on Linux |
| **Bestiary** | The in-site collection book of all the fish and monsters |
| **Pixel art** | Old-school game graphics made of visible square pixels |
| **Honey file** | A fake password file left as bait |
| **Evidence** | A record of what the file actually did |
| **Finding** | A proven bad thing, like "stole passwords" |
| **Inference** | Asking the AI something |
| **stderr** | The error message a program prints when it crashes |
| **Receipt** | Proof of what ran and that the box was deleted |
| **Vultr** | The cloud company whose servers run all of this |
