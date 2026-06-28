/**
 * ACTIG WebSocket protocol — the single source of truth for messages exchanged
 * between the Electron desktop shell (frontend) and the Python agent core (backend).
 *
 * Keep this file in lock-step with `backend/actig/protocol.py`. Both sides validate
 * against the same `type` constants and payload shapes.
 *
 * Envelope: every message is `{ id, type, ts, payload }`.
 *   - id:   uuid for correlation (responses reference the request id where relevant)
 *   - type: one of MessageType
 *   - ts:   unix epoch milliseconds
 */

export const PROTOCOL_VERSION = 1;

/** Direction is informational only; the same socket carries both ways. */
export type Direction = "ui->core" | "core->ui";

export type MessageType =
  // ── lifecycle / health ───────────────────────────────────────────────
  | "hello" // ui->core handshake
  | "welcome" // core->ui handshake ack (capabilities, version)
  | "ping"
  | "pong"
  | "status" // core->ui health/heartbeat
  // ── wake / activation ────────────────────────────────────────────────
  | "wake" // either direction: wake triggered (voice/emergency/hotkey/text)
  | "sleep" // dismiss/standby
  // ── conversation ─────────────────────────────────────────────────────
  | "user_input" // ui->core: a turn from the user (text or voice transcript)
  | "assistant_delta" // core->ui: streaming token chunk
  | "assistant_message" // core->ui: a completed assistant turn (rich schema)
  | "interrupt" // ui->core: barge-in; stop current generation/TTS, accept new input
  // ── voice control ────────────────────────────────────────────────────
  | "voice_state" // either direction: mic-mute (user), speaker-mute (AI), listening
  | "tts_state" // core->ui: speaking | stopped (so UI can show waveform)
  // ── guarded tool execution ───────────────────────────────────────────
  | "tool_call" // core->ui: a tool is about to run (for display / audit)
  | "tool_result" // core->ui: a tool finished
  | "confirm_request" // core->ui: sensitive/system action needs one-tap approval
  | "confirm_response" // ui->core: user's decision
  // ── 3D project space ─────────────────────────────────────────────────
  | "project3d" // either direction: open/close/command the 3D space
  | "wallpaper" // either direction: enable/disable 3D-as-wallpaper
  | "camera_gesture" // either direction: enable/disable camera hand-tracking
  // ── config / brain ───────────────────────────────────────────────────
  | "set_secret" // ui->core: store an encrypted secret (e.g. Claude API key)
  | "get_status" // ui->core: ask whether a reasoning brain is configured
  | "audio_input" // ui->core: base64 audio for backend STT (voice build)
  // ── errors ───────────────────────────────────────────────────────────
  | "error";

export interface Envelope<P = unknown> {
  id: string;
  type: MessageType;
  ts: number;
  payload: P;
}

// ── conversation payloads ──────────────────────────────────────────────

export type InputSource = "text" | "voice" | "emergency" | "hotkey";

export interface UserInputPayload {
  /** Raw text (typed) or transcript (from STT). */
  text: string;
  source: InputSource;
  /** BCP-47-ish language code if already known (e.g. from STT). Else core detects it. */
  lang?: string;
  /** STT confidence 0..1 when source === "voice". */
  confidence?: number;
}

/** A single tappable option offered to the user (requirement 1.(3)/(4)). */
export interface ChoiceChip {
  id: string;
  label: string;
  /** "option" = a way to adjust/redirect; "recommendation" = ACTIG's suggested next step. */
  kind: "option" | "recommendation";
  /** Optional command that will be sent back as user_input if tapped. */
  command?: string;
}

/** Per-step record of how a task progressed (requirement 1.(2-3)). */
export interface ProcessStep {
  step: string;
  status: "pending" | "running" | "succeeded" | "failed";
  detail?: string;
}

/**
 * The rich assistant turn. Every field maps to an explicit requirement so the UI
 * and the history DB can render/store the full explanation set.
 */
