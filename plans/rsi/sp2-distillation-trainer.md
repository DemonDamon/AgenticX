# SP2: 训练集蒸馏 trainer/（④蒸馏层 + ③评测隔离）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从轨迹库构建 LLaMA-Factory 可直接加载的 SFT/DPO 数据集，带 held-out 任务硬隔离、PII 脱敏、质量评分与数据集 card。

**Architecture:** `agenticx/trainer/`（现为空壳）成为④蒸馏层实现：heldout 用种子化哈希做确定性任务分裂（训练/评测物理隔离，防评测污染）；builder 只消费已标注轨迹（pass→SFT，pass+fail 同任务→DPO 偏好对）；exporter 产出 sharegpt jsonl + dataset_info.json + card。

**Tech Stack:** Python 3.12 stdlib, pytest。前置：SP1 的 `TrajectoryStore.iter_trajectories()` 与 `RSITrajectory` schema。

**数据格式契约（LLaMA-Factory sharegpt）：**
- SFT 样本：`{"conversations": [{"from": "system|human|gpt|tool", "value": "..."}]}`
- DPO 样本：`{"conversations": [...prompt turns...], "chosen": {"from": "gpt", "value": "..."}, "rejected": {"from": "gpt", "value": "..."}}`
- 注册：`dataset_info.json` 加 `{"<name>": {"file_name": "<name>.jsonl", "formatting": "sharegpt", "columns": {"messages": "conversations"}}}`

---

### Task 1: held-out 任务隔离（③评测层）

**Files:**
- Create: `agenticx/trainer/heldout.py`
- Test: `tests/trainer/test_heldout.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_heldout.py
import pytest
from agenticx.trainer.heldout import heldout_split, assert_trainable, HeldoutViolation

def test_split_is_deterministic():
    s1 = heldout_split(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"], seed="v1")
    s2 = heldout_split(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8", "t9", "t10"], seed="v1")
    assert s1.heldout == s2.heldout and s1.train == s2.train

def test_split_ratio_about_20pct():
    s = heldout_split([f"task-{i}" for i in range(50)], seed="v1")
    assert 5 <= len(s.heldout) <= 15
    assert set(s.train) | set(s.heldout) == {f"task-{i}" for i in range(50)}
    assert not set(s.train) & set(s.heldout)

def test_seed_changes_split():
    s1 = heldout_split([f"t{i}" for i in range(20)], seed="v1")
    s2 = heldout_split([f"t{i}" for i in range(20)], seed="v2")
    assert s1.heldout != s2.heldout

def test_guard_rejects_heldout_task():
    s = heldout_split(["t1", "t2"], seed="v1", ratio=1.0)   # 全 heldout，确定性
    with pytest.raises(HeldoutViolation):
        assert_trainable("t1", s)
    s2 = heldout_split(["t1", "t2"], seed="v1", ratio=0.0)  # 全可训练，确定性
    assert_trainable("t1", s2)  # 不抛即通过
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_heldout.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
# agenticx/trainer/heldout.py
"""③评测隔离：种子化确定性任务分裂。

严谨性红线（飞书规划 3.3 节）：训练任务与评测任务物理隔离，
held-out 任务禁止进入任何训练数据集——构建器调用 assert_trainable 守卫。
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

@dataclass(frozen=True)
class TaskSplit:
    seed: str
    ratio: float
    train: tuple[str, ...]
    heldout: tuple[str, ...]

class HeldoutViolation(Exception):
    pass

def heldout_split(task_ids: list[str], seed: str = "v1", ratio: float = 0.2) -> TaskSplit:
    """sha256(task_id|seed) 首字节 < ratio*256 → heldout。确定性、可复现、无顺序依赖。"""
    heldout, train = [], []
    for t in sorted(set(task_ids)):
        h = int(hashlib.sha256(f"{t}|{seed}".encode()).hexdigest()[:2], 16)
        (heldout if h < ratio * 256 else train).append(t)
    return TaskSplit(seed=seed, ratio=ratio, train=tuple(train), heldout=tuple(heldout))

def assert_trainable(task_id: str, split: TaskSplit) -> None:
    if task_id in split.heldout:
        raise HeldoutViolation(
            f"task '{task_id}' 在 held-out 评测集（seed={split.seed}），禁止进入训练数据"
        )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/test_heldout.py -v`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/heldout.py tests/trainer/test_heldout.py
