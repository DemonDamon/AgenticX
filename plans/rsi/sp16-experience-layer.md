# SP16: 经验层升级（RSIAgent 启发）— 文本经验库 + 动作空间扩展 + live 注入 + BRS-lite 自探索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 吸收 RSIAgent（Aether Labs, training-free RSI）三条经公开证据验证的设计，升级我们的 P0.5 策略演化层：
1. **经验表征从标量升为文本**——现有策略只编码 `{continue, abort}` 阈值；RSIAgent 的 memory 是"教训+代码修正+校验模式"的文本经验，这是它涨分的主体
2. **动作空间扩展 `inject_hint::text`**——策略可演化出发射经验提示的动作；回放中按 token 成本计价（诚实：回放无法评估 hint 内容质量，只能防止 hint 刷分）
3. **BRS 式主动自探索**——TrialForest 不再只被动接 benchmark 轨迹：驱动器循环跑真实任务灌森林+经验库，每轮冻结记忆注入下一轮（RSIAgent 的 broad→frozen→reuse 生命周期）

**设计决策（对照现状）:**
- **live 注入点 = model_server 系统提示词**（RSIAgent 同款语义：经验进上下文而非权重）。零 agent 核心改动——策略层此前纯离线（grep 证实 live 执行无 policy 消费点），系统提示注入是唯一不动 agent 循环的通路
- **回放中 hint = 计价 continue**：回放只"揭开"已记录的未来，hint 无法改变历史轨迹，只能按 `len(text)//4` 加进 virtual_cost——防止演化出"狂发 hint"的策略刷分
- **经验提取规则式起步**（error 片段聚类 + 通过笔记），LLM 提取留接口（Lesson.source 字段）不实现——先让闭环转起来
- **每轮末冻结记忆**（freeze 后拒 add），下一轮检索注入——对齐 RSIAgent "frozen memory 测试时复用"，防经验无限膨胀

**已核实的现实约束（计划据此设计，子代理勿改）:**
- harbor trial 目录实测含 `agent/agenticx.trajectory.json`（M4 冒烟产物验证），其 `["messages"]` 即完整消息列表
- `ReplayAttempt.step` 对未知动作 raise ValueError（replay.py L44-45）
- `TrialForest.from_trajectories(store.iter_trajectories())` / `heldout_split(sorted(ids), seed=)` / `forest_score(evaluate_policy(p, forest, task_ids=...))` 均为现行 CLI 同款用法
- `RSITrajectory(source, task_id, session_id, model, status, reward=RewardRecord(label), messages)`；`TrajectoryStore.append(traj) -> "written"|"duplicate"`
- model_server `serve_model(lm, tokenizer, *, model_id, log, temperature_override)` + `_make_handler(lm, tokenizer, model_id, log, temperature_override)` + `_render_prompt(tokenizer, messages)`

**Tech Stack:** Python 3.13, 零新依赖。T1/T2/T3 互不依赖可并行；T4 依赖 T1+T3。

---

## 铁律（每个子代理必须遵守）

1. 测试命令一律：`python3 -m pytest tests/<...> -v -o addopts="--import-mode=importlib"`（pyproject 的 addopts 引用了缺失的 pytest-cov，必须覆盖）
2. `git add` 只加本任务明确列出的文件路径，**严禁 `git add -A` / `git add .`**（工作区有大量无关脏文件）
3. 新测试文件 basename 全仓唯一：test_memory.py / test_replay_actions.py / test_system_extra.py / test_explore.py
4. TDD：先写测试确认失败 → 最小实现 → 确认通过 → commit
5. 一切命令在仓库根目录 /Users/damonli/myWork/AgenticX 下执行

---

### Task 1: memory.py — 文本经验库（RSIAgent Experience Memory 等价物）

