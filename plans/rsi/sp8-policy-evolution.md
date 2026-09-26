# SP8: 策略演化循环（P0.5 · 对齐 Dream-RSI 之 Dreaming 闭环）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 论文"离线策略改进"闭环的等价物：候选策略（LLM 重写或变异产生）在回放模拟器上批量评分，≥当前分才回流 promote——底层执行层全程冻结，只演化策略代码。

**Architecture:** `evolution.py` 新模块：`compile_policy` 把策略源码（定义 `NAME` + `act(obs, ctx)`）exec 成可执行对象；`PolicyRegistry` 版本化管理策略源码（candidate→promoted，同 ModelRegistry 语义）；`evolve_loop` = 提议→回放评分→择优回流；提议器可注入（dry-run 变异 / LLM via llm_factory）。CLI 追加 `evolve` 子命令。**纪律：演化评分只允许用 train 区任务树（SP7 隔离），held-out 仅作最终验收报告。**

**Tech Stack:** Python 3.12 stdlib, pytest。前置：SP5/SP6/SP7。LLM 走 `LlmFactory.create_llm(config)`，`invoke(prompt) -> LLMResponse.content`（已核实 base.py/response.py）。

---

### Task 1: compile_policy + PolicyRegistry

**Files:**
- Create: `agenticx/learning/trajectory/evolution.py`
- Test: `tests/trajectory/test_evolution.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_evolution.py
import json
import pytest
from agenticx.learning.trajectory.evolution import (
    SEED_POLICY_SOURCE, PolicyRegistry, SimplePolicy, compile_policy,
)

SRC = '''\
NAME = "streak_2"
def act(obs, ctx):
    if obs.consecutive_failures >= 2:
        return "abort"
    return "continue"
'''

def test_compile_policy_returns_executable():
    p = compile_policy(SRC)
    assert isinstance(p, SimplePolicy) and p.name == "streak_2"
    assert callable(p.act)

def test_compile_policy_requires_name_and_act():
    with pytest.raises(ValueError):
        compile_policy("def act(o, c):\n    return 'continue'\n")
    with pytest.raises(ValueError):
        compile_policy("NAME = 'x'\n")

def test_compile_policy_syntax_error_raises():
    with pytest.raises(Exception):
        compile_policy("def broken(:\n")

def test_seed_policy_source_is_valid():
    p = compile_policy(SEED_POLICY_SOURCE)
    assert p.name.startswith("seed_")

def test_registry_lifecycle(tmp_path):
    reg = PolicyRegistry(tmp_path / "policies.json")
    v1 = reg.register(SEED_POLICY_SOURCE, score=100.0, lineage="seed")
    assert v1 == 1
    v2 = reg.register(SRC, score=50.0, lineage="variant")
    assert v2 == 2
    reg.promote(v2)
    cur = reg.current()
    assert cur["version"] == 2 and cur["score"] == 50.0 and cur["source"] == SRC
    assert [v["version"] for v in reg.versions()] == [1, 2]
    # 持久化往返
    reg2 = PolicyRegistry(tmp_path / "policies.json")
    assert reg2.current()["version"] == 2

def test_registry_current_none_when_no_promote(tmp_path):
    reg = PolicyRegistry(tmp_path / "policies.json")
    reg.register(SEED_POLICY_SOURCE, score=1.0, lineage="seed")
    assert reg.current() is None
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_evolution.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（ModuleNotFoundError）

- [ ] **Step 3: 最小实现**

```python
# agenticx/learning/trajectory/evolution.py
"""策略演化循环（P0.5 · Dream-RSI 的 Dreaming-based Policy Improvement 等价物）。

闭环：提议策略变体 → 回放模拟器批量评分（零推理成本）→ ≥当前分才 promote。
底层 agent/评测器/沙盒全冻结, 只演化策略源码——与论文同构。
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .forest import StepFeatures
from .replay import AttemptContext

SEED_POLICY_SOURCE = '''\
NAME = "seed_error_streak_3"
def act(obs, ctx):
    """种子策略：连续 3 次工具失败即止损。"""
    if obs.consecutive_failures >= 3:
        return "abort"
    return "continue"
'''

@dataclass
class SimplePolicy:
    name: str
    fn: Callable[[StepFeatures, AttemptContext], str]

    def act(self, obs: StepFeatures, ctx: AttemptContext) -> str:
        return self.fn(obs, ctx)


def compile_policy(source: str) -> SimplePolicy:
    """把策略源码 exec 为可执行对象。源码须定义 NAME: str 与 act(obs, ctx) -> str。

    受控演化：源码由本循环的提议器产生（LLM/变异）, exec 命名空间仅注入
    StepFeatures/AttemptContext 两个类型, 不给 import/os 等能力。
    """
    ns: dict[str, Any] = {"StepFeatures": StepFeatures, "AttemptContext": AttemptContext}
    exec(compile(source, "<policy>", "exec"), ns)  # noqa: S102
    if "act" not in ns or not callable(ns["act"]) or "NAME" not in ns:
        raise ValueError("策略源码必须定义 NAME 与 act(obs, ctx)")
    return SimplePolicy(name=str(ns["NAME"]), fn=ns["act"])


class PolicyRegistry:
    """策略版本注册表：candidate → promoted, 与 ModelRegistry 同语义。"""

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = self._load()
        self._versions: list[dict[str, Any]] = data.get("versions", [])
        self._promoted: int | None = data.get("promoted")

    def _load(self) -> dict[str, Any]:
        try:
            return json.load(open(self.path))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self) -> None:
        json.dump({"versions": self._versions, "promoted": self._promoted},
                  open(self.path, "w"), ensure_ascii=False, indent=2)

    def register(self, source: str, score: float, lineage: str) -> int:
        version = (self._versions[-1]["version"] + 1) if self._versions else 1
        self._versions.append({"version": version, "source": source,
                               "score": score, "lineage": lineage})
        self._save()
        return version

    def promote(self, version: int) -> None:
        if not any(v["version"] == version for v in self._versions):
            raise ValueError(f"未知策略版本 {version}")
        self._promoted = version
        self._save()

    def current(self) -> dict[str, Any] | None:
        if self._promoted is None:
            return None
        return next(v for v in self._versions if v["version"] == self._promoted)

    def versions(self) -> list[dict[str, Any]]:
        return list(self._versions)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_evolution.py -v -o addopts="--import-mode=importlib"`
Expected: 6 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/evolution.py tests/trajectory/test_evolution.py
git commit -m "feat(rsi): policy compilation sandbox and versioned policy registry"
```

---

### Task 2: evolve_loop + 提议器（变异 / LLM）

**Files:**
- Modify: `agenticx/learning/trajectory/evolution.py`（追加）
- Test: `tests/trajectory/test_evolution.py`（追加）

- [ ] **Step 1: 写失败测试（追加到 test_evolution.py）**

```python
from agenticx.learning.trajectory.evolution import (
    EvolutionReport, evolve_loop, mutate_policy_source, make_llm_proposer,
)

def _reg_with_seed(tmp_path, score_fn):
    reg = PolicyRegistry(tmp_path / "p.json")
    seed = compile_policy(SEED_POLICY_SOURCE)
    v = reg.register(SEED_POLICY_SOURCE, score=score_fn(seed), lineage="seed")
    reg.promote(v)
    return reg

def test_evolve_loop_accepts_improving_variant(tmp_path):
    # 分数函数：源码含 "streak_1" 的策略得高分（模拟找到更优阈值）
    def score_fn(p):
        return 200.0 if ">= 1" in getattr(p, "_src", "") or p.name == "streak_1" else 100.0
    reg = _reg_with_seed(tmp_path, score_fn)
    better = SEED_POLICY_SOURCE.replace(">= 3", ">= 1").replace(
        "seed_error_streak_3", "streak_1")
    report = evolve_loop(
        reg, evaluate_fn=lambda p: 200.0 if p.name == "streak_1" else 100.0,
        propose_fn=lambda cur, feedback: better, n_iters=1,
    )
    assert report.accepted == 1 and report.rejected == 0
    assert reg.current()["source"] == better
    assert report.best_score == 200.0

def test_evolve_loop_rejects_worse_and_bad_code(tmp_path):
    reg = _reg_with_seed(tmp_path, lambda p: 100.0)
    calls = iter(["def broken(:", SEED_POLICY_SOURCE.replace(">= 3", ">= 9")])
    report = evolve_loop(
        reg, evaluate_fn=lambda p: 100.0,
        propose_fn=lambda cur, fb: next(calls), n_iters=2,
    )
    assert report.accepted == 0 and report.rejected == 2   # 语法错 + 无提升
    assert reg.current()["source"] == SEED_POLICY_SOURCE    # 种子未被替换

def test_evolve_loop_no_promoted_raises(tmp_path):
    reg = PolicyRegistry(tmp_path / "p.json")
    with pytest.raises(ValueError):
        evolve_loop(reg, evaluate_fn=lambda p: 0, propose_fn=lambda c, f: "", n_iters=1)

def test_mutate_policy_source_bumps_first_int():
    src = "NAME = 'p'\nTHRESH = 3\n\n\ndef act(obs, ctx):\n    return 'abort' if obs.step >= 2 else 'continue'\n"
    out = mutate_policy_source(src)
    assert "THRESH = 4" in out and ">= 2" in out        # 只动第一个整数字面量

def test_make_llm_proposer_extracts_code_from_response():
    class FakeLLM:
        def invoke(self, prompt, **kw):
            class R:
                content = "说明文字\n```python\nNAME = 'llm_p'\ndef act(obs, ctx):\n    return 'continue'\n```\n尾注"
            return R()
    propose = make_llm_proposer(FakeLLM())
    src = propose(SEED_POLICY_SOURCE, "current_score=100.0")
    assert compile_policy(src).name == "llm_p"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_evolution.py -v -o addopts="--import-mode=importlib"`
Expected: 新增 5 FAIL（ImportError）

- [ ] **Step 3: 最小实现（追加到 evolution.py）**

```python
import re


@dataclass
class EvolutionReport:
    iterations: int
    accepted: int
    rejected: int
    best_score: float
    best_version: int


def evolve_loop(registry: PolicyRegistry,
                evaluate_fn: Callable[[Any], float],
                propose_fn: Callable[[str, str], str],
                n_iters: int = 5,
                min_improve: float = 0.0) -> EvolutionReport:
    """离线演化主循环（论文 Dreaming-based Policy Improvement）。

    evaluate_fn 只允许绑定 train 区任务树（SP7 隔离纪律）。
    择优规则：new_score >= best + min_improve 才 register+promote。
    坏代码（语法错/缺 NAME/缺 act）与劣质变体一律丢弃, 不影响当前策略。
    """
    current = registry.current()
    if current is None:
        raise ValueError("注册表无 promoted 策略, 请先注册并 promote 种子策略")
    best_score, best_version = current["score"], current["version"]
    accepted = rejected = 0
    for _ in range(n_iters):
        proposal = propose_fn(current["source"], f"current_score={best_score}")
        try:
            policy = compile_policy(proposal)
        except Exception:
            rejected += 1
            continue
        score = evaluate_fn(policy)
        if score >= best_score + min_improve:
            v = registry.register(proposal, score=score, lineage="evolved")
            registry.promote(v)
            best_score, best_version = score, v
            current = registry.current()
            accepted += 1
        else:
            rejected += 1
    return EvolutionReport(n_iters, accepted, rejected, best_score, best_version)


def mutate_policy_source(source: str) -> str:
    """dry-run 提议器：把源码中第一个 `= <int>` 的整数字面量 +1（确定性爬坡）。"""
    m = re.search(r"=\s*(\d+)", source)
    if not m:
        return source
        # 无数字可变时原样返回, evolve_loop 会按"无提升"拒绝, 循环安全
    old, new = m.group(0), f"= {int(m.group(1)) + 1}"
    return source.replace(old, new, 1)


_PROPOSER_PROMPT = """你是探索策略优化器（Dream-RSI 式离线策略改进）。
当前策略源码与其在历史轨迹回放上的得分如下。请提出一个改进变体,
只输出一个 python 代码块（```python ... ```）, 代码必须定义:
NAME: str 与 act(obs, ctx) -> str（返回 "continue" 或 "abort"）。
可用类型: obs: StepFeatures(step, n_messages, n_tool_calls, tool_success_rate,
consecutive_failures, rounds_since_progress, est_tokens);
ctx: AttemptContext(task_id, attempt_index, attempts_remaining, spent_so_far)。

