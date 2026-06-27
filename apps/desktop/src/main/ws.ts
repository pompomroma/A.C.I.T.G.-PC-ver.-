import { WebSocket } from "ws";

/**
 * Main-process WebSocket client to the agent core. It reconnects automatically and
 * forwards every core message to a sink (the window manager broadcasts to renderers).
 * Renderers never talk to the socket directly — they go through the preload bridge → main
 * → here, so a single authoritative connection serves all hologram surfaces.
 */
export class CoreSocket {
  private ws: WebSocket | null = null;
  private queue: string[] = [];
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly onMessage: (msg: any) => void,
    private readonly onOpen?: () => void,
  ) {}

  connect(): void {
    this.closed = false;
    this.ws = new WebSocket(this.url);
    this.ws.on("open", () => {
      for (const m of this.queue) this.ws!.send(m);
      this.queue = [];
      this.send("hello", { client: "desktop" });
      this.onOpen?.();
    });
    this.ws.on("message", (data) => {
      try {
        this.onMessage(JSON.parse(data.toString()));
      } catch {
        /* ignore malformed frame */
      }
    });
    this.ws.on("close", () => {
      if (!this.closed) setTimeout(() => this.connect(), 1500);
    });
    this.ws.on("error", () => this.ws?.close());
  }

  send(type: string, payload: unknown): void {
    const frame = JSON.stringify({
      id: Math.random().toString(36).slice(2),
      type,
      ts: Date.now(),
      payload,
    });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(frame);
    else this.queue.push(frame);
  }

  /** Forward a raw envelope already shaped by a renderer. */
  sendRaw(frame: any): void {
    const s = JSON.stringify(frame);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else this.queue.push(s);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}
