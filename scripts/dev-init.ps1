$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$local = Join-Path $root '.local'
New-Item -ItemType Directory -Force $local | Out-Null
$secretBytes = [byte[]]::new(48)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($secretBytes)
$serverSecret = [Convert]::ToBase64String($secretBytes)
$envPath = Join-Path $root '.env.local'
if (Test-Path -LiteralPath $envPath) { throw '.env.local exists; preserve it or move it before initializing again.' }
$content = @"
NODE_ENV=development
DATABASE_URL=pglite:.local/accounts
SERVER_KEY=$serverSecret
SERVER_ID=local
PUBLIC_URL=http://127.0.0.1:3000
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_FROM=MineSPbSO <no-reply@localhost>
"@
[IO.File]::WriteAllText($envPath, $content)
$rsa = [Security.Cryptography.RSA]::Create(2048)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$rsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
$san = [Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
$san.AddDnsName('localhost')
$san.AddIpAddress([Net.IPAddress]::Loopback)
$request.CertificateExtensions.Add($san.Build())
$certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1),[DateTimeOffset]::UtcNow.AddDays(30))
$certPem = $certificate.ExportCertificatePem()
[IO.File]::WriteAllText((Join-Path $local 'localhost-cert.pem'),$certPem)
[IO.File]::WriteAllText((Join-Path $local 'localhost-key.pem'),$rsa.ExportPkcs8PrivateKeyPem())
$config = Get-Content (Join-Path $root 'config/launcher.example.json') -Raw | ConvertFrom-Json
$config.gatewayCA = $certPem
$config | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $root 'config/launcher.local.json') -Encoding utf8
$certificate.Dispose()
$rsa.Dispose()
Write-Output 'Local secrets and TLS certificate created. No certificate was added to the system trust store.'
