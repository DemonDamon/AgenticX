# 口头查证开场白自动续跑

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Composer 2.5

> **For implementer:** 只改本 plan 列出的三个代码文件 + 两个测试文件。不要改 `agenticx/studio/server.py` 顶部 import，不要改 Desktop UI，不要改 provider / 网关，不要改消息行「重试」语义。

**Goal:** 模型只说「我先联网查证一下」却不发 `tool_calls` 时，运行时同一轮自动再调一次模型，逼它真正发出检索工具；若自动续跑仍失败，收口为 `deferred_action`（「恢复执行」），禁止当 `model_final`。

**Architecture:** 把「短开场白承诺查/搜但没动手」抽成 `truncated_final.is_search_deferral_stub`。`agent_runtime` 在无 `tool_calls` 时用它触发一次 `_search_deferral_retry_used` 续跑；`session_manager` Path F 用同一函数兜底，避免漏网回合被标成终局。

**Tech Stack:** 现有 Python runtime / pytest。无新依赖。

---

## 根因与证据（实施者不看对话也能判断）

会话 `bd943a7e-6d28-4d3f-91da-12f69f98c744` 新 run `d491b8fc38b44eb5b902abb191e4df58`：

- `had_tool_calls: false`，`finish_reason: stop`，`terminal_reason: model_final`
- 可见正文：`团长，我先联网查证一下，避免凭印象误导。`
- reasoning：`用户问 CowAgent 是哪个厂商的。我需要联网查证，不能编造。`
- 无 invoke XML，因此 `55f05814` 的正文 invoke 回收帮不上

现有检测为何漏：

- `ACTION_INTENT_RE`（`agenticx/runtime/truncated_final.py` L9–16）有 `我先` / `查一下` / `搜一下`，**没有** `查证` / `联网`
- Path A（`session_manager.py` L234–237）只在 **reasoning** 上跑 `ACTION_INTENT_RE`。本轮 reasoning 是「我需要联网查证」，对不上
- Path A 的 `_DEFERRAL_BODY_RE` 能命中正文「我先」，但缺 reasoning 命中，整条 Path A 不成立
- `_HANDOFF_BODY_RE` 不含「我先联网查证一下」
- `detect_suspected_truncated_final` 在正文以 `。` 收尾时直接返回 `""`（L106–107）
- `deferred_action` 即使命中也只在 `_finalize_chat_runtime` 插「恢复执行」卡，**不会**在 `agent_runtime` 循环里自动续跑

因此必须同时做两件事：同一函数识别该 stub；runtime 循环里自动 `continue` 再调一轮。

---

## In scope

- `is_search_deferral_stub` 纯函数 + 单测
- `session_manager._messages_last_turn_promised_action_without_followthrough` 增加 Path F
- `agent_runtime` 无 tool_calls 时对该 stub 自动续跑 1 次
- 每用户轮重置 `_search_deferral_retry_used`

## Out of scope

- 换模型 / 改网关 / 强迫 `tool_choice`
- Desktop 文案或「恢复执行」按钮 UI
- 改 `server.py` 顶部 import 或 `create_studio_app()`
- 流式 XML 闪现、消息行重试截断语义
- 重构 Path A–E 或扩大 `ACTION_INTENT_RE`（避免误伤 `detect_suspected_truncated_final`）

---

## 子规划 → 推荐模型

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| FR-1 检测函数 + 单测 | Composer 2.5 | 纯正则 + pytest |
| FR-2 Path F | Composer 2.5 | 现有函数加一段 |
| FR-3 runtime 续跑 | Composer 2.5 | 复制已有 `_inline_markup_retry_used` 分支 |

---

## FR-1: `is_search_deferral_stub`

**落点：** `agenticx/runtime/truncated_final.py`（`ACTION_INTENT_RE` 之后、`_LENGTH_FINISH_REASONS` 之前，约 L17）

**After 意图：**

```python
SEARCH_DEFER_STUB_MAX_CHARS = 220

_SEARCH_DEFER_STUB_RE = re.compile(
    r"(?:我先|让我先|我来|让我).{0,16}(?:联网|上网|搜索|检索|查证|查一下|搜一下|核实)"
    r"|先(?:去)?(?:联网|上网).{0,8}(?:查|搜)"
    r"|联网查证|上网[查搜]"
    r"|(?:need to|have to|i'?ll|let me).{0,28}(?:search|look\s*up|verify|check).{0,16}(?:web|online)?"
    r"|search\s+the\s+web",
    re.IGNORECASE,
)

_SEARCH_DEFER_ALREADY_DONE_RE = re.compile(r"(?:查|搜)了|(?:查|搜)到了?|结论是|厂商是")


def is_search_deferral_stub(*, visible_body: str, reasoning_text: str = "") -> bool:
    body = str(visible_body or "").strip()
    if not body or len(body) >= SEARCH_DEFER_STUB_MAX_CHARS:
        return False
    if _SEARCH_DEFER_ALREADY_DONE_RE.search(body):
        return False
    if _SEARCH_DEFER_STUB_RE.search(body):
        return True
    reasoning = str(reasoning_text or "").strip()
    if reasoning and _SEARCH_DEFER_STUB_RE.search(reasoning):
        return bool(re.search(r"我先|让我先|稍等|正在|马上|避免凭印象", body))
    return False
```

**Why：** 正文短开场白直接命中；reasoning 承诺查证 + 正文是等待语也命中；「查了/结论是」视为已经答完，避免误续跑。

