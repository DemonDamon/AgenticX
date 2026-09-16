# wb-bridge P0.5-C：无人值守契约与呈现（工具 description + Desktop 格式化）

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: composer-2.5-fast（工具 description 文案、一处数值下界、一个前端格式化函数 + vitest；无架构判断，最省档即可）

主规划：`.cursor/plans/2026-09-04-wb-bridge-session-supervision.plan.md`
**前置硬依赖**：子规划 B（`2026-09-04-wb-bridge-supervision-b-control-plane.plan.md`）必须先完成并全绿。本段消费 B 交付的 `MessageResponse` 字段形状（`status` / `next_action` / `observed_tools` / `usage_totals` / `stalled` / `terminal_detail` / `turns_completed` / `deduplicated`）。

---

## 1. 本段要修的根因

### 根因：无人值守契约从未写给模型看

那次 8 分钟空转的**直接诱因**是用 `permission_mode=default` 起会话去做「写文件 + 跑命令」。这在 WB 上必然停在权限确认，而 AGX **没有**批准通道（P0 的 E-3 实测：codebuddy 不支持 `--permission-prompt-tool`，headless 不吐 `control_request`；`cc_bridge_permission` 属于 Claude Code 那条桥，对 WB 会话无效）。

当前 `agenticx/cli/agent_tools.py:1174-1181` 的 `wb_bridge_start` description 完全没提这件事，L1199 的 `permission_mode` 属性描述只写了 `"Invalid values fall back to default."`。模型无从知道 `default` 在无人值守场景等于死锁。

### 根因：超时后没有任何「别重发」的指令

`wb_bridge_send` 的 description（L1211-1215）只说「发一轮并等 result/timeout」。B 段已经在响应里给了 `next_action`，但**工具描述本身**也必须写明「status=running 时去 describe、绝不重发」，否则模型在读到响应前就已经决定重试了。

### 根因：`wait_seconds=0` 在工具层被抬到 1.0

`agent_tools.py:6238`：

```python
    wait_f = max(1.0, min(3600.0, wait_f))
```

B 段已把 HTTP 侧 `MessageBody.wait_seconds` 的下界放到 `0.0`，但工具层这行会把 `0` 抬成 `1.0`，非阻塞投递能力在 Agent 侧仍不可用。

### 根因：Desktop 只显示「已等待 N 秒」

`desktop/src/utils/wb-bridge-ui.ts` 现有实现只有两种文案，`formatWbBridgeSendToolResult` 只区分「成功有 result_text」与「其它一律 tail 前 900 字」。用户看不出是在跑、被拦、还是进程死了。

### 根因（复审补充）：行为纪律没有落进系统提示

复审发现四处 plan 初版未覆盖、但上线必踩的面，全部归入本段：

1. **Meta 系统提示缺 wb 纪律**：`agenticx/runtime/prompts/meta_agent.py:1037-1039` 给 cc_bridge 写了三条硬约束（可见模式强约束 / 证据门禁 / 模式路由），wb_bridge 一条没有。工具 description 是弱约束，拦不住「反复重发 / 误调 cc_bridge_permission / 绕去读日志」这类行为层错误。
2. **automation 会话入口未屏蔽**：`agenticx/studio/server.py:3613` 的 automation 屏蔽集合只挡了 `schedule_task / list_scheduled_tasks / cancel_scheduled_task / delegate_to_avatar`，`wb_bridge_*` 全保留。定时任务天然无人值守，`default` 模式必挂且无人读 `blocked`，子进程挂到 stop 或 bridge 重启。
3. **`wb_bridge_stop` 无后果提示**：直接 `DELETE` 杀进程，running 会话被砍时进行中的写入可能半截，description 未说明。
4. **进度心跳只有秒数**：`agent_runtime.py:6138-6148` 的 `TOOL_PROGRESS` 只带 `{name, tool_call_id, elapsed_seconds}`，Desktop 只能显示「已等待 Ns」，看不到 B 段已记录的 `last_activity`。
5. **`idempotency_key` 生成责任未归属**：B 段把它留给模型手填，模型每次编的 key 大概率不同，幂等形同虚设。