**Files:**
- Create: `agenticx/learning/trajectory/memory.py`
- Test: `tests/trajectory/test_memory.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_memory.py
import pytest

from agenticx.learning.trajectory.memory import (
    ExperienceMemory, Lesson, extract_lessons, format_hints,
)

MSGS_WITH_ERRORS = [
    {"role": "user", "content": "do the thing"},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]},
    {"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
    {"role": "assistant", "content": "retry"},
    {"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
    {"role": "tool", "content": "ok, wrote output.txt"},
]


def test_extract_failure_patterns_from_failed_attempt():
    lessons = extract_lessons("task-a", passed=False, messages=MSGS_WITH_ERRORS)
    assert lessons and all(l.kind == "failure_pattern" for l in lessons)
    top = lessons[0]
    assert top.task_id == "task-a" and "FileNotFoundError" in top.content
    assert "×2" in top.content                      # 同片段聚类计数


def test_extract_success_note_on_passed_attempt():
    lessons = extract_lessons("task-a", passed=True, messages=MSGS_WITH_ERRORS)
    kinds = [l.kind for l in lessons]
    assert kinds[0] == "success_note"
    assert "failure_pattern" in kinds               # 通过也记录踩过的坑


def test_extract_cleans_messages_no_lessons():
    clean = [{"role": "user", "content": "hi"},
             {"role": "assistant", "content": "done"}]
    assert extract_lessons("t", passed=True, messages=clean)[0].kind == "success_note"
    assert extract_lessons("t", passed=False, messages=clean) == []


def test_extract_caps_lesson_count():
    many = []
    for i in range(10):
        many.append({"role": "tool", "content": f"error: distinct failure {i}"})
    assert len(extract_lessons("t", passed=False, messages=many)) == 3


def test_memory_add_retrieve_ranking(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("task-a", "failure_pattern", "error: FileNotFoundError in cfg")], 1)
    m.add([Lesson("task-b", "failure_pattern", "error: FileNotFoundError in cfg")], 1)
    m.add([Lesson("task-a", "failure_pattern", "port already in use")], 1)
    got = m.retrieve("task-a", query="cfg missing", k=2)
    assert got[0].content.startswith("error: FileNotFoundError")   # task 匹配+关键词 > 跨 task
    assert all(l.task_id == "task-a" for l in got)                 # task-a 的两条都排前
    assert m.retrieve("task-zzz") == []                            # 无匹配不硬凑


def test_memory_freeze_blocks_add(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("t", "success_note", "ok")], 1)
    m.freeze()
    assert m.is_frozen
    with pytest.raises(RuntimeError):
        m.add([Lesson("t", "failure_pattern", "x")], 2)


def test_memory_persistence_roundtrip(tmp_path):
    p = tmp_path / "exp.json"
    m1 = ExperienceMemory(p)
    m1.add([Lesson("t", "failure_pattern", "boom")], 1)
    m1.freeze()
    m2 = ExperienceMemory(p)
    assert m2.is_frozen
    assert m2.retrieve("t", k=1)[0].content == "boom"


def test_format_hints_renders_block():
    assert format_hints([]) == ""
    txt = format_hints([Lesson("task-a", "failure_pattern", "boom: xyz")])
    assert "历史经验" in txt and "boom: xyz" in txt and "task-a" in txt


def test_memory_all_lessons_for_driver(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("a", "failure_pattern", "x"), Lesson("b", "success_note", "y")], 1)
    assert len(m.all_lessons()) == 2
```

