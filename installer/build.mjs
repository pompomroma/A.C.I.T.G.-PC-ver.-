#!/usr/bin/env node
/**
 * One-command packaging pipeline → produces a single `ACTIG-Setup.exe` (requirement:
 * "make the AI input-able to pc as file"). Steps:
 *
 *   1. Build the shared protocol + the Electron renderer/main/preload (electron-vite).
 *   2. Freeze the Python agent core into a standalone exe with PyInstaller.
 *   3. Stage the frozen core + native wallpaper helper for electron-builder's extraResources.
 *   4. Run electron-builder (NSIS) to emit installer/output/ACTIG-Setup.exe.
 *
 * Run on Windows for a Windows installer: `node installer/build.mjs`.
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "installer", "staging");
const run = (cmd, cwd = root) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: "inherit" });
};

// 0. clean staging
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "backend"), { recursive: true });
mkdirSync(join(staging, "native"), { recursive: true });

// 1. frontend
run("pnpm --filter @actig/shared build");
run("pnpm --filter @actig/desktop build");

// 2. freeze backend
run("pip install -e backend[voice,windows,web]");
run("pyinstaller --noconfirm installer/actig_backend.spec");
cpSync(join(root, "dist", "actig-core"), join(staging, "backend"), { recursive: true });

// 3. native wallpaper helper (prebuilt or compiled by build-native.ps1)
const helper = join(root, "installer", "native", "wallpaper-host.exe");
if (existsSync(helper)) cpSync(helper, join(staging, "native", "wallpaper-host.exe"));
else console.warn("⚠ wallpaper-host.exe not found — run installer/native/build-native.ps1 first.");

// 4. installer
run("pnpm --filter @actig/desktop package");

console.log("\n✅ Built installer/output/ACTIG-Setup.exe");
