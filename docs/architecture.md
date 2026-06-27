# ACTIG architecture

## Two processes, one socket
ACTIG is an **Electron shell** (UI, 3D, gestures, OS window tricks) plus a **Python agent
core** (reasoning, voice, system control, persistence). They talk over a local WebSocket
(`ws://127.0.0.1:8765/ws`). The shell owns the single authoritative socket; every hologram
surface (overlay, 3D window, wallpaper) sends/receives through the main process, so all
surfaces share one consistent conversation/state.

The wire format is one envelope `{id, type, ts, payload}`, defined once in
`packages/shared/src/protocol.ts` and mirrored in `backend/actig/protocol.py`.

## Agent core
```
server.py ── WebSocket ──┐
                         ├── AgentLoop.run(user_input)
                         │     ├─ LanguageState.resolve()         # req 1: in/out language
                         │     ├─ build prompt (persona + history)
                         │     ├─ HybridBrain.complete(tools)     # Ollama ↔ Claude
                         │     ├─ loop tool calls:
                         │     │     ToolRegistry.dispatch()       # guarded: confirm + audit
                         │     │     ├─ capability risk check
                         │     │     ├─ confirm_request ⇄ confirm_response (UI)
                         │     │     └─ run handler (system/*)
                         │     ├─ checkpoints.save() per step      # req 1: latest workflow
                         │     └─ AssistantTurnBuilder.build()     # req 1: rich reply
                         └── HistoryStore (SQLite + artifact files)
```

### Hybrid brain
`brain/router.py` picks per turn: hard/agentic/long turns or tool selection → **Claude**;
simple turns → **Ollama**, escalating to Claude on low self-confidence or if Ollama is down.
Providers implement a small `BrainProvider` protocol so tests inject fakes (no network).

### Voice pipeline (Phase 2)
`voice/manager.py` wires openWakeWord (wake "wake up ACTIG"), faster-whisper (STT + language
id), Piper (TTS, multilingual, interruptible), and webrtcvad (barge-in). Two independent mutes
(user mic / AI speaker). All heavy deps are lazy so the core boots/test without audio hardware.

## Electron shell
- `main/index.ts` — lifecycle, tray, global wake hotkey, backend spawn+watchdog, window
  orchestration, IPC bridge.
- `main/windows.ts` — three transparent windows: overlay (always-on-top, click-through except
  over UI), project3d, wallpaper.
- `main/wallpaper.ts` + `installer/native/wallpaper-host.c` — reparent the 3D window under the
  desktop **WorkerW** so it becomes the live wallpaper; original wallpaper saved/restored.
- `renderer/` — React overlay (`components/*`), Three.js scene (`three/SceneManager.ts`),
  MediaPipe hands (`three/gestures.ts`).

## Data & autostart
Per-user data lives in `%LOCALAPPDATA%\ACTIG` (history DB, artifacts, encrypted secrets,
logs). Autostart is registered twice for robustness: Electron login-item (HKCU Run) and a
logon Scheduled Task created by the NSIS installer.
