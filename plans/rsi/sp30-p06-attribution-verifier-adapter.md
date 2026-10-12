# SP30: RSI P0.6 — 经验归因 / 验证器监控 / 缺口派发 / 长时程 SLO / Adapter 契约 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. 所有步骤使用 checkbox 跟踪，TDD：先写失败测试，再实现。

**Goal:** 在 P0（采集→蒸馏→回灌骨架）与 P0.5（Dream-RSI 回放式策略演化）之上，补齐 2026-09~10 行业 RSI 实践对照后确认的六个软件缺口，使飞轮具备「知道哪条经验有用、知道验证器是否失真、知道该补什么能力、知道长任务断在哪、经验能按 adapter 粒度沉淀」的可度量能力。全部为硬件无关的软件层工作，零采购、零新重依赖。

**来源依据（2026-10 行业调研，决策必须可回溯到这些信号）：**
- MemoraX（机器之心）：Memory Credit Assignment 是记忆驱动 RSI 的核心难点；记忆版本×使用记录×任务结局归因；长程 Coding 通过率 +20%、Token -20%
- 华泰研报《RSI 走向真实研发》(2026-10-09)：验证器决定 RSI 上限（MiniMax MaxProof 误报率 2.9%→8.0%、输出变长/模板化）；4–8h 成功任务 50%+ 至少一次人工干预；跨代继承靠模型/记忆/Harness/Skeleton 载体
- 穆尧 SeeAct AI 访谈：能力拓展自顶向下（失败聚类→派发学习任务）、能力增强自底向上；critic ≠ reward model
- Macaron-V1（Mind Lab）：LoRA 成为经验积累基本单元（MoL，专家独立训练/热插拔）；路由即 Harness 层工具（无专用路由模型）；LongStraw 只重放学习相关片段
- AReaL 2.0（华为 INSPIRE）：共享前缀复用、稀疏权重传输——与 LongStraw 在两个独立来源收敛到「选择性重放」

**设计决策:**
1. **归因只做规则版，不训记忆模型。** join「路由事件（带版本）×任务结局」算 Beta 平滑后验胜率，产出账本文件；P1 若信号稳定再谈模型化（MemoraX 路线）
2. **验证器监控只读、只报警，不自动改奖励。** 监控结论进报告，是否修验证器由人决策——防止用一个失真的判别器去自动替换另一个
3. **缺口派发只产提案，不自动开训。** 失败聚类→提案 JSON 落 `datasets/gap_queue/`，人工 review 后才进任务池
4. **Adapter 本期只定契约 + 注册表 + manifest，不接推理路由、不接真实训练。** 价值在 schema 冻结前把 adapter 变一等公民；llm_factory 实际路由属 P1
5. **replay_spans 是派生量不是采集量。** 从 decision_lineage 计算消息区间，采集端零负担，P1 长轨迹 RL 消费
6. **held-out 红线不变。** 归因账本、漂移报告、adapter lineage 一律只能绑定 train 区任务；held-out 数据只允许出现在双判别验收报告里（复用 `trainer/heldout.py` 守卫语义）

**Tech Stack:** Python 3.13，零新重依赖（标准库 dataclass/json/argparse；统计用纯 Python Beta 平滑，不引 scipy）。多 task 量级，建议逐 task 开子代理；每个 task 独立可测、独立可 commit。

---

### Task 1: 路由事件入 lineage（schema 扩展 + 采集端约定）

**Files:**
- Modify: `agenticx/learning/trajectory/schema.py`（DecisionStep 扩展、新 kind 约定、向前兼容）
- Modify: `agenticx/learning/trajectory/harbor_collector.py`、`session_collector.py`（best-effort 抽取）
- Test: `tests/trajectory/test_routing_lineage.py`

- [ ] **Step 1: 失败测试**

```python
# tests/trajectory/test_routing_lineage.py
"""SP30 T1：memory/skill/adapter 选择必须作为带版本的路由事件进入 lineage。"""
from agenticx.learning.trajectory.schema import DecisionStep, RSITrajectory, RewardRecord


def _traj(lineage):
    return RSITrajectory(source="x", task_id="t", session_id="s", model="m",
                         status="pass", reward=RewardRecord(label=1.0),
                         messages=[{"role": "user", "content": "q"}],
                         decision_lineage=lineage)


def test_routing_step_carries_version_and_outcome():
    s = DecisionStep(kind="skill_select", ref="skill:finnews-pull@3",
                     version="3", outcome="used")
    assert s.kind in ("memory_recall", "skill_select", "adapter_route")
    assert s.version == "3" and s.outcome


def test_old_dict_without_new_fields_loads():
    # 旧轨迹无 version/outcome 字段，from_dict 必须向前兼容
    d = _traj([DecisionStep(kind="knowledge_ref", ref="doc-a")]).to_dict()
    rt = RSITrajectory.from_dict(d)
    assert rt.decision_lineage[0].version == ""
```

