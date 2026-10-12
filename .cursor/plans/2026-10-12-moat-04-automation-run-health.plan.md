# Moat-04 · 定时任务健康度：连续失败自动暂停与「已中断」

Planned-with: claude-opus-5.5
Suggested-Impl-Model: grok-4.7
Plan-Id: 2026-10-12-moat-04-automation-run-health
Plan-File: `.cursor/plans/2026-10-12-moat-04-automation-run-health.plan.md`
Parent-Plan: `2026-10-12-governed-longrun-moat-master`

> **For implementer:** 独立 worktree，分支 `feat/moat-04-automation-health`。不要 commit。改了 `desktop/electron/main.ts` 后必须完全退出并重启 `npm run dev`（主进程不热重载）。

## 1. 要解决的问题

定时任务现在只记 `lastRunStatus: "success" | "error"` 和 `lastRunError`，写在三个地方：

- Electron 定时触发：`desktop/electron/main.ts` 约 :1360-1392（`AutomationScheduler.executeTask` 内 `found.lastRunStatus = ...`，含 try / catch 两段）。
- Electron 手动「立即运行」：约 :11180-11190（`run-automation-task-now` handler 内 `task.lastRunStatus = ...`），以及其后的 catch 段（约 :11205-11212）。
- 服务端 HA 调度器：`agenticx/studio/automation_scheduler.py::_record_run_result`（:336-351）。

缺三件事：

1. **连续失败不停。** 登录过期、API key 失效、02 之前的「无人值守不批准受保护操作」，每天都会失败一遍，没有人知道。
2. **进程中断无记录。** 触发时只写 `lastRunAt`（Electron :1304；Python :187）。如果执行中应用被退出或进程崩溃，这次既不是成功也不是失败，界面看起来像没出过事；里面可能已做了一半外部操作。
3. **用户没有明确的下一步。** 应该提示「先去看那次会话，再决定要不要重跑」，而不是静默重试。

## 2. 行为规格

任务 JSON 新增可选字段（读方必须容忍缺失，旧任务不迁移）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `runningSince` | ISO 字符串 | 定时触发开始执行时写入，记录结果时删除 |
| `consecutiveFailures` | number | 定时触发连续失败次数 |
| `autoPausedReason` | string | 自动暂停原因（展示给用户） |
| `autoPausedAt` | ISO 字符串 | 自动暂停时间 |

`lastRunStatus` 取值扩展为 `"success" | "error" | "interrupted"`。

规则（TS 与 Python 两份实现必须逐条一致，用同一张表驱动测试）：

| # | 事件 | 处理 |
|---|---|---|
| R1 | 定时触发开始执行 | `runningSince = now` |
| R2 | 定时触发成功 | 删除 `runningSince`；`consecutiveFailures = 0`；`lastRunStatus = "success"`；删除 `lastRunError` |
| R3 | 定时触发失败 | 删除 `runningSince`；`consecutiveFailures += 1`；`lastRunStatus = "error"`；`lastRunError` = 截断后的错误 |
| R4 | R3 之后错误命中「需要人工处理」 | 立即 `enabled = false`；`autoPausedReason = "需要你处理：" + 命中项的中文说明`；`autoPausedAt = now` |
| R5 | R3 之后 `consecutiveFailures >= 3` 且未命中 R4 | `enabled = false`；`autoPausedReason = "连续失败 {n} 次，已自动暂停"` |
| R6 | 调度器启动时（Electron `AutomationScheduler.start()`；Python 首次以 leader 身份 tick 时）发现某任务有 `runningSince`，且该任务当前不在执行集合中 | `lastRunStatus = "interrupted"`；`lastRunError = INTERRUPTED_TEXT`；删除 `runningSince`；**不**计入失败；**不**自动重跑；`enabled` 不变 |
| R7 | 手动「立即运行」成功 | 同 R2（清零失败计数），但**不**写 / 不依赖 `runningSince` |
| R8 | 手动「立即运行」失败 | 只写 `lastRunStatus = "error"` 和 `lastRunError`；**不**增加 `consecutiveFailures`，**不**自动暂停（用户在场） |
| R9 | 用户在界面把任务从关闭改为开启（`save-automation-task` 收到 `enabled: true`，而磁盘上旧值为 `false`） | 删除 `autoPausedReason`、`autoPausedAt`；`consecutiveFailures = 0` |

