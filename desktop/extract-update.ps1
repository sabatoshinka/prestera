param(
    [Parameter(Mandatory=$true)][string]$Archive,
    [Parameter(Mandatory=$true)][string]$Destination,
    [Parameter(Mandatory=$true)][string]$Version,
    [Parameter(Mandatory=$true)][string]$ExpectedHash
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $ExpectedHash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid release metadata' }
if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'Archive SHA-256 mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$targetRoot = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
$prefix = "Prestera-$Version-win-x64/"
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    if ($zip.Entries.Count -gt 20000) { throw 'Too many archive entries' }
    [long]$total = 0
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    # Validate every entry before writing anything. Windows aliases, ADS and
    # symbolic links are rejected, in addition to ordinary path traversal.
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        if (-not $name.StartsWith($prefix, [StringComparison]::Ordinal) -or $name.Contains('\')) { throw 'Unexpected archive path' }
        foreach ($part in $name.TrimEnd('/').Split('/')) {
            if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[<>:"|?*\x00-\x1f]' -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe archive path' }
        }
        if ((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000 -or ($entry.ExternalAttributes -band 0x400) -ne 0) { throw 'Archive links are not allowed' }
        $target = [IO.Path]::GetFullPath((Join-Path $Destination $name))
        if (-not $target.StartsWith($targetRoot, [StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($target.TrimEnd('\'))) { throw 'Invalid or duplicate archive path' }
        $total += $entry.Length
        if ($total -gt 2GB) { throw 'Unpacked update is too large' }
    }
    foreach ($entry in $zip.Entries) {
        $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
        if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
} finally { $zip.Dispose() }
