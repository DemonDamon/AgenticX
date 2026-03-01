#!/usr/bin/env python3
"""E2E: publish -> search -> install -> use -> uninstall.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agenticx.skills.registry import RegistryStorage
from agenticx.skills.registry import SkillRegistryClient
from agenticx.skills.registry import SkillRegistryServer
from agenticx.tools.skill_bundle import SkillBundleLoader


class _HTTPXClientAdapter:
    def __init__(self, app_client: TestClient, *args, **kwargs):  # noqa: ANN002, ANN003
        _ = args, kwargs
        self._client = app_client

    def __enter__(self) -> "_HTTPXClientAdapter":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        _ = exc_type, exc, tb
        return False

    def post(self, url: str, json: dict, headers: dict | None = None):
        return self._client.post(_extract_path(url), json=json, headers=headers or {})

    def get(self, url: str, params: dict | None = None):
        return self._client.get(_extract_path(url), params=params)

    def delete(self, url: str):
        return self._client.delete(_extract_path(url))


def _extract_path(url: str) -> str:
    marker = "://"
    if marker not in url:
        return url
    after = url.split(marker, 1)[1]
    if "/" not in after:
        return "/"
    return "/" + after.split("/", 1)[1]


def _make_skill_dir(tmp_path: Path, name: str) -> Path:
    skill_dir = tmp_path / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        (
            "---\n"
            f"name: {name}\n"
            "description: lifecycle test skill\n"
            "version: 0.1.0\n"
            "author: e2e\n"
            "---\n\n"
            "# Lifecycle Skill\n"
            "Use me.\n"
        ),
        encoding="utf-8",
    )
    return skill_dir


def test_e2e_skill_lifecycle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    storage = RegistryStorage(storage_path=tmp_path / "registry.json")
    server = SkillRegistryServer(storage_path=tmp_path / "registry.json")
    app_client = TestClient(server.create_app())
    monkeypatch.setattr(
        "agenticx.skills.registry.httpx.Client",
        lambda *args, **kwargs: _HTTPXClientAdapter(app_client, *args, **kwargs),
    )

    local_skill = _make_skill_dir(tmp_path, "e2e-skill")
    client = SkillRegistryClient(registry_url="http://localhost:8321")
    published = client.publish(local_skill)
    assert published.name == "e2e-skill"
    assert len(storage.list_entries("e2e")) == 1

    found = client.search("e2e-skill")
    assert found and found[0].name == "e2e-skill"

    install_root = tmp_path / "installed"
    installed_md = client.install("e2e-skill", target_dir=install_root)
    assert installed_md.exists()

    loader = SkillBundleLoader(search_paths=[install_root], registry_url=None)
    scanned = loader.scan()
    names = [s.name for s in scanned]
    assert "e2e-skill" in names
    content = loader.get_skill_content("e2e-skill")
    assert content is not None and "Lifecycle Skill" in content

    assert client.uninstall("e2e-skill", target_dir=install_root) is True
    assert not installed_md.exists()