「需要人工处理」匹配表（对 `lastRunError` 做不区分大小写的子串匹配，按顺序取第一个命中）：

| 子串 | 中文说明 |
|---|---|
| `无人值守运行不批准受保护操作` | 任务里有需要批准的操作 |
| `企业登录已失效` | 企业账号登录已失效 |
| `invalid_api_key` | 模型 API Key 无效 |
| `incorrect api key` | 模型 API Key 无效 |
| `http 401` | 鉴权失败 |
| `http 403` | 没有权限 |

「无人值守等待审批超时」（02 的超时文案）刻意**不**在表内：用户某天没看到审批属于正常情况，交给 R5 的连续 3 次规则处理，避免一次错过就把每日任务关掉。

`INTERRUPTED_TEXT = "上次运行在完成前中断（应用退出或进程崩溃），其中的外部操作可能已部分执行。请先查看那次会话，再决定是否重跑。"`

## 3. In scope / Out of scope

**In scope**

1. 新建 `desktop/electron/automation-run-health.ts`（纯函数，无 I/O）。
2. `desktop/electron/main.ts`：`AutomationTaskData` 类型（约 :799-816）、`AutomationScheduler.start()` / `tick()` / `executeTask` 的结果记录段、`run-automation-task-now` 的结果记录段、`save-automation-task` handler。
3. 新建 `agenticx/runtime/automation_run_health.py`（纯函数，与 TS 同语义）。
4. `agenticx/studio/automation_scheduler.py`：`tick`（触发处写 `runningSince`）、`_execute_task` / `_record_run_result`、首次 leader tick 的中断扫描。
5. `desktop/src/components/automation/types.ts`、`desktop/src/components/automation/TaskList.tsx`：展示中断态、自动暂停原因、「查看那次会话」按钮。
6. `desktop/src/global.d.ts`：若其中声明了 automation 任务类型（`rg -n "lastRunStatus" desktop/src/global.d.ts`），同步扩展。
7. `desktop/locales/{zh,en}/workspace.json` 的 `automation.*` 新键。
8. 测试：`desktop/tests/automation-run-health.test.ts`、`tests/test_automation_run_health.py`。

**Out of scope**

- 不做错过触发的补跑（错过就是错过，与现状一致）。
- 不改任务的执行方式、会话隔离或提示词。
- 不改 `_automation_tasks_io.py` 的存储格式（字段是 JSON 可选键，存储层透明）。
- 不做通知推送。

## 4. 具体改动

### 4.1 `desktop/electron/automation-run-health.ts`（新建）

```ts
export const INTERRUPTED_TEXT = "上次运行在完成前中断（应用退出或进程崩溃），其中的外部操作可能已部分执行。请先查看那次会话，再决定是否重跑。";
export const AUTO_PAUSE_FAILURE_THRESHOLD = 3;
export const NEEDS_USER_ACTION_MARKERS: ReadonlyArray<{ needle: string; label: string }> = [ /* §2 表格，顺序一致 */ ];

export type RunHealthFields = {
  enabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error" | "interrupted";
  lastRunError?: string;
  runningSince?: string;
  consecutiveFailures?: number;
  autoPausedReason?: string;
  autoPausedAt?: string;
};

export function markRunStarted<T extends RunHealthFields>(task: T, nowIso: string): T;
export function applyRunOutcome<T extends RunHealthFields>(
  task: T,
  outcome: { ok: boolean; error?: string },
  opts: { trigger: "schedule" | "manual"; nowIso: string },
): T;
export function markInterruptedOnStartup<T extends RunHealthFields>(task: T, runningIds: ReadonlySet<string>, id: string): T;
export function applyUserEnableToggle<T extends RunHealthFields>(prev: T | undefined, next: T): T;
export function matchNeedsUserAction(error: string | undefined): string | null;
```

