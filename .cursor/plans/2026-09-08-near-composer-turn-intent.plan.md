# Near 输入区：本轮意图（Plan）

Planned-with: cursor-grok-4.6

Suggested-Impl-Model: Wave 1 用 Composer 2.5；隔离副本另开 plan 再用跨栈档

> **For implementer:** 只按本文件落地。不要做五档互斥「对话模式」菜单。不要改 `agenticx/studio/server.py` 顶部 import 区块（只能在函数体内精确增删目标行）。不要把隔离多路竞赛、Debug 模式、或权限三档重写带进来。不要复活 Lite `ChatView` 的用户消息前缀方案。

**Goal:** Pro 主聊天窗格从输入区 `+` 菜单进入 Mode，用开关打开 **Plan**；打开后输入区出现可悬停关闭的芯片；该轮请求带 `plan_mode`，后端裁掉可变工具并注入系统提示。**不要做 Ask。** Multitask（隔离多路）另开后续 plan，本波不做假开关。

**Architecture:** 权限（`runMode`）、本轮意图（`pane.turnIntent`）、执行位置（本机/远端）是三条正交轴。Wave 1 只接线意图轴。交互对齐输入区 `+` 菜单的二级 Mode 面板，而不是再叠一颗独立模式芯片选择器。

**Tech Stack:** 现有 Desktop React/Zustand、Studio FastAPI/SSE、`PlanModeLayer`、`STUDIO_TOOLS`。无新依赖。

**Status (2026-09-08):** Wave 1（`+` → Mode → Plan + 输入区芯片 + 后端裁工具）已落地。曾误抄参考图里的 Ask，已撤回。`submit_plan` / 线程内 PlanCard / Multitask 隔离多路仍是后续，本波不做。

---

## 0. 为什么这样排

| 判断 | 结论 |
|---|---|
| 主界面没有五档模式 | 对。不要补一个看起来像别的产品的下拉 |
| 旧 `planMode` 是半成品 | 对。全局 flag + 旧 `ChatView` 前缀用户消息；`ChatPane` 原先不读；`PlanModeLayer` 未接入运行时 |
| 隔离多路竞赛价值最高 | 偏了。第一痛点是「这轮先规划 / 只问答，别在我正在用的树上乱跑」 |
| 权限三档 ≈ 只读问答 | 错。`runMode` 只决定工具先问不问，不是只规划 |

**价值排序：**

1. **本轮意图（本波）：** 默认执行 / 先出计划。入口放在已有 `+` 菜单。
2. **可审计划卡（后续）：** `submit_plan` + 线程内确认后再执行。
3. **Multitask / 隔离多路（后续）：** 独立字段 `isolate_run`，禁止复用 `turnIntent`，禁止用 Ask 顶替。

```mermaid
flowchart LR
  A[用户点输入区加号] --> B[Mode 二级菜单]
  B --> C{开关}
  C -->|关| D[默认执行]
  C -->|Plan| E[输入区 Plan 芯片]
  E --> G["POST plan_mode=true"]
  G --> I[只读工具 + 计划提示]
```

---

## 1. 交互规格（本波必须长这样）

对照用户给的四张图：左侧是参考产品的 Mode 子菜单；图 2 是 Near 当前 `+` 菜单（Add file / Skills / Knowledge retrieval / Connectors）；图 3–4 是开 Plan 后输入区出现芯片、悬停出 X 与 tooltip。

### 1.1 三轴，禁止合成一个菜单

| 轴 | 现有控件 | 本波 | 禁止 |
|---|---|---|---|
| 权限 | `RunModePicker`（始终询问 / 按需确认 / 全部允许） | 不动语义、不改文案体系 | 不要改名叫 Agent/Ask |
| 本轮意图 | 无（全局 `store.planMode` 死旗标） | `+` → Mode → Plan 开关 + 输入区芯片 | 不要做成 Agent/Ask/Debug；不要假装已有 Multitask |
| 执行位置 | `RunLocationPicker` 是本机/远端，**不是**副本 | 不改 | 不要把隔离塞进本机/远端菜单 |

### 1.2 `+` 菜单里的 Mode（不要做成旁路芯片选择器）

落点：`desktop/src/components/ChatPane.tsx` 的 `ComposerMoreActionsButton`。

