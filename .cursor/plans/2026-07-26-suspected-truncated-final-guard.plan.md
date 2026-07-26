# 终局体检：跨模型「截断式假终局」自动续跑与可见兜底

Planned-with: claude-opus-5-thinking
Suggested-Impl-Model: gpt-5.6-terra-medium（跨 Python runtime + 前端、序列敏感、误报代价高，需强推理档收口；纯前端文案子项可下放 composer-2.5-fast）

## 背景与根因（证据链，实施者无需回看对话即可自证）

### 症状
会话 `d1402306-a441-41e2-9080-e351bc93eef9` 最后一轮，用户要求核实一条关于模型发布日期/定价的说法。助手只输出 23 字 `团长，这条信息涉及具体发布日期、定价和竞品对比` 就结束，未调用任何工具，UI 无任何异常提示，用户误以为已答完。

### 落盘事实（复现路径）
`~/.agenticx/sessions/d1402306-a441-41e2-9080-e351bc93eef9/messages.json` 最后一条 assistant 行：
- `content` = `团长，这条信息涉及具体发布日期、定价和竞品对比`（23 字，无句末标点）
- `metadata.turn_terminal` = `true`，`metadata.terminal_reason` = `"model_final"`
- `metadata.model_finish_reason` **缺失**
- `reasoning` 字段（独立于 content）= `... I need to search the web to verify this. Let me do that.`
- 该轮无 `role=tool` 行，`executed_tool_names` 为空

即：模型在 reasoning 里明确声明要搜索，正文只吐出一句开场白就断流，runtime 把它当成**成功终局**落盘。

### 根因 1（主因）：终局判据过宽，与模型无关
`agenticx/runtime/agent_runtime.py:4184-4208`：终局分支只判断 `clean_body` 是否为空。
- 空 → `empty_response_fallback` 等兜底
- **非空 → 无条件 `terminal_reason = "model_final"`**

没有任何一处检查「正文是否看起来被截断」。同文件 `4049-4074` 的 reasoning-only 守卫要求 `not parsed.visible_body.strip()`，本例正文非空，直接绕过。

### 根因 2：`finish_reason` 既不可靠也未被消费
所有 provider 的 `stream_with_tools` 都是「累积 `last_finish_reason`，结束时发一个 `{"type":"done","finish_reason": last_finish_reason}`」
（`litellm_provider.py:383/417-419/460`、`kimi_provider.py:350/419`、`ark_provider.py:493/561`、`bailian_provider.py:423/488` 与 `541/625`）。
上游中途断流或不回传 finish_reason 时，该值是**空串**，而除了 `_recover_public_completion_from_reasoning`（`agent_runtime.py:1607/1617-1619`）用它挡 `length` 之外，无任何一处检查空值。

`agent_runtime.py:4277-4282` 更把它**仅在非空时**写进 metadata，导致事后无法区分「上游没给」和「字段丢了」。

### 根因 3：`deferred_action` 检测整条 Path A 是死代码
`agenticx/studio/session_manager.py:211` 用 `_extract_assistant_reasoning(content)` 从 content 的 `<think>` 里抽 reasoning。
但 `agent_runtime.py:2351-2359` 写盘时 **content 只放正文、reasoning 放在独立 `reasoning` 键**。
⇒ 对 runtime 产出的每一条终局行，`_extract_assistant_reasoning` 恒返回 `""`，Path A（`:215-219`）永不触发。

### 根因 4：意图正则只有中文
`session_manager.py:142-145` `_REASONING_ACTION_INTENT_RE` = `让我先|我先|接下来要|然后加载|然后调用|去读取|去加载|todo_write`。
本例模型用英文思考（`I need to search the web… Let me do that.`），必然漏检。

### 为什么必须做通用守卫而非给 glm-5.2 打补丁（跨模型证据）
扫描 `~/.agenticx/sessions/*/messages.json` 全部 94 条 `turn_terminal` 行，「正文无句末终止符」的疑似截断跨 5 个厂商：
MiniMax-M3、zhipu/glm-4.6v、kimi-k2.6、glm-5.2、zhipu/glm-4.7。
根因在 runtime 收口判据，换模型只改变触发概率。

### 已验证的判据反例（避免实施者写出误报逻辑）
同一批扫描数据表明，下列单一信号**都不能单独作为判据**：
- `model_finish_reason` 缺失：76 条 `model_final` 中 **50 条**缺失（66%），单用会大面积误报
- 「正文无句末终止符」：94 条中 **15 条**命中（16%），其中多条是正常收尾（以文件名、`-->`、`ok`、行内代码结尾）

