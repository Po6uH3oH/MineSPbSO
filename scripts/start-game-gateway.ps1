$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$runtime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (!(Test-Path $runtime)) { $runtime=(Get-Command node.exe -ErrorAction Stop).Source }
$env:TLS_CERT='.local/tester-keys/tls-cert.pem'
$env:TLS_KEY='.local/tester-keys/tls-private.pem'
$env:GATEWAY_HOST='127.0.0.1,10.99.52.8'
$env:GATEWAY_PORT='48905'
$env:MINECRAFT_PORT='48906'
& $runtime node_modules/tsx/dist/cli.mjs src/service/gateway.ts
exit $LASTEXITCODE

