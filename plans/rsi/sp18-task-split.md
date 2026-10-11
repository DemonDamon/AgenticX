# SP18: RL 训练/评测任务集拆分（数据集就位）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 harness-lab/terminal-bench/ 的 66 个任务拆成「RL 训练题库 / TB 4.0 held-out 考试集」两个物理隔离的名单，落成数据集配置文件 + 守卫接线 + 验证 CLI。做完后训练侧数据集就位，只差 GPU 机。

**设计决策:**
- 复用 `agenticx/trainer/heldout.py` 的 `heldout_split`（sha256 确定性，seed="tb40-v1"，ratio=0.2）——不发明第二套拆分逻辑，与 P0 评测隔离同源
- 拆分结果写死进 `datasets/task_split.json`（checked-in 产物：名单是确定性的，但显式落盘让人类可审计、工具可读取，不依赖 rehash）
- 新增 `agenticx/learning/trajectory/task_split.py`：加载/查询/守卫薄层——`load_split()`、`is_eval_task()`、`assert_trainable_task()`（wrap 已有 HeldoutViolation）
- `rsi_explore.py` 驱动器接线：任务进自探索前过守卫，考试题被拒之门外（响亮报错）
- 新 CLI `scripts/check_task_split.py`：打印两份名单 + 数量 + 交集空校验（自检工具，机子到位后第一步就跑它）
- **诚实边界**：66 题 → 约 53 训练 / 13 考试。训练题量对 GRPO 偏少（见 SP17 汇报），合成任务扩充记为后续 SP；本 SP 只做拆分与隔离，不解决题量

**Tech Stack:** Python 3.13, 零新依赖。单 task 量级，父代理直接执行。

---

### Task 1: task_split 薄层 + 配置落盘 + 驱动器守卫接线

**Files:**
- Create: `agenticx/learning/trajectory/task_split.py`、`scripts/check_task_split.py`、`datasets/task_split.json`
- Modify: `scripts/rsi_explore.py`（守卫接线）
- Test: `tests/trajectory/test_task_split.py`

- [ ] **Step 1: 生成拆分配置**（一次性，脚本内联生成后落盘）

```python
# 生成逻辑（跑一次落盘 datasets/task_split.json）
from pathlib import Path
from agenticx.trainer.heldout import heldout_split
task_ids = sorted(p.name for p in Path("harness-lab/terminal-bench").iterdir() if p.is_dir())
split = heldout_split(task_ids, seed="tb40-v1", ratio=0.2)
import json
Path("datasets").mkdir(exist_ok=True)
Path("datasets/task_split.json").write_text(json.dumps({
    "seed": split.seed, "ratio": split.ratio,
    "train": list(split.train), "heldout": list(split.heldout),
    "source_dir": "harness-lab/terminal-bench",
}, ensure_ascii=False, indent=2))
print(f"train={len(split.train)} heldout={len(split.heldout)}")
```

- [ ] **Step 2: 写失败测试**

```python
# tests/trajectory/test_task_split.py
"""任务集拆分守卫（SP18）：考试题禁止进训练侧。"""
import json
import pytest
from agenticx.learning.trajectory.task_split import (
    assert_trainable_task, is_eval_task, load_split,
)


def test_load_split_from_checked_in_config():
    split = load_split()                      # 读 datasets/task_split.json
    assert len(split["train"]) + len(split["heldout"]) == len(set(
        split["train"]) | set(split["heldout"]))   # 无重复
    assert split["seed"] == "tb40-v1" and split["ratio"] == 0.2


def test_eval_task_rejected_loudly():
    split = load_split()
    eval_task = split["heldout"][0]
    assert is_eval_task(eval_task, split)
    with pytest.raises(Exception, match="held-out"):
        assert_trainable_task(eval_task, split)


def test_train_task_passes():
    split = load_split()
    assert not is_eval_task(split["train"][0], split)
    assert_trainable_task(split["train"][0], split)   # 不抛即过


def test_unknown_task_rejected():
    split = load_split()
    with pytest.raises(ValueError, match="不在任务名单"):
        assert_trainable_task("never-existed-task", split)
```

- [ ] **Step 3: 实现 task_split.py**

