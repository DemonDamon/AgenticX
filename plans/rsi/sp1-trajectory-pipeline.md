# SP1: 轨迹采集管道（②采集层）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 harbor TB 4.0 trial 与 AgenticX 会话两类轨迹源，统一解析为含决策沿袭的 `RSITrajectory`，写入去重的 jsonl 轨迹库。

**Architecture:** 纯离线解析（不改 runtime）——`agenticx/learning/trajectory/` 新包：schema 定义归一化轨迹模型，harbor/session 两个 collector 各自解析数据源，store 负责 sharding 写入 + trajectory_id 去重，CLI 收口。`trajectory_id = sha256(source|session_id|task_id|model)[:16]` 保证幂等。

**Tech Stack:** Python 3.12 stdlib（dataclasses/json/hashlib/pathlib），pytest。已验证数据格式：trial 的 `agent/agenticx.trajectory.json` 含 `{agent, model, success, output, error, iterations, messages, totals}`；`result.json` 含 `verifier_result.rewards.reward`。

---

### Task 1: RSITrajectory schema

**Files:**
- Create: `agenticx/learning/trajectory/__init__.py`（导出公共符号）
- Create: `agenticx/learning/trajectory/schema.py`
- Test: `tests/trajectory/test_schema.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_schema.py
from agenticx.learning.trajectory.schema import (
    RSITrajectory, RewardRecord, ToolCallRecord, DecisionStep,
)

def _traj():
    return RSITrajectory(
        source="harbor-tb40",
        task_id="fin-saccr-rwa",
        session_id="job1/fin-saccr-rwa__abc123",
        model="openai/glm-5.3-flash",
        status="pass",
        reward=RewardRecord(label=1.0, source="verifier", components={"verifier": 1.0}),
        messages=[{"role": "user", "content": "solve"}, {"role": "assistant", "content": "done"}],
        tool_calls=[ToolCallRecord(name="bash", arguments={"cmd": "ls"}, ok=True)],
        decision_lineage=[DecisionStep(kind="tool_call", ref="bash", note="列目录")],
        token_usage={"input": 100, "output": 50},
    )

def test_trajectory_id_is_stable_16char():
    t = _traj()
    assert len(t.trajectory_id) == 16
    assert t.trajectory_id == _traj().trajectory_id  # 同输入同 id

def test_trajectory_id_changes_with_task():
    t = _traj()
    t2 = _traj(); t2.task_id = "other"
    assert t.trajectory_id != t2.trajectory_id

def test_to_from_dict_roundtrip():
    t = _traj()
    d = t.to_dict()
    assert d["trajectory_id"] == t.trajectory_id
    t2 = RSITrajectory.from_dict(d)
    assert t2.trajectory_id == t.trajectory_id
    assert t2.reward.label == 1.0
    assert t2.tool_calls[0].name == "bash"
    assert t2.decision_lineage[0].kind == "tool_call"

def test_reward_sentinel_for_unlabeled():
    r = RewardRecord.unlabeled()
    assert r.label == -1.0 and r.source == "user" and r.components == {}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trajectory/test_schema.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/schema.py
"""RSI 轨迹归一化模型（②采集层）。

设计原则（飞书规划 2.3 节）：
- 决策沿袭：decision_lineage 记录知识引用/工具序列/验证/修正，不是裸三元组
- 复合 reward：components 为多源信号预留（P0 仅 verifier，运营商场景扩展 user/structural/kpi）
- label=-1.0 为"未标注"哨兵：session 轨迹无验证器，进库待标注，构建器只消费已标注轨迹
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any

@dataclass
class RewardRecord:
    label: float                                   # 0.0~1.0；-1.0=未标注
    source: str = "verifier"                       # verifier | user | composite
    components: dict[str, float] = field(default_factory=dict)

    @classmethod
    def unlabeled(cls) -> "RewardRecord":
        return cls(label=-1.0, source="user")

@dataclass
class ToolCallRecord:
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    ok: bool | None = None
    result_summary: str = ""                       # 截断至 500 字符

@dataclass
class DecisionStep:
    kind: str                                      # knowledge_ref|tool_call|verification|correction
    ref: str
    note: str = ""

@dataclass
class RSITrajectory:
    source: str                                    # harbor-tb40 | agenticx-session
    task_id: str
    session_id: str
    model: str
    status: str                                    # pass | fail | partial | unlabeled
    reward: RewardRecord
    messages: list[dict[str, Any]]
    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    decision_lineage: list[DecisionStep] = field(default_factory=list)
    token_usage: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def trajectory_id(self) -> str:
        basis = f"{self.source}|{self.session_id}|{self.task_id}|{self.model}"
        return hashlib.sha256(basis.encode()).hexdigest()[:16]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["trajectory_id"] = self.trajectory_id
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "RSITrajectory":
        d = {k: v for k, v in d.items() if k != "trajectory_id"}
        d["reward"] = RewardRecord(**d["reward"])
        d["tool_calls"] = [ToolCallRecord(**t) for t in d.get("tool_calls", [])]
        d["decision_lineage"] = [DecisionStep(**s) for s in d.get("decision_lineage", [])]
        return cls(**d)
```

