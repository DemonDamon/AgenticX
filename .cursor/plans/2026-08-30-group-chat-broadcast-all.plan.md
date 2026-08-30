# 群聊「各自/全员」广播发言

Planned-with: grok 4.6
Suggested-Impl-Model: grok 4.6

> **For implementer:** 只改本 plan 列出的文件。**不要碰** `agenticx/studio/server.py`、`desktop/`。不新增 SSE 事件类型。不要 commit，除非用户明确要求。

**Goal:** 用户说「各自介绍一下自己」这类明确全员要求时，群里每位成员都要亲自回答，不再被 `open_floor` 默认 2 人上限裁掉。

**Architecture:** 在 `_run_intelligent_turn` 用确定性关键词识别 `broadcast_all`，优先级高于 `open_floor` / 意图 LLM，低于显式 `@` 点名。命中后按成员列表**顺序**上场，`force_reply=True`，不受 `group_open_floor_max_speakers()` 限制。成员数 `> 8` 时本轮只由 Near 确认，用户回「继续/全员」后再全员发言。

**Tech Stack:** Python 3.10（`agenticx/runtime/group_router.py`）+ pytest（`tests/test_smoke_group_broadcast_all.py`）。

---

## 规划模型建议

| 子任务 | 推荐模型 | 理由 |
|---|---|---|
| 启发式 + `_run_intelligent_turn` 分支 | grok 4.6 | 默认群聊主路径，early-return 顺序敏感 |
| smoke 测试 | Composer 2.5 | 照抄 `tests/test_smoke_group_open_floor.py` stub |

Suggested-Impl-Model: grok 4.6

---

## In scope

- 新增 `_is_broadcast_all_request` / `_is_broadcast_all_affirmation` / 阈值常量
- `_run_intelligent_turn` 在 Workforce 之后、open-call 之前插入 `broadcast_all` 分支
- 大群（`len(valid_members) > 8`）确认门：scratchpad `group_broadcast_pending::{group_id}`
- `_analyze_intent` prompt 补一行：全员要求不要判成 `open_floor`（兜底，主路径不依赖 LLM）
- 新增 `tests/test_smoke_group_broadcast_all.py`

## Out of scope / no-scope-creep

- 不改 `open_floor` 默认 2、clamp 1..3
- 不改 `route_to` / `continue_thread` / `meta_direct` / open-call / Workforce 行为
- 不加 Desktop 设置项、不加 `harden_flags` 新开关
- 不把 Meta 算进「全员成员」（只遍历 `group_avatar_ids`）
- 不并行叫醒
- 不改 `server.py` / `desktop/`

---

## 根因（本场证据）

会话 `78b4988c-2631-43f0-b092-e45e8fec345e`，群 `620b8d5844dd`（4 成员，`routing: intelligent`）。用户「各自介绍一下自己」无 `@`。智能路由把寒暄判成 `open_floor`，`group_open_floor_max_speakers()` 默认 2，图谱只有 `你→oo`、`你→安全·司南`。飞坦 / 后端·北辰从未被邀请。

---

## FR / AC

- **FR-1:** 「各自介绍一下自己」无 `@` 时 4 位成员全部顺序上场，且 `force_reply=True`
- **AC-1:** `tests/test_smoke_group_broadcast_all.py::test_broadcast_all_invites_every_member`
- **FR-2:** 不受 open_floor 2 人上限
- **AC-2:** `test_broadcast_all_ignores_open_floor_cap`
- **FR-3:** 显式 `@` 点名优先，不走全员
- **AC-3:** `test_explicit_mention_skips_broadcast_all`
- **FR-4:** 成员 `> 8` 本轮只 Near 确认；「继续」后用**原句**全员发言
- **AC-4:** `test_large_group_asks_before_broadcast` + `test_large_group_affirmation_runs_original_prompt`
- **FR-5:** 用户中途停止后未上场成员不再调用
- **AC-5:** `test_broadcast_all_honors_should_stop`
- **FR-6:** 启发式命中/不命中钉死
- **AC-6:** `test_broadcast_all_heuristic_matches` / `test_broadcast_all_heuristic_skips`

---

## 落点与 before/after

### 1. 启发式（`agenticx/runtime/group_router.py`，紧挨 `_OPEN_CALL_MARKERS_CN` / `_is_open_call_question` 之后）

