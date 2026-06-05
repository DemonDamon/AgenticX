---
name: interrupted-turn-finalize-and-completeness-truth
overview: 根治「切走/中断导致最后一轮 assistant 未 finalize 落盘（messages.json 只剩半截未闭合 <think>，无正文），切回 A 后整段回答消失，且因前后端『完成』口径不一致（后端按原始 content 非空算完成→idle，前端剥 <think> 后无正文→Channel C 报停滞）出现『元数据 idle 却 UI 处理中/已停滞』的矛盾态」。本 plan 为后端主导的根因 B 修复：①中断/断连时在服务层把已流式产生的 partial assistant 文本 finalize 落盘；②统一前后端『最后一轮是否有完成回复』的单一口径（剥 <think> 后需有正文或终态标记）。
todos:
  - id: p0-strip-think-helper
    content: 后端新增 _visible_assistant_body() helper（剥 <think>...</think> 及未闭合 <think> 尾部），并补 pytest 纯函数用例
    status: completed
  - id: p0-completeness-align
    content: _last_turn_has_completed_reply 改用 _visible_assistant_body 判定（剥 think 后有正文 / 或有 suggested_questions / </followups> 终态标记），与前端 lastTurnHasCompletedAssistantReply 对齐
    status: completed
  - id: p0-finalize-partial-on-cancel
    content: 服务层 _event_stream 累计 meta assistant 流式文本；client 断连/中断且未 saw_final 时，将清洗后的 partial 作为终态 assistant 轮次 finalize 落盘（metadata.source=interrupted-partial），再 persist_async
    status: completed
  - id: tests
    content: pytest 覆盖 completeness 口径与 partial finalize 路径；python AST/语法 OK；改动文件无 lint
    status: completed
isProject: false
---

# 中断轮次 finalize 落盘 + 前后端「完成」口径单一化（P0 后端，根因 B）

**Plan-Id**: 2026-06-05-interrupted-turn-finalize-and-completeness-truth
**Plan-File**: `.cursor/plans/2026-06-05-interrupted-turn-finalize-and-completeness-truth.plan.md`
**Owner**: Damon Li
**Made-with**: Damon Li

> 关联：
> `2026-06-05-concurrent-stream-ref-clobber-fix`（根因 A，前端 ref 覆盖，**先做**）、
> `2026-06-03-restart-completed-session-false-stall-and-spurious-nudge`（前端 Channel C 已对齐 + idle 禁自动续跑）、
> `2026-06-04-session-state-isolation-and-false-stall-on-switch`（未水合误报）、
> `2026-06-04-backend-event-loop-blocking-root-fix`（放大器）。
> **本 plan 是根因 B：根因 A 消除前端 ref 覆盖后，仍存在的「切回丢答案 + idle/停滞矛盾态」由本 plan 收口。**

---

## 现象（用户实测，2026-06-05，已取证）

会话 A（session `e20b5136-...`）的 `messages.json` 末尾最后一条 assistant 仅为：

```
<think>用户让我记住他用户让我记住他
```

—— **未闭合 `<think>`、无正文、无 `suggested_questions`、无 `</followups>`**。即 A 的第二轮在切走/重启前**没有 finalize 落盘完整回答**。切回 A「整段回答消失」，UI 同时出现「处理中 · 静默 Ns」+「已停滞 / 该任务可能已中断」。

---

## 根因（已逐行 trace，证据）

### 缺陷 B-1：中断/断连时 partial assistant 不落盘
`agenticx/runtime/agent_runtime.py`：完整 assistant 轮次只在 **FINAL 路径**（`:2190` `session.chat_history.append(_hist_assistant)`）或**带 tool_calls 的中间 assistant**（`:2222`）才进 `chat_history`。

`agenticx/studio/server.py` `_event_stream`：
- 默认（无 event_hub / 非 keep_runtime）客户端断连即 `break`（`:2766-2768`），finally 里 `runtime_task.cancel()`（`:2818-2820`）。
- `run_turn` 被 cancel 时**没有 finally 把已流式产生的 partial assistant 追加进 chat_history** → 该轮回答（哪怕已流式出大半）**不落盘** → 切回读 disk 啥也没有。
- 磁盘上残留的半截 `<think>` 来自某次 `incremental_persist` 抓到的中间态，既非完整答案也非干净终态。

