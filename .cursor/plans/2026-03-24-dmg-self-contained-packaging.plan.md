---
name: DMG 自包含打包——一键安装即可运行
overview: 让 Machi Desktop DMG 内嵌 Python 后端运行时，用户双击 DMG 安装后无需额外操作即可使用；同时修复代码签名与公证流程
todos: []
isProject: false
---

# DMG 自包含打包实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Machi Desktop 的 DMG 安装包自包含 Python 后端运行时（`agx serve`），用户双击安装后无需安装 Python、pip install 或任何额外操作即可直接运行。

**Architecture:** 使用 PyInstaller 将 `agx serve` 打包为单文件 macOS 二进制（`agx-server`），通过 electron-builder 的 `extraResources` 嵌入 `.app` bundle；Electron main process 根据 `app.isPackaged` 从 `process.resourcesPath` 启动内嵌二进制，而非从系统 PATH 找 `agx` CLI。远程模式（已有 plan）优先级更高时可跳过本地 bundled 启动。构建 CI 脚本覆盖 arm64 + x64 双架构、代码签名与 Apple 公证。

**Tech Stack:** PyInstaller (Python → standalone binary), electron-builder (Electron → DMG), Apple codesign + notarytool, GitHub Actions CI

**现有代码关键点：**

- `desktop/electron/main.ts`:
  - L308-312: `spawnAgx()` — 直接 `spawn("agx", args, { shell: false })`，从系统 PATH 查找
  - L315-333: `checkAgxCli()` — 运行 `agx --version` 检测 CLI
  - L335-366: `startStudioServe()` — spawn `agx serve --host 127.0.0.1 --port <port>`
  - L488-503: `app.isPackaged` — 已有打包/开发模式分支，但仅用于 UI 加载
- `desktop/electron-builder.yml`:
  - `extraResources: [assets/**/*]` — 目前只包含图标文件
  - `mac.target: [dmg, zip]`，双架构 `[arm64, x64]`
- `pyproject.toml`:
  - L192-194: `agenticx = "agenticx.cli.main:main"` — CLI 入口点
  - 32 个核心依赖，`agenticx[all]` 含更多可选依赖
- `agenticx/cli/main.py`:
  - L534-552: `serve()` 命令 → `create_studio_app()` + `uvicorn.run()`
- `agenticx/studio/server.py`:
  - 引用 ~20 个 `agenticx.`* 子模块，是后端的核心入口

---

## Phase 0: 前置调研与环境准备

### Task 0.1: 确认 PyInstaller 可成功打包 agx serve

**Files:**

- Create: `packaging/pyinstaller/test_bundle.py` (临时测试入口)
- Create: `packaging/pyinstaller/agx_serve.spec` (PyInstaller spec)

**Requirements:**

- FR-0.1: 在当前 macOS (arm64) 上用 PyInstaller 打包一个最小化的 `agx serve` 入口，验证能独立运行
- FR-0.2: 记录所有 hidden imports 和 data files（PyInstaller 对动态导入支持差）
- FR-0.3: 验证打包后二进制大小是否在可接受范围（目标 < 200MB）
- AC-1: 打包后的二进制 `./agx-server --port 8000` 能启动 FastAPI 并响应 `/api/session`
- AC-2: 不安装 Python 的干净环境下能运行

**Step 1: 创建最小化入口脚本**

```python
#!/usr/bin/env python3
"""Standalone entry point for agx serve bundled with PyInstaller.

Author: Damon Li
"""

import sys
import os

def main():
    import argparse
    parser = argparse.ArgumentParser(description="AgenticX Studio Server (bundled)")
    parser.add_argument("--host", default="127.0.0.1", help="Listen host")
    parser.add_argument("--port", type=int, default=8000, help="Listen port")
    args = parser.parse_args()

    # Suppress macOS dock icon for headless server process
    if sys.platform == "darwin":
        try:
            import ctypes
            objc = ctypes.cdll.LoadLibrary("/usr/lib/libobjc.A.dylib")
            objc.objc_getClass.restype = ctypes.c_void_p
            objc.sel_registerName.restype = ctypes.c_void_p
            objc.objc_msgSend.restype = ctypes.c_void_p
            objc.objc_msgSend.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
            ns_app = objc.objc_msgSend(
                objc.objc_getClass(b"NSApplication"),
                objc.sel_registerName(b"sharedApplication"),
            )
            objc.objc_msgSend.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int64]
            objc.objc_msgSend(ns_app, objc.sel_registerName(b"setActivationPolicy:"), 2)
        except Exception:
            pass

    os.environ.setdefault("AGX_DESKTOP_TOKEN", os.environ.get("AGX_DESKTOP_TOKEN", ""))

    from agenticx.studio.server import create_studio_app
    import uvicorn

    app = create_studio_app()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
```