---

## 2. In scope / Out of scope

### In scope

1. 改 `agenticx/cli/agent_tools.py`：三处 wb 工具 description + 一处 `wait_f` 下界 + 幂等键兜底生成。**仅 wb_bridge 相关块。**
2. 改 `desktop/src/utils/wb-bridge-ui.ts`：两个导出函数的实现（**签名不变**）。
3. 新建 `desktop/src/utils/wb-bridge-ui.test.ts`。
4. 追写 `tests/test_smoke_wb_bridge.py` 的契约文案断言。
5. **追加** `agenticx/runtime/prompts/meta_agent.py` 执行纪律区的 wb 段落（FR-C6）。
6. **仅改** `agenticx/studio/server.py` 的 automation 屏蔽集合一行（FR-C7）。
7. **`wb_bridge_stop` 增加可选 `force`**：`turn_state==running` 且未传 `force=true` 时只警告、不杀进程。

### Out of scope（做了算违规）

- **不改** `desktop/src/components/ChatPane.tsx`。它已在 L2493 调 `formatWbBridgeSendToolResult`、L10676 调 `wbBridgeSendToolProgressLabel`、L10748-10755 拉起 wb-bridge 终端；**保持这两个函数签名不变即无需改它**。
- **不改** `desktop/src/components/ChatView.tsx`（L223 也调 `formatWbBridgeSendToolResult`，同理）。
- **不改** `agenticx/cli/agent_tools.py` 里 `cc_bridge_*` 的任何 schema 或 handler。
- **不新增** Studio 工具，**不改** `agenticx/runtime/tool_search.py`（wb 工具当前不在 `BUILTIN_DEFER_ALLOWLIST`，始终加载，无需调整）。
- **不改** `agenticx/wb_bridge/**`（A、B 段已完成）、`agenticx/cc_bridge/**`。
- **`agenticx/runtime/prompts/meta_agent.py` 除追加 wb 纪律段外一律不动**（尤其 import 区与既有 cc_bridge 段落）。
- **`agenticx/studio/server.py` 除 automation 屏蔽集合一行外一律不动**（尤其 import 区，见 AGENTS.md 强约束）。

---

## 3. 硬约束

1. `wb-bridge-ui.ts` 两个导出函数**签名不变**：`wbBridgeSendToolProgressLabel(sec: number | null | undefined): string`、`formatWbBridgeSendToolResult(resultText: string): string | null`。
2. `formatWbBridgeSendToolResult` 必须保留「JSON 解析失败 → 返回 `null`」的既有兜底（`ChatPane.tsx` L2494-2497 依赖 null 来回落默认渲染）。
3. 工具 description 是**追加**而非重写：既有的 `"Do NOT start serve via bash/bash_bg (sandbox cannot import agenticx)"` 等句子必须保留。
4. 用户可见文案用中文；给模型看的 description 用英文（与该文件既有风格一致）。
5. 前端不得引入新依赖。

---

## 4. 功能需求（FR）

### FR-C1 `wb_bridge_start` description 追加无人值守契约

`agenticx/cli/agent_tools.py:1174-1181`。在既有 description 字符串**末尾追加**（保留原有全部句子）：

```
IMPORTANT unattended contract: permission_mode=default (the API default) will
pause on Write/Bash approval and this bridge has NO approval channel
(cc_bridge_permission belongs to the Claude Code bridge and does not work
here). For any task that writes files or runs commands without a human
watching, pass permission_mode=acceptEdits (file edits only) or
dontAsk / bypassPermissions (edits + commands). Use default/plan only for
read-only or planning turns. The create response returns unattended_ok and a
hint field; read them.
```

L1189-1199 的 `permission_mode` 属性 `description` 改为：

```
Session-level --permission-mode. Invalid values fall back to default.
default/plan are NOT usable for unattended write/exec tasks: they stall on an
approval prompt that this bridge cannot answer.
```

