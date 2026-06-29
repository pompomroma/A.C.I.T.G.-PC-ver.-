import { useEffect, useRef, useState } from "react";
import { useCore } from "../lib/useCore";
import { startMic, startWakeWord, voiceSupported, type MicSession } from "../lib/whisper";
import { speechSupported, startListening } from "../lib/speech";
import { Chatbox } from "./Chatbox";
import { HoloBar } from "./HoloBar";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * The hologram overlay app. It is rendered into a transparent, click-through window; we
 * flip the window to interactive only while the pointer is over a real UI card (elements
 * marked `data-interactive`), so ACTIG never blocks the desktop underneath (requirement 9).
 *
 * The emergency wake button (requirement 8) is always present here, independent of voice.
 */
export function App() {
  const core = useCore();
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const micRef = useRef<MicSession | null>(null);
  const legacyStopRef = useRef<(() => void) | null>(null);
  const startingRef = useRef(false);

  // Toggle overlay interactivity based on what the pointer is over.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const overUi = (e.target as HTMLElement)?.closest("[data-interactive]");
      window.actig.setInteractive(!!overUi);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Always-listening wake word ("wake up ACTIG") — active whenever the user's mic isn't muted
  // (requirement 6). The ⚡ button and Ctrl+Alt+Space remain instant alternatives.
  useEffect(() => {
    if (core.voice.userMicMuted || !voiceSupported()) return;
    const stop = startWakeWord(
      () => {
        core.setAwake(true);
        window.actig.send("wake", { source: "voice", greet: true });
      },
      (msg) => setVoiceStatus(msg),
    );
    return stop;
  }, [core.voice.userMicMuted]);

  function toggleMic() {
    // Second press → stop & transcribe.
    if (listening) {
      micRef.current?.stop();
      legacyStopRef.current?.();
      legacyStopRef.current = null;
      setListening(false);
      return;
    }
    core.interrupt(); // barge-in: stop any current speech before taking new input

    if (voiceSupported()) {
      if (startingRef.current) return;
      startingRef.current = true;
      setListening(true);
      void startMic(
        (text) => {
          core.sendInput(text, "voice");
          setListening(false);
        },
        (msg) => setVoiceStatus(msg),
        (err) => {
          setVoiceStatus(err);
          setListening(false);
          setTimeout(() => setVoiceStatus(""), 4000);
        },
      ).then((session) => {
        micRef.current = session;
        startingRef.current = false;
      });
      return;
    }

    // Fallback: Web Speech API where Whisper isn't available.
    if (!speechSupported()) {
      setVoiceStatus("Voice input isn't available on this device.");
      setTimeout(() => setVoiceStatus(""), 4000);
      return;
    }
    legacyStopRef.current = startListening((text, final) => {
      if (final) core.sendInput(text, "voice");
    });
    setListening(true);
  }

  return (
    <>
      {/* Emergency wake — always visible, works without voice (requirement 8). */}
      <div
        className="emergency"
        data-interactive
        title="Wake ACTIG"
        onClick={() => {
          core.setAwake(true);
          window.actig.send("wake", { source: "emergency", greet: true });
        }}
      >
        ⚡
      </div>

      {voiceStatus && (
        <div className="voice-status holo" data-interactive>
          {voiceStatus}
        </div>
      )}

      {/* When no reasoning provider is configured, prompt for a Claude key so ACTIG can reply. */}
      {!core.brain.ready && <BrainGate onSave={(k) => core.setSecret("ANTHROPIC_API_KEY", k)} />}

      <Chatbox lines={core.lines} onSend={(t) => core.sendInput(t, "text")} />

      <HoloBar
        voice={core.voice}
        listening={listening}
        onMic={toggleMic}
        onToggleUserMic={() => core.setMute("userMicMuted", !core.voice.userMicMuted)}
        onToggleAiSpeaker={() =>
          core.setMute("aiSpeakerMuted", !core.voice.aiSpeakerMuted)
        }
        onOpen3D={() => window.actig.openProject3D()}
      />

      {core.confirm && (
        <ConfirmDialog
          req={core.confirm}
          onApprove={(scope) => core.respondConfirm(true, scope)}
          onDeny={() => core.respondConfirm(false)}
        />
      )}
    </>
  );
}

/** One-time prompt to connect a brain (Claude API key) so ACTIG can actually reply. */
function BrainGate({ onSave }: { onSave: (key: string) => void }) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <div className="confirm holo" data-interactive style={{ top: "8%" }}>
      <div className="risk">connect a brain</div>
      <h3>ACTIG needs a Claude API key to reply</h3>
      <div style={{ fontSize: 13, lineHeight: 1.4 }}>
        Paste your <b>Claude API key</b> (from console.anthropic.com). It's stored{" "}
        <b>encrypted on this PC</b> and used to talk to Claude directly — no other setup needed.
      </div>
      <form
        className="chat-input"
        style={{ marginTop: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) {
            onSave(key.trim());
            setSaved(true);
          }
        }}
      >
        <input
          type="password"
          value={key}
          placeholder="sk-ant-…"
          onChange={(e) => setKey(e.target.value)}
        />
        <button className="approve" type="submit">
          Save
        </button>
      </form>
      {saved && <div className="meta">Checking your key… ACTIG will say when it's ready.</div>}
    </div>
  );
}
