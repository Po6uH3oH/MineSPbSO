$ErrorActionPreference = 'Stop'
$dir = Join-Path (Split-Path $PSScriptRoot -Parent) '.local/tester-keys'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$cert = Join-Path $dir 'tls-cert.pem'
$key = Join-Path $dir 'tls-private.pem'
if ((Test-Path $cert) -and (Test-Path $key)) { Write-Output 'Existing test certificate retained.'; exit 0 }
if ((Test-Path $cert) -or (Test-Path $key)) { throw 'Certificate/key pair incomplete. Restore the missing file from backup.' }
$openssl = Join-Path $env:ProgramFiles 'Git/usr/bin/openssl.exe'
if (!(Test-Path $openssl)) { $openssl = (Get-Command openssl.exe -ErrorAction Stop).Source }
& $openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 365 -subj '/CN=MineSPbSO Test' -addext 'subjectAltName=IP:10.99.52.8,IP:127.0.0.1' -addext 'extendedKeyUsage=serverAuth' -keyout $key -out $cert
if ($LASTEXITCODE) { throw 'Certificate generation failed.' }

