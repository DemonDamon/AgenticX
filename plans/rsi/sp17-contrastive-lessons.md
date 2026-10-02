# SP17: 对比式经验提取 + 跨任务投票（ModularRSI 方法论吸收）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 吸收 ModularRSI（北航/曼大/IQuest, HF 日榜第二）对比蒸馏 + 门控方法论，修 SP16 经验层的三个粗糙处：

1. **对比式提取**——SP16 的 `extract_lessons` 见错就记，分不清"任务难"和"策略错"。ModularRSI 的核心洞见：**同任务成败差异才是系统缺陷信号**——失败组有、成功组没有的报错 = 缺陷；两组都有的报错 = 任务本身难度，必须排除（他们的消融：整块演化反而降分，限制归因范围才涨分）
2. **跨任务投票**——单任务提取的经验可能是噪声。同一错误模式在 ≥N 个任务上复现才值得注入 hints（他们的"跨任务投票数决定优先改什么"）
3. **真实数据度量**——harness-lab 全量 jobs（170 条轨迹/101 任务/**8 个对比任务组**，已验证）跑出第一份对比经验清单

**设计决策（对照现状）:**
- 对比提取实现为纯函数 `extract_contrastive_lessons(task_id, pass_msgs_list, fail_msgs_list)`：失败组报错键集合 − 成功组报错键集合，按失败组轨迹覆盖率排序；kind=`contrastive_failure`（区别于 `failure_pattern`，注入优先级更高）
- 报错模式归一化键 `_vote_key`：`error: FileNotFoundError: xxx` → `error: filenotfounderror`（异常类型级，消息级差异不分裂键）；同键兼作跨任务投票键
- 投票存在 ExperienceMemory 侧结构 `votes: {key: {tasks: [...]}}`（**不加 Lesson 字段**，避免双源真值）；votes = 复现任务数 = len(tasks)，同任务重复 add 不涨票
- `voted_lessons(min_votes, k)`：驱动器注入 hints 的投票过滤入口；`all_lessons/retrieve` 行为不变（向后兼容 SP16 轮次文件：load 时 `votes` 缺省为 {}）
- 驱动器提取升级：store 内该任务出现 pass+fail 混合 → 走对比提取（含当前 trial），否则回退 `extract_lessons`
- **诚实边界**：对比提取仍是规则式（错误类型集合差），LLM 对比蒸馏（ModularRSI 的 Code-Modify Agent）留 `Lesson.source="llm"` 接口不实现

**已核实的现实约束（计划据此设计，子代理勿改）:**
- memory.py 现行 API：`Lesson(task_id, kind, content, source="rule")` 冻结 dataclass；`extract_lessons(task_id, passed, messages, *, max_lessons=3)`；`ExperienceMemory._save` 写 `{"lessons", "frozen"}`；`format_hints(lessons)`
- `collect_jobs(Path(jobs_dir), job_pattern="*")` → Iterator[RSITrajectory]，字段含 `task_id/model/status("pass"|"fail"|"partial")/messages`
- 真实数据分布：tb40 口径 9 任务**零对比对**；全量 `job_pattern="*"` 170 轨迹/101 任务/8 组有对比（含 install-windows-3.11: pass=1 fail=4 等）
- rsi_explore.py：hints 构建在 run_round L101-103；提取在 L135-138；stale 守卫 L105-110 不可动；dry 模式 `_FAKE_ERROR_MSGS` 含 `error: FileNotFoundError: config.yaml not found`，reward 恒 0
- `store.iter_trajectories()` 每次 as 迭代器（多轮遍历安全）

**Tech Stack:** Python 3.13, 零新依赖。T1 → T2 → T3 串行（T2/T3 依赖 T1 的 memory API）。

---

## 铁律（每个子代理必须遵守）

1. 测试命令一律：`python3 -m pytest tests/<...> -v -o addopts="--import-mode=importlib"`（pyproject addopts 引用缺失 pytest-cov，必须覆盖）
2. `git add` 只加本任务明确列出的文件路径，**严禁 `git add -A` / `git add .`**（工作区有无关脏文件：harness-lab/run_full.py、FinnewsHunter、untracked 目录）
3. 新测试文件 basename 全仓唯一：test_contrastive.py
4. TDD：先写测试确认失败 → 最小实现 → 确认通过 → commit
5. 一切命令在仓库根目录 /Users/damonli/myWork/AgenticX 下执行
6. 前置确认：`git log --oneline -3` 应见 `257d9a0e fix(rsi): reject stale frozen memory...`

---

### Task 1: 对比式提取 + 跨任务投票（memory.py 核心升级）

**Files:**
- Modify: `agenticx/learning/trajectory/memory.py`
- Test: `tests/trajectory/test_contrastive.py`（新建）、`tests/trajectory/test_memory.py`（追加）

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_contrastive.py
"""对比式经验提取（SP17 · ModularRSI 对比蒸馏同构）：
失败组独有报错 = 系统缺陷信号; 两组共通报错 = 任务难度, 排除。"""
from agenticx.learning.trajectory.memory import extract_contrastive_lessons

FAIL_A = [
    [{"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
     {"role": "tool", "content": "error: TimeoutError: npm install timed out"}],
    [{"role": "tool", "content": "error: TimeoutError: npm install timed out"}],
]
PASS_A = [
    [{"role": "tool", "content": "error: FileNotFoundError: config.yaml not found"},
     {"role": "tool", "content": "ok"}],          # 成功组也有 FileNotFound → 任务难度
]


def test_contrastive_excludes_task_difficulty_errors():
    lessons = extract_contrastive_lessons("t1", pass_messages_list=PASS_A,
                                          fail_messages_list=FAIL_A)
    contents = " | ".join(l.content for l in lessons)
    assert "TimeoutError" in contents            # 失败组独有 → 缺陷信号
    assert "FileNotFoundError" not in contents    # 两组共通 → 排除


def test_contrastive_counts_trajectory_coverage():
    lessons = extract_contrastive_lessons("t1", PASS_A, FAIL_A)
    top = lessons[0]
    assert top.kind == "contrastive_failure"
    assert "×2" in top.content                   # 2/2 失败轨迹都犯 → 排第一
    assert top.task_id == "t1" and top.source == "rule"


def test_contrastive_requires_both_groups():
    assert extract_contrastive_lessons("t1", [], FAIL_A) == []
    assert extract_contrastive_lessons("t1", PASS_A, []) == []


def test_contrastive_all_shared_yields_nothing():
    only_shared = [[{"role": "tool",
                     "content": "error: FileNotFoundError: config.yaml"}]]
    assert extract_contrastive_lessons("t1", only_shared, only_shared) == []


def test_contrastive_error_type_level_matching():
    # 消息不同但异常类型相同 → 视为同一模式（成功组出现过即排除）
    fail = [[{"role": "tool", "content": "error: FileNotFoundError: /a.yaml"}]]
    pass_ = [[{"role": "tool", "content": "error: FileNotFoundError: /b.yaml"}]]
    assert extract_contrastive_lessons("t1", pass_, fail) == []


def test_contrastive_caps_lessons():
    many_fail = [[{"role": "tool", "content": f"error: RuntimeError: r{i}"}]
                 for i in range(6)]
    assert len(extract_contrastive_lessons("t1", PASS_A, many_fail)) == 3
```

追加到 `tests/trajectory/test_memory.py`（投票机制）：

```python
# --- SP17: 跨任务投票 ---
from agenticx.learning.trajectory.memory import Lesson, _vote_key  # noqa: E402


def test_vote_key_normalizes_error_type():
    assert _vote_key("error: FileNotFoundError: /a.yaml") == \
           _vote_key("工具曾报错 ×2: error: FileNotFoundError: /b.yaml")
    assert _vote_key("error: FileNotFoundError: /a.yaml") != \
           _vote_key("error: TimeoutError: x")


def test_votes_accumulate_across_tasks_not_within(tmp_path):
    m = ExperienceMemory(tmp_path / "exp.json")
    m.add([Lesson("task-a", "failure_pattern",
                  "error: FileNotFoundError: /a")], 1)
    m.add([Lesson("task-a", "failure_pattern",
                  "error: FileNotFoundError: /a2")], 1)   # 同任务 → 不涨票
    m.add([Lesson("task-b", "contrastive_failure",
                  "error: FileNotFoundError: /b")], 1)    # 跨任务 → 2 票
    voted = m.voted_lessons()
    assert len(voted) == 3
    assert m.voted_lessons(min_votes=2) == [Lesson(
        "task-b", "contrastive_failure", "error: FileNotFoundError: /b")]
    assert m.voted_lessons(min_votes=3) == []


def test_votes_persist_and_backcompat(tmp_path):
    p = tmp_path / "exp.json"
    m = ExperienceMemory(p)
    m.add([Lesson("a", "failure_pattern", "error: TimeoutError: t"),
           Lesson("b", "failure_pattern", "error: TimeoutError: t2")], 1)
    m.freeze()
    m2 = ExperienceMemory(p)
    assert len(m2.voted_lessons(min_votes=2)) == 1          # 票数持久化
    # SP16 旧格式文件（无 votes 键）可读
    import json as _json
    old = tmp_path / "old.json"
    old.write_text(_json.dumps(
        {"lessons": [{"task_id": "a", "kind": "failure_pattern",
                      "content": "x", "source": "rule", "round": 1}],
         "frozen": True}))
    assert len(ExperienceMemory(old).all_lessons()) == 1
```

- [ ] **Step 2: 跑测试确认失败**（ImportError: extract_contrastive_lessons / _vote_key；test_memory 新增 2 FAIL）

- [ ] **Step 3: 实现（memory.py 追加/修改）**

在 `_is_error` 之后追加：

```python
def _vote_key(content: str) -> str:
    """跨任务投票键: 归一化到异常类型级（error: 后第一个冒号段）。"""
    low = content.lower()
    idx = low.find("error")
    if idx < 0:
        return low[:60]
    seg = content[idx:idx + 120].split(":")
    return ":".join(s.strip().lower() for s in seg[:2])[:60]


def _error_patterns(messages: list) -> dict[str, str]:
    """一条轨迹的 {投票键: 代表性原始片段}（同键保首个, 120 字符截断）。"""
    out: dict[str, str] = {}
    for m in messages:
        if isinstance(m, dict) and m.get("role") == "tool":
            content = str(m.get("content") or "").strip()
            if _is_error(content):
                out.setdefault(_vote_key(content), content[:120])
    return out


def extract_contrastive_lessons(task_id: str, pass_messages_list: list,
                                fail_messages_list: list, *,
                                max_lessons: int = 3) -> list[Lesson]:
    """对比式提取（SP17 · ModularRSI 对比蒸馏同构）。

    失败组报错键 − 成功组报错键 = 系统缺陷信号（kind=contrastive_failure）;
    两组共通报错 = 任务本身难度, 不是缺陷, 排除。
    排序: 失败组轨迹覆盖率（出现该键的失败轨迹数）降序。
    两组任一为空 → 无法对比 → 返回 []（调用方回退 extract_lessons）。
    """
    if not pass_messages_list or not fail_messages_list:
        return []
    pass_keys: set[str] = set()
    for msgs in pass_messages_list:
        pass_keys |= _error_patterns(msgs).keys()
    coverage: dict[str, int] = {}
    rep: dict[str, str] = {}
    for msgs in fail_messages_list:
        for key, snippet in _error_patterns(msgs).items():
            coverage[key] = coverage.get(key, 0) + 1
            rep.setdefault(key, snippet)
    lessons = []
    for key, n in sorted(coverage.items(), key=lambda kv: -kv[1]):
        if key in pass_keys:
            continue
        lessons.append(Lesson(task_id, "contrastive_failure",
                              f"失败组独有报错 ×{n}: {rep[key]}"))
        if len(lessons) >= max_lessons:
            break
    return lessons
```

`ExperienceMemory` 修改（`__init__` / `_save` / `add` 加 votes；新增 `voted_lessons`）：

```python
    # __init__ 内, self._lessons 行之后加:
        self._votes: dict[str, dict] = data.get("votes", {})

    # _save 改为:
    def _save(self) -> None:
        self.path.write_text(json.dumps(
            {"lessons": self._lessons, "votes": self._votes,
             "frozen": self._frozen},
            ensure_ascii=False, indent=2))

    # add() 内 for 循环体改为:
        for l in lessons:
            d = asdict(l)
            d["round"] = round_no
            self._lessons.append(d)
            v = self._votes.setdefault(_vote_key(l.content), {"tasks": []})
            if l.task_id not in v["tasks"]:
                v["tasks"].append(l.task_id)
        self._save()
        return len(lessons)

    # 新增方法（all_lessons 之后）:
    def voted_lessons(self, *, min_votes: int = 1,
                      k: int | None = None) -> list[Lesson]:
        """按跨任务票数过滤（SP17）: votes = 复现任务数; 同任务重复不涨票。"""
        def votes_of(rec: dict) -> int:
            return len(self._votes.get(_vote_key(rec["content"]),
                                       {"tasks": []})["tasks"])
        recs = [r for r in self._lessons if votes_of(r) >= min_votes]
        recs.sort(key=votes_of, reverse=True)
        if k is not None:
            recs = recs[:k]
        return [Lesson(r["task_id"], r["kind"], r["content"], r["source"])
                for r in recs]
```

- [ ] **Step 4: 跑测试确认通过**

```bash
python3 -m pytest tests/trajectory/test_contrastive.py tests/trajectory/test_memory.py -v -o addopts="--import-mode=importlib"
```

预期：test_contrastive 6 PASS + test_memory 原 9 + 新 2 = 11 PASS。随后整目录回归：

```bash
python3 -m pytest tests/trajectory/ -o addopts="--import-mode=importlib" 2>&1 | tail -1
```

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/memory.py tests/trajectory/test_contrastive.py tests/trajectory/test_memory.py
git commit -m "feat(rsi): contrastive lesson extraction + cross-task voting (SP17)"
```

---

### Task 2: 轨迹级对比挖掘 + CLI（真实数据度量入口）

**前置:** Task 1 已合入（`git log --oneline -1` 见 contrastive 提交）。

**Files:**
- Modify: `agenticx/learning/trajectory/memory.py`（追加一个函数）
- Create: `scripts/mine_lessons.py`
- Test: `tests/trajectory/test_contrastive.py`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```python
# --- SP17 T2: 轨迹级对比挖掘 ---
from agenticx.learning.trajectory.memory import (
    contrastive_lessons_from_trajectories,
)
from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory


def _traj(task: str, status: str, tool_contents: list) -> RSITrajectory:
    msgs = [{"role": "user", "content": "go"}]
    for c in tool_contents:
        msgs.append({"role": "tool", "content": c})
    return RSITrajectory(
        source="test", task_id=task, session_id=f"{task}-{status}-{len(tool_contents)}",
        model="m", status=status,
        reward=RewardRecord(label=1.0 if status == "pass" else 0.0),
        messages=msgs)


def test_mine_contrastive_from_trajectories():
    trajs = [
        _traj("t1", "pass", ["error: FileNotFoundError: cfg"]),
        _traj("t1", "fail", ["error: FileNotFoundError: cfg",
                             "error: TimeoutError: npm"]),
        _traj("t2", "pass", ["ok"]),                 # t2 无失败组 → 不产出
        _traj("t3", "fail", ["error: TimeoutError: npm"]),
        _traj("t3", "fail", ["error: TimeoutError: npm"]),   # t3 无成功组 → 不产出
        _traj("t4", "partial", ["error: X"]),        # partial 不进对比组
    ]
    lessons = contrastive_lessons_from_trajectories(trajs)
    assert [l.task_id for l in lessons] == ["t1"]
    assert lessons[0].kind == "contrastive_failure"
    assert "TimeoutError" in lessons[0].content


def test_mine_min_group_size_gate():
    # min_fail=2: t1 只有 1 条失败轨迹 → 被门槛拦下
    trajs = [
        _traj("t1", "pass", []),
        _traj("t1", "fail", ["error: TimeoutError: x"]),
    ]
    assert contrastive_lessons_from_trajectories(trajs, min_fail=2) == []
    assert len(contrastive_lessons_from_trajectories(trajs)) == 1
```

- [ ] **Step 2: 跑测试确认失败**（ImportError）

- [ ] **Step 3: 实现**

memory.py 末尾（`format_hints` 之后）追加：

```python
def contrastive_lessons_from_trajectories(trajectories, *,
                                          min_pass: int = 1, min_fail: int = 1,
                                          max_lessons_per_task: int = 3
                                          ) -> list[Lesson]:
    """轨迹级对比挖掘: 按 task 分组, pass/fail 双组齐备(达门槛)才做对比提取。

    partial 状态不进对比组（verifier 分数非 0/1, 语义模糊）。
    """
    passes: dict[str, list] = {}
    fails: dict[str, list] = {}
    for t in trajectories:
        msgs = getattr(t, "messages", None) or []
        if getattr(t, "status", "") == "pass":
            passes.setdefault(t.task_id, []).append(msgs)
        elif getattr(t, "status", "") == "fail":
            fails.setdefault(t.task_id, []).append(msgs)
    lessons: list[Lesson] = []
    for task_id in sorted(set(passes) & set(fails)):
        if len(passes[task_id]) >= min_pass and len(fails[task_id]) >= min_fail:
            lessons.extend(extract_contrastive_lessons(
                task_id, passes[task_id], fails[task_id],
                max_lessons=max_lessons_per_task))
    return lessons
```

```python
#!/usr/bin/env python3
# scripts/mine_lessons.py
"""对比经验挖掘 CLI（SP17）：harness-lab 真实轨迹 → 对比式 Lesson 清单。

对齐 ModularRSI 的对比蒸馏设定: 同任务成败对比提取系统缺陷信号,
跨任务投票过滤单任务噪声。只做只读分析, 不写训练管线。

用法:
  python3 scripts/mine_lessons.py                       # tb40 口径(默认, 无对比对)
  python3 scripts/mine_lessons.py --pattern '*'         # 全量 jobs(8 个对比组)
  python3 scripts/mine_lessons.py --pattern '*' --min-votes 2
"""
from __future__ import annotations

import argparse
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.harbor_collector import collect_jobs  # noqa: E402
from agenticx.learning.trajectory.memory import (        # noqa: E402
    Lesson, _vote_key, contrastive_lessons_from_trajectories,
)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs-dir", default="harness-lab/jobs")
    ap.add_argument("--pattern", default="*tb40*",
                    help="job 目录 glob（'*' 为全量含旧实验）")
    ap.add_argument("--min-votes", type=int, default=1,
                    help="跨任务票数门槛（1=不过滤）")
    ap.add_argument("--max-lessons", type=int, default=3)
    args = ap.parse_args()

    trajs = list(collect_jobs(Path(args.jobs_dir), job_pattern=args.pattern))
    passes = sum(1 for t in trajs if t.status == "pass")
    fails = sum(1 for t in trajs if t.status == "fail")
    print(f"轨迹 {len(trajs)} 条（pass {passes} / fail {fails}），"
          f"pattern={args.pattern!r}")

    lessons = contrastive_lessons_from_trajectories(
        trajs, max_lessons_per_task=args.max_lessons)
    print(f"对比式经验 {len(lessons)} 条\n")

    votes: Counter[str] = Counter()
    for l in lessons:
        votes[_vote_key(l.content)] += 1
    kept = [l for l in lessons
            if votes[_vote_key(l.content)] >= args.min_votes]
    for l in kept:
        v = votes[_vote_key(l.content)]
        tag = f" [跨 {v} 任务复现]" if v > 1 else ""
        print(f"- [{l.kind}] {l.task_id}{tag}: {l.content}")
    dropped = len(lessons) - len(kept)
    if args.min_votes > 1:
        print(f"\n票数门槛 min_votes={args.min_votes}: "
              f"保留 {len(kept)} / 丢弃 {dropped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 跑测试确认通过**（test_contrastive 8 PASS）+ 整目录回归无破坏

- [ ] **Step 5: 子代理跑一次真实数据验证**

```bash
python3 scripts/mine_lessons.py --pattern '*'
```

预期：170 轨迹（pass/fail 计数打印）、对比经验若干条（8 个对比组）、至少 1 条带"跨 N 任务复现"标签则投票机制在真实数据上生效。输出全文贴进报告。

- [ ] **Step 6: Commit**

```bash
git add agenticx/learning/trajectory/memory.py scripts/mine_lessons.py tests/trajectory/test_contrastive.py
git commit -m "feat(rsi): trajectory-level contrastive mining + CLI (SP17)"
```

---

### Task 3: 驱动器集成——投票过滤 hints + 对比感知提取

**前置:** Task 2 已合入。

**Files:**
- Modify: `scripts/rsi_explore.py`
- Test: `tests/trajectory/test_explore.py`（追加）

- [ ] **Step 1: 写失败测试（追加）**

```python
# --- SP17: 对比感知提取 + 投票过滤注入 ---
from agenticx.learning.trajectory.schema import RewardRecord, RSITrajectory


def _seed_pass_traj(store, task_name: str):
    store.append(RSITrajectory(
        source="history", task_id=task_name, session_id=f"hist-{task_name}",
        model="m", status="pass",
        reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "go"},
                  {"role": "tool", "content": "ok done"}]))


def test_round_uses_contrastive_when_history_mixed(tmp_path):
    """store 里 fakeA 已有 pass 轨迹, dry 失败(带 FileNotFoundError) → 走对比提取。"""
    from rsi_explore import run_round
    memory = ExperienceMemory(tmp_path / "experience" / "round_1.json")
    store = TrajectoryStore(tmp_path / "store")
    _seed_pass_traj(store, "fakeA")          # 历史成功且无报错

    rep = run_round(1, ["/tmp/fakeA"], memory, store,
                    trials_root=tmp_path / "trials", dry=True)
    kinds = [l["kind"] for l in
             __import__("json").loads(
                 (tmp_path / "experience" / "round_1.json").read_text())["lessons"]]
    assert "contrastive_failure" in kinds    # 失败独有报错被对比捕获
    assert rep["results"][0]["reward"] == 0.0


def test_min_votes_filters_hints(tmp_path):
    """dry 两任务同报 FileNotFoundError → 票数 2; min_votes=3 时 hints 为空。"""
    from rsi_explore import run_round
    tasks = ["/tmp/fakeA", "/tmp/fakeB"]
    for r in (1,):
        memory = ExperienceMemory(tmp_path / "experience" / f"round_{r}.json")
        store = TrajectoryStore(tmp_path / "store")
        run_round(r, tasks, memory, store,
                  trials_root=tmp_path / "trials", dry=True)

    store = TrajectoryStore(tmp_path / "store")
    m2 = ExperienceMemory(tmp_path / "experience" / "round_2.json")
    rep = run_round(2, tasks, m2, store,
                    trials_root=tmp_path / "trials", dry=True, min_votes=3)
    assert rep["results"][0]["hints"] == ""   # 票 2 < 3 → 全过滤

    m2b = ExperienceMemory(tmp_path / "experience" / "round_2b.json")
    rep2 = run_round(2, tasks, m2b, store,
                     trials_root=tmp_path / "trials", dry=True, min_votes=2)
    assert "FileNotFoundError" in rep2["results"][0]["hints"]  # 票 2 ≥ 2 → 注入
```

- [ ] **Step 2: 跑测试确认失败**（run_round 无 min_votes 参数 / kinds 无 contrastive_failure）

- [ ] **Step 3: 实现（rsi_explore.py 三处修改）**

1. import 行补 `voted_lessons` 与 `contrastive` 相关：

```python
from agenticx.learning.trajectory.memory import (     # noqa: E402
    ExperienceMemory, extract_contrastive_lessons, extract_lessons, format_hints,
)
```

2. `run_round` 签名加 `min_votes: int = 1`（放 `timeout` 之前，保持关键字参数风格）；hints 构建行改为：

```python
    if round_no > 1 and prev.exists():
        hints = format_hints(
            ExperienceMemory(prev).voted_lessons(min_votes=min_votes, k=8))
```

3. 任务循环内提取段（原 `lessons = extract_lessons(...)` 三行）改为：

```python
        task_trajs = [t for t in store.iter_trajectories()
                      if t.task_id == task_name]
        pass_msgs = [t.messages for t in task_trajs if t.status == "pass"]
        fail_msgs = [t.messages for t in task_trajs if t.status == "fail"]
        if pass_msgs and fail_msgs:
            # SP17: 同任务成败对比 → 缺陷信号（含当前 trial, 已 append）
            lessons = extract_contrastive_lessons(
                task_name, pass_msgs, fail_msgs)
        else:
            lessons = extract_lessons(task_name, reward >= 1.0, messages)
```

（注意：原 `messages` 变量来自 trial JSON 的读取，保持不动——先读 JSON 再走上述分支，`messages` 变量名沿用现有代码。）

4. `main()` 参数区追加：

```python
    ap.add_argument("--min-votes", type=int, default=1,
                    help="hints 注入的跨任务票数门槛（SP17）")
```

`run_round` 调用处透传 `min_votes=args.min_votes`。

- [ ] **Step 4: 跑测试确认通过**（test_explore 原 3 + 新 2 = 5 PASS）+ dry 命令行冒烟：

```bash
rm -rf /tmp/sp17_dry && python3 scripts/rsi_explore.py --dry --rounds 2 \
  --task /tmp/fakeA --task /tmp/fakeB --out /tmp/sp17_dry --min-votes 2
```

预期：第 2 轮 hints 含 FileNotFoundError（两任务同模式票数 2 ≥ 2）；再加 `--min-votes 3` 跑一次，第 2 轮 hints 应为空。

- [ ] **Step 5: Commit**

```bash
git add scripts/rsi_explore.py tests/trajectory/test_explore.py
git commit -m "feat(rsi): vote-filtered hints + contrastive-aware driver (SP17)"
```

---

## 完成定义

- 全量回归：`python3 -m pytest tests/rl/ tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib"` 全绿（基线 209，预计新增 ~10）
- 父代理亲自复验：git show --stat 每个 commit + 重跑测试 + `mine_lessons.py --pattern '*'` 真实数据输出
- 推送 `feat/rsi-data-flywheel`，PR #54 更新
- 向用户汇报：真实数据挖出的对比经验清单（8 个对比组的结果）+ 投票分布

## 方法论对标记录（写进最终汇报）

| ModularRSI 机制 | SP17 落地 |
|---|---|
| 对比蒸馏（同任务成败差异） | extract_contrastive_lessons |
| 跨任务投票定优先级 | votes 侧结构 + voted_lessons(min_votes) |
| Code-Modify Agent 结构化发现 | 未实现——规则式起步, Lesson.source="llm" 留口 |
| 三重验证门控 | 未实现——回放分数单门（P0.5 已有）, AST/执行门控记为后续项 |
| 演化数据与基准零重叠 | 未实现——我们的 8 组来自历史评测, 存在域内风险, 汇报需诚实标注 |
