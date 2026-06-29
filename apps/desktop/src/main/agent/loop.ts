import { LlmClient, LlmError, type ChatMessage } from "./llm";
import { append, logError, recent } from "./history";
import { FUNCTION_TOOLS, TOOL_BY_NAME, type ToolContext } from "./tools";

/**
 * The ACTIG agent loop, running in the Electron main process.
 *
 * A user turn → the model (NVIDIA Nemotron, with the guarded tool set) → execute any tool
 * calls (with one-tap confirmation for sensitive/system actions) → reply. It emits the same
 * `assistant_message`, `tool_call`, and `tool_result` envelopes the renderer already renders,
 * so no UI rewiring is needed. Replies are in the user's own language (the model mirrors it).
 */

const MAX_TOOL_ROUNDS = 6;
const BRAIN = "nemotron";

function systemPrompt(): string {
  return [
    "You are ACTIG, a Jarvis-style local AI assistant living on the user's Windows PC.",
    "You are warm, concise, and genuinely helpful — speak naturally, like a capable human assistant, not a manual.",
    "When the user wakes you, you greet them with 'ACTIG at your service sir'. Otherwise just help directly.",
    "Always reply in the SAME language the user wrote/spoke in.",
    "",
    "You can actually control this PC through your tools: open the 3D project space, add shapes,",
    "set the live 3D wallpaper, toggle the gesture camera, play music on the web, open apps, URLs and",
    "Windows settings, read/list/write files, report system info, and run commands.",
    "Use a tool whenever the user asks you to DO something on the PC — don't just describe it.",
    "Sensitive or system-level actions will ask the user for one-tap confirmation automatically; you do",
    "not need to ask permission yourself, just call the tool.",
    "Keep spoken replies short and natural since they are read aloud.",
  ].join("\n");
}

export interface RunDeps {
  client: LlmClient;
  ctx: ToolContext;
  broadcast(msg: { type: string; payload: unknown }): void;
  /** Returns true if the user barged in / interrupted; the loop stops cleanly. */
  aborted(): boolean;
}

let callSeq = 0;

/** Run one user turn to completion, broadcasting the reply and any tool activity. */
export async function runTurn(userText: string, source: string, deps: RunDeps): Promise<void> {
  const { client, ctx, broadcast } = deps;
  append({ ts: Date.now(), role: "user", text: userText, source });

  const history = recent(20);
  const messages: ChatMessage[] = history.map((h) => ({
    role: h.role === "assistant" ? "assistant" : "user",
    content: h.text,
  }));
  messages.push({ role: "user", content: userText });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (deps.aborted()) return;
      const reply = await client.chat({
        system: systemPrompt(),
        messages,
        tools: FUNCTION_TOOLS,
      });

      // No tools requested → final answer.
      if (reply.toolCalls.length === 0) {
        emitAssistant(broadcast, reply.text || "…");
        append({ ts: Date.now(), role: "assistant", text: reply.text });
        return;
      }

      // Speak/show any interim narration the model included alongside its tool calls.
      if (reply.text) emitAssistant(broadcast, reply.text);

      messages.push(reply.raw); // assistant turn carrying the tool_calls
      for (const tc of reply.toolCalls) {
        if (deps.aborted()) return;
        const tool = TOOL_BY_NAME.get(tc.function.name);
        const callId = `c${callSeq++}`;
        let args: any = {};
        try {
          args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
        } catch {
          /* leave args empty if the model produced invalid JSON */
        }
        if (!tool) {
          messages.push({ role: "tool", tool_call_id: tc.id, content: `Unknown tool ${tc.function.name}` });
          continue;
        }
        const summary = tool.describe(args);
        broadcast({ type: "tool_call", payload: { callId, tool: tc.function.name, summary, risk: tool.risk, args } });

        // Guard: sensitive/system actions need explicit user approval.
        if (tool.risk === "sensitive" || tool.risk === "system") {
          const approved = await ctx.confirm(tc.function.name, summary, tool.risk);
          if (!approved) {
            broadcast({ type: "tool_result", payload: { callId, ok: false, summary: "Declined by user" } });
            messages.push({ role: "tool", tool_call_id: tc.id, content: "The user declined this action." });
            continue;
          }
        }

        try {
          const out = await tool.run(args, ctx);
          broadcast({ type: "tool_result", payload: { callId, ok: true, summary } });
          append({ ts: Date.now(), role: "tool", text: out.slice(0, 500), tool: tc.function.name });
          messages.push({ role: "tool", tool_call_id: tc.id, content: out });
        } catch (e: any) {
          const err = e?.message || String(e);
          broadcast({ type: "tool_result", payload: { callId, ok: false, summary, error: err } });
          messages.push({ role: "tool", tool_call_id: tc.id, content: `error: ${err}` });
        }
      }
    }
    // Ran out of tool rounds without a final text reply.
    emitAssistant(broadcast, "I've done what I can on that — let me know how you'd like to continue.");
  } catch (e) {
    handleError(e, broadcast);
  }
}

function emitAssistant(broadcast: RunDeps["broadcast"], text: string): void {
  broadcast({ type: "assistant_message", payload: { text, lang: "en", brain: BRAIN } });
}

function handleError(e: unknown, broadcast: RunDeps["broadcast"]): void {
  let text: string;
  if (e instanceof LlmError) {
    if (e.kind === "authentication") text = "My NVIDIA API key was rejected. Please set a valid key.";
    else if (e.kind === "network") text = "I can't reach NVIDIA right now — check your internet connection and try again.";
    else if (e.kind === "timeout") text = "The model took too long to respond — please try again.";
    else if (e.status === 429) text = "The model is rate-limited at the moment. Please try again in a few seconds.";
    else text = `The model returned an error: ${e.message}`;
  } else {
    text = `Something went wrong handling that: ${(e as any)?.message || e}`;
  }
  logError(text);
  broadcast({ type: "assistant_message", payload: { text, lang: "en", brain: BRAIN, errorExplanation: text } });
}