### 缺陷 B-2：前后端「完成」口径不一致 → idle 与停滞矛盾
- 后端 `agenticx/studio/session_manager.py` `_last_turn_has_completed_reply`（`:342`）：最后一轮 user 之后存在**原始 content 非空**的 assistant 即算「完成」。半截 `<think>用户让我记住他` 的 content 非空 → **判完成 → execution_state 归 idle**。
- 前端 `desktop/src/utils/task-stall-policy.ts` `lastTurnHasCompletedAssistantReply`：用 `assistantBodyText` **剥掉 `<think>`** 后要求正文非空。半截 think 剥完为空 → **判未完成 → Channel C 报停滞**。
- ⇒ 后端 idle、前端停滞 → 「元数据像 idle，UI 却处理中/已停滞且不自愈」。

> 一句话根因：**中断轮次的 partial 不 finalize 落盘（B-1）→ 切回丢答案；前后端「完成」定义不一致（B-2）→ idle/停滞矛盾态。**

---

## 修复方案（P0，后端主导，最小且结构性）

### FR-1（todo: p0-strip-think-helper）后端可见正文 helper
在 `agenticx/studio/session_manager.py` 顶部模块函数区新增（纯函数，便于单测）：

```python
import re

_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
_THINK_OPEN_TAIL_RE = re.compile(r"<think>.*\Z", re.IGNORECASE | re.DOTALL)


def _visible_assistant_body(content: str) -> str:
    """Assistant text with <think> reasoning stripped (closed blocks AND an
    unclosed trailing <think>...). Mirrors desktop assistantBodyText so backend
    and frontend agree on whether a turn produced a real reply.
    """
    text = str(content or "")
    text = _THINK_BLOCK_RE.sub("", text)
    text = _THINK_OPEN_TAIL_RE.sub("", text)
    return text.strip()
```

pytest（`tests/test_completeness_truth.py` 或就近）覆盖：
- 闭合 `<think>x</think>正文` → `"正文"`。
- 未闭合 `<think>半截`（无 `</think>`、无正文）→ `""`。
- `<think>a</think>` 后接正文 + 末尾标点 → 返回去除 think 的正文（标点保留，不在此判未完成）。
- 纯正文无 think → 原样 strip。

### FR-2（todo: p0-completeness-align）统一「最后一轮是否有完成回复」
改 `session_manager.py` `_last_turn_has_completed_reply`（`:342-373`）：扫描最后一轮 user 之后的 assistant，判「完成」的条件改为**任一**：
- `_visible_assistant_body(content)` 非空（剥 think 后有正文，排除 `（已中断）`/`(已中断)` 占位）；**或**
- 该 assistant 带非空 `suggested_questions`；**或**
- content 含 `</followups>`（终态标记）。

> 与既有 `_last_turn_has_terminal_assistant_reply`（`:312-340`，已看 SQ / `</followups>`）保持语义协同：completed 口径在「有正文」之外也承认终态标记，避免把「正文为空但有 SQ/followups 的合法终态」误判未完成。**不改** `_normalize_execution_state_for_listing` 的其余分支逻辑，仅其依赖的 completeness 判定随之精确化。

### FR-3（todo: p0-finalize-partial-on-cancel）中断/断连 finalize partial 落盘
在 `server.py` `_event_stream`（`:2561` 起）累计 meta 的流式 assistant 文本，并在断连/中断且未 `saw_final` 时落盘：

1. 在 `_event_stream` 顶部新增累计器：`partial_meta_text = ""`。
2. 在 meta token 事件处累加（定位 `_track_runtime_event` / 非 hub 分支 `:2780-2787` 处理 event 的地方；token 事件 `event.type == EventType.TOKEN.value and event.agent_id == "meta"`，取 `event.data.get("text","")`，剥 `⏳`）：`partial_meta_text += tok`。
   - 若 token 文本不易在该层取到，则改在 `_finalize_chat_runtime` 之前从 `session` 的流式缓冲读取；以实现时实际可得为准，但**只取 meta、只取本轮**。
