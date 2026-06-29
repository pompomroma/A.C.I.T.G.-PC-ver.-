import { ClaudeClient, ClaudeError, type ClaudeMessage, type ContentBlock } from "./claude";
import { append, logError, recent } from "./history";
import { TOOL_BY_NAME, TOOL_SPECS, type ToolContext } from "./tools";

/**
 * The ACTIG agent loop, running in the Electron main process.
 *
 * A user turn → Claude (with the guarded tool set) → execute any tool calls (with one-tap
 * confirmation for sensitive/system actions) → reply. It emits the same `assistant_message`,
 * `tool_call`, and `tool_result` envelopes the renderer already knows how to display, so no UI
 * rewiring is needed. Replies are in the user's own language (Claude mirrors it).
 */

const MAX_TOOL_ROUNDS = 6;

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
  client: ClaudeClient;
  ctx: ToolContext;
  broadcast(msg: { type: string; payload: unknown }): void;
  /** Returns true if the user barged in / interrupted; the loop stops cleanly. */
  aborted(): boolean;
}

let callSeq = 0;

/** Run one user turn to completion, broadcasting the reply and any tool activity. */
export async function runTurn(
  userText: string,
  source: string,
  deps: RunDeps,
): Promise<void> {
  const { client, ctx, broadcast } = deps;
  append({ ts: Date.now(), role: "user", text: userText, source });

  // Build the conversation from recent history (already includes nothing of this turn yet).
  const history = recent(20);
  const messages: ClaudeMessage[] = history.map((h) => ({
    role: h.role === "assistant" ? "assistant" : "user",
    content: h.text,
  }));
  messages.push({ role: "user", content: userText });

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (deps.aborted()) return;
      const reply = await client.createMessage({
        system: systemPrompt(),
        messages,
        tools: TOOL_SPECS,
      });

      // No tools requested → final answer.
      if (reply.toolUses.length === 0) {
        emitAssistant(broadcast, reply.text || "…");
        append({ ts: Date.now(), role: "assistant", text: reply.text });
        return;
      }

      // Speak/show any interim narration Claude included alongside its tool calls.
      if (reply.text) emitAssistant(broadcast, reply.text);

      messages.push({ role: "assistant", content: reply.content });
      const results: ContentBlock[] = [];
      for (const tu of reply.toolUses) {
        if (deps.aborted()) return;
        const tool = TOOL_BY_NAME.get(tu.name);
        const callId = `c${callSeq++}`;
        if (!tool) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `Unknown tool ${tu.name}`, is_error: true });
          continue;
        }
        const summary = tool.describe(tu.input);
        broadcast({ type: "tool_call", payload: { callId, tool: tu.name, summary, risk: tool.risk, args: tu.input } });

        // Guard: sensitive/system actions need explicit user approval.
        if (tool.risk === "sensitive" || tool.risk === "system") {
          const approved = await ctx.confirm(tu.name, summary, tool.risk);
          if (!approved) {
            broadcast({ type: "tool_result", payload: { callId, ok: false, summary: "Declined by user" } });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: "The user declined this action.", is_error: true });
            continue;
          }
        }

        try {
          const out = await tool.run(tu.input, ctx);
          broadcast({ type: "tool_result", payload: { callId, ok: true, summary } });
          append({ ts: Date.now(), role: "tool", text: out.slice(0, 500), tool: tu.name });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
        } catch (e: any) {
          const err = e?.message || String(e);
          broadcast({ type: "tool_result", payload: { callId, ok: false, summary, error: err } });
          results.push({ type: "tool_result", tool_use_id: tu.id, content: `error: ${err}`, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    // Ran out of tool rounds without a final text reply.
    emitAssistant(broadcast, "I've done what I can on that — let me know how you'd like to continue.");
  } catch (e) {
    handleError(e, broadcast);
  }
}

function emitAssistant(broadcast: RunDeps["broadcast"], text: string): void {
  broadcast({ type: "assistant_message", payload: { text, lang: "en", brain: "claude" } });
}

function handleError(e: unknown, broadcast: RunDeps["broadcast"]): void {
  let text: string;
  if (e instanceof ClaudeError) {
    if (e.kind === "authentication") text = "My API key was rejected. Please re-enter a valid Claude API key.";
    else if (e.kind === "network") text = "I can't reach Claude right now — check your internet connection and try again.";
    else if (e.status === 429) text = "Claude is rate-limited at the moment. Please try again in a few seconds.";
    else text = `Claude returned an error: ${e.message}`;
  } else {
    text = `Something went wrong handling that: ${(e as any)?.message || e}`;
  }
  logError(text);
  broadcast({ type: "assistant_message", payload: { text, lang: "en", brain: "claude", errorExplanation: text } });
}
