---
name: Desktop 按 backend 隔离本地存储与状态
overview: 切换本地/远程后端时让 Near Desktop 真正"换一个工作区"——窗格、会话、分身上次 session、token 缓存等按 backend 命名空间隔离，本地与远程互不污染、来回切换状态完整恢复
todos: []
isProject: false
---

# Desktop 按 backend 隔离本地存储与状态实施计划

**Goal:** 当用户在「设置 → 服务器」切换 **本地 ↔ 远程**（或多个远程 endpoint）时，Near Desktop 不再用一份 localStorage 串联所有后端的 `sessionId / 窗格快照 / 分身上次 session / token 缓存`，从而消除：

- 远程模式下用本地旧 sessionId 去查远程 → `/api/subagents/status` 等接口 404 噪音
- 切换后端后窗格里仍展示前一份后端的「分身/历史」，用户不知道自己在哪套数据上
- 远程 mode 下点 Provider/Skills/MCP 开关时，UI 改的是 Mac 本机 `~/.agenticx/config.yaml`，而模型调用走的是远端那份 config，造成「点了开关没生效」的错觉

**Architecture:** 不"清空" localStorage，而是按 **当前 backend endpoint** 派生命名空间 key，本地和每个远程 host 各持一份独立快照；同时给顶栏加 backend 标识 chip，并对 Provider/Skills/MCP 设置 UI 在远程模式下做语义澄清。切换连接模式保存后由 Electron 主动 `app.relaunch()` 替代用户手动 ⌘Q。

**Tech Stack:** TypeScript (Electron main + React renderer), Zustand store, localStorage

**现有代码关键点（已核对）：**

- `desktop/src/App.tsx` L21: `WORKSPACE_STATE_STORAGE_KEY = "agx-workspace-state-v1"` —— 窗格 + sessionId 快照
- `desktop/src/utils/avatar-last-session.ts` L1: `AVATAR_LAST_SESSION_STORAGE_KEY = "agx-avatar-last-session-v1"` —— 分身 → 最近 session
- `desktop/src/store.ts` L592: `SESSION_TOKEN_CACHE_KEY = "agx-session-token-cache-v1"` —— 按 sessionId 累计 token
- `desktop/src/components/ChatPane.tsx` L3901/L3933: `agx-session-unattended-v1` —— 按 sessionId 锚定的"未陪伴"标记
- `desktop/src/components/SettingsPanel.tsx` L5016/L5959: `agenticx:mcp:marketplaceIdToNames` —— MCP 安装态名称映射（远程 server 上装的 MCP 名字与本地不同）
- `desktop/electron/main.ts` L1357 / L1407 / L2470: `remoteConfig`、`getStudioUrl()`、`get-connection-mode` IPC —— 已有 backend 解析能力
- `desktop/electron/main.ts` L2748 / L2903: `save-remote-server` 已返回 `restart_required: true`，但当前实现仅 toast 提示，未 `app.relaunch()`

**不需要按 backend 隔离的（属于 UI 本地偏好，应保持全局）：**

- 主题：`agx-theme` / `agx-theme-color` / `agx-chat-style`
- 面板宽度：`agx-sidebar-width` / `agx-history-width-v1` / `agx-settings-panel-size-v1` / `agenticx:taskspace-panel-width` / `agenticx:spawns-column-width`

---

## Phase 1（P0）：localStorage 按 backend 命名空间隔离

### Task 1.1: 新增 backend-scope 工具与命名空间派生

**Files:**

- Create: `desktop/src/utils/backend-scope.ts`
- Modify: `desktop/electron/preload.ts`（暴露同步获取 scope 的能力，避免每次读写都 IPC）
- Modify: `desktop/src/global.d.ts`

**Requirements:**

- FR-1.1.1: 新增 `getBackendScope(): string` —— 同步返回当前 backend 的稳定 key
  - 本地模式 → `"local"`
  - 远程模式 → `host:port` 归一化后的字符串（去 protocol、去末尾 `/`、小写），如 `192.168.32.119:8080`
- FR-1.1.2: 新增 `scopedKey(base: string, scope?: string): string` 工具，约定 `<base>::<scope>`
  - 旧 key（无 `::scope` 后缀）按 `local` scope 兼容读取，避免老用户首次升级丢窗格