**Step 2: 编写 PyInstaller spec 文件**

```python
# packaging/pyinstaller/agx_serve.spec
# -*- mode: python ; coding: utf-8 -*-
import sys
import os
from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

# Collect all agenticx submodules (many are dynamically imported)
agenticx_hiddenimports = collect_submodules('agenticx')
# litellm has dynamic provider loading
litellm_hiddenimports = collect_submodules('litellm')
# uvicorn needs specific loaders
uvicorn_hiddenimports = ['uvicorn.lifespan.on', 'uvicorn.lifespan.off', 'uvicorn.lifespan',
                         'uvicorn.protocols.http.auto', 'uvicorn.protocols.http.h11_impl',
                         'uvicorn.protocols.http.httptools_impl',
                         'uvicorn.protocols.websockets.auto',
                         'uvicorn.protocols.websockets.websockets_impl',
                         'uvicorn.logging']

hiddenimports = (
    agenticx_hiddenimports
    + litellm_hiddenimports
    + uvicorn_hiddenimports
    + ['tiktoken_ext.openai_public', 'tiktoken_ext']
)

# Collect data files (YAML configs, JSON schemas, templates)
datas = collect_data_files('agenticx', include_py_files=False)
datas += collect_data_files('litellm', include_py_files=False)
datas += collect_data_files('tiktoken')

a = Analysis(
    ['agx_serve_entry.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['torch', 'tensorflow', 'easyocr', 'matplotlib', 'scipy',
              'sklearn', 'pandas', 'plotly', 'seaborn',
              'chromadb', 'qdrant_client', 'pymilvus', 'neo4j',
              'pytest', 'black', 'mypy', 'flake8', 'isort',
              'mkdocs', 'mkdocstrings'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='agx-server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=True,
    upx=False,  # UPX can cause issues with signed binaries on macOS
    console=True,
    target_arch=None,  # Will be set by CI per architecture
)
```

**Step 3: 本地测试打包**

```bash
cd packaging/pyinstaller
pip install pyinstaller
pyinstaller agx_serve.spec --clean
# 验证
./dist/agx-server --host 127.0.0.1 --port 9999
# 另一个终端
curl http://127.0.0.1:9999/api/session
```

**Step 4: 记录所有需要调整的 hidden imports 和 data files**

在测试过程中逐步发现缺失项，更新 spec 文件，直到 `agx-server` 能完整启动并响应所有核心 API。

---

## Phase 1: 正式打包脚本

### Task 1.1: 创建 Python 后端打包脚本

**Files:**

- Create: `packaging/pyinstaller/agx_serve_entry.py` (从 Task 0.1 定稿)
- Create: `packaging/pyinstaller/agx_serve.spec` (从 Task 0.1 定稿)
- Create: `packaging/build_backend.sh` (自动化打包脚本)

**Requirements:**

- FR-1.1: `build_backend.sh` 接受 `--arch` 参数（`arm64` / `x64`），产出对应架构的 `agx-server` 二进制
- FR-1.2: 输出到 `packaging/dist/<arch>/agx-server`
- FR-1.3: 脚本可在 CI 中直接调用
- AC-1: arm64 打包在 Apple Silicon 上执行，x64 打包在 Intel 或交叉编译环境执行
- AC-2: 打包完成后自动运行 smoke test（启动 + 健康检查 + 关闭）

**build_backend.sh 骨架：**

```bash
#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:-arm64}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$SCRIPT_DIR/dist/$ARCH"

echo "=== Building agx-server for $ARCH ==="

cd "$SCRIPT_DIR/pyinstaller"

# Ensure agenticx is installed in current env
pip install -e "$PROJECT_ROOT" 2>/dev/null || true
pip install pyinstaller

# Build
pyinstaller agx_serve.spec \
  --distpath "$DIST_DIR" \
  --workpath "$SCRIPT_DIR/build/$ARCH" \
  --clean \
  --noconfirm

BINARY="$DIST_DIR/agx-server"
echo "=== Built: $BINARY ($(du -sh "$BINARY" | cut -f1)) ==="

# Smoke test
echo "=== Smoke test ==="
"$BINARY" --host 127.0.0.1 --port 0 &
PID=$!
sleep 5
if kill -0 "$PID" 2>/dev/null; then
  echo "✓ agx-server started successfully"
  kill "$PID" 2>/dev/null || true
else
  echo "✗ agx-server failed to start"
  exit 1
fi
```

