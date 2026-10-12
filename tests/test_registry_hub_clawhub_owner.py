#!/usr/bin/env python3
"""ClawHub owner handle: search exposes it, fetch sends ownerHandle (HTTP 409 otherwise).

Author: Damon Li
"""

from __future__ import annotations

import io
import zipfile
from typing import Any, Dict, List

import httpx
import pytest

from agenticx.extensions import registry_hub
from agenticx.extensions.registry_hub import RegistryHub, format_clawhub_conflict, split_clawhub_ref


def test_split_clawhub_ref_variants() -> None:
    assert split_clawhub_ref("@pskoett/self-improving-agent") == ("pskoett", "self-improving-agent")
    assert split_clawhub_ref("pskoett/self-improving-agent") == ("pskoett", "self-improving-agent")
    assert split_clawhub_ref("weather") == (None, "weather")
    assert split_clawhub_ref("") == (None, "")


def test_owner_and_author_from_search_record() -> None:
    item = {
        "slug": "paintforge",
        "install": {"kind": "clawhub", "reference": "anyforge/paintforge"},
        "publisher": {"displayName": "anyforge", "handle": "anyforge", "kind": "org"},
    }
    owner, author = registry_hub._clawhub_owner_and_author(item)
    assert owner == "anyforge"
    assert author == "anyforge"
    owner2, author2 = registry_hub._clawhub_owner_and_author(
        {"native": {"owner": {"handle": "pskoett", "displayName": "Peter"}}}
    )
    assert (owner2, author2) == ("pskoett", "Peter")
    assert registry_hub._clawhub_owner_and_author({}) == ("", "unknown")
    owner3, author3 = registry_hub._clawhub_owner_and_author(
        {"slug": "xhs-dpt", "ownerHandle": "cuiyunhai", "displayName": "小红书互动数采集"}
    )
    assert (owner3, author3) == ("cuiyunhai", "cuiyunhai")


def test_format_clawhub_conflict_lists_publisher_refs() -> None:
    msg = format_clawhub_conflict(
        409,
        {
            "code": "AMBIGUOUS_SKILL_SLUG",
            "matches": [
                {"ref": "@cuiyunhai/xhs-dpt"},
                {"ownerHandle": "mystery77777777", "slug": "xhs-dpt"},
            ],
        },
    )
    assert "@cuiyunhai/xhs-dpt" in msg
    assert "@mystery77777777/xhs-dpt" in msg
    assert format_clawhub_conflict(200, {}) == ""


