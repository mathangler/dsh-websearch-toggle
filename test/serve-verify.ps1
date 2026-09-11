# Boot a persistent verification server for dsh-websearch-toggle.
#
# Unlike test/e2e-serve.ps1 this one does NOT kill the server: it is meant to be
# left running so the switch can be verified in a browser, on a port that is
# independent of whatever process is serving the main GUI.
#
# Re-running it reuses the running server when the port already answers.
#
# Usage:
#   pwsh -File test/serve-verify.ps1                 # port 3099
#   pwsh -File test/serve-verify.ps1 -Port 3100
#   pwsh -File test/serve-verify.ps1 -Stop           # stop the server it started

param(
  [int]$Port = 3099,
  [switch]$Stop
)

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$work = Join-Path $root 'verify-server'
New-Item -ItemType Directory -Force -Path $work | Out-Null

$bat  = Join-Path $work "start-web-$Port.bat"
$out  = Join-Path $work "web-$Port.out.txt"
$err  = Join-Path $work "web-$Port.err.txt"
$pidFile = Join-Path $work "web-$Port.pid"
$meta = Join-Path $work "web-$Port.url.txt"
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
    $saved = (Get-Content $pidFile -Raw).Trim()
    if ($saved) {
      taskkill /PID $saved /T /F 2>&1 | Out-String | Write-Host
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item $meta -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 1
  "port $Port listening = $(Test-Port $Port)" | Write-Host
  exit 0
}

if (Test-Port $Port) {
  Write-Host "port $Port is already listening."
  if (Test-Path $meta) { Get-Content $meta | Write-Host }
  else { Write-Host "No recorded token: the process on $Port was not started by this script." }
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
"$node" "$bin" web --port $Port --no-open > "$out" 2> "$err"
"@ | Set-Content $bat -Encoding ASCII

# Launch detached and hidden. The batch host is started with -PassThru so the
# pid can be recorded, but nothing here waits on it.
$process = Start-Process -FilePath $bat -WindowStyle Hidden -PassThru
$process.Id | Set-Content $pidFile -Encoding ASCII
Write-Host "launcher pid=$($process.Id); waiting for $base ..."

$token = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 1
  $text = [string](Get-Content $out -Raw -ErrorAction SilentlyContinue)
  if ($text -and $text.Length -gt 0) {
    $match = [regex]::Match($text, 'token=([A-Za-z0-9_\-]+)')
    if ($match.Success) { $token = $match.Groups[1].Value; break }
  }
  $failure = [string](Get-Content $err -Raw -ErrorAction SilentlyContinue)
  if ($failure -and $failure.Length -gt 0) {
    Write-Host "boot failed after $($i + 1)s"
    Write-Host $failure
    exit 1
  }
}

if (-not $token) {
  Write-Host "no token after 60s; stderr follows"
  [string](Get-Content $err -Raw -ErrorAction SilentlyContinue) | Write-Host
  exit 1
}

$url = "$base/?token=$token"
$url | Set-Content $meta -Encoding ASCII

# Prove the plugin is actually live on this instance before promising anything:
# the dedicated client bundle and the host route both have to answer.
$jar = Join-Path $work "cookies-$Port.txt"
$pageFile = Join-Path $work "page-$Port.html"
$index = (curl.exe -sS -L -c $jar -b $jar -o $pageFile -w '%{http_code}' --max-time 30 $url 2>&1 | Out-String).Trim()
$urls = [regex]::Matches([string](Get-Content $pageFile -Raw -ErrorAction SilentlyContinue), '/plugins/[^"''<> ]+') | ForEach-Object { $_.Value } | Select-Object -Unique
$bundleUrl = $urls | Where-Object { $_ -like '*/??dsh-websearch-toggle/client.js*' } | Select-Object -First 1
$bundleStatus = 'missing'
if ($bundleUrl) {
  $bundleStatus = (curl.exe -sS -c $jar -b $jar -o (Join-Path $work "bundle-$Port.js") -w '%{http_code}' --max-time 60 "$base$($bundleUrl -replace '&amp;', '&')" 2>&1 | Out-String).Trim()
}
$routeStatus = (curl.exe -sS -c $jar -b $jar -X POST -H 'Content-Type: application/json' -d '{}' -o (Join-Path $work "state-$Port.json") -w '%{http_code}' --max-time 30 "$base/websearch-toggle/state" 2>&1 | Out-String).Trim()

Write-Host ''
Write-Host '=== verification server ==='
Write-Host "url              : $url"
Write-Host "index            : HTTP $index"
Write-Host "client bundle    : HTTP $bundleStatus  ($bundleUrl)"
Write-Host "host route state : HTTP $routeStatus  $([string](Get-Content (Join-Path $work "state-$Port.json") -Raw -ErrorAction SilentlyContinue))"
Write-Host "stderr           : $([string](Get-Content $err -Raw -ErrorAction SilentlyContinue))"
Write-Host "pid file         : $pidFile"
Write-Host "stop with        : pwsh -File `"$PSCommandPath`" -Port $Port -Stop"
