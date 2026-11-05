param(
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string[]]$Path,
    [Parameter(Mandatory)][string]$ReportPath,
    [switch]$RequireSignature
)
$ErrorActionPreference = 'Stop'
$reportFile = [IO.Path]::GetFullPath($ReportPath)
$targets = @($Path | ForEach-Object { (Resolve-Path -LiteralPath $_).Path })
if ($reportFile -in $targets) { throw 'The report must not overwrite a scanned file.' }
$report = [ordered]@{
    checkedAtUtc = [DateTime]::UtcNow.ToString('o')
    passed = $false
    requireSignature = [bool]$RequireSignature
    defender = $null
    files = @()
    errors = @()
    limitation = 'A local antivirus scan does not test SmartScreen reputation, Smart App Control, or other devices.'
}
try {
    $status = Get-MpComputerStatus
    $report.defender = [ordered]@{
        mode = [string]$status.AMRunningMode
        antivirusEnabled = [bool]$status.AntivirusEnabled
        realTimeProtectionEnabled = [bool]$status.RealTimeProtectionEnabled
        engineVersion = $status.AMEngineVersion
        signatureVersion = $status.AntivirusSignatureVersion
        signatureUpdatedAt = $status.AntivirusSignatureLastUpdated.ToUniversalTime().ToString('o')
        smartAppControlState = [string]$status.SmartAppControlState
    }
    if (-not $status.AntivirusEnabled -or $status.AMRunningMode -ne 'Normal') {
        throw 'Microsoft Defender must be enabled in Normal mode for release verification.'
    }
    if ($status.AntivirusSignatureLastUpdated -lt (Get-Date).AddDays(-2)) {
        throw 'Defender signatures are older than 48 hours. Update them before release verification.'
    }
    $platformRoot = Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform'
    $scanner = Get-ChildItem -LiteralPath $platformRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+(-\d+)?$' } |
        Sort-Object { [version](($_.Name -split '-')[0]) } -Descending |
        ForEach-Object { Join-Path $_.FullName 'MpCmdRun.exe' } |
        Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (-not $scanner) { $scanner = Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe' }
    if (-not (Test-Path -LiteralPath $scanner -PathType Leaf)) { throw 'Microsoft Defender scanner is unavailable.' }
    $report.defender.scanner = $scanner
    foreach ($target in $targets) {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Not a file: $target" }
        $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        $entry = [ordered]@{
            name = [IO.Path]::GetFileName($target)
            sha256 = $hash
            bytes = (Get-Item -LiteralPath $target).Length
            zoneIdentifierPresent = [bool](Get-Item -LiteralPath $target -Stream Zone.Identifier -ErrorAction SilentlyContinue)
            signature = $null
            scanExitCode = $null
            scanOutput = $null
        }
        $report.files += $entry
        if ([IO.Path]::GetExtension($target) -eq '.exe') {
            $signature = Get-AuthenticodeSignature -LiteralPath $target
            $entry.signature = [ordered]@{
                status = [string]$signature.Status
                publisher = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
                timestamped = [bool]$signature.TimeStamperCertificate
            }
            if ($signature.Status -eq 'NotSigned' -and -not $RequireSignature) {
                Write-Warning "$($entry.name) is unsigned; a clean scan does not remove reputation warnings."
            } elseif ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
                $report.errors += "$($entry.name): a valid timestamped signature is required."
            }
        }
        # This affects only this custom scan: ignores file exclusions, scans archives,
        # and reports detections without deleting the artifact. No protection setting changes.
        $scanOutput = & $scanner -Scan -ScanType 3 -File $target -DisableRemediation 2>&1
        $scanCode = $LASTEXITCODE
        $entry.scanExitCode = $scanCode
        $entry.scanOutput = ($scanOutput | Out-String).Trim()
        Write-Host $entry.scanOutput
        if ($scanCode -ne 0) { $report.errors += "$($entry.name): Defender detected a threat or failed (exit $scanCode)." }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) {
            $report.errors += "$($entry.name): file changed during verification."
        }
    }
    $report.passed = $report.errors.Count -eq 0
} catch {
    $report.errors += $_.Exception.Message
} finally {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($reportFile)) | Out-Null
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportFile -Encoding UTF8
}
if (-not $report.passed) { throw "Windows release verification failed. See $reportFile" }
Write-Host "Windows release verification recorded in $reportFile"