---

## Phase 2: electron-builder 集成内嵌后端

### Task 2.1: 修改 electron-builder.yml 嵌入 agx-server

**Files:**

- Modify: `desktop/electron-builder.yml`

**Requirements:**

- FR-2.1: 在 `extraResources` 中按架构包含预打包的 `agx-server` 二进制
- FR-2.2: arm64 DMG 打包 arm64 二进制，x64 DMG 打包 x64 二进制
- FR-2.3: 二进制文件放在 `desktop/bundled-backend/<arch>/agx-server`，构建前由 CI 或手动放置
- AC-1: `assets/**/`* 继续打包（图标等）
- AC-2: 不影响 Windows/Linux 构建（它们走各自的 target）

**修改后的 electron-builder.yml：**

```yaml
appId: com.agenticx.desktop
productName: Machi
directories:
  output: release
files:
  - dist/**/*
  - dist-electron/**/*
extraResources:
  - assets/**/*
  - from: "bundled-backend/${arch}"
    to: "backend"
    filter:
      - "**/*"
mac:
  target:
    - target: dmg
      arch:
        - arm64
        - x64
    - target: zip
      arch:
        - arm64
        - x64
  icon: assets/icon.icns
  category: public.app-category.developer-tools
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
win:
  target:
    - nsis
  icon: assets/icon.ico
linux:
  target:
    - AppImage
```

### Task 2.2: 创建 macOS entitlements 文件

**Files:**

- Create: `desktop/build/entitlements.mac.plist`

**Requirements:**

- FR-2.4: Hardened Runtime 需要的最小权限声明
- FR-2.5: 允许网络访问（server socket）、允许执行嵌入的 agx-server 二进制
- AC-1: 不请求不必要的权限

**entitlements.mac.plist：**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.network.server</key>
  <true/>
</dict>
</plist>
```

### Task 2.3: 创建架构占位目录结构

**Files:**

- Create: `desktop/bundled-backend/arm64/.gitkeep`
- Create: `desktop/bundled-backend/x64/.gitkeep`

**Requirements:**

- FR-2.6: CI 构建前会将 PyInstaller 产出复制到此目录
- AC-1: `.gitkeep` 保证目录结构被 git 跟踪，但二进制本身被 `.gitignore` 忽略

**在 `desktop/.gitignore` 中添加：**

```
bundled-backend/arm64/agx-server
bundled-backend/x64/agx-server
```

---

## Phase 3: 改造 Electron main process 使用内嵌后端

### Task 3.1: 新增 bundled backend 启动逻辑

**Files:**

- Modify: `desktop/electron/main.ts`

**Requirements:**

- FR-3.1: 新增 `resolveBundledBackend()` 函数，在 `app.isPackaged` 时返回内嵌 `agx-server` 二进制路径
- FR-3.2: 路径为 `path.join(process.resourcesPath, "backend", "agx-server")`
- FR-3.3: 开发模式（`!app.isPackaged`）仍使用系统 PATH 上的 `agx` CLI（现有行为）
- AC-1: 远程模式（`remoteConfig` 非 null，来自 remote-backend plan）优先级最高，跳过本地启动
- AC-2: 不删除现有的 `spawnAgx()` 函数——开发模式继续使用

**新增函数：**

```typescript
function resolveBundledBackend(): string | null {
  if (!app.isPackaged) return null;
  const binary = path.join(process.resourcesPath, "backend", "agx-server");
  if (fs.existsSync(binary)) return binary;
  return null;
}

