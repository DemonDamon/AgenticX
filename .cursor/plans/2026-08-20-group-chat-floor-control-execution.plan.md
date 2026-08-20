# 群聊发言权、短答契约与真执行

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: Cursor Grok 4.6（默认群聊主路径 + 执行证据门，回归风险最高）
Status: implemented
Plan-Id: 2026-08-20-group-chat-floor-control-execution
Parent-Plan: 2026-08-20-group-chat-control-room-experience

> **For implementer:** 只改本 plan 列出的 Python 文件与测试。不要改 Desktop，不要实现活动卡或产物附件。`__SKIP__` 继续作为内部协议，但任何路径都不得把它或 pass 文案写进用户可见正文。不要 commit，除非用户明确要求。

**Goal:** 系统只唤醒本轮真正需要的专家；默认回复短而有增量；需要动手的请求真实进入 AgentRuntime，不能以“等我回复”结束；没有执行证据时不得声称完成。

**Architecture:** 扩展 `IntentDecision`，除 action / targets 外增加 `requires_execution`。显式点名和复杂 Workforce 路径保持最高优先级；普通专业问答默认 1 位，只有 `open_floor` 可给 2 位机会。`meta_direct` 在执行型请求下强制走 `_run_one_target_stream`（有工具），非执行问答继续走轻量 PM LLM。`_run_one_target` 直接记录本轮成功工具结果，避免依赖可能尚未回写 owner session 的历史事实；对无证据的“完成/稍后回复”做 fail-closed 收口。

**Tech Stack:** `agenticx/runtime/group_router.py`、`agenticx/runtime/harden_flags.py`、pytest。

---

## 根因与证据

1. `group_router.py:_run_intelligent_turn` 的 `meta_direct` 只有 `group.meta_direct_tools=true` 才走 AgentRuntime；默认 flag 为 false（`harden_flags.py:103-105`）。因此 Near 可以口头承诺，但本轮没有工具执行。
2. `_run_one_target` 已给普通成员真实 `_group_chat_tools()`，并产生结构化 `group_progress`；不应重写 runtime。
3. `_run_intelligent_turn` 普通 `route_to` 在未显式点名时仍裁到 `primary_targets[:2]`；专业任务可能叫醒两个人，增加等待和重复。
4. 所有候选跳过后，普通路径会公开发 `group_nudge`（`group_router.py:1927-1945`），再强制重跑目标。这个系统催促会变成一条 Near 气泡。
5. Desktop 已对 `group_skipped` 只清理状态、不加气泡（`ChatPane.tsx:9984-9999`）。后端保持空 content 即可。
6. `_run_one_target` 的 prompt 已有“默认短聊”和 `__SKIP__`，但 FINAL 没有确定性证据校验。

---

## In scope

- `IntentDecision.requires_execution: bool`
- `_analyze_intent` JSON 协议增加 `requires_execution`
- 解析失败时用纯函数 `_looks_like_execution_request()` 兜底
- 普通 `route_to` 默认只选 1 位；`open_floor` 保持 2 位上限
- 执行型 `meta_direct` 强制走 `_run_one_target_stream`
- 删除普通路径的用户可见 `group_nudge`；全员跳过时 Near 短接
- 成员 / Meta prompt 增加控制面答复契约
- 对执行型 FINAL 做“延迟承诺 / 无证据完成”收口
- pytest

## Out of scope

- 不改 `open_floor` 已实现的候选顺序、判重和 flags
- 不改 Workforce `_run_team_turn`
- 不改工具权限、confirm/clarify gate
- 不新增 SSE 类型
- 不改 Desktop
- 不负责群工作区和结构化产物（P2）
- 不实现多气泡 `group_say`

---

## FR-1：意图同时判断“谁答”和“要不要执行”

**Files:**

- Modify: `agenticx/runtime/group_router.py`，`IntentDecision` 定义、`_analyze_intent`
- Test: `tests/test_smoke_group_control_plane.py`

将数据结构扩成：

```python
@dataclass
class IntentDecision:
    action: str
    target_ids: list[str]
    reason: str = ""
    requires_execution: bool = False
```

意图 JSON 增加：

```json
{
  "action": "route_to | meta_direct | continue_thread | open_floor",
  "target_ids": ["avatar-id"],
  "requires_execution": true,
  "reason": "..."
}
```