- [ ] **Step 2: 跑测试确认失败**（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/memory.py
"""文本经验库（SP16 · RSIAgent Experience Memory 等价物）。

P0.5 的策略只能编码 {continue, abort} 标量阈值; 本模块把经验表征升级为
文本 Lesson（失败模式聚类 + 通过笔记）, 生命周期对齐 RSIAgent:
add → freeze → 测试时 retrieve 注入（不可变 frozen memory）。
LLM 提取走 Lesson.source="llm" 预留接口, SP16 只做规则式提取。
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


@dataclass(frozen=True)
class Lesson:
    task_id: str
    kind: str                 # failure_pattern | success_note
    content: str
    source: str = "rule"


def _is_error(content: str) -> bool:
    return "error" in content.lower()[:200]      # 与 forest._is_error_result 同口径


def extract_lessons(task_id: str, passed: bool, messages: list,
                    *, max_lessons: int = 3) -> list[Lesson]:
    """规则式经验提取: tool 报错片段聚类（截 120 字符为 key）计数排序。"""
    counts: dict[str, int] = {}
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "tool":
            content = str(m.get("content") or "").strip()
            if _is_error(content):
                counts[content[:120]] = counts.get(content[:120], 0) + 1
    lessons: list[Lesson] = []
    if passed:
        note = "此任务曾成功通过"
        if counts:
            note += f"；过程中报错 {sum(counts.values())} 次仍通过"
        lessons.append(Lesson(task_id, "success_note", note))
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    for snippet, n in ranked[: max_lessons - len(lessons)]:
        lessons.append(Lesson(task_id, "failure_pattern",
                              f"工具曾报错 ×{n}: {snippet}"))
    return lessons


class ExperienceMemory:
    """经验库: JSON 持久化（同 PolicyRegistry 模式）, freeze 后拒绝 add。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            data = {}
        self._lessons: list[dict] = data.get("lessons", [])
        self._frozen: bool = data.get("frozen", False)

    def _save(self) -> None:
        self.path.write_text(json.dumps(
            {"lessons": self._lessons, "frozen": self._frozen},
            ensure_ascii=False, indent=2))

    @property
    def is_frozen(self) -> bool:
        return self._frozen

    def freeze(self) -> None:
        self._frozen = True
        self._save()

    def add(self, lessons: list[Lesson], round_no: int) -> int:
        if self._frozen:
            raise RuntimeError("memory 已冻结, 拒绝追加（frozen memory 语义）")
        for l in lessons:
            d = asdict(l)
            d["round"] = round_no
            self._lessons.append(d)
        self._save()
        return len(lessons)

    def retrieve(self, task_id: str, query: str = "", k: int = 3) -> list[Lesson]:
        """排序: task 精确匹配 100 分 + query 词与 content 重叠; 0 分不返回。"""
        words = [w for w in query.split() if w]

        def score(rec: dict) -> int:
            s = 100 if rec["task_id"] == task_id else 0
            s += sum(w in rec["content"] for w in words)
            return s

        ranked = sorted((r for r in self._lessons if score(r) > 0),
                        key=score, reverse=True)
        return [Lesson(r["task_id"], r["kind"], r["content"], r["source"])
                for r in ranked[:k]]

    def all_lessons(self, k: int | None = None) -> list[Lesson]:
        recs = self._lessons if k is None else self._lessons[:k]
        return [Lesson(r["task_id"], r["kind"], r["content"], r["source"])
                for r in recs]


def format_hints(lessons: list[Lesson]) -> str:
    """渲染为注入系统提示词的文本块; 空输入返回空串（= 不注入）。"""
    if not lessons:
        return ""
    lines = ["## 历史经验（来自此前轮次的冻结记忆, 供参考）"]
    for l in lessons:
        lines.append(f"- [{l.kind}] {l.task_id}: {l.content}")
    return "\n".join(lines)
```

- [ ] **Step 4: 跑测试确认通过**（9 PASS）

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/memory.py tests/trajectory/test_memory.py
git commit -m "feat(rsi): text experience memory with freeze lifecycle (SP16)"
```

---

### Task 2: replay 动作空间扩展 — inject_hint 成本语义

**Files:**
- Modify: `agenticx/learning/trajectory/replay.py`
- Test: `tests/trajectory/test_replay_actions.py`（新建）

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_replay_actions.py
"""inject_hint 动作语义: 回放中 hint 不改变已记录的未来, 只按 len//4 计价。"""
import pytest

from agenticx.learning.trajectory.forest import (
    AttemptNode, StepFeatures, TrialForest,
)
from agenticx.learning.trajectory.replay import ReplayAttempt, evaluate_policy


def _node(n_steps: int = 4, passed: bool = True) -> AttemptNode:
    steps = [StepFeatures(step=i, n_messages=i + 1, n_tool_calls=1,
                          tool_success_rate=1.0, consecutive_failures=0,
                          rounds_since_progress=0, est_tokens=100 * (i + 1))
             for i in range(n_steps)]
    return AttemptNode(attempt_id="a1", task_id="t1", model="m", status="pass",
                       reward_label=1.0 if passed else 0.0, n_steps=n_steps,
                       total_est_tokens=400, steps=steps)


class HintThenFinishPolicy:
    name = "hint_then_finish"

    def act(self, obs, ctx) -> str:
        if obs.step == 0:
            return "inject_hint::check the config file path before retrying"
        return "continue"


class AbortAfterHintPolicy:
    name = "abort_after_hint"

    def act(self, obs, ctx) -> str:
        if obs.step == 0:
            return "inject_hint::short"
        return "abort"


def test_hint_policy_reaches_same_reward_but_pays_cost():
    r = ReplayAttempt(_node())
    obs = r.reset()
    while True:
        obs = r.step(HintThenFinishPolicy().act(obs, None))
        if obs is None:
            break
    res = r.result
    assert res.achieved_reward == 1.0                    # 与纯 continue 同 reward
    assert res.virtual_cost > 400                        # 基线 total_est_tokens
    assert res.hint_tokens == len("check the config file path before retrying") // 4
    assert not res.aborted


