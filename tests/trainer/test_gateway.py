# tests/trainer/test_gateway.py
import json
from agenticx.trainer.gateway import resolve_model_alias, DEFAULT_REGISTRY_PATH

def test_plain_model_string_passthrough(monkeypatch, tmp_path):
    monkeypatch.setattr("agenticx.trainer.gateway.REGISTRY_PATH", tmp_path / "m.json")
    assert resolve_model_alias("openai/glm-5.3-flash") == "openai/glm-5.3-flash"

def test_alias_resolved_to_promoted(monkeypatch, tmp_path):
    monkeypatch.setattr("agenticx.trainer.gateway.REGISTRY_PATH", tmp_path / "m.json")
    from agenticx.trainer.registry import ModelRegistry
    reg = ModelRegistry(tmp_path / "m.json")
    reg.register("agent-coding-v1", model_spec="openai/glm-5.3-flash-tuned-r3")
    reg.promote("agent-coding-v1")
    assert resolve_model_alias("agent-coding-v1") == "openai/glm-5.3-flash-tuned-r3"

def test_corrupt_registry_fails_open(monkeypatch, tmp_path):
    p = tmp_path / "m.json"
    p.write_text("{broken json", encoding="utf-8")
    monkeypatch.setattr("agenticx.trainer.gateway.REGISTRY_PATH", p)
    assert resolve_model_alias("some-alias") == "some-alias"   # 注册表损坏不阻断
