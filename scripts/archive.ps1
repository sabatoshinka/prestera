$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectDirectory = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw | ConvertFrom-Json
$baseName = "Prestera-$($package.version)-win-x64"
$sourceDirectory = (Resolve-Path -LiteralPath (Join-Path $projectDirectory "release/$baseName")).Path
$archivePath = Join-Path $projectDirectory "release/$baseName.zip"
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite)
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse) {
        $relative = $file.FullName.Substring($sourceDirectory.Length + 1).Replace('\', '/')
        if ($relative.StartsWith('PibbleData/', [StringComparison]::OrdinalIgnoreCase)) { continue }
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, "$baseName/$relative", [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose(); $stream.Dispose() }
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    foreach ($relative in @('Prestera.exe', 'resources/app/desktop/main.cjs', 'resources/app/desktop/room.cjs', 'resources/app/desktop/security.cjs', 'resources/app/desktop/relay.cjs', 'resources/app/desktop/library.cjs', 'resources/app/desktop/gpu-video.cjs', 'resources/app/native/bin/pibble-audio.exe', 'resources/app/native/bin/prestera-gpu-video.exe', 'resources/app/dist/index.html', 'resources/app/dist/main.js', 'resources/app/dist/main.css', 'resources/app/dist/events/join.wav', 'resources/app/dist/events/message.wav', 'CHANGES.txt', 'resources/app/dist/frames/signal.svg', 'VPS.md', 'ПРОЧТИ МЕНЯ.txt')) {
        $entry = $archive.GetEntry("$baseName/$relative")
        if (-not $entry) { throw "Missing archive entry: $relative" }
        $entryStream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $entryHash = [BitConverter]::ToString($sha.ComputeHash($entryStream)).Replace('-', '') } finally { $entryStream.Dispose(); $sha.Dispose() }
        $originalHash = (Get-FileHash -LiteralPath (Join-Path $sourceDirectory $relative) -Algorithm SHA256).Hash
        if ($entryHash -ne $originalHash) { throw "Archive data mismatch: $relative" }
    }
} finally { $archive.Dispose() }
$hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($archivePath + '.sha256'), "$hash  $baseName.zip")
Write-Output 'Archive verified: application, security transport, native helper, interface and security documentation match their SHA-256 hashes.'
Get-Item -LiteralPath $archivePath | Select-Object FullName,Length
