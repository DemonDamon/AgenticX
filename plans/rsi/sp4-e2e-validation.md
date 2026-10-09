# SP4: 端到端验收（真实数据冒烟 + PR 准备）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用真实 harness-lab TB 4.0 数据把 ②采集→④蒸馏→⑥回灌 全链路跑通一遍，产出首个可训练数据集与注册表条目，验证 MASTER-PLAN 验收标准。

**Architecture:** 无新模块——只做真实数据冒烟、验收断言、全量测试回归与 PR 准备。产出物（datasets/、注册表）不入库（加入 .gitignore），card 例外（小型、可评审）。

**前置:** SP1、SP2、SP3 全部完成。

---

### Task 1: 真实数据全链路冒烟

**Files:**
- Create: `scripts/rsi_smoke.sh`

- [ ] **Step 1: 写冒烟脚本**

```bash
#!/usr/bin/env bash
# RSI 数据飞轮 P0 端到端冒烟（真实 harness-lab 数据）
set -euo pipefail
cd "$(dirname "$0")/.."

STORE=datasets/trajectories
DS=datasets

echo "== ②采集: harbor jobs → 轨迹库 =="
python3 -m agenticx.learning.trajectory collect --source harbor \
    --jobs-dir harness-lab/jobs --out "$STORE"
python3 -m agenticx.learning.trajectory stats --store "$STORE"

echo "== ④蒸馏: 轨迹库 → SFT / DPO =="
python3 -m agenticx.trainer build --store "$STORE" --format sft \
    --out "$DS" --name tb40-sft-v1
python3 -m agenticx.trainer build --store "$STORE" --format dpo \
    --out "$DS" --name tb40-dpo-v1

echo "== ⑥回灌: 注册表生命周期 =="
REG=$(mktemp -d)/models.json
python3 -m agenticx.trainer registry register agent-coding-v1 \
    --model openai/glm-5.3-flash-sft-v1 --backend litellm --registry "$REG"
python3 -m agenticx.trainer registry promote agent-coding-v1 --registry "$REG"
python3 -m agenticx.trainer registry resolve agent-coding-v1 --registry "$REG"

echo "== 完成：datasets/ 下的 jsonl + card 可直接交 LLaMA-Factory =="
```

- [ ] **Step 2: 跑通脚本**

Run: `chmod +x scripts/rsi_smoke.sh && bash scripts/rsi_smoke.sh`
Expected: collect 输出 written 数（真实 jobs 下应为数十条）；stats 的 by_status 含 pass/fail；SFT/DPO 样本数 > 0；resolve 输出 `glm-5.3-flash-sft-v1`

- [ ] **Step 3: 人工抽查数据质量**

Run: `python3 -c "
import json, itertools
lines = list(itertools.islice(open('datasets/tb40-sft-v1.jsonl'), 3))
for l in lines:
    s = json.loads(l)
    print(len(s['conversations']), 'turns |', s['conversations'][-1]['value'][:80])
"`
Expected: 每条多轮对话完整、无 [REDACTED] 之外的密钥残留、终答非空

- [ ] **Step 4: Commit**

```bash
git add scripts/rsi_smoke.sh
git commit -m "feat(rsi): end-to-end smoke script for the P0 data flywheel"
```

---

### Task 2: 验收断言 + 回归

**Files:**
- Create: `tests/trainer/test_acceptance.py`

- [ ] **Step 1: 写验收测试（对应 MASTER-PLAN 验收标准）**

```python
# tests/trainer/test_acceptance.py
"""P0 验收：四条链路断言（用合成数据，CI 可跑）。"""
import json
from pathlib as Path
```

（注意：正确写法如下，执行者直接使用）

