import { contextBridge, ipcRenderer } from "electron";

/**
 * Secure bridge between the (sandboxed) renderer surfaces and the main process. Renderers
 * never touch Node or the socket directly — they call `window.actig`. Every hologram window
 * (overlay, project3d, wallpaper) shares this same API.
 */
export interface ActigBridge {
  /** Send a protocol envelope to the agent core. */
  send(type: string, payload: unknown): void;
  /** Subscribe to core → UI messages. Returns an unsubscribe fn. */
  onMessage(cb: (msg: any) => void): () => void;
  /** Toggle whether the transparent overlay intercepts the mouse (over real UI only). */
  setInteractive(interactive: boolean): void;
  openProject3D(): void;
  closeProject3D(): void;
  setWallpaper(enabled: boolean): void;
  version(): Promise<string>;
}

const api: ActigBridge = {
  send(type, payload) {
    ipcRenderer.send("core:send", {
      id: Math.random().toString(36).slice(2),
      type,
      ts: Date.now(),
      payload,
    });
  },
  onMessage(cb) {
    const listener = (_e: unknown, msg: any) => cb(msg);
    ipcRenderer.on("core:message", listener);
    return () => ipcRenderer.removeListener("core:message", listener);
  },
  setInteractive(interactive) {
    ipcRenderer.send("overlay:setInteractive", interactive);
  },
  openProject3D() {
    ipcRenderer.send("project3d:open");
  },
  closeProject3D() {
    ipcRenderer.send("project3d:close");
  },
  setWallpaper(enabled) {
    ipcRenderer.send("wallpaper:set", enabled);
  },
  version() {
    return ipcRenderer.invoke("app:version");
  },
};

contextBridge.exposeInMainWorld("actig", api);
