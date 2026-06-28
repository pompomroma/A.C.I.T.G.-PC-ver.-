# ACTIG — Local Agentic AI for PC

A JARVIS-style, always-on local assistant for Windows. Talk or type to it from any screen,
let it drive your PC (guarded), and open an Iron-Man-style 3D project space you can shape with
your mouse or your hands — even set it as your live wallpaper.

> **Status:** full-stack scaffold. The agent core (brain routing, history, checkpoints,
> language switching, guarded tools, agent loop) is implemented and unit-tested. The Electron
> shell (hologram overlay, 3D space, gestures, wallpaper) and the Windows installer pipeline
> are implemented; they build/run on a Windows machine with the toolchain installed.

---

## How to input, activate, and use ACTIG

### 1. INPUT — get the one file `ACTIG-Setup.exe`
`ACTIG-Setup.exe` is a **compiled build output**, so it is not stored in the repo (a Windows
`.exe` has to be produced by the packaging pipeline, and binaries are git-ignored). Get it in
whichever way suits you — then **copy that single file to the PC and double-click it.** The
installer sets up autostart, so ACTIG launches on **every power-on**, permanently, until you
uninstall it.

**A) Download the prebuilt installer (no toolchain, no building — recommended).** GitHub
Actions builds the installers on a Windows runner and publishes them to **Releases** — both
the versioned **`v0.1.0`** release and a rolling **"ACTIG latest build"**. Two variants:

| Asset | Includes | Pick this if |
|---|---|---|
| **`ACTIG-Setup.exe`** | Text chat + browser speech-to-text + OS (SAPI) text-to-speech | You want the smaller, fastest install |
| **`ACTIG-Setup-voice.exe`** | Bundles the **offline voice stack** (faster-whisper STT, Piper TTS, openWakeWord) | You want on-device/offline voice + the custom wake word |

> The voice build downloads the Whisper model on first run; drop Piper voices and the trained
> `wake_up_actig` model into `assets/` (see [`assets/README.md`](assets/README.md)) for a fully
> offline wake word. You can also get either exe from **Actions → latest run → Artifacts**.

**B) Build it locally with one double-click.** On a Windows PC with **Node 20+** and
**Python 3.11** installed, double-click **`build.bat`** (or run
`scripts\build-windows.ps1`). It produces `installer\output\ACTIG-Setup.exe`.
> ⚠ **Two gotchas the script handles/automates for you:**
> - **Admin needed.** electron-builder unpacks a signing toolkit containing macOS symlinks, and
>   creating symlinks on Windows requires admin rights — otherwise you get
>   `Cannot create symbolic link ... libcrypto.dylib`. `build.bat` now **auto-prompts for admin
>   (UAC)**. No admin account? Enable **Developer Mode** instead
>   (Settings → Privacy & security → For developers → Developer Mode = On) and run it normally.
> - **Use a short folder path.** A long path overflows Windows' 260-char limit during packaging.
>   Extract the project into something like **`C:\ACTIG`**, not a deep `Downloads\...\...` folder.
>   The script warns you if your path is long.

**C) Just run it from source (skip the installer entirely).** Fastest way to try it:
`scripts\dev.ps1` launches the Electron shell, which auto-starts the Python core.

#### Local-build troubleshooting
- **`makensis.exe ENOENT`** — your antivirus quarantined NSIS's `makensis.exe` (a notorious false
  positive, common with **AhnLab V3** / Windows Defender), or a previous run left a half-extracted
  cache. `build.bat` now **auto-clears the cache** and **auto-adds a Windows Defender exclusion**
  for `%LOCALAPPDATA%\electron-builder\Cache`. If it still happens (e.g. AhnLab V3, which can't be
  excluded automatically), do one of:
  - **Easiest: run `build-portable.bat`** — an **antivirus-proof** build that produces
    `ACTIG-portable.zip` using electron-builder's ZIP target, so it **never touches `makensis.exe`**.
    Unzip it anywhere and run `ACTIG.exe`; it registers autostart on first launch.
  - Add a folder exclusion for `%LOCALAPPDATA%\electron-builder\Cache` in AhnLab V3 (or disable
    real-time protection briefly), then rerun `build.bat`.
  - Or just download the prebuilt installer (top of this section) — no local build at all.
- **"deprecated subdependencies" warning** (`glob`, `inflight`, `tar`, `boolean`) — **harmless,
  ignore it.** These are build-time-only transitive deps of `electron-builder` itself; they are
  **not** part of ACTIG and ship nothing into the installer or app. They can't be removed without
  breaking electron-builder's packaging, and `glob`/`tar` are marked "deprecated" by their author
  at *every* version (including the latest), so no pin clears the message. It does not affect your
  build, the installer, or the app.

