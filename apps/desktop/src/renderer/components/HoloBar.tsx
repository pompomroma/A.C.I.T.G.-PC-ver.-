import type { VoiceState } from "../lib/useCore";

/**
 * Bottom hologram control bar (requirement 5): mic-mute for the user AND for ACTIG's voice,
 * the 3D-project calling button (requirement 4/16), and a listen/interrupt control
 * (requirement 12). Every control here also has an equivalent voice command.
 */
export function HoloBar(props: {
  voice: VoiceState;
  listening: boolean;
  onToggleUserMic: () => void;
  onToggleAiSpeaker: () => void;
  onOpen3D: () => void;
  onMic: () => void;
}) {
  return (
    <div className="holobar holo" data-interactive>
      <div
        className={`holo-btn ${props.listening ? "active" : ""}`}
        title="Push to talk / interrupt"
        onClick={props.onMic}
      >
        🎙
      </div>
      <div
        className={`holo-btn ${props.voice.userMicMuted ? "muted" : ""}`}
        title="Mute my microphone"
        onClick={props.onToggleUserMic}
      >
        {props.voice.userMicMuted ? "🚫" : "🔉"}
      </div>
      <div
        className={`holo-btn ${props.voice.aiSpeakerMuted ? "muted" : ""}`}
        title="Mute ACTIG's voice"
        onClick={props.onToggleAiSpeaker}
      >
        {props.voice.aiSpeakerMuted ? "🔇" : "🔊"}
      </div>
      <div className="holo-btn" title="Open 3D project space" onClick={props.onOpen3D}>
        🧊
      </div>
    </div>
  );
}
