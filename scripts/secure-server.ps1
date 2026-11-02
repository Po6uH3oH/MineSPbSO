param([Parameter(Mandatory=$true)][ValidateSet('configure','start')][string]$Action,[Parameter(Mandatory=$true)][string]$ServerDirectory)
$ErrorActionPreference='Stop'
$runtime=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if(!(Test-Path $runtime)){$runtime=(Get-Command node.exe -ErrorAction Stop).Source}
& $runtime (Join-Path $PSScriptRoot 'secure-server.mjs') $Action $ServerDirectory
exit $LASTEXITCODE