prompt 规则写全：

- 创建、修改、运行、安装、下载、搜索核验、写文件、查仓库、生成产物 → `requires_execution=true`
- 解释概念、打招呼、观点讨论、读取已有上下文即可回答 → false
- 用户问“进度如何”本身不是新执行请求 → false
- 复杂多步任务仍在 `_analyze_intent` 前进入 Workforce，不靠该字段

增加纯函数兜底：

```python
def _looks_like_execution_request(text: str) -> bool:
    normalized = " ".join(str(text or "").lower().split())
    markers = (
        "帮我做", "去做", "实现", "修改", "修复", "创建", "新建", "写入",
        "保存", "落盘", "运行", "执行", "安装", "下载", "查仓库", "搜索并",
        "生成", "build", "implement", "fix", "create", "write", "run", "install",
    )
    return any(marker in normalized for marker in markers)
```

解析 JSON 缺失该字段时用纯函数结果；不要因为字段缺失让整个意图回退。

**AC:**

- “解释一下 MCP” → false
- “查仓库并修复这个 bug” → true
- LLM JSON 显式 false 时尊重 false，不被 marker 覆盖
- 旧三字段 JSON 仍可解析

---

## FR-2：收紧发言权

**Files:** Modify `agenticx/runtime/group_router.py:_run_intelligent_turn`

规则：

1. 显式点名：只保留 `explicit` 中的 targets；点名多人才允许多人。
2. `open_floor`：保持 `group_open_floor_max_speakers()`。
3. 普通 `route_to` / `continue_thread`：未点名时 `primary_targets[:1]`，不再 `[:2]`。
4. 成员回复中 @ 其他成员仍由 `_emit_mention_follow_ups` 接续，不改。
5. `responded_this_turn` 继续防同一成员一轮重复。

**AC:**

- 未点名专业问题只调用一个 `_run_one_target_stream`
- `@A @B` 可调用两位
- `open_floor` 最大人数不变
- A 回复里 @B 仍触发 B

---

## FR-3：执行型 `meta_direct` 必须进入 AgentRuntime

**Files:** Modify `agenticx/runtime/group_router.py:_run_intelligent_turn`

在 `decision.action == "meta_direct"` 分支：

```python
must_execute = bool(decision.requires_execution)
use_runtime = must_execute or group_meta_direct_tools_enabled()
```

- `use_runtime=true`：复用现有 `_run_one_target_stream(... avatar_id=META_LEADER_AGENT_ID, force_reply=True)`。
- false：继续 `_run_meta_project_manager_reply`。
- 不把 flag 默认改成 true；它仍是“所有 meta_direct 都允许工具”的人工回滚/实验开关。
- 执行型 prompt 追加：

```text
这是执行请求。你必须在本轮使用必要工具实际推进；FINAL 只能汇报本轮已经发生的事实。
禁止以“我去处理 / 稍等 / 等我回复 / 后续给你”结束本轮。
```

**AC:**

- flag false + `requires_execution=true` 仍调用 `_run_one_target_stream`
- flag false + 普通问答仍走 `_run_meta_project_manager_reply`
- flag true 保持既有“全部 meta_direct 可用工具”

---

## FR-4：执行证据门

**Files:** Modify `agenticx/runtime/group_router.py`; Test `tests/test_smoke_group_control_plane.py`

`GroupReply` 增加内部字段（无需 SSE 透传）：

```python
successful_tool_results: int = 0
```

`_run_one_target` 在事件循环前初始化 `successful_tool_results = 0`。增加纯函数：

```python
def _tool_result_succeeded(data: Mapping[str, Any]) -> bool:
    if data.get("success") is False:
        return False
    if str(data.get("error") or "").strip():
        return False
    return True
```

每个 `EventType.TOOL_RESULT` 且该函数为 true 时累加。构造最终 `GroupReply` 时写入字段。不要读取 `base_session.chat_history` 来判断本轮是否执行：成员 runtime 使用 `local_session`，owner history 的回写时机不适合作为本轮同步证据。

增加两个纯函数：

```python
def _looks_like_deferred_promise(text: str) -> bool: ...
def _looks_like_completion_claim(text: str) -> bool: ...
```