- [ ] **Step 2: 扩展 schema.py**

`DecisionStep` 增加两个带默认值字段（旧数据零损伤）：

```python
@dataclass
class DecisionStep:
    kind: str          # knowledge_ref|tool_call|verification|correction
                       # |memory_recall|skill_select|adapter_route（SP30 新增三类）
    ref: str           # memory:<id> | skill:<name>@<ver> | adapter:<alias>/<ver>
    note: str = ""
    version: str = ""          # SP30：被引用经验/技能/adapter 的版本
    outcome: str = ""          # SP30：used | ignored | harmful（采集端先只填 used/unknown）
```

模块 docstring 补一段「路由事件约定」：凡是 Harness 层选择记忆、技能、adapter 的动作，必须在 lineage 留痕；`ref` 用 URN 风格（`memory:`/`skill:`/`adapter:`），版本必填到能定位的粒度，拿不到版本填 `"unknown"` 不许空着——归因账本会把 unknown 单列，倒逼采集补齐。

- [ ] **Step 3: 采集端 best-effort 抽取**

不改造 agent 主循环。两个 collector 在归一化时，从已有 `tool_calls` 里识别路由类调用（工具名匹配 `memory`/`recall`/`skill`/`adapter` 关键词，大小写不敏感），转成对应 kind 的 DecisionStep；同时在两个 collector 模块各暴露一个小 helper：

```python
def routing_step(kind: str, ref: str, *, version: str = "unknown",
                 outcome: str = "used", note: str = "") -> DecisionStep
```

供后续主动埋点调用（P1 全量埋点，本期只留入口）。抽取不到时不造假事件。

- [ ] **Step 4: 验证**

```bash
python3 -m pytest tests/trajectory/test_routing_lineage.py -v -o addopts="--import-mode=importlib"
python3 -m pytest tests/rl tests/trajectory -o addopts="--import-mode=importlib" 2>&1 | tail -1
# 真实数据冒烟：现有 harbor jobs 抽一遍，打印路由事件计数（允许为 0，但不许报错）
python3 -m agenticx.learning.trajectory collect --source harbor --jobs-dir harness-lab/jobs --out /tmp/sp30_t1 2>&1 | tail -3
```

- [ ] **Step 5: Commit** `feat(rsi): versioned routing events in decision lineage (SP30 T1)`

---

### Task 2: 经验贡献归因账本（Memory/Skill Credit Assignment，规则版）

**Files:**
- Create: `agenticx/learning/attribution.py`
- Create: `scripts/credit_report.py`
- Test: `tests/trajectory/test_attribution.py`

- [ ] **Step 1: 失败测试**

```python
# tests/trajectory/test_attribution.py
"""SP30 T2：路由事件 × 结局 → 每条经验的后验胜率账本。"""
import pytest
from agenticx.learning.attribution import AttributionLedger, credit_trajectory
from agenticx.learning.trajectory.schema import (
    DecisionStep, RSITrajectory, RewardRecord)


def traj(status, label, refs):
    return RSITrajectory(
        source="harbor-tb40", task_id="t", session_id=id(status), model="m",
        status=status, reward=RewardRecord(label=label),
        messages=[{"role": "user", "content": "q"}],
        decision_lineage=[DecisionStep(kind=k, ref=r, version=v)
                          for k, r, v in refs])


def test_posterior_winrate_with_beta_smoothing_and_unknown_bucket():
    led = AttributionLedger()
    credit_trajectory(led, traj("pass", 1.0, [
        ("skill_select", "skill:a@1", "1"),
        ("memory_recall", "memory:b", "unknown")]))
    credit_trajectory(led, traj("fail", 0.0, [
        ("skill_select", "skill:a@1", "1")]))
    row_a = led.row("skill:a@1")
    assert row_a.uses == 2 and row_a.pass_count == 1
    # Beta(1,1) 平滑：(1+1)/(2+2)=0.5，不许裸除
    assert row_a.winrate == pytest.approx(0.5)
    unk = [r for r in led.rows if r.version == "unknown"]
    assert unk and unk[0].uses == 1


def test_unlabeled_trajectory_excluded():
    led = AttributionLedger()
    credit_trajectory(led, traj("unlabeled", -1.0, [
        ("skill_select", "skill:a@1", "1")]))
    assert led.row("skill:a@1") is None


def test_heldout_trajectory_rejected():
    from agenticx.trainer.heldout import HeldoutViolation
    led = AttributionLedger(heldout_tasks={"t"})
    with pytest.raises(HeldoutViolation):
        credit_trajectory(led, traj("pass", 1.0, [
            ("skill_select", "skill:a@1", "1")]))
```

