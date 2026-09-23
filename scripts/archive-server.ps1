$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$project = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $project 'package.json') -Raw | ConvertFrom-Json
$archivePath = Join-Path $project "release/Prestera-Server-$($package.version).zip"
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite)
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in @('broker.cjs','package.json','Dockerfile','compose.yaml','Caddyfile','setup.sh','DEPLOY.md','.gitignore','.dockerignore')) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, (Join-Path $project "server/$relative"), "prestera-server/$relative", [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose(); $stream.Dispose() }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($archivePath + '.sha256'), "$hash  $([IO.Path]::GetFileName($archivePath))")
Get-Item -LiteralPath $archivePath | Select-Object FullName,Length
