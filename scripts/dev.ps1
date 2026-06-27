<#
  Run ACTIG straight from source — no installer needed. Good for trying it immediately.
  The Electron shell auto-spawns the Python agent core (see apps/desktop/src/main/backend.ts),
  so this just installs deps and launches the shell in dev mode.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { npm install -g pnpm@9 }

Write-Host "==> Installing Python agent core (editable)..." -ForegroundColor Cyan
python -m pip install -e "backend[windows,web]"

Write-Host "==> Installing JS deps..." -ForegroundColor Cyan
pnpm install

Write-Host "==> Launching ACTIG (Electron + auto-spawned core)..." -ForegroundColor Cyan
pnpm --filter '@actig/desktop' dev