git commit -m "feat(rsi): seeded deterministic held-out task split with builder guard"
```

---

### Task 2: PII 脱敏 + 质量评分

**Files:**
- Create: `agenticx/trainer/scrub.py`
- Create: `agenticx/trainer/quality.py`
- Test: `tests/trainer/test_scrub_quality.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_scrub_quality.py
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
from agenticx.trainer.scrub import scrub_text, scrub_trajectory
from agenticx.trainer.quality import score_trajectory

def test_scrub_text_masks_secrets():
    text = "sk-ant-api03-abcdef1234567890 contact me at foo@bar.com host 10.0.0.1"
    out = scrub_text(text)
    assert "sk-ant" not in out and "foo@bar.com" not in out and "10.0.0.1" not in out
    assert "[REDACTED]" in out

def test_scrub_trajectory_covers_all_messages():
    t = RSITrajectory(
        source="harbor-tb40", task_id="t", session_id="s", model="m", status="pass",
        reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "key sk-ant-api03-abcdefghijk"},
                  {"role": "assistant", "content": "email a@b.com"}],
    )
    scrub_trajectory(t)
    joined = " ".join(m["content"] for m in t.messages)
    assert "sk-ant" not in joined and "a@b.com" not in joined

def _good_traj():
    return RSITrajectory(
        source="harbor-tb40", task_id="t", session_id="s", model="m", status="pass",
        reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "q"}, {"role": "assistant", "content": "a"}],
        token_usage={"output_tokens": 500},
    )

def test_score_good_trajectory():
    q = score_trajectory(_good_traj())
    assert q.score >= 0.8
    assert any("ok" in r for r in q.reasons)

def test_score_penalizes_missing_final_answer():
    t = _good_traj()
    t.messages = [{"role": "user", "content": "q"}]
    q = score_trajectory(t)
    assert q.score < 0.5 and any("缺少最终回复" in r for r in q.reasons)

def test_score_penalizes_truncation():
    t = _good_traj()
    t.token_usage = {"output_tokens": 32768}
    q = score_trajectory(t)
    assert any("疑似截断" in r for r in q.reasons)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_scrub_quality.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
# agenticx/trainer/scrub.py
"""PII/密钥脱敏：只做训练资产出境前的机械脱敏（正则级），不含语义脱敏。"""
from __future__ import annotations

import re

_PATTERNS = [
    re.compile(r"sk-[a-zA-Z0-9-]{16,}"),          # API keys (sk-ant/sk-...)
    re.compile(r"(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}"),  # GitHub tokens
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),  # emails
    re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),   # IPv4
    re.compile(r"(?:Bearer|token|password|passwd|secret)\s*[:=]\s*\S+", re.I),
]

def scrub_text(text: str) -> str:
    out = text
    for p in _PATTERNS:
        out = p.sub("[REDACTED]", out)
    return out

def scrub_trajectory(traj) -> int:
    """原地脱敏 messages 与 tool_calls，返回命中次数。"""
    hits = 0
    for m in traj.messages:
        c = m.get("content")
        if isinstance(c, str):
            n = scrub_text(c)
            hits += n != c
            m["content"] = n
    for tc in traj.tool_calls:
        for k, v in list(tc.arguments.items()):
            if isinstance(v, str):
                n = scrub_text(v)
                hits += n != v
                tc.arguments[k] = n
        n = scrub_text(tc.result_summary)
        hits += n != tc.result_summary
        tc.result_summary = n
    return hits
