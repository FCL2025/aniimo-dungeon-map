param(
    [Parameter(Mandatory)][string]$Path,
    [string]$CertificateThumbprint = $env:ANIIMO_SIGNING_THUMBPRINT,
    [string]$TimestampServer = 'http://timestamp.digicert.com',
    [switch]$RequireSignature
)
$ErrorActionPreference = 'Stop'
$binary = (Resolve-Path -LiteralPath $Path).Path
if ([IO.Path]::GetExtension($binary) -ne '.exe') { throw 'Signing requires an EXE.' }

if ($CertificateThumbprint) {
    $thumbprint = ($CertificateThumbprint -replace '\s', '').ToUpperInvariant()
    if ($thumbprint -notmatch '^[0-9A-F]{40}$') { throw 'Invalid signing certificate thumbprint.' }
    $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction SilentlyContinue
    $machineStore = $false
    if (-not $certificate) {
        $certificate = Get-Item -LiteralPath "Cert:\LocalMachine\My\$thumbprint" -ErrorAction SilentlyContinue
        $machineStore = $true
    }
    if (-not $certificate -or -not $certificate.HasPrivateKey) {
        throw 'The selected signing certificate and its private key must be available in the Windows certificate store.'
    }
    if ($certificate.NotBefore -gt (Get-Date) -or $certificate.NotAfter -le (Get-Date)) {
        throw 'The signing certificate is not currently valid.'
    }
    if ($certificate.Subject -eq $certificate.Issuer) { throw 'Self-signed certificates do not establish a trusted publisher.' }
    if ('1.3.6.1.5.5.7.3.3' -notin @($certificate.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId })) {
        throw 'The selected certificate is not a code signing certificate.'
    }
    $timestampUri = $null
    if (-not [Uri]::TryCreate($TimestampServer, [UriKind]::Absolute, [ref]$timestampUri) -or
        $timestampUri.Scheme -notin @('http', 'https')) { throw 'An HTTP(S) RFC 3161 timestamp server is required.' }
    $signTool = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
    if (-not $signTool) {
        $signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
            Sort-Object { [version]$_.Directory.Parent.Name } -Descending |
            Select-Object -ExpandProperty FullName -First 1
    }
    if (-not $signTool) { throw 'Install Windows SDK SignTool before signing.' }
    $signArguments = @('sign', '/sha1', $thumbprint, '/s', 'My', '/fd', 'SHA256', '/tr', $TimestampServer, '/td', 'SHA256')
    if ($machineStore) { $signArguments += '/sm' }
    & $signTool @signArguments $binary
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing or timestamping failed.' }
    & $signTool verify /pa /all /tw $binary
    if ($LASTEXITCODE -ne 0) { throw 'Authenticode verification failed.' }
}

$signature = Get-AuthenticodeSignature -LiteralPath $binary
if ($signature.Status -eq 'NotSigned' -and -not $RequireSignature -and -not $CertificateThumbprint) {
    Write-Warning 'Unsigned local build: downloaded copies may trigger SmartScreen or Smart App Control.'
    return
}
if ($signature.Status -ne 'Valid' -or -not $signature.TimeStamperCertificate) {
    throw "A valid, timestamped Authenticode signature is required (status: $($signature.Status))."
}
Write-Host "Verified publisher: $($signature.SignerCertificate.Subject)"