- 在 **Add file 之后、Skills 之前** 插入一行 **Mode**（图标 `Sparkles` + 右箭头）
- 点击 Mode：右侧 portal 二级菜单（id `agx-composer-mode-menu`）
- 一级 `+` 的 click-outside 白名单必须包含该 id，点二级开关时不得关掉一级菜单
- 二级菜单顶部一段说明，随当前意图切换：
  - default：`composer.modeDefaultHint`
  - plan：`composer.modePlanHint`
- 下面只有一条开关：**Plan**（复用 `SettingsSwitch` size=`sm`）
- 关 = 默认执行
- 主文案走当前 locale；产品主语言是英文（`Mode` / `Plan`）
- **禁止**加 Ask。Multitask 未落地前禁止做不可用开关
- 群聊（`avatarId` 以 `group:` 开头）与自动化（`automation:*`）**不渲染** Mode 行

组件：`desktop/src/components/composer/ComposerModeMenu.tsx`。

### 1.3 输入区芯片（开了开关才出现）

组件：`desktop/src/components/composer/TurnIntentChip.tsx`。

- 插在 `+` 与 `RunModePicker` **之间**
- 默认态：剪贴板图标 + 文案 `Plan`
- 悬停：图标换成 **X**，下方 `HoverTip` 显示同一文案（`placement="below"`）
- 点击芯片（含 X）清回 `default`，芯片消失
- 开启时 placeholder 改为 `composer.placeholderPlan`
- **不要**再做输入区上方 banner，**不要** toast / modal
- 快捷键 `Ctrl/Cmd+Shift+P` 只切 **当前 active 非群聊窗格** 的 plan ↔ default；禁止再写全局 `store.planMode`

### 1.4 范围限制

- 只接 Pro `ChatPane`。不要把旧 `ChatView` 前缀用户消息方案复活为其通路
- 群聊 / 自动化 / 灵巧模式：本波不接
- 本波 **不做** 线程内 PlanCard、`submit_plan`、`execute_plan_id`

---

## 2. In scope / Out of scope

### In scope（本波）

- 窗格级 `pane.turnIntent: "default" | "plan"`
- `+` 菜单 Mode 子菜单 + 输入区 Plan 芯片
- `POST /api/chat` 增加 `plan_mode`
- 计划/问答轮：只保留只读工具；可变工具从 tool list 拿掉，`dispatch_tool_async` 再拦一层
- 系统提示注入 `build_turn_intent_block`
- 单测与 `server.py` 冷启动冒烟
- i18n：`desktop/locales/en/chat.json` 与 `zh/chat.json`

### Out of scope（禁止顺手做）

- 五档对话模式菜单、Debug、Multitask、隔离副本、git worktree
- `submit_plan` / PlanCard / `execute_plan_id`（后续波次）
- 改 `RunMode` 词表或安全中心三档语义
- 改 `RunLocationPicker`
- 复活或重构 Lite `ChatView` 计划前缀
- 接入 `agenticx/core/plan_notebook.py` / `plan_storage.py`
- 改 `server.py` 顶部 import；改 `enterprise/`
- 步骤拖拽编辑、计划版本树、自动判断「这句该不该进计划」

### 后续契约（只定字段，本波不写实现）

- 可审计划卡：独立工具 `submit_plan` + 请求字段 `execute_plan_id`
- 隔离：独立请求字段 `isolate_run: bool` 与会话目录 `~/.agenticx/isolates/<session_id>/<run_id>`。禁止把 `turnIntent` 解释成隔离

---

## 3. 需求与验收

| ID | 类型 | 描述 |
|---|---|---|
| FR-1 | Functional | `ChatPane.turnIntent` 窗格级；`+` / 芯片 / 快捷键只切当前窗格 |
| FR-2 | Functional | `POST /api/chat` 接受 `plan_mode`；为 true 时本轮不可变文件系统/命令 |
| FR-3 | Functional | 自动化会话强制默认 |
| FR-4 | Functional | 开 Plan 后输入区出现芯片；悬停出 X + 下方 tooltip；点击清回默认 |
| FR-5 | Functional | 群聊 / 自动化：无 Mode 行、无芯片；快捷键忽略 |
| FR-6 | Functional | 权限三档与本机/远端控件语义不变 |
| NFR-1 | Non-Functional | 开关与芯片即时（乐观 UI）；不新增依赖 |
| NFR-2 | Non-Functional | 触碰 `server.py` 时按仓库规则做一次 `agx serve` 冷启动冒烟 |
| AC-1 | Acceptance | `tests/test_plan_mode_runtime.py`：plan 轮 `file_write` / `bash_exec` 不在可见工具里；default 原样返回；automation 忽略开关 |
| AC-2 | Acceptance | 同文件：plan 提示含 `Plan mode`；`file_write` 有 denial 文案 |
| AC-3 | Acceptance | `tests/test_smoke_openharness_features.py` 里 `PlanModeLayer` 旧测仍绿 |
| AC-4 | Acceptance | `desktop/src/utils/turn-intent.test.ts` + `ComposerModeMenu.test.tsx`：互斥开关语义 + Mode 行 / 芯片文案 |
| AC-5 | Acceptance | 手工：`+` → Mode → 开 Plan → 输入区出现 Plan 芯片 → 悬停 X/tooltip → 点掉；两窗格互不影响；群聊无入口 |

