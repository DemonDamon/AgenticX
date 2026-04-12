# End-to-end: PyInstaller agx-server.exe + wechat sidecar -> desktop/bundled-backend/win-amd64 -> NSIS.
# Usage: packaging/build_windows_installer.ps1
# Env: SKIP_BACKEND=1 — skip PyInstaller if packaging/dist/win-amd64/agx-server.exe already exists (still smoke).
# Author: Damon Li

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$PackagingDir = $ScriptDir
$DesktopDir = Join-Path $ProjectRoot 'desktop'
$VenvDir = Join-Path $PackagingDir '.venv-packaging'
$PyDir = Join-Path $PackagingDir 'pyinstaller'
$DistArchDir = Join-Path $PackagingDir 'dist\win-amd64'
$WorkArchDir = Join-Path $PackagingDir 'build\win-amd64'
$BundledDir = Join-Path $DesktopDir 'bundled-backend\win-amd64'
$SkipPyInstaller = ($env:SKIP_BACKEND -eq '1')

function Find-PythonLauncher {
    $ver = 'import sys; raise SystemExit(0 if sys.version_info>=(3,10) else 1)'
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($py) {
        & $py.Source @('-3.12', '-c', $ver) 2>$null
        if ($LASTEXITCODE -eq 0) { return @{ Kind = 'py312'; Exe = $py.Source } }
    }
    foreach ($name in @('python3.12', 'python3', 'python')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        & $cmd.Source '-c' $ver 2>$null
        if ($LASTEXITCODE -eq 0) { return @{ Kind = 'plain'; Exe = $cmd.Source } }
    }
    return $null
}

Write-Host '=== Building Machi (Windows x64, bundled backend) ==='

$PyLaunch = Find-PythonLauncher
if (-not $PyLaunch) {
    throw 'Need Python >= 3.10 on PATH (e.g. Python 3.12 or `py -3.12`).'
}

$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
$VenvPip = Join-Path $VenvDir 'Scripts\pip.exe'

if (-not (Test-Path $VenvPython)) {
    Write-Host '--- Creating packaging venv ---'
    if ($PyLaunch.Kind -eq 'py312') {
        & $PyLaunch.Exe @('-3.12', '-m', 'venv', $VenvDir)
    } else {
        & $PyLaunch.Exe @('-m', 'venv', $VenvDir)
    }
}

& $VenvPip install -q -U pip
& $VenvPip install -q pyinstaller

$ExePath = Join-Path $DistArchDir 'agx-server.exe'
$HaveCachedBackend = Test-Path $ExePath

if (-not $SkipPyInstaller) {
    Write-Host '--- Step 1: PyInstaller (agx-server.exe) ---'
    & $VenvPip uninstall -y agenticx 2>$null
    & $VenvPip install -q $ProjectRoot

    New-Item -ItemType Directory -Force -Path $DistArchDir | Out-Null
    New-Item -ItemType Directory -Force -Path $WorkArchDir | Out-Null

    Push-Location $PyDir
    try {
        & $VenvPython -m PyInstaller agx_serve.spec `
            --distpath $DistArchDir `
            --workpath $WorkArchDir `
            --clean `
            --noconfirm
    } finally {
        Pop-Location
    }

    if (-not (Test-Path $ExePath)) {
        Write-Error "Expected agx-server.exe not found: $ExePath"
    }
}
else {
    if (-not $HaveCachedBackend) {
        Write-Error "SKIP_BACKEND=1 but missing cached binary: $ExePath"
    }
    Write-Host '--- Step 1: Skipping PyInstaller (SKIP_BACKEND=1) ---'
}

Write-Host '--- Smoke test (agx-server.exe) ---'
$FreePort =
  (& $VenvPython -c "import socket; s=socket.socket(); s.bind(('127.0.0.1',0)); print(s.getsockname()[1]); s.close()")).Trim()
$proc = Start-Process -FilePath $ExePath `
    -ArgumentList @('--host', '127.0.0.1', '--port', "$FreePort") `
    -PassThru `
    -WindowStyle Hidden `
    -WorkingDirectory $env:USERPROFILE

$code = '000'
for ($i = 0; $i -lt 60; $i++) {
    if ($proc.HasExited) {
        Write-Error 'agx-server.exe exited early during smoke test'
    }
    $code = (& curl.exe --noproxy '*' -s -o NUL -w '%{http_code}' "http://127.0.0.1:${FreePort}/api/session" 2>$null)
    if ($code -eq '200') { break }
    Start-Sleep -Seconds 1
}

try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
Wait-Process -Id $proc.Id -ErrorAction SilentlyContinue

if ($code -ne '200') {
    Write-Error "/api/session expected 200, got $code (after up to 60s)"
}
Write-Host '--- Smoke test passed ---'

Write-Host '--- Step 2: wechat-sidecar (Windows amd64) ---'
$SidecarDir = Join-Path $PackagingDir 'wechat-sidecar'
Push-Location $SidecarDir
try {
    $env:GOOS = 'windows'
    $env:GOARCH = 'amd64'
    go build -ldflags '-s -w' -o agx-wechat-sidecar.exe .
} finally {
    Pop-Location
    Remove-Item Env:GOOS -ErrorAction SilentlyContinue
    Remove-Item Env:GOARCH -ErrorAction SilentlyContinue
}

$SidecarExe = Join-Path $SidecarDir 'agx-wechat-sidecar.exe'
if (-not (Test-Path $SidecarExe)) {
    Write-Error "wechat sidecar build failed: $SidecarExe"
}

Write-Host '--- Step 3: Stage desktop/bundled-backend/win-amd64 ---'
New-Item -ItemType Directory -Force -Path $BundledDir | Out-Null
Copy-Item -Path $ExePath -Destination (Join-Path $BundledDir 'agx-server.exe') -Force
Copy-Item -Path $SidecarExe -Destination (Join-Path $BundledDir 'agx-wechat-sidecar.exe') -Force

Write-Host '--- Step 4: npm ci + desktop build ---'
Push-Location $DesktopDir
try {
    npm ci
    npm run build
    Write-Host '--- Step 5: node-pty (native) ---'
    npx electron-rebuild -f -w node-pty
    Write-Host '--- Step 6: electron-builder (NSIS x64) ---'
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    npx electron-builder --win --x64 --publish never
} finally {
    Pop-Location
}

Write-Host "=== Done. Outputs under $DesktopDir\release\ ==="
Get-ChildItem -Path (Join-Path $DesktopDir 'release') -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