```python
# agenticx/learning/trajectory/task_split.py
"""任务集拆分查询/守卫薄层（SP18）。

数据源: datasets/task_split.json（checked-in, 由 heldout_split 确定性生成）。
考试题（heldout）禁止进入任何训练/自探索环节——与 trainer.heldout 同红线。
"""
from __future__ import annotations

import json
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_CONFIG = _REPO_ROOT / "datasets" / "task_split.json"


def load_split(path: Path | None = None) -> dict:
    p = Path(path) if path else _DEFAULT_CONFIG
    data = json.loads(p.read_text())
    for key in ("seed", "ratio", "train", "heldout"):
        if key not in data:
            raise ValueError(f"拆分配置缺字段 {key}: {p}")
    return data


def is_eval_task(task_name: str, split: dict) -> bool:
    return task_name in split["heldout"]


def assert_trainable_task(task_name: str, split: dict) -> None:
    all_tasks = set(split["train"]) | set(split["heldout"])
    if task_name not in all_tasks:
        raise ValueError(
            f"task '{task_name}' 不在任务名单（66 题拆分, seed={split['seed']}）——"
            f"先确认任务目录存在, 或重新生成 datasets/task_split.json")
    if is_eval_task(task_name, split):
        # 复用 P0 的评测隔离异常语义
        from agenticx.trainer.heldout import HeldoutViolation
        raise HeldoutViolation(
            f"task '{task_name}' 在 held-out 考试集（seed={split['seed']}），"
            f"禁止进入训练/自探索数据")
```

- [ ] **Step 4: rsi_explore.py 守卫接线**

任务循环开头（`task_name` 赋值后、trial 执行前）加：

```python
        from agenticx.learning.trajectory.task_split import (
            assert_trainable_task, load_split,
        )
        assert_trainable_task(task_name, load_split())
```

（import 放函数内保持脚本零启动成本；dry 模式同样过守卫——fakeA/fakeB 不在 66 题名单会报"不在任务名单"，所以 dry 测试改用名单内训练题目录名，或 dry 路径注入 `--skip-split-guard` 开关。**采用后者**：`main()` 加 `--skip-split-guard`（默认 False），dry 冒烟与既有单测用它绕过，真跑永远过守卫。）

- [ ] **Step 5: check CLI**

```python
#!/usr/bin/env python3
# scripts/check_task_split.py
"""任务集拆分自检（SP18）：两份名单 + 数量 + 交集空 + 目录存在性。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agenticx.learning.trajectory.task_split import load_split  # noqa: E402


def main() -> int:
    split = load_split()
    src = Path(split["source_dir"])
    train, heldout = set(split["train"]), set(split["heldout"])
    overlap = train & heldout
    missing = [t for t in train | heldout if not (src / t).is_dir()]

    print(f"seed={split['seed']} ratio={split['ratio']}")
    print(f"训练题 {len(train)} 个 / 考试题 {len(heldout)} 个 / 合计 {len(train | heldout)}")
    print(f"\n[考试题·held-out·禁止训练]")
    for t in sorted(heldout):
        print(f"  {t}")
    print(f"\n[交集] {sorted(overlap) if overlap else '空 ✓'}")
    print(f"[目录缺失] {missing if missing else '无 ✓'}")
    return 1 if (overlap or missing) else 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 6: 跑测试 + CLI + 既有测试回归 + dry 冒烟守卫**

```bash
python3 -m pytest tests/trajectory/test_task_split.py -v -o addopts="--import-mode=importlib"
python3 scripts/check_task_split.py
python3 -m pytest tests/trajectory/ -o addopts="--import-mode=importlib" 2>&1 | tail -1
python3 scripts/rsi_explore.py --dry --rounds 1 --task /tmp/fakeA --out /tmp/sp18_dry 2>&1 | tail -2   # 应报"不在任务名单"
python3 scripts/rsi_explore.py --dry --rounds 1 --task /tmp/fakeA --out /tmp/sp18_dry --skip-split-guard 2>&1 | tail -2  # 应正常跑完
```

- [ ] **Step 7: Commit**

```bash
git add agenticx/learning/trajectory/task_split.py scripts/check_task_split.py scripts/rsi_explore.py datasets/task_split.json tests/trajectory/test_task_split.py
git commit -m "feat(rsi): train/eval task split with guard rails (SP18)"
```

---

## 完成定义

- check CLI 输出两份名单（人类可审计）+ 交集空 + 目录齐全
- 全量回归绿；rsi_explore 真跑路径强制过守卫
- push + 汇报：考试题名单（哪些题被锁）、训练题数量、诚实边界（题量问题仍待合成任务 SP）