---

## 4. 规划依据（行号会漂移，按符号搜）

1. `+` 菜单：`ChatPane.tsx` `ComposerMoreActionsButton`。Add file 按钮之后插入 `renderMode?.()`。click-outside 白名单已有 skill / kb / connectors，必须再加 `COMPOSER_MODE_MENU_ID`。
2. 发送体：`ChatPane.tsx` `sendChat` 构造 `body` 处（`retrieval_mode` 附近）写 `plan_mode`。
3. 窗格类型：`desktop/src/store.ts` `ChatPane`；新字段 `turnIntent` 缺省兼容 localStorage 旧快照（`normalizeTurnIntent`）。
4. 快捷键：`desktop/src/core/keybinding-manager.ts` 已注册 `Ctrl/Cmd+Shift+P`；`App.tsx` `toggle-plan-mode` 必须切 **active pane**，禁止全局 `store.planMode`。
5. 协议：`agenticx/studio/protocols.py` `ChatRequest`。
6. 工具表：`server.py` `_filter_tools_by_policy` 之后、`/api/loop` 组完 `loop_tools` 后再滤一层。import **只写在函数体内**。
7. 系统提示：`agenticx/runtime/prompts/meta_agent.py` 末尾拼 `build_turn_intent_block(session)`。
8. 旧前缀（不要再用）：`desktop/src/components/ChatView.tsx`。
9. `server.py` 编辑纪律：只能精确增删目标行；改完必须冷启动冒烟。

---

## 5. 子规划 → 推荐模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| 协议 / 裁工具 / 系统提示 | Composer 2.5 | 纯函数 + pytest |
| `+` Mode 子菜单 + 芯片 | Composer 2.5 | 克隆现有 `+` 行与 `SettingsSwitch` |
| `server.py` 接线 | Composer 2.5，但必须逐行对照 | 高回归文件，只加函数体内 import 与 filter 调用 |
| 隔离副本（后续） | 跨栈档 | 路径改写 + git worktree |

---

## 6. 关键 before / after

### 6.1 请求协议

`agenticx/studio/protocols.py` `ChatRequest`：

```python
    plan_mode: Optional[bool] = False
```

### 6.2 裁工具

新建 `agenticx/runtime/plan_mode.py`：

- `TURN_INTENT_ALLOWED_TOOLS`：`file_read` / `grep` / `glob` / `web_search` / `web_fetch` / `liteparse` / `skill_list` / `skill_use` / `session_search` / `memory_search` / `mcp_list` / `todo_list` / `scratchpad_read` / `knowledge_search` / `code_search`
- `apply_turn_intent_to_session(..., is_automation=)`：automation 强制 `plan_mode=False`
- `filter_tools_for_turn_intent(tools, session)`：受限时只留白名单
- `turn_intent_denial_message`：dispatch 二次拦截
- `build_turn_intent_block`：plan 一段英文系统提示

`PlanModeLayer.read_only_tools` 补 `knowledge_search`、`code_search`。本波 **不要** 把 `submit_plan` 加进白名单（工具还不存在）。

`server.py` `chat()` 取出 `session` 后（函数体内）：

```python
from agenticx.runtime.plan_mode import apply_turn_intent_to_session, filter_tools_for_turn_intent
apply_turn_intent_to_session(
    session,
    plan_mode=bool(getattr(payload, "plan_mode", False)),
    is_automation=is_automation_session,
)
```

`_filter_tools_by_policy(...)` 之后：

```python
effective_tools = filter_tools_for_turn_intent(effective_tools, session)
```

`/api/loop` 组完 `loop_tools` 后再滤一层（同样函数体内 import）。

`dispatch_tool_async` 在权限检查后调用 `turn_intent_denial_message`，命中则 `ERROR: ...`，不要静默成功。

### 6.3 窗格 state

