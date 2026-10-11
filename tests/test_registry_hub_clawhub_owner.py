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
from agenticx.extensions.registry_hub import RegistryHub, split_clawhub_ref


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


def test_search_result_to_dict_includes_owner() -> None:
    result = registry_hub.SearchResult(name="gog", description="", owner="steipete")
    assert result.to_dict()["owner"] == "steipete"