function spawnBundledServer(
  binaryPath: string,
  args: string[],
  options: { cwd?: string; stdio: ("ignore" | "pipe")[]; env: NodeJS.ProcessEnv }
): ChildProcess {
  fs.chmodSync(binaryPath, 0o755);
  return spawn(binaryPath, args, { ...options, shell: false });
}
```

### Task 3.2: 改造启动流程——三级优先级

**Files:**

- Modify: `desktop/electron/main.ts` (`startStudioServe` 和 `app.whenReady`)

**Requirements:**

- FR-3.4: 启动优先级：(1) 远程模式 → (2) Bundled 内嵌二进制 → (3) 系统 PATH `agx` CLI
- FR-3.5: Bundled 模式下不调用 `checkAgxCli()`（因为用内嵌二进制）
- FR-3.6: 如果内嵌二进制不存在（开发环境、构建异常），fallback 到系统 PATH `agx`
- FR-3.7: 所有模式的 `waitServeReady()` 逻辑不变
- AC-1: 打包后的 DMG 安装运行时，直接使用内嵌 `agx-server`，无需系统 Python
- AC-2: 开发模式（`npm run dev`）行为完全不变

**改造后的 startStudioServe 逻辑：**

```typescript
async function startStudioServe(): Promise<void> {
  apiPort = await pickFreePort();
  const desktopHome = os.homedir();
  const augmentedPath = buildAugmentedPath();

  const bundledPath = resolveBundledBackend();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: augmentedPath,
    AGX_DESKTOP_TOKEN: apiToken,
    AGX_WORKSPACE_ROOT: desktopHome,
    AGX_DESKTOP_UNRESTRICTED_FS: "1",
  };

  if (bundledPath) {
    // Bundled mode: use embedded agx-server binary
    serveProcess = spawnBundledServer(
      bundledPath,
      ["--host", "127.0.0.1", "--port", String(apiPort)],
      { cwd: desktopHome, stdio: ["ignore", "pipe", "pipe"], env }
    );
  } else {
    // Dev/fallback mode: use system agx CLI
    serveProcess = spawnAgx(
      ["serve", "--host", "127.0.0.1", "--port", String(apiPort)],
      { cwd: desktopHome, stdio: ["ignore", "pipe", "pipe"], env }
    );
  }

  serveStdoutBuffer = "";
  serveStderrBuffer = "";
  if (serveProcess.stdout) {
    serveProcess.stdout.on("data", (chunk: Buffer) => {
      serveStdoutBuffer = (serveStdoutBuffer + chunk.toString("utf-8")).slice(-4000);
    });
  }
  if (serveProcess.stderr) {
    serveProcess.stderr.on("data", (chunk: Buffer) => {
      serveStderrBuffer = (serveStderrBuffer + chunk.toString("utf-8")).slice(-4000);
    });
  }
}
```

**改造后的 app.whenReady 逻辑（关键分支）：**

```typescript
app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));
    // ... dock icon setup ...

    // Priority 1: Remote mode (from remote-backend plan)
    remoteConfig = loadRemoteConfig();
    if (remoteConfig) {
      // ... remote mode logic (unchanged from remote-backend plan) ...
    } else {
      // Priority 2/3: Bundled or system CLI
      const bundledPath = resolveBundledBackend();
      if (!bundledPath) {
        // Priority 3: Fallback to system agx
        const agxOk = await checkAgxCli();
        if (!agxOk) {
          await dialog.showMessageBox({
            type: "error",
            title: "未找到 AgenticX",
            message: "无法找到 agx 命令行工具",
            detail: "请先安装：pip install agenticx\n\n或使用远程服务器模式（设置 → 服务器连接）",
          });
          app.quit();
          return;
        }
      }
      await startStudioServe();
      await waitServeReady();
    }

    registerIpc();
    createWindow();
    createTray();
  } catch (error) {
    // ... error handling ...
  }
});
```

---

## Phase 4: 代码签名与公证

### Task 4.1: 配置 Apple 代码签名

**Files:**

- Modify: `desktop/electron-builder.yml` (已在 Task 2.1 添加 hardenedRuntime)
- Modify: `desktop/package.json` (添加 afterSign 钩子)
- Create: `desktop/build/notarize.js` (公证脚本)

**Requirements:**

- FR-4.1: electron-builder 构建时使用 Apple Developer ID 证书签名
- FR-4.2: 通过 `afterSign` 钩子调用 `notarytool` 提交公证
- FR-4.3: 环境变量配置：`APPLE_ID`、`APPLE_ID_PASSWORD`（App-specific password）、`APPLE_TEAM_ID`
- FR-4.4: 内嵌的 `agx-server` 二进制也需要签名（electron-builder 会自动签 extraResources 中的 Mach-O）
- AC-1: 无证书环境（开发者本机无 Developer ID）构建不报错，只是未签名
- AC-2: CI 环境通过 secrets 注入证书

**notarize.js：**

```javascript
const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_ID_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.log("Skipping notarization: Apple credentials not set");
    return;
  }

  console.log(`Notarizing ${appName}...`);
  await notarize({
    appBundleId: "com.agenticx.desktop",
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword,
    teamId,
  });
  console.log("Notarization complete");
};
```

**package.json 添加：**

```json
"build": {
  "afterSign": "build/notarize.js"
}
```

**新增 dev 依赖：**

```bash
npm install --save-dev @electron/notarize
```

---

## Phase 5: 完整构建脚本（端到端）

### Task 5.1: 创建统一构建脚本

**Files:**

- Create: `packaging/build_dmg.sh`

**Requirements:**

- FR-5.1: 一个脚本完成全流程：打包 Python 后端 → 复制到 desktop/bundled-backend → 构建 Electron → 输出 DMG
- FR-5.2: 支持 `--arch arm64|x64|universal` 参数
- FR-5.3: 支持 `--skip-backend` 跳过 Python 打包（使用已有的 bundled binary）
- AC-1: 最终 DMG 在 `desktop/release/` 目录
- AC-2: 脚本幂等，重复运行不会出错

**build_dmg.sh 骨架：**

```bash
#!/usr/bin/env bash
set -euo pipefail

