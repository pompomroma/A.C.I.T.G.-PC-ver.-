# ACTIG security & guarded-access model

ACTIG is designed to have broad access to the PC (requirement 19), so it is built so that
"powerful" never means "uncontrolled". The defaults are safe; the user stays in the loop for
anything risky; and everything is auditable.

## Risk tiers
Every tool declares a risk level in the capability registry
(`backend/actig/config/capabilities.py`):

| Tier | Runs how | Examples |
|---|---|---|
| `read` | automatically | system info, list/read files, list apps, read settings |
| `safe_write` | automatically | create a note, open an app, open a URL, play music |
| `sensitive` | **one-tap confirm** | delete/move files, send a message, purchase, drive an app's UI |
| `system` | **one-tap confirm** | change a setting, kill a process, run a shell command |

Unknown/unregistered tools are treated as `sensitive` (deny-by-default bias).

## Confirmation flow
When the agent loop wants to run a `sensitive`/`system` tool, `ToolRegistry.dispatch`
(`backend/actig/agent/tools.py`) pauses and sends a `confirm_request` to the UI. The hologram
`ConfirmDialog` shows exactly what will run and its risk; the tool only executes after the
user approves (`Allow once` / `Always allow` for the session) — see `server.py`'s
`confirm()` round-trip. Decisions can also be made by voice.

## Default-deny dangerous operations
A small set of high-blast-radius operations (`shell_raw`, `disk_format`,
`registry_bulk_delete`, `mass_file_delete`) are **blocked outright** even if approved, until
the user explicitly enables them in advanced settings. This is enforced before any handler is
located, so they can never run by accident.

## Audit log
Every tool call — auto, approved, denied, or blocked — is written to the `audit` table with
the tool, risk, decision, a summary, and an args snapshot (`HistoryStore.audit`). This is a
non-repudiable record of everything the agent did on the machine.

## Secrets
The Claude API key and any saved credentials are sealed with Windows DPAPI
(`win32crypt.CryptProtectData`, bound to the user account) via
`backend/actig/config/secrets.py`. Nothing sensitive is written to the repo or to plaintext
config. The `.gitignore` additionally blocks `secrets*`, `*.pem`, and the runtime data dir.

## Data locality
Voice capture, wake-word detection, transcripts, history, and files stay on-device. Only the
conversation text needed for hard reasoning is sent to the Claude API; the local Ollama brain
handles simple/offline turns. Users who want fully-offline operation can run local-only.

## Network & web actions
Music and browser/settings actions open the user's default browser or a controlled Playwright
session. Web automation is scoped to the requested action; domains can be allow/block-listed.

## Threat-model notes
- ACTIG runs with the logged-in user's privileges (autostart task uses the interactive token).
  It does not silently elevate; system changes that need admin still prompt via the OS.
- The WebSocket server binds to `127.0.0.1` only.
- Overlay windows are display-only surfaces; they cannot be driven by remote content.
