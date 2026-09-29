param(
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path.TrimEnd('\')
$dist = Join-Path $root 'dist'
$manifestPath = Join-Path $dist 'portable-build.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw 'Missing portable-build.json; cannot identify the current release.'
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$currentPackage = Split-Path -Leaf (Split-Path -Parent $manifest.executable)
if (-not (Test-Path -LiteralPath (Join-Path $dist $currentPackage) -PathType Container)) {
    throw "Current release package is missing: $currentPackage"
}

$candidates = @(
    Get-ChildItem -LiteralPath $dist -Force |
        Where-Object { $_.Name -ne $currentPackage -and $_.Name -ne 'portable-build.json' }
)
foreach ($relative in @(
    'exports/icon-update-export.log',
    'app/capture-timing-tests.exe',
    'app/capture-timing-tests.pdb',
    'scripts/__pycache__'
)) {
    $path = Join-Path $root $relative
    if (Test-Path -LiteralPath $path) {
        $candidates += Get-Item -LiteralPath $path -Force
    }
}

foreach ($item in $candidates) {
    $resolved = [IO.Path]::GetFullPath($item.FullName)
    if (-not $resolved.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Cleanup target is outside the repository: $resolved"
    }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Cleanup target is a reparse point: $resolved"
    }
    if ($item.PSIsContainer) {
        $nestedLinks = @(Get-ChildItem -LiteralPath $resolved -Force -Recurse -Attributes ReparsePoint)
        if ($nestedLinks.Count -gt 0) {
            throw "Cleanup target contains a reparse point: $resolved"
        }
    }
}

foreach ($item in $candidates) {
    if ($Apply) {
        Remove-Item -LiteralPath $item.FullName -Recurse:$item.PSIsContainer -Force
        Write-Output "Removed: $($item.FullName)"
    } else {
        Write-Output "Would remove: $($item.FullName)"
    }
}

$verb = if ($Apply) { 'Removed' } else { 'Would remove' }
Write-Output "$verb $($candidates.Count) items. Kept $currentPackage and portable-build.json."
