# ACTIG — Wails edition (phase-1 foundation)

A [Wails v2](https://wails.io) (Go + WebView2) build of ACTIG, as an alternative to the Electron
installer. Goal: a much smaller single `ACTIG.exe` with typically fewer antivirus false-positives
than the Electron + NSIS pipeline.

**Status: phase-1 foundation.** This is a minimal, real Wails Windows app that builds and runs.
It proves the Go + WebView2 pipeline; ACTIG's full feature set (transparent hologram overlay, 3D
project space, live wallpaper, voice, the in-process Nemotron agent) is ported on top of this
incrementally. The Electron app under `apps/desktop/` remains the full-featured build for now.

## Build it
CI builds it automatically (`.github/workflows/wails-build-windows.yml`) on changes under
`wails/` — download `ACTIG.exe` from the run's **Artifacts**.

Locally (Windows, with [Go](https://go.dev) 1.22+ and the
[Wails CLI](https://wails.io/docs/gettingstarted/installation)):

```bash
cd wails
wails build -platform windows/amd64
# -> build/bin/ACTIG.exe
```

## Layout
- `main.go` — Wails app entrypoint; embeds `frontend/dist` and binds the Go `App`.
- `app.go` — backend methods exposed to the UI (called as `window.go.main.App.*`).
- `frontend/dist/index.html` — the static UI (no build step yet; the Electron app's React UI is
  ported in later).
- `wails.json` — Wails project config.