- FR-1.1.3: Electron 主进程在 `registerEarlyIpc()` 阶段同步将 `connectionMode` 与 `backendScope` 注入到 `process.env` 或 `additionalArguments`，让 preload 不必 await 即可读取
- AC-1: 切换连接模式后 `getBackendScope()` 返回值改变；同一会话内不会变化（避免 race）
- AC-2: 旧版本用户首次启动新代码，看到的本地窗格/会话与升级前一致（兼容回退到 `local` scope）

### Task 1.2: 改造 4 把 sessionId 锚定的 storage key

**Files:**

- Modify: `desktop/src/App.tsx`（`WORKSPACE_STATE_STORAGE_KEY`）
- Modify: `desktop/src/utils/avatar-last-session.ts`（`AVATAR_LAST_SESSION_STORAGE_KEY`）
- Modify: `desktop/src/store.ts`（`SESSION_TOKEN_CACHE_KEY`）
- Modify: `desktop/src/components/ChatPane.tsx`（`agx-session-unattended-v1`）

**Requirements:**

- FR-1.2.1: 上述 4 个 key 在读写前统一通过 `scopedKey(base, getBackendScope())` 派生
- FR-1.2.2: 读取顺序：先读 `<base>::<scope>`，未命中且 scope === `"local"` 时回退读取无后缀旧 key（一次性迁移）
- FR-1.2.3: 写入时只写 `<base>::<scope>`；首次成功读到旧 key 时，迁移写入新 key 并删除旧 key（仅 `local` scope）
- FR-1.2.4: 不再修改非 sessionId 锚定的 UI 偏好 key（主题、面板宽度等）
- AC-1: 切换到远程模式重启后，`agx-workspace-state-v1::192.168.32.119:8080` 为空 → 启动后回落到「干净的元智能体窗格」，不再恢复本地旧 sessionId
- AC-2: 切回本地模式后，本地窗格 / 历史 / 分身 last-session 完整还原（不被远程模式的操作污染）
- AC-3: 老用户从旧版升级首次进入本地模式，看到的状态与升级前完全一致

### Task 1.3: MCP marketplace 映射按 backend 隔离

**Files:**

- Modify: `desktop/src/components/SettingsPanel.tsx`（`agenticx:mcp:marketplaceIdToNames`）

**Requirements:**

- FR-1.3.1: `agenticx:mcp:marketplaceIdToNames` 同样改用 `scopedKey` 派生
- FR-1.3.2: 旧 key 按 `local` scope 一次性迁移
- AC-1: 在远程后端安装的 MCP 不会污染本地的「已添加」识别
- AC-2: 同一台 Mac 上配置多个远程 endpoint（如内网 + 外网）也互不串台

---

## Phase 2（P0）：切换连接模式自动重启

### Task 2.1: 保存远程配置后由主进程触发 relaunch

**Files:**

- Modify: `desktop/electron/main.ts`（`save-remote-server` IPC）
- Modify: `desktop/src/components/SettingsPanel.tsx`（`handleSave` 流程）

**Requirements:**

- FR-2.1.1: `save-remote-server` IPC 在检测到「连接模式发生变化」（`enabled` 切换 / `url` 变化）时，新增返回字段 `mode_changed: true`
- FR-2.1.2: 渲染层 `handleSave` 在收到 `mode_changed: true` 后，先 `await` 完成本批所有保存（provider / gateway / feishu 等），再弹一个**主题化的应用内确认弹窗**："连接模式已切换，需要重启 Near 应用以加载新后端，是否立即重启？"，按钮：`立即重启` / `稍后手动重启`
- FR-2.1.3: 用户选「立即重启」 → 渲染层 invoke 新 IPC `app-relaunch`，主进程执行 `app.relaunch(); app.exit(0);`
- FR-2.1.4: 用户选「稍后手动重启」 → toast 提示「重启后切换才会生效」，不强制
- AC-1: 重启后 `getConnectionMode()` 与 UI 顶栏标识一致反映新模式
- AC-2: 已选「立即重启」时，渲染层不应在 relaunch 前关闭设置面板，避免视觉抖动后突然黑屏
- AC-3: 不影响仅修改 provider / gateway / feishu 等不涉及连接模式的保存路径（保持现状不弹重启）

---

## Phase 3（P1）：顶栏 backend 标识 + 远程模式语义澄清

### Task 3.1: Topbar 增加 backend chip

**Files:**

