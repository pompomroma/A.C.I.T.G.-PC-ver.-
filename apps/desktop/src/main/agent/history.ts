import { app } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Append-only conversation + action history (requirement 1: "save all history").
 *
 * Stored as JSON-lines in `userData/history/turns.jsonl` — no database, no native deps, so
 * nothing can fail to start. Each line is one record: a user turn, an assistant turn, or a
 * tool action. `recent()` reloads the tail so a restarted session keeps its short-term memory.
 */

export interface HistoryRecord {
  ts: number;
  role: "user" | "assistant" | "tool";
  text: string;
  /** For tool records: the tool name + a short result summary. */
  tool?: string;
  lang?: string;
  source?: string;
}

function dir(): string {
  const d = join(app.getPath("userData"), "history");
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function logFile(): string {
  return join(dir(), "turns.jsonl");
}

export function append(rec: HistoryRecord): void {
  try {
    appendFileSync(logFile(), JSON.stringify(rec) + "\n", "utf8");
  } catch {
    /* history is best-effort; never block a reply on disk errors */
  }
}

/** Load the last `n` conversational turns (user/assistant) for context. */
export function recent(n = 20): HistoryRecord[] {
  try {
    const lines = readFileSync(logFile(), "utf8").trim().split("\n");
    const recs: HistoryRecord[] = [];
    for (const line of lines) {
      try {
        const r = JSON.parse(line) as HistoryRecord;
        if (r.role === "user" || r.role === "assistant") recs.push(r);
      } catch {
        /* skip malformed line */
      }
    }
    return recs.slice(-n);
  } catch {
    return [];
  }
}

/** Append a free-form line to the agent error log for diagnostics. */
export function logError(msg: string): void {
  try {
    const d = join(app.getPath("userData"), "logs");
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
    appendFileSync(join(d, "agent.log"), `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {
    /* ignore */
  }
}
