import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  session,
  Tray,
} from "electron";
import { join } from "node:path";
import { enableAutostart } from "./autostart";
import { WallpaperManager } from "./wallpaper";
import { createOverlay, createProject3D, createWallpaper } from "./windows";
import { AgentService } from "./agent/service";

/**
 * ACTIG desktop shell entrypoint. Boots the in-process agent (no external backend), opens the
 * (hidden) hologram overlay, installs the tray + emergency-wake affordances + global wake
 * hotkey, and bridges messages between every renderer surface and the agent.
 *
 * The reasoning brain (NVIDIA Nemotron) now runs inside this main process (`./agent/*`), so chat works
 * with no separate Python process to start, crash, or be quarantined by antivirus.
 */

// Single-instance: a second launch just wakes the existing one.
if (!app.requestSingleInstanceLock()) app.quit();

let overlay: BrowserWindow | null = null;
let project3d: BrowserWindow | null = null;
let wallpaper: BrowserWindow | null = null;
let tray: Tray | null = null;

const wallpaperMgr = new WallpaperManager(join(process.resourcesPath || app.getAppPath(), "native"));

const agent = new AgentService(broadcast);

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
  // The renderer speaks "ACTIG at your service sir" when it receives this (req 7).
  overlay.webContents.send("core:message", {
    type: "wake",
    payload: { source, greet: true },
  });
}

function openProject3D(): void {
  if (!project3d) project3d = createProject3D();
  project3d.show();
  project3d.focus();
}

function closeProject3D(): void {
  project3d?.hide();
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

/** Renderer → main → agent. Renderers post these via the preload bridge. */
function wireIpc(): void {
  // Forward a fully-formed envelope from a renderer to the in-process agent.
  ipcMain.on("core:send", (_e, frame) => agent.handle(frame));

  // Toggle click-through so the overlay only intercepts the mouse over real UI (req 9).
  ipcMain.on("overlay:setInteractive", (_e, interactive: boolean) => {
    overlay?.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  ipcMain.on("project3d:open", () => openProject3D());
  ipcMain.on("project3d:close", () => closeProject3D());
  ipcMain.on("wallpaper:set", (_e, enabled: boolean) => toggleWallpaper(enabled));
  ipcMain.handle("app:version", () => app.getVersion());
}

/**
 * Electron blocks getUserMedia by default, so the wake word + voice input would get no audio.
 * Grant microphone/media to ACTIG's own windows (everything else stays default-deny).
 */
function grantMediaPermissions(): void {
  const allow = new Set(["media", "audioCapture", "microphone"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allow.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allow.has(permission));
}

app.whenReady().then(() => {
  enableAutostart();
  grantMediaPermissions();
  overlay = createOverlay();
  agent.setHost({ wake, openProject3D, closeProject3D, toggleWallpaper, broadcast });
  buildTray();
  wireIpc();
  agent.emitStatus(); // tell the overlay whether a brain is configured yet

  // Global wake hotkey works from any app/tab/screen (requirements 9, 15).
  globalShortcut.register("CommandOrControl+Alt+Space", () => wake("hotkey"));

  app.on("second-instance", () => wake("emergency"));
});

// Stay resident in the tray: subscribe but never quit when the overlay windows are hidden.
app.on("window-all-closed", () => {});
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
