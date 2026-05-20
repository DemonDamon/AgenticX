"""Brain registry and mount resolution tests."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from agenticx.avatar.registry import AvatarRegistry
from agenticx.brain.mount import resolve_mounted_brain_ids
import agenticx.brain.registry as brain_registry_mod
from agenticx.brain.registry import BrainRegistry
from agenticx.brain.types import BrainScope, BrainType
from agenticx.studio.kb.manager import KBManager


@pytest.fixture()
def isolated_brains(tmp_path, monkeypatch):
    brains = tmp_path / "brains"
    avatars = tmp_path / "avatars"
    cfg = tmp_path / "config.yaml"
    cfg.write_text("knowledge_base:\n  enabled: true\n", encoding="utf-8")
    monkeypatch.setattr("agenticx.brain.registry.AGENTICX_HOME", tmp_path)
    monkeypatch.setattr("agenticx.brain.registry.BRAINS_ROOT", brains)
    monkeypatch.setattr("agenticx.brain.registry.REGISTRY_FILE", brains / "registry.json")
    monkeypatch.setattr("agenticx.brain.registry.CONFIG_YAML", cfg)
    monkeypatch.setattr("agenticx.brain.registry.AVATARS_ROOT", avatars)
    monkeypatch.setattr("agenticx.brain.registry.LEGACY_KB_REGISTRY", tmp_path / "storage" / "kb")
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", avatars)
    BrainRegistry.reset_for_tests()
    KBManager.reset_for_tests()
    yield tmp_path
    BrainRegistry.reset_for_tests()
    KBManager.reset_for_tests()


def test_bootstrap_creates_default_docs_brain(isolated_brains):
    reg = BrainRegistry.instance()
    reg.bootstrap()
    assert brain_registry_mod.REGISTRY_FILE.exists()
    brain = reg.get("default_docs")
    assert brain is not None
    assert brain.type == BrainType.DOCS
    assert brain.scope == BrainScope.GLOBAL


def test_create_global_and_private_brains(isolated_brains):
    reg = BrainRegistry.instance()
    reg.bootstrap()
    g = reg.create(name="Global Docs", brain_type=BrainType.DOCS)
    p = reg.create(
        name="Private Code",
        brain_type=BrainType.CODE,
        scope=BrainScope.PRIVATE,
        owner_avatar_id="av1",
        config={"codebase_path": str(isolated_brains / "repo")},
    )
    assert g.scope == BrainScope.GLOBAL
    assert p.owner_avatar_id == "av1"
    assert (isolated_brains / "avatars" / "av1" / "brains" / p.id).exists()


def test_mount_resolution_global_only_by_default(isolated_brains):
    reg = BrainRegistry.instance()
    reg.bootstrap()
    g2 = reg.create(name="Another", brain_type=BrainType.DOCS)
    ids = resolve_mounted_brain_ids(
        avatar_id="av1",
        brains_enabled=None,
        brain_type=BrainType.DOCS,
    )
    assert "default_docs" in ids
    assert g2.id in ids


def test_mount_explicit_list(isolated_brains):
    reg = BrainRegistry.instance()
    reg.bootstrap()
    b = reg.create(name="Pick Me", brain_type=BrainType.DOCS)
    ids = resolve_mounted_brain_ids(
        avatar_id=None,
        brains_enabled=[b.id],
        brain_type=BrainType.DOCS,
    )
    assert ids == [b.id]


def test_delete_avatar_cascades_private_brains(isolated_brains):
    av_reg = AvatarRegistry(isolated_brains / "avatars")
    av = av_reg.create_avatar(name="Test")
    reg = BrainRegistry.instance()
    reg.bootstrap()
    priv = reg.create(
        name="Priv",
        brain_type=BrainType.DOCS,
        scope=BrainScope.PRIVATE,
        owner_avatar_id=av.id,
    )
    assert reg.get(priv.id) is not None
    av_reg.delete_avatar(av.id)
    assert reg.get(priv.id) is None
