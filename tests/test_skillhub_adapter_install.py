#!/usr/bin/env python3
"""Unit tests for SkillHub namespaced download / search→install.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from agenticx.extensions import skillhub_adapter as adapter


def test_parse_skillhub_ref_variants() -> None:
    assert adapter.parse_skillhub_ref("archify") == (None, "archify")
    assert adapter.parse_skillhub_ref("@indiv-seafish/archify") == (
        "indiv-seafish",
        "archify",
    )
    assert adapter.parse_skillhub_ref("indiv-seafish/archify") == (
        "indiv-seafish",
        "archify",
    )
    assert adapter.parse_skillhub_ref("@indiv-seafish/archify@1.0.0") == (
        "indiv-seafish",
        "archify",
    )
    assert adapter.parse_skillhub_ref("") == (None, "")


def test_build_download_url_template_bakes_namespace() -> None:
    templ = adapter.build_skillhub_download_url_template("indiv-seafish")
    assert "{slug}" in templ
    assert "namespace=indiv-seafish" in templ
    assert "{namespace}" not in templ


def test_resolve_namespace_from_explicit_ref() -> None:
    ns, err = adapter.resolve_skillhub_namespace("archify", "indiv-seafish")
    assert ns == "indiv-seafish"
    assert err == ""


def test_resolve_namespace_via_search_exact_slug() -> None:
    def fake_search(q: str) -> List[Dict[str, Any]]:
        assert q == "archify"
        return [
            {
                "slug": "tt-a1i-archify",
                "namespace": "org-other",
            },
            {
                "slug": "archify",
                "namespace": "indiv-seafish",
                "canonical": "@indiv-seafish/archify",
            },
        ]

    ns, err = adapter.resolve_skillhub_namespace("archify", search_fn=fake_search)
    assert err == ""
    assert ns == "indiv-seafish"


def test_resolve_namespace_missing() -> None:
    ns, err = adapter.resolve_skillhub_namespace(
        "nope", search_fn=lambda _q: [{"slug": "nope"}]
    )
    assert ns is None
    assert "no namespace" in err


def test_install_passes_namespaced_primary_download_url(monkeypatch, tmp_path: Path) -> None:
    calls: List[List[str]] = []

    skill_root = tmp_path / "out"
    skill_dir = skill_root / "archify"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text("# Archify\n", encoding="utf-8")
    (skill_dir / "references").mkdir()
    (skill_dir / "references" / "checklist.md").write_text("ok\n", encoding="utf-8")

    def fake_run(argv, **kwargs):  # noqa: ANN001
        calls.append(list(argv))
        class Proc:
            returncode = 0
            stdout = "ok"
            stderr = ""
        return Proc()

    monkeypatch.setattr(adapter.shutil, "which", lambda _n: "/usr/bin/skillhub")
    monkeypatch.setattr(adapter.subprocess, "run", fake_run)
    # Avoid home CLI candidate doubling attempts.
    monkeypatch.setattr(adapter.Path, "home", classmethod(lambda cls: tmp_path / "nohome"))

    ok, err, code = adapter._install_via_skillhub_cli(
        "archify", skill_root, namespace="indiv-seafish"
    )
    assert ok is True
    assert err == ""
    assert code == ""
    assert calls, "expected CLI invoke"
    argv = calls[0]
    assert "install" in argv
    assert "archify" in argv
    assert "--primary-download-url-template" in argv
    templ = argv[argv.index("--primary-download-url-template") + 1]
    assert "namespace=indiv-seafish" in templ
    assert "{slug}" in templ


def test_install_rc0_without_skill_md_is_failure(monkeypatch, tmp_path: Path) -> None:
    def fake_run(argv, **kwargs):  # noqa: ANN001
        class Proc:
            returncode = 0
            stdout = "Installed?"
            stderr = ""
        return Proc()

    monkeypatch.setattr(adapter.shutil, "which", lambda _n: "/usr/bin/skillhub")
    monkeypatch.setattr(adapter.subprocess, "run", fake_run)
    monkeypatch.setattr(adapter.Path, "home", classmethod(lambda cls: tmp_path / "nohome"))

    empty = tmp_path / "empty"
    empty.mkdir()
    ok, err, code = adapter._install_via_skillhub_cli(
        "archify", empty, namespace="indiv-seafish"
    )
    assert ok is False
    assert code == "missing_skill_md"
    assert "SKILL.md" in err


def test_install_maps_http_404_to_short_error(monkeypatch, tmp_path: Path) -> None:
    def fake_run(argv, **kwargs):  # noqa: ANN001
        class Proc:
            returncode = 1
            stdout = ""
            stderr = (
                "Downloading: https://api.skillhub.cn/api/v1/download?slug=archify\n"
                "Error: Download failed: HTTP 404 for "
                "https://api.skillhub.cn/api/v1/download?slug=archify\n"
            )
        return Proc()

    monkeypatch.setattr(adapter.shutil, "which", lambda _n: "/usr/bin/skillhub")
    monkeypatch.setattr(adapter.subprocess, "run", fake_run)
    monkeypatch.setattr(adapter.Path, "home", classmethod(lambda cls: tmp_path / "nohome"))

    dest = tmp_path / "dest"
    dest.mkdir()
    ok, err, code = adapter._install_via_skillhub_cli(
        "archify", dest, namespace="indiv-seafish"
    )
    assert ok is False
    assert code == "skillhub_http_404"
    assert "HTTP 404" in err
    assert "skillhub install" not in err.lower() or len(err) < 120
    # Toast truncation budget: short reason must fit.
    assert len(err) <= 200


def test_install_skillhub_skill_search_then_install(monkeypatch, tmp_path: Path) -> None:
    """Bare slug resolves namespace via search, then installs with namespaced URL."""

    def fake_search(q: str) -> List[Dict[str, Any]]:
        return [{"slug": "archify", "namespace": "indiv-seafish"}]

    monkeypatch.setattr(adapter, "_search_via_skillhub_api", fake_search)

    def fake_cli(slug: str, dest_dir: Path, *, namespace: str):
        assert slug == "archify"
        assert namespace == "indiv-seafish"
        skill_dir = dest_dir / "archify"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: archify\ndescription: d\n---\n# Archify\n",
            encoding="utf-8",
        )
        return True, "", ""

    monkeypatch.setattr(adapter, "_install_via_skillhub_cli", fake_cli)

    class FakeHub:
        @classmethod
        def from_config(cls):
            return cls()

        def write_registry_skill_dir(self, name, src_dir, *, source="skillhub"):
            assert name == "archify"
            assert (Path(src_dir) / "SKILL.md").is_file()
            out = tmp_path / "registry" / name / "SKILL.md"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text((Path(src_dir) / "SKILL.md").read_text(encoding="utf-8"), encoding="utf-8")
            return out

    monkeypatch.setattr(
        "agenticx.extensions.registry_hub.RegistryHub.from_config",
        FakeHub.from_config,
    )

    # Guard may flag content; keep it simple/clean.
    monkeypatch.setattr(
        "agenticx.skills.guard.scan_skill_markdown_text",
        lambda _t: type("SR", (), {"verdict": "safe", "findings": []})(),
    )
    monkeypatch.setattr(
        "agenticx.skills.guard.scan_result_to_payload",
        lambda sr, name: {"name": name, "verdict": sr.verdict},
    )

    result = adapter.install_skillhub_skill("archify")
    assert result["ok"] is True
    assert result["slug"] == "archify"
    assert result["namespace"] == "indiv-seafish"
    assert result["canonical"] == "@indiv-seafish/archify"


def test_install_skillhub_skill_at_ref_skips_search(monkeypatch, tmp_path: Path) -> None:
    searched = {"n": 0}

    def boom(_q: str):
        searched["n"] += 1
        raise AssertionError("search should not run when namespace is explicit")

    monkeypatch.setattr(adapter, "_search_via_skillhub_api", boom)

    def fake_cli(slug: str, dest_dir: Path, *, namespace: str):
        assert slug == "archify"
        assert namespace == "indiv-seafish"
        skill_dir = dest_dir / "archify"
        skill_dir.mkdir(parents=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: archify\ndescription: d\n---\n# Archify\n",
            encoding="utf-8",
        )
        return True, "", ""

    monkeypatch.setattr(adapter, "_install_via_skillhub_cli", fake_cli)

    class FakeHub:
        @classmethod
        def from_config(cls):
            return cls()

        def write_registry_skill_dir(self, name, src_dir, *, source="skillhub"):
            out = tmp_path / "registry" / name / "SKILL.md"
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text("# ok\n", encoding="utf-8")
            return out

    monkeypatch.setattr(
        "agenticx.extensions.registry_hub.RegistryHub.from_config",
        FakeHub.from_config,
    )
    monkeypatch.setattr(
        "agenticx.skills.guard.scan_skill_markdown_text",
        lambda _t: type("SR", (), {"verdict": "safe", "findings": []})(),
    )
    monkeypatch.setattr(
        "agenticx.skills.guard.scan_result_to_payload",
        lambda sr, name: {"name": name, "verdict": sr.verdict},
    )

    result = adapter.install_skillhub_skill("@indiv-seafish/archify")
    assert result["ok"] is True
    assert searched["n"] == 0
    assert result["namespace"] == "indiv-seafish"


def test_row_to_market_item_extracts_namespace_object() -> None:
    item = adapter._row_to_market_item(
        {
            "slug": "archify",
            "displayName": "archify",
            "summary": "diagrams",
            "version": "1.0.0",
            "namespace": {
                "canonicalName": "@indiv-seafish/archify",
                "handle": "indiv-seafish",
                "publicSlug": "archify",
            },
            "downloads": 9,
        }
    )
    assert item is not None
    assert item["slug"] == "archify"
    assert item["namespace"] == "indiv-seafish"
    assert item["canonical"] == "@indiv-seafish/archify"


def test_short_cli_error_http() -> None:
    reason, code = adapter._short_cli_error(
        "Error: Download failed: HTTP 404 for https://x",
        "",
        1,
    )
    assert code == "skillhub_http_404"
    assert "HTTP 404" in reason