必须**组合判据**。按下文 FR-1 的组合条件回放同一批数据，命中 3 条，全部为真实截断。

## In scope / Out of scope

**In scope**
- 新增共享判据模块 `agenticx/runtime/truncated_final.py`
- `agent_runtime.py`：终局前插入一次自动续跑守卫；新增 `suspected_truncated_final` 终局态；`model_finish_reason` 无条件写盘
- `session_manager.py`：修 reasoning 取值源；意图正则补英文；新增 Path E 复用共享判据
- `turn_interruption.py`：新增 `suspected_truncated_final` cause 文案
- `server.py::_finalize_chat_runtime`：识别新终局态并追加可见通知
- 前端：`turn-interruption-notice.ts` 类型放行 + `TurnInterruptionNoticeLine.tsx` 文案分支

**Out of scope（禁止顺手改）**
- 不改任何 provider 的 `stream_with_tools` / 流式解析
- 不改 `_recover_public_completion_from_reasoning`、`parse_assistant_output`、`stall_policy.py`
- 不改超时/心跳参数（`invoke_timeout_seconds` / `heartbeat_timeout_seconds` / `hard_timeout_seconds`）
- 不改 `_REASONING_ONLY_NUDGE_HINT` 既有 reasoning-only 分支的行为
- 不动 `agenticx/studio/server.py` 顶部 import 区块（见 AGENTS.md 该文件的强制约束）

## 需求

### FR-1 共享判据模块（单一事实来源）

新建 `agenticx/runtime/truncated_final.py`：

```python
"""Model-agnostic detection of truncated-looking terminal replies."""
from __future__ import annotations
import re
from typing import Sequence

# 句末终止符。注意：… 与 : ： , ， ; ； 、 — 均视为「未结束」，不得列入。
_TERMINATOR_RE = re.compile(r"[。！？.!?)）」』】”’\"'`*]$")

# 双语行动意图。中文沿用 session_manager 既有词表并补齐搜索/核实类动词。
_ACTION_INTENT_RE = re.compile(
    r"让我先|我先|接下来要|然后加载|然后调用|去读取|去加载|去搜索|去查|查一下|搜一下|核实|todo_write"
    r"|let me\s+(?:search|check|verify|look|find|do that|try)"
    r"|i\s+(?:need|have)\s+to\s+(?:search|check|verify|look|find)"
    r"|i'?ll\s+(?:search|check|verify|look|find)"
    r"|search\s+the\s+web|verify\s+this|let'?s\s+search",
    re.IGNORECASE,
)

SUSPECT_BODY_MAX_CHARS = 80
_SUSPECT_FINISH_REASONS = frozenset({"", "length", "max_tokens", "token_limit", "content_filter"})


def detect_suspected_truncated_final(
    *,
    visible_body: str,
    reasoning_text: str,
    had_tool_calls_this_round: bool,
    executed_tool_names: Sequence[str],
    finish_reason: str,
) -> str:
    """Return a non-empty signal name when the terminal reply looks truncated.

    All conditions must hold (组合判据，单一信号误报率已实测过高):
      1. 本轮没有 tool_calls
      2. 整个用户轮没有任何工具真的跑过
      3. 正文非空且 <= SUSPECT_BODY_MAX_CHARS
      4. 正文不以句末终止符结尾
      5. reasoning 声明了行动意图，或 finish_reason 属可疑集合
    """
    if had_tool_calls_this_round:
        return ""
    if executed_tool_names:
        return ""
    body = str(visible_body or "").strip()
    if not body or len(body) > SUSPECT_BODY_MAX_CHARS:
        return ""
    if _TERMINATOR_RE.search(body):
        return ""
    if _ACTION_INTENT_RE.search(str(reasoning_text or "")):
        return "short_unterminated_with_intent"
    if str(finish_reason or "").strip().lower() in _SUSPECT_FINISH_REASONS:
        return "short_unterminated_suspect_finish_reason"
    return ""
