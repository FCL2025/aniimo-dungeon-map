[CmdletBinding()]
param(
    [string]$SdkPath,
    [string]$BuildRoot = (Join-Path $env:LOCALAPPDATA 'AniimoDungeonMap/android-build'),
    [string]$Python
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$project = Join-Path $repo 'mobile/android'
$utf8 = [System.Text.UTF8Encoding]::new($false)
if (-not $Python) {
    $Python = Join-Path $repo '.venv/Scripts/python.exe'
    if (-not (Test-Path -LiteralPath $Python)) { $Python = 'python' }
}
if (-not $SdkPath) {
    $candidates = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA 'Android/Sdk'),
        (Join-Path $env:LOCALAPPDATA 'AniimoDungeonMap/android-runtime/sdk'),
        (Join-Path $repo 'dist/android-tools/sdk'))
    $SdkPath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath (Join-Path $_ 'platforms/android-36/android.jar')) } | Select-Object -First 1
}
if (-not $SdkPath) { throw 'Android SDK 36 not found. Pass -SdkPath or set ANDROID_HOME.' }
$SdkPath = (Resolve-Path -LiteralPath $SdkPath).Path
$signer = Join-Path $SdkPath 'build-tools/36.0.0/apksigner.bat'
if (-not (Test-Path -LiteralPath $signer)) { throw 'Install Android SDK Build-Tools 36.0.0.' }
$BuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)
if ($BuildRoot -match '[^\x00-\x7F]') { throw 'Use an ASCII -BuildRoot path; Gradle test workers cannot load classes from this Windows Unicode output path.' }

# Java properties require escaped colons and Unicode, independent of terminal encoding.
$sdkProperty = $SdkPath.Replace('\','/').Replace(':','\:')
$sdkProperty = [regex]::Replace($sdkProperty, '[^\x00-\x7F]', { param($m) '\u{0:x4}' -f [int][char]$m.Value })
[System.IO.File]::WriteAllText((Join-Path $project 'local.properties'), "sdk.dir=$sdkProperty`n", $utf8)
& $Python (Join-Path $PSScriptRoot 'prepare_mobile.py')
if ($LASTEXITCODE -ne 0) { throw 'Mobile asset validation failed.' }

Push-Location $project
try {
    & './gradlew.bat' :app:assembleDebug :app:testDebugUnitTest :app:lintDebug "-PaniimoBuildRoot=$BuildRoot" --console plain --no-daemon
    if ($LASTEXITCODE -ne 0) { throw 'Android build or verification failed.' }
} finally { Pop-Location }

$apkDir = Join-Path $BuildRoot 'app/outputs/apk/debug'
$metadata = Get-Content -LiteralPath (Join-Path $apkDir 'output-metadata.json') -Raw | ConvertFrom-Json
$artifact = $metadata.elements[0]
$source = Join-Path $apkDir $artifact.outputFile
& $signer verify --verbose $source
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }

$output = Join-Path $repo 'dist/android'
New-Item -ItemType Directory -Path $output -Force | Out-Null
$name = "AniimoDungeonMap-$($artifact.versionName)-android-test.apk"
$destination = Join-Path $output $name
Copy-Item -LiteralPath $source -Destination $destination -Force
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'), "$hash  $name`n", $utf8)
Copy-Item -LiteralPath (Join-Path $repo 'mobile/INSTALL.txt') -Destination $output -Force
$record = [ordered]@{
    package = $metadata.applicationId
    version = $artifact.versionName
    versionCode = $artifact.versionCode
    file = $name
    bytes = (Get-Item -LiteralPath $destination).Length
    sha256 = $hash
    signing = 'local Android debug key; testing only'
    minimumAndroid = '8.0 (API 26)'
    checks = @('assembleDebug', 'testDebugUnitTest', 'lintDebug', 'apksigner verify')
}
[System.IO.File]::WriteAllText((Join-Path $output 'build-info.json'), ($record | ConvertTo-Json), $utf8)
Write-Host "APK: $destination"
Write-Host "SHA-256: $hash"