def test_hint_then_abort_accounting():
    r = ReplayAttempt(_node())
    obs = r.reset()
    while True:
        obs = r.step(AbortAfterHintPolicy().act(obs, None))
        if obs is None:
            break
    res = r.result
    assert res.aborted and res.abort_step == 1
    assert res.virtual_cost == 200 + len("short") // 4   # abort 处 est_tokens + hint
    assert res.achieved_reward == 0.0


def test_unknown_action_still_rejected():
    r = ReplayAttempt(_node())
    r.reset()
    with pytest.raises(ValueError):
        r.step("fork_workspace")                          # P1 之外的动作仍拒绝


def test_empty_hint_is_free_continue():
    r = ReplayAttempt(_node())
    obs = r.reset()
    obs = r.step("inject_hint::")
    assert obs is not None                                # 等价 continue
    res_after_full = None
    while obs is not None:
        obs = r.step("continue")
    res_after_full = r.result
    assert res_after_full.hint_tokens == 0


def test_evaluate_policy_accepts_hint_policy():
    """集成: evaluate_policy 全链路接受发 hint 的策略（forest_score 可计算）。"""
    forest = TrialForest()
    forest.trees["t1"] = type(forest.trees["t1"])(task_id="t1") if False else None
    # 直接手工组树（避免依赖 TrialForest 内部构建 API）:
    from agenticx.learning.trajectory.forest import TaskTree
    tree = TaskTree(task_id="t1")
    tree.attempts = [_node()]
    forest.trees["t1"] = tree
    scores = evaluate_policy(HintThenFinishPolicy(), forest)
    assert scores[0].passed and scores[0].total_cost > 400
```

注意：`TaskTree` 的构造方式以上述 `from ... import TaskTree; TaskTree(task_id="t1"); tree.attempts = [...]` 为准——先 Read forest.py 确认 TaskTree 的字段名（`attempts` 已在 replay.py `evaluate_policy_on_tree` 中以 `tree.attempts[:max_attempts]` 出现，可直接赋值）。`TrialForest()` 的构造与 `trees` 属性同理（`forest.trees` 在 policy.py 中以 dict 语义使用）。若 `TrialForest()` 无参构造不支持，改用 `TrialForest.from_trajectories([...])` 构建单轨迹森林——先读 forest.py 尾部再定，两种方式选能跑通的，不许 mock 掉真实路径。

- [ ] **Step 2: 跑测试确认失败**（`ReplayResult` 无 hint_tokens 属性 / step 对 inject_hint raise ValueError）

- [ ] **Step 3: 实现（replay.py 修改，diff 最小化）**

1. `ReplayResult` 加字段：

```python
@dataclass
class ReplayResult:
    aborted: bool
    abort_step: int | None
    achieved_reward: float
    virtual_cost: int
    hint_tokens: int = 0
```

2. `ReplayAttempt.__init__` 末尾加 `self._hint_tokens = 0`；`reset()` 里同步 `self._hint_tokens = 0`。

3. `step()` 的动作分发改为（在 abort 检查**之前**插入 hint 分支）：

```python
    def step(self, action: Action) -> StepFeatures | None:
        if self._done:
            raise RuntimeError("episode 已终结, 请 reset")
        if isinstance(action, str) and action.startswith("inject_hint::"):
            # SP16: hint 不改变已记录的未来, 只按文本长度计价（防刷分）
            self._hint_tokens += len(action[len("inject_hint::"):]) // 4
            action = "continue"
        if action == "abort":
            self._done, self._aborted = True, True
            return None
        if action != "continue":
            raise ValueError(f"未知动作 '{action}'（支持 continue/abort/inject_hint::）")
        self._pos += 1
        if self._pos >= self.node.n_steps:
            self._done = True
            return None
        return self.node.steps[self._pos]
```

4. `result` 的两条路径计入 hint 成本：

```python
    @property
    def result(self) -> ReplayResult:
        if not self._done:
            raise RuntimeError("episode 未终结, 无结果")
        if self._aborted:
            return ReplayResult(True, self._pos, 0.0,
                                self.node.steps[self._pos].est_tokens
                                + self._hint_tokens,
                                hint_tokens=self._hint_tokens)
        return ReplayResult(False, None,
                            1.0 if self.node.passed else 0.0,
                            self.node.total_est_tokens + self._hint_tokens,
                            hint_tokens=self._hint_tokens)
