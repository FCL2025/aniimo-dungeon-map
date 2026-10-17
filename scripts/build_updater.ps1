param(
    [string]$SigningKey = (Join-Path $env:USERPROFILE '.tauri\aniimo-dungeon-map.key'),
    [string]$ReleaseNotes = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $SigningKey -PathType Leaf)) {
    throw "找不到 Tauri 更新簽章私鑰：$SigningKey"
}
$publicKeyPath = "$SigningKey.pub"
if (-not (Test-Path -LiteralPath $publicKeyPath -PathType Leaf)) {
    throw "找不到對應的 Tauri 更新簽章公鑰：$publicKeyPath"
}
$configuredKey = (Get-Content -LiteralPath (Join-Path $projectRoot 'app\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).plugins.updater.pubkey
$actualKey = (Get-Content -LiteralPath $publicKeyPath -Raw).Trim()
if ($configuredKey -ne $actualKey) {
    throw '私鑰對應的公鑰與 tauri.conf.json 不符，停止建置。'
}
if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    throw '請先依 README 建立 .venv 並安裝 requirements.txt。'
}

& (Join-Path $PSScriptRoot 'build_portable.ps1') -Zip
if ($LASTEXITCODE -ne 0) { throw '可攜版建置失敗。' }

$oldSigningKey = $env:TAURI_SIGNING_PRIVATE_KEY
$env:TAURI_SIGNING_PRIVATE_KEY = (Resolve-Path -LiteralPath $SigningKey).Path
Push-Location (Join-Path $projectRoot 'app\src-tauri')
try {
    npx --yes @tauri-apps/cli@2.10.1 build --features installer --bundles nsis --ci
    if ($LASTEXITCODE -ne 0) { throw 'NSIS 安裝版建置失敗。' }
} finally {
    Pop-Location
    $env:TAURI_SIGNING_PRIVATE_KEY = $oldSigningKey
}

& $pythonExe -X utf8 (Join-Path $PSScriptRoot 'package_updater.py') --notes $ReleaseNotes
if ($LASTEXITCODE -ne 0) { throw '更新檔封裝失敗。' }
