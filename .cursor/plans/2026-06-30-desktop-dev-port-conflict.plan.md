---
name: ""
overview: ""
todos: []
isProject: false
---

# Desktop 本地开发端口冲突修复

**日期**: 2026-06-30  
**Planned-with**: claude-opus-4.8  
**问题**: 本地 `npm run dev` 时若 5173 被占，Vite 静默漂移到 5175，Electron 仍连 5173，导致加载到其他应用的登录页（截图中的「企业信息门户」）。

## 根因

三处硬编码不同步：

1. `desktop/vite.config.ts:10` → `port: 5173`（无 `strictPort`）
2. `desktop/package.json:10` → `wait-on tcp:5173`
3. `desktop/electron/main.ts:3027` → `?? "http://localhost:5173"`

Vite 端口漂移时，wait-on 与 Electron 仍锁定 5173，导致全链路错位。

**注意**：打包后的 exe/DMG 走 `file://` 加载 `dist/index.html`，完全不受此影响（`main.ts:3028` 的 `app.isPackaged` 分支）。

## 目标

- 开发者可通过环境变量指定端口
- 默认端口改为较少冲突的 5713
- Vite 端口被占时直接失败（`strictPort: true`），不再静默漂移
- Windows/macOS/Linux 均可正常使用

## 方案

引入 `AGX_DEV_PORT` 环境变量（默认 5713），三处统一读取：

1. `vite.config.ts`：`port` 读 env + `strictPort: true`
2. `electron/main.ts`：devUrl 默认值读 env
3. `package.json` 的 `wait-on`：读 env（Windows 需 `cross-env`）

## 实施步骤

### 1. 安装 cross-env（Windows 兼容）

```bash
cd desktop && npm i -D cross-env
```

### 2. 修改 `desktop/vite.config.ts`

```ts
server: {
  port: Number(process.env.AGX_DEV_PORT) || 5713,
  strictPort: true,
  proxy: { ... }
}
```

### 3. 修改 `desktop/electron/main.ts`

```ts
const devPort = process.env.AGX_DEV_PORT || "5713";
const devUrl = process.env.VITE_DEV_SERVER_URL ?? `http://localhost:${devPort}`;
```

### 4. 修改 `desktop/package.json`

```json
"dev": "cp electron/splash.html dist-electron/splash.html 2>/dev/null || true && concurrently \"vite\" \"tsc -p electron/tsconfig.json --watch\" \"cross-env-shell wait-on tcp:$AGX_DEV_PORT dist-electron/main.js && electron .\"",
```

（或用 node 脚本桥接，避免 shell 语法差异）

### 5. 更新文档（可选）

- `AGENTS.md` 记录 `AGX_DEV_PORT` 用法
- README 提及「端口冲突时可设置 `AGX_DEV_PORT=5715 npm run dev`」

## 验收标准

- [ ] 5173 被占时，执行 `npm run dev` 直接失败并提示端口冲突（不再静默连错页）
- [ ] 执行 `AGX_DEV_PORT=5715 npm run dev`，Vite 占 5715、Electron 连 5715、wait-on 等 5715
- [ ] Windows / macOS / Linux 均可正常启动
- [ ] 打包后的 DMG/exe 行为不变（仍走 `file://`）

## 备注

- 生产打包完全不受影响（`app.isPackaged` 分支）
- `VITE_DEV_SERVER_URL` 仍保留最高优先级（向后兼容）
- 若后续需要「零配置自动找可用端口」，可在此基础上增加 `get-port` 探测逻辑

**Plan-Id**: 2026-06-30-desktop-dev-port-conflict  
**Plan-File**: .cursor/plans/2026-06-30-desktop-dev-port-conflict.plan.md
**Made-with**: Damon Li