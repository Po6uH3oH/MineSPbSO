param([Parameter(Mandatory=$true)][string]$OutputZip)
$ErrorActionPreference='Stop'
$directory=Join-Path (Split-Path $PSScriptRoot -Parent) '.local/tester-distribution'
$envelope=Get-Content -Raw -LiteralPath (Join-Path $directory 'current.json') | ConvertFrom-Json
$manifest=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.payload)) | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression
$handle=[IO.File]::Open([IO.Path]::GetFullPath($OutputZip),[IO.FileMode]::CreateNew)
try {
  $zip=[IO.Compression.ZipArchive]::new($handle,[IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach($file in $manifest.files){
      if ($file.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid hash' }
      $entry=$zip.CreateEntry($file.path,[IO.Compression.CompressionLevel]::Fastest)
      $out=$entry.Open()
      try {
        $source=[IO.File]::OpenRead((Join-Path $directory ('files/'+$file.sha256)))
        try { $source.CopyTo($out) } finally { $source.Dispose() }
      } finally { $out.Dispose() }
    }
  } finally { $zip.Dispose() }
} finally { $handle.Dispose() }
Write-Output $OutputZip

