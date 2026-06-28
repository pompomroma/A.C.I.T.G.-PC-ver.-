import { useCallback, useEffect, useRef, useState } from "react";

/** A rendered chat line. Mirrors the backend AssistantMessagePayload's display fields. */
export interface ChatLine {
  id: string;
  role: "user" | "assistant";
  text: string;
  lang?: string;
  eta?: string;
  brain?: string;
  errorExplanation?: string;
  qa?: string;
  options?: { id: string; label: string; command?: string }[];
  recommendations?: { id: string; label: string; command?: string }[];
}

export interface ConfirmReq {
  callId: string;
  tool: string;
  description: string;
  risk: string;
}

export interface VoiceState {
  userMicMuted: boolean;
  aiSpeakerMuted: boolean;
  listening: boolean;
}

export interface BrainStatus {
  ready: boolean;
  message?: string;
}

/** Speak text with the browser TTS (works in Electron, needs no backend voice stack). */
function speak(text: string, lang = "en", muted = false): void {
  if (muted || !text?.trim() || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang.includes("-") ? lang : `${lang}-${lang.toUpperCase()}`;
    window.speechSynthesis.cancel(); // interrupt any prior utterance (barge-in friendly)
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore TTS failures */
  }
}

/**
 * Central hook for any hologram surface. Subscribes to core→UI messages and exposes a small
 * imperative API. Every function in the app (text or voice, requirement 14) flows through
 * `send` here, so voice and text share one pipeline.
 */
export function useCore() {
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [confirm, setConfirm] = useState<ConfirmReq | null>(null);
  const [voice, setVoice] = useState<VoiceState>({
    userMicMuted: false,
    aiSpeakerMuted: false,
    listening: false,
  });
  const [awake, setAwake] = useState(false);
  const [brain, setBrain] = useState<BrainStatus>({ ready: false });
  const idRef = useRef(0);
  const nextId = () => `l${idRef.current++}`;
  // ref so the message handler (bound once) always sees the current speaker-mute state
  const speakerMuted = useRef(false);
  speakerMuted.current = voice.aiSpeakerMuted;

  useEffect(() => {
    const unsub = window.actig.onMessage((msg) => {
      const p = msg.payload || {};
      switch (msg.type) {
        case "assistant_message":
          setLines((l) => [
            ...l,
            {
              id: nextId(),
              role: "assistant",
              text: p.text,
              lang: p.lang,
              eta: p.eta,
              brain: p.brain,
              errorExplanation: p.errorExplanation,
              qa: p.qa,
              options: p.options,
              recommendations: p.recommendations,
            },
          ]);
          speak(p.text, p.lang || "en", speakerMuted.current); // AI speaks its reply (req 2)
          break;
        case "confirm_request":
          setConfirm({
            callId: p.callId,
            tool: p.tool,
            description: p.description,
            risk: p.risk,
          });
          break;
        case "voice_state":
          setVoice((v) => ({ ...v, ...p }));
          break;
        case "status":
          setBrain({ ready: !!p.ok, message: p.message });
          break;
        case "wake":
          setAwake(true);
          if (p.greet) speak("ACTIG at your service sir", "en", speakerMuted.current); // req 7
          break;
        case "sleep":
          setAwake(false);
          break;
      }
    });
    // ask the core whether a brain is configured, so the UI can prompt for a key
    window.actig.send("get_status", {});
    return unsub;
  }, []);

  const sendInput = useCallback((text: string, source: "text" | "voice" = "text") => {
    if (!text.trim()) return;
    setLines((l) => [...l, { id: nextId(), role: "user", text }]);
    window.actig.send("user_input", { text, source });
  }, []);

  const respondConfirm = useCallback(
    (approved: boolean, scope: "once" | "always" = "once") => {
      if (!confirm) return;
      window.actig.send("confirm_response", { callId: confirm.callId, approved, scope });
      setConfirm(null);
    },
    [confirm],
  );

  const setMute = useCallback(
    (which: "userMicMuted" | "aiSpeakerMuted", value: boolean) => {
      setVoice((v) => ({ ...v, [which]: value }));
      window.actig.send("voice_state", { [which]: value });
      if (which === "aiSpeakerMuted" && value && "speechSynthesis" in window) {
        window.speechSynthesis.cancel(); // muting also stops current speech
      }
    },
    [],
  );

  const interrupt = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    window.actig.send("interrupt", {});
  }, []);

  /** Save the Claude API key (or other secret) to the encrypted backend store. */
  const setSecret = useCallback((key: string, value: string) => {
    window.actig.send("set_secret", { key, value });
  }, []);

  return {
    lines,
    confirm,
    voice,
    awake,
    brain,
    sendInput,
    respondConfirm,
    setMute,
    interrupt,
    setAwake,
    setSecret,
  };
}
