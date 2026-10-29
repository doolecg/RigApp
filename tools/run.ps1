# Dev Run: builds and runs the working tree as the desktop app. -Main: builds and runs
# the committed main branch, exported to build\main-run, leaving the working tree untouched.
param([switch]$Main)
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$dir = $root
if ($Main) {
    $dir = Join-Path $root "build\main-run"
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    New-Item -ItemType Directory $dir | Out-Null
    git -C $root archive main -o "$dir\main.zip"
    Expand-Archive "$dir\main.zip" $dir
    Remove-Item "$dir\main.zip"
}
Set-Location $dir
# Some shells run Electron as plain Node, which stops the app from starting.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm install
if ($LASTEXITCODE) { exit $LASTEXITCODE }
# Builds the web UI, the bundled server and the Electron app, then opens it behind your windows.
pnpm desktop
