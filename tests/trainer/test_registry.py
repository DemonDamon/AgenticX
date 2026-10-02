# tests/trainer/test_registry.py
import pytest
from agenticx.trainer.registry import ModelRegistry

def test_register_and_resolve(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("agent-coding-v1", model_spec="openai/glm-5.3-flash",
                 backend="litellm", meta={"origin": "sft-v1"})
    spec = reg.resolve("agent-coding-v1")
    assert spec == {"model": "openai/glm-5.3-flash", "backend": "litellm",
                    "version_id": spec["version_id"], "status": "candidate"}

def test_register_persists_across_instances(tmp_path):
    p = tmp_path / "models.json"
    ModelRegistry(p).register("a-v1", model_spec="m1")
    reg2 = ModelRegistry(p)
    assert reg2.resolve("a-v1")["model"] == "m1"

def test_promote_and_rollback(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("a-v1", model_spec="m1")
    reg.register("a-v1", model_spec="m2")
    reg.promote("a-v1")                     # 无版本号 → 提升最新 candidate
    assert reg.resolve("a-v1")["model"] == "m2"
    reg.rollback("a-v1")                    # 回滚到上一可用版本
    assert reg.resolve("a-v1")["model"] == "m1"

def test_rollback_single_version_clears_promoted(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("a-v1", model_spec="m1")
    reg.promote("a-v1")
    reg.rollback("a-v1")
    with pytest.raises(LookupError):
        reg.resolve("a-v1")

def test_resolve_unknown_alias_raises(tmp_path):
    with pytest.raises(LookupError):
        ModelRegistry(tmp_path / "models.json").resolve("nope")

def test_list_returns_summary(tmp_path):
    reg = ModelRegistry(tmp_path / "models.json")
    reg.register("a-v1", model_spec="m1")
    listing = reg.list()
    assert listing["a-v1"][0]["model"] == "m1"
