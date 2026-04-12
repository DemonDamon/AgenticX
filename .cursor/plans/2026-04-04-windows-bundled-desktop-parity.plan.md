# Windows 与 DMG 同级的内嵌后端 + CI（实施锚点）

**Plan-Id:** `2026-04-04-windows-bundled-desktop-parity`

## 目标

- 打包版在 Windows 上从 `resources/backend/agx-server.exe` 启动内嵌 Studio，与 mac DMG 行为一致。
- `electron-builder` 将 `desktop/bundled-backend/win-amd64` 打入 NSIS。
- CI：`v*` tag 与 `workflow_dispatch` 选项 `windows-amd64` 产出 `Machi-*-win-x64.exe`。

## 已落地路径

| 组件 | 路径 |
|------|------|
| Electron 解析 | [desktop/electron/main.ts](desktop/electron/main.ts)：`resolveBundledBackend`（win32 + `.exe`）、`getWechatSidecarPath`（`.exe`）、缺 agx 提示 |
| Builder | [desktop/electron-builder.yml](desktop/electron-builder.yml)：`win.extraResources`、`win.artifactName` |
| 构建脚本 | [packaging/build_windows_installer.ps1](packaging/build_windows_installer.ps1) |
| CI | [.github/workflows/build-desktop.yml](.github/workflows/build-desktop.yml)：`build-tag-windows`、`build-dispatch-windows` |
| 文档 / npm | [desktop/README.md](desktop/README.md)、`npm run build:win:bundled` |
| 忽略 | [desktop/.gitignore](desktop/.gitignore)：`win-amd64` / `win-arm64` 二进制 |

## 需求追溯

- **FR-1**：Windows 安装包内嵌 PyInstaller `agx-server.exe` 与 `agx-wechat-sidecar.exe`。
- **FR-2**：CI 在 tag / manual 下可构建并上传 NSIS。
- **AC-1**：`win-unpacked/resources/backend/` 下存在上述两个文件；`/api/session` 冒烟通过。