```

5. 模块 docstring 的 "P0.5 动作空间 = {continue, abort}" 一行更新为 "SP16 动作空间 = {continue, abort, inject_hint::text}；fork/switch 需工作区快照，属 P1"。

- [ ] **Step 4: 跑测试确认通过**（5 PASS）+ 既有回放测试无回归：

```bash
python3 -m pytest tests/trajectory/test_replay_actions.py tests/trajectory/ -v -o addopts="--import-mode=importlib"
```

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/replay.py tests/trajectory/test_replay_actions.py
git commit -m "feat(rsi): inject_hint action with token-cost semantics in replay (SP16)"
```

---

### Task 3: model_server system_extra — live 注入通路

**Files:**
- Modify: `agenticx/rl/model_server.py`
- Test: `tests/rl/test_system_extra.py`（新建）

- [ ] **Step 1: 写失败测试**

```python
# tests/rl/test_system_extra.py
"""system_extra 注入: 冻结经验 → 系统提示词 → 模型上下文（RSIAgent 测试时复用通路）。"""
import json
import threading
import urllib.request

import pytest

from agenticx.rl.model_server import inject_system_extra, serve_model


def test_inject_prepends_system_when_absent():
    msgs = [{"role": "user", "content": "hi"}]
    out = inject_system_extra(msgs, "LESSON: check config")
    assert out[0] == {"role": "system", "content": "LESSON: check config"}
    assert out[1] == msgs[0] and msgs[0].get("role") == "user"   # 原列表不被改


def test_inject_appends_to_existing_system():
    msgs = [{"role": "system", "content": "You are an agent."},
            {"role": "user", "content": "hi"}]
    out = inject_system_extra(msgs, "LESSON: x")
    assert out[0]["content"] == "You are an agent.\n\nLESSON: x"
    assert len(out) == 2


def test_inject_empty_extra_returns_same_messages():
    msgs = [{"role": "user", "content": "hi"}]
    assert inject_system_extra(msgs, "") is msgs
    assert inject_system_extra(msgs, None) is msgs
```

端到端测试（serve_model 带 system_extra，模型收到的 prompt 含注入文本）——**先 Read `tests/rl/` 下既有的 model_server 测试文件（Glob `tests/rl/test_model_server*.py`），复用其 fake LM/tokenizer 的构造方式**写如下断言的测试；若既有测试用真 TinyLM+tokenizer 则照抄：

```python
def test_serve_model_applies_system_extra(...):
    # 模式: 既有 model_server 测试的 lm/tokenizer 构造 + 起服务 + POST
    # 断言: 捕获到发送给 lm.generate 的输入 decode 后包含 "SECRET_HINT_MARKER"
    # （用无 chat_template 的 tokenizer 时 _render_prompt 走 fallback,
    #  system 消息会以 "System: ..." 行出现在渲染文本中）
```

- [ ] **Step 2: 跑测试确认失败**（ImportError: inject_system_extra）

- [ ] **Step 3: 实现（model_server.py 修改）**

1. 新纯函数（放 `_render_prompt` 之后）：

```python
def inject_system_extra(messages, extra: str | None):
    """把冻结经验文本并入消息列表（live 注入点, RSIAgent 测试时记忆复用）。

    已有 system 消息则追加其 content; 否则插首条 system。extra 为空原样返回
    （同一对象, 零拷贝）。返回新列表, 不改调用方传入的原列表。
    """
    if not extra:
        return messages
    msgs = [dict(m) if isinstance(m, dict) else {"role": "user", "content": str(m)}
            for m in messages]
    for m in msgs:
        if m.get("role") == "system":
            m["content"] = f"{m['content']}\n\n{extra}" if m.get("content") else extra
            return msgs
    return [{"role": "system", "content": extra}, *msgs]
```

2. `_make_handler` 签名加 `system_extra: str | None = None`；`do_POST` 中渲染行改为：

```python
            text = _render_prompt(tokenizer,
                                  inject_system_extra(req.get("messages", []),
                                                      system_extra))
```

3. `serve_model` 签名加 `system_extra: str | None = None`，透传给 `_make_handler`；docstring 追加一行：

```
    system_extra: 非 None 时把该文本注入每个请求的系统提示（SP16 冻结经验复用）。
```

- [ ] **Step 4: 跑测试确认通过**（4 PASS，含端到端）+ 既有 model_server 测试无回归：

