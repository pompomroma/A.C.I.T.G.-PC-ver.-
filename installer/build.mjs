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
// Portable mode builds the electron-builder `zip` target instead of NSIS. It needs no
// makensis.exe, so antivirus that quarantines makensis can't block it. The user unzips and
// runs ACTIG.exe, which self-registers autostart on first launch.
const portable = process.env.ACTIG_PORTABLE === "1";

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
// --no-frozen-lockfile: pnpm auto-enables frozen-lockfile under CI, which fails if a
// committed lockfile doesn't match the runner's pnpm resolution. We always allow the
// lockfile to be (re)generated so the build never fails on lockfile validation.
run("pnpm install --no-frozen-lockfile");
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
  if (portable) {
    // NSIS-free: build the zip target directly (bypasses the `package` script's nsis default).
    run("pnpm --filter @actig/desktop exec electron-vite build");
    run("pnpm --filter @actig/desktop exec electron-builder --win zip --publish never");
  } else {
    run("pnpm --filter @actig/desktop package");
  }
} catch (err) {
  console.error(
    "\n✗ electron-builder failed. Common causes on a personal PC:\n" +
      `  1. PATH TOO LONG — this project is at:\n       ${root}\n` +
      "     Move it to a SHORT path like C:\\ACTIG (no spaces/parentheses) and retry.\n" +
      "  2. ANTIVIRUS quarantined NSIS's makensis.exe ('makensis.exe ENOENT'). Run the\n" +
      "     antivirus-proof build instead: double-click build-portable.bat (makes a zip,\n" +
      "     no NSIS), or add a Defender/AhnLab exclusion for the electron-builder cache.\n" +
      "  3. NETWORK — first run downloads Electron + NSIS from GitHub; check your connection.\n" +
      "\n  Easiest of all: download the prebuilt ACTIG-Setup.exe from the repo's Releases page.\n",
  );
  throw err;
}

// 5. verify the deliverable
if (portable) {
  // win.artifactName in electron-builder.yml is `ACTIG-Setup.${ext}`, so the zip target
  // produces ACTIG-Setup.zip. Rename it to ACTIG-portable.zip for clarity.
  const builtZip = join(output, "ACTIG-Setup.zip");
  const finalZip = join(output, "ACTIG-portable.zip");
  if (existsSync(builtZip)) {
    rmSync(finalZip, { force: true });
    cpSync(builtZip, finalZip);
    console.log(
      `\n✅ Built ${finalZip}\n   Unzip it and run ACTIG.exe — it registers autostart on first launch.`,
    );
  } else {
    console.error(`\n✗ Expected ${builtZip} but it was not produced.`);
    process.exit(1);
  }
} else {
  const exe = join(output, "ACTIG-Setup.exe");
  if (existsSync(exe)) {
    console.log(`\n✅ Built ${exe}`);
  } else {
    console.error(
      `\n✗ Expected ${exe} but it was not produced. Check the electron-builder output above.`,
    );
    process.exit(1);
  }
}
