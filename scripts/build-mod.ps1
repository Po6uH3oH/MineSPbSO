$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bundledJdk = Join-Path $root '.local/tools/jdk'
if (Test-Path $bundledJdk) { $env:JAVA_HOME = (Get-ChildItem $bundledJdk -Directory | Select-Object -First 1).FullName }
$env:GRADLE_USER_HOME = Join-Path $root '.local/gradle-cache'
$bundledGradle = Join-Path $root '.local/tools/gradle/gradle-8.14.3/bin/gradle.bat'
if (Test-Path $bundledGradle) { & $bundledGradle -p (Join-Path $root 'mods') build --no-daemon } else { & gradle -p (Join-Path $root 'mods') build --no-daemon }
exit $LASTEXITCODE