- Modify: `desktop/src/components/Topbar.tsx`

**Requirements:**

- FR-3.1.1: 顶栏右上角主题切换按钮**左侧**增加一个紧凑 chip：
  - 本地模式 → 显示「本地」+ 极小绿点
  - 远程模式 → 显示远程 host（如 `192.168.32.119:8080`，过长时省略中间 + 完整 host 在 tooltip 中），+ 极小蓝点
- FR-3.1.2: chip 仅展示，不可点击；hover tooltip 提示「当前连接到 …，到设置 → 服务器切换」
- FR-3.1.3: 视觉与既有 toolbar 图标按钮密度一致，不抢视觉
- AC-1: 用户始终能不进设置就看到自己在哪个后端上
- AC-2: 切到 dark / dim / light 三态主题下都可读

### Task 3.2: 远程模式下 Provider / Skills / MCP 设置 UI 添加语义提示

**Files:**

- Modify: `desktop/src/components/SettingsPanel.tsx`（providers Tab、skills Tab、mcp Tab 顶部 banner）

**Requirements:**

- FR-3.2.1: 当 `connectionMode === "remote"` 时，在 providers / skills / mcp 三个 Tab 顶部增加一个**信息条**（非 alert），文案约：「当前为远程模式，本机 UI 修改写入本机 `~/.agenticx/config.yaml`，但模型调用与 MCP 服务在远端 `<host>` 上加载。如需修改远端配置，请直接编辑远端 `~/.agenticx/config.yaml` 或后续等待远程配置同步上线（P2）。」
- FR-3.2.2: 信息条用主题语义色（warning/info）而非硬编码黄色
- AC-1: 用户不会再误以为「点了 Desktop 这个开关，远端就生效了」
- AC-2: 不在本地模式下出现，避免噪音

---

## Phase 4（P2）：远程模式下 Provider / Skills / MCP 真正走 API

> 原计划为"长期方向，本 plan 不落地"。Task 4.1 已经在用户授权下提前实现并随本批 PR 一起提交；Task 4.2 / 4.3 仍待后续 PR。

### Task 4.1: Provider 走 /api/config/providers ✅ 已实现（2026-05-25）

**Status:** 已落地并随本批 PR 提交。路径前缀使用 `/api/config/`（而非原 plan 草稿里的 `/api/providers`）以避开未来可能落地的「按账号 / 部门粒度」provider 命名空间。

**Files (实际改动):**

- Modify: `agenticx/studio/server.py`（新增 `/api/config/providers`、`/api/config/default-provider`、`/api/config/active-model` 路由）
- Modify: `desktop/electron/main.ts`（新增 `isRemoteMode()` + `studioFetchJson()`；`load-config`、`save-provider`、`set-default-provider`、`delete-provider`、legacy `save-config` 在远程模式下走 HTTP）
- Modify: `desktop/src/components/SettingsPanel.tsx`（`RemoteBackendHintBanner` 增加 `kind="synced"`，Provider Tab 文案改为「直接同步到远端」）

**Requirements (实际落地):**

- FR-4.1.1: 后端新增 `GET /api/config/providers`、`PUT /api/config/providers/{name}`、`DELETE /api/config/providers/{name}`、`PUT /api/config/default-provider`、`PUT /api/config/active-model`，全部走 `_check_token` 鉴权
- FR-4.1.2: 远程模式下 Desktop UI 直接读写远端 config；本机 `~/.agenticx/config.yaml` 的 `providers` / `default_provider` / `active_provider` / `active_model` 字段不再被这些 IPC 修改
- FR-4.1.3: 本地模式行为完全不变（IPC handler 内部以 `isRemoteMode()` 分支）
- FR-4.1.4: `load-config` 在远程模式下，仅 provider/active_model 字段从远端取，`userMode` / `onboarding` / `confirmStrategy` / `agxAccount` 仍读本机（属 Desktop-local 偏好）
- AC-1: 远程模式编辑 provider 后，再访问远端 host `cat ~/.agenticx/config.yaml` 应立即看到字段写入
- AC-2: 远端 `agx serve` 不重启即可感知 provider 变更 —— **待回归验证**（依赖现有 `_reload_configs_if_needed` 机制；若失效再考虑新增刷新接口）

### Task 4.2: Skills / MCP 全局开关走 API（待落地）

**Files:**