`enum` 列表（L1191-1198）**不变**。

### FR-C2 `wb_bridge_send` description 与 `wait_seconds` 说明

`agenticx/cli/agent_tools.py:1210-1229`。description **末尾追加**：

```
Returns status = success | blocked | error | exited | running, plus
usage_totals, observed_tools and next_action. On status=running the turn is
STILL EXECUTING: poll wb_bridge_describe with the same session_id and never
resend the same instruction (a resend while a turn is in flight is rejected
with HTTP 409). On status=blocked the session hit a permission prompt: check
observed_tools first, because side effects before the block are already
committed on disk, then start a NEW session with an unattended
permission_mode instead of resending. Pass idempotency_key to make a retry
safe: an identical key is not re-dispatched.
```

L1221-1224 的 `wait_seconds` 属性 `description` 改为：

```
Seconds to wait for this turn to end (default 180). Pass 0 to dispatch and
return immediately, then poll wb_bridge_describe.
```

**新增** `idempotency_key` 属性（加在 `wait_seconds` 之后，`required` 仍为 `["session_id", "text"]`）：

```python
                    "idempotency_key": {
                        "type": "string",
                        "description": (
                            "Optional retry-safety token. Reusing the key of the current or "
                            "last turn returns that turn's snapshot instead of re-dispatching."
                        ),
                    },
```

### FR-C3 `wb_bridge_describe` description 追加供数说明

`agenticx/cli/agent_tools.py:1250-1254`。description **末尾追加**：

```
Returns live turn state, last tool activity, observed_tools, cumulative token
usage and terminal kind. Do NOT try to read ~/.agenticx/logs/wb-bridge/*.log
from bash: the agent workspace sandbox blocks it and describe already carries
the same data.
```

`_tool_wb_bridge_describe`（L6253-6257）**逻辑不变**（纯透传，timeout 15s 足够）。**不要**在此新增日志读取分支。

### FR-C4 `_tool_wb_bridge_send` 放行 0 并透传幂等键

`agenticx/cli/agent_tools.py:6228-6245`。两处改动：

1. L6238 `wait_f = max(1.0, min(3600.0, wait_f))` → `wait_f = max(0.0, min(3600.0, wait_f))`。
2. 请求 body（L6243）追加幂等键（仅在非空时带上，避免给 HTTP 侧塞 `null`）：

```python
    body: Dict[str, Any] = {"text": text, "wait_seconds": wait_f}
    idem = str(arguments.get("idempotency_key", "") or "").strip()
    if idem:
        body["idempotency_key"] = idem[:200]
    return await _tool_wb_bridge_http(
        session,
        "POST",
        f"/v1/sessions/{sid}/message",
        body,
        timeout_sec=wait_f + 45.0,
    )
```

默认值 `180.0` 与解析失败回落 `180.0`（L6233-6237）**不变**；`timeout_sec=wait_f + 45.0` **不变**（`wait_seconds=0` 时 45s 上限足够）。

**幂等键兜底生成**：当模型未提供 `idempotency_key` 时，工具层自动生成 `f"{sid}:{sha1(text)[:12]}"` 作为兜底，使「同一 session 重发同一指令」天然命中 B 段的幂等短路；模型显式提供的值优先。这样即使模型忘记填 key，超时重发同一指令也不会重复投递。

### FR-C5 Desktop 格式化

`desktop/src/utils/wb-bridge-ui.ts`。

`wbBridgeSendToolProgressLabel(sec)`：保留现有两分支结构，把括号内提示改为：

- 有 `sec`：`⏳ wb_bridge_send 执行中…（已等待 ${sec}s；超时后请用 wb_bridge_describe 查询，勿重复投递）`
- 无 `sec`：`⏳ wb_bridge_send 执行中…（无头模式：请确认右侧「wb-bridge」终端内 serve 已启动）`（**不变**）

`formatWbBridgeSendToolResult(resultText)`：解析 JSON 后按 `status` 分支（`status` 缺失时回落读 `ok` 布尔，兼容 B 段未上线的情况）：

