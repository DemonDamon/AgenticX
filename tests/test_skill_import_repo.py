#!/usr/bin/env python3
"""Tests for skill_import_repo (M3).

Author: Damon Li
"""

import io
import tarfile
from pathlib import Path

import pytest

from agenticx.skills.import_repo import (
    _filter_skill_paths,
    install_skill_full_from_repo,
    import_skills_from_repo,
)


def test_filter_skill_paths_excludes_deprecated() -> None:
    paths = [
        "skills/engineering/tdd/SKILL.md",
        "skills/deprecated/qa/SKILL.md",
        "skills/in-progress/foo/SKILL.md",
        "README.md",
    ]
    out = _filter_skill_paths(paths, "skills/**/SKILL.md", ["**/deprecated/**", "**/in-progress/**"])
    assert out == ["engineering/tdd"]


def test_import_dry_run_skips_network(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))

    def fake_tree(owner: str, name: str, branch: str):
        assert owner == "mattpocock"
        assert name == "skills"
        return ["skills/engineering/tdd/SKILL.md"]

    monkeypatch.setattr("agenticx.skills.import_repo._github_tree", fake_tree)
    result = import_skills_from_repo(repo="mattpocock/skills", dry_run=True)
    assert result.dry_run is True
    assert result.pending == ["engineering/tdd"]
    assert result.installed == []


# ---------------------------------------------------------------------------
# install_skill_full_from_repo (full-directory tarball install)
# ---------------------------------------------------------------------------

