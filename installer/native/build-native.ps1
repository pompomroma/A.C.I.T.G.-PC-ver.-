# Compiles wallpaper-host.exe. Run from a "Developer PowerShell for VS" (so cl.exe is on
# PATH), or it falls back to MinGW's gcc if available.
$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot "wallpaper-host.c"
$out = Join-Path $PSScriptRoot "wallpaper-host.exe"

if (Get-Command cl -ErrorAction SilentlyContinue) {
    & cl /nologo /O2 $src /Fe:$out user32.lib
    Remove-Item (Join-Path $PSScriptRoot "wallpaper-host.obj") -ErrorAction SilentlyContinue
}
elseif (Get-Command gcc -ErrorAction SilentlyContinue) {
    & gcc $src -o $out -luser32 -O2
}
else {
    throw "No C compiler found. Open 'Developer PowerShell for VS' or install MinGW (gcc)."
}
Write-Host "Built $out"
