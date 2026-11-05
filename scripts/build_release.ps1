param(
    [string]$CertificateThumbprint = $env:ANIIMO_SIGNING_THUMBPRINT,
    [switch]$AllowUnsignedRelease
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    throw '請先依 README 建立 .venv 並安裝 requirements.txt。'
}

if (-not $CertificateThumbprint -and -not $AllowUnsignedRelease) {
    throw 'Configure ANIIMO_SIGNING_THUMBPRINT for a signed release. For an intentionally unsigned release, use -AllowUnsignedRelease; SmartScreen warnings may persist.'
}
& (Join-Path $PSScriptRoot 'build_portable.ps1') -Zip `
    -CertificateThumbprint $CertificateThumbprint -RequireSignature:(-not $AllowUnsignedRelease)
if ($LASTEXITCODE -ne 0) { throw '可攜版建置失敗。' }

$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'app\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
$portableName = "AniimoDungeonMap-$version-windows-x64-portable"
$scanTargets = @(
    (Join-Path $projectRoot "dist\$portableName\AniimoDungeonMap.exe"),
    (Join-Path $projectRoot "dist\$portableName.zip")
)
& (Join-Path $PSScriptRoot 'verify_windows_security.ps1') -Path $scanTargets `
    -ReportPath (Join-Path $projectRoot "dist\windows-security-v$version.json") `
    -RequireSignature:(-not $AllowUnsignedRelease)

& $pythonExe -X utf8 (Join-Path $PSScriptRoot 'package_release.py')
if ($LASTEXITCODE -ne 0) { throw 'GitHub Release 封裝失敗。' }
