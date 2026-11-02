param([Parameter(Mandatory=$true)][string]$Installer,[Parameter(Mandatory=$true)][string]$Sha256)
$ErrorActionPreference='Stop'
$file=(Resolve-Path -LiteralPath $Installer).Path
Set-Location (Split-Path $PSScriptRoot -Parent)
& "$PSScriptRoot/scan-release.ps1" -Installer $file
$node=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if(!(Test-Path -LiteralPath $node)) { $node=(Get-Command node.exe -ErrorAction Stop).Source }
& $node node_modules/tsx/dist/cli.mjs scripts/publish-launcher-update.ts $file $Sha256
exit $LASTEXITCODE

