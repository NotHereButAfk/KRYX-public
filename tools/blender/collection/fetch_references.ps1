$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$destination = Join-Path $repo 'artifacts/collection-reference'
New-Item -ItemType Directory -Force $destination | Out-Null
$manifest = Get-Content (Join-Path $repo 'art/collection-remakes/catalog.json') -Raw | ConvertFrom-Json
$report = @()
foreach ($item in $manifest.items) {
    if ($item.rarity -eq 'relic') { throw 'Relic is outside the requested scope' }
    $url = $item.referenceModel
    if (!$url.StartsWith('https://ev.io/sites/default/files/')) { throw "Unexpected reference URL: $url" }
    $file = Join-Path $destination ($item.sourceId + [IO.Path]::GetExtension(([Uri]$url).AbsolutePath))
    if (!(Test-Path -LiteralPath $file)) {
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $file -TimeoutSec 40
    }
    $hash = (Get-FileHash $file).Hash
    if ($item.sourceSha256 -and $hash -ne $item.sourceSha256) { throw "Reference changed: $($item.sourceId)" }
    $report += @{ id = $item.sourceId; sha256 = $hash }
}
$report | ConvertTo-Json | Set-Content (Join-Path $destination 'downloads.json')