```

**AC-1**：新增 `tests/test_truncated_final_detector.py`
- 命中：`visible_body="团长，这条信息涉及具体发布日期、定价和竞品对比"`，`reasoning_text="I need to search the web to verify this. Let me do that."`，`had_tool_calls_this_round=False`，`executed_tool_names=[]`，`finish_reason=""` → 返回 `"short_unterminated_with_intent"`
- 不命中（长度）：正文 200 字无标点 → `""`
- 不命中（有终止符）：`"好的，我已经处理完了。"` → `""`
- 不命中（跑过工具）：`executed_tool_names=["web_search"]` → `""`
- 不命中（有 tool_calls）：`had_tool_calls_this_round=True` → `""`
- 不命中（无意图且 finish_reason=stop）：`reasoning_text=""`，`finish_reason="stop"`，短正文无标点 → `""`
- 命中（无意图但 finish_reason 空）：`reasoning_text=""`，`finish_reason=""` → `"short_unterminated_suspect_finish_reason"`
- 边界：正文以 `…` 结尾且有意图 → 命中（`…` 不是终止符）

### FR-2 runtime 自动续跑一次

`agenticx/runtime/agent_runtime.py`：

1. 在 `_REASONING_ONLY_NUDGE_HINT`（`:1799`）之后新增：
```python
_TRUNCATED_FINAL_NUDGE_HINT = (
    "[runtime] 你上一条回复似乎在中途被截断：正文很短、没有结束标记，"
    "而你的思考表明还需要继续执行（例如调用工具核实信息）。"
    "请直接继续完成这一轮：如需工具就发起 tool_call，否则输出完整的最终回答。"
    "不要复述已经说过的开场白，不要向用户解释本条提示。"
)
```

2. 在 `reason_only_retry = 0`（`:2736`）旁新增 `truncated_final_retry = 0`。

3. 在 reasoning-only 守卫的 `continue`（`:4074`）**之后**、`if (authoritative_source_kind == "sync_fallback" ...)`（`:4076`）**之前**插入第二个守卫。行为对齐 reasoning-only 分支的消息编排：assistant_message 已在 `:4046` 入 `session.agent_messages`，因此**只需**把它复制进 `messages`，再把 system 提示同时追加到 `messages` 与 `session.agent_messages`，然后 `continue`。

```python
                if not _is_system_trigger and truncated_final_retry < 1:
                    _trunc_signal = detect_suspected_truncated_final(
                        visible_body=parsed.visible_body,
                        reasoning_text=str(reasoning_for_tool_call or ""),
                        had_tool_calls_this_round=bool(tool_calls),
                        executed_tool_names=executed_tool_names,
                        finish_reason=model_finish_reason,
                    )
                    if _trunc_signal:
                        truncated_final_retry += 1
                        suspected_truncated_signal = _trunc_signal
                        logger.warning(
                            "truncated_final_retry session=%s round=%s signal=%s "
                            "body_len=%s finish_reason=%s",
                            getattr(session, "session_id", ""),
                            round_idx,
                            _trunc_signal,
                            len(parsed.visible_body.strip()),
                            model_finish_reason or "unknown",
                        )
                        messages.append(dict(assistant_message))
                        messages.append({"role": "system", "content": _TRUNCATED_FINAL_NUDGE_HINT})
                        session.agent_messages.append(
                            {"role": "system", "content": _TRUNCATED_FINAL_NUDGE_HINT}
                        )
                        synced_session_message_count = len(session.agent_messages)
                        continue
```

`suspected_truncated_signal: str = ""` 与 `truncated_final_retry` 同处初始化（`:2736` 附近）。
`detect_suspected_truncated_final` 按 `no-inline-imports` 规则在文件顶部 import 区导入。

**注意**：此处 `parsed`/`tool_calls`/`reasoning_for_tool_call`/`model_finish_reason`/`executed_tool_names` 均已在作用域内（分别见 `:3919`、`:3922`、`:4036`、以及终局分支对 `model_finish_reason` 的引用 `:4223`）。若 `model_finish_reason` 在该行尚未赋值，改为读取当轮 `_response_finish_reason(response)` 的既有变量，**不得**新增一次 provider 调用。

**AC-2**：新增 `tests/test_suspected_truncated_final_retry.py`，用桩 LLM（参考 `tests/test_reasoning_only_turn_retry.py` 的桩写法）：
- 第 1 轮返回短截断正文 + 含英文搜索意图的 reasoning、无 tool_calls、finish_reason 空；第 2 轮返回完整回答
  → 断言最终 FINAL 文本为第 2 轮内容；断言日志或 metadata 体现发生过一次续跑；断言**只**续跑一次
- 第 1、2 轮都返回同样的短截断正文 → 断言最终 `terminal_reason == "suspected_truncated_final"`（见 FR-3）且未进入第 3 轮

### FR-3 新终局态 + 无条件写 finish_reason

`agent_runtime.py:4200-4208`，在 `else` 分支决定 `terminal_reason` 时，若 `suspected_truncated_signal` 非空且本轮仍判定为截断，则用 `"suspected_truncated_final"` 取代 `"model_final"`：

```python
                else:
                    if reasoning_field_final_recovered:
                        terminal_reason = "reasoning_field_final_recovered"
                    elif parsed.malformed:
                        terminal_reason = "malformed_model_final_recovered"
                    elif suspected_truncated_signal and detect_suspected_truncated_final(
                        visible_body=clean_body,
                        reasoning_text=reasoning_text,
                        had_tool_calls_this_round=False,
                        executed_tool_names=executed_tool_names,
                        finish_reason=model_finish_reason,
                    ):
                        terminal_reason = "suspected_truncated_final"
                    else:
                        terminal_reason = "model_final"
