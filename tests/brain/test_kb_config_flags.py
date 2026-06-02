"""Persist wiki_compiler / synthesis flags on docs brain config."""

from __future__ import annotations

import pytest

import agenticx.brain.registry as brain_registry_mod
from agenticx.brain.registry import BrainRegistry
from agenticx.brain.types import BrainType
from agenticx.studio.kb.contracts import KBConfig
from agenticx.studio.kb.manager import KBManager


@pytest.fixture()
def isolated_brains(tmp_path, monkeypatch):
    brains = tmp_path / "brains"
    cfg = tmp_path / "config.yaml"
    cfg.write_text("knowledge_base:\n  enabled: true\n", encoding="utf-8")
    monkeypatch.setattr("agenticx.brain.registry.AGENTICX_HOME", tmp_path)
    monkeypatch.setattr("agenticx.brain.registry.BRAINS_ROOT", brains)
    monkeypatch.setattr("agenticx.brain.registry.REGISTRY_FILE", brains / "registry.json")
    monkeypatch.setattr("agenticx.brain.registry.CONFIG_YAML", cfg)
    monkeypatch.setattr("agenticx.brain.registry.AVATARS_ROOT", tmp_path / "avatars")
    monkeypatch.setattr("agenticx.brain.registry.LEGACY_KB_REGISTRY", tmp_path / "storage" / "kb")
    BrainRegistry.reset_for_tests()
    KBManager.reset_for_tests()
    yield tmp_path
    BrainRegistry.reset_for_tests()
    KBManager.reset_for_tests()


def test_registry_update_persists_wiki_and_synthesis_flags(isolated_brains):
    reg = BrainRegistry.instance()
    reg.bootstrap()
    brain = reg.get("default_docs")
    assert brain is not None

    cfg = KBConfig.from_dict(brain.config)
    cfg.wiki_compiler.enabled = True
    cfg.synthesis.enabled = True
    reg.update(brain.id, {"config": cfg.to_dict()})

    reloaded = reg.get(brain.id)
    assert reloaded is not None
    out = KBConfig.from_dict(reloaded.config)
    assert out.wiki_compiler.enabled is True
    assert out.synthesis.enabled is True

    yaml_path = brain_registry_mod.BRAINS_ROOT / brain.id / "brain.yaml"
    assert yaml_path.exists()
    disk = reg._load_brain_from_path(yaml_path)
    assert disk is not None
    disk_cfg = KBConfig.from_dict(disk.config)
    assert disk_cfg.wiki_compiler.enabled is True
    assert disk_cfg.synthesis.enabled is True


def test_socks_proxy_without_socksio_raises_clear_kb_error(monkeypatch):
    from agenticx.studio.kb.runtime import _check_socks_proxy_deps
    from agenticx.studio.kb.contracts import KBError

    monkeypatch.setenv("ALL_PROXY", "socks5://127.0.0.1:7890")
    real_import = __import__

    def fake_import(name, *args, **kwargs):
        if name == "socksio":
            raise ImportError("no socksio")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr("importlib.import_module", fake_import)
    with pytest.raises(KBError, match="socksio"):
        _check_socks_proxy_deps()
