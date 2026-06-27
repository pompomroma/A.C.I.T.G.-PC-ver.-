import { BrowserWindow, screen } from "electron";
import { join } from "node:path";

const PRELOAD = join(__dirname, "../preload/index.js");
const isDev = !!process.env["ELECTRON_RENDERER_URL"];

function load(win: BrowserWindow, page: "overlay" | "project3d" | "wallpaper"): void {
  if (isDev) {
    win.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${page}.html`);
  } else {
    win.loadFile(join(__dirname, `../renderer/${page}.html`));
  }
}

/**
 * The hologram overlay (requirements 5, 8, 9): transparent, frameless, always-on-top, and
 * able to float over apps/web/desktop. It is created click-through by default so it never
 * blocks the user; the renderer toggles interactivity (via setIgnoreMouseEvents) only over
 * actual UI regions.
 */
export function createOverlay(): BrowserWindow {
  const { bounds } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  });
  win.setAlwaysOnTop(true, "screen-saver"); // float above fullscreen apps where allowed
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true }); // pass-through until renderer asks
  load(win, "overlay");
  return win;
}

/** The 3D modeling project space (requirements 4, 16). */
export function createProject3D(): BrowserWindow {
  const { bounds } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    width: Math.round(bounds.width * 0.9),
    height: Math.round(bounds.height * 0.9),
    transparent: true,
    frame: false,
    backgroundColor: "#00000000",
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  });
  load(win, "project3d");
  return win;
}

/** The wallpaper-mode window (requirement 17) — fullscreen, reparented under WorkerW. */
export function createWallpaper(): BrowserWindow {
  const { bounds } = screen.getPrimaryDisplay();
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: false },
  });
  load(win, "wallpaper");
  return win;
}