def _zip_with_skill(text: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("SKILL.md", text)
    return buf.getvalue()


def test_fetch_clawhub_markdown_passes_owner_handle(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: List[Dict[str, Any]] = []
    body = "---\nname: self-improving-agent\ndescription: d\n---\n# body\n"

    def _fake_get(url: str, params=None, timeout=None, **_kw):
        calls.append({"url": url, "params": dict(params or {})})
        req = httpx.Request("GET", url)
        if url.endswith("/versions"):
            return httpx.Response(200, json={"items": [{"version": "4.0.3"}]}, request=req)
        if url.endswith("/versions/4.0.3"):
            files = [{"path": "SKILL.md", "sha256": "abc"}]
            return httpx.Response(200, json={"version": {"files": files}}, request=req)
        return httpx.Response(
            200,
            content=_zip_with_skill(body),
            headers={"content-type": "application/zip"},
            request=req,
        )

    monkeypatch.setattr(httpx, "get", _fake_get)
    hub = RegistryHub(registries=[{"name": "clawhub", "type": "clawhub", "url": "https://clawhub.ai/api"}])
    content, err = hub.fetch_skill_markdown("clawhub", "@pskoett/self-improving-agent")
    assert err == ""
    assert content == body
    assert [c["url"] for c in calls] == [
        "https://clawhub.ai/api/v1/packages/self-improving-agent/versions",
        "https://clawhub.ai/api/v1/packages/self-improving-agent/versions/4.0.3",
        "https://clawhub.ai/api/v1/download",
    ]
    assert all(c["params"].get("ownerHandle") == "pskoett" for c in calls)
    assert calls[-1]["params"]["slug"] == "self-improving-agent"


def test_fetch_clawhub_markdown_uses_explicit_owner(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: List[Dict[str, Any]] = []
    body = "---\nname: xhs-dpt\ndescription: d\n---\n# body\n"

    def _fake_get(url: str, params=None, timeout=None, **_kw):
        calls.append({"url": url, "params": dict(params or {})})
        req = httpx.Request("GET", url)
        if url.endswith("/versions"):
            return httpx.Response(200, json={"items": [{"version": "1.1.1"}]}, request=req)
        if url.endswith("/versions/1.1.1"):
            files = [{"path": "SKILL.md", "sha256": "abc"}]
            return httpx.Response(200, json={"version": {"files": files}}, request=req)
        return httpx.Response(
            200,
            content=_zip_with_skill(body),
            headers={"content-type": "application/zip"},
            request=req,
        )

    monkeypatch.setattr(httpx, "get", _fake_get)
    hub = RegistryHub(registries=[{"name": "clawhub", "type": "clawhub", "url": "https://clawhub.ai/api"}])
    content, err = hub.fetch_skill_markdown("clawhub", "xhs-dpt", owner="cuiyunhai")
    assert err == ""
    assert content == body
    assert all(c["params"].get("ownerHandle") == "cuiyunhai" for c in calls)


def test_fetch_clawhub_markdown_409_names_publishers(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_get(url: str, params=None, timeout=None, **_kw):
        req = httpx.Request("GET", url)
        return httpx.Response(
            409,
            json={
                "code": "AMBIGUOUS_SKILL_SLUG",
                "matches": [{"ref": "@cuiyunhai/xhs-dpt"}, {"ref": "@mystery77777777/xhs-dpt"}],
            },
            request=req,
        )

    monkeypatch.setattr(httpx, "get", _fake_get)
    hub = RegistryHub(registries=[{"name": "clawhub", "type": "clawhub", "url": "https://clawhub.ai/api"}])
    content, err = hub.fetch_skill_markdown("clawhub", "xhs-dpt")
    assert content is None
    assert "@cuiyunhai/xhs-dpt" in err
    assert "@mystery77777777/xhs-dpt" in err


def _zip_package(members: Dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, text in members.items():
            zf.writestr(name, text)
    return buf.getvalue()


def test_fetch_clawhub_package_downloads_all_files(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: List[Dict[str, Any]] = []
    body = "---\nname: xhs-comments\ndescription: d\n---\nRun `node cli.js start`.\n"
    archive = _zip_package(
        {
            "SKILL.md": body,
            "cli.js": "console.log('ok')\n",
            "src/client.js": "module.exports = {}\n",
            "_meta.json": "{}",
            "../escape.js": "bad",
            ".hidden": "x",
        }
    )

    def _fake_get(url: str, params=None, timeout=None, **_kw):
        calls.append({"url": url, "params": dict(params or {})})
        req = httpx.Request("GET", url)
        if url.endswith("/versions"):
            return httpx.Response(200, json={"items": [{"version": "2.0.0"}]}, request=req)
        if url.endswith("/versions/2.0.0"):
            files = [{"path": "SKILL.md", "sha256": "abc"}, {"path": "cli.js", "sha256": "def"}]
            return httpx.Response(200, json={"version": {"files": files}}, request=req)
        return httpx.Response(200, content=archive, headers={"content-type": "application/zip"}, request=req)

    monkeypatch.setattr(httpx, "get", _fake_get)
    hub = RegistryHub(registries=[{"name": "clawhub", "type": "clawhub", "url": "https://clawhub.ai/api"}])
    content, files, err = hub.fetch_skill_package("clawhub", "xhs-comments", owner="cuiyunhai")
    assert err == ""
    assert content == body
    assert sorted(files) == ["cli.js", "src/client.js"]
    assert "file" not in calls[-1]["params"]
    assert calls[-1]["params"]["version"] == "2.0.0"


def test_write_registry_skill_package_lands_scripts(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.setattr(registry_hub.Path, "home", classmethod(lambda cls: tmp_path))
    hub = RegistryHub(registries=[])
    md_path = hub.write_registry_skill_package(
        "xhs-comments",
        "---\nname: xhs-comments\ndescription: d\n---\n",
        {"cli.js": b"console.log(1)\n", "src/client.js": b"x\n"},
    )
    skill_dir = md_path.parent
    assert skill_dir == tmp_path / ".agenticx" / "skills" / "registry" / "xhs-comments"
    assert (skill_dir / "cli.js").read_bytes() == b"console.log(1)\n"
    assert (skill_dir / "src" / "client.js").is_file()
    assert "source: registry" in md_path.read_text(encoding="utf-8")


def test_search_result_to_dict_includes_owner() -> None:
    result = registry_hub.SearchResult(name="gog", description="", owner="steipete")
    assert result.to_dict()["owner"] == "steipete"