- [ ] **Step 2: 实现 attribution.py**

数据模型（dataclass，JSON 序列化对齐仓库风格）：

```python
@dataclass
class CreditRow:
    ref: str; kind: str; version: str
    uses: int; pass_count: int; fail_count: int
    first_seen: str; last_seen: str
    @property
    def winrate(self) -> float:   # (pass+1)/(uses+2) Beta 平滑
    @property
    def support(self) -> int:     # uses，样本不足时报告里要显式标灰
```

- 输入：TrajectoryStore（`agenticx.learning.trajectory.store`）中的已标注轨迹（`reward.label >= 0`）；只统计 T1 新增三类 kind；每条轨迹对同一 ref 最多计一次（一次任务里反复召回同一条经验不算多票，防刷）
- 结局口径：`label == 1.0` 为 pass，`label == 0.0` 为 fail，partial（0<label<1）计 0.5 票——实现里用浮点累计，测试再补一例
- 账本落盘：`datasets/attribution/ledger.json`（产物入 .gitignore 规则同 datasets 其他产物，**先查 .gitignore 现状决定**）；同时出 markdown 简报 `ledger.md`：按 winrate×support 排序，support < 5 的进「证据不足」分区，unknown 版本单列「待补埋点」分区
- held-out 守卫：构造 ledger 时传入 heldout 名单（读 `datasets/task_split.json`，复用 SP18 的 `load_split()`），遇 held-out 任务直接抛 `HeldoutViolation`

- [ ] **Step 3: 报告 CLI**

`scripts/credit_report.py`（风格对齐 `scripts/check_task_split.py`）：读 store → 算账本 → 打印 top 经验 / 拖后腿经验 / unknown 占比 → 写两个落盘文件；退出码 0。加一个 `--strict-unknown-pct 30` 可选阈值（超了 exit 2），CI 可选用，默认不卡。

- [ ] **Step 4: 验证**

```bash
python3 -m pytest tests/trajectory/test_attribution.py -v -o addopts="--import-mode=importlib"
python3 scripts/credit_report.py --store ~/.agenticx/trajectories 2>&1 | tail -15   # 路径以 store 实际落盘位置为准，先读 store.py 确认
```

- [ ] **Step 5: Commit** `feat(rsi): rule-based memory/skill credit attribution ledger (SP30 T2)`

---

### Task 3: 验证器漂移监控（只读报告）

**Files:**
- Create: `agenticx/learning/verifier_drift.py`
- Create: `scripts/verifier_drift_report.py`
- Create: `datasets/verifier_baseline.json`（一次性快照，checked-in，人类可审计，对齐 task_split.json 的处理方式）
- Test: `tests/trajectory/test_verifier_drift.py`

- [ ] **Step 1: 失败测试**

```python
# tests/trajectory/test_verifier_drift.py
"""SP30 T3：监控验证器失真的四个先行指标，只读不自动改奖励。"""
from agenticx.learning.verifier_drift import drift_report, DriftConfig


def _traj(out_tokens, final_text, label, components=None):
    from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
    return RSITrajectory(
        source="harbor-tb40", task_id="t", session_id=str(out_tokens), model="m",
        status="pass" if label == 1 else "fail",
        reward=RewardRecord(label=label, components=components or {}),
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": final_text}],
        token_usage={"output_tokens": out_tokens})


def test_length_drift_and_templating_flagged():
    base = DriftConfig(length_p90_baseline=1000, length_ratio_alert=2.0,
                       templating_ngram=8, templating_ratio_alert=0.3)
    trajs = [_traj(3000, "SETUP " * 50 + "x" * 200, 1.0) for _ in range(10)]
    r = drift_report(trajs, base)
    assert r.alerts  # 至少长度漂移或模板化触发
    assert any("长度" in a or "模板" in a for a in r.alerts)


def test_dual_judge_gap_from_components():
    # reward.components 预留了多源；verifier 满分但独立判别器低分 = 误报信号
    trajs = [_traj(500, "done", 1.0,
                   {"independent_judge": 0.0}) for _ in range(5)]
    r = drift_report(trajs, DriftConfig())
    assert r.dual_judge_gap is not None and r.dual_judge_gap >= 0.9


def test_report_never_mutates_reward():
    t = _traj(500, "done", 1.0)
    before = t.reward.label
    drift_report([t], DriftConfig())
    assert t.reward.label == before
```