ARCH="${1:-arm64}"
SKIP_BACKEND="${SKIP_BACKEND:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESKTOP_DIR="$PROJECT_ROOT/desktop"

echo "=== Building Machi DMG ($ARCH) ==="

# Step 1: Build Python backend
if [ -z "$SKIP_BACKEND" ]; then
  echo "--- Step 1: Building Python backend ---"
  "$SCRIPT_DIR/build_backend.sh" "$ARCH"
else
  echo "--- Step 1: Skipping backend build ---"
fi

# Step 2: Copy backend binary to desktop/bundled-backend
echo "--- Step 2: Copying backend binary ---"
mkdir -p "$DESKTOP_DIR/bundled-backend/$ARCH"
cp "$SCRIPT_DIR/dist/$ARCH/agx-server" "$DESKTOP_DIR/bundled-backend/$ARCH/agx-server"
chmod +x "$DESKTOP_DIR/bundled-backend/$ARCH/agx-server"

# Step 3: Install desktop dependencies
echo "--- Step 3: Installing desktop dependencies ---"
cd "$DESKTOP_DIR"
npm ci

# Step 4: Build frontend + Electron
echo "--- Step 4: Building Electron app ---"
npm run build

# Step 5: Package DMG
echo "--- Step 5: Packaging DMG ---"
npx electron-builder --mac --$ARCH

echo "=== Done! DMG at: $DESKTOP_DIR/release/ ==="
ls -lh "$DESKTOP_DIR/release/"*.dmg 2>/dev/null || echo "(no DMG found)"
```

---

## Phase 6: CI/CD 自动化（GitHub Actions）

### Task 6.1: 创建 GitHub Actions 构建工作流

**Files:**

- Create: `.github/workflows/build-desktop.yml`

**Requirements:**

- FR-6.1: 手动触发（`workflow_dispatch`）+ tag 触发（`v`*）
- FR-6.2: macOS arm64 和 x64 分别在对应 runner 上构建（`macos-14` for arm64, `macos-13` for x64）
- FR-6.3: 上传 DMG + ZIP 为 artifacts
- FR-6.4: tag 触发时自动创建 GitHub Release 并附加构件
- AC-1: 证书和公证通过 GitHub Secrets 注入
- AC-2: 无 secrets 时仍可构建（无签名版本）

**工作流骨架：**

```yaml
name: Build Desktop