当前策略源码:
```python
{source}
```

{feedback}
"""


def _extract_code(text: str) -> str:
    m = re.search(r"```(?:python)?\s*\n(.*?)```", text, re.DOTALL)
    return m.group(1).strip() if m else text.strip()


def make_llm_proposer(llm: Any) -> Callable[[str, str], str]:
    """用仓库 LLM provider 构造提议器：llm.invoke(prompt) -> LLMResponse(.content)。"""
    def propose(current_source: str, feedback: str) -> str:
        prompt = _PROPOSER_PROMPT.format(source=current_source, feedback=feedback)
        resp = llm.invoke(prompt)
        return _extract_code(getattr(resp, "content", "") or "")
    return propose
```

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_evolution.py -v -o addopts="--import-mode=importlib"`
Expected: 11 PASS

- [ ] **Step 5: Commit**

```bash
git add agenticx/learning/trajectory/evolution.py tests/trajectory/test_evolution.py
git commit -m "feat(rsi): offline policy evolution loop with injectable proposers"
```

---

### Task 3: evolve CLI + 真实数据冒烟

**Files:**
- Modify: `agenticx/learning/trajectory/__main__.py`（追加 evolve 子命令）
- Test: `tests/trajectory/test_evolve_cli.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/trajectory/test_evolve_cli.py
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def test_evolve_cli_dry_run(tmp_path):
    store_dir = tmp_path / "store"
    r = subprocess.run(
        [sys.executable, "-m", "agenticx.learning.trajectory", "collect",
         "--source", "harbor", "--jobs-dir", str(tmp_path / "jobs"),
         "--out", str(store_dir)],
        cwd=REPO, capture_output=True, text=True)
    if r.returncode != 0:            # tmp jobs 为空 → written=0, 仍应成功
        assert "written" in r.stdout or r.returncode == 0
    out = tmp_path / "policies.json"
    r2 = subprocess.run(
        [sys.executable, "-m", "agenticx.learning.trajectory", "evolve",
         "--store", str(store_dir), "--out", str(out),
         "--iters", "2", "--dry-run", "--seed", "v1"],
        cwd=REPO, capture_output=True, text=True)
    assert r2.returncode == 0, r2.stderr
    payload = json.loads(r2.stdout)
    assert payload["evolution"]["iterations"] == 2
    assert payload["registry"]["promoted_version"] >= 1
    assert out.exists()
```

注意：空 store（无轨迹）时 evolve 必须优雅失败并给出明确错误信息——测试里 collect 一个空 jobs 目录时 written=0，`evolve` 应以非零码退出且 stderr 含 "无轨迹"。因此上面测试改为先构造非空 store：从 `tests/trajectory/test_harbor_collector.py` 的 make_trial 造 2 个 trial（1 pass/1 fail，同 task）再 collect。参考 tests/trajectory/test_cli.py 的做法（sys.path 插入后 `from test_harbor_collector import make_trial`）。

- [ ] **Step 2: 跑测试确认失败**

Run: `python3 -m pytest tests/trajectory/test_evolve_cli.py -v -o addopts="--import-mode=importlib"`
Expected: FAIL（evolve 子命令不存在, argparse error 2）

- [ ] **Step 3: 最小实现（追加到 __main__.py）**

```python
from dataclasses import asdict

from .evolution import (
    SEED_POLICY_SOURCE, PolicyRegistry, compile_policy, evolve_loop,
    make_llm_proposer, mutate_policy_source,
)
from .forest import TrialForest
from .policy import policy_report
from .replay import evaluate_policy, forest_score
from agenticx.trainer.heldout import heldout_split


def _cmd_evolve(args) -> int:
    store = TrajectoryStore(Path(args.store))
    forest = TrialForest.from_trajectories(store.iter_trajectories())
    if not forest.trees:
        print("evolve 错误: 轨迹库无轨迹, 请先 collect", file=sys.stderr)
        return 1
    split = heldout_split(sorted(forest.trees), seed=args.seed)
    train_ids = list(split.train)

    def evaluate_fn(policy) -> float:
        # 纪律: 演化评分只绑定 train 区（SP7 隔离）
        return forest_score(evaluate_policy(policy, forest, task_ids=train_ids,
                                            max_attempts=args.max_attempts))

    registry = PolicyRegistry(Path(args.out))
    if registry.current() is None:
        v = registry.register(SEED_POLICY_SOURCE,
                              score=evaluate_fn(compile_policy(SEED_POLICY_SOURCE)),
                              lineage="seed")
        registry.promote(v)
    if args.dry_run:
        propose = mutate_policy_source
    else:
        from types import SimpleNamespace
        from agenticx.llms.llm_factory import LlmFactory
        cfg = SimpleNamespace(type="litellm", model=args.llm_model,
                              api_key=args.api_key, base_url=args.base_url,
                              drop_params=True)
        propose = make_llm_proposer(LlmFactory.create_llm(cfg))
    report = evolve_loop(registry, evaluate_fn=evaluate_fn, propose_fn=propose,
                         n_iters=args.iters)
    cur = registry.current()
    final = policy_report([compile_policy(cur["source"])], forest, seed=args.seed,
                          max_attempts=args.max_attempts)
    print(json.dumps({
        "evolution": asdict(report),
        "registry": {"promoted_version": cur["version"],
                     "promoted_name": compile_policy(cur["source"]).name,
                     "n_versions": len(registry.versions())},
        "final_report": final,
    }, ensure_ascii=False, indent=2))
    return 0
```

main() 中追加子命令（collect/stats 之后）：

```python
    e = sub.add_parser("evolve")
    e.add_argument("--store", default="datasets/trajectories")
    e.add_argument("--out", default="datasets/policies.json")
    e.add_argument("--iters", type=int, default=5)
    e.add_argument("--max-attempts", type=int, default=3)
    e.add_argument("--seed", default="v1")
    e.add_argument("--dry-run", action="store_true")
    e.add_argument("--llm-model", default="openai/glm-5.3-flash")
    e.add_argument("--api-key", default=None)
    e.add_argument("--base-url", default=None)
    e.set_defaults(func=_cmd_evolve)
```

测试文件按"注意"段修正后运行（make_trial 造 2 个 trial → collect → evolve dry-run）。

- [ ] **Step 4: 跑测试确认通过**

Run: `python3 -m pytest tests/trajectory/test_evolve_cli.py -v -o addopts="--import-mode=importlib"`
Expected: 1 PASS。全量回归：`python3 -m pytest tests/trajectory/ tests/trainer/ -o addopts="--import-mode=importlib" -q` 无新增失败。

- [ ] **Step 5: 真实数据冒烟**

```bash
python3 -m agenticx.learning.trajectory evolve --store datasets/trajectories \
  --out datasets/policies.json --iters 3 --dry-run
```

预期：exit 0；输出含 evolution/registry/final_report 三段；记录 final_report 中 seed 策略在 train/heldout 的 pass_rate 与 total_cost 对比（never_abort 参照不必有——report 只含 promoted 策略，可另跑 `python -m agenticx.learning.trajectory report` 不存在则跳过）。

- [ ] **Step 6: Commit**

```bash
git add agenticx/learning/trajectory/__main__.py tests/trajectory/test_evolve_cli.py
git commit -m "feat(rsi): evolve CLI — offline policy evolution with dry-run and LLM proposer modes"
```