| status | 输出 |
|---|---|
| `success` | `✅ CodeBuddy（WB bridge）` + 空行 + `result_text`；若有用量则末行追加 `\n\n· 累计 ${turns_completed} 轮 · in ${input_tokens} / out ${output_tokens} tokens` |
| `running` | `⏳ WB bridge：本轮仍在执行（第 ${turn_seq} 轮${last_activity ? `，当前动作：${last_activity}` : ""}）。请用 wb_bridge_describe 查询进度，勿重复投递。` |
| `blocked` | `⚠️ WB bridge：被 CodeBuddy 权限确认挡住${terminal_detail ? `（${terminal_detail}）` : ""}。该会话无批准通道，请用 acceptEdits / dontAsk 重开会话。` |
| `error` | `❌ WB bridge：本轮以错误结束${terminal_detail ? `（${terminal_detail}）` : ""}。` |
| `exited` | `❌ WB bridge：CodeBuddy 进程已退出，需重开会话。` |

附加规则：

1. `observed_tools` 非空且 status 为 `blocked` / `error` 时，追加一行：`\n\n本轮已执行：${observed_tools.join(" → ")}（产物可能已落盘，重试前请先核验）`。**这是 D-5 的用户可见载体，必须实现。**
2. `stalled === true` 且 status 为 `running` 时，在 running 文案后追加 `（长时间无新输出，疑似等待确认）`。
3. `deduplicated === true` 时，在任何文案**开头**追加 `（重复投递已去重）` 前缀。
4. 上述任一分支都取不到有效信息时，回落现有行为：有 `tail` 则输出 `⏳ WB bridge：${ok ? "本轮已结束" : "未完成或超时"}。\n${tail.slice(0, 900)}`。
5. JSON 解析失败 → `return null`（§3 约束 2）。

`usage_totals` 的键名为 `input_tokens` / `output_tokens`（B 段字段），缺失时不显示用量行。

### FR-C6 Meta 系统提示追加 wb 纪律

`agenticx/runtime/prompts/meta_agent.py` 的执行纪律区（cc_bridge 三条约束 L1037-1039 **之后**），**追加**一段 wb_bridge 约束。**禁止**改动既有任何一行，尤其 import 区。追加内容（中文，与既有段落风格一致）：

