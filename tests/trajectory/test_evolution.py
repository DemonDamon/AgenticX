# tests/trajectory/test_evolution.py
import json
import pytest
from agenticx.learning.trajectory.evolution import (
    SEED_POLICY_SOURCE, PolicyRegistry, SimplePolicy, compile_policy,
    EvolutionReport, evolve_loop, mutate_policy_source, make_llm_proposer,
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
