/**
 * Browser-side voice helpers (requirements 2, 12, 15).
 *
 * The renderer can capture the user's voice with the Web Speech API as a low-latency path
 * that works on any screen, while the Python core's Whisper handles high-accuracy/offline
 * transcription. Either transcript is fed into the same `sendInput` pipeline as typed text.
 * `startListening` returns a stop fn; interim results enable barge-in style responsiveness.
 */

type SpeechResultCb = (text: string, final: boolean, lang: string) => void;

interface SR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
}

export function speechSupported(): boolean {
  return "webkitSpeechRecognition" in window || "SpeechRecognition" in window;
}

export function startListening(onResult: SpeechResultCb, lang = "en-US"): () => void {
  const Ctor =
    (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!Ctor) return () => {};
  const rec: SR = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e: any) => {
    const r = e.results[e.results.length - 1];
    onResult(r[0].transcript, r.isFinal, rec.lang);
  };
  rec.onerror = () => {};
  rec.start();
  return () => rec.stop();
}
