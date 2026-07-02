import { spawn, ChildProcess } from "node:child_process";

/**
 * Voice output (TTS) for ACTIG, run from the MAIN process via Windows SAPI.
 *
 * The renderer's `window.speechSynthesis` is unreliable inside Electron (it often selects a voice
 * that produces no audio, especially "online/natural" voices), which is why replies weren't being
 * spoken. Speaking from the main process with PowerShell's `System.Speech.Synthesis` is the
 * dependable Windows path — it always produces sound on the default audio device.
 *
 * Text is passed as base64 so any characters/quotes/newlines/Unicode survive intact.
 */

let muted = false;
let current: ChildProcess | null = null;

export function setTtsMuted(m: boolean): void {
  muted = m;
  if (m) stopTts();
}

/** Stop any in-progress speech (barge-in / interrupt / mute). */
export function stopTts(): void {
  if (current) {
    current.kill();
    current = null;
  }
}

/** Speak the given text aloud (no-op when muted, empty, or off-Windows). */
export function speakTts(text: string): void {
  if (muted || !text?.trim() || process.platform !== "win32") return;
  stopTts(); // only one utterance at a time; newest wins
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const script = [
    "Add-Type -AssemblyName System.Speech;",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;",
    "try { $s.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female) } catch {};",
    "$s.Rate = -1;",
    `$t = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'));`,
    "$s.Speak($t);",
  ].join(" ");
  try {
    current = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
    });
    current.on("close", () => (current = null));
    current.on("error", () => (current = null));
  } catch {
    current = null;
  }
}
