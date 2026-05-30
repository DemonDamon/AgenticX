# Desktop 冷启动数据空窗 & splash 预加载竞态修复

Plan-Id: 2026-05-30-desktop-coldstart-empty-data-splash
Plan-File: .cursor/plans/2026-05-30-desktop-coldstart-empty-data-splash.plan.md

## 背景 / 现象（用户报告）

启动 Near 后：
1. 启动整体等待很久；
2. 进入主界面时「分身 (0)」「历史对话：暂无会话」，等很久才刷出 11 个分身与历史；
3. 切换历史会话，长时间不加载；
4. 用户怀疑与「电脑快没电（电量 2%）」有关。

## 根因（已查证，含对先前判断的修正）

时序链路：

- Electron 先弹 splash，再 spawn 内嵌 PyInstaller 后端 `agx serve`，`waitServeReady` 最多等 45s（重依赖导入冷启动）。
  - `desktop/electron/main.ts` 2063-2066、`waitServeReady` 2073。
- 渲染端 `App` 初始化跑 `runSplashCorePreload()`，经 IPC `preload-core-data` 并行拉 avatars/sessions/taskspaces/messages：
  - 每项 `withPreloadItemTimeout` = **6s**（`main.ts` 1576）；
  - 渲染端整体 race = **12s**（`splash-preload-core.ts` 79 `SPLASH_PRELOAD_OVERALL_MS`）；
  - 每个 `fetchListAvatarsCore` 内部先 `await waitForStudio()` 再 fetch（`main.ts` 1587-1596）——**这 6s 同时覆盖了「等后端 ready」+「真正 fetch」**。
- splash 强制关闭兜底 = **15s**（`splash.ts` 18 `SPLASH_FORCE_SHOW_MS`）。

**真正的 bug**：当后端冷启动 > 6s（低电量降频时极常见），preload 各项的 `waitForStudio()` 仍 pending，6s 超时先触发 → 返回 `{ ok:false, avatars:[] }`。`applySplashPreloadToStore` 因 `result.avatars.ok === false` **跳过 `setAvatars`**（`splash-preload-core.ts` 150-152），分身列表保持空。随后：
- 渲染整体 12s race / splash 15s 强制关闭，使主窗口带着空数据露出；
- 仅靠 `App.tsx` 571 行兜底 `listAvatars()`（`await waitForStudio(30s)` 后再拉）把 11 个分身补回来 → 这就是「等很久才刷出来」。

**修正先前判断**：`SessionManager._schedule_fts_backfill`（`session_manager.py` 150）在 `loop.is_running()` 为真时才调度，而 `create_studio_app()`（含 `SessionManager()`）在 `uvicorn.run()` **之前**同步执行（`cli/main.py` 595→605），此时无运行中的事件循环，故 **FTS 全量回填在生产 serve 路径并未在启动期触发**，不是本现象主因。

**切换历史慢**：`/api/session/messages` 走磁盘读 + 必要时会话恢复，低电量 IO/CPU 降频下变慢，且切换期间缺乏明确加载态。

**低电量定位**：macOS Low Power Mode 对 CPU 降频、限制磁盘吞吐，把「冷启动耗时」放大到频繁超过 6s/12s/15s 窗口，是**放大器而非根因**。

## 范围（严格限定，避免越界）

仅改 Desktop 启动期数据加载竞态与 splash 呈现，对应上面 1-4 现象：
- `desktop/electron/main.ts`（preload IPC 时序、超时常量）
- `desktop/src/utils/splash-preload-core.ts`（整体超时、空数据兜底语义）
- `desktop/src/App.tsx`（兜底重试）
- `desktop/electron/splash.ts` / `splash.html`（强制关闭时长、预热文案）
- 切历史加载态（`ChatPane`/会话切换处，最小改动）

**不改**：后端 `agx serve` 启动流程、`SessionManager`、FTS/时间戳逻辑、远程模式逻辑。

