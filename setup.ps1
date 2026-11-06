$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'venv\Scripts\python.exe')) {
    & py -3.12 -m venv venv
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 and retry.' }
}
& .\venv\Scripts\python.exe -m pip install -r backend\requirements.txt -r requirements-dev.txt
if ($LASTEXITCODE -ne 0) { throw 'Python dependency install failed.' }
Push-Location frontend
try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Host 'Setup complete. Double-click start.bat.'