- [ ] **Step 2: 实现 verifier_drift.py**

四个指标 + 口径（全部在报告里写清样本量，样本不足标 N/A 不许编数字）：

1. **误报代理 / 双判别 gap**：`reward.components` 存在 `independent_judge` 键时，统计 `label==1 且 judge<0.5` 的比例（MiniMax 2.9%→8.0% 就是这个量）；无独立判别器时该指标返回 None，报告写「未接入双判别」
2. **长度漂移**：output_tokens 的 p50/p90 相对 `datasets/verifier_baseline.json` 快照的比值，超 `length_ratio_alert`（默认 1.5）报警——奖励劫持典型特征
3. **模板化比率**：最终回复 8-gram 重复率（复用正则化纯 Python 实现，不引新包），超 0.25 报警
4. **通过率异动**：pass rate 相对基线的绝对变化 > 0.2 报警（突增突减都查）

`DriftConfig` 阈值集中一个 dataclass，全部有默认值；`drift_report()` 返回包含 `metrics/alerts/sample_count/generated_at` 的结构化结果，**保证不改输入轨迹任何字段**（测试已锁）。

- [ ] **Step 3: 基线快照**

脚本里内联一次性生成逻辑（对齐 SP18 模式）：扫当前 `harness-lab/jobs` 全部已标注轨迹，算 p50/p90/pass_rate/样本数写 `datasets/verifier_baseline.json`，字段含 `generated_at` 与 `jobs_dir`。重跑生成需显式 `--update-baseline`，默认只读比对。

- [ ] **Step 4: 报告 CLI + held-out 双判别分区**

`scripts/verifier_drift_report.py`：train 区出漂移报告；若给 `--heldout-judge` 独立判别结果文件，则 held-out 区只出双判别 gap 验收表（这是 held-out 数据在本 SP 的唯一合法用途）。报警时 exit 2（可接 CI），无报警 exit 0。

- [ ] **Step 5: 验证**

```bash
python3 -m pytest tests/trajectory/test_verifier_drift.py -v -o addopts="--import-mode=importlib"
python3 scripts/verifier_drift_report.py 2>&1 | tail -15
```

- [ ] **Step 6: Commit** `feat(rsi): read-only verifier drift monitor with baseline snapshot (SP30 T3)`

---

### Task 4: 能力缺口派发器（失败聚类 → 学习任务提案）

**Files:**
- Create: `agenticx/learning/gap_dispatch.py`
- Create: `scripts/gap_dispatch.py`
- Test: `tests/trajectory/test_gap_dispatch.py`
- 参考（不直接改）：`agenticx/learning/trajectory/memory.py`（`_vote_key`/`_error_patterns` 已有失败聚类原语，先读再决定复用还是下沉）

- [ ] **Step 1: 失败测试**

```python
# tests/trajectory/test_gap_dispatch.py
"""SP30 T4：高频失败且无高胜率经验覆盖的聚类 → 派发提案（只提案，不自动开训）。"""
from agenticx.learning.gap_dispatch import find_gaps, GapProposal
from agenticx.learning.attribution import AttributionLedger


def _fail_traj(task_id, err_text):
    from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
    return RSITrajectory(
        source="harbor-tb40", task_id=task_id, session_id=task_id, model="m",
        status="fail", reward=RewardRecord(label=0.0),
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": err_text}])


def test_repeated_failure_without_covering_skill_emits_proposal():
    trajs = [_fail_traj(f"t{i}", "RuntimeError: CUDA out of memory") for i in range(4)]
    proposals = find_gaps(trajs, AttributionLedger(), min_cluster=3)
    assert proposals and proposals[0].failure_count >= 4
    assert proposals[0].covering_refs == []          # 账本里没有高胜率经验


def test_cluster_covered_by_winning_skill_not_dispatched():
    # 先给账本灌入该聚类有高胜率技能（实现时按 ref/关键词关联口径写）
    led = AttributionLedger()
    proposals = find_gaps([], led)
    assert proposals == []
    assert all(isinstance(p, GapProposal) for p in proposals) or True
```

- [ ] **Step 2: 实现 gap_dispatch.py**

