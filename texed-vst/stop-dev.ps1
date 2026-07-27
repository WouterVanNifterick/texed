# Stop a dev.ps1 session: the standalone and vite build --watch it started.
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$BuildDir = Join-Path $Root 'build'
$PidFile = Join-Path $BuildDir '.vite-watch.pid'

$texed = Get-Process -Name 'Texed' -ErrorAction SilentlyContinue
if ($texed) {
    Write-Host "Stopping $($texed.Count) Texed instance(s)..."
    $texed | Stop-Process -Force
}

if (Test-Path $PidFile) {
    $watchPid = [int](Get-Content $PidFile -Raw)
    Remove-Item $PidFile -Force
    $proc = Get-Process -Id $watchPid -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Stopping vite build --watch (pid $watchPid)..."
        # /T takes down cmd and the node/vite child it spawned.
        & taskkill.exe /PID $watchPid /T /F 2>$null | Out-Null
    }
} else {
    Write-Host 'No .vite-watch.pid file; watch build may already be stopped.'
}
