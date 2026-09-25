param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
$rootItem = Get-Item -LiteralPath $releaseRoot
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to clean a redirected dist directory.' }
$artifacts = @(Get-ChildItem -LiteralPath $releaseRoot | ForEach-Object {
    if ($_.Name -match '^AniimoDungeonMap-(\d+\.\d+\.\d+)-windows-x64-portable(?:\.(zip|rar|7z))?$') {
        [pscustomobject]@{ Item=$_; Version=[version]$Matches[1] }
    }
})
$keep = @($artifacts.Version | Sort-Object -Unique -Descending | Select-Object -First 3)
$remove = @($artifacts | Where-Object { $_.Version -notin $keep })
Write-Output ('Keep versions: ' + ($keep -join ', '))
foreach ($entry in $remove) {
    $target = [IO.Path]::GetFullPath($entry.Item.FullName)
    if ([IO.Path]::GetDirectoryName($target) -ne $releaseRoot -or
        !$target.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        ($entry.Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unsafe cleanup target: $target" }
    Write-Output ((@{ $true='Remove: '; $false='Would remove: ' }[$Apply.IsPresent]) + $target)
}
if ($Apply) {
    # Validate all targets before any recursive removal, then use literal PowerShell paths throughout.
    foreach ($entry in $remove) { Remove-Item -LiteralPath $entry.Item.FullName -Recurse -Force }
}
