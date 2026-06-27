#!/usr/bin/env node
/**
 * One-command packaging pipeline → produces a single `installer/output/ACTIG-Setup.exe`
 * (requirement: "make the AI input-able to pc as file").
 *
 * It is self-contained: it installs JS + Python build deps itself, so on a Windows machine
 * with just Node, Python 3.11 and pnpm you can run:
 *
 *     node installer/build.mjs
 *
 * Steps: install deps → build shared+renderer → freeze the Python core (PyInstaller) →
 * stage frozen core + native helper → electron-builder (NSIS) → verify the .exe exists.
 *
 * Env toggles:
 *   ACTIG_WITH_VOICE=1   also bundle the on-device voice stack (whisper/piper/openwakeword).
 *                        Off by default so the build is fast/robust; without it ACTIG still
 *                        does text + browser speech + OS (SAPI) TTS, just no custom wake word.
 *   PYTHON=...           python executable to use (default: python).
 */
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const staging = join(root, "installer", "staging");
const output = join(root, "installer", "output");
const PY = process.env.PYTHON || "python";
const withVoice = process.env.ACTIG_WITH_VOICE === "1";

function run(cmd, { cwd = root, optional = false } = {}) {
  console.log(`\n$ ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
    return true;
  } catch (err) {
    if (optional) {
      console.warn(`⚠ optional step failed (continuing): ${cmd}`);
      return false;
    }
    throw err;
  }
}

// 0. clean staging / ensure output dir
rmSync(staging, { recursive: true, force: true });
mkdirSync(join(staging, "backend"), { recursive: true });
mkdirSync(join(staging, "native"), { recursive: true });
mkdirSync(output, { recursive: true });

// 1. JS deps + shared protocol build
run("pnpm install");
run("pnpm --filter @actig/shared build", { optional: true });

// 2. Python build deps + freeze the agent core
run(`${PY} -m pip install --upgrade pip`);
run(`${PY} -m pip install pyinstaller`);
const extras = withVoice ? "voice,windows,web" : "windows,web";
// On non-Windows dev machines the [windows] extra resolves to nothing (markers), which is
// fine — you just can't produce a *Windows* exe off Windows; use CI for that.
run(`${PY} -m pip install -e "backend[${extras}]"`);
run(`${PY} -m PyInstaller --noconfirm installer/actig_backend.spec`);

const frozen = join(root, "dist", "actig-core");
if (!existsSync(frozen)) {
  console.error("✗ PyInstaller did not produce dist/actig-core — aborting.");
  process.exit(1);
}
cpSync(frozen, join(staging, "backend"), { recursive: true });

// 3. native wallpaper helper (built by installer/native/build-native.ps1; optional)
const helper = join(root, "installer", "native", "wallpaper-host.exe");
if (existsSync(helper)) {
  cpSync(helper, join(staging, "native", "wallpaper-host.exe"));
} else {
  console.warn(
    "⚠ wallpaper-host.exe not found — live-wallpaper mode will be unavailable.\n" +
      "  Build it with: pwsh installer/native/build-native.ps1",
  );
}

// 4. electron-builder → NSIS installer
// Earlier failed/non-elevated runs can leave a partial electron-builder cache (e.g. an
// nsis-*/Bin folder missing makensis.exe), which then fails with "makensis.exe ENOENT".
// On a local Windows build, wipe that cache so NSIS + winCodeSign re-extract cleanly. The
// big Electron binary lives in a separate cache (%LOCALAPPDATA%\electron\Cache) and is left
// alone, so this only re-fetches a few small archives. CI keeps its cache (reused across the
// standard + voice builds), so skip there.
if (!process.env.CI && process.platform === "win32" && process.env.LOCALAPPDATA) {
  const ebCache = join(process.env.LOCALAPPDATA, "electron-builder", "Cache");
  if (existsSync(ebCache)) {
    console.log(`\nClearing electron-builder cache (avoids stale/partial NSIS): ${ebCache}`);
    rmSync(ebCache, { recursive: true, force: true });
  }
}

// Never attempt code-signing on a personal PC (no cert) — it only causes failures.
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
try {
  run("pnpm --filter @actig/desktop package");
} catch (err) {
  console.error(
    "\n✗ electron-builder failed. The two common causes on a personal PC are:\n" +
      `  1. PATH TOO LONG — this project is at:\n       ${root}\n` +
      "     electron-builder unpacks deep node_modules/win-unpacked paths that exceed\n" +
      "     Windows' 260-char limit. Move the project to a SHORT path like C:\\ACTIG and retry.\n" +
      "  2. NETWORK — on first run electron-builder downloads Electron + NSIS from GitHub.\n" +
      "     Check your internet/proxy and run it again.\n" +
      "\n  Easiest alternative: skip building and download the prebuilt ACTIG-Setup.exe from\n" +
      "  the repo's Releases page (the 'ACTIG latest build' release).\n",
  );
  throw err;
}

// 5. verify the deliverable
const exe = join(output, "ACTIG-Setup.exe");
if (existsSync(exe)) {
  console.log(`\n✅ Built ${exe}`);
} else {
  console.error(
    `\n✗ Expected ${exe} but it was not produced. Check the electron-builder output above.`,
  );
  process.exit(1);
}