## 需求

### FR-1 预加载先等后端 ready，再计 fetch 超时
`preload-core-data` IPC 处理器先 `await waitForStudio(readyBudgetMs)` 一次，ready 后再并行执行 4 个 fetch（各自 per-item 超时仅覆盖真正请求，不再被冷启动等待吃掉）。`readyBudget` 与后端 `waitServeReady`(45s) 量级对齐（建议 30-40s）。

### FR-2 超时常量对齐冷启动
- 渲染端 `SPLASH_PRELOAD_OVERALL_MS` 调整为 `readyBudget + fetchBudget`，不再 12s 截断把 ready 等待砍掉。
- splash 强制关闭 `SPLASH_FORCE_SHOW_MS` 不得早于后端 ready；改为「后端 ready 后才允许强制关闭」或显著调大（与 readyBudget 对齐），避免空窗口露出。

### FR-3 空数据不污染、兜底带退避重试
- `applySplashPreloadToStore`：preload 返回 `ok:false`（超时）时保持现有「不覆盖」语义即可，但需保证后续兜底能补齐。
- `App.tsx` 兜底：将单次 `listAvatars()` 改为**有界退避重试**（如最多 N 次、间隔递增），直到拿到非空分身或达上限；会话列表同理。

### FR-4 splash 预热文案
新增/复用 splash 阶段，在后端未 ready 时显示「正在唤醒本地引擎…」类文案（而非长时间停在「正在加载界面…」），让长等待可被理解。

### FR-5 切换历史加载态
切换历史会话且消息未命中缓存时，对话区显示加载骨架/指示，消息 fetch 超时足够；避免「点了像没反应」。最小改动，不重构消息加载链路。

## 验收标准

- AC-1：冷启动（含模拟低电量/慢盘，如人为延迟后端 ready 到 ~10-20s）下，主窗口露出时分身与历史**已就位**，不再出现先「(0)/暂无会话」再补齐。
- AC-2：preload 各项超时不再被「等后端 ready」消耗；日志中不再出现 `splash core preload overall timeout` 误报（后端正常时）。
- AC-3：后端确实异常/超长时，splash 给出预热文案并最终安全降级进入主窗（不卡死），兜底重试最终补齐数据。
- AC-4：切换历史会话有明确加载态，命中缓存即时显示，未命中时显示骨架直至加载完成。
- AC-5：`npm run build` / typecheck 通过；改 `main.ts`/`splash.ts` 后需完全重启 `npm run dev` 验证（主进程不热重载）。

## 实施步骤

1. `main.ts`：`preload-core-data` 先 `await waitForStudio(readyBudget)`，再 `Promise.all` 四个 fetch（per-item 超时保留但语义变为纯请求超时）；抽出常量 `PRELOAD_READY_BUDGET_MS`、`PRELOAD_FETCH_TIMEOUT_MS`。
2. `splash-preload-core.ts`：`SPLASH_PRELOAD_OVERALL_MS` 改为 `readyBudget + fetchBudget`；空兜底分支注释更新。
3. `splash.ts`：`SPLASH_FORCE_SHOW_MS` 改为依赖 studioReady 或调大；必要时由 `main.ts` 在 `markStudioReady` 后再启动强制关闭计时。
4. `splash.html` / `splash.ts` stage 文案：增加「唤醒本地引擎」预热态。
5. `App.tsx`：兜底 `listAvatars()`/会话列表改有界退避重试。
6. 切历史加载态：定位会话切换处补加载骨架与超时。
7. 验证：模拟慢启动（可临时在后端 ready 前插入延迟或低电量实测），跑通 AC-1~AC-5。

## 备注

- 低电量是放大器：插电后体验会明显改善，但本修复确保即使冷启动较慢也不再露出空数据。
- 提交遵循 `/commit --spec` 注入 Plan-Id / Plan-File，并含 `Made-with: Damon Li`。