### 2. ACTIVATE
First launch runs a one-time wizard: paste your **Claude API key** (stored encrypted), pick a
local **Ollama** model, and grant **microphone/webcam** permission. After that ACTIG lives in
the tray. Wake it by **saying "wake up ACTIG"** (it answers *"ACTIG at your service sir"*), by
tapping the always-visible **emergency button**, or with **Ctrl+Alt+Space**.

### 3. USE
Talk or type — every feature works by voice **or** text on any screen: chat, run PC tasks
(risky steps ask for one-tap approval), play music, open the **3D project space**
("bring up the 3D project"), set it as your **wallpaper**, interrupt mid-sentence, mute either
mic. Everything is saved to history and resumable.

---

## Architecture

```
Electron shell (TypeScript/React/Three.js/MediaPipe)  ──WebSocket──  Python agent core
  overlay (hologram chatbox, mic, emergency, confirm)                brain router (Ollama↔Claude)
  project3d (shapes, drag, scale, clone, gestures)                   agent loop + guarded tools
  wallpaper (3D behind desktop icons)                                voice (wake/STT/TTS/VAD)
  tray + autostart + global hotkey + backend watchdog               history + checkpoints (SQLite)
```

See [`docs/architecture.md`](docs/architecture.md) and [`docs/security.md`](docs/security.md).

## Repo layout
| Path | What |
|---|---|
| `backend/actig/` | Python agent core (brain, agent loop, voice, system tools, history) |
| `apps/desktop/` | Electron shell: main process, preload, renderer surfaces |
| `packages/shared/` | Shared WebSocket protocol (TS) — mirrored in `backend/actig/protocol.py` |
| `installer/` | Build pipeline, PyInstaller spec, NSIS hook, autostart, native wallpaper helper |
| `assets/` | Wake-word model, Piper voices, icons (not committed) |

## Develop
```bash
# backend (works cross-platform for the core; voice/Windows extras are optional)
python -m venv .venv && . .venv/bin/activate
pip install -e backend[dev]
python -m actig.server                 # agent core on ws://127.0.0.1:8765/ws
pytest backend                         # 24 core tests

# frontend
pnpm install
pnpm --filter @actig/desktop dev       # Electron shell against the running core
```

## Requirements traceability
Every numbered requirement from the brief maps to code:

| Req | Where |
|---|---|
| 1 autostart | `installer/nsis/installer.nsh`, `apps/desktop/src/main/autostart.ts` |
| 1 history (turns/tasks/commands/results/artifacts) | `backend/actig/history/{models,store}.py` |
| 1 explanations 2-1..2-4, options(3), recommendations(4) | `backend/actig/protocol.py` `AssistantMessagePayload`, `agent/schema.py`, UI `components/Chatbox.tsx` |
| 1 checkpoints | `backend/actig/history/checkpoints.py` |
| 1 language switch | `backend/actig/lang/detect.py`, used in `agent/loop.py` |
| 2 text+voice I/O | `components/Chatbox.tsx`, `lib/speech.ts`, `backend/actig/voice/*` |
| 3 always-on background | `main/backend.ts` watchdog, tray, `main/index.ts` |
| 4 3D drag/scale/clone (mouse+camera) | `three/SceneManager.ts`, `three/gestures.ts` |
| 5 holograms (chatbox/mic/3D btn/in-3D buttons) | `components/*`, `project3d.ts`, `styles/hologram.css` |
| 6 wake "wake up ACTIG" | `backend/actig/voice/wakeword.py` |
| 7 reaction "ACTIG at your service sir" | `voice/tts.py` `speak_reaction`, settings `wake_reaction` |
| 8 emergency button | `components/App.tsx` `.emergency`, tray fallback |
| 9 holograms over anything on wake | `main/windows.ts` (transparent always-on-top), `main/index.ts` `wake()` |
| 10 natural conversation | `agent/persona.py`, Claude brain |
| 11 high cognition | Whisper STT + hybrid routing + low-confidence confirm |
| 12 voice interrupt + new reply | `voice/manager.py` `interrupt`, `lib/useCore.ts`, `App.tsx` |
| 13 flexible commands | LLM tool-routing in `agent/loop.py` + `agent/tools.py` |
| 14 every function via voice AND text | single pipeline in `lib/useCore.ts` → `agent/loop.py` |
| 15 voice+text on any tab | global hotkey + wake word + always-on-top overlay |
| 16 bring up 3D by voice/text | `project3d.ts` command relay, `main/index.ts` |
| 17 3D as wallpaper | `main/wallpaper.ts`, `installer/native/wallpaper-host.c`, `wallpaper.ts` |
| 18 play music via web | `backend/actig/system/browser.py` `play_music` |
| 19 full guarded PC access | `backend/actig/system/*`, `config/capabilities.py`, `agent/tools.py` |

## License
MIT