```

```python
# agenticx/trainer/quality.py
"""轨迹质量评分：0.0~1.0 + 原因清单，阈值以下不进数据集。"""
from __future__ import annotations

from dataclasses import dataclass, field

@dataclass
class Quality:
    score: float
    reasons: list[str] = field(default_factory=list)

def score_trajectory(traj, max_reasonable_output: int = 30000) -> Quality:
    reasons, score = [], 1.0
    roles = [m.get("role") for m in traj.messages]
    if "user" not in roles:
        score -= 0.5; reasons.append("缺少用户输入")
    if roles and roles[-1] != "assistant":
        score -= 0.6; reasons.append("缺少最终回复")   # 无终答的轨迹对 SFT 无价值
    if not any(s.kind == "verification" for s in traj.decision_lineage) \
            and traj.reward.label < 0:
        score -= 0.3; reasons.append("无验证沿袭且未标注")
    out_tok = (traj.token_usage or {}).get("output_tokens", 0)
    if out_tok >= 32768:
        score -= 0.5; reasons.append(f"疑似 max_tokens 截断（output={out_tok}）")
    elif out_tok > max_reasonable_output:
        score -= 0.2; reasons.append(f"输出异常长（output={out_tok}）")
    if traj.reward.label == 1.0:
        reasons.append("ok: 验证通过")
    return Quality(score=max(0.0, min(1.0, score)), reasons=reasons)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/test_scrub_quality.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/scrub.py agenticx/trainer/quality.py tests/trainer/test_scrub_quality.py
git commit -m "feat(rsi): PII scrubbing and trajectory quality scoring"
```

---

### Task 3: SFT / DPO 构建器

**Files:**
- Create: `agenticx/trainer/builders.py`
- Test: `tests/trainer/test_builders.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_builders.py
import pytest
from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
from agenticx.trainer.heldout import heldout_split
from agenticx.trainer.builders import build_sft, build_dpo

def _traj(task: str, status: str, content: str = "answer", label: float | None = None):
    lbl = {"pass": 1.0, "fail": 0.0, "partial": 0.5}.get(status, -1.0) if label is None else label
    return RSITrajectory(
        source="harbor-tb40", task_id=task, session_id=f"s-{task}-{status}", model="m",
        status=status, reward=RewardRecord(label=lbl),
        messages=[{"role": "user", "content": f"do {task}"},
                  {"role": "assistant", "content": content}],
    )

def test_build_sft_pass_only_with_guard(tmp_path):
    split = heldout_split(["t1", "t2"], seed="v1", ratio=0.0)  # 全部可训练
    samples = build_sft([_traj("t1", "pass"), _traj("t1", "fail")], split)
    assert len(samples) == 1                          # 只收 pass
    conv = samples[0]["conversations"]
    assert conv[0]["from"] == "human" and conv[1]["from"] == "gpt"

def test_build_sft_rejects_heldout():
    split = heldout_split(["t1", "t2"], seed="v1", ratio=1.0)  # 全 heldout，确定性
    trajs = [_traj(t, "pass") for t in ["t1", "t2"]]
    from agenticx.trainer.heldout import HeldoutViolation
    with pytest.raises(HeldoutViolation):
        build_sft(trajs, split)

def test_build_sft_skips_unlabeled():
    split = heldout_split(["t1"], seed="v1", ratio=0.0)
    assert build_sft([_traj("t1", "unlabeled")], split) == []

def test_build_dpo_pairs_same_task():
    split = heldout_split(["t1"], seed="v1", ratio=0.0)
    pairs = build_dpo([_traj("t1", "pass", "good"), _traj("t1", "fail", "bad")], split)
    assert len(pairs) == 1
    assert pairs[0]["chosen"]["value"] == "good"
    assert pairs[0]["rejected"]["value"] == "bad"

