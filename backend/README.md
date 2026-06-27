# ACTIG agent core

The Python agent core for **ACTIG** — a hybrid-brain (Ollama local + Claude cloud) local
agentic AI for PC. This package provides the reasoning loop, guarded system tools, voice
pipeline, language switching, and persistent history that the Electron desktop shell drives
over a local WebSocket.

See the [project README](../README.md) for the full system, install, and usage docs.

## Quick start
```bash
pip install -e "backend[dev]"     # core + test deps
python -m actig.server            # agent core on ws://127.0.0.1:8765/ws
pytest                            # run from this directory
```

Optional extras: `voice` (faster-whisper / Piper / openWakeWord), `windows` (system control),
`web` (Playwright for music/browser actions).