3. 在调用 `_finalize_chat_runtime`（`:2734` hub 分支 finally 与 `:2831` 非 hub 分支）**之前**插入 finalize-partial：
   ```python
   if not saw_final:
       body = _visible_assistant_body(partial_meta_text)
       if body:
           # close the interrupted turn so switching back shows the partial
           # answer (not nothing) and the last turn has a real visible reply.
           session.chat_history.append({
               "role": "assistant",
               "content": partial_meta_text,   # keep raw (incl. think) for fidelity
               "metadata": {"source": "interrupted-partial"},
           })
   ```
   - 仅当 `_visible_assistant_body` 非空才落（半截纯 think、无正文不补——那是真未完成，交给 FR-2 + 前端中性提示）。
   - 落盘随后由既有 `_finalize_chat_runtime` → `persist_async` 写 disk + tail snapshot。
4. **幂等防重**：finalize-partial 仅在 `not saw_final`（FINAL 未发出，说明 run_turn 的 `:2190` append 未执行）时执行，避免与 FINAL 路径重复 append。

### 验证（todo: tests）
- `pytest tests/ -k "completeness or finalize or visible_assistant"`（或新增测试文件）：FR-1/FR-2 纯函数用例 + FR-3 finalize 路径（构造 saw_final=False + partial 文本 → 断言 chat_history 末尾追加了一条 assistant 且 `metadata.source=="interrupted-partial"`；saw_final=True → 不追加）。
- `python -c "import ast; ast.parse(open('agenticx/studio/session_manager.py').read()); ast.parse(open('agenticx/studio/server.py').read())"` AST OK。
- ReadLints 改动文件无 lint 错误。

---

## 验收（AC）
- **AC-1（不丢答案）**：A 流式中切走再切回，A 已流式产生的回答（哪怕被中断）仍在 `messages.json` 与 UI（作为 partial assistant 终态），不再「整段消失」。
- **AC-2（口径一致）**：最后一轮仅未闭合 `<think>`、无正文时，后端 `_last_turn_has_completed_reply` 返回 False（与前端一致）；不再出现「后端 idle + 前端停滞」矛盾态。
- **AC-3（合法终态不误伤）**：正文为空但有 `suggested_questions` / `</followups>` 的合法终态仍判完成，不被误标未完成/停滞。
- **AC-4（回归）**：`pytest` 相关用例通过；既有 stall/execution_state 测试不回退；AST/lint 干净。

---

## 范围与排除
- **仅后端**：`agenticx/studio/session_manager.py`（helper + completeness）、`agenticx/studio/server.py`（finalize-partial）+ 新增 pytest。
- **不改**：SSE 协议字段、`run_turn` 主循环逻辑（不在 `run_turn` 内加 finally，改在服务层兜底，避免动最热生成器）、前端任何文件（前端 Channel C 已对齐，由 `2026-06-03` plan 承担；本 plan 让后端与之一致即可）。
- **不重做** `2026-06-03` 的「idle 禁自动续跑」与前端中性提示——本 plan 通过让 disk 有真实回答（FR-3）+ 后端口径一致（FR-2）从源头消除误报触发条件。
- 触及消息落盘与 execution_state，需 TDD + AST 校验；幂等防重必须保证（`not saw_final` 门控），严禁与 FINAL 重复落盘。
- 与本会话此前临时加的后端 `[page-diag]` 诊断（`session_manager.py` `_diagnose_page_source`）无关；该诊断是否保留另议。

---

## 验证步骤（人工复现）
1. 完全退出 Near（⌘Q）+ 重启 `agx serve`（后端改动须重启）。
2. 会话 A 发会跑较久的指令，流式出一部分文本后切到会话 B。
3. 切回 A：A 的 partial 回答仍在（AC-1）；顶部不再「idle 却处理中/已停滞」矛盾（AC-2）。
4. `pytest` 相关用例全绿（AC-4）。

## 回滚
- FR-1 helper 为新增；FR-2 改回原 `content.strip()` 判定即恢复；FR-3 去掉 finalize-partial 代码块即恢复。均不改数据格式/SSE 协议。

---

## 实现说明（落地后由实施者补写）
- 落地文件与关键改动：
- 验证结果（pytest 用例、AST、lint）：
- 偏差说明（如有）：
