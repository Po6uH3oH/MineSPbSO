$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$runtime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (!(Test-Path $runtime)) { $runtime = (Get-Command node.exe -ErrorAction Stop).Source }
& $runtime node_modules/tsx/dist/cli.mjs scripts/tester-bridge.ts
exit $LASTEXITCODE