`agenticx/learning/trajectory/__init__.py`:

```python
from .schema import RSITrajectory, RewardRecord, ToolCallRecord, DecisionStep

__all__ = ["RSITrajectory", "RewardRecord", "ToolCallRecord", "DecisionStep"]
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trajectory/test_schema.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/ tests/trajectory/test_schema.py
git commit -m "feat(rsi): add RSITrajectory schema with decision lineage and composite reward"
```

---

### Task 2: harbor trial 采集器

**Files:**
- Create: `agenticx/learning/trajectory/harbor_collector.py`
- Test: `tests/trajectory/test_harbor_collector.py`（含合成 trial fixture 工厂）

- [ ] **Step 1: 写失败测试**（fixture 按已验证的真实结构合成）

```python
# tests/trajectory/test_harbor_collector.py
import json
import pytest
from pathlib import Path
from agenticx.learning.trajectory.harbor_collector import collect_trial, collect_jobs

def make_trial(root: Path, task: str, suffix: str, reward: float, tool_calls=True) -> Path:
    trial = root / "agenticx-tb40-r1" / f"{task}__{suffix}"
    trial.mkdir(parents=True)
    json.dump({"task": {"name": f"terminal-bench/{task}"}}, open(trial / "config.json", "w"))
    json.dump(
        {"task_name": task, "verifier_result": {"rewards": {"reward": reward}},
         "exception_info": None, "started_at": "2026-09-01T00:00:00Z"},
        open(trial / "result.json", "w"),
    )
    agent = trial / "agent"
    agent.mkdir()
    messages = [
        {"role": "user", "content": f"solve {task}"},
        {"role": "assistant", "content": "thinking", "tool_calls": [
            {"id": "tc1", "type": "function",
             "function": {"name": "bash", "arguments": "{\"cmd\": \"ls\"}"}},
        ]},
        {"role": "tool", "tool_call_id": "tc1", "content": "file1\nfile2"},
        {"role": "assistant", "content": "done"},
    ]
    json.dump({"agent": "agenticx", "model": "openai/glm-5.3-flash", "success": reward == 1.0,
               "messages": messages, "totals": {"input_tokens": 1000, "output_tokens": 200},
               "iterations": 4},
              open(agent / "agenticx.trajectory.json", "w"))
    return trial

def test_collect_trial_pass(tmp_path):
    make_trial(tmp_path, "fin-saccr-rwa", "abc123", 1.0)
    t = collect_trial(next((tmp_path / "agenticx-tb40-r1").iterdir()))
    assert t is not None
    assert t.status == "pass"
    assert t.reward.label == 1.0 and t.reward.source == "verifier"
    assert t.task_id == "fin-saccr-rwa"
    assert t.model == "openai/glm-5.3-flash"
    assert t.tool_calls[0].name == "bash"
    assert t.tool_calls[0].ok is True
    assert any(s.kind == "verification" for s in t.decision_lineage)
    assert t.token_usage == {"input_tokens": 1000, "output_tokens": 200}

def test_collect_trial_fail(tmp_path):
    make_trial(tmp_path, "react-lead-form", "def456", 0.0)
    t = collect_trial(next((tmp_path / "agenticx-tb40-r1").iterdir()))
    assert t.status == "fail" and t.reward.label == 0.0

def test_collect_trial_partial(tmp_path):
    make_trial(tmp_path, "half-credit", "xyz", 0.5)
    t = collect_trial(next((tmp_path / "agenticx-tb40-r1").iterdir()))
    assert t.status == "partial" and t.reward.label == 0.5

def test_collect_trial_missing_result_returns_none(tmp_path):
    trial = make_trial(tmp_path, "no-result", "aaa", 1.0)
    (trial / "result.json").unlink()
    assert collect_trial(trial) is None

def test_collect_jobs_skips_broken_dirs(tmp_path):
    make_trial(tmp_path, "t1", "a1", 1.0)
    broken = tmp_path / "agenticx-broken-tb21mix-r1" / "t2__b2"
    broken.mkdir(parents=True)
    json.dump({"task": {"name": "t2"}}, open(broken / "config.json", "w"))
    json.dump({"verifier_result": {"rewards": {"reward": 1.0}}, "exception_info": None},
              open(broken / "result.json", "w"))
    trajs = list(collect_jobs(tmp_path, job_pattern="*tb40*"))
    assert [t.task_id for t in trajs] == ["t1"]
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trajectory/test_harbor_collector.py -v`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/harbor_collector.py
"""从 harbor job 目录解析 trial → RSITrajectory（②采集层，harbor 源）。

trial 结构（已验证）: jobs/<job>/<task>__<hash>/{config.json, result.json,
agent/agenticx.trajectory.json}
"""
from __future__ import annotations

