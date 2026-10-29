# Dev Run: builds and runs the working tree. -Main: builds and runs the committed
# main branch, exported to build\main-run, leaving the working tree untouched.
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
pnpm install
if ($LASTEXITCODE) { exit $LASTEXITCODE }
pnpm build
if ($LASTEXITCODE) { exit $LASTEXITCODE }
Start-Process "http://127.0.0.1:7480"
pnpm start