def _make_tarball(members: list[tuple[str, bytes | None]], root: str = "fakerepo-main") -> bytes:
    """Build an in-memory gzipped tarball. None content => directory entry."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        for name, content in members:
            info = tarfile.TarInfo(name=f"{root}/{name}")
            if content is None:
                info.type = tarfile.DIRTYPE
                tf.addfile(info)
            else:
                info.size = len(content)
                tf.addfile(info, io.BytesIO(content))
    return buf.getvalue()


_SKILL_MD = b"---\nname: diagram-design\ndescription: test skill\n---\n\n# Diagram Design\n"

_GOOD_MEMBERS: list[tuple[str, bytes | None]] = [
    ("skills", None),
    ("skills/diagram-design", None),
    ("skills/diagram-design/SKILL.md", _SKILL_MD),
    ("skills/diagram-design/references", None),
    ("skills/diagram-design/references/type-architecture.md", b"# Architecture\n"),
    ("skills/diagram-design/assets/example.html", b"<html></html>"),
    ("skills/other-skill/SKILL.md", b"---\nname: other\n---\n"),
    ("README.md", b"readme"),
]


def _patch_home_and_net(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tarball: bytes,
) -> Path:
    """Patch Path.home to tmp_path and the tarball download; return skills root."""
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(
        "agenticx.skills.import_repo._download_tarball",
        lambda owner, name, branch: tarball,
    )
    # guard always allows by default in these tests
    monkeypatch.setattr(
        "agenticx.skills.guard.scan_skill",
        lambda skill_dir, source="agent-created": None,
    )
    monkeypatch.setattr(
        "agenticx.skills.guard.should_allow",
        lambda scan, source: (True, ""),
    )
    return tmp_path / ".agenticx" / "skills"


def test_install_full_success(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(_GOOD_MEMBERS))
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design")
    assert result.errors == []
    assert result.installed == ["diagram-design"]
    target = root / "registry" / "diagram-design"
    assert (target / "SKILL.md").read_bytes() == _SKILL_MD
    assert (target / "references/type-architecture.md").is_file()
    assert (target / "assets/example.html").is_file()
    # only the named skill is extracted
    assert not (root / "registry" / "other-skill").exists()
    assert not (root / "other-skill").exists()


def test_install_full_skips_symlink_members(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        good = tarfile.TarInfo("fakerepo-main/skills/diagram-design/SKILL.md")
        good.size = len(_SKILL_MD)
        tf.addfile(good, io.BytesIO(_SKILL_MD))
        link = tarfile.TarInfo("fakerepo-main/skills/diagram-design/evil-link")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        tf.addfile(link)
    _patch_home_and_net(tmp_path, monkeypatch, buf.getvalue())
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design")
    assert result.installed == ["diagram-design"]
    assert not (tmp_path / ".agenticx/skills/registry/diagram-design/evil-link").exists()


def test_install_full_rejects_path_traversal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    members = _GOOD_MEMBERS + [
        ("skills/diagram-design/sub/../../evil.txt", b"evil"),
    ]
    # NOTE: tarfile itself normalizes nothing; ".." stays in the member name.
    root = _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(members))
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design")
    assert result.installed == []
    assert any("unsafe path" in e for e in result.errors)
    assert not (root / "registry" / "diagram-design").exists()
    assert not (root / "registry" / "evil.txt").exists()
    # no leftover staging dirs
    assert not any(p.name.startswith(".tmp-") for p in (root / "registry").iterdir())


def test_install_full_guard_reject_keeps_old_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(_GOOD_MEMBERS))
    target = root / "registry" / "diagram-design"
    target.mkdir(parents=True)
    (target / "SKILL.md").write_text("---\nname: diagram-design\nversion: old\n---\n", encoding="utf-8")
    monkeypatch.setattr(
        "agenticx.skills.guard.should_allow",
        lambda scan, source: (False, "dangerous content"),
    )

    class _FakeScan:
        verdict = "dangerous"

    monkeypatch.setattr(
        "agenticx.skills.guard.scan_skill",
        lambda skill_dir, source="agent-created": _FakeScan(),
    )
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design", overwrite=True)
    assert result.installed == []
    assert result.high_risk_confirm_required == ["diagram-design"]
    assert result.rejected_by_guard[0]["reason"].startswith("high_risk_confirm_required")
    # old version untouched
    assert "version: old" in (target / "SKILL.md").read_text(encoding="utf-8")
    assert not any(p.name.startswith(".tmp-") for p in (root / "registry").iterdir())

    # acknowledged retry proceeds past the dangerous verdict
    result2 = install_skill_full_from_repo(
        repo="owner/fakerepo", skill="diagram-design", overwrite=True,
        acknowledge_high_risk=True,
    )
    assert result2.installed == ["diagram-design"]
    assert (target / "SKILL.md").read_bytes() == _SKILL_MD


def test_install_full_skip_existing_and_overwrite(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(_GOOD_MEMBERS))
    target = root / "registry" / "diagram-design"
    target.mkdir(parents=True)
    (target / "SKILL.md").write_text("old", encoding="utf-8")

    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design")
    assert result.skipped_existing == ["diagram-design"]
    assert (target / "SKILL.md").read_text(encoding="utf-8") == "old"

    result2 = install_skill_full_from_repo(
        repo="owner/fakerepo", skill="diagram-design", overwrite=True
    )
    assert result2.installed == ["diagram-design"]
    assert (target / "SKILL.md").read_bytes() == _SKILL_MD


def test_install_full_dry_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(_GOOD_MEMBERS))
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design", dry_run=True)
    assert result.dry_run is True
    assert result.pending == ["diagram-design"]
    assert not (root / "registry" / "diagram-design").exists()


def test_install_full_file_count_cap(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    members: list[tuple[str, bytes | None]] = [("skills/diagram-design/SKILL.md", _SKILL_MD)]
    for i in range(5):
        members.append((f"skills/diagram-design/references/f{i}.md", b"x"))
    _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(members))
    monkeypatch.setattr("agenticx.skills.import_repo._TARBALL_MAX_FILES", 3)
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design")
    assert result.installed == []
    assert any("too many files" in e for e in result.errors)


def test_install_full_invalid_skill_name(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(_GOOD_MEMBERS))
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="../evil")
    assert result.installed == []
    assert result.errors


def test_install_full_missing_skill_md(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    members = [("skills/other-skill/SKILL.md", b"---\nname: other\n---\n")]
    root = _patch_home_and_net(tmp_path, monkeypatch, _make_tarball(members))
    result = install_skill_full_from_repo(repo="owner/fakerepo", skill="diagram-design")
    assert result.installed == []
    assert any("no SKILL.md" in e for e in result.errors)
