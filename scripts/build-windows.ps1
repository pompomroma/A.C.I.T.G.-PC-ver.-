<#
  Turnkey local build of ACTIG-Setup.exe on Windows.
  Checks prerequisites, installs pnpm if missing, builds the native helper, then runs the
  packaging pipeline. Result: installer\output\ACTIG-Setup.exe

  Usage (from the repo root):
    powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1
  or just double-click  build.bat
#>
$ErrorActionPreference = "Stop"

# Self-elevate to Administrator. electron-builder unpacks a signing toolkit (winCodeSign)
# that contains macOS symlinks; creating symlinks on Windows needs admin privilege (or
# Developer Mode). Without it the build dies with "Cannot create symbolic link ...
# libcrypto.dylib". As a no-admin alternative, enable Developer Mode:
#   Settings -> Privacy & security -> For developers -> Developer Mode = On
$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Re-launching with administrator privileges (needed to unpack build tools)..." -ForegroundColor Yellow
  Start-Process powershell -Verb RunAs -ArgumentList @(
    "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`""
  )
  exit
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Need($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Missing prerequisite '$name'. $hint"
  }
}

# electron-builder unpacks very deep paths; a long project path overflows Windows' 260-char
# limit and breaks packaging. Warn early and point at the fix.
if ($root.Length -gt 90) {
  Write-Warning @"
This project is at a long path:
  $root
electron-builder may fail because Windows limits paths to 260 characters and it unpacks deep
node_modules/win-unpacked folders. If the build fails, MOVE this folder to a SHORT path such
as  C:\ACTIG  and run build.bat again. (Tip: extract the ZIP straight into C:\ , not a nested
Downloads subfolder.)
"@
}

# Never try to code-sign on a personal machine (no certificate) — it only causes failures.
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

Write-Host "==> Checking prerequisites..." -ForegroundColor Cyan
Need node   "Install Node.js 20+ from https://nodejs.org"
Need python "Install Python 3.11 from https://python.org and check 'Add to PATH'"

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "==> Installing pnpm..." -ForegroundColor Cyan
  npm install -g pnpm@9
}

Write-Host "==> Building native wallpaper helper (optional)..." -ForegroundColor Cyan
try { & "$root\installer\native\build-native.ps1" } catch { Write-Warning "Skipped: $_" }

# Set ACTIG_WITH_VOICE=1 before running this script to bundle the on-device voice stack.
Write-Host "==> Running packaging pipeline..." -ForegroundColor Cyan
node installer\build.mjs

$exe = Join-Path $root "installer\output\ACTIG-Setup.exe"
if (Test-Path $exe) {
  Write-Host "`n✅ Done: $exe" -ForegroundColor Green
  Write-Host "Copy that file to any Windows PC and double-click it to install ACTIG."
} else {
  Write-Warning @"
Build did not produce $exe.
If the error mentioned 'makensis.exe ENOENT', your antivirus most likely quarantined NSIS's
makensis.exe (a common false positive; frequent with AhnLab V3 / Windows Defender). Fix it by:
  • Adding a folder exclusion for  $env:LOCALAPPDATA\electron-builder\Cache
    (Windows Security -> Virus & threat protection -> Manage settings -> Exclusions),
    and the equivalent in AhnLab V3 if installed, then run build.bat again; OR
  • Temporarily turning off real-time protection and rerunning; OR
  • Skipping the build entirely and downloading the prebuilt installer from the repo's
    Releases page (v0.1.0) — it needs no local build.
"@
  throw "Build finished but $exe was not produced."
}
