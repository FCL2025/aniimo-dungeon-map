$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    throw '請先依 README 建立 .venv 並安裝 requirements.txt。'
}

& (Join-Path $PSScriptRoot 'build_portable.ps1') -Zip
if ($LASTEXITCODE -ne 0) { throw '可攜版建置失敗。' }

& $pythonExe -X utf8 (Join-Path $PSScriptRoot 'package_release.py')
if ($LASTEXITCODE -ne 0) { throw 'GitHub Release 封裝失敗。' }
