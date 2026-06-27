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
