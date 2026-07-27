# Rebuild the web UI on save and launch the standalone against the live dist
# folder, so React edits show up after reopening the plugin window. C++ changes
# still need a rebuild.
param(
    [ValidateSet('Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel')]
    [string]$Config = 'Release',
    [switch]$SkipBuild,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$RepoRoot = Split-Path $Root -Parent
$WebDir = Join-Path $RepoRoot 'texed-ts'
$DistDir = Join-Path $WebDir 'dist'
$LibraryDir = Join-Path $WebDir 'public\library'
if (-not (Test-Path (Join-Path $LibraryDir 'manifest.json'))) {
    $LibraryDir = Join-Path $WebDir 'dist\library'
}
$BuildDir = Join-Path $Root 'build'
$Exe = Join-Path $BuildDir "Texed_artefacts\$Config\Standalone\Texed.exe"
$PidFile = Join-Path $BuildDir '.vite-watch.pid'

function Test-DistReady {
    Test-Path (Join-Path $DistDir 'index.html')
}

function Wait-DistReady {
    param([int]$TimeoutSec = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-DistReady) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Error 'pnpm not found on PATH. Install Node.js 24+ and pnpm first.'
}
if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    Write-Error 'cmake not found on PATH.'
}
if (-not (Test-Path (Join-Path $WebDir 'node_modules'))) {
    Write-Error "Run: cd texed-ts && pnpm install"
}
$juce = Join-Path $Root 'libs\JUCE\CMakeLists.txt'
if (-not (Test-Path $juce)) {
    $juce = Join-Path $RepoRoot 'dexed-juce\libs\JUCE\CMakeLists.txt'
}
if (-not (Test-Path $juce)) {
    Write-Error "JUCE not found. Clone 8.0.9 into texed-vst/libs/JUCE or use a dexed-juce checkout (see README)."
}

$running = Get-Process -Name 'Texed' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Stopping $($running.Count) running Texed instance(s)..."
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 400
}

New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null

$pnpmCmd = (Get-Command pnpm.cmd -ErrorAction Stop).Source
$watchRunning = $false
if (Test-Path $PidFile) {
    $oldPid = Get-Content $PidFile -ErrorAction SilentlyContinue
    if ($oldPid -and (Get-Process -Id $oldPid -ErrorAction SilentlyContinue)) {
        $watchRunning = $true
    }
}

if (-not $watchRunning) {
    if (-not (Test-DistReady)) {
        Write-Host "Building web UI once in $WebDir ..."
        & $pnpmCmd exec vite build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    Write-Host "Starting vite build --watch in $WebDir ..."
    $watch = Start-Process -FilePath $pnpmCmd -ArgumentList 'exec','vite','build','--watch' -WorkingDirectory $WebDir -PassThru
    $watch.Id | Set-Content -Path $PidFile -Encoding ascii
} else {
    Write-Host "vite build --watch already running (pid $(Get-Content $PidFile))"
}

if (-not (Wait-DistReady)) {
    Write-Error "Timed out waiting for $DistDir\index.html"
}

Write-Host "Configuring cmake with TEXED_LIVE_DIST=$DistDir ..."
cmake -S $Root -B $BuildDir "-DTEXED_LIVE_DIST=$DistDir" -UTEXED_DEV_URL
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $SkipBuild) {
    Write-Host "Building Texed_Standalone ($Config)..."
    cmake --build $BuildDir --config $Config --target Texed_Standalone
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

if ($NoLaunch) {
    Write-Host "Watch build running. Launch skipped (-NoLaunch)."
    exit 0
}

if (-not (Test-Path $Exe)) {
    Write-Error "Standalone not found: $Exe"
}

$env:TEXED_LIBRARY = $LibraryDir
Write-Host "Launching $Exe"
Write-Host "  TEXED_LIBRARY=$LibraryDir"
Write-Host "  Reopen the plugin window after UI edits to pick up vite build --watch output."
Start-Process $Exe
