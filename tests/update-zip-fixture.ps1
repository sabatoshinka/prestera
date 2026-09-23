param([string]$Archive, [string]$EntryName)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open($Archive, [IO.Compression.ZipArchiveMode]::Create)
try {
    $entry = $zip.CreateEntry($EntryName)
    $stream = $entry.Open()
    try { $bytes = [Text.Encoding]::UTF8.GetBytes('test'); $stream.Write($bytes, 0, $bytes.Length) }
    finally { $stream.Dispose() }
} finally { $zip.Dispose() }