on:
  workflow_dispatch:
    inputs:
      arch:
        description: 'Architecture'
        required: true
        default: 'arm64'
        type: choice
        options: [arm64, x64]
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: macos-14
            arch: arm64
          - os: macos-13
            arch: x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Python dependencies
        run: pip install -e ".[all]" pyinstaller

      - name: Build Python backend
        run: packaging/build_backend.sh ${{ matrix.arch }}

      - name: Copy backend binary
        run: |
          mkdir -p desktop/bundled-backend/${{ matrix.arch }}
          cp packaging/dist/${{ matrix.arch }}/agx-server desktop/bundled-backend/${{ matrix.arch }}/

      - name: Install desktop dependencies
        working-directory: desktop
        run: npm ci

      - name: Build desktop
        working-directory: desktop
        run: npm run build

      - name: Package DMG
        working-directory: desktop
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
        run: npx electron-builder --mac --${{ matrix.arch }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: machi-${{ matrix.arch }}
          path: |
            desktop/release/*.dmg
            desktop/release/*.zip
```

---

## Phase 7: 验证与文档

### Task 7.1: 端到端验证清单

**Requirements:**

- 干净 macOS 上安装 DMG → 双击 Machi.app → 后端自动启动 → 聊天功能正常
- 检查进程列表 `ps aux | grep agx-server` 确认使用内嵌二进制
- 退出 Machi → `agx-server` 进程被清理
- 合盖恢复后 → 后端仍在运行 / 自动重连
- 远程模式配置后 → 不启动内嵌后端
- Gatekeeper 不拦截（签名 + 公证通过）
- arm64 DMG 在 Apple Silicon 上运行
- x64 DMG 在 Intel Mac 上运行

### Task 7.2: 更新 README 和发版文档

**Files:**

- Modify: `desktop/README.md` 或 create if not exists

**Requirements:**

- FR-7.1: 记录三种运行方式：(1) DMG 自包含安装 (2) 开发模式 `npm run dev` (3) 远程后端模式
- FR-7.2: 记录构建命令 `packaging/build_dmg.sh arm64`
- FR-7.3: 记录 CI 所需的 GitHub Secrets 列表

---

## 实施依赖图

```
Phase 0 (PyInstaller 调研) ─── Phase 1 (打包脚本) ─── Phase 2 (electron-builder 集成)
                                                        │
                                        Phase 3 (main.ts 改造) ─── Phase 5 (端到端脚本)
                                                        │                │
                                        Phase 4 (签名/公证)     Phase 6 (CI/CD)
                                                                         │
                                                                 Phase 7 (验证+文档)
```

## 工作量估算


| Phase                        | 预计时间   | 优先级          |
| ---------------------------- | ------ | ------------ |
| Phase 0: PyInstaller 调研      | 2-3 小时 | P0 - 决定方案可行性 |
| Phase 1: 打包脚本                | 1 小时   | P0           |
| Phase 2: electron-builder 集成 | 1 小时   | P0           |
| Phase 3: main.ts 改造          | 1-2 小时 | P0           |
| Phase 4: 代码签名/公证             | 1-2 小时 | P1 - 分发给他人必需 |
| Phase 5: 端到端脚本               | 0.5 小时 | P1           |
| Phase 6: CI/CD               | 1-2 小时 | P2 - 自动化     |
| Phase 7: 验证+文档               | 1 小时   | P1           |


**MVP（Phase 0-3）= 5-8 小时**，产出可本地验证的自包含 DMG。
**完整版（Phase 0-7）= 10-14 小时**，产出可分发、签名、CI 自动构建的发布级 DMG。

---

## 风险与替代方案


| 风险                            | 影响                       | 缓解/替代                                                                |
| ----------------------------- | ------------------------ | -------------------------------------------------------------------- |
| PyInstaller 打包体积过大（>300MB）    | DMG 臃肿                   | 排除非必要依赖（torch/scipy/pandas）；考虑用 `--onedir` 模式配合 `extraResources` 打目录 |
| litellm 动态导入导致打包不全            | agx-server 运行时缺模块        | 完整 `collect_submodules`；设白名单 provider 只打包常用的                         |
| PyInstaller 不支持 cross-compile | 需要两台 Mac 分别打包            | 使用 GitHub Actions 矩阵：`macos-14` (arm64) + `macos-13` (x64)           |
| Apple 公证需要 Developer ID 证书    | 个人开发者需 $99/年             | 初期先无签名，用户右键"打开"绕过 Gatekeeper；后续加签名                                   |
| 内嵌二进制安全审查                     | Gatekeeper/XProtect 可能标记 | hardened runtime + notarization 解决                                   |
| PyInstaller 替代方案              | 如 PyInstaller 确实有不可解决问题  | 替代方案：(a) Nuitka 编译 (b) 嵌入 conda-standalone minimal env (c) cx_Freeze |


---

## 与现有 Plan 的关系

- `**2026-03-24-desktop-remote-backend.plan.md`**：该 plan 实现远程模式。本 plan 的 Phase 3 中 `app.whenReady` 三级优先级与其兼容——远程模式优先，本地 bundled 次之，系统 CLI 兜底。两个 plan 可并行实施，Phase 3 合并点在 `app.whenReady` 的启动分支逻辑。
- `**desktop_macos_alpha_cc30aede.plan.md`**：早期 macOS 打包 plan，已过时。本 plan 取代其打包相关部分。