import glob
import json
from pathlib import Path
from typing import Iterator

from .schema import DecisionStep, RewardRecord, RSITrajectory, ToolCallRecord

def _load_json(path: Path):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return None

def _extract_tool_calls(messages: list[dict]) -> list[ToolCallRecord]:
    """从消息中提取工具调用序列（OpenAI 格式），按 tool_call_id 配对结果。

    防御式解析：字段缺失/格式漂移时跳过该条而非崩溃。
    """
    calls: list[ToolCallRecord] = []
    pending: dict[str, ToolCallRecord] = {}
    for m in messages:
        if not isinstance(m, dict):
            continue
        for tc in m.get("tool_calls") or []:
            fn = tc.get("function") or {}
            name = fn.get("name") or "unknown"
            args = fn.get("arguments")
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except json.JSONDecodeError:
                    args = {"_raw": args[:200]}
            rec = ToolCallRecord(name=name, arguments=args if isinstance(args, dict) else {})
            calls.append(rec)
            if tc.get("id"):
                pending[tc["id"]] = rec
        if m.get("role") == "tool" and m.get("tool_call_id") in pending:
            rec = pending[m["tool_call_id"]]
            content = str(m.get("content") or "")
            rec.result_summary = content[:500]
            rec.ok = "error" not in content.lower()[:200]
    return calls

def _lineage(tool_calls: list[ToolCallRecord], reward: RewardRecord) -> list[DecisionStep]:
    steps = [DecisionStep(kind="tool_call", ref=c.name, note="") for c in tool_calls]
    steps.append(DecisionStep(kind="verification", ref=reward.source,
                              note=f"label={reward.label}"))
    return steps

