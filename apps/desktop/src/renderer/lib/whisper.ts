/**
 * Local speech-to-text + wake word for the renderer, using Transformers.js (Whisper) running
 * on WASM/WebGPU — no Google key, no Python, no cloud STT. The library is loaded from a CDN as
 * an ESM module via a Vite-ignored dynamic import so it never has to bundle into the app (which
 * would risk the build); the tiny model (~40 MB) downloads once on first use and is cached by
 * the browser. Internet is required for that first download (ACTIG needs it for Claude anyway).
 *
 * Two entry points feed the SAME pipeline as typed text (requirement 14):
 *   - `startMic(onText)`   — push-to-talk: record until stopped, then transcribe.
 *   - `startWakeWord(...)` — always-listening loop that fires when it hears "wake up ACTIG".
 */

const CDN = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/+esm";
const MODEL = "Xenova/whisper-tiny.en";
const SAMPLE_RATE = 16000;

type Transcriber = (audio: Float32Array, opts?: any) => Promise<{ text: string }>;
let transcriberPromise: Promise<Transcriber> | null = null;

export function voiceSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof AudioContext !== "undefined" || "webkitAudioContext" in window)
  );
}

/** Lazily build (and cache) the Whisper pipeline. */
async function getTranscriber(onProgress?: (msg: string) => void): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      onProgress?.("Loading the voice model (first time only)…");
      const lib: any = await import(/* @vite-ignore */ CDN);
      lib.env.allowLocalModels = false; // always fetch from the HF hub + browser-cache it
      const pipe = await lib.pipeline("automatic-speech-recognition", MODEL);
      onProgress?.("");
      return (audio: Float32Array, opts?: any) => pipe(audio, opts);
    })().catch((e) => {
      transcriberPromise = null; // allow a later retry
      throw e;
    });
  }
  return transcriberPromise;
}

/** Decode a recorded blob to mono 16 kHz Float32 PCM that Whisper expects. */
async function blobToPcm(blob: Blob): Promise<Float32Array> {
  const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    if (buf.sampleRate === SAMPLE_RATE) return data.slice();
    // Simple linear resample to 16 kHz.
    const ratio = buf.sampleRate / SAMPLE_RATE;
    const out = new Float32Array(Math.floor(data.length / ratio));
    for (let i = 0; i < out.length; i++) out[i] = data[Math.floor(i * ratio)] || 0;
    return out;
  } finally {
    ctx.close().catch(() => {});
  }
}

async function recordChunk(stream: MediaStream, ms: number): Promise<Blob> {
  return new Promise((resolve) => {
    const rec = new MediaRecorder(stream);
    const parts: BlobPart[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => resolve(new Blob(parts, { type: rec.mimeType || "audio/webm" }));
    rec.start();
    setTimeout(() => rec.state !== "inactive" && rec.stop(), ms);
  });
}

export interface MicSession {
  stop(): void;
}

/**
 * Push-to-talk. Starts recording immediately; the returned `stop()` finalizes the recording,
 * transcribes it, and calls `onText` with the transcript (or `onError`).
 */
export async function startMic(
  onText: (text: string) => void,
  onStatus?: (msg: string) => void,
  onError?: (msg: string) => void,
): Promise<MicSession> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    onError?.("I couldn't access the microphone. Check Windows mic permissions for ACTIG.");
    return { stop() {} };
  }
  const rec = new MediaRecorder(stream);
  const parts: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => resolve(new Blob(parts, { type: rec.mimeType || "audio/webm" }));
  });
  rec.start();
  onStatus?.("Listening…");

  let finalized = false;
  const finalize = async () => {
    if (finalized) return;
    finalized = true;
    if (rec.state !== "inactive") rec.stop();
    const blob = await done;
    stream.getTracks().forEach((t) => t.stop());
    try {
      const transcribe = await getTranscriber(onStatus);
      onStatus?.("Transcribing…");
      const pcm = await blobToPcm(blob);
      const { text } = await transcribe(pcm);
      onStatus?.("");
      const clean = (text || "").trim();
      if (clean) onText(clean);
      else onError?.("I didn't catch that — try again.");
    } catch (e: any) {
      onError?.(`Voice recognition failed: ${e?.message || e}`);
    }
  };

  return { stop: () => void finalize() };
}

/**
 * Always-listening wake-word loop. Records short rolling windows, transcribes each with the
 * tiny model, and fires `onWake` when the transcript fuzzily matches "wake up ACTIG". Returns a
 * stop function. The ⚡ emergency button and Ctrl+Alt+Space remain as instant alternatives.
 */
export function startWakeWord(
  onWake: () => void,
  onError?: (msg: string) => void,
): () => void {
  let stopped = false;
  let stream: MediaStream | null = null;

  const matches = (t: string): boolean => {
    const s = t.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
    // tolerate STT spellings: actig / active / acting / a tig …
    return /\bwake up\b/.test(s) && /(actig|active|acting|a tig|attic|a tick)/.test(s);
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError?.("Wake-word listening needs microphone access (it's optional — use the ⚡ button).");
      return;
    }
    let transcribe: Transcriber;
    try {
      transcribe = await getTranscriber();
    } catch (e: any) {
      onError?.(`Couldn't load the wake-word model: ${e?.message || e}`);
      return;
    }
    while (!stopped) {
      try {
        const blob = await recordChunk(stream, 2600);
        if (stopped) break;
        const pcm = await blobToPcm(blob);
        const { text } = await transcribe(pcm);
        if (matches(text || "")) onWake();
      } catch {
        /* keep listening through transient errors */
      }
    }
  })();

  return () => {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  };
}
