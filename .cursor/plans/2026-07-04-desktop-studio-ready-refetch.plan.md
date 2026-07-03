# Desktop 冷启动数据空窗彻底修复：studio-ready 事件驱动补取

Plan-Id: 2026-07-04-desktop-studio-ready-refetch
Plan-File: .cursor/plans/2026-07-04-desktop-studio-ready-refetch.plan.md
Planned-with: Claude Opus 4.8 (Cursor)

## 背景 / 现象（用户报告，已复现证据）

大数据量本机（`~/.agenticx` 下 469 个历史会话、1095 个 taskspace 目录）重启 Near 后：
1. 分身列表「分身 (0)」、群聊「群聊 (0)」同时为空；
2. 工作区面板长时间不出内容；
3. 定时任务窗格停在「正在初始化会话…」，需点「重试」。

排查证据（绕过 UI 直接打后端）：
- `curl /api/avatars` → 0.15s 返回 11 个分身，数据完整；
- `curl /api/groups` → 立即返回 2 个群聊，数据完整；
- 磁盘 `~/.agenticx/avatars/`（11 个）、`~/.agenticx/groups/`（2 个 `group.yaml`）齐全。
→ 后端与磁盘数据均健康，问题 100% 在 **Desktop 渲染层的启动期数据加载与恢复机制**。

## 根因（已查证，含对上一轮判断的修正）

### 表层（上一轮 sonnet5 已修，正确但不完整）
`App.tsx` 启动兜底只对 **分身**（`fetchAvatarsWithStartupRetry`）与 **会话**（`fetchSessionsWithStartupRetry`）做了有界重试，**群聊完全没有兜底**。上一轮已新增 `fetchGroupsWithStartupRetry` 并接入 `App.tsx`（见「已完成部分」），此项保留。

### 病根（本 plan 要解决的核心）
1. **后端 ready 无事件通知渲染层**：`desktop/electron/main.ts:1932 markStudioReady()` 仅遍历 `studioReadyWaiters` 内部回调，**从不 `mainWindow.webContents.send(...)`**。渲染层拿不到「后端已就绪」信号。
2. **渲染层只有一次性有界重试**：`App.tsx` 初始化里，`runSplashCorePreload()`（整体 race `SPLASH_PRELOAD_OVERALL_MS = 50s`）失败后，跑一遍有界重试（分身 5 次退避、会话 4 次）。这些重试跑完就结束，**没有"后端稍后才 ready → 再补取"的恢复路径**。
3. **大数据量放大**：后端冷启动在该数据量下常 > 40s（`PRELOAD_READY_BUDGET_MS`）/50s，有界重试可能在后端 ready **之前**耗尽 → 面板永久空白，直到用户手动刷新/重启。
4. **各面板加载路径割裂**：分身/群聊/会话在 `App.tsx`；工作区在 `WorkspacePanel.tsx`（`desktopApiFetch` 内部 `await waitForStudio(60s)`）；定时任务窗格 `ensureAutomationPane` 又是另一条。恢复行为不一致 → 现象杂乱。

`fetchListAvatarsCore`/`list-groups` 等 IPC 内部虽有 `await waitForStudio()`，但只覆盖"单次调用等待"，不覆盖"调用早已返回空、之后才 ready"的场景。

## 目标

用**单一、事件驱动**的机制彻底解决冷启动空窗：后端 ready 时由主进程**主动广播**给渲染层，渲染层据此**补取仍为空的核心数据**（分身/群聊/会话），替代"靠有界重试猜时机"。保留已加的有界重试作为双保险。

## 范围（严格限定，遵守 no-scope-creep）

**改**：
- `desktop/electron/main.ts`：`markStudioReady()` 增加一次向渲染层的 `webContents.send("agx-studio-ready")` 广播（镜像既有 `notifyRendererConnectionModeChanged`）。
- `desktop/electron/preload.ts`：暴露 `onStudioReady(cb)` 订阅（镜像既有 `onConnectionModeChanged`）。
- `desktop/src/global.d.ts`：补 `onStudioReady` 类型声明。
- `desktop/src/App.tsx`：注册一次 `onStudioReady` 监听，触发时对 **仍为空** 的分身/群聊/会话做补取；组件卸载时反注册。