def collect_trial(trial_dir: Path) -> RSITrajectory | None:
    trial_dir = Path(trial_dir)
    result = _load_json(trial_dir / "result.json")
    traj = _load_json(trial_dir / "agent" / "agenticx.trajectory.json")
    if result is None or traj is None:
        return None
    vr = (result.get("verifier_result") or {}).get("rewards") or {}
    label = float(vr.get("reward", -1.0))
    if label < 0:
        return None
    status = "pass" if label >= 1.0 else ("fail" if label <= 0.0 else "partial")
    messages = [m for m in (traj.get("messages") or []) if isinstance(m, dict)]
    tool_calls = _extract_tool_calls(messages)
    reward = RewardRecord(label=label, source="verifier", components={"verifier": label})
    cfg = _load_json(trial_dir / "config.json") or {}
    task_name = result.get("task_name") or cfg.get("task", {}).get("name", "").split("/")[-1]
    model = traj.get("model") or "unknown"
    return RSITrajectory(
        source="harbor-tb40",
        task_id=task_name,
        session_id=str(trial_dir),
        model=model,
        status=status,
        reward=reward,
        messages=messages,
        tool_calls=tool_calls,
        decision_lineage=_lineage(tool_calls, reward),
        token_usage=traj.get("totals") or {},
        created_at=result.get("started_at") or "",
        metadata={"agent": traj.get("agent"), "iterations": traj.get("iterations"),
                  "job": trial_dir.parent.name, "verifier_raw": vr},
    )

def collect_jobs(jobs_dir: Path, job_pattern: str = "*tb40*") -> Iterator[RSITrajectory]:
    """遍历 jobs/<job>/<trial>/，job_pattern 过滤（默认排除 broken-tb21mix 旧实验）。"""
    for trial in sorted(glob.glob(f"{Path(jobs_dir)}/{job_pattern}/*/")):
        t = collect_trial(Path(trial))
        if t is not None:
            yield t
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trajectory/test_harbor_collector.py -v`
Expected: 5 PASS

- [ ] **Step 5: 用真实数据冒烟**

Run: `python -c "from pathlib import Path; from agenticx.learning.trajectory.harbor_collector import collect_jobs; ts=list(collect_jobs(Path('harness-lab/jobs'))); print(len(ts), {t.status for t in ts}, ts[0].task_id if ts else '')"`
Expected: 非零条数，status 集合 ⊆ {pass, fail, partial}

- [ ] **Step 6: Commit**

```bash
git add agenticx/learning/trajectory/harbor_collector.py tests/trajectory/test_harbor_collector.py
git commit -m "feat(rsi): harbor trial collector with defensive tool-call extraction"
```

---

### Task 3: session 采集器

**Files:**
- Create: `agenticx/learning/trajectory/session_collector.py`
- Test: `tests/trajectory/test_session_collector.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_session_collector.py
import json
from pathlib import Path
from agenticx.learning.trajectory.session_collector import collect_session, collect_sessions

