param(
    [switch]$Zip,
    [string]$CertificateThumbprint = $env:ANIIMO_SIGNING_THUMBPRINT,
    [switch]$RequireSignature
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { throw '請先依 README 建立 .venv 並安裝 requirements.txt。' }
& $pythonExe -X utf8 (Join-Path $PSScriptRoot 'prepare_portable.py')
if ($LASTEXITCODE -ne 0) { throw '準備地圖資料失敗。' }
Push-Location (Join-Path $projectRoot 'app\src-tauri')
try {
    cargo build --release --locked
    if ($LASTEXITCODE -ne 0) { throw 'Rust 編譯失敗。' }
} finally { Pop-Location }
& (Join-Path $PSScriptRoot 'sign_windows.ps1') `
    -Path (Join-Path $projectRoot 'app\src-tauri\target\x86_64-pc-windows-msvc\release\aniimo-dungeon-map.exe') `
    -CertificateThumbprint $CertificateThumbprint -RequireSignature:$RequireSignature
$packageArguments = @('-X', 'utf8', (Join-Path $PSScriptRoot 'package_portable.py'))
if ($Zip) { $packageArguments += '--zip' }
& $pythonExe @packageArguments
if ($LASTEXITCODE -ne 0) { throw '本地應用輸出失敗。' }