**不改**（明确排除，避免越界）：
- 后端 `agx serve` 启动流程、`SessionManager`、FTS、时间戳逻辑。
- 冷启动为何慢（大数据量 O(n) 扫描的后端性能优化）——列为「后续独立 track」，本 plan 不做。
- 工作区面板 / 定时任务窗格的内部加载重构——本 plan 仅让它们**可选地**复用同一 ready 事件做一次轻量刷新（见 FR-4，最小改动；若实现风险大可延后，不阻塞 FR-1~FR-3）。
- 远程模式（remote_server）链路：`markStudioReady` 在远程 ping 成功后也会调用，广播天然覆盖，无需额外改。

## 已完成部分（上一轮，纳入本 plan 追溯，勿重复实现）

- `desktop/src/utils/splash-preload-core.ts`：新增 `fetchGroupsWithStartupRetry()`（5 次退避重试，逻辑对齐 `fetchAvatarsWithStartupRetry`）。
- `desktop/src/App.tsx`：启动兜底后，若 `groups.length === 0` 调用上述函数并 `setGroups`；import 已补 `fetchGroupsWithStartupRetry`。
- 校验：`tsc --noEmit` 改动前后错误数一致（146，均为既有历史类型问题），无新增；无 lint 报错。

## 需求

### FR-1 主进程广播 studio-ready
`markStudioReady()` 在置 `studioReady = true` 且 resolve 内部 waiters 后，向渲染层发送一次事件：
```ts
mainWindow?.webContents.send("agx-studio-ready");
```
- 复用现成的 `mainWindow` 引用与 `notifyRendererConnectionModeChanged` 相同的判空写法。
- 幂等保护已由 `markStudioReady` 头部 `if (studioReady) return;` 提供——不会重复广播。
- 远程模式路径（`main.ts` 约 7500 行 `if (remoteConfig && connected) markStudioReady();`）自动复用，无需单独加。

### FR-2 preload 暴露订阅接口
在 `preload.ts` 的 `agenticxDesktop` 对象中新增（镜像 `onConnectionModeChanged`，约 preload.ts:74）：
```ts
onStudioReady: (callback: () => void): (() => void) => {
  const handler = () => callback();
  ipcRenderer.on("agx-studio-ready", handler);
  return () => ipcRenderer.removeListener("agx-studio-ready", handler);
},
```
并在 `desktop/src/global.d.ts` 的 `agenticxDesktop` 接口补：
```ts
onStudioReady: (callback: () => void) => () => void;
```

### FR-3 渲染层 ready 驱动补取（核心）
在 `App.tsx` 初始化 effect 中（`onConnectionModeChanged` 附近，保持同一注册/清理风格）注册监听：
- 收到 `agx-studio-ready` 时，**分别判断并只补取仍为空的部分**：
  - `avatars.length === 0` → `fetchAvatarsWithStartupRetry(listAvatars)` → 非空则 `setAvatars`；
  - `groups.length === 0` → `fetchGroupsWithStartupRetry(listGroups)` → 非空则 `setGroups`；
  - 活跃 pane 对应的会话列表为空 → 复用现有会话拉取路径补取（不新增拉取函数，调用现成 `fetchSessionsWithStartupRetry` + 现有写回逻辑）。
- **幂等 / 防抖**：用 `useRef` 记录"是否已因 ready 补取过"，避免重复；补取前再判空，已有数据则跳过（不覆盖用户已加载状态）。
- effect 返回清理函数中调用 `onStudioReady` 返回的反注册函数。
- **不得**在收到事件时无条件重置或清空 store（避免污染已渲染数据）。

