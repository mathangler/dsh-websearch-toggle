# Boot a persistent verification server for dsh-websearch-toggle.
#
# Leaves the server RUNNING so the switch can be checked in a browser, on a port
# independent of whatever process is serving the main GUI. Re-running reuses a
# server that already answers on the port.
#
# Usage:
#   pwsh -File test/serve-verify.ps1                 # port 3099
#   pwsh -File test/serve-verify.ps1 -Port 3100
#   pwsh -File test/serve-verify.ps1 -Stop

param(
  [int]$Port = 3099,
  [switch]$Stop
)

$ErrorActionPreference = 'Continue'
$work = Join-Path $PSScriptRoot 'verify-server'
New-Item -ItemType Directory -Force -Path $work | Out-Null

$bat = Join-Path $work "start-$Port.bat"
$out = Join-Path $work "out-$Port.txt"
$err = Join-Path $work "err-$Port.txt"
$pidFile = Join-Path $work "pid-$Port.txt"
$urlFile = Join-Path $work "url-$Port.txt"
$base = "http://127.0.0.1:$Port"

function Test-Port([int]$p) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', $p)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

if ($Stop) {
  if (Test-Path $pidFile) {
    taskkill /PID (Get-Content $pidFile -Raw).Trim() /T /F 2>&1 | Out-String | Write-Host
    Remove-Item $pidFile, $urlFile -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
  "port $Port listening = $(Test-Port $Port)" | Write-Host
  exit 0
}

if (Test-Port $Port) {
  Write-Host "port $Port is already listening."
  if (Test-Path $urlFile) { Get-Content $urlFile | Write-Host }
  else { Write-Host "No recorded token: not started by this script." }
  exit 0
}

$node = (Get-Command node).Source
$bin = Join-Path (Split-Path $node) 'node_modules\@deepseek-ai\dsh\lib\bin.js'
if (-not (Test-Path $bin)) { Write-Host "dsh bin not found: $bin"; exit 1 }

Remove-Item $out, $err -Force -ErrorAction SilentlyContinue

# A batch file owns the redirection: with Start-Process -RedirectStandardOutput
# the parent cannot read the file while the child still holds the handle.
@"
@echo off
"$node" "$bin" --profile web --port $Port --no-open > "$out" 2> "$err"
"@ | Set-Content $bat -Encoding ASCII

$process = Start-Process -FilePath $bat -WindowStyle Hidden -PassThru
$process.Id | Set-Content $pidFile -Encoding ASCII
Write-Host "launcher pid=$($process.Id); waiting for $base ..."

$token = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  $text = [string](Get-Content $out -Raw -ErrorAction SilentlyContinue)
  if ($text) {
    $match = [regex]::Match($text, 'token=([A-Za-z0-9_\-]+)')
    if ($match.Success) { $token = $match.Groups[1].Value; break }
  }
  $failure = [string](Get-Content $err -Raw -ErrorAction SilentlyContinue)
  if ($failure -and $failure.Length -gt 0) { Write-Host "boot failed"; Write-Host $failure; exit 1 }
}

if (-not $token) {
  Write-Host "no token after 60s"
  [string](Get-Content $err -Raw -ErrorAction SilentlyContinue) | Write-Host
  exit 1
}

$url = "$base/?token=$token"
$url | Set-Content $urlFile -Encoding ASCII

$jar = Join-Path $work "cookies-$Port.txt"
$page = Join-Path $work "page-$Port.html"
$index = (curl.exe -sS -L -c $jar -b $jar -o $page -w '%{http_code}' --max-time 30 $url 2>&1 | Out-String).Trim()
$urls = [regex]::Matches([string](Get-Content $page -Raw -ErrorAction SilentlyContinue), '/plugins/[^"''<> ]+') | ForEach-Object { $_.Value } | Select-Object -Unique
$ours = $urls | Where-Object { $_ -like '*/??dsh-websearch-toggle/client.js*' } | Select-Object -First 1
$oursStatus = 'missing'
$idLine = '(no bundle)'
if ($ours) {
  $bundle = Join-Path $work "bundle-$Port.js"
  $oursStatus = (curl.exe -sS -c $jar -b $jar -o $bundle -w '%{http_code}' --max-time 60 "$base$($ours -replace '&amp;', '&')" 2>&1 | Out-String).Trim()
  $text = [string](Get-Content $bundle -Raw -ErrorAction SilentlyContinue)
  $at = $text.IndexOf('const ENTRY_ID')
  if ($at -ge 0) { $idLine = $text.Substring($at, 48).Split("`n")[0].Trim() }
}
$official = if ($urls | Where-Object { $_ -like '*@deepseek-ai/dsh-client-ui-settings-plugins/client.js*' }) { 'served' } else { 'MISSING' }

Write-Host ''
Write-Host '=== verification server ==='
Write-Host "url             : $url"
Write-Host "index           : HTTP $index"
Write-Host "our bundle      : HTTP $oursStatus"
Write-Host "entry id in it  : $idLine"
Write-Host "official pages  : $official"
Write-Host "stderr          : $([string](Get-Content $err -Raw -ErrorAction SilentlyContinue))"
Write-Host "stop with       : pwsh -File `"$PSCommandPath`" -Port $Port -Stop"