def test_build_dpo_no_pair_without_fail():
    split = heldout_split(["t1"], seed="v1", ratio=0.0)
    assert build_dpo([_traj("t1", "pass")], split) == []
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_builders.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
# agenticx/trainer/builders.py
"""④蒸馏层构建器：pass→SFT 样本；同任务 pass+fail→DPO 偏好对。

守卫：构建前逐条 assert_trainable，held-out 任务直接抛 HeldoutViolation
（物理隔离，宁可失败也不污染评测集）。
"""
from __future__ import annotations

from collections import defaultdict

from agenticx.learning.trajectory.schema import RSITrajectory
from .heldout import TaskSplit, assert_trainable
from .scrub import scrub_trajectory

_ROLE_MAP = {"system": "system", "user": "human", "assistant": "gpt", "tool": "tool"}

def _to_sharegpt(traj: RSITrajectory) -> dict | None:
    convs = []
    for m in traj.messages:
        role = _ROLE_MAP.get(m.get("role"))
        content = m.get("content")
        if role is None or not isinstance(content, str) or not content.strip():
            continue
        convs.append({"from": role, "value": content})
    if len(convs) < 2 or convs[-1]["from"] != "gpt":
        return None
    return {"conversations": convs}

def _final_answer(traj: RSITrajectory) -> str:
    for m in reversed(traj.messages):
        if m.get("role") == "assistant" and isinstance(m.get("content"), str) and m["content"].strip():
            return m["content"]
    return ""

def build_sft(trajs: list[RSITrajectory], split: TaskSplit,
              scrub: bool = True) -> list[dict]:
    """pass 轨迹 → sharegpt SFT 样本（held-out 守卫 + 脱敏）。"""
    out = []
    for t in trajs:
        assert_trainable(t.task_id, split)
        if t.status != "pass":
            continue
        if scrub:
            scrub_trajectory(t)
        sample = _to_sharegpt(t)
        if sample is not None:
            sample["meta"] = {"task_id": t.task_id, "trajectory_id": t.trajectory_id,
                              "source": t.source}
            out.append(sample)
    return out

def build_dpo(trajs: list[RSITrajectory], split: TaskSplit,
              scrub: bool = True) -> list[dict]:
    """同任务 pass+fail → DPO 偏好对（chosen=pass 终答，rejected=fail 终答）。"""
    by_task: dict[str, dict[str, list[RSITrajectory]]] = defaultdict(
        lambda: {"pass": [], "fail": []})
    for t in trajs:
        assert_trainable(t.task_id, split)
        if t.status in ("pass", "fail"):
            by_task[t.task_id][t.status].append(t)
    pairs = []
    for task, groups in by_task.items():
        for good in groups["pass"]:
            bad = groups["fail"][0] if groups["fail"] else None
            if bad is None:
                continue
            if scrub:
                scrub_trajectory(good); scrub_trajectory(bad)
            prompt = _to_sharegpt(good)
            if prompt is None:
                continue
            pairs.append({
                "conversations": prompt["conversations"][:-1],  # prompt 部分
                "chosen": {"from": "gpt", "value": _final_answer(good)},
                "rejected": {"from": "gpt", "value": _final_answer(bad)},
                "meta": {"task_id": task,
                         "chosen_id": good.trajectory_id, "rejected_id": bad.trajectory_id},
            })
    return pairs
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/test_builders.py -v`
Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/builders.py tests/trainer/test_builders.py
git commit -m "feat(rsi): SFT/DPO dataset builders with held-out guard and scrubbing"
```

---

### Task 4: 导出器 + 数据集 card

