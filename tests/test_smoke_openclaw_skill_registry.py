#!/usr/bin/env python3
"""Smoke tests for OpenClaw-inspired skill registry.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from agenticx.skills.registry import RegistryStorage
from agenticx.skills.registry import SkillRegistryClient
from agenticx.skills.registry import SkillRegistryServer


class _HTTPXClientAdapter:
    """Adapter that lets SkillRegistryClient talk to FastAPI TestClient."""

    def __init__(self, app_client: TestClient, *args, **kwargs):  # noqa: ANN002, ANN003
        _ = args, kwargs
        self._client = app_client

    def __enter__(self) -> "_HTTPXClientAdapter":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        _ = exc_type, exc, tb
        return False

    def post(self, url: str, json: dict, headers: dict | None = None):
        path = _extract_path(url)
        return self._client.post(path, json=json, headers=headers or {})

    def get(self, url: str, params: dict | None = None):
        path = _extract_path(url)
        return self._client.get(path, params=params)

    def delete(self, url: str):
        path = _extract_path(url)
        return self._client.delete(path)


def _extract_path(url: str) -> str:
    marker = "://"
    if marker not in url:
        return url
    after = url.split(marker, 1)[1]
    if "/" not in after:
        return "/"
    return "/" + after.split("/", 1)[1]


def _make_skill_dir(tmp_path: Path, name: str, version: str = "0.1.0") -> Path:
    skill_dir = tmp_path / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        (
            "---\n"
            f"name: {name}\n"
            "description: Test skill\n"
            f"version: {version}\n"
            "author: smoke\n"
            "---\n\n"
            "# Test Skill\n"
            "Content.\n"
        ),
        encoding="utf-8",
    )
    return skill_dir


def test_registry_publish_search_install_uninstall(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    storage = RegistryStorage(storage_path=tmp_path / "registry.json")
    server = SkillRegistryServer(storage_path=tmp_path / "registry.json")
    app_client = TestClient(server.create_app())

    monkeypatch.setattr(
        "agenticx.skills.registry.httpx.Client",
        lambda *args, **kwargs: _HTTPXClientAdapter(app_client, *args, **kwargs),
    )

    skill_dir = _make_skill_dir(tmp_path, "demo-skill", "1.0.0")
    client = SkillRegistryClient(registry_url="http://localhost:8321")

    published = client.publish(skill_dir)
    assert published.name == "demo-skill"
    assert published.version == "1.0.0"
    assert published.checksum

    found = client.search("demo")
    assert len(found) == 1
    assert found[0].name == "demo-skill"

    install_root = tmp_path / "installed"
    installed_file = client.install("demo-skill", target_dir=install_root)
    assert installed_file.exists()
    assert "demo-skill" in installed_file.read_text(encoding="utf-8")

    removed = client.uninstall("demo-skill", target_dir=install_root)
    assert removed is True
    assert not installed_file.exists()

    # Also validate storage really persisted one entry.
    rows = storage.list_entries()
    assert len(rows) == 1


def test_registry_duplicate_publish_returns_conflict(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    server = SkillRegistryServer(storage_path=tmp_path / "registry.json")
    app_client = TestClient(server.create_app())
    monkeypatch.setattr(
        "agenticx.skills.registry.httpx.Client",
        lambda *args, **kwargs: _HTTPXClientAdapter(app_client, *args, **kwargs),
    )
    client = SkillRegistryClient(registry_url="http://localhost:8321")
    skill_dir = _make_skill_dir(tmp_path, "dup-skill", "0.2.0")

    first = client.publish(skill_dir)
    assert first.name == "dup-skill"

    with pytest.raises(Exception):
        client.publish(skill_dir)


def test_registry_search_empty_install_missing_invalid_skill(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    server = SkillRegistryServer(storage_path=tmp_path / "registry.json")
    app_client = TestClient(server.create_app())
    monkeypatch.setattr(
        "agenticx.skills.registry.httpx.Client",
        lambda *args, **kwargs: _HTTPXClientAdapter(app_client, *args, **kwargs),
    )
    client = SkillRegistryClient(registry_url="http://localhost:8321")

    assert client.search("not-found-query") == []

    with pytest.raises(Exception):
        client.install("missing-skill", target_dir=tmp_path / "installed")

    invalid_dir = tmp_path / "invalid"
    invalid_dir.mkdir(parents=True, exist_ok=True)
    (invalid_dir / "SKILL.md").write_text("# no frontmatter", encoding="utf-8")
    with pytest.raises(ValueError):
        client.publish(invalid_dir)


def test_registry_install_rejects_path_escape(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    server = SkillRegistryServer(storage_path=tmp_path / "registry.json")
    app_client = TestClient(server.create_app())
    monkeypatch.setattr(
        "agenticx.skills.registry.httpx.Client",
        lambda *args, **kwargs: _HTTPXClientAdapter(app_client, *args, **kwargs),
    )
    client = SkillRegistryClient(registry_url="http://localhost:8321")

    # Override get() to simulate a compromised registry response.
    class _Malicious:
        name = "../escape"
        skill_content = "# bad"

    monkeypatch.setattr(client, "get", lambda name: _Malicious())
    with pytest.raises(ValueError):
        client.install("bad", target_dir=tmp_path / "installed")


def test_registry_write_token_enforced(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    server = SkillRegistryServer(storage_path=tmp_path / "registry.json", write_token="secret")
    app_client = TestClient(server.create_app())
    monkeypatch.setattr(
        "agenticx.skills.registry.httpx.Client",
        lambda *args, **kwargs: _HTTPXClientAdapter(app_client, *args, **kwargs),
    )

    skill_dir = _make_skill_dir(tmp_path, "secure-skill", "0.9.0")

    # No token -> unauthorized.
    no_token_client = SkillRegistryClient(registry_url="http://localhost:8321")
    with pytest.raises(Exception):
        no_token_client.publish(skill_dir)

    # Correct token -> success.
    with_token_client = SkillRegistryClient(
        registry_url="http://localhost:8321",
        write_token="secret",
    )
    entry = with_token_client.publish(skill_dir)
    assert entry.name == "secure-skill"


def test_registry_uninstall_rejects_path_escape(tmp_path: Path):
    client = SkillRegistryClient(registry_url="http://localhost:8321")
    with pytest.raises(ValueError):
        client.uninstall("../../outside", target_dir=tmp_path / "installed")
