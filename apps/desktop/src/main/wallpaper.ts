import { BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * Live 3D wallpaper (requirement 17): render the 3D scene window *behind* the desktop
 * icons so it replaces the static wallpaper.
 *
 * Technique (Windows): Progman owns a hidden "WorkerW" window that sits between the desktop
 * icons and the wallpaper. Sending Progman the undocumented 0x052C message spawns a WorkerW;
 * we then reparent our borderless fullscreen Electron window under it. A tiny bundled native
 * helper (`wallpaper-host.exe`, built from the C snippet in installer/native) performs the
 * SetParent call given our HWND. We also snapshot the user's current wallpaper so it can be
 * restored on disable/uninstall.
 */
export class WallpaperManager {
  private original: string | null = null;

  constructor(private readonly helperDir: string) {}

  async enable(win: BrowserWindow): Promise<void> {
    if (process.platform !== "win32") return;
    this.original = await this.currentWallpaper();
    const hwndBuf = win.getNativeWindowHandle();
    const hwnd = hwndBuf.readBigUInt64LE
      ? hwndBuf.readBigUInt64LE(0).toString()
      : hwndBuf.readUInt32LE(0).toString();
    await this.runHelper(["attach", hwnd]);
    win.setSkipTaskbar(true);
  }

  async disable(): Promise<void> {
    if (process.platform !== "win32") return;
    await this.runHelper(["detach"]);
    if (this.original) await this.runHelper(["restore", this.original]);
  }

  private currentWallpaper(): Promise<string> {
    return new Promise((resolve) => {
      this.runHelper(["current"])
        .then((out) => resolve(out.trim()))
        .catch(() => resolve(""));
    });
  }

  private runHelper(args: string[]): Promise<string> {
    const exe = join(this.helperDir, "wallpaper-host.exe");
    return new Promise((resolve, reject) => {
      execFile(exe, args, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
  }
}
