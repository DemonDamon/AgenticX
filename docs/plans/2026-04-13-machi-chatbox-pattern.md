# Machi 借鉴 ChatBox「单仓多平台」模式 — 实施规划

> **目标读者：** 熟悉 AgenticX / Machi 的工程师；实施时可配合 `@superpowers/executing-plans` 分任务执行。

**Goal：** 在不大改产品形态的前提下，引入与 [ChatBox](https://github.com/ChatBoxAI/ChatBox) 类似的 **共享前端 + 平台抽象层**，使同一套 `desktop/src` UI 既能打 **Electron 安装包**，又可选产出 **可部署在内网的 Web 静态入口**（对接远端 `agx serve` / Studio），并与现有「远程服务器连接」能力对齐。

**与 ChatBox 的关键差异（必须先接受）：**

| 维度 | ChatBox Community | Machi / AgenticX |
|------|-------------------|------------------|
| 运行时 | 偏「纯客户端 + 各厂商 API」 | **必须**有 Python `agx serve`（工具、分身、会话、MCP 等） |
| Web 版能力 | 静态 SPA + IndexedDB，无本地文件系统 | Web 仅能覆盖「浏览器允许」的子集；终端/node-pty/本地 spawn 等需降级或禁用 |
| 配置存储 | Desktop 文件 + Web IndexedDB | 已有 `~/.agenticx/config.yaml` + IPC；Web 需改为 **远端配置 API + 浏览器侧缓存** |

**Architecture：** 引入显式 `Platform`（或同构的 `DesktopAdapter` / `WebAdapter`）接口，把 `global.d.ts` 中暴露的 `window.agenticxDesktop` 能力分为：**(A) 仅 Electron**、**(B) Web 可用 HTTP 替代**、**(C) 两端共享（纯前端）**。构建时用 `import.meta.env` 或 `VITE_AGX_PLATFORM=desktop|web` 注入实现。Web 构建产物为静态资源，由 Nginx/CDN 托管；**业务 API 一律指向用户配置的 Studio Base URL**（与现有远程模式一致）。

**Tech Stack：** 现有 Vite + React + Zustand + Electron；新增平台抽象 TypeScript 模块；可选后续 i18n 对齐 ChatBox 的 i18next 模式（非本规划必选）。

---

## 阶段 0：范围与差距清单（1–2 天）

**产出：** `docs/plans/chatbox-pattern-inventory.md` 或在本文附录中维护表格。

**任务：**

1. 枚举 `desktop/src/global.d.ts` 中 `AgenticxDesktopApi` 的每一个方法，标记：
   - `E`：强依赖 Node/Electron（如 `spawnAgx`、pty、本地路径）
   - `W`：可用 `fetch` + Studio REST/WebSocket 替代
   - `S`：与平台无关（可留在 React 层）
2. 对照 `desktop/electron/main.ts` 中 `ipcMain.handle`，建立 **IPC → 未来 Platform 方法** 映射。
3. 明确 **Web MVP 范围**：例如「仅会话聊天 + 设置里的 Provider + MCP 列表只读」或「全功能除终端与本地 Computer Use」——需产品拍板。

**验收：** 团队对「第一版 Web 不包含哪些能力」书面一致。

---

## 阶段 1：平台抽象层（核心，3–7 天）

**Files（示例，以实际重构为准）：**

- Create: `desktop/src/platform/types.ts` — `Platform` 接口（`getApiBase`、`saveProvider`、`…`）
- Create: `desktop/src/platform/desktop.ts` — 包装现有 `window.agenticxDesktop` 调用
- Create: `desktop/src/platform/web.ts` — 使用 `fetch` 调 Studio、`localStorage`/`IndexedDB` 存非敏感缓存
- Create: `desktop/src/platform/index.ts` — `getPlatform(): Platform` 工厂
- Modify: `desktop/src/App.tsx`、`store.ts` 及高频组件 — **禁止**直接调用 `window.agenticxDesktop`，改为 `getPlatform()`（可分批迁移）

**设计要点：**

- Web 实现中，敏感信息（API Key）策略：**优先不落盘到长期存储**，或仅内存 + httpOnly _cookie 由网关代管（企业场景另述）。
- 与 ChatBox 一致：同一套 React 组件，差异只在 `Platform` 实现。

**验收：** Desktop 行为与重构前一致（回归手动测核心路径：开聊、设置保存、MCP 刷新）。

---

## 阶段 2：构建矩阵与 Web 打包（2–5 天）

**Files：**

- Modify: `desktop/vite.config.ts` — `define` 注入 `__AGX_PLATFORM__`
- Modify: `desktop/package.json` — 新增脚本，例如：
  - `build:web`: `VITE_AGX_PLATFORM=web vite build`（输出到 `dist-web/`）
  - `preview:web`: 本地静态服务预览
- Create: `desktop/docs/DEPLOY-WEB.md` — Nginx 示例、CORS、`AGX_DESKTOP_TOKEN` 说明

**注意：**

- Electron 专属依赖（`node-pty` 等）在 Web 构建中必须 **tree-shake 或动态 import 仅在 desktop 分支**，避免打包失败。
- ChatBox 使用 `CHATBOX_BUILD_PLATFORM=web`；本项目建议统一 `VITE_AGX_PLATFORM` 或 `AGX_BUILD_PLATFORM`，与 Python 侧环境变量命名避免冲突。

**验收：** `npm run build:web` 产出可 `python -m http.server` 打开；首屏加载，能配置远端 Base URL 并打通一条只读 API（如 health 或 session list）。

---

## 阶段 3：Studio 侧 API 补齐（与阶段 1–2 并行，视差距 3–10 天）

Web 无法走 IPC 时，凡标记为 `W` 的能力需 **HTTP 等价物**：

- 已有：部分设置、远程模式相关接口（对照 `agenticx/studio/server.py` 与现有路由）。
- 可能需新增：与 `save-provider`、`getToolsRegistry`、skills CRUD 等对等的 **authenticated REST**，并统一使用与 Desktop Token 一致的鉴权。

**验收：** Web 端 `Platform.web` 全流程不依赖 `window.agenticxDesktop`。

---

## 阶段 4：企业部署与「类 ChatBox team-sharing」可选路线

ChatBox README 提到团队共享 API 资源（`team-sharing/`）。AgenticX 侧可选演进：

1. **轻量：** 文档化「内网部署 Web 静态 + 自建 LiteLLM/网关 + 统一 Key」，客户端无 Key。
2. **中量：** Studio 增加租户/团队配置（超出本规划，需单独 PRD）。

**验收：** 与客户场景匹配的部署 Runbook。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| 终端、本地文件、pty 在 Web 不可用 | MVP 明确隐藏或只读提示；完整能力保留 Desktop |
| 安全：Web 存 Key | 优先远端代理；浏览器仅存 session token |
| 双端维护成本 | 接口契约测试（对 Platform 写 integration test） |

---

## 建议的里程碑顺序

1. **M1** — 阶段 0 清单 + Desktop 全量走 `Platform.desktop`（行为不变）
2. **M2** — `build:web` + 登录/health 通
3. **M3** — Web 上核心聊天与 Provider 设置通
4. **M4** — 工具/MCP/Skills 按优先级补齐

---

## 附录：与 DeepWiki 对话的映射

你在 [我和deepwiki谈关于chatbox.md](../../我和deepwiki谈关于chatbox.md) 中确认的结论：

- ChatBox：**一套 React Renderer**，`DesktopPlatform` vs `WebPlatform`，**非两套技术栈**。
- 构建：`CHATBOX_BUILD_PLATFORM=web` 产出静态文件，可上企业服务器。
- 对 Machi：**桌面 exe/dmg 与内网 Web 入口可以并行存在**，但 Machi 的「智能体后端」仍需部署 `agx serve`（或集群），Web 只是 **UI 入口**，这与 ChatBox「纯静态 + 直连公网 API」的假设不同，必须在对外话术里写清楚。

---

**Made-with:** Damon Li（规划文档）
