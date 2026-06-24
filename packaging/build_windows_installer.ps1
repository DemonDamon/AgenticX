# End-to-end: PyInstaller agx-server.exe + wechat sidecar -> desktop/bundled-backend/win-amd64 -> NSIS.
# Usage: packaging/build_windows_installer.ps1
# Env: SKIP_BACKEND=1 - skip PyInstaller if packaging/dist/win-amd64/agx-server.exe already exists (still smoke).
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

function Import-CmdEnvDump {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DumpFile
    )
    foreach ($line in Get-Content -Path $DumpFile) {
        if (-not $line) { continue }
        $idx = $line.IndexOf('=')
        if ($idx -le 0) { continue }
        $name = $line.Substring(0, $idx)
        $value = $line.Substring($idx + 1)
        [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

function Initialize-MsvcToolchain {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) {
        throw "vswhere.exe not found at $vswhere"
    }
    $installPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installPath) {
        throw 'No Visual Studio installation with VC tools found. Please ensure VS2022 C++ Build Tools are installed on runner.'
    }
    $vsDevCmd = Join-Path $installPath 'Common7\Tools\VsDevCmd.bat'
    if (-not (Test-Path $vsDevCmd)) {
        throw "VsDevCmd.bat not found at $vsDevCmd"
    }
    Write-Host "--- Loading MSVC env from $vsDevCmd ---"
    $dumpFile = Join-Path ([System.IO.Path]::GetTempPath()) ("msvc-env-" + [System.Guid]::NewGuid().ToString("N") + ".txt")
    try {
        cmd.exe /s /c "`"$vsDevCmd`" -arch=x64 -host_arch=x64 >nul && set > `"$dumpFile`""
        Import-CmdEnvDump -DumpFile $dumpFile
    } finally {
        Remove-Item -Path $dumpFile -ErrorAction SilentlyContinue
    }
    # node-gyp / electron-rebuild hints
    [System.Environment]::SetEnvironmentVariable('GYP_MSVS_VERSION', '2022', 'Process')
    [System.Environment]::SetEnvironmentVariable('npm_config_msvs_version', '2022', 'Process')

    # Fail-fast verification: catch toolchain bootstrap failure before the long
    # PyInstaller stage so CI logs surface the root cause immediately instead of
    # degrading back to "Could not find any Visual Studio installation to use"
    # ~15 minutes later inside electron-builder's node-gyp call.
    $cl = Get-Command cl.exe -ErrorAction SilentlyContinue
    if (-not $cl) {
        throw "cl.exe not on PATH after VsDevCmd injection -- MSVC toolchain bootstrap failed."
    }
    Write-Host "--- MSVC toolchain ready ---"
    Write-Host "    cl.exe         : $($cl.Source)"
    Write-Host "    VCINSTALLDIR   : $env:VCINSTALLDIR"
    Write-Host "    VCToolsVersion : $env:VCToolsVersion"
}

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
Initialize-MsvcToolchain

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

function Test-DesktopRuntimeImports {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PythonExe
    )

    $script = @'
import importlib
import sys

required = ("chromadb", "onnxruntime", "numpy")
missing = []
for name in required:
    try:
        importlib.import_module(name)
    except Exception:
        missing.append(name)
pdf_ok = False
for pdf_mod in ("fitz", "pypdf"):
    try:
        importlib.import_module(pdf_mod)
        pdf_ok = True
        break
    except Exception:
        pass
if not pdf_ok:
    missing.append("pdf (fitz or pypdf)")

if missing:
    print(f"Missing desktop-runtime deps in packaging venv: {', '.join(missing)}")
    sys.exit(1)

print("desktop-runtime dependency import check passed")
'@

    & $PythonExe '-c' $script
    if ($LASTEXITCODE -ne 0) {
        throw 'desktop-runtime dependency import check failed.'
    }
}

$ExePath = Join-Path $DistArchDir 'agx-server.exe'
$HaveCachedBackend = Test-Path $ExePath

if (-not $SkipPyInstaller) {
    Write-Host '--- Step 1: PyInstaller (agx-server.exe) ---'
    & $VenvPip uninstall -y agenticx 2>$null
    # Install with `desktop-runtime` extras so the bundled exe ships with PDF /
    # Office readers and numpy (GitHub issue #10: "Document ingestion fails for
    # PDF files (missing PDF reader libs / missing numpy)" on Windows).
    & $VenvPip install -q "$ProjectRoot[desktop-runtime]"
    Test-DesktopRuntimeImports -PythonExe $VenvPython

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

Write-Host '--- Bundled runtime dependency check ---'
& $ExePath '--check-desktop-runtime'
if ($LASTEXITCODE -ne 0) {
    throw 'Bundled agx-server.exe is missing desktop runtime dependencies.'
}

Write-Host '--- Smoke test (agx-server.exe) ---'
Write-Host '[build_windows_installer] smoke: free TCP port via TcpListener (no python -c)'
# Avoid fragile python -c quoting in PowerShell; pick ephemeral TCP port in .NET.
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$FreePort = $listener.LocalEndpoint.Port
$listener.Stop()

$proc = Start-Process -FilePath $ExePath -ArgumentList @('--host', '127.0.0.1', '--port', "$FreePort") -PassThru -WindowStyle Hidden -WorkingDirectory $env:USERPROFILE

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
    # Help node-gyp locate VS2022 (required for node-pty native rebuild in electron-builder).
    npm config set msvs_version 2022
    npm ci
    npm run build
    Write-Host '--- Step 5: electron-builder (NSIS x64) ---'
    Write-Host '[build_windows_installer] node-pty rebuild is handled by electron-builder install-app-deps'
    $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
    npx electron-builder --win --x64 --publish never
} finally {
    Pop-Location
}

Write-Host "=== Done. Outputs under $DesktopDir\release\ ==="
Get-ChildItem -Path (Join-Path $DesktopDir 'release') -Filter '*.exe' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName }
