param([Parameter(Mandatory=$true)][string]$Login)
$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
if ($Login -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Укажите логин Яндекса без @yandex.ru.' }
if (!(Test-Path -LiteralPath (Join-Path $project '.env.local'))) { throw 'Не найдена .env.local. Сначала подготовьте локальный сервис аккаунтов.' }
$runtime = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (!(Test-Path -LiteralPath $runtime)) { $runtime = (Get-Command node.exe -ErrorAction Stop).Source }
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $runtime
$start.WorkingDirectory = $project
$start.Arguments = '--env-file=.env.local node_modules/tsx/dist/cli.mjs src/service/main.ts'
$start.UseShellExecute = $false
$start.EnvironmentVariables['SMTP_HOST'] = 'smtp.yandex.ru'
$start.EnvironmentVariables['SMTP_PORT'] = '465'
$start.EnvironmentVariables['SMTP_SECURE'] = 'true'
$start.EnvironmentVariables['SMTP_USER'] = $Login
$start.EnvironmentVariables['SMTP_FROM'] = "MineSPbSO <$Login@yandex.ru>"
$start.EnvironmentVariables['SMTP_VERIFY_ON_START'] = 'true'
$password = Read-Host 'Вставьте пароль приложения Яндекс Почты и нажмите Enter' -AsSecureString
if (!$password.Length) { throw 'Пароль пуст.' }
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
try {
 $start.EnvironmentVariables['SMTP_PASSWORD'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
 $service = [Diagnostics.Process]::Start($start)
} finally {
 [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
 $password.Dispose()
 $start.EnvironmentVariables.Remove('SMTP_PASSWORD')
}
$service.WaitForExit()
exit $service.ExitCode