全部返回**新对象**（浅拷贝后修改），不改入参，便于测试。`applyRunOutcome` 不负责截断错误，调用方先用现有 `sanitizeAutomationRunError`（main.ts :818）截断后再传入。

### 4.2 `desktop/electron/main.ts`

- 顶部 import 区：在既有 `./desktop-notify` import 附近新增一行 `import { applyRunOutcome, applyUserEnableToggle, markInterruptedOnStartup, markRunStarted } from "./automation-run-health";`。只加这一行，不动其他 import。
- `AutomationTaskData`（约 :812-814）：`lastRunStatus?: "success" | "error" | "interrupted";`，并新增四个可选字段。
- `AutomationScheduler`：新增私有字段 `private running = new Set<string>();`。`executeTask` 开头 `this.running.add(task.id)`，`finally` 里 `delete`。若现有 `executeTask` 没有 `finally`，用 `try { 原逻辑 } finally { this.running.delete(task.id) }` 包住原函数体，**不改原逻辑**。
- `start()`：`if (this.timer) return;` 之后、`setInterval` 之前，加一次中断扫描：`loadAutomationTasks()` → 对每个任务 `markInterruptedOnStartup(task, this.running, task.id)` → 有变化就 `saveAutomationTasks`。
- `tick()` 约 :1304：`task.lastRunAt = now.toISOString();` 之后，用 `Object.assign(task, markRunStarted(task, now.toISOString()))` 写入 `runningSince`（同一次 `saveAutomationTasks(tasks)` 落盘）。
- `executeTask` 结果段（约 :1363-1371 成功 / 失败分支，与 :1385-1391 catch 分支）：把直接赋值 `lastRunStatus` / `lastRunAt` / `lastRunError` 的几行替换为
  `Object.assign(found, applyRunOutcome(found, { ok, error: sanitizeAutomationRunError(...) }, { trigger: "schedule", nowIso: new Date().toISOString() }))`。
  `applyRunOutcome` 内部同时写 `lastRunAt`。`emitAutomationTaskProgress(...)` 调用保持原样。
- `run-automation-task-now`（约 :11180-11187 与其 catch 段）：同样替换为 `applyRunOutcome(..., { trigger: "manual", ... })`。
- `save-automation-task`（约 :11044-11050，`tasks[idx] = task` 处）：改为 `tasks[idx] = applyUserEnableToggle(tasks[idx], task)`；新建任务（`unshift` 分支）不变。

### 4.3 `agenticx/runtime/automation_run_health.py`（新建）

与 TS 完全同名同语义的 snake_case 函数：`mark_run_started(task, now_iso)`、`apply_run_outcome(task, *, ok, error, trigger, now_iso)`、`mark_interrupted_on_startup(task, running_ids)`、`match_needs_user_action(error)`，以及常量 `INTERRUPTED_TEXT`、`AUTO_PAUSE_FAILURE_THRESHOLD`、`NEEDS_USER_ACTION_MARKERS`。入参是 `dict`，返回新 `dict`。文件头按仓库规范写 `Author: Damon Li`，注释用英文。

### 4.4 `agenticx/studio/automation_scheduler.py`

- `__init__`：新增 `self._interrupted_checked = False`。
- `tick`（:159 起）：在 `if not await self._leader_gate.am_i_leader(): return []` 之后加：

```python
        if not self._interrupted_checked:
            self._interrupted_checked = True
            await asyncio.to_thread(self._mark_interrupted_tasks)
```

  新增同步方法 `_mark_interrupted_tasks`：读任务，逐个 `mark_interrupted_on_startup(task, self._running)`，有变化则 `save_automation_tasks`。
- `tick` 触发处（:187 `task["lastRunAt"] = _utc_iso_now()` 之后）：`task.update(mark_run_started(task, task["lastRunAt"]))`。
- `_record_run_result`（:336-351）：把对 `lastRunStatus` / `lastRunAt` / `lastRunError` 的赋值替换为 `task.update(apply_run_outcome(task, ok=ok, error=(error or "执行失败")[:500] if not ok else "", trigger="schedule", now_iso=_utc_iso_now()))`。服务端调度器只有定时触发，`trigger` 固定为 `"schedule"`。