最低覆盖：

- deferred：`等我回复`、`稍等`、`我去处理`、`后续给你`、`完成后告诉你`
- completion：`已完成`、`已修复`、`已落地`、`已经写入`、`done`、`completed`

收口规则：

- `successful_tool_results > 0`：保留 FINAL。
- 为 P2 预留：后续 `reply.artifacts` 非空也视为有证据，使用 `bool(getattr(reply, "artifacts", None))`，字段不存在时自然为 false。
- 零证据 + deferred：替换为 `本轮没有产生实际执行记录，不能让你继续空等。请重试，或明确指定要执行的专家。`
- 零证据 + completion：在正文末尾追加 `\n\n（系统核验：本轮没有成功工具结果或产物记录，以上完成状态未被确认。）`
- 零证据 + 普通知识答案：保留，避免误伤无需工具的回答。

不要用模型再次判断，避免又一次幻觉。

**AC:**

- “等我回复”且零证据被替换
- “已修复”且零证据被标记未确认
- 有成功工具结果后“已修复”不追加警告
- 普通解释文本零证据不变

---

## FR-5：删除公开催人，保留静默兜底

**Files:** Modify `agenticx/runtime/group_router.py:_run_intelligent_turn`

删除 `nudge_text`、`context.append_agent(... nudge_text)`、`GroupReply(event_type="group_nudge")` 这一整段用户可见催促。

普通 `route_to` 全员跳过后：

1. 不再强制同一专家重跑一遍。
2. 调 `_run_meta_project_manager_reply` 短接。
3. extra instruction：

```text
被路由的成员没有提供有效回复。请只根据现有上下文给 1–2 句诚实兜底：
能答就直接答；不能答就说明当前缺少什么。不要催成员、不要描述路由过程、不要 @ 人。
```

保留 `group_nudge` 类型的历史兼容读取，不需要删除类型或前端分支；新代码不再产出。

**AC:**

- route target skip 后事件中没有 `group_nudge`
- Near 兜底不含“团长刚才的问题需要你”
- `group_skipped.content == ""`

---

## FR-6：统一控制面答复契约

**Files:** Modify `agenticx/runtime/group_router.py`

在成员 system prompt 和 `_run_meta_project_manager_reply` prompt 都加入同一段（提取成模块级常量或纯函数，禁止复制两份漂移）：

```text
## 群聊控制面答复
- 默认 1–3 句：先结论，再给产物或下一步；不要复述其他成员。
- 没有独特增量且未被用户点名时，内部输出 __SKIP__。
- 工具过程由系统状态卡展示，正文不要写“正在调用工具 / 已回答 / 等待追问”。
- 长代码、长报告、详细表格优先写入群工作区，最终只给摘要和产物；用户明确要求全文贴群时例外。
- FINAL 表示本轮结束，禁止以“稍等 / 等我回复 / 我去处理”作为 FINAL。
```

被用户明确点名但无增量时不得 skip，应短答“目前没有新增结论”并说明原因。

**AC:** fake runtime 捕获 prompt，断言成员与 Meta 均含以上关键句。

---

## 测试与验证

新增 `tests/test_smoke_group_control_plane.py`，至少覆盖：

1. 意图 execution 字段兼容
2. 普通 route 单人、显式多点名、open_floor 上限
3. meta execution 强制 runtime
4. 静默 skip
5. 无 `group_nudge`
6. deferred promise / completion evidence gate
7. 控制面 prompt

运行：

```bash
pytest tests/test_smoke_group_control_plane.py \
  tests/test_smoke_group_open_floor.py \
  tests/test_smoke_group_meta_direct_honesty.py \
  tests/test_smoke_group_a2a_graph_edges.py \
  tests/test_smoke_group_workforce_bridge.py -q
```

期望：全部 PASS。若 `test_smoke_group_workforce_bridge.py` 仍有已知 progress preview 旧断言失败，只能先确认是否与本 plan diff 无关，禁止顺手改 progress 文案。

手工：

- 问“解释一下当前架构” → 1 位短答，无工具
- 问“去仓库修复并跑测试” → 有头像工作态（P3 实施后）、真实工具记录、无“等我回复”
- 点名一位 → 其他人不启动
- 非点名候选跳过 → 无公开催人气泡