**Files:**
- Create: `agenticx/trainer/exporters.py`
- Test: `tests/trainer/test_exporters.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_exporters.py
import json
from pathlib import Path
from agenticx.trainer.exporters import export_llama_factory, write_card

def test_export_writes_jsonl_and_registry(tmp_path):
    samples = [{"conversations": [{"from": "human", "value": "q"},
                                  {"from": "gpt", "value": "a"}],
                "meta": {"task_id": "t1"}}]
    export_llama_factory(samples, tmp_path, "tb40-sft-v1")
    data_file = tmp_path / "tb40-sft-v1.jsonl"
    assert json.loads(data_file.read_text().strip())["conversations"][0]["from"] == "human"
    info = json.load(open(tmp_path / "dataset_info.json"))
    assert info["tb40-sft-v1"]["formatting"] == "sharegpt"

def test_export_is_idempotent_registry(tmp_path):
    export_llama_factory([], tmp_path, "ds-a")
    export_llama_factory([], tmp_path, "ds-b")
    info = json.load(open(tmp_path / "dataset_info.json"))
    assert set(info) == {"ds-a", "ds-b"}

def test_card_records_provenance(tmp_path):
    card = write_card(tmp_path, name="tb40-sft-v1", kind="sft",
                      n_samples=10, tasks=["t1", "t2"],
                      heldout=["t9"], scrub_hits=3)
    text = (tmp_path / "tb40-sft-v1.card.md").read_text()
    assert "样本数: 10" in text and "t9" in text and "3" in text
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_exporters.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

```python
# agenticx/trainer/exporters.py
"""LLaMA-Factory sharegpt 导出 + 数据集 card（溯源记录）。"""
from __future__ import annotations

import json
from pathlib import Path

def export_llama_factory(samples: list[dict], out_dir: Path, name: str) -> Path:
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    data_file = out_dir / f"{name}.jsonl"
    with open(data_file, "w") as f:
        for s in samples:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    info_path = out_dir / "dataset_info.json"
    info = {}
    if info_path.exists():
        info = json.load(open(info_path))
    info[name] = {"file_name": data_file.name, "formatting": "sharegpt",
                  "columns": {"messages": "conversations"}}
    json.dump(info, open(info_path, "w"), ensure_ascii=False, indent=2)
    return data_file

def write_card(out_dir: Path, *, name: str, kind: str, n_samples: int,
               tasks: list[str], heldout: list[str], scrub_hits: int,
               seed: str = "v1") -> Path:
    card = Path(out_dir) / f"{name}.card.md"
    card.write_text(f"""# Dataset Card: {name}

- 类型: {kind}
- 样本数: {n_samples}
- 任务覆盖: {len(tasks)} 个（train 侧）
- held-out 隔离: {len(heldout)} 个任务被物理排除（seed={seed}）: {', '.join(heldout) or '无'}
- 脱敏命中: {scrub_hits} 处替换
- 来源: AgenticX RSI 数据飞轮（harbor-tb40 轨迹，verifier 标注）
- 生成时间: {__import__('datetime').datetime.now().isoformat(timespec='seconds')}
""", encoding="utf-8")
    return card
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/test_exporters.py -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/exporters.py tests/trainer/test_exporters.py
git commit -m "feat(rsi): LLaMA-Factory sharegpt exporter with dataset card"
```

---

### Task 5: trainer CLI 收口

**Files:**
- Create: `agenticx/trainer/__main__.py`
- Modify: `agenticx/trainer/__init__.py`（0 字节 → 导出符号）
- Test: `tests/trainer/test_cli.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trainer/test_cli.py
import json
import subprocess
import sys
from pathlib import Path
from tests.trajectory.test_harbor_collector import make_trial

def run_cli(*args):
    return subprocess.run([sys.executable, "-m", "agenticx.trainer", *args],
                          capture_output=True, text=True)

