/**
 * LLM client for NVIDIA NIM — ACTIG's reasoning brain.
 *
 * NVIDIA's hosted inference (`integrate.api.nvidia.com`) speaks the OpenAI-compatible
 * Chat Completions API, so we POST directly with `fetch` from the Electron main process
 * (Node — no CORS, no SDK to bundle) using `Authorization: Bearer <nvapi-…>`. Tool use is the
 * OpenAI function-calling shape (`tools[].function`, `message.tool_calls`, `role:"tool"`).
 *
 * Model and key are read from the environment so the program is configured without editing
 * code (and so the live API key never lives in the repo): set `ACTIG_MODEL` / `ACTIG_API_KEY`,
 * or drop the key in `~/.actig/api_key`. Defaults target the Nemotron Ultra model.
 */

const API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

/**
 * NVIDIA model ids are namespaced (e.g. `nvidia/nemotron-3-ultra-550b-a55b`). A bare id with no
 * `/` is rejected with "model not found", so normalize anything from ACTIG_MODEL to be safe.
 */
function normalizeModel(id: string): string {
  const m = id.trim();
  return m.includes("/") ? m : `nvidia/${m}`;
}

/** Reasoning model id. Override with ACTIG_MODEL (the `nvidia/` prefix is added if you omit it). */
export const DEFAULT_MODEL = normalizeModel(process.env.ACTIG_MODEL || "nvidia/nemotron-3-ultra-550b-a55b");

/** Always-available fallback so ACTIG still replies if the primary model isn't on the user's key. */
export const FALLBACK_MODEL = "nvidia/llama-3.1-nemotron-70b-instruct";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** assistant turns that request tools */
  tool_calls?: ToolCall[];
  /** tool result turns reference the call they answer */
  tool_call_id?: string;
}

export interface FunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatResult {
  /** Visible answer text (with any <think> reasoning stripped). */
  text: string;
  /** Tool calls the model wants executed this turn. */
  toolCalls: ToolCall[];
  finishReason: string | null;
  /** The raw assistant message, replayed verbatim into the next request. */
  raw: ChatMessage;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: string,
  ) {
    super(message);
  }
}

/** Nemotron reasoning models can emit chain-of-thought in <think>…</think>; hide it from users. */
function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

/** Whether an API error means "this model id isn't available" (so we can fall back). */
function isModelNotFound(e: LlmError): boolean {
  if (e.status === 404) return true;
  const m = e.message.toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("does not exist") ||
    m.includes("unknown model") ||
    m.includes("not a valid model") ||
    m.includes("model_not_found") ||
    (e.status === 400 && m.includes("model"))
  );
}

export class LlmClient {
  /** Current model; may switch to FALLBACK_MODEL if the primary isn't available on this key. */
  model: string;

  constructor(
    private apiKey: string,
    model: string = DEFAULT_MODEL,
  ) {
    this.model = normalizeModel(model);
  }

  setKey(key: string): void {
    this.apiKey = key;
  }

  hasKey(): boolean {
    return !!this.apiKey?.trim();
  }

  private async post(body: Record<string, unknown>, timeoutMs = 120000): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e?.name === "AbortError")
        throw new LlmError("The model took too long to respond.", 0, "timeout");
      throw new LlmError(`Could not reach NVIDIA (no network?): ${e?.message || e}`, 0, "network");
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data?.detail || data?.error?.message || data?.message || res.statusText || "request failed";
      const kind = res.status === 401 || res.status === 403 ? "authentication" : "api";
      throw new LlmError(typeof msg === "string" ? msg : JSON.stringify(msg), res.status, kind);
    }
    return data;
  }

  /** One round-trip. Returns the reply text + any tool calls to execute. */
  async chat(opts: {
    system: string;
    messages: ChatMessage[];
    tools?: FunctionTool[];
    maxTokens?: number;
  }): Promise<ChatResult> {
    const body = (model: string) => ({
      model,
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
      ...(opts.tools && opts.tools.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
      temperature: 0.6,
      top_p: 0.95,
      max_tokens: opts.maxTokens ?? 1024,
      stream: false,
    });
    let data: any;
    try {
      data = await this.post(body(this.model));
    } catch (e) {
      // If the primary model isn't available on this key, fall back so ACTIG still replies.
      if (e instanceof LlmError && isModelNotFound(e) && this.model !== FALLBACK_MODEL) {
        this.model = FALLBACK_MODEL;
        data = await this.post(body(this.model));
      } else throw e;
    }
    const choice = data?.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    return {
      text: stripThink(typeof msg.content === "string" ? msg.content : ""),
      toolCalls,
      finishReason: choice.finish_reason ?? null,
      raw: { role: "assistant", content: msg.content ?? "", tool_calls: toolCalls.length ? toolCalls : undefined },
    };
  }

  /** Cheap validity check when a key is saved. Resolves to an error string or null. */
  async validate(): Promise<string | null> {
    if (!this.hasKey()) return "No API key set.";
    const ping = (model: string) =>
      this.post({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1, stream: false }, 20000);
    try {
      await ping(this.model);
      return null;
    } catch (e) {
      if (e instanceof LlmError) {
        if (e.kind === "authentication") return "That NVIDIA API key was rejected — check it and try again.";
        if (e.kind === "network" || e.kind === "timeout") return e.message;
        // A bad/unavailable model id must NOT make a valid key look rejected — fall back instead.
        if (isModelNotFound(e) && this.model !== FALLBACK_MODEL) {
          this.model = FALLBACK_MODEL;
          try {
            await ping(this.model);
            return null;
          } catch (e2) {
            return `Model error: ${e2 instanceof LlmError ? e2.message : String(e2)}`;
          }
        }
        return `Model error: ${e.message}`;
      }
      return String(e);
    }
  }
}
