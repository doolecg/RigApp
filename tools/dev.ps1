# Runs RigApp in dev mode: the server on 7480 restarts on save, the UI on
# http://localhost:7481 reloads on save. Ctrl+C stops both.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)
if (-not (Test-Path "node_modules")) {
    pnpm install
    if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
Write-Host "Open http://localhost:7481 once it says ready."
pnpm dev
