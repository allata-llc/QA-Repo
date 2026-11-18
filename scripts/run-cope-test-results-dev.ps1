param([string]$StatusUrl = '', [ValidateSet('dev','prod')][string]$Environment = 'dev')

$ErrorActionPreference = 'Stop'
$root = 'c:\Users\SnehaKota\CopeData'
$xlsx = Join-Path $root 'test\COPE_Test_Results_50.xlsx'
$reports = Join-Path $root 'reports'

$tenantId = '03e832ce-094d-4423-b864-c11e2a626509'
$clientId = '7001531c-5800-47e6-bf98-5edb7a883817'
if ($Environment -eq 'prod') {
  $apiId = '04dad64f-2a25-4e8b-b587-699fe0fb9064'
  $submitUrl = 'https://func-sn-data-prod-gateway.azurewebsites.net/api/submit'
} else {
  $apiId = '6eb59948-6e24-4124-8383-3acbafcd0160'
  $submitUrl = 'https://func-sn-data-dev-gateway.azurewebsites.net/api/submit'
}

$secret = $env:COPE_CLIENT_SECRET
if (-not $secret) { throw 'Set $env:COPE_CLIENT_SECRET before running.' }

function Get-Token {
  $r = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenantId/oauth2/v2.0/token" -ContentType 'application/x-www-form-urlencoded' -Body @{
    grant_type = 'client_credentials'; client_id = $clientId; client_secret = $secret; scope = "api://$apiId/.default" }
  return $r.access_token
}

if ($StatusUrl) {
  $token = Get-Token
  $poll = Invoke-RestMethod -Method Get -Uri $StatusUrl -Headers @{ Authorization = "Bearer $token" }
  $poll | ConvertTo-Json -Depth 50 | Out-File (Join-Path $reports "cope-$Environment-result.json") -Encoding utf8
  Write-Output "runtimeStatus: $($poll.runtimeStatus)"
  Write-Output "lastUpdatedTime: $($poll.lastUpdatedTime)"
  Write-Output "customStatus: $($poll.customStatus | ConvertTo-Json -Compress)"
  return
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($xlsx)
$entry = $zip.GetEntry('xl/worksheets/sheet1.xml')
$sr = New-Object System.IO.StreamReader($entry.Open())
[xml]$doc = $sr.ReadToEnd()
$sr.Close(); $zip.Dispose()

$ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
$ns.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
$rows = @($doc.SelectNodes('//m:sheetData/m:row', $ns)) | Select-Object -Skip 1

# County is not in the workbook; derived from ZIP code (required by the gateway).
$countyByZip = @{
  '10458'='Bronx'; '10456'='Bronx'; '10467'='Bronx'; '10453'='Bronx'; '10452'='Bronx'
  '11210'='Kings'; '11225'='Kings'; '11211'='Kings'; '11209'='Kings'; '11203'='Kings'; '11204'='Kings'
  '10039'='New York'; '10025'='New York'; '10031'='New York'; '10001'='New York'; '10011'='New York'; '10004'='New York'; '10021'='New York'
  '11428'='Queens'; '11691'='Queens'; '11373'='Queens'; '11435'='Queens'
  '10304'='Richmond'; '10312'='Richmond'; '10302'='Richmond'; '10301'='Richmond'
  '33610'='Hillsborough'; '32801'='Orange'; '32803'='Orange'
  '11003'='Nassau'; '11557'='Nassau'; '11798'='Suffolk'
  '07072'='Bergen'; '08079'='Salem'; '07927'='Morris'
  '12010'='Montgomery'; '12508'='Dutchess'
  '19121'='Philadelphia'; '19116'='Philadelphia'; '19154'='Philadelphia'
  '22314'='Alexandria'; '24526'='Bedford'
}

$requests = @()
foreach ($row in $rows) {
  $map = @{}
  foreach ($c in $row.c) {
    $col = $c.r -replace '\d', ''
    $text = if ($c.t -eq 'inlineStr') { [string]$c.is.t } else { [string]$c.v }
    $map[$col] = $text
  }
  if ($map['A'] -notmatch '^T\d+$' -or [string]::IsNullOrWhiteSpace($map['C'])) { continue }
  $zipCode = [string]$map['F']
  $county = $countyByZip[$zipCode]
  if (-not $county) { throw "No county mapping for zip $zipCode (row $($map['A']))" }
  $requests += @{
    clientRef = $map['A']; locationNo = 1; buildingNo = 1; maxAgeDays = 365
    address = @{ line1 = $map['C']; city = $map['D']; state = $map['E']; postalCode = $zipCode; county = $county }
  }
}
Write-Output "Addresses loaded: $($requests.Count)"

$body = @{ callbackUrl = 'http://localhost:5173/'; requests = $requests } | ConvertTo-Json -Depth 10
$token = Get-Token
try {
  $submit = Invoke-RestMethod -Method Post -Uri $submitUrl -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
} catch {
  $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  Write-Output "SUBMIT FAILED: $($sr.ReadToEnd())"
  return
}
$submit | ConvertTo-Json -Depth 5 | Out-File (Join-Path $reports "cope-$Environment-submit.json") -Encoding utf8
Write-Output "lookup_id: $($submit.lookup_id)"
Write-Output "status_url: $($submit.status_url)"
