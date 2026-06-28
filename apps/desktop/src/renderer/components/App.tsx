import { useEffect, useRef, useState } from "react";
import { useCore } from "../lib/useCore";
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
  const stopRef = useRef<(() => void) | null>(null);

  // Toggle overlay interactivity based on what the pointer is over.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const overUi = (e.target as HTMLElement)?.closest("[data-interactive]");
      window.actig.setInteractive(!!overUi);
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  function toggleMic() {
    if (listening) {
      stopRef.current?.();
      stopRef.current = null;
      setListening(false);
      return;
    }
    if (!speechSupported()) return;
    core.interrupt(); // barge-in: stop any current speech before taking new input
    stopRef.current = startListening((text, final) => {
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
      <h3>ACTIG needs a reasoning model to reply</h3>
      <div style={{ fontSize: 13, lineHeight: 1.4 }}>
        Paste your <b>Claude API key</b> (stored encrypted on this PC), or install{" "}
        <b>Ollama</b> + run <code>ollama pull llama3.1:8b</code> for a free local brain.
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
      {saved && <div className="meta">Saved — try sending a message.</div>}
    </div>
  );
}