- 聚类：复用 `memory.py` 的 `_vote_key`（异常类型级归一）；若复用需要 import 私有函数，则在本 task 顺手把该函数下沉为模块级公开工具（两处共用，不复制实现）
- 覆盖判定：聚类代表关键词与 T2 账本中 `winrate >= 0.6 且 support >= 3` 的 ref 做关键词关联；关联不到才算缺口（口径写进 docstring，宁松勿漏，提案由人审）
- `GapProposal` 字段：`proposal_id`（内容 hash 前 12 位，幂等）、`cluster_key`、`sample_messages`（最多 3 条截断证据）、`failure_count`、`task_ids`、`covering_refs`、`suggested_action`（枚举：`collect_more` | `new_skill` | `verifier_suspect`——失败文本含验证矛盾迹象时标后者，与 T3 呼应）、`created_at`、`status: "proposed"`

- [ ] **Step 3: 提案落盘 CLI**

`scripts/gap_dispatch.py`：扫 store 失败轨迹 + 读账本 → 提案写 `datasets/gap_queue/<proposal_id>.json`；已存在同 id 跳过（幂等，重跑不产生重复提案）。**只写文件，不接任务池、不触发训练。** 打印提案数与按 suggested_action 的分布。

- [ ] **Step 4: 验证**

```bash
python3 -m pytest tests/trajectory/test_gap_dispatch.py -v -o addopts="--import-mode=importlib"
python3 scripts/gap_dispatch.py --dry-run 2>&1 | tail -10   # 只打印不落盘
python3 scripts/gap_dispatch.py 2>&1 | tail -10
```

- [ ] **Step 5: Commit** `feat(rsi): top-down capability gap proposals from failure clusters (SP30 T4)`

---

### Task 5: 长时程 SLO（人工干预率 / 断点恢复率）

**Files:**
- Modify: `agenticx/learning/trajectory/schema.py`（docstring 增补 metadata 约定，不动 dataclass 字段）
- Create: `agenticx/ops/rsi_slo.py`
- Create: `scripts/rsi_slo_report.py`
- Test: `tests/test_rsi_slo.py`（放 tests/ 根，与 ops 类测试同级；先看 tests/ 现有目录决定）
- 参考（复用优先）：`agenticx/runtime/replay_ledger/recorder.py`（已有断点/回放记录，先读，SLO 尽量从它和轨迹 metadata 算，不造第二套 checkpoint）

- [ ] **Step 1: metadata 约定写进 schema docstring**

```python
# RSITrajectory.metadata 长时程 SLO 保留键（SP30，全部可选；缺失=unknown 不许填 0 冒充）：
# "human_interventions": int   # 本轨迹人工接管次数（对齐 OpenAI 口径：一次就算）
# "wall_seconds": int          # 端到端墙钟
# "checkpoints": int           # 落盘检查点数（replay_ledger 口径）
# "resume_attempts": int       # 断点恢复尝试次数
# "resume_completed": int      # 恢复后最终完成的次数（0/1）
```

- [ ] **Step 2: 失败测试**

```python
# tests/test_rsi_slo.py
"""SP30 T5：行业对标指标——4-8h 任务 50%+ 需人工干预（OpenAI 2026-09）。"""
from agenticx.ops.rsi_slo import compute_slo, LONG_TASK_TOOL_THRESHOLD


def _traj(meta, tool_calls=0, status="pass", label=1.0):
    from agenticx.learning.trajectory.schema import RSITrajectory, RewardRecord
    return RSITrajectory(
        source="x", task_id="t", session_id=str(tool_calls), model="m",
        status=status, reward=RewardRecord(label=label),
        messages=[{"role": "user", "content": "q"}],
        tool_calls=[_tc()] * tool_calls, metadata=meta)


def _tc():
    from agenticx.learning.trajectory.schema import ToolCallRecord
    return ToolCallRecord(name="bash", ok=True)


def test_intervention_rate_with_unknown_bucket():
    trajs = [
        _traj({"human_interventions": 1}, tool_calls=50),       # 长任务+干预
        _traj({"human_interventions": 0}, tool_calls=50),       # 长任务无干预
        _traj({}, tool_calls=50),                                # 未采集
        _traj({"human_interventions": 1}, tool_calls=2),        # 短任务不计入
    ]
    slo = compute_slo(trajs)
    assert slo.long_task_count == 3
    assert slo.intervention_rate == 0.5
    assert slo.unknown_rate > 0          # 未采集比例必须显式暴露，不能假装是 0


def test_resume_success_rate():
    trajs = [
        _traj({"resume_attempts": 1, "resume_completed": 1}, tool_calls=50),
        _traj({"resume_attempts": 2, "resume_completed": 0}, tool_calls=50,
              status="fail", label=0.0),
    ]
    slo = compute_slo(trajs)
    assert slo.resume_success_rate == 0.5
```