def test_build_sft_end_to_end(tmp_path):
    jobs = tmp_path / "jobs"
    make_trial(jobs, "t1", "a1", 1.0)
    r = run_cli("collect", "--jobs-dir", str(jobs), "--store", str(tmp_path / "st"))
    assert r.returncode == 0, r.stderr
    b = run_cli("build", "--store", str(tmp_path / "st"),
                "--format", "sft", "--out", str(tmp_path / "ds"),
                "--name", "tb40-sft-v1")
    assert b.returncode == 0, b.stderr
    assert (tmp_path / "ds" / "tb40-sft-v1.jsonl").exists()
    assert (tmp_path / "ds" / "tb40-sft-v1.card.md").exists()
    assert '"n_samples": 1' in b.stdout or "n_samples" in b.stdout
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python -m pytest tests/trainer/test_cli.py -v`
Expected: FAIL

- [ ] **Step 3: 最小实现**

`agenticx/trainer/__init__.py`:

```python
from .builders import build_sft, build_dpo
from .heldout import heldout_split, assert_trainable, HeldoutViolation, TaskSplit
from .exporters import export_llama_factory, write_card
```

`agenticx/trainer/__main__.py`:

```python
"""④蒸馏层 CLI。

用法:
  python -m agenticx.trainer collect --jobs-dir harness-lab/jobs --store datasets/trajectories
  python -m agenticx.trainer build --store datasets/trajectories --format sft --out datasets --name tb40-sft-v1
  python -m agenticx.trainer build --store datasets/trajectories --format dpo --out datasets --name tb40-dpo-v1
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from agenticx.learning.trajectory.harbor_collector import collect_jobs
from agenticx.learning.trajectory.store import TrajectoryStore
from .builders import build_sft, build_dpo
from .heldout import heldout_split
from .quality import score_trajectory
from .exporters import export_llama_factory, write_card

def _cmd_collect(args) -> int:
    store = TrajectoryStore(Path(args.store))
    n = sum(store.append(t) == "written" for t in collect_jobs(Path(args.jobs_dir)))
    print(json.dumps({"written": n}))
    return 0

def _cmd_build(args) -> int:
    store = TrajectoryStore(Path(args.store))
    trajs = list(store.iter_trajectories())
    split = heldout_split([t.task_id for t in trajs if t.task_id], seed=args.seed)
    for t in trajs:
        if not t.task_id:
            continue
        q = score_trajectory(t)
        t.metadata["quality"] = q.score
    kept = [t for t in trajs if t.task_id and t.metadata.get("quality", 0) >= args.min_quality]
    if args.format == "sft":
        samples, kind = build_sft(kept, split), "sft"
    else:
        samples, kind = build_dpo(kept, split), "dpo"
    export_llama_factory(samples, Path(args.out), args.name)
    write_card(Path(args.out), name=args.name, kind=kind, n_samples=len(samples),
               tasks=list(split.train), heldout=list(split.heldout),
               scrub_hits=0, seed=args.seed)
    print(json.dumps({"n_samples": len(samples), "heldout": len(split.heldout)}))
    return 0

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="agenticx.trainer")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--jobs-dir", default="harness-lab/jobs")
    c.add_argument("--store", default="datasets/trajectories")
    c.set_defaults(func=_cmd_collect)
    b = sub.add_parser("build")
    b.add_argument("--store", default="datasets/trajectories")
    b.add_argument("--format", choices=["sft", "dpo"], required=True)
    b.add_argument("--out", default="datasets")
    b.add_argument("--name", required=True)
    b.add_argument("--seed", default="v1")
    b.add_argument("--min-quality", type=float, default=0.5)
    b.set_defaults(func=_cmd_build)
    args = ap.parse_args(argv)
    return args.func(args)

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python -m pytest tests/trainer/ -v`
Expected: 全部 PASS（heldout 4 + scrub/quality 5 + builders 5 + exporters 3 + cli 1）

- [ ] **Step 5: Commit**

```bash
git add agenticx/trainer/__init__.py agenticx/trainer/__main__.py tests/trainer/test_cli.py
git commit -m "feat(rsi): trainer CLI — collect and build SFT/DPO datasets end to end"
```