### FR-4（可选，最小改动，可延后）工作区/定时任务复用 ready 事件
- 工作区面板与定时任务窗格已各自 `await waitForStudio()`，后端 ready 后**下次打开/交互即可恢复**。
- 若要进一步减少"打开着却空着"的观感：这两处**已挂载且当前为空**的实例，可订阅同一 `onStudioReady` 做一次轻量刷新（工作区 → `refreshListAndActiveTaskspace`；定时任务 → 触发其现有初始化重试）。
- 风险评估：涉及组件生命周期与现有加载态耦合，若实现不确定则**本轮跳过**，不阻塞 FR-1~FR-3 合入。

## 验收标准

- AC-1：模拟慢冷启动（可临时在 `waitServeReady()` 后、`markStudioReady()` 前 `await sleep(60_000)`，或大数据量实测），主窗露出时即使分身/群聊短暂为空，**后端 ready 后无需任何手动操作，分身与群聊在数秒内自动补齐**。
- AC-2：后端正常（秒开）时，行为与现状一致，不产生重复拉取（`onStudioReady` 补取因 store 非空而全部跳过）；控制台无重复 `setAvatars/setGroups` 噪音。
- AC-3：`agx-studio-ready` 事件仅广播一次（`markStudioReady` 幂等）；渲染层监听在组件卸载时正确反注册，无泄漏 warning。
- AC-4：远程模式连接成功后同样触发补取（复用 `markStudioReady`）。
- AC-5：`cd desktop && npx tsc --noEmit -p tsconfig.json` 与 `-p electron/tsconfig.json` 的错误数**不高于改动前基线**（当前渲染基线 146、electron 基线 0）；无新增 lint。
- AC-6：改 `main.ts`/`preload.ts` 后**完全退出 `npm run dev` 重启**（主进程不热重载）验证，仅刷新渲染进程不算通过。

## 实施步骤（给实施者的精确指引）

1. `main.ts:1932 markStudioReady()`：在 `scheduleSplashForceShowFallback(...)` 之前或之后追加 `mainWindow?.webContents.send("agx-studio-ready");`（判空写法对齐 `notifyRendererConnectionModeChanged` at ~1823）。
2. `preload.ts` ~74（`onConnectionModeChanged` 之后）：新增 `onStudioReady`，`on` + 返回 `removeListener` 反注册闭包。
3. `global.d.ts`：`agenticxDesktop` 接口补 `onStudioReady: (callback: () => void) => () => void;`（放在 `onConnectionModeChanged` 声明附近）。
4. `App.tsx`：
   - 复用现有 import（`fetchAvatarsWithStartupRetry`/`fetchGroupsWithStartupRetry`/`fetchSessionsWithStartupRetry` 均已在同文件用到）。
   - 在合适的初始化 effect 内 `const off = window.agenticxDesktop.onStudioReady(async () => { ...仅补空... });`，cleanup 调 `off()`。
   - 用 `useRef<boolean>` 防重复补取；每次补取前 `useAppStore.getState()` 再判空。
5. （可选）FR-4：评估后决定是否本轮做；不做则在 PR 描述注明延后。
6. 验证：跑 AC-5 两个 typecheck；按 AC-6 重启 dev；按 AC-1 注入延迟模拟慢启动，确认自动补齐。

## 提交约定

- 一个 commit（或按 FR 分组），trailer 顺序：`Plan-Id` → `Plan-File` → `Plan-Model` → `Impl-Model` → `Made-with: Damon Li`。
- `Plan-Model` / `Impl-Model` 由用户提供，未提供须询问，禁止编造。
- 只 `git add` 本任务直接改动文件：`desktop/electron/main.ts`、`desktop/electron/preload.ts`、`desktop/src/global.d.ts`、`desktop/src/App.tsx`、`desktop/src/utils/splash-preload-core.ts`（含上一轮群聊兜底）、本 plan 文件。不夹带无关改动。

## 备注

- 冷启动本身慢（大数据量下后端 `agx serve` 就绪耗时）是**放大器**，本 plan 让 UI 在 ready 后可靠自愈，但不缩短后端就绪时间。若需从根上加速冷启动（如会话/taskspace 目录扫描的懒加载或索引化），另开 plan 评估，勿并入本轮。