```

即：**只有续跑过一次仍然像截断**才落这个态；续跑成功则回到 `model_final`，用户无感。

`terminal_metadata`（`:4277-4300`）改为无条件写入观测字段：
- `"model_finish_reason": model_finish_reason or "unknown"`（移除「仅非空才写」的条件写法，保留原有 fallback 分支不变）
- 新增 `"body_len": len((clean_body or "").strip())`
- 新增 `"had_tool_calls": bool(executed_tool_names)`
- 当 `terminal_reason == "suspected_truncated_final"` 时追加 `"truncation_signal": suspected_truncated_signal`

**兼容性已核查**：全仓 `terminal_reason == "model_final"` 只有两处使用——`agent_runtime.py:2318`（malformed 降级）与 `:4210`（日志分支），新增枚举值不影响两者语义；新值会自然进入 `:4210` 的 warning 日志，符合预期。

**AC-3**：`tests/test_suspected_truncated_final_retry.py` 断言持久化行的 `metadata` 同时含 `model_finish_reason`、`body_len`、`had_tool_calls`；正常 `model_final` 轮也含这三个字段（`model_finish_reason` 为 `"stop"` 或 `"unknown"`）。

### FR-4 修复 deferred_action 的两个确证缺陷 + Path E

`agenticx/studio/session_manager.py`：

1. `:211` 的 reasoning 取值改为优先读独立字段，回退旧路径：
```python
    reasoning = str(last.get("reasoning") or "").strip() or _extract_assistant_reasoning(content)
```

2. `_REASONING_ACTION_INTENT_RE`（`:142-145`）删除，改为复用 FR-1 的 `_ACTION_INTENT_RE`（从 `agenticx.runtime.truncated_final` 导出并 import），避免两处词表漂移。若不便导出，则在 `truncated_final.py` 中额外 `export` 一个 `ACTION_INTENT_RE` 公开别名。

3. 在 Path D（`:231-241`）之后、`return False`（`:243`）之前新增 Path E，复用共享判据兜住「短截断 + 意图」这类既不匹配 `_DEFERRAL_BODY_RE` 也不以特定标点结尾的情形（本 bug 正属此类）：
```python
    # Path E: short truncated-looking body with declared action intent (bilingual).
    if not _turn_has_any_tool_row(tail) and detect_suspected_truncated_final(
        visible_body=body,
        reasoning_text=reasoning,
        had_tool_calls_this_round=False,
        executed_tool_names=[],
        finish_reason=str((last.get("metadata") or {}).get("model_finish_reason") or ""),
    ):
        return True
```

**AC-4**：新增 `tests/test_deferred_action_reasoning_field.py`
- 构造 messages：`[{"role":"user",...}, {"role":"assistant","content":"团长，这条信息涉及具体发布日期、定价和竞品对比","reasoning":"I need to search the web to verify this. Let me do that.","metadata":{"turn_terminal":True,"terminal_reason":"suspected_truncated_final"}}]`
  → `_messages_last_turn_promised_action_without_followthrough(...)` 返回 `True`
- 回归：`tests/test_stall_policy_deferred_handoff.py` 与 `tests/test_chat_turn_interruption_notice.py` 全绿（确认既有 Path A–D 行为未退化）
- 反例：正常长回答（>80 字、以句号结尾、无意图）→ 返回 `False`

### FR-5 可见兜底通知

1. `agenticx/studio/turn_interruption.py:10-18` `_CAUSE_MESSAGES` 新增：
```python
    "suspected_truncated_final": "这条回答似乎没有说完（模型提前结束了本轮）。可点「继续」补全。",