- [ ] **Step 3: 实现 rsi_slo.py**

长任务代理口径（TB 轨迹没有墙钟时）：tool_calls 数 ≥ 阈值（默认 40，常量命名 `LONG_TASK_TOOL_THRESHOLD`，报告里注明这是代理口径）或 `wall_seconds >= 4*3600`，满足其一即长任务。指标：
- `intervention_rate` = 长任务中 interventions≥1 的占比（分母只算已采集该键的轨迹）
- `unknown_rate` = 长任务中缺该键的占比（推动采集补齐，与 T2 unknown 分区同一思路）
- `resume_success_rate`、checkpoint 覆盖率同理
- 样本 < 10 全部返回数值但报告标灰「样本不足」

- [ ] **Step 4: 报告 CLI**

`scripts/rsi_slo_report.py` 读 store（优先）+ replay_ledger 目录（若 recorder 已有 checkpoint 记录则 join 补 metadata，实现前先读 recorder.py 确认真实字段，拿不到就留 unknown），markdown 输出到 `datasets/slo/rsi_slo.md`。

- [ ] **Step 5: 验证 + commit**

```bash
python3 -m pytest tests/test_rsi_slo.py -v -o addopts="--import-mode=importlib"
python3 scripts/rsi_slo_report.py 2>&1 | tail -10
```

`feat(rsi): long-horizon SLO metrics (intervention/resume rates) (SP30 T5)`

---

### Task 6: Adapter 一等公民契约（AdapterRecord / 租户注册表 / LoRA manifest）

**Files:**
- Create: `agenticx/trainer/adapters.py`
- Modify: `agenticx/trainer/__main__.py`（registry 命令加 adapter 子动词）
- Modify: `agenticx/trainer/exporters.py`（`write_lora_manifest`）
- Test: `tests/trainer/test_adapter_registry.py`、`tests/trainer/test_lora_manifest.py`（先看 tests/ 下 trainer 测试现有放置位置保持一致）

- [ ] **Step 1: 失败测试（注册表）**

```python
# tests/trainer/test_adapter_registry.py
"""SP30 T6：共享基座 + 多 adapter（可按 skill/租户独立版本化），Macaron MoL 范式的软件契约。"""
import pytest
from agenticx.trainer.adapters import AdapterRegistry


def test_register_promote_resolve_compose_spec(tmp_path):
    reg = AdapterRegistry(tmp_path / "adapters.json")
    vid = reg.register("finnews-sentiment",
                       base_model="openai/glm-5.3-flash",
                       adapter_uri="file://adapters/finnews-v3.safetensors",
                       skill_tags=["finance", "sentiment"], tenant="")
    reg.promote("finnews-sentiment", vid)
    spec = reg.resolve("finnews-sentiment")
    assert spec["model"] == "openai/glm-5.3-flash"
    assert spec["adapter_uri"].endswith("finnews-v3.safetensors")
    assert spec["compose"] == "base+adapter"     # P1 推理路由消费的组装指令


def test_tenant_namespace_is_isolated(tmp_path):
    reg = AdapterRegistry(tmp_path / "adapters.json")
    reg.register("a", base_model="b", adapter_uri="u1", tenant="carrier-x")
    reg.register("a", base_model="b", adapter_uri="u2", tenant="carrier-y")
    assert reg.resolve("a", tenant="carrier-x")["adapter_uri"].endswith("u1")
    assert reg.resolve("a", tenant="carrier-y")["adapter_uri"].endswith("u2")


def test_rollback_and_lineage_fields(tmp_path):
    reg = AdapterRegistry(tmp_path / "adapters.json")
    v1 = reg.register("a", base_model="b", adapter_uri="u1",
                      lineage={"datasets": ["tb40-sft-v1"], "trajectories": 120})
    reg.promote("a", v1)
    v2 = reg.register("a", base_model="b", adapter_uri="u2")
    reg.promote("a", v2)
    back = reg.rollback("a", tenant="")
    assert back == v1
    assert reg.resolve("a")["adapter_uri"].endswith("u1")
```

- [ ] **Step 2: 实现 adapters.py**

仿 `registry.py` 的 JSON 存储与 candidate/promoted/retired 生命周期（不继承、独立类——ModelRegistry 未来保持「整模型」语义，AdapterRegistry 管「基座+增量」）：

