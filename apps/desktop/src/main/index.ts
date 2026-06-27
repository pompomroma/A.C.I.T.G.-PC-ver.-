import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Tray,
} from "electron";
import { join } from "node:path";
import { BackendProcess } from "./backend";
import { CoreSocket } from "./ws";
import { enableAutostart } from "./autostart";
import { WallpaperManager } from "./wallpaper";
import { createOverlay, createProject3D, createWallpaper } from "./windows";

/**
 * ACTIG desktop shell entrypoint. Boots the agent core, opens the (hidden) hologram
 * overlay, installs the tray + emergency-wake affordances + global wake hotkey, and bridges
 * messages between every renderer surface and the single core WebSocket.
 */

// Single-instance: a second launch just wakes the existing one.
if (!app.requestSingleInstanceLock()) app.quit();

let overlay: BrowserWindow | null = null;
let project3d: BrowserWindow | null = null;
let wallpaper: BrowserWindow | null = null;
let tray: Tray | null = null;

const backend = new BackendProcess();
const wallpaperMgr = new WallpaperManager(join(process.resourcesPath || app.getAppPath(), "native"));

const socket = new CoreSocket(backend.url, (msg) => broadcast(msg));

function broadcast(msg: unknown): void {
  for (const w of [overlay, project3d, wallpaper]) {
    if (w && !w.isDestroyed()) w.webContents.send("core:message", msg);
  }
}

/** Show the hologram overlay over whatever is on screen (requirement 9). */
function wake(source: "voice" | "emergency" | "hotkey" | "text"): void {
  if (!overlay) overlay = createOverlay();
  overlay.showInactive();
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.webContents.send("core:message", {
    type: "wake",
    payload: { source, greet: true },
  });
  // Ask the core to perform the spoken reaction "ACTIG at your service sir" (req 7).
  socket.send("wake", { source, greet: true });
}

function openProject3D(): void {
  if (!project3d) project3d = createProject3D();
  project3d.show();
  project3d.focus();
}

async function toggleWallpaper(enabled: boolean): Promise<void> {
  if (!wallpaper) wallpaper = createWallpaper();
  if (enabled) {
    wallpaper.show();
    await wallpaperMgr.enable(wallpaper);
  } else {
    await wallpaperMgr.disable();
    wallpaper.hide();
  }
}

function buildTray(): void {
  const icon = nativeImage.createFromPath(
    join(__dirname, "../../resources/tray.png"),
  );
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("ACTIG — at your service");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Wake ACTIG", click: () => wake("emergency") },
      { label: "Open 3D Project", click: () => openProject3D() },
      { label: "3D Wallpaper", type: "checkbox", click: (m) => toggleWallpaper(m.checked) },
      { type: "separator" },
      { label: "Quit ACTIG", click: () => app.quit() },
    ]),
  );
  // Clicking the tray icon is also an emergency wake (requirement 8).
  tray.on("click", () => wake("emergency"));
}

/** Renderer → main → core. Renderers post these via the preload bridge. */
function wireIpc(): void {
  // Forward a fully-formed envelope from a renderer to the core.
  ipcMain.on("core:send", (_e, frame) => socket.sendRaw(frame));

  // Toggle click-through so the overlay only intercepts the mouse over real UI (req 9).
  ipcMain.on("overlay:setInteractive", (_e, interactive: boolean) => {
    overlay?.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  ipcMain.on("project3d:open", () => openProject3D());
  ipcMain.on("project3d:close", () => project3d?.hide());
  ipcMain.on("wallpaper:set", (_e, enabled: boolean) => toggleWallpaper(enabled));
  ipcMain.handle("app:version", () => app.getVersion());
}

app.whenReady().then(() => {
  enableAutostart();
  backend.start();
  socket.connect();
  overlay = createOverlay();
  buildTray();
  wireIpc();

  // Global wake hotkey works from any app/tab/screen (requirements 9, 15).
  globalShortcut.register("CommandOrControl+Alt+Space", () => wake("hotkey"));

  app.on("second-instance", () => wake("emergency"));
});

app.on("window-all-closed", (e: Electron.Event) => e.preventDefault()); // stay resident in tray
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  socket.close();
  backend.stop();
});