- Modify: `desktop/src/components/SettingsPanel.tsx`（已有 `GET/PUT /api/skills/settings` 接入）
- 复用现有 `/api/mcp/*` 接口；改造 marketplace 已添加映射的来源

**Requirements:**

- FR-4.2.1: 远程模式下，Skills 全局禁用列表、MCP auto_connect 列表均通过 API 读写远端配置
- AC-1: 远程模式下点开关，远端立刻感知（与 P1 信息条形成闭环）

### Task 4.3: 远端不可达时的 Provider Tab 降级 UI（新增，待落地）

**Files:**

- Modify: `desktop/electron/main.ts`（`load-config` 在 `studioFetchJson` 失败时返回 `{ ok: false, providers: {}, error }` 而非沉默回落到本机字段）
- Modify: `desktop/src/components/SettingsPanel.tsx`（Provider Tab 顶部加 loading / error / 重试按钮）

**Requirements:**

- FR-4.3.1: 远端 unreachable 时不应静默用本机 providers 顶替展示，避免误导用户以为"远端配置就这些"
- FR-4.3.2: 错误态显示具体原因（HTTP 状态码 / 网络异常摘要）+「重试」按钮，重试不刷新整个设置面板
- AC-1: 拔网线 → Provider Tab 显示 error banner 而非空列表 / 本机列表
- AC-2: 远端恢复后点重试，无需重启应用即可加载远端 providers

---

## 测试与回归

- **冒烟流（人工）：**
  1. 干净状态进入本地模式 → 创建 1 个分身 + 2 个 session → 关闭应用 → 确认 `localStorage` 中相关 key 带 `::local` 后缀
  2. 切到远程后端 A → 选「立即重启」→ 确认顶栏 chip 显示远程 host、窗格干净（不带本地旧 sessionId）
  3. 在远程 A 创建 1 个分身 + 1 个 session → 关闭应用
  4. 切换到远程后端 B（host 不同）→ 确认窗格干净、不带远程 A 的 sessionId
  5. 切回本地模式 → 确认第 1 步的本地分身 / session 完整恢复
  6. 切回远程 A → 确认第 3 步的状态完整恢复

- **不应回归：**
  - 主题、面板宽度等 UI 偏好在切换 backend 时不变
  - 老用户旧 `agx-workspace-state-v1` 在 `local` scope 下能被一次性迁移
  - 仅修改 provider / gateway / feishu 等不应触发重启弹窗

---

## 风险与回滚

- **风险 1**：localStorage 迁移逻辑写错导致老用户窗格丢失
  - 缓解：旧 key 在迁移成功后再删除；首次迁移失败时保留旧 key 作为兜底
- **风险 2**：`app.relaunch()` 在 macOS 下偶发拉起失败
  - 缓解：fallback 显示一个「请手动重启 Near」的弹窗
- **回滚**：本 plan 所有改动集中在 4 个 storage key + 1 个 IPC + 1 个 Topbar chip，回滚仅需 revert 对应 commit；P2 未落地不影响主线

---

## 与现有代码的非破坏性约束

- 不改动现有非 sessionId 锚定的 UI 偏好 key
- 不改动后端 `agx serve` API 行为（P1 之前不涉及）
- 不修改 `~/.agenticx/config.yaml` 现有字段语义
- 不破坏 `feishu_binding.json` 等独立绑定文件的读写
- 严格遵守 `.cursor/rules/no-scope-creep.mdc`：每个改动必须能追溯到 FR/AC

---

## 提交边界建议

按以下 4 段独立 commit，每段可单独 typecheck + build 绿：

1. `feat(desktop): scope sessionId-anchored localStorage by backend endpoint`（Phase 1）
2. `feat(desktop): auto-relaunch on connection mode switch`（Phase 2）
3. `feat(desktop): topbar backend chip + remote-mode hints in settings`（Phase 3）
4. `feat(studio,desktop): route provider config to remote backend in remote mode`（Phase 4 / Task 4.1）

每个 commit 末尾按 `plan-management.mdc` 注入：

```
Plan-Id: 2026-05-25-backend-isolated-storage
Plan-File: .cursor/plans/2026-05-25-backend-isolated-storage.plan.md
Made-with: Damon Li
```

Task 4.2（Skills / MCP 走 API）与 Task 4.3（离线降级 UI）暂未落地，留作后续 PR。