**Test：** `tests/test_truncated_final_detector.py` 追加：

- `test_search_deferral_stub_live_session_wording`：正文 `团长，我先联网查证一下，避免凭印象误导。` → `True`
- `test_search_deferral_stub_reasoning_only_wait_body`：reasoning `我需要联网查证，不能编造。` + 正文 `团长，稍等。` → `True`
- `test_search_deferral_stub_already_answered`：`我先查了官网，结论是 Foo 厂商。` → `False`
- `test_search_deferral_stub_long_prose`：含「联网查证」但长度 ≥ 220 → `False`
- `test_search_deferral_stub_empty`：空正文 → `False`

先写测试、确认 FAIL（`is_search_deferral_stub` 未定义），再实现。

---

## FR-2: Path F（漏网不当终局）

**落点：** `agenticx/studio/session_manager.py`

1. L35–38 import 增加 `is_search_deferral_stub`（只加这一项，禁止整段替换 import）。
2. `_messages_last_turn_promised_action_without_followthrough` 在 Path E（约 L273–279）之后、`return False` 之前插入 Path F：

```python
    # Path F: short "I'll look it up" stub, no tool rows this turn.
    if not _turn_has_any_tool_row(tail) and is_search_deferral_stub(
        visible_body=body,
        reasoning_text=reasoning,
    ):
        return True
```

**Why：** runtime 续跑失败或旧会话收口时，`_finalize_chat_runtime` 已有 `deferred_action` 分支（`server.py` L540–549）会插「模型只回复了开场白…可点恢复执行」。本 FR 只让检测命中，不改 finalize。

**Test：** `tests/test_completeness_truth.py` 追加：

- `test_search_deferral_stub_without_tool_calls_is_deferred`：user + assistant（正文即 live wording，无 tool_calls）→ `_messages_last_turn_promised_action_without_followthrough` is `True`
- `test_search_deferral_stub_negative_when_tools_follow`：同上但末尾有 `role=tool` → `False`
- 现有 Path E invoke 用例必须继续绿

---

## FR-3: runtime 同一轮自动续跑

**落点：** `agenticx/runtime/agent_runtime.py`

1. L78 import 改为同时导入 `is_search_deferral_stub`（精确改这一行，不要动相邻 import）。
2. `run()` 入口、L3797 `setattr(session, "_empty_tool_calls_retry_used", False)` **下一行**增加：

```python
        setattr(session, "_search_deferral_retry_used", False)
```

每用户轮最多自动续跑 1 次。

3. 在 `unparsed_inline_tool_markup` 分支（L5226–5257）之后、`empty_tool_calls_with_tool_finish` 分支（L5260）之前插入：

```python
            if (
                not tool_calls
                and is_search_deferral_stub(
                    visible_body=ac_clean,
                    reasoning_text=(parsed.reasoning or _nonstream_reasoning or ""),
                )
                and not getattr(session, "_search_deferral_retry_used", False)
            ):
                setattr(session, "_search_deferral_retry_used", True)
                hint = (
                    "[系统通知] 上一轮只回复了「先查证/先搜索」的开场白，没有发出任何 tool_call。"
                    "请立即用原生 function calling 调用合适的检索工具（例如 web_search），"
                    "拿到结果后再回答用户；不要再次只说要去查。"
                )
                visible = str(ac_clean or "").strip() or " "
                messages.append({"role": "assistant", "content": visible})
                messages.append({"role": "system", "content": hint})
                session.agent_messages.append({"role": "assistant", "content": visible})
                session.agent_messages.append({"role": "system", "content": hint})
                logger.info(
                    "search_deferral_stub session=%s round=%s",
                    getattr(session, "session_id", ""),
                    round_idx,
                )
                yield RuntimeEvent(
                    type=EventType.ROUND_END.value,
                    data={
                        "round": round_idx,
                        "max_rounds": self.max_tool_rounds,
                        "auto_retry": True,
                        "reason": "search_deferral_stub",
                    },
                    agent_id=agent_id,
                )
                continue
```

结构必须与 L5226–5257 的 markup retry 一致：`continue` 回到循环顶再调模型。不要把开场白当 `model_final` persist。

**Test：** 不要新造完整 `AgentRuntime` mock。纯函数覆盖检测即可。若仓库已有现成 runtime loop harness 且一行能挂上 `reason == "search_deferral_stub"`，可加；没有就不要造。

---

## AC（实施者自测）

```bash
python -m pytest \
  tests/test_truncated_final_detector.py \
  tests/test_completeness_truth.py \
  tests/test_deferred_action_reasoning_field.py \
  -q
```

- AC-1：`test_search_deferral_stub_live_session_wording` 绿
- AC-2：`test_search_deferral_stub_without_tool_calls_is_deferred` 绿
- AC-3：已答完 / 长文 / 已有 tool 行三条负例绿
- AC-4：旧 invoke Path E 与 `test_deferred_action_reasoning_field.py` 仍绿
- AC-5（手工）：同一句「X 是哪个厂商」，弱 FC 模型再说「我先联网查证一下」后，同轮必须出现 `web_search`（或其它检索）工具卡并继续作答；不能停在开场白且 `terminal_reason=model_final`

---

## no-scope-creep 边界

每个改动必须能追溯到 FR-1 / FR-2 / FR-3。禁止顺手扩大 `ACTION_INTENT_RE`、禁止改 Desktop、禁止改 `server.py` import、禁止改消息重试。
