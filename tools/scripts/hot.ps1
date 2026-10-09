# Windows entry. Linux and macOS: ./scripts/hot.sh
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)

$running = docker inspect -f '{{.State.Running}}' claudi-mmo-50 2>$null
if ($running -ne 'true') {
  docker start claudi-mmo-50 | Out-Null
}

$env:GAME_PORT = '3002'
npm run dev