```bash
python3 -m pytest tests/rl/test_system_extra.py tests/rl/ -o addopts="--import-mode=importlib" -k "system_extra or model_server"
```

- [ ] **Step 5: Commit**

```bash
git add agenticx/rl/model_server.py tests/rl/test_system_extra.py
git commit -m "feat(rl): system_extra prompt injection in model server (SP16 live path)"
```

---

### Task 4: scripts/rsi_explore.py — BRS-lite 自探索驱动器

**Files:**
- Create: `scripts/rsi_explore.py`
- Test: `tests/trajectory/test_explore.py`

**依赖:** T1（memory）+ T3（system_extra）已合入。执行前先 `git log --oneline -5` 确认前三个 commit 在。

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_explore.py
"""BRS-lite 驱动器 dry 全流程: 2 轮自探索 → 经验冻结 → hints 进第 2 轮注入。"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from rsi_explore import run_round   # noqa: E402

from agenticx.learning.trajectory.memory import ExperienceMemory   # noqa: E402
from agenticx.learning.trajectory.store import TrajectoryStore     # noqa: E402


def _tasks(tmp_path):
    return [str(tmp_path / "taskA"), str(tmp_path / "taskB")]


def test_two_rounds_dry(tmp_path):
    memory = ExperienceMemory(tmp_path / "exp.json")
    store = TrajectoryStore(tmp_path / "store")
    tasks = _tasks(tmp_path)

    r1 = run_round(1, tasks, memory, store, trials_root=tmp_path / "trials",
                   dry=True, evolve=False)
    assert len(r1) == 2
    assert all("reward" in r and "hints" in r for r in r1)
    assert r1[0]["hints"] == ""                       # 第 1 轮无记忆 → 不注入
    assert memory.is_frozen                           # 轮末冻结
    assert len(memory.all_lessons()) >= 2             # 2 任务各产出经验

    r2 = run_round(2, tasks, memory, store, trials_root=tmp_path / "trials",
                   dry=True, evolve=False)
    assert "FileNotFoundError" in r2[0]["hints"]      # 第 1 轮错误经验注入第 2 轮
    # 新一轮记忆是独立实例（驱动器每轮新建, frozen 文件带轮次后缀或重建——见实现）
    n_traj = sum(1 for _ in store.iter_trajectories())
    assert n_traj == 4                                # 2 轮 × 2 任务全部入库


def test_run_round_evolve_smoke(tmp_path):
    memory = ExperienceMemory(tmp_path / "exp.json")
    store = TrajectoryStore(tmp_path / "store")
    report = run_round(1, _tasks(tmp_path), memory, store,
                       trials_root=tmp_path / "trials", dry=True, evolve=True)
    assert report["evolution"] is not None            # evolve_loop 真实执行
    assert "accepted" in report["evolution"]
```

- [ ] **Step 2: 跑测试确认失败**（ModuleNotFoundError: rsi_explore）

- [ ] **Step 3: 实现（完整脚本）**

```python
#!/usr/bin/env python3
"""BRS-lite 自探索驱动器（SP16）：RSIAgent 广域自探索的最小等价物。

闭环: 每轮 冻结记忆→hints 注入模型服务系统提示 → harbor trial（真实容器）
      → 轨迹入库(TrialForest 底座) + 经验提取入库 → 轮末 freeze → 下一轮复用。
      --evolve 时每轮末在 train 区跑策略演化（SP8 纪律: heldout 不参与选择）。

用法:
  CPU 冒烟（零 Docker/零模型, 全流程逻辑验证）:
    python3 scripts/rsi_explore.py --dry --rounds 2 --task /tmp/fake-taskA
  真跑（本机 MPS 0.6B 或 GPU 机）:
    python3 scripts/rsi_explore.py --model Qwen/Qwen3-0.6B \
        --task /path/to/tb40-taskA --task /path/to/tb40-taskB --rounds 3 --evolve
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.evolution import (   # noqa: E402
    SEED_POLICY_SOURCE, PolicyRegistry, compile_policy, evolve_loop,
    mutate_policy_source,
)
from agenticx.learning.trajectory.forest import TrialForest      # noqa: E402
from agenticx.learning.trajectory.memory import (     # noqa: E402
    ExperienceMemory, extract_lessons, format_hints,
)
from agenticx.learning.trajectory.replay import evaluate_policy, forest_score  # noqa: E402
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord    # noqa: E402
from agenticx.learning.trajectory.store import TrajectoryStore  # noqa: E402
from agenticx.trainer.heldout import heldout_split    # noqa: E402

