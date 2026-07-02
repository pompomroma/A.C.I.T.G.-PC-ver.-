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

/**
 * Pick the most natural-sounding voice for a language. Windows ships low-quality legacy voices
 * (e.g. "David"/"Zira") plus high-quality neural ones ("Aria"/"Jenny (Natural)"); Chromium also
 * exposes "Google US English". We strongly prefer the natural/neural voices so ACTIG's English
 * doesn't sound robotic, falling back through Google → any same-language voice → default.
 */
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return undefined;
  const base = (lang.split("-")[0] || "en").toLowerCase();
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = sameLang.length ? sameLang : voices;
  const score = (v: SpeechSynthesisVoice): number => {
    const n = v.name.toLowerCase();
    let s = 0;
    if (/(natural|neural|online)/.test(n)) s += 100; // modern high-quality voices
    if (/(aria|jenny|guy|ana|libby|sonia|emma|michelle|roger)/.test(n)) s += 60; // MS neural names
    if (n.includes("google")) s += 50;
    if (!v.localService) s += 20; // cloud/remote voices sound far better than local SAPI
    if (v.default) s += 5;
    if (v.lang.toLowerCase() === "en-us" || v.lang.toLowerCase() === base + "-" + base) s += 10;
    if (/(david|zira|mark|hazel)/.test(n)) s -= 20; // robotic legacy SAPI voices — avoid
    return s;
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

let voicesReady = window.speechSynthesis?.getVoices().length > 0;
if ("speechSynthesis" in window && !voicesReady) {
  window.speechSynthesis.onvoiceschanged = () => {
    voicesReady = true;
  };
}

/** Speak text with the browser TTS (dev / non-Windows only — on Windows the main process speaks). */
function speak(text: string, lang = "en", muted = false): void {
  // On Windows, ACTIG's main process speaks via SAPI (reliable); don't double-speak here.
  if (typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")) return;
  if (muted || !text?.trim() || !("speechSynthesis" in window)) return;
  const utter = () => {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(lang);
      if (v) {
        u.voice = v;
        u.lang = v.lang;
      } else {
        u.lang = lang.includes("-") ? lang : "en-US";
      }
      u.rate = 0.95; // a touch slower than default reads more naturally
      u.pitch = 1.0;
      window.speechSynthesis.cancel(); // interrupt any prior utterance (barge-in friendly)
      // Chromium pauses speech after ~15s; pump resume() to keep long replies going.
      const keepAlive = window.setInterval(() => {
        if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
        else window.clearInterval(keepAlive);
      }, 8000);
      u.onend = () => window.clearInterval(keepAlive);
      u.onerror = () => window.clearInterval(keepAlive);
      window.speechSynthesis.speak(u);
    } catch {
      /* ignore TTS failures */
    }
  };
  // Voices can be empty on first call; wait one tick for them to populate.
  if (voicesReady || window.speechSynthesis.getVoices().length) utter();
  else setTimeout(utter, 250);
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

  /** Save the NVIDIA API key (or other secret) to the encrypted store. */
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
