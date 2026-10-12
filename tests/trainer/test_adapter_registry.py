"""SP30 T6：共享基座 + 多 adapter（可按 skill/租户独立版本化）。

对标 Macaron-V1 MoL：LoRA 是经验积累的基本单元，专家独立训练/热插拔。
本模块只定契约（注册表 + 生命周期 + 组装指令），不接推理路由、不产权重。
"""
import json

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


def test_tenant_alias_does_not_leak_to_global(tmp_path):
    reg = AdapterRegistry(tmp_path / "adapters.json")
    reg.register("a", base_model="b", adapter_uri="u1", tenant="carrier-x")
    with pytest.raises(LookupError):
        reg.resolve("a", tenant="")               # 全局空间无此别名
    with pytest.raises(LookupError):
        reg.resolve("a", tenant="carrier-z")      # 其他租户隔离


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


def test_resolve_prefers_promoted_then_latest_candidate(tmp_path):
    reg = AdapterRegistry(tmp_path / "adapters.json")
    reg.register("a", base_model="b", adapter_uri="u1")
    spec = reg.resolve("a")                       # 无 promoted → 最新 candidate
    assert spec["status"] == "candidate"


def test_lineage_persisted(tmp_path):
    reg = AdapterRegistry(tmp_path / "adapters.json")
    vid = reg.register("a", base_model="b", adapter_uri="u",
                       lineage={"datasets": ["d1"], "heldout": ["e1"]})
    reg2 = AdapterRegistry(tmp_path / "adapters.json")
    row = reg2._versions("a")[vid]
    assert row["lineage"] == {"datasets": ["d1"], "heldout": ["e1"]}
