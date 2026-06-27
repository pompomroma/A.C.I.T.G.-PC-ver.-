import { useEffect, useRef, useState } from "react";
import type { ChatLine } from "../lib/useCore";

/**
 * Hologram chatbox (requirement 5): text in/out, plus the rich explanation set rendered
 * inline — ETA, error explanation, Q&A, and tappable option/recommendation chips
 * (requirement 1.(2-1..2-4), (3), (4)). Tapping a chip sends its command as a new input.
 */
export function Chatbox(props: {
  lines: ChatLine[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [props.lines]);

  return (
    <div className="chatbox holo" data-interactive>
      <div className="chat-log" ref={logRef}>
        {props.lines.map((l) => (
          <div key={l.id} className={`msg ${l.role}`}>
            <div>{l.text}</div>
            {l.role === "assistant" && <Meta line={l} onSend={props.onSend} />}
          </div>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          props.onSend(draft);
          setDraft("");
        }}
      >
        <input
          value={draft}
          placeholder="Talk or type to ACTIG…"
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
      </form>
    </div>
  );
}

function Meta({ line, onSend }: { line: ChatLine; onSend: (t: string) => void }) {
  const chips = [
    ...(line.options ?? []).map((o) => ({ ...o, kind: "option" as const })),
    ...(line.recommendations ?? []).map((o) => ({ ...o, kind: "recommendation" as const })),
  ];
  return (
    <div className="meta">
      {line.eta && <div>⏱ {line.eta}</div>}
      {line.qa && <div>❓ {line.qa}</div>}
      {line.errorExplanation && <div>⚠ {line.errorExplanation}</div>}
      {line.brain && <div style={{ opacity: 0.6 }}>via {line.brain}</div>}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <span
              key={c.id}
              className={`chip ${c.kind}`}
              onClick={() => onSend(c.command ?? c.label)}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