def make_session(root: Path, sid: str) -> Path:
    s = root / sid
    s.mkdir(parents=True)
    json.dump([{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
              open(s / "messages.json", "w"))
    json.dump([{"tool_name": "bash", "arguments": {"cmd": "ls"}, "success": True,
                "result": "ok"}],
              open(s / "tool_call_observations.json", "w"))
    return s

def test_collect_session_unlabeled(tmp_path):
    make_session(tmp_path, "s1")
    t = collect_session(tmp_path / "s1")
    assert t is not None
    assert t.status == "unlabeled"
    assert t.reward.label == -1.0 and t.reward.source == "user"
    assert t.source == "agenticx-session"
    assert t.task_id == "" and t.model == "unknown"
    assert t.tool_calls[0].name == "bash" and t.tool_calls[0].ok is True
    assert any(s.kind == "correction" for s in t.decision_lineage) is False

def test_collect_session_missing_messages_returns_none(tmp_path):
    (tmp_path / "empty").mkdir()
    assert collect_session(tmp_path / "empty") is None

def test_collect_sessions_yields_all(tmp_path):
    make_session(tmp_path, "s1"); make_session(tmp_path, "s2")
    assert len(list(collect_sessions(tmp_path))) == 2
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trajectory/test_session_collector.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/session_collector.py
"""AgenticX 会话目录 → RSITrajectory（②采集层，session 源）。

会话无验证器：reward=unlabeled 哨兵（-1.0），进库等待标注（运营商场景将接入
用户采纳/修正信号后回填 label）。observation 格式对齐 learning/observer.py。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from .schema import DecisionStep, RewardRecord, RSITrajectory, ToolCallRecord

def _load_json(path: Path, default):
    try:
        return json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return default

def collect_session(session_dir: Path) -> RSITrajectory | None:
    session_dir = Path(session_dir)
    messages = _load_json(session_dir / "messages.json", None)
    if not isinstance(messages, list) or not messages:
        return None
    observations = _load_json(session_dir / "tool_call_observations.json", [])
    tool_calls = [
        ToolCallRecord(
            name=o.get("tool_name", "unknown"),
            arguments=o.get("arguments") or {},
            ok=bool(o.get("success")),
            result_summary=str(o.get("result", ""))[:500],
        )
        for o in observations if isinstance(o, dict)
    ]
    lineage = [DecisionStep(kind="tool_call", ref=c.name) for c in tool_calls]
    for o in observations:
        if isinstance(o, dict) and o.get("success") is False:
            lineage.append(DecisionStep(kind="correction", ref=o.get("tool_name", "?"),
                                        note="工具调用失败后重试/修正"))
            break
    return RSITrajectory(
        source="agenticx-session",
        task_id="",
        session_id=session_dir.name,
        model="unknown",                     # messages.json 不含模型信息，后续由 metadata 补
        status="unlabeled",
        reward=RewardRecord.unlabeled(),
        messages=[m for m in messages if isinstance(m, dict)],
        tool_calls=tool_calls,
        decision_lineage=lineage,
        metadata={"observations_available": bool(observations)},
    )

def collect_sessions(sessions_dir: Path) -> Iterator[RSITrajectory]:
    for d in sorted(Path(sessions_dir).iterdir()):
        if d.is_dir():
            t = collect_session(d)
            if t is not None:
                yield t
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trajectory/test_session_collector.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/session_collector.py tests/trajectory/test_session_collector.py
git commit -m "feat(rsi): session collector with unlabeled-reward sentinel"
```

---

### Task 4: 轨迹库（shard 写入 + 去重）

**Files:**
- Create: `agenticx/learning/trajectory/store.py`
- Test: `tests/trajectory/test_store.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_store.py
from agenticx.learning.trajectory.store import TrajectoryStore
from tests.trajectory.test_schema import _traj

def test_append_writes_and_dedups(tmp_path):
    store = TrajectoryStore(tmp_path)
    assert store.append(_traj()) == "written"
    assert store.append(_traj()) == "duplicate"      # 同 trajectory_id 幂等
    files = list(tmp_path.rglob("*.jsonl"))
    assert len(files) == 1
    lines = files[0].read_text().strip().splitlines()
    assert len(lines) == 1

def test_append_partitions_by_source_and_month(tmp_path):
    store = TrajectoryStore(tmp_path)
    t = _traj()
    store.append(t)
    rel = next((tmp_path).rglob("*.jsonl")).relative_to(tmp_path)
    assert rel.parts[0] == "harbor-tb40"

def test_iter_and_stats(tmp_path):
    store = TrajectoryStore(tmp_path)
    store.append(_traj())
    trajs = list(store.iter_trajectories())
    assert len(trajs) == 1 and trajs[0].trajectory_id == _traj().trajectory_id
    s = store.stats()
    assert s["total"] == 1 and s["by_status"] == {"pass": 1}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trajectory/test_store.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/store.py
"""轨迹库：按 <source>/<YYYYMM>/ 分片 jsonl 追加写，trajectory_id 索引去重。"""
from __future__ import annotations

import datetime
import json
from collections import Counter
from pathlib import Path
from typing import Iterator

from .schema import RSITrajectory

class TrajectoryStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.index_path = self.root / "_index.json"
        self._ids: set[str] = set(self._load_ids())

    def _load_ids(self) -> list[str]:
        try:
            return json.load(open(self.index_path))["ids"]
        except (OSError, json.JSONDecodeError, KeyError):
            return []

    def _save_ids(self) -> None:
        json.dump({"ids": sorted(self._ids)}, open(self.index_path, "w"))

    def _shard_path(self, traj: RSITrajectory) -> Path:
        month = (traj.created_at or "")[:7] or datetime.date.today().strftime("%Y-%m")
        d = self.root / traj.source / month
        d.mkdir(parents=True, exist_ok=True)
        return d / "traj.jsonl"

    def append(self, traj: RSITrajectory) -> str:
        tid = traj.trajectory_id
        if tid in self._ids:
            return "duplicate"
        path = self._shard_path(traj)
        with open(path, "a") as f:
            f.write(json.dumps(traj.to_dict(), ensure_ascii=False) + "\n")
        self._ids.add(tid)
        self._save_ids()
        return "written"

    def iter_trajectories(self, source: str | None = None) -> Iterator[RSITrajectory]:
        pattern = f"{source}/**/*.jsonl" if source else "**/*.jsonl"
        for path in sorted(self.root.glob(pattern)):
            for line in open(path):
                line = line.strip()
                if line:
                    yield RSITrajectory.from_dict(json.loads(line))

    def stats(self) -> dict:
        trajs = list(self.iter_trajectories())
        return {
            "total": len(trajs),
            "by_status": dict(Counter(t.status for t in trajs)),
            "by_source": dict(Counter(t.source for t in trajs)),
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trajectory/test_store.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/store.py tests/trajectory/test_store.py
git commit -m "feat(rsi): append-only trajectory store with id-index dedup"
```

---

### Task 5: CLI 收口

**Files:**
- Create: `agenticx/learning/trajectory/__main__.py`
- Test: `tests/trajectory/test_cli.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_cli.py
import json
import subprocess
import sys
from pathlib import Path
from tests.trajectory.test_harbor_collector import make_trial

def run_cli(*args):
    return subprocess.run(
        [sys.executable, "-m", "agenticx.learning.trajectory", *args],
        capture_output=True, text=True,
    )

def test_collect_harbor_and_stats(tmp_path):
    jobs = tmp_path / "jobs"; out = tmp_path / "store"
    make_trial(jobs, "t1", "a1", 1.0)
    r = run_cli("collect", "--source", "harbor", "--jobs-dir", str(jobs),
                "--out", str(out))
    assert r.returncode == 0, r.stderr
    assert '"written": 1' in r.stdout
    r2 = run_cli("stats", "--store", str(out))
    assert '"total": 1' in r2.stdout
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trajectory/test_cli.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/__main__.py
"""②采集层 CLI。

用法:
  python -m agenticx.learning.trajectory collect --source harbor --jobs-dir harness-lab/jobs --out datasets/trajectories
  python -m agenticx.learning.trajectory collect --source session --sessions-dir ~/.agenticx/sessions --out datasets/trajectories
  python -m agenticx.learning.trajectory stats --store datasets/trajectories
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .harbor_collector import collect_jobs
from .session_collector import collect_sessions
from .store import TrajectoryStore

def _cmd_collect(args) -> int:
    store = TrajectoryStore(Path(args.out))
    if args.source == "harbor":
        trajs = collect_jobs(Path(args.jobs_dir), job_pattern=args.pattern)
    else:
        trajs = collect_sessions(Path(args.sessions_dir))
    written = duplicates = 0
    for t in trajs:
        r = store.append(t)
        written += r == "written"
        duplicates += r == "duplicate"
    print(json.dumps({"written": written, "duplicate": duplicates}, ensure_ascii=False))
    return 0

def _cmd_stats(args) -> int:
    print(json.dumps(TrajectoryStore(Path(args.store)).stats(), ensure_ascii=False, indent=2))
    return 0

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="agenticx.learning.trajectory")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--source", choices=["harbor", "session"], required=True)
    c.add_argument("--jobs-dir", default="harness-lab/jobs")
    c.add_argument("--pattern", default="*tb40*")
    c.add_argument("--sessions-dir", default="~/.agenticx/sessions")
    c.add_argument("--out", default="datasets/trajectories")
    c.set_defaults(func=_cmd_collect)
    s = sub.add_parser("stats")
    s.add_argument("--store", default="datasets/trajectories")
    s.set_defaults(func=_cmd_stats)
    args = ap.parse_args(argv)
    return args.func(args)

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trajectory/ -v`
Expected: 全部 PASS（schema 4 + harbor 5 + session 3 + store 3 + cli 1）

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/__main__.py tests/trajectory/test_cli.py
git commit -m "feat(rsi): trajectory collection CLI (harbor + session sources)"
```
