# Kill a running Texed standalone, rebuild, then launch it again.
param(
    [ValidateSet('Debug', 'Release', 'RelWithDebInfo', 'MinSizeRel')]
    [string]$Config = 'Release'
)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$BuildDir = Join-Path $Root 'build'
$Exe = Join-Path $BuildDir "Texed_artefacts\$Config\Standalone\Texed.exe"

$running = Get-Process -Name 'Texed' -ErrorAction SilentlyContinue
if ($running) {
    Write-Host "Stopping $($running.Count) running Texed instance(s)..."
    $running | Stop-Process -Force
    Start-Sleep -Milliseconds 400
}

if (-not (Test-Path (Join-Path $BuildDir 'CMakeCache.txt'))) {
    Write-Host "Configuring cmake..."
    cmake -S $Root -B $BuildDir
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "Building texed-dist ($Config)..."
cmake --build $BuildDir --config $Config --target texed-dist
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not (Test-Path $Exe)) {
    Write-Error "Standalone not found: $Exe"
    exit 1
}

Write-Host "Launching $Exe"
Start-Process $Exe