- `ChatPane.turnIntent?: TurnIntent`
- `setPaneTurnIntent(paneId, intent)`
- hydrate / persist `agx-workspace-state` 必须带 `turnIntent`，旧快照缺字段当 `default`
- 全局 `store.planMode` 可留着以免旧 persist 炸，但产品路径只读 pane

### 6.4 前端发送

```typescript
if ((pane.turnIntent ?? "default") === "plan") body.plan_mode = true;
```

### 6.5 不要做的假计划

禁止再把用户原文改成「你现在处于计划模式，不要调用工具…」。那是旧 `ChatView` 方案，模型仍可能调用工具。

---

## 7. 任务

### Task 1: 后端裁工具 + 提示

**Files:**
- Create: `agenticx/runtime/plan_mode.py`
- Create: `tests/test_plan_mode_runtime.py`
- Modify: `agenticx/tools/policy.py` `PlanModeLayer.read_only_tools`
- Modify: `agenticx/studio/protocols.py`
- Modify: `agenticx/runtime/prompts/meta_agent.py`（顶部 import `build_turn_intent_block`，拼进系统提示末尾）
- Modify: `agenticx/cli/agent_tools.py` `dispatch_tool_async`（权限检查后加 denial）
- Modify: `agenticx/studio/server.py` **仅函数体内** 三处：apply + 主路径 filter + loop filter

**验证：**

```bash
pytest tests/test_plan_mode_runtime.py tests/test_smoke_openharness_features.py::TestPlanModeLayer -q
```

**冒烟（改了 server.py 则必须）：**

```bash
agx serve --host 127.0.0.1 --port 18765
curl --noproxy '*' -sS -o /dev/null -w "%{http_code}" -H "X-Agx-Desktop-Token: <token>" http://127.0.0.1:18765/api/session
curl --noproxy '*' -sS -o /dev/null -w "%{http_code}" -H "X-Agx-Desktop-Token: <token>" http://127.0.0.1:18765/api/avatars
curl --noproxy '*' -sS -o /dev/null -w "%{http_code}" -H "X-Agx-Desktop-Token: <token>" http://127.0.0.1:18765/api/sessions
```

期望：进程不崩，三个接口 200。测完停掉该端口进程。

### Task 2: `+` Mode + 芯片

**Files:**
- Create: `desktop/src/utils/turn-intent.ts`、`turn-intent.test.ts`
- Create: `desktop/src/components/composer/ComposerModeMenu.tsx`、`ComposerModeMenu.test.tsx`
- Create: `desktop/src/components/composer/TurnIntentChip.tsx`
- Modify: `ComposerMoreActionsButton` 增加可选 `renderMode`；click-outside 加 `COMPOSER_MODE_MENU_ID`
- Modify: `store.ts` / `App.tsx` persist + 快捷键
- Modify: `ChatPane.tsx` 插入 Mode 与芯片；`sendChat` 写 body；placeholder
- Modify: `HoverTip` 增加 `placement="below"`（默认仍 above，勿改其它调用方）
- Modify: `desktop/locales/en/chat.json`、`zh/chat.json`

**验证：**

```bash
cd desktop && npx vitest run src/utils/turn-intent.test.ts src/components/composer/ComposerModeMenu.test.tsx
```

---

## 8. 后续（不要在本波实现）

1. **可审计划卡：** `submit_plan` + 线程内确认 / 丢弃。另开 plan。
2. **隔离副本 / Multitask：** 已另开 `.cursor/plans/pending/2026-09-08-near-isolate-multitask.plan.md`。没有 Adopt/Discard 不要做多路竞赛。

---

## 9. 手工验收

1. 英文界面：`+` 菜单在 Add file 与 Skills 之间有 Mode。
2. 开 Plan：说明变成计划文案，Plan 开关绿，输入区出现 Plan 芯片；placeholder 变为计划提示。
3. 悬停芯片：图标变 X，下方 tooltip 为 Plan；点击后芯片消失，开关回到关。
4. 两个 Pro 窗格互不影响。
5. 群聊无 Mode、无芯片；`Cmd+Shift+P` 无效。
6. 权限三档仍可独立切换；开 Plan +「全部允许」不得让该轮写出文件。
7. 本波 Mode 子菜单没有 Ask。Multitask 走独立 isolate plan，不要在本波加假开关。

---

## 10. no-scope-creep

每个 diff 必须能追溯到 FR-1…FR-6。觉得隔离 / 五档菜单 / PlanCard / 自动识别「该不该计划」更好，先停下来问，不准做。