```python
# tests/trainer/test_acceptance.py
import json
from pathlib import Path

from agenticx.learning.trajectory.store import TrajectoryStore
from agenticx.trainer.builders import build_sft
from agenticx.trainer.exporters import export_llama_factory, write_card
from agenticx.trainer.heldout import heldout_split
from agenticx.trainer.registry import ModelRegistry
from tests.trajectory.test_schema import _traj

def test_acceptance_pipeline_synthetic(tmp_path):
    # ② 采集入库
    store = TrajectoryStore(tmp_path / "store")
    assert store.append(_traj()) == "written"
    # ④ 蒸馏 + 导出（ratio=0 → 无 heldout）
    trajs = list(store.iter_trajectories())
    split = heldout_split([t.task_id for t in trajs], ratio=0.0)
    samples = build_sft(trajs, split)
    assert samples, "SFT 构建不得为空"
    export_llama_factory(samples, tmp_path / "ds", "acc-sft")
    info = json.load(open(tmp_path / "ds" / "dataset_info.json"))
    assert info["acc-sft"]["formatting"] == "sharegpt"   # LLaMA-Factory 可加载
    # ③ card 溯源
    write_card(tmp_path / "ds", name="acc-sft", kind="sft", n_samples=len(samples),
               tasks=list(split.train), heldout=list(split.heldout), scrub_hits=0)
    assert (tmp_path / "ds" / "acc-sft.card.md").exists()
    # ⑥ 注册表生命周期
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("agent-coding-v1", model_spec="openai/glm-5.3-flash-sft-v1")
    reg.promote("agent-coding-v1")
    assert reg.resolve("agent-coding-v1")["model"] == "openai/glm-5.3-flash-sft-v1"
    reg.rollback("agent-coding-v1")  # 单版本回滚后无 promoted → 可 LookupError，不 crash 流程

def test_heldout_guard_blocks_contamination(tmp_path):
    store = TrajectoryStore(tmp_path / "store")
    store.append(_traj())            # task_id=fin-saccr-rwa
    trajs = list(store.iter_trajectories())
    split = heldout_split([t.task_id for t in trajs], seed="force-heldout", ratio=1.0)
    from agenticx.trainer.heldout import HeldoutViolation
    import pytest
    with pytest.raises(HeldoutViolation):
        build_sft(trajs, split)      # held-out 任务必须被硬性拒绝
```

- [ ] **Step 2: 跑验收 + 全量回归**

Run: `python -m pytest tests/trainer/test_acceptance.py -v && python -m pytest tests/trajectory/ tests/trainer/ -v`
Expected: 验收 2 PASS；SP1-SP3 全部测试 PASS

- [ ] **Step 3: 全仓冒烟（防伤及存量功能）**

Run: `python -m pytest tests/ -x -q --ignore=tests/e2e 2>/dev/null || python -m pytest tests/ -x -q`
Expected: 与 main 基线一致（无新增失败；如存量本有失败，记录并只保证不新增）

- [ ] **Step 4: .gitignore 补充**

确认 `datasets/`、`datasets/trajectories/` 已忽略（若未忽略则追加到根 `.gitignore`）：

```
datasets/
```

- [ ] **Step 5: Commit**

```bash
git add tests/trainer/test_acceptance.py .gitignore
git commit -m "test(rsi): P0 acceptance tests — pipeline, guard, registry lifecycle"
```

---

### Task 3: 分支收尾

- [ ] **Step 1: 检视提交历史**

Run: `git log main..feat/rsi-data-flywheel --oneline`
Expected: 约 12-14 个提交，每个对应一个 plan task，无混合提交

- [ ] **Step 2: 推送分支**

```bash
git push -u origin feat/rsi-data-flywheel
```

- [ ] **Step 3: 向用户汇报验收结果**（样本数、任务覆盖、held-out 数量、注册表冒烟输出），询问是否创建 PR —— 未经确认不建 PR

---

## 完成定义（DoD）

- [ ] `bash scripts/rsi_smoke.sh` 在真实 harness-lab jobs 数据上全绿
- [ ] `datasets/tb40-sft-v1.jsonl` 至少含 1 条真实 pass 轨迹样本，LLaMA-Factory dataset_info 注册成功
- [ ] held-out 守卫测试证明污染路径被硬性阻断
- [ ] `resolve(agent-coding-v1)` 返回 promoted 版本
- [ ] 全部单测通过，无存量回归
- [ ] 分支已推送，PR 待用户确认