_FAKE_ERROR_MSGS = [
    {"role": "user", "content": "solve the task"},
    {"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]},
    {"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
    {"role": "assistant", "content": "final answer"},
]


def _fake_trial(trials_dir: Path, task_path: str, round_no: int) -> tuple[float, Path]:
    """dry 模式: 伪造 harbor trial 产物（result.json + agent 轨迹）, 交替给分。"""
    name = f"{Path(task_path).name}__dry{round_no}_{abs(hash(task_path)) % 9973}"
    d = trials_dir / name
    (d / "agent").mkdir(parents=True, exist_ok=True)
    (d / "result.json").write_text(json.dumps(
        {"verifier_result": {"rewards": {"reward": 0.0}}}))
    (d / "agent" / "agenticx.trajectory.json").write_text(json.dumps(
        {"messages": _FAKE_ERROR_MSGS}))
    return 0.0, d


def _parse_trial(trial_dir: Path, task_name: str, reward: float, model: str,
                 source: str) -> RSITrajectory:
    data = json.loads((trial_dir / "agent" / "agenticx.trajectory.json").read_text())
    return RSITrajectory(
        source=source, task_id=task_name, session_id=trial_dir.name,
        model=model, status="pass" if reward >= 1.0 else "fail",
        reward=RewardRecord(label=float(reward)),
        messages=data.get("messages", []))


def _evolve(store: TrajectoryStore, out_dir: Path, iters: int = 3):
    """SP8 同款纪律: 只用 train 区评分; 种子未注册先注册并 promote。"""
    forest = TrialForest.from_trajectories(store.iter_trajectories())
    if not forest.trees:
        return None
    split = heldout_split(sorted(forest.trees), seed="v1")

    def evaluate_fn(policy) -> float:
        return forest_score(evaluate_policy(policy, forest,
                                            task_ids=list(split.train)))

    reg = PolicyRegistry(out_dir / "policies.json")
    if reg.current() is None:
        v = reg.register(SEED_POLICY_SOURCE,
                         score=evaluate_fn(compile_policy(SEED_POLICY_SOURCE)),
                         lineage="seed")
        reg.promote(v)
    return evolve_loop(reg, evaluate_fn=evaluate_fn,
                       propose_fn=lambda cur, fb: mutate_policy_source(cur),
                       n_iters=iters)


def run_round(round_no: int, tasks: list[str], memory: ExperienceMemory,
              store: TrajectoryStore, *, trials_root: Path, dry: bool = False,
              evolve: bool = False, lm=None, tokenizer=None,
              model_name: str = "dry-model", timeout: float = 1800.0) -> dict:
    """跑一轮自探索。返回 {"results": [...], "evolution": ...} 形报告。

    记忆语义（对齐 RSIAgent frozen memory）: 本轮注入的是【上一轮冻结】的
    经验; 本轮新经验提取后写入独立轮次文件, 轮末 freeze 供下一轮读。
    """
    trials_root = Path(trials_root)
    prev = trials_root.parent / "experience" / f"round_{round_no - 1}.json"
    hints = ""
    if round_no > 1 and prev.exists():
        hints = format_hints(ExperienceMemory(prev).all_lessons(k=8))

    srv = None
    base_url = None
    if not dry:
        from agenticx.rl.model_server import serve_model
        srv = serve_model(lm, tokenizer, model_id="agenticx-rl",
                          system_extra=hints or None)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base_url = f"http://host.docker.internal:{srv.server_address[1]}/v1"

    results = []
    for task_path in tasks:
        task_name = Path(task_path).name
        tdir = trials_root / f"round_{round_no}"
        if dry:
            reward, trial_dir = _fake_trial(tdir, task_path, round_no)
        else:
            from agenticx.rl.harbor_reward import run_harbor_trial
            reward, trial_dir = run_harbor_trial(
                task_path, "openai/agenticx-rl", base_url,
                trials_dir=tdir, timeout=timeout)
        store.append(_parse_trial(trial_dir, task_name, reward,
                                  model_name, "harbor-explore"
                                  if not dry else "dry-explore"))
        lessons = extract_lessons(task_name, reward >= 1.0,
                                  json.loads((trial_dir / "agent" /
                                              "agenticx.trajectory.json")
                                             .read_text())["messages"])
        if not memory.is_frozen:
            memory.add(lessons, round_no)
        results.append({"task": task_name, "reward": float(reward),
                        "hints": hints})
    if srv is not None:
        srv.shutdown()

    memory.freeze()
    report = {"round": round_no, "results": results, "evolution": None}
    if evolve:
        from dataclasses import asdict
        evo = _evolve(store, trials_root.parent / "policies")
        report["evolution"] = asdict(evo) if evo is not None else None
    return report


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", action="append", required=True,
                    help="任务目录（可多次）")
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--evolve", action="store_true")
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--out", default="datasets/explore")
    args = ap.parse_args()

    out = Path(args.out)
    lm = tokenizer = None
    if not args.dry:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
        device = ("cuda" if torch.cuda.is_available()
                  else "mps" if torch.backends.mps.is_available() else "cpu")
        tokenizer = AutoTokenizer.from_pretrained(args.model)
        lm = AutoModelForCausalLM.from_pretrained(args.model).to(device)

    summary = []
    for r in range(1, args.rounds + 1):
        memory = ExperienceMemory(out / "experience" / f"round_{r}.json")
        store = TrajectoryStore(out / "store")
        t0 = time.time()
        rep = run_round(r, args.task, memory, store, trials_root=out / "trials",
                        dry=args.dry, evolve=args.evolve, lm=lm,
                        tokenizer=tokenizer, model_name=args.model)
        rep["seconds"] = round(time.time() - t0, 1)
        summary.append(rep)
        print(json.dumps(rep, ensure_ascii=False))
    print(json.dumps({"rounds": len(summary)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**实现注意（子代理必读）:**
1. 测试里 `run_round` 返回值是 dict，但 `test_two_rounds_dry` 把 `r1` 当 list 用（`r1[0]["hints"]`）——**按实现为准修测试**：断言改为 `rep = run_round(...); assert len(rep["results"]) == 2; assert rep["results"][0]["hints"] == ""` 等。修测试时保持断言语义不变（第 1 轮无 hints、第 2 轮 hints 含 FileNotFoundError、4 条轨迹、evolution 字段存在）
2. `run_round` 的记忆传递语义：测试里传同一个 memory 实例跑两轮会撞 freeze——所以实现里每轮经验写独立轮次文件（`round_N.json`），注入读上一轮文件。测试的 `memory` 参数即本轮实例；`test_two_rounds_dry` 需要把 `trials_root` 与经验目录的相对关系对齐：`prev = trials_root.parent / "experience" / ...`，故测试里 `trials_root=tmp_path/"trials"` 时经验目录是 `tmp_path/"experience"`——两个用例都要保证第 2 轮的 `trials_root` 与第 1 轮**同父目录**（示例已满足）
3. 若 `TrajectoryStore.iter_trajectories` 或 `TrialForest.from_trajectories` 的真实签名与上述用法不符（以库源码为准），修脚本的调用处，不许改库

- [ ] **Step 4: 跑测试确认通过**（2 PASS）+ dry 命令行冒烟（子代理跑）：

```bash
python3 scripts/rsi_explore.py --dry --rounds 2 --task /tmp/fakeA --task /tmp/fakeB
```

预期：两轮 JSON 报告打印、第 2 轮 hints 非空含 FileNotFoundError、退出码 0。

- [ ] **Step 5: Commit**

```bash
git add scripts/rsi_explore.py tests/trajectory/test_explore.py
git commit -m "feat(rsi): BRS-lite self-exploration driver with frozen-memory reuse (SP16)"
```

---

## 完成定义

- 全量回归：`python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib"` 全绿（基线 188，预计新增 ~20）
- 父代理亲自复验：git show --stat 每个 commit + 重跑测试 + `--dry` 冒烟
- 推送 `feat/rsi-data-flywheel`，PR #54 更新

## 真机衔接（GPU 到位后 / 本机 MPS 真跑）

```bash
# 本机 MPS 0.6B + TB 4.0 轻任务, 3 轮自探索 + 策略演化
python3 scripts/rsi_explore.py --model Qwen/Qwen3-0.6B \
    --task harness-lab/terminal-bench/music-harmony \
    --task harness-lab/terminal-bench/<另一轻任务> \
    --rounds 3 --evolve --out datasets/explore
```
观察口径: 每轮 reward 序列（0.6B 大概率仍为 0, 重点是机制）+ 经验库增长 + 演化 accepted/rejected。