```python
@dataclass
class AdapterRecord:
    alias: str; version_id: str; base_model: str; adapter_uri: str
    skill_tags: list[str]; tenant: str                 # "" = 全局/基座侧
    lineage: dict                # {"datasets": [...], "trajectory_store": ...,
                                 #  "heldout": [...], "attribution_ledger": ...}
    status: str; registered_at: str; promoted_at: str | None
```

- 存储键：`f"{tenant}::{alias}"` 当 tenant 非空，裸 alias 当全局；`list()` 输出保留 tenant 字段不泄漏到别名里
- `resolve()` 返回 `{"model", "adapter_uri", "compose": "base+adapter", "version_id", "skill_tags", "status"}`；adapter 缺失（alias 只在 ModelRegistry）由调用方决定回退，本类不跨查
- held-out 信息进 lineage 但注册时不做强制校验（训练守卫在数据侧已做）；manifest 里必须有 heldout 清单字段，没有就拒绝写 manifest（T6 Step 4 锁）

- [ ] **Step 3: 接线 CLI**

`python -m agenticx.trainer registry adapter-register / adapter-promote / adapter-rollback / adapter-resolve`，参数 `--alias --base-model --uri --tags --tenant --lineage-json`；与现有 model 子动词并列，`--registry` 旁加 `--adapter-registry`（默认 `~/.agenticx/registry/adapters.json`）。

- [ ] **Step 4: LoRA manifest 导出（失败测试 + 实现）**

```python
# tests/trainer/test_lora_manifest.py
def test_manifest_requires_heldout_and_records_lineage(tmp_path):
    import pytest
    from agenticx.trainer.exporters import write_lora_manifest
    with pytest.raises(ValueError, match="heldout"):
        write_lora_manifest(tmp_path, alias="a", base_model="b",
                            adapter_uri="u", skill_tags=[],
                            dataset_refs=["tb40-sft-v1"], heldout=[])
    p = write_lora_manifest(tmp_path, alias="a", base_model="b",
                            adapter_uri="u", skill_tags=["finance"],
                            dataset_refs=["tb40-sft-v1"],
                            heldout=["task-eval-1"], trajectory_count=120)
    import json; m = json.loads(p.read_text())
    assert m["schema_version"] == "agx-lora-manifest/1"
    assert m["compose"] == "base+adapter" and m["heldout"] == ["task-eval-1"]
```

manifest 是 P1 训练产物的「空信封」：本期不产生真实权重，`adapter_uri` 允许指向占位路径但 `status` 必须是 `planned`；信封字段照 Macaron MoL 经验一次定全（base_model、rank/alpha 预留空 dict `lora_config: {}`、tags、lineage、heldout、created_at）。

- [ ] **Step 5: 验证 + commit**

```bash
python3 -m pytest tests/trainer/test_adapter_registry.py tests/trainer/test_lora_manifest.py -v -o addopts="--import-mode=importlib"
python3 -m pytest tests/trajectory tests/trainer tests/rl -o addopts="--import-mode=importlib" 2>&1 | tail -1
python3 -m agenticx.trainer registry adapter-register --help
```

`feat(rsi): adapter registry + tenant namespace + lora manifest contract (SP30 T6)`

---

### Task 7: replay_spans 派生（选择性重放信封，P1 消费）

**Files:**
- Create: `agenticx/learning/trajectory/replay_spans.py`
- Test: `tests/trajectory/test_replay_spans.py`

- [ ] **Step 1: 失败测试**

```python
# tests/trajectory/test_replay_spans.py
"""SP30 T7：从 lineage 派生学习相关消息区间（LongStraw/AReaL-DTA 选择性重放口径）。"""
from agenticx.learning.trajectory.replay_spans import derive_replay_spans
from agenticx.learning.trajectory.schema import (
    DecisionStep, RSITrajectory, RewardRecord, ToolCallRecord)


def test_spans_cover_correction_and_failed_tool_windows():
    traj = RSITrajectory(
        source="x", task_id="t", session_id="s", model="m", status="pass",
        reward=RewardRecord(label=1.0),
        messages=[{"role": "user", "content": "q"},
                  {"role": "assistant", "content": "a1"},
                  {"role": "tool", "content": "ok"},
                  {"role": "assistant", "content": "a2"},
                  {"role": "tool", "content": "ERR boom"},
                  {"role": "assistant", "content": "fixed"}],
        tool_calls=[ToolCallRecord(name="bash", ok=True),
                    ToolCallRecord(name="bash", ok=False)],
        decision_lineage=[DecisionStep(kind="correction", ref="step-5")])
    spans = derive_replay_spans(traj)
    # 修正点与失败工具窗口必须被覆盖；纯寒暄窗口允许不选
    covered = {i for s in spans for i in range(s.start_msg, s.end_msg + 1)}
    assert {4, 5} <= covered
    assert all(s.reason in ("correction", "failed_tool", "verification") for s in spans)
```

