param([switch]$Apply, [ValidateRange(1, 100)][int]$KeepCount = 3, [switch]$IncludeTestCopies)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'dist'))
$rootItem = Get-Item -LiteralPath $releaseRoot
if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to clean a redirected dist directory.' }
$appRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'app'))
$artifacts = @(Get-ChildItem -LiteralPath $releaseRoot | ForEach-Object {
    if ($_.Name -match '^AniimoDungeonMap-(\d+\.\d+\.\d+)-windows-x64-portable(?:\.(zip|rar|7z))?$') {
        [pscustomobject]@{ Item=$_; Version=[version]$Matches[1] }
    }
})
$keep = @($artifacts.Version | Sort-Object -Unique -Descending | Select-Object -First $KeepCount)
$remove = @($artifacts | Where-Object { $_.Version -notin $keep })
$extra = @()
if ($IncludeTestCopies) {
    $appItem = Get-Item -LiteralPath $appRoot
    if ($appItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to clean a redirected app directory.' }
    $extra = @(
        Get-ChildItem -LiteralPath $releaseRoot -Directory | Where-Object {
            $_.Name -match '^(?:github-release-v?|release-|smoke(?:-final|-resize)?-)(\d+\.\d+\.\d+)$' -and
            [version]$Matches[1] -notin $keep
        } | ForEach-Object { [pscustomobject]@{ Item=$_; Root=$releaseRoot } }
    ) + @(
        Get-ChildItem -LiteralPath $appRoot -Directory | Where-Object { $_.Name -like 'smoke-run*' } |
            ForEach-Object { [pscustomobject]@{ Item=$_; Root=$appRoot } }
    )
}
Write-Output ('Keep versions: ' + ($keep -join ', '))
foreach ($entry in @($remove | ForEach-Object { [pscustomobject]@{ Item=$_.Item; Root=$releaseRoot } }) + $extra) {
    $target = [IO.Path]::GetFullPath($entry.Item.FullName)
    if ([IO.Path]::GetDirectoryName($target) -ne $entry.Root -or
        !$target.StartsWith($entry.Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        ($entry.Item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Unsafe cleanup target: $target" }
    Write-Output ((@{ $true='Remove: '; $false='Would remove: ' }[$Apply.IsPresent]) + $target)
}
if ($Apply) {
    # Validate all targets before any recursive removal, then use literal PowerShell paths throughout.
    foreach ($entry in $remove) { Remove-Item -LiteralPath $entry.Item.FullName -Recurse -Force }
    foreach ($entry in $extra) { Remove-Item -LiteralPath $entry.Item.FullName -Recurse -Force }
}
