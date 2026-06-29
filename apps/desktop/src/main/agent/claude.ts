/**
 * Minimal Claude (Anthropic Messages API) client for the Electron main process.
 *
 * Runs in Node (not the browser), so we call the API directly with `fetch` and there is no
 * CORS to fight and no SDK dependency to bundle. This is the reasoning brain for ACTIG: the
 * renderer sends a turn, the agent loop calls `createMessage` here, and the reply is broadcast
 * back to every hologram surface.
 *
 * The model id is read from the `ACTIG_CLAUDE_MODEL` environment variable so it can be pointed
 * at any current Claude model (e.g. an Opus build) without changing code; it defaults to a
 * capable, fast, cost-effective current model that handles tool use well.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Default reasoning model. Override with the ACTIG_CLAUDE_MODEL env var (e.g. an Opus id). */
export const DEFAULT_MODEL = process.env.ACTIG_CLAUDE_MODEL || "claude-sonnet-4-6";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface CreateMessageResult {
  /** Concatenated text blocks of the reply. */
  text: string;
  /** Any tool_use blocks Claude wants executed this turn. */
  toolUses: Extract<ContentBlock, { type: "tool_use" }>[];
  /** Raw assistant content array (to replay back into the next request). */
  content: ContentBlock[];
  stopReason: string | null;
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: string,
  ) {
    super(message);
  }
}

export class ClaudeClient {
  constructor(
    private apiKey: string,
    readonly model = DEFAULT_MODEL,
  ) {}

  setKey(key: string): void {
    this.apiKey = key;
  }

  hasKey(): boolean {
    return !!this.apiKey?.trim();
  }

  private async post(body: Record<string, unknown>): Promise<any> {
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": API_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      throw new ClaudeError(
        `Could not reach Claude (no network?): ${e?.message || e}`,
        0,
        "network",
      );
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText || "request failed";
      const kind = data?.error?.type || (res.status === 401 ? "authentication" : "api");
      throw new ClaudeError(msg, res.status, kind);
    }
    return data;
  }

  /** One round-trip. Returns the reply text + any tool_use blocks to execute. */
  async createMessage(opts: {
    system: string;
    messages: ClaudeMessage[];
    tools?: ToolSpec[];
    maxTokens?: number;
  }): Promise<CreateMessageResult> {
    const data = await this.post({
      model: this.model,
      max_tokens: opts.maxTokens ?? 1024,
      system: opts.system,
      messages: opts.messages,
      ...(opts.tools && opts.tools.length ? { tools: opts.tools } : {}),
    });
    const content: ContentBlock[] = Array.isArray(data?.content) ? data.content : [];
    const text = content
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const toolUses = content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    return { text, toolUses, content, stopReason: data?.stop_reason ?? null };
  }

  /** Cheap validity check used when the user saves a key. Resolves to an error string or null. */
  async validate(): Promise<string | null> {
    if (!this.hasKey()) return "No API key set.";
    try {
      await this.post({
        model: this.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      });
      return null;
    } catch (e) {
      if (e instanceof ClaudeError) {
        if (e.kind === "authentication") return "That API key was rejected — check it and try again.";
        if (e.kind === "network") return e.message;
        return `Claude error: ${e.message}`;
      }
      return String(e);
    }
  }
}