### 4.5 UI：`desktop/src/components/automation/TaskList.tsx`

在现有「上次运行」块（约 :199-216）内：

- 状态文字：`interrupted` 显示 `t("automation.interrupted")`，颜色用琥珀色系主题 token（仓库若无琥珀 token，用 `text-amber-400`，与同块现有 `text-emerald-400` / `text-rose-400` 写法一致）。
- `interrupted` 时在错误文案位置显示 `lastRunError`（即 `INTERRUPTED_TEXT`），并加一个小按钮「查看那次会话」：`task.sessionId` 存在时才渲染，点击打开该任务的 automation 窗格（复用现有打开 automation 窗格的回调；实施前 `rg -n "ensureAutomationPane|openAutomationPane" desktop/src` 找到入口，通过 props 传入，不在 TaskList 内直接操作 store 以外的全局对象）。
- 若 `autoPausedReason` 存在：在任务卡顶部开关旁显示一行 `autoPausedReason`（rose 色），开关仍可直接重新打开（重新打开即触发 R9）。
- 不新增「重跑」按钮：现有「立即运行」（`onRunNow`，:113 / :151）就是「复查后再跑」的入口，只把它的 `title` 在 `interrupted` 状态下换成 `t("automation.rerunAfterReview")`。

`desktop/src/components/automation/types.ts`：`lastRunStatus?: "success" | "error" | "interrupted"`，并加四个可选字段。

locale（`desktop/locales/zh/workspace.json` 与 `en/workspace.json` 的 `automation` 对象内新增，键集合一致）：

| 键 | zh | en |
|---|---|---|
| `interrupted` | 已中断 | Interrupted |
| `openRunSession` | 查看那次会话 | Open that run |
| `rerunAfterReview` | 复查后再跑 | Rerun after review |

## 5. 验收标准（AC）与测试

两份测试用**同一张用例表**（把表写成 JSON fixture `tests/fixtures/automation_run_health_cases.json`，TS 与 Python 都读它，保证语义一致）。每条用例：`{ name, before, action, args, expect }`，`action ∈ {start, outcome, startup, toggle}`。

必须覆盖：

| AC | 用例 |
|---|---|
| AC-1 | R1：start 后有 `runningSince` |
| AC-2 | R2：失败 2 次后成功 → `consecutiveFailures == 0`、无 `lastRunError` |
| AC-3 | R5：定时失败 3 次（普通错误）→ 第 3 次后 `enabled == false`、`autoPausedReason == "连续失败 3 次，已自动暂停"` |
| AC-4 | R4：首次失败错误为 `"... HTTP 401 ..."` → 立即暂停，原因 `"需要你处理：鉴权失败"` |
| AC-5 | R4：错误含 `无人值守运行不批准受保护操作` → 原因 `"需要你处理：任务里有需要批准的操作"` |
| AC-6 | R8：手动失败 5 次 → `enabled` 仍为 true，`consecutiveFailures` 不变 |
| AC-7 | R6：有 `runningSince` 且不在 running 集合 → `interrupted`、文案为 `INTERRUPTED_TEXT`、失败计数不变、`enabled` 不变 |
| AC-8 | R6：有 `runningSince` 但 id 在 running 集合 → 不改 |
| AC-9 | R9：`enabled` false→true → 清空暂停字段、计数归零；true→true 不清 |
| AC-10 | 旧任务（无任何新字段）走 outcome 成功 → 不抛错、字段正确 |

运行：

```bash
cd desktop && npx vitest run tests/automation-run-health.test.ts
pytest tests/test_automation_run_health.py -q
pytest tests -q -k "automation"
```

手工：建一个每分钟触发的任务，模型配成错误的 API Key → 3 分钟后任务自动关闭，卡片显示原因；重新打开开关原因消失。另建一个会跑 2 分钟的任务，触发后 30 秒内完全退出 Near（⌘Q）再打开 → 卡片显示「已中断」与说明，「查看那次会话」能打开那次会话。
