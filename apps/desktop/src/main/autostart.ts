import { app } from "electron";

/**
 * Run-on-power-on (requirement 1) + permanence (req: "works permanently once inputted").
 *
 * Electron's `setLoginItemSettings` writes the HKCU Run key on Windows, which launches
 * ACTIG at every logon. The NSIS installer additionally registers a Task Scheduler job
 * (see installer/autostart) as a more robust fallback that survives some Run-key cleaners.
 * We start hidden (`--hidden`) so ACTIG comes up silently in the tray.
 */
export function enableAutostart(): void {
  if (!app.isPackaged) return; // don't litter the dev machine
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
    args: ["--hidden"],
  });
}

export function disableAutostart(): void {
  app.setLoginItemSettings({ openAtLogin: false });
}

export function isAutostartEnabled(): boolean {
  return app.getLoginItemSettings().openAtLogin;
}
