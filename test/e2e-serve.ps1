# End-to-end check for dsh-websearch-toggle.
#
# Boots a THROWAWAY `dsh web` on port 3099 against the real web profile (the
# plugin is already installed there), then proves the four things unit tests
# cannot: the host half boots with an empty stderr, the browser half is served
# with this build's symbols, the route answers an authenticated caller, and the
# same route refuses an unauthenticated one.
#
# It never touches the running GUI on 3080. The one real write it performs — a
# switch flip — is restored before it exits.
#
# Usage:  pwsh -File test/e2e-serve.ps1

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$work = Join-Path $root 'e2e'
New-Item -ItemType Directory -Force -Path $work | Out-Null

$log  = Join-Path $work 'e2e-log.txt'
$out  = Join-Path $work 'boot-out.txt'
$err  = Join-Path $work 'boot-err.txt'
$jar  = Join-Path $work 'cookies.txt'
$bat  = Join-Path $work 'boot.bat'
$dl   = Join-Path $work 'bundle-dl.js'
$port = 3099
Remove-Item $jar, $out, $err, $dl -Force -ErrorAction SilentlyContinue
'=== dsh-websearch-toggle e2e ===' | Set-Content $log

$node = (Get-Command node).Source
$bin  = Join-Path (Split-Path $node) 'node_modules\@deepseek-ai\dsh\lib\bin.js'
"node=$node" | Add-Content $log
"bin=$bin" | Add-Content $log

# A batch file owns the redirection: with Start-Process -RedirectStandardOutput
# the parent cannot read the file while the child still holds the handle.
@"
@echo off
"$node" "$bin" web --port $port --no-open > "$out" 2> "$err"
"@ | Set-Content $bat -Encoding ASCII

$process = Start-Process -FilePath $bat -PassThru -NoNewWindow
"launcher pid=$($process.Id)" | Add-Content $log

$token = $null
for ($i = 0; $i -lt 45; $i++) {
  Start-Sleep -Seconds 1
  $text = [string](Get-Content $out -Raw -ErrorAction SilentlyContinue)
  if ($text -and $text.Length -gt 0) {
    $match = [regex]::Match($text, 'token=([A-Za-z0-9_\-]+)')
    if ($match.Success) { $token = $match.Groups[1].Value; "token after $($i + 1)s" | Add-Content $log; break }
  }
}

if (-not $token) {
  'NO TOKEN — boot failed' | Add-Content $log
  '=== stderr ===' | Add-Content $log
  ([string](Get-Content $err -Raw -ErrorAction SilentlyContinue)) | Add-Content $log
  ([string](Get-Content $out -Raw -ErrorAction SilentlyContinue)) | Add-Content $log
  if ($process) { taskkill /PID $process.Id /T /F 2>&1 | Out-Null }
  exit 1
}

$base = "http://127.0.0.1:$port"

# Authenticate once; the platform sets its cookie, and the jar carries it after.
$pageFile = Join-Path $work 'page.html'
$page = (curl.exe -sS -L -c $jar -b $jar -o $pageFile -w 'status=%{http_code}' --max-time 30 "$base/?token=$token" 2>&1 | Out-String).Trim()
"index $page" | Add-Content $log

$urls = [regex]::Matches([string](Get-Content $pageFile -Raw), '/plugins/[^"''<> ]+') | ForEach-Object { $_.Value } | Select-Object -Unique
'--- plugin bundles served ---' | Add-Content $log
$urls | Add-Content $log

# The index also carries one aggregate `??a,b,c` URL; only the dedicated
# single-package URL proves this bundle is served on its own.
$ours = $urls | Where-Object { $_ -like '*/??dsh-websearch-toggle/client.js*' } | Select-Object -First 1
if ($ours) { $ours = $ours -replace '&amp;', '&' }
if (-not $ours) {
  'MISSING: no dsh-websearch-toggle bundle in the index' | Add-Content $log
} else {
  $result = (curl.exe -sS -c $jar -b $jar -o $dl -w 'status=%{http_code} bytes=%{size_download}' --max-time 120 "$base$ours" 2>&1 | Out-String).Trim()
  "ours $ours -> $result" | Add-Content $log
  $bundle = [string](Get-Content $dl -Raw -ErrorAction SilentlyContinue)
  foreach ($needle in @(
    "__ModuleLoader__",
    "dsh-websearch-toggle",
    "data-dshwst-off",
    "data-dshwst-row",
    "dshwst-switch",
    "patchCardIn",
    "网页搜索",
    "/websearch-toggle"
  )) {
    "  has $needle = $($bundle.Contains($needle))" | Add-Content $log
  }
  "  bundle bytes = $($bundle.Length)" | Add-Content $log
}

'--- route: authenticated read ---' | Add-Content $log
$stateFile = Join-Path $work 'state.json'
$result = (curl.exe -sS -c $jar -b $jar -X POST -H 'Content-Type: application/json' -d '{}' -o $stateFile -w 'status=%{http_code}' --max-time 60 "$base/websearch-toggle/state" 2>&1 | Out-String).Trim()
"state $result body=$([string](Get-Content $stateFile -Raw -ErrorAction SilentlyContinue))" | Add-Content $log

'--- route: authenticated write (restored below) ---' | Add-Content $log
$setFile = Join-Path $work 'set.json'
$result = (curl.exe -sS -c $jar -b $jar -X POST -H 'Content-Type: application/json' -d '{"enabled":false}' -o $setFile -w 'status=%{http_code}' --max-time 60 "$base/websearch-toggle/set" 2>&1 | Out-String).Trim()
"set $result body=$([string](Get-Content $setFile -Raw -ErrorAction SilentlyContinue))" | Add-Content $log
$persisted = Join-Path $env:USERPROFILE '.dsh\websearch-toggle.json'
"persisted file = $([string](Get-Content $persisted -Raw -ErrorAction SilentlyContinue))" | Add-Content $log

$restore = (curl.exe -sS -c $jar -b $jar -X POST -H 'Content-Type: application/json' -d '{"enabled":true}' -o (Join-Path $work 'restore.json') -w 'status=%{http_code}' --max-time 60 "$base/websearch-toggle/set" 2>&1 | Out-String).Trim()
"restore $restore body=$([string](Get-Content (Join-Path $work 'restore.json') -Raw -ErrorAction SilentlyContinue))" | Add-Content $log
"persisted after restore = $(([string](Get-Content $persisted -Raw -ErrorAction SilentlyContinue)) -replace '\s+', ' ')" | Add-Content $log

'--- route: unauthenticated (trust fence) ---' | Add-Content $log
$result = (curl.exe -sS -X POST -H 'Content-Type: application/json' -d '{}' -o NUL -w 'status=%{http_code}' --max-time 30 "$base/websearch-toggle/state" 2>&1 | Out-String).Trim()
"no-auth $result (401 expected)" | Add-Content $log

'--- route: wrong method ---' | Add-Content $log
$result = (curl.exe -sS -c $jar -b $jar -o NUL -w 'status=%{http_code}' --max-time 30 "$base/websearch-toggle/state" 2>&1 | Out-String).Trim()
"GET $result (405 expected)" | Add-Content $log

taskkill /PID $process.Id /T /F 2>&1 | Add-Content $log
Start-Sleep -Seconds 2

'=== stderr (must be empty) ===' | Add-Content $log
([string](Get-Content $err -Raw -ErrorAction SilentlyContinue)) | Add-Content $log
'=== stdout ===' | Add-Content $log
([string](Get-Content $out -Raw -ErrorAction SilentlyContinue)) | Add-Content $log
'DONE' | Add-Content $log

Get-Content $log