- [ ] **Step 2: 实现**

纯函数：`ReplaySpan(start_msg, end_msg, reason)`；规则——correction/verification 事件所在消息 ±1 窗口、`ok=False` 的 tool_call 及其后一条 assistant 消息；窗口合并重叠区间。输出按消息序、不重排消息。只派生不存储，CLI（可挂到 `python -m agenticx.learning.trajectory stats` 之类现有入口，没有就不加，别造新命令）能打印 span 覆盖率统计即可。

- [ ] **Step 3: 验证 + commit**

```bash
python3 -m pytest tests/trajectory/test_replay_spans.py -v -o addopts="--import-mode=importlib"
```

`feat(rsi): derive replay spans from decision lineage for selective replay (SP30 T7)`

---

## 端到端验收（全部 task 合入后）

```bash
# 1. 采集（T1 路由事件已入 lineage）
python3 -m agenticx.learning.trajectory collect --source harbor --jobs-dir harness-lab/jobs --out /tmp/sp30_e2e
# 2. 归因账本（T2）
python3 scripts/credit_report.py --store /tmp/sp30_e2e
# 3. 验证器漂移（T3）
python3 scripts/verifier_drift_report.py --store /tmp/sp30_e2e
# 4. 缺口提案（T4）
python3 scripts/gap_dispatch.py --store /tmp/sp30_e2e
# 5. 长时程 SLO（T5）
python3 scripts/rsi_slo_report.py --store /tmp/sp30_e2e
# 6. adapter 契约（T6）
python3 -m agenticx.trainer registry adapter-register --alias finnews-sentiment \
  --base-model openai/glm-5.3-flash --uri file:///tmp/planned.safetensors \
  --tags finance,sentiment --lineage-json /tmp/sp30_e2e/lineage.json
# 全量回归
python3 -m pytest tests/trajectory tests/trainer tests/rl tests/test_rsi_slo.py \
  -o addopts="--import-mode=importlib" 2>&1 | tail -1
```

**完成定义（Go 标准）：**
- 七个 task 测试全绿；每个 held-out 守卫有负例测试（账本/漂移/manifest 三处红线）
- 真实 harbor jobs 上五条报告链全跑通，允许指标 N/A/unknown，但**任何一个数字都必须能在报告里读到样本量与口径**
- `datasets/` 产物（ledger/baseline/gap_queue/slo）的 gitignore 策略与现有数据集产物一致，实现时先查 `.gitignore` 再定
- 汇报必须包含：当前路由事件 unknown 占比、验证器四指标实测值（或未接入项清单）、缺口提案数、长任务干预率（或未采集率）——这四个数就是飞轮 P0.6 是否真转的体检表

## P1 前置事项（本 SP 只记录、不实施）

1. **AReaL build-vs-borrow 正式对标**：AReaL 已昇腾适配、支持 LoRA RL/训推共卡/MOPD，与 P1 的 950PR+verl-agent 路线重叠；P1 启动前出一页对标结论（训练引擎借 AReaL，中层护城河=harness/归因/验证器/adapter 注册表）
2. **Macaron-V1-Tall（35B+4×3.7B，开放权重）纳入基座横评**：与 GLM/Qwen 候选在同一批 held-out（FinnewsHunter 优先）对比；MoL 若成立，基座与专家可分开采购
3. **REPL Harness 实验**：FinnewsHunter 开实验分支，量化「程序组合工具 vs 逐轮调用」的 token 差，收益 ≥20% 再谈产品化（交叉验证 MemoraX 报告的 Coding token -20%）

## 明确不做（YAGNI / 属后续阶段）

- 不训记忆/归因模型（T2 规则版跑稳、信号显著后再议）
- 不自动修改验证器、不自动开训、不自动接任务池（T3/T4 全部人审）
- adapter 不接 llm_factory 真实路由、不产生真实权重（T6 只定契约）
- 不做 agent 主循环的全量路由埋点（T1 只留 helper + best-effort 抽取）
- 不引入 scipy/numpy 新统计依赖（纯 Python 实现）
- replay_spans 不进存储 schema、不做 token 级偏移（消息级窗口够 P1 起步）
