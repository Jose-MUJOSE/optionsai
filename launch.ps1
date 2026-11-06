param([switch]$Stop, [switch]$NoBrowser, [switch]$Rebuild)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$runtimeDir = Join-Path $projectRoot '.runtime'
$stateFile = Join-Path $runtimeDir 'processes.json'
$null = New-Item -ItemType Directory -Force -Path $runtimeDir
$mutex = New-Object System.Threading.Mutex($false, 'Local\OptionsAI-Launcher')
if (-not $mutex.WaitOne(0)) { Write-Host 'OptionsAI is already starting. Please wait.'; exit 0 }

function Test-Owned($entry) {
    if (-not $entry) { return $false }
    $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if (-not $process) { return $false }
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$entry.started) { return $false }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$($entry.id)"
    return ($cim.CommandLine -and $cim.CommandLine.Contains($projectRoot))
}
function Get-OwnedTree($entry) {
    if (-not (Test-Owned $entry)) { return }
    $entry
    # Windows venv's python.exe redirects execution to a child python.exe.
    foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($entry.id)")) {
        if ($child.CommandLine -and $child.CommandLine.Contains($projectRoot)) {
            $process = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
            if ($process -and $process.StartTime.ToUniversalTime().Ticks -ge [long]$entry.started) {
                Get-OwnedTree @{ id=$process.Id; started=$process.StartTime.ToUniversalTime().Ticks.ToString() }
            }
        }
    }
}
function Wait-Ready([string]$url, $entry, [int]$seconds = 60) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Id $entry.id -ErrorAction SilentlyContinue)) { throw "Server exited. See logs in $runtimeDir" }
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    throw "Startup timed out for $url. See logs in $runtimeDir"
}
function Start-Server([string]$exe, [string[]]$serverArgs, [string]$cwd, [string]$name) {
    $process = Start-Process -FilePath $exe -ArgumentList $serverArgs -WorkingDirectory $cwd -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir "$name.log") -RedirectStandardError (Join-Path $runtimeDir "$name-error.log")
    return @{ id=$process.Id; started=$process.StartTime.ToUniversalTime().Ticks.ToString() }
}
function Save-State { $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8 }

try {
    $state = @{ backend=$null; frontend=$null }
    if (Test-Path -LiteralPath $stateFile) {
        $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
        $state.backend = $saved.backend; $state.frontend = $saved.frontend
    }
    if ($Stop) {
        foreach ($name in @('frontend','backend')) {
            $owned = @(Get-OwnedTree $state[$name])
            [array]::Reverse($owned)
            foreach ($entry in $owned) {
                if (Test-Owned $entry) { Stop-Process -Id $entry.id -Force }
            }
            if ($owned.Count) { Write-Host "Stopped OptionsAI $name." }
            $state[$name] = $null
        }
        Save-State
        exit 0
    }
    foreach ($pair in @(@('frontend',3000), @('backend',8000))) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $pair[1] -ErrorAction SilentlyContinue)
        if ($listeners.Count -gt 0) {
            if (-not (Test-Owned $state[$pair[0]])) { throw "Port $($pair[1]) belongs to another application. It was not stopped. Free the port first." }
            $ownedIds = @(Get-OwnedTree $state[$pair[0]] | ForEach-Object { $_.id })
            foreach ($listener in $listeners) {
                if ($listener.OwningProcess -notin $ownedIds) { throw "Port $($pair[1]) has an unexpected owner. No process was stopped." }
            }
        }
    }
    $pythonExe = Join-Path $projectRoot 'venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $pythonExe)) { throw 'Python environment missing. Run setup.ps1 first.' }
    $nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    $nextScript = Join-Path $projectRoot 'frontend\node_modules\next\dist\bin\next'
    if (-not (Test-Path -LiteralPath $nextScript)) { throw 'Frontend dependencies missing. Run setup.ps1 first.' }
    $env:PYTHONUTF8 = '1'
    $env:PYTHONUNBUFFERED = '1'
    if ($Rebuild -and (Test-Owned $state.frontend)) { throw 'Stop OptionsAI before rebuilding: stop.bat' }
    if ($Rebuild -or -not (Test-Path (Join-Path $projectRoot 'frontend\.next\BUILD_ID'))) {
        Write-Host 'Building OptionsAI frontend...'
        Push-Location (Join-Path $projectRoot 'frontend')
        try { & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' } }
        finally { Pop-Location }
    }
    if (-not (Test-Owned $state.backend)) {
        $state.backend = Start-Server $pythonExe @('-m','uvicorn','backend.main:app','--app-dir',('"'+$projectRoot+'"'),'--host','127.0.0.1','--port','8000') $projectRoot 'backend'
        Save-State
    }
    Wait-Ready 'http://127.0.0.1:8000/health' $state.backend
    $health = Invoke-RestMethod 'http://127.0.0.1:8000/health'
    if ($health.application -ne 'optionsai') { throw 'Unexpected API identity.' }
    if (-not (Test-Owned $state.frontend)) {
        $state.frontend = Start-Server $nodeExe @(('"'+$nextScript+'"'),'start','--hostname','127.0.0.1','--port','3000') (Join-Path $projectRoot 'frontend') 'frontend'
        Save-State
    }
    Wait-Ready 'http://127.0.0.1:3000' $state.frontend
    Write-Host 'OptionsAI ready: http://localhost:3000'
    if (-not $NoBrowser) { Start-Process 'http://localhost:3000' }
} catch {
    Write-Host "OptionsAI: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