export interface AssistantMessagePayload {
  /** Natural-language reply (requirement 10). */
  text: string;
  /** Language the reply is written/spoken in (requirement 1: switch in/out). */
  lang: string;
  /** Explanation of any error encountered (requirement 1.(2-1)). */
  errorExplanation?: string;
  /** Direct answers to questions the user asked (requirement 1.(2-2)). */
  qa?: string;
  /** How the task succeeded or failed, step by step (requirement 1.(2-3)). */
  process?: ProcessStep[];
  /** Human-readable time estimate, e.g. "about 30 seconds" (requirement 1.(2-4)). */
  eta?: string;
  /** Options for continuous adjustment / redirection (requirement 1.(3)). */
  options?: ChoiceChip[];
  /** Recommendations for the above options (requirement 1.(4)). */
  recommendations?: ChoiceChip[];
  /** Which brain answered, for transparency. */
  brain?: "ollama" | "claude";
  /** True while a longer agentic task continues in the background. */
  continues?: boolean;
}

// ── voice payloads ─────────────────────────────────────────────────────

export interface VoiceStatePayload {
  /** User microphone capture muted (requirement 5: mic mute for user). */
  userMicMuted?: boolean;
  /** ACTIG speaker/TTS muted (requirement 5: mic mute for AI). */
  aiSpeakerMuted?: boolean;
  /** Whether the core is actively listening for a command. */
  listening?: boolean;
}

export type TtsState = "speaking" | "stopped";

// ── guarded tool payloads (requirement 19 + security model) ────────────

export type RiskLevel = "read" | "safe_write" | "sensitive" | "system";

export interface ToolCallPayload {
  callId: string;
  tool: string;
  /** Short human summary of what will happen, shown in the audit/overlay. */
  summary: string;
  risk: RiskLevel;
  args?: Record<string, unknown>;
}

export interface ToolResultPayload {
  callId: string;
  ok: boolean;
  summary: string;
  /** Reference to a stored artifact, if the tool produced a file. */
  artifactId?: string;
  error?: string;
}

export interface ConfirmRequestPayload {
  callId: string;
  tool: string;
  /** Exactly what will run, shown verbatim for the one-tap confirm. */
  description: string;
  risk: RiskLevel;
}

export interface ConfirmResponsePayload {
  callId: string;
  approved: boolean;
  /** "once" | "always" lets the user pre-approve a tool for the session. */
  scope?: "once" | "always";
}

// ── wake payloads ──────────────────────────────────────────────────────

export interface WakePayload {
  source: InputSource; // voice | emergency | hotkey | text
  /** The fixed reaction phrase spoken on wake (requirement 7). */
  greet?: boolean;
}

// ── 3D project payloads (requirements 4, 16, 17) ───────────────────────

export type ShapeKind =
  | "cube"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "plane"
  | "tetrahedron"
  | "icosahedron";

export type Project3DCommand =
  | { action: "open" }
  | { action: "close" }
  | { action: "add"; shape: ShapeKind }
  | { action: "clone"; targetId?: string }
  | { action: "delete"; targetId: string }
  | { action: "select"; targetId: string }
  | { action: "reset" };

export interface Project3DPayload {
  command: Project3DCommand;
}

export interface WallpaperPayload {
  enabled: boolean;
}

export interface CameraGesturePayload {
  /** Master toggle for camera hand-tracking (requirement 4). */
  enabled: boolean;
  /** Sub-toggles: pinch-drag and two-hand scale can be controlled independently. */
  drag?: boolean;
  scale?: boolean;
}

// ── status / error ─────────────────────────────────────────────────────

export interface StatusPayload {
  ok: boolean;
  components: {
    brain?: "ready" | "degraded" | "down";
    voice?: "ready" | "degraded" | "down";
    wakeword?: "listening" | "off";
    system?: "ready" | "down";
  };
  message?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface WelcomePayload {
  protocolVersion: number;
  appVersion: string;
  capabilities: string[];
}

// ── helpers ────────────────────────────────────────────────────────────

let _seq = 0;
function cheapId(): string {
  _seq = (_seq + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${_seq.toString(36)}`;
}

export function makeMessage<P>(type: MessageType, payload: P, id?: string): Envelope<P> {
  return { id: id ?? cheapId(), type, ts: Date.now(), payload };
}
