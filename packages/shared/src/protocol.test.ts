import { describe, expect, it } from "vitest";
import { makeMessage, PROTOCOL_VERSION } from "./protocol";

describe("protocol", () => {
  it("wraps payloads in a well-formed envelope", () => {
    const m = makeMessage("user_input", { text: "hi", source: "text" });
    expect(m.type).toBe("user_input");
    expect(m.payload).toEqual({ text: "hi", source: "text" });
    expect(typeof m.id).toBe("string");
    expect(typeof m.ts).toBe("number");
  });

  it("honours a provided id for correlation", () => {
    const m = makeMessage("confirm_response", { callId: "x", approved: true }, "fixed-id");
    expect(m.id).toBe("fixed-id");
  });

  it("exposes a protocol version", () => {
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(1);
  });
});
