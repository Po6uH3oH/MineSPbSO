param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference='Stop'
$file=(Resolve-Path -LiteralPath $Installer).Path
$status=Get-CimInstance -Namespace root/Microsoft/Windows/Defender -ClassName MSFT_MpComputerStatus
if(!$status.AntivirusEnabled){throw 'Defender Antivirus is inactive. No scan result.'}
$mp=Get-ChildItem "$env:ProgramData/Microsoft/Windows Defender/Platform/*/MpCmdRun.exe" | Where-Object {$_.Directory.Name -match '^\d'} | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if(!$mp){$mp=Get-Item "$env:ProgramFiles/Windows Defender/MpCmdRun.exe"}
$sha=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "Defender $($status.AntivirusSignatureVersion), SHA-256 $sha"
$result= & $mp.FullName -Scan -ScanType 3 -File $file -DisableRemediation 2>&1
$code=$LASTEXITCODE
$result | ForEach-Object {Write-Output $_}
$text=$result -join ' '
if($code -ne 0 -or $text -match 'skipped|пропущ' -or $text -notmatch 'found no threats|no threats found|угроз.*не обнаруж|не обнаружено угроз'){
 throw 'No confirmed threat-free scan. Release stopped.'
}
if((Get-FileHash -LiteralPath $file).Hash.ToLowerInvariant() -ne $sha){throw 'File changed during scan.'}