```python
_BROADCAST_ALL_ASK_THRESHOLD = 8
_BROADCAST_ALL_PENDING_PREFIX = "group_broadcast_pending::"

_BROADCAST_ALL_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"各自.{0,8}(介绍|自我介绍|说|回答|发言)"),
    re.compile(r"(每个人|每位).{0,8}(介绍|回答|说说|说一下|发言)"),
    re.compile(r"(所有人|全员).{0,8}(介绍|回答|说说|说一下|发言|都)"),
    re.compile(r"都(回答|说说|介绍|说一下|发言)"),
    re.compile(r"(逐个|依次|轮流).{0,8}(介绍|说|回答|发言)"),
)

def _is_broadcast_all_request(user_input: str) -> bool:
    text = (user_input or "").strip()
    if not text:
        return False
    return any(p.search(text) for p in _BROADCAST_ALL_PATTERNS)

def _is_broadcast_all_affirmation(user_input: str) -> bool:
    text = re.sub(r"[\s，,。！!？?、；;：:]+$", "", (user_input or "").strip())
    return text.casefold() in {
        "是", "好", "行", "要", "可以", "确认", "继续", "全员",
        "好的", "是的", "继续吧", "全员发言", "都介绍", "开始",
        "ok", "yes",
    }
```

「大家好怎么看」不得命中。`各自介绍一下自己` 必须命中。

### 2. `_run_intelligent_turn`（约 L1934 取出 `explicit_member_mentions` 之后；Workforce 块之后、open-call 之前，约 L1958）

伪代码：

```python
pad = session.scratchpad  # 没有则建 dict
key = f"{_BROADCAST_ALL_PENDING_PREFIX}{group_id}"
pending = pad.get(key) if isinstance(pad.get(key), dict) else None

if not explicit_member_mentions:
    if pending and (_is_broadcast_all_affirmation(user_input) or _is_broadcast_all_request(user_input)):
        pad.pop(key, None)
        src = pending if _is_broadcast_all_affirmation(user_input) and not _is_broadcast_all_request(user_input) else None
        async for e in self._run_broadcast_all_members(..., user_input=src["user_input"] if src else user_input, ...):
            yield e
        return
    if pending:
        pad.pop(key, None)
    if _is_broadcast_all_request(user_input):
        if len(valid_members) > _BROADCAST_ALL_ASK_THRESHOLD:
            pad[key] = {"user_input": user_input, "quoted_content": quoted_content}
            # Near 固定文案确认，append_agent + group_reply，不叫醒成员
            return
        async for e in self._run_broadcast_all_members(...):
            yield e
        return
```

确认文案（固定，不走 LLM）：

`这轮是全员回答。当前群有 N 位成员，一次全部开口会比较长。确认的话回复「继续」或「全员」，我再按顺序请每位成员发言。`

### 3. `_run_broadcast_all_members`（新方法，放在 `_run_intelligent_turn` 正上方）

复用 `open_floor` 顺序循环（`group_router.py` L2151–2224），差异：

- `candidates = list(valid_members)`，**不要** `[: group_open_floor_max_speakers()]`
- `force_reply=True`
- `extra_instruction`：`用户明确要求群里每位成员亲自回答。请用你自己的身份作答，禁止输出 __SKIP__，不要替其他成员发言。`
- 每位上场前 `await self._should_stop`，命中则 `return`
- 保留 H2A fan-out、typing、`_record_turn_response`、`_emit_mention_follow_ups`
- 不需要「全员跳过 → 组长闲聊短接」（force 后仍跳过也不补 open_floor 圆场，避免和全员语义打架）

### 4. `_analyze_intent` prompt（约 L1413）

在 open_floor 规则旁加一行：

`- 用户明确要求各自 / 每个人 / 所有人 / 全员 / 都回答 / 依次发言 => 不要判 open_floor（系统会走全员分支）。`

---

## 测试文件

新建 `tests/test_smoke_group_broadcast_all.py`，helper 照抄 `tests/test_smoke_group_open_floor.py` 的 `_make_router_with_spies` / `_install_turn_stubs` / `_collect_turn`（`_collect_turn` 需能传 `mentioned_avatar_ids`、`should_stop`、读 `session.scratchpad`）。

跑：

```bash
python -m pytest tests/test_smoke_group_broadcast_all.py tests/test_smoke_group_open_floor.py -q
```

open_floor 既有用例必须仍绿。
