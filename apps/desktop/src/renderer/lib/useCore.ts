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
  const idRef = useRef(0);
  const nextId = () => `l${idRef.current++}`;

  useEffect(() => {
    return window.actig.onMessage((msg) => {
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
        case "wake":
          setAwake(true);
          break;
        case "sleep":
          setAwake(false);
          break;
      }
    });
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
    },
    [],
  );

  const interrupt = useCallback(() => window.actig.send("interrupt", {}), []);

  return { lines, confirm, voice, awake, sendInput, respondConfirm, setMute, interrupt, setAwake };
}