```

2. `agenticx/studio/server.py::_finalize_chat_runtime`（`:490-519`）：在 `deferred_action` 计算之后新增同级判定，**镜像既有 deferred_action 写法**，禁止改动既有分支结构：
```python
    suspected_truncated = saw_final and _last_terminal_reason_is_suspected_truncated(history)
    ...
    if deferred_action:
        append_turn_interruption_notice(session, cause="deferred_action", saw_final=False)
    elif suspected_truncated:
        append_turn_interruption_notice(session, cause="suspected_truncated_final", saw_final=False)
    elif not saw_final and cause is None:
        ...
    effective_saw_final = saw_final and not deferred_action and not suspected_truncated
```
`_last_terminal_reason_is_suspected_truncated(history)` 为本文件内新增小函数：取最后一条 `role == "assistant"` 行，判断 `metadata.terminal_reason == "suspected_truncated_final"`。

**约束**：本文件顶部 import 区块**一行都不许动**（AGENTS.md 明确记录过 `d8428b73` 误删 `GroupChatRegistry` 导致 `agx serve` 冷启动崩溃）。所需 helper 就地定义在 `_finalize_chat_runtime` 上方。

**AC-5**：
- 新增 `tests/test_chat_suspected_truncated_notice.py`：session 的 chat_history 末条 assistant 带 `terminal_reason="suspected_truncated_final"` 时，`_finalize_chat_runtime` 后 history 末尾出现 `role="tool"`、`metadata.kind="turn_interrupted"`、`metadata.cause="suspected_truncated_final"` 的行，且 `execution_state` 为 `interrupted`
- **强制门槛**：改过 `server.py` 后必须跑一次冷启动验证 `agx serve --host 127.0.0.1 --port 65321`，确认进程不崩溃且 `/api/session`、`/api/avatars`、`/api/sessions` 返回 200（用 `curl --noproxy '*'`），仅 diff 语义正确不算完成

### FR-6 前端文案与按钮

1. `desktop/src/utils/turn-interruption-notice.ts`
   - `TurnInterruptionCause` union（`:3-10`）新增 `| "suspected_truncated_final"`
   - `parseTurnInterruptionNotice` 的 causeRaw 白名单（`:40-46`）新增 `|| causeRaw === "suspected_truncated_final"`
   - `isTurnInterruptionNoticeMessage` **不改**：后端已写 `metadata.kind`，第一条判定即命中

2. `desktop/src/components/messages/TurnInterruptionNoticeLine.tsx`
   - `:21-30` 的分支链新增：
```tsx
  } else if (cause === "suspected_truncated_final") {
    text = "这条回答似乎没有说完";
```
   - 按钮文案按 cause 区分：`suspected_truncated_final` 用「继续」/「继续中…」，其余保持「恢复执行」/「恢复中…」，`aria-label` 同步

**AC-6**：
- 新增/扩展 `desktop/src/utils/turn-interruption-notice.test.ts` 用例：`metadata={kind:"turn_interrupted",cause:"suspected_truncated_final"}` 的 tool 行 → `parseTurnInterruptionNotice` 返回 `cause === "suspected_truncated_final"`（不回落 `"unknown"`）
- `cd desktop && npx tsc --noEmit` 通过；`npm test` 相关用例绿

## 验收总门槛

1. `python3 -m pytest tests/test_truncated_final_detector.py tests/test_suspected_truncated_final_retry.py tests/test_deferred_action_reasoning_field.py tests/test_chat_suspected_truncated_notice.py -q` 全绿
2. 回归：`python3 -m pytest tests/test_reasoning_only_turn_retry.py tests/test_stall_policy_deferred_handoff.py tests/test_chat_turn_interruption_notice.py tests/test_interruption.py tests/test_completeness_truth.py tests/test_smoke_streaming_tool_truncation.py -q` 全绿
3. `agx serve` 冷启动 smoke 通过（FR-5 强制门槛）
4. `cd desktop && npx tsc --noEmit` 通过
5. 误报回放：写一次性脚本按 FR-1 判据回放 `~/.agenticx/sessions/*/messages.json` 全部 `turn_terminal` 行，命中数应为 **3**（`d55e8f7a`、`d1402306`、`3ad013e9` 各一条短截断行）。若命中数显著上升，说明判据被放宽，必须收紧后再提交；脚本不入库

## 提交切分

建议两个 commit，同一 Plan-Id：
1. `feat(runtime): 截断式假终局的自动续跑与终局态` — FR-1 / FR-2 / FR-3 / FR-4 + 对应测试
2. `feat(desktop): 未说完回答的可见「继续」入口` — FR-5 / FR-6 + 对应测试

Trailer：`Plan-Id` / `Plan-File` / `Plan-Model` / `Impl-Model` / `Made-with: Damon Li`。
`Impl-Model` 由用户确认后填写，不得编造。
