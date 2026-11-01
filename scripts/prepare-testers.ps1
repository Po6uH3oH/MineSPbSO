param([string]$Profile=(Join-Path $env:APPDATA 'ModrinthApp/profiles/LAYER BETA 0.0.0'),[string]$Zip,[string]$Url)
$ErrorActionPreference='Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
if ([bool]$Zip -ne [bool]$Url) { throw 'Specify both -Zip and -Url, or neither.' }
& "$PSScriptRoot/prepare-tester-tls.ps1"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$runtime = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (!(Test-Path $runtime)) { $runtime=(Get-Command node.exe -ErrorAction Stop).Source }
$arguments=@('node_modules/tsx/dist/cli.mjs','scripts/prepare-testers.ts',$Profile)
if($Zip){ $arguments+=@($Zip,$Url) }
& $runtime @arguments
exit $LASTEXITCODE

