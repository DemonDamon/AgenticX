# agenticx/learning/trajectory/decision_mining.py
"""决策点挖掘（SP25 + SP29d）：轨迹 → 决策点 sidecar。

插桩层级说明：harbor trial 的 agent 运行在容器内（镜像自有代码），本层
选择在 driver 侧 post-trial 挖掘——轨迹 messages 完整保存了策略所见
上下文与实际 tool call，压缩函数是 messages 的纯函数，事后构造忠实于
 rollout 现场（state_compressor 版本化保证训推一致）。

标签语义：实际调用的工具即 execution 硬标签（真值，非老师观点）；
outcome 由调用方按 trial 终局回填（DecisionLog.backfill_outcome）。
候选集 = 本轨迹观测到的全部工具（trace-observed）∪ extra_options，
干扰项来源经 distractor_source 溯源。

error_classification（SP29d）：每个 error tool result 一个决策点，
选项 (retry | backoff | abort)；规则真值与 SP22 classify_error 同源
（_ALGO_ERROR_RE → abort，_INFRA_ERROR_RE → retry，其余 error →
backoff）——attempt 级三分类与步级处置标签用同一组正则，互证。
"""
from __future__ import annotations

from typing import Any, Iterable

from agenticx.rl.decision import DecisionLog, DecisionLabel, DecisionQuestion

# 单条消息内容纳入 state 的截断上限（防超长 tool 输出淹没尾部语义）
_MSG_SNIPPET_CHARS = 200

# SP29d error 处置选项与真值映射（与 forest.classify_error 正则同源）
ERROR_OPTIONS: tuple[str, ...] = ("retry", "backoff", "abort")


def _tc_name(tc: dict[str, Any]) -> str | None:
    """OpenAI 格式 tool_call 的函数名；缺失返回 None（容错旧/伪造轨迹）。"""
    fn = tc.get("function") or {}
    name = fn.get("name") or tc.get("name")
    return str(name) if name else None


def compress_state(messages: list[dict[str, Any]], upto: int, *,
                   state_chars: int = 1200) -> str:
    """决策点 state：前缀消息的确定性尾部压缩（messages 的纯函数）。

    每条消息取 "role:内容前缀"，拼接后截尾部 state_chars 字符——版本号
    msg-tail-{N}-v1 与 DecisionRecord.state_compressor 对齐，换参即换数据集。
    """
    parts = [
        f"{m.get('role', '?')}:{str(m.get('content') or '')[:_MSG_SNIPPET_CHARS]}"
        for m in messages[:upto]
    ]
    return "\n".join(parts)[-state_chars:]


def state_compressor_version(state_chars: int = 1200) -> str:
    return f"msg-tail-{state_chars}-v1"


def mine_tool_decisions(log: DecisionLog, messages: list[dict[str, Any]], *,
                        rollout_id: str, task_id: str,
                        state_chars: int = 1200,
                        extra_options: Iterable[str] = (),
                        distractor_source: str = "trace-observed-v1") -> int:
    """从轨迹 messages 挖 tool_selection 决策点，追加进 log，返回条数。

    rollout_id 用 trial session 名（trial_dir.name）——与 RSITrajectory
    session_id 同源；SP24 token-native rollout 接入后沿用同一 id 约定。
    每个含 tool_calls 的 assistant 消息一个决策点；消息内多次调用以
    q_tool_0/q_tool_1... 多题共享同一 state（一次前向可并行监督）。
    """
    if not messages:
        return 0
    vocab: list[str] = []
    for m in messages:
        for tc in m.get("tool_calls") or []:
            name = _tc_name(tc)
            if name and name not in vocab:
                vocab.append(name)
    for extra in extra_options:
        if extra not in vocab:
            vocab.append(extra)
    if not vocab:
        return 0

    n = 0
    for i, m in enumerate(messages):
        calls = [tc for tc in (m.get("tool_calls") or []) if _tc_name(tc)]
        if m.get("role") != "assistant" or not calls:
            continue
        questions: list[DecisionQuestion] = []
        for j, tc in enumerate(calls):
            questions.append(DecisionQuestion(
                qid="q_tool" if len(calls) == 1 else f"q_tool_{j}",
                type="choice", question="下一步调用哪个工具",
                options=tuple(vocab), distractor_source=distractor_source))
        rec = log.add(
            rollout_id=rollout_id, turn=i, task_id=task_id,
            decision_type="tool_selection",
            state=compress_state(messages, i, state_chars=state_chars),
            state_compressor=state_compressor_version(state_chars),
            questions=questions)
        for j, tc in enumerate(calls):
            qid = "q_tool" if len(calls) == 1 else f"q_tool_{j}"
            rec.add_label(DecisionLabel(qid=qid, source="execution",
                                        hard=_tc_name(tc)))
        n += 1
    return n


def error_action(content: str) -> str:
    """error tool result → 处置动作规则真值（SP29d，与 SP22 正则同源）。

    _ALGO_ERROR_RE 命中 → abort（方向失败，重试无益）；
    _INFRA_ERROR_RE 命中 → retry（环境瞬时，立刻重试）；
    _is_error_result 为真但两正则均不中 → backoff（未知形态，保守退避）。
    """
    from .forest import _ALGO_ERROR_RE, _INFRA_ERROR_RE, _is_error_result
    c = str(content)
    if not _is_error_result(c):
        return ""
    if _ALGO_ERROR_RE.search(c):
        return "abort"
    if _INFRA_ERROR_RE.search(c):
        return "retry"
    return "backoff"


def mine_error_decisions(log: DecisionLog, messages: list[dict[str, Any]], *,
                         rollout_id: str, task_id: str,
                         state_chars: int = 1200) -> int:
    """从轨迹挖 error_classification 决策点（SP29d），返回条数。

    每条 error tool result 一个决策点：q_err choice(retry|backoff|abort)，
    规则真值即 execution 硬标签（error_action）；outcome 由调用方按
    trial 终局回填。state 与 tool_selection 同 msg-tail 压缩（纯函数）。
    """
    if not messages:
        return 0
    q = DecisionQuestion(qid="q_err", type="choice",
                         question="该工具错误应如何处置",
                         options=ERROR_OPTIONS,
                         distractor_source="rule-v1")
    n = 0
    for i, m in enumerate(messages):
        if not isinstance(m, dict) or m.get("role") != "tool":
            continue
        action = error_action(m.get("content") or "")
        if not action:
            continue
        rec = log.add(
            rollout_id=rollout_id, turn=i, task_id=task_id,
            decision_type="error_classification",
            state=compress_state(messages, i, state_chars=state_chars),
            state_compressor=state_compressor_version(state_chars),
            questions=[q])
        rec.add_label(DecisionLabel(qid="q_err", source="execution",
                                    hard=action))
        n += 1
    return n
