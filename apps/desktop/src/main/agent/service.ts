import { LlmClient } from "./llm";
import { runTurn } from "./loop";
import { API_KEY_NAME, resolveApiKey, setSecret } from "./secrets";
import type { AgentHost, RiskLevel, ToolContext } from "./tools";

/**
 * The in-process agent service. It receives the same `{id,type,ts,payload}` envelopes the
 * renderer used to send over WebSocket to the Python core, and answers them directly with the
 * NVIDIA Nemotron brain — so the app no longer depends on any external process to reply.
 *
 * Wire-up in main/index.ts:  ipcMain.on("core:send", (_e, frame) => agent.handle(frame));
 * It broadcasts replies back through the existing `core:message` channel via `broadcast`.
 */
export class AgentService {
  private client: LlmClient;
  private host: AgentHost | null = null;
  private pendingConfirms = new Map<string, (approved: boolean) => void>();
  private interrupted = false;
  private busy = false;
  private confirmSeq = 0;

  constructor(private broadcast: (msg: { type: string; payload: unknown }) => void) {
    this.client = new LlmClient(resolveApiKey());
  }

  setHost(host: AgentHost): void {
    this.host = host;
  }

  /** Tell the UI whether a reasoning brain is ready (drives the BrainGate prompt). */
  emitStatus(message?: string): void {
    const ready = this.client.hasKey();
    this.broadcast({
      type: "status",
      payload: {
        ok: ready,
        components: { brain: ready ? "ready" : "down", system: "ready" },
        message: message ?? (ready ? "ACTIG is ready." : "Add an NVIDIA API key so ACTIG can reply."),
      },
    });
  }

  /** Entry point for every renderer envelope. */
  handle(frame: any): void {
    const type = frame?.type;
    const p = frame?.payload || {};
    switch (type) {
      case "hello":
      case "get_status":
        this.emitStatus();
        break;
      case "user_input":
        void this.onUserInput(String(p.text || ""), String(p.source || "text"));
        break;
      case "set_secret":
        void this.onSetSecret(String(p.key || ""), String(p.value || ""));
        break;
      case "confirm_response":
        this.resolveConfirm(String(p.callId || ""), !!p.approved);
        break;
      case "interrupt":
        this.interrupted = true;
        break;
      case "wake":
        this.host?.wake((p.source as any) || "text");
        break;
      // voice_state / sleep are renderer-local; nothing to do server-side.
    }
  }

  private async onSetSecret(key: string, value: string): Promise<void> {
    if (!key || !value) return;
    // Accept either the canonical name or whatever the UI sends for the API key.
    const isApiKey = key === API_KEY_NAME || /api[_-]?key/i.test(key) || /nvapi/i.test(value);
    setSecret(isApiKey ? API_KEY_NAME : key, value);
    if (isApiKey) {
      this.client.setKey(value);
      this.emitStatus("Checking your NVIDIA API key…");
      const err = await this.client.validate();
      if (err) {
        this.emitStatus(err);
        this.broadcast({
          type: "assistant_message",
          payload: { text: err, lang: "en", brain: "nemotron", errorExplanation: err },
        });
      } else {
        this.emitStatus("API key accepted — ACTIG is ready.");
        this.broadcast({
          type: "assistant_message",
          payload: { text: "Brain connected. I'm ready, sir — how can I help?", lang: "en", brain: "nemotron" },
        });
      }
    }
  }

  private async onUserInput(text: string, source: string): Promise<void> {
    if (!text.trim()) return;
    if (!this.client.hasKey()) {
      this.emitStatus();
      this.broadcast({
        type: "assistant_message",
        payload: {
          text: "I don't have a brain connected yet. Add your NVIDIA API key (panel above) and I'll be ready.",
          lang: "en",
        },
      });
      return;
    }
    if (this.busy) this.interrupted = true; // barge-in: drop the in-flight turn
    this.busy = true;
    this.interrupted = false;
    const ctx: ToolContext = {
      host: this.host!,
      confirm: (tool, description, risk) => this.requestConfirm(tool, description, risk),
    };
    try {
      await runTurn(text, source, {
        client: this.client,
        ctx,
        broadcast: this.broadcast,
        aborted: () => this.interrupted,
      });
    } finally {
      this.busy = false;
    }
  }

  private requestConfirm(tool: string, description: string, risk: RiskLevel): Promise<boolean> {
    const callId = `cf${this.confirmSeq++}`;
    this.broadcast({ type: "confirm_request", payload: { callId, tool, description, risk } });
    return new Promise<boolean>((resolve) => {
      this.pendingConfirms.set(callId, resolve);
      // Safety timeout: if the user never answers, treat as declined after 2 minutes.
      setTimeout(() => {
        if (this.pendingConfirms.delete(callId)) resolve(false);
      }, 120000);
    });
  }

  private resolveConfirm(callId: string, approved: boolean): void {
    const resolve = this.pendingConfirms.get(callId);
    if (resolve) {
      this.pendingConfirms.delete(callId);
      resolve(approved);
    }
  }
}
