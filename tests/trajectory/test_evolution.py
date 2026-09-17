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
