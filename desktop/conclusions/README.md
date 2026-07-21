# Near Desktop 结论索引

> **用途**：Desktop（产品名 Near）模块结论入口。文件级细节见同目录 `desktop_conclusion.md`。
>
> **控制面**：本目录为 `code-module-summaries` 的 `custom` layout（`registry.json` + `state/`）。根 `.gitignore` 的 `conclusions/` 规则会忽略本目录（与 `enterprise/conclusions` 一致，默认不进 git）。
>
> **映射迁移**：2026-07-21 自 `code-summaries/modules/desktop.md` 迁入（`--refresh-modules`）。

## 核心代码在哪？

**不只在 `desktop/src`。** Near 桌面是双进程，两边都是核心：

| 区域 | 路径 | 职责 |
|------|------|------|
| **渲染进程（UI）** | `desktop/src/` | React + Zustand：`App` / `ChatPane` / 设置 / 工作区 / 自动化等 |
| **主进程（壳）** | `desktop/electron/` | Electron 生命周期、`agx serve` 子进程、IPC、`proxyAwareFetch`、飞书/微信 sidecar、AutomationScheduler |
| 配置与打包 | `desktop/package.json`、`vite.config.ts`、`electron-builder.yml`、`scripts/` | 开发/构建/分发 |
| 测试 | `desktop/tests/`、`desktop/src/**/*.test.ts`、`desktop/e2e/` | 单测与 smoke（非运行时核心） |

模块 ownership 的 git root 仍是整个 **`desktop/`**（排除 `node_modules` / `dist*` / `release` 等），这样 `src` 与 `electron` 的变更都会触发同一份 conclusion 增量更新。若将来拆成「renderer / main」两个模块，再跑 `--refresh-modules` 拆分即可。

## 结论文档

| ID | 文档 | Roots |
|----|------|-------|
| `desktop` | [desktop_conclusion.md](./desktop_conclusion.md) | `desktop` |
