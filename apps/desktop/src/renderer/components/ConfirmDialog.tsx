import type { ConfirmReq } from "../lib/useCore";

/**
 * One-tap confirmation for guarded access (security model). Shows exactly what will run and
 * its risk level; nothing executes until the user approves. "Always" pre-approves the tool
 * for the rest of the session.
 */
export function ConfirmDialog(props: {
  req: ConfirmReq;
  onApprove: (scope: "once" | "always") => void;
  onDeny: () => void;
}) {
  return (
    <div className="confirm holo" data-interactive>
      <div className="risk">{props.req.risk} action</div>
      <h3>ACTIG wants to run “{props.req.tool}”</h3>
      <div>{props.req.description}</div>
      <div className="row">
        <button className="deny" onClick={props.onDeny}>
          Cancel
        </button>
        <button onClick={() => props.onApprove("always")}>Always allow</button>
        <button className="approve" onClick={() => props.onApprove("once")}>
          Allow once
        </button>
      </div>
    </div>
  );
}