```
- **wb_bridge 无人值守强约束**：用 `wb_bridge_start` 起会话做「写文件/跑命令」时，`permission_mode` 必须显式用 `acceptEdits`（仅写文件）或 `dontAsk`/`bypassPermissions`（写文件+跑命令）；`default`/`plan` 会停在权限确认且本桥无批准通道（`cc_bridge_permission` 属另一条桥，对 wb 无效）。
- **wb_bridge 重发禁令**：`wb_bridge_send` 返回 `status=running` 时，该轮仍在执行，禁止重复 `wb_bridge_send` 同一指令（在飞重发会被 409 拒绝）；应改用 `wb_bridge_describe` 轮询。返回 `status=blocked` 时，先看 `observed_tools`（被拦之前的写入已落盘），再决定是否用无人值守模式重开新会话，禁止在原会话重发。
- **wb_bridge 证据门禁**：`wb_bridge_send` 返回 `ok=false` 或仅有 tail 片段时，禁止汇报「完成」，只能汇报当前 `status`、阻塞原因与下一步。禁止用 `bash_exec`/`file_read` 去读 `~/.agenticx/logs/wb-bridge/*.log`（沙箱拦截且 describe 已带同样数据）。
```

### FR-C7 automation 会话屏蔽 wb 工具

`agenticx/studio/server.py:3613` 的 `_blocked` 集合，**只把会改会话/杀进程的三个工具名加入**（保留 `wb_bridge_list` / `wb_bridge_describe` 供排查）：

```python
            _blocked = {"schedule_task", "list_scheduled_tasks", "cancel_scheduled_task", "delegate_to_avatar",
                        "wb_bridge_start", "wb_bridge_send", "wb_bridge_stop"}
```

**禁止**改动该文件任何其它行（尤其 import 区）。理由：定时任务是天然无人值守入口，`default` 模式必挂且无人读 `blocked`；automation 应直接用本地 `file_write`/`bash_exec`，不该起另一个 Agent 进程。

### FR-C8 `wb_bridge_stop` description 补后果提示

`agenticx/cli/agent_tools.py:1267-1275` 的 `wb_bridge_stop` description **末尾追加**：

```
This terminates the child process immediately. If a turn is still running
(turn_state=running), in-flight file writes may be incomplete. The tool
refuses to stop a running turn unless force=true.
```

新增可选属性 `force`（`required` 仍仅为 `["session_id"]`）：

```python
                    "force": {
                        "type": "boolean",
                        "description": (
                            "If true, terminate even when turn_state=running. "
                            "Default false: return a warning and do not kill the child."
                        ),
                    },
```

`_tool_wb_bridge_stop`（L6260-6264）：在 DELETE 之前，若 `force` 不为 true，先 `GET /v1/sessions/{sid}`；若响应能解析且 `turn_state=="running"`，**不要 DELETE**，返回英文警告（须含 `force=true` 与 `in-flight`）。`force=true` 或会话已 idle/stopped 时再 DELETE。

### FR-C9 进度心跳携带当前动作

`agent_runtime.py:6138-6148` 的 `TOOL_PROGRESS` data 当前只有 `{name, tool_call_id, elapsed_seconds}`。**本 FR 不改 agent_runtime.py**（属 runtime 核心，避免回归）。改为在 `_tool_wb_bridge_send`（`agent_tools.py`）发起 HTTP 前，把当前已知的 `session_id` 写进工具结果前缀，供 Desktop 在 `wb_bridge_send` 的 progress 阶段经 `wb_bridge_describe` 拉一次 `last_activity` 显示。

**简化落地（避免改 runtime）**：Desktop 侧 `wbBridgeSendToolProgressLabel` 保持只收 `sec`；真正的「当前动作」由 C 段 FR-C5 的 `running` 分支在**结果返回时**展示（`last_activity` 字段）。运行中的实时动作留待后续单独评估，不在本段强行改 runtime。

### FR-C10 用户文档（本组不做）

`docs/guides/wb-bridge.md` 列入主规划 §7.5 后续，不阻塞本段交付。

---

## 5. 验收标准（AC）

### Python 侧（追写 `tests/test_smoke_wb_bridge.py`）

取 schema 的方式：遍历 `agenticx.cli.agent_tools.STUDIO_TOOLS`（列表定义在 `agent_tools.py:682`）找 `item["function"]["name"] == <工具名>`，**不要硬编码索引**。

- **AC-C1（FR-C1）** `wb_bridge_start` 的 description 同时含 `"acceptEdits"`、`"cc_bridge_permission"`、`"unattended_ok"`，且**仍含**原有的 `"Do NOT start serve via bash"`；其 `permission_mode` 属性 description 含 `"NOT usable for unattended"`；`enum` 仍为 6 项。
- **AC-C2（FR-C2）** `wb_bridge_send` 的 description 同时含 `"409"`、`"never resend"`、`"side effects"`、`"idempotency_key"`；`properties` 含 `idempotency_key`；`required` 仍恰为 `["session_id", "text"]`；`wait_seconds` 的 description 含 `"Pass 0"`。
- **AC-C3（FR-C3）** `wb_bridge_describe` 的 description 含 `"Do NOT try to read"` 与 `"observed_tools"`。
- **AC-C4（FR-C4 下界与幂等透传）** monkeypatch `agenticx.cli.agent_tools._tool_wb_bridge_http` 捕获传入的 `json_body`：
  - `wait_seconds=0` → `body["wait_seconds"] == 0.0`（**不被抬到 1.0**）
  - `wait_seconds="abc"` → `body["wait_seconds"] == 180.0`
  - `wait_seconds=9999` → `body["wait_seconds"] == 3600.0`
  - 带 `idempotency_key="k1"` → `body["idempotency_key"] == "k1"`
  - 不带 key 时 → `body["idempotency_key"]` 等于 `f"{sid}:{sha1(text)[:12]}"` 的兜底值（**非空**，证明兜底生成生效）
- **AC-C5（cc_bridge 未被误改）** `cc_bridge_start` / `cc_bridge_send` / `cc_bridge_permission` 三个 schema 的 description 与 `agenticx/cc_bridge/` 全部文件保持不变（`test_ac8_no_cc_bridge_diff` L218 继续绿；另断言 `cc_bridge_send` 的 description 不含 `"observed_tools"`，防止改错对象）。
- **AC-C6（全量回归）** `pytest tests/test_smoke_wb_bridge.py -q` 全绿。
- **AC-C6b（FR-C6 meta 纪律落位）** 断言 `agenticx/runtime/prompts/meta_agent.py` 源码含 `"wb_bridge 无人值守强约束"`、`"wb_bridge 重发禁令"`、`"wb_bridge 证据门禁"` 三段，且既有 `"cc_bridge 可见模式强约束"` 段仍在（证明只追加未改写）。
- **AC-C6c（FR-C7 automation 屏蔽）** 断言 `agenticx/studio/server.py` 源码中 automation `_blocked` 集合同时含 `"wb_bridge_start"`、`"wb_bridge_send"`、`"wb_bridge_stop"`；且该文件 diff 行数 ≤ 3（证明只动了屏蔽集合一行区域，未碰 import 区）。
- **AC-C6d（FR-C8 stop 提示）** `wb_bridge_stop` 的 description 含 `"in-flight file writes may be incomplete"`。
- **AC-C6e（FR-C8 force）** monkeypatch `_tool_wb_bridge_http`：`force` 缺省且 describe 返回 `turn_state=running` 时**不得**发出 DELETE；`force=true` 时发出 DELETE。

### 前端侧（新建 `desktop/src/utils/wb-bridge-ui.test.ts`）

用 vitest，写法参照 `desktop/src/components/messages/ImBubble.test.tsx`（同仓已有 vitest 用例）。运行命令：`cd desktop && npx vitest run src/utils/wb-bridge-ui.test.ts`。

- **AC-C7（五态）** 五个 status 各一条：`success` 含 `result_text` 原文；`running` 含 `勿重复投递`；`blocked` 含 `acceptEdits`；`error` 含 `terminal_detail` 的内容；`exited` 含 `重开会话`。
- **AC-C8（副作用告知 —— D-5 守卫）** `{"status":"blocked","observed_tools":["Write","Bash"],"terminal_detail":"Bash"}` 的输出同时含 `"Write → Bash"` 与 `"重试前请先核验"`。
- **AC-C9（stalled / deduplicated）** `{"status":"running","stalled":true}` 含 `疑似等待确认`；`{"status":"success","result_text":"ok","deduplicated":true}` 以 `（重复投递已去重）` 开头。
- **AC-C10（用量行）** `{"status":"success","result_text":"ok","turns_completed":22,"usage_totals":{"input_tokens":197000,"output_tokens":285}}` 的输出含 `22` 与 `197000`；`usage_totals` 缺失时输出**不含** `tokens` 字样。
- **AC-C11（兜底不回归）** `formatWbBridgeSendToolResult("not json")` → `null`；`{"ok":true,"result_text":"hi"}`（无 `status`，模拟 B 段未上线）→ 走 success 分支含 `"hi"`；`{"ok":false,"tail":"some tail"}` → 含 `"some tail"`。
- **AC-C12（进度文案）** `wbBridgeSendToolProgressLabel(12)` 含 `12s` 与 `勿重复投递`；`wbBridgeSendToolProgressLabel(null)` 含 `wb-bridge`。
- **AC-C13（类型与调用点不破）** `cd desktop && npx tsc --noEmit` 无新增错误（证明 `ChatPane.tsx` L2493 / L10676 与 `ChatView.tsx` L223 的调用签名未破）。

### 守卫

- **AC-C14（Out of scope）** `git diff --name-only` 只应出现 `agenticx/cli/agent_tools.py`、`desktop/src/utils/wb-bridge-ui.ts`、`desktop/src/utils/wb-bridge-ui.test.ts`、`tests/test_smoke_wb_bridge.py`、`agenticx/runtime/prompts/meta_agent.py`、`agenticx/studio/server.py`。**不得**出现 `desktop/src/components/**`、`agenticx/wb_bridge/**`、`agenticx/cc_bridge/**`、`docs/guides/wb-bridge.md`；`agenticx/runtime/**` 中**仅允许** `prompts/meta_agent.py`；`agenticx/studio/server.py` 仅允许屏蔽集合一行改动（AC-C6c 已守）。

---

## 6. 实施顺序

1. 三处 description 追加 + `permission_mode` / `wait_seconds` 属性描述改写 + 新增 `idempotency_key` 属性（FR-C1~C3、FR-C2 末段）→ 跑 AC-C1~AC-C3、AC-C5。
2. `_tool_wb_bridge_send` 下界、body 组装与幂等兜底（FR-C4）→ 跑 AC-C4。
3. `wb-bridge-ui.ts` 两函数（FR-C5）→ 建测试文件，跑 AC-C7~AC-C12。
4. `meta_agent.py` 追加 wb 纪律段（FR-C6）→ 跑 AC-C6b。
5. `server.py` automation 屏蔽集合（FR-C7）→ 跑 AC-C6c。
6. `wb_bridge_stop` description（FR-C8）→ 跑 AC-C6d。
7. `wb_bridge_stop` 的 `force` 行为（FR-C8）→ 跑 AC-C6d、AC-C6e。
8. `npx tsc --noEmit`（AC-C13）+ Python 回归（AC-C6）+ diff 守卫（AC-C14）。

---

## 7. 风险

| 风险 | 缓解 |
|---|---|
| description 被整段重写，丢掉 P0 的 "Do NOT start serve via bash" 等既有句子 | §3 约束 3 要求追加；AC-C1 断言原句仍在 |
| 改错对象（把契约文案写进 `cc_bridge_*`） | AC-C5 双向断言 |
| 前端函数签名被改动 → `ChatPane` / `ChatView` 编译失败 | §3 约束 1；AC-C13 用 `tsc --noEmit` 守 |
| 丢掉「解析失败返回 null」兜底 → 聊天里出现空气泡 | §3 约束 2；AC-C11 |
| B 段尚未上线时 C 段先合并，`status` 字段缺失 | FR-C5 要求回落读 `ok`；AC-C11 第二条覆盖 |
| `idempotency_key` 传空串仍进 body → HTTP 侧收到空键 | FR-C4 改为工具层兜底生成 `f"{sid}:{sha1(text)[:12]}"`，模型显式值优先；AC-C4 末条守卫 |
| 误改 `meta_agent.py` import 区或既有 cc_bridge 段 | FR-C6 仅追加；AC-C6b 双向断言（新段在 + 旧段在） |
| 误改 `server.py` import 区 | FR-C7 仅一行集合；AC-C6c 守 diff 行数 |

---

## 8. 提交约定

```
Plan-Id: 2026-09-04-wb-bridge-supervision-c-contract-and-ui
Plan-File: .cursor/plans/2026-09-04-wb-bridge-supervision-c-contract-and-ui.plan.md
Plan-Id: 2026-09-04-wb-bridge-session-supervision
Plan-File: .cursor/plans/2026-09-04-wb-bridge-session-supervision.plan.md
Plan-Model: claude-opus-5-thinking
Impl-Model: <实际使用的模型>
Made-with: Damon Li
```

commit 示例：`feat(wb-bridge): state the unattended permission contract and surface turn status in chat`。不写任何对标第三方产品的措辞，**不得**在 commit 里出现 loopx 等第三方项目名。
