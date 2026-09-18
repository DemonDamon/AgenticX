"""Tests for RegistrySkillEntry v2 — multi-file manifests (SP3, SEP-2640).

Covers: build_registry_entry from a directory, v1/v2 mixed storage reads,
same-(name, version, origin) publish rejection, and the 512-file / 16-MiB
publish limits.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.skills.manifest import MAX_SKILL_BYTES, MAX_SKILL_FILES, compute_digest
from agenticx.skills.mcp_server import RegistrySkillSource
from agenticx.skills.registry import (
    RegistrySkillEntry,
    RegistryStorage,
    build_registry_entry,
)


def _make_skill_dir(
    tmp_path: Path,
    name: str = "multi-demo",
    version: str = "1.0.0",
    *,
    with_extras: bool = True,
) -> Path:
    skill_dir = tmp_path / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: Multi-file demo\nversion: {version}\n---\n\n"
        "# Demo\n\nSee references.\n",
        encoding="utf-8",
    )
    if with_extras:
        refs = skill_dir / "references"
        refs.mkdir()
        (refs / "checklist.md").write_text("- step one\n- step two\n", encoding="utf-8")
        scripts = skill_dir / "scripts"
        scripts.mkdir()
        (scripts / "run.py").write_text("print('hi')\n", encoding="utf-8")
    return skill_dir


# ------------------------------------------------------------ build_registry_entry


def test_build_registry_entry_computes_full_manifest(tmp_path: Path) -> None:
    skill_dir = _make_skill_dir(tmp_path)
    entry = build_registry_entry(skill_dir, origin="local")

    assert entry.name == "multi-demo"
    assert entry.version == "1.0.0"
    assert entry.origin == "local"
    assert entry.skill_content == (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    # Legacy checksum semantics: bare SHA-256 hex of SKILL.md.
    assert entry.checksum == compute_digest(entry.skill_content.encode("utf-8"))[
        len("sha256:")
    :]

    paths = [f["path"] for f in entry.files]
    assert paths == ["SKILL.md", "references/checklist.md", "scripts/run.py"]
    for row in entry.files:
        raw = (skill_dir / row["path"]).read_bytes()
        assert row["digest"] == compute_digest(raw)
        assert row["size"] == len(raw)
        assert entry.file_contents[row["path"]] == raw.decode("utf-8")


def test_build_registry_entry_excludes_hidden_files(tmp_path: Path) -> None:
    skill_dir = _make_skill_dir(tmp_path, name="hidden-demo")
    (skill_dir / ".changelog").write_text("local metadata\n", encoding="utf-8")
    hidden_dir = skill_dir / ".git"
    hidden_dir.mkdir()
    (hidden_dir / "config").write_text("gitdir\n", encoding="utf-8")

    entry = build_registry_entry(skill_dir)
    paths = [f["path"] for f in entry.files]
    assert ".changelog" not in paths
    assert all(not p.startswith(".") and "/." not in f"/{p}" for p in paths)


def test_build_registry_entry_rejects_missing_skill_md(tmp_path: Path) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(FileNotFoundError):
        build_registry_entry(empty)


def test_build_registry_entry_rejects_missing_name(tmp_path: Path) -> None:
    skill_dir = tmp_path / "anon"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text("# no frontmatter\n", encoding="utf-8")
    with pytest.raises(ValueError, match="name"):
        build_registry_entry(skill_dir)


def test_build_registry_entry_rejects_non_text_file(tmp_path: Path) -> None:
    skill_dir = _make_skill_dir(tmp_path, name="binary-demo")
    (skill_dir / "logo.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00")
    with pytest.raises(ValueError, match="not UTF-8"):
        build_registry_entry(skill_dir)


def test_build_registry_entry_rejects_too_many_files(tmp_path: Path) -> None:
    skill_dir = tmp_path / "many-files"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_text(
        "---\nname: many-files\ndescription: d\n---\n\nBody.\n", encoding="utf-8"
    )
    extra = skill_dir / "references"
    extra.mkdir()
    for i in range(MAX_SKILL_FILES):  # SKILL.md + 512 = 513 > 512
        (extra / f"f{i:03d}.md").write_text(f"- {i}\n", encoding="utf-8")
    with pytest.raises(ValueError, match="file limit"):
        build_registry_entry(skill_dir)


# -------------------------------------------------------------------- storage


def test_v1_and_v2_entries_mixed_read(tmp_path: Path) -> None:
    storage = RegistryStorage(tmp_path / "registry.json")
    # v1 entry (legacy, no files key).
    storage.publish(
        RegistrySkillEntry(
            name="legacy",
            version="0.1.0",
            description="old",
            skill_content="# Legacy\n",
        )
    )
    # v2 entry from a directory.
    skill_dir = _make_skill_dir(tmp_path)
    storage.publish(build_registry_entry(skill_dir))

    rows = storage.list_entries()
    by_name = {r.name: r for r in rows}
    assert set(by_name) == {"legacy", "multi-demo"}
    assert by_name["legacy"].files is None
    assert by_name["legacy"].origin == "local"  # default for legacy rows
    assert by_name["multi-demo"].files is not None
    assert by_name["multi-demo"].file_contents is not None
    assert by_name["multi-demo"].origin == "local"


def test_publish_same_version_same_origin_rejected_with_bump_hint(
    tmp_path: Path,
) -> None:
    storage = RegistryStorage(tmp_path / "registry.json")
    skill_dir = _make_skill_dir(tmp_path)
    storage.publish(build_registry_entry(skill_dir))

    # Same content, same (name, version, origin) — still rejected: a published
    # version is immutable, even byte-identical republishes must bump.
    with pytest.raises(ValueError, match="bump the version"):
        storage.publish(build_registry_entry(skill_dir))


def test_publish_rejects_oversized_v2_entry(tmp_path: Path) -> None:
    entry = build_registry_entry(_make_skill_dir(tmp_path))
    # Forge the manifest sizes past the byte limit (no giant write needed).
    entry.files = [{"path": "SKILL.md", "digest": "sha256:" + "0" * 64,
                    "size": MAX_SKILL_BYTES + 1}]
    with pytest.raises(ValueError, match="byte limit"):
        RegistryStorage(tmp_path / "registry.json").publish(entry)


def test_publish_rejects_too_many_files_entry(tmp_path: Path) -> None:
    entry = build_registry_entry(_make_skill_dir(tmp_path))
    entry.files = [{"path": f"f{i}", "digest": "sha256:" + "0" * 64, "size": 1}
                   for i in range(MAX_SKILL_FILES + 1)]
    with pytest.raises(ValueError, match="file limit"):
        RegistryStorage(tmp_path / "registry.json").publish(entry)


# -------------------------------------------------- v2 entries through SP2 serving


def test_source_serves_v2_multi_file_manifest(tmp_path: Path) -> None:
    storage = RegistryStorage(tmp_path / "registry.json")
    skill_dir = _make_skill_dir(tmp_path)
    storage.publish(build_registry_entry(skill_dir))

    source = RegistrySkillSource(storage)
    manifest = source.get_manifest("skill://multi-demo/SKILL.md")
    assert manifest is not None
    assert manifest.file_uris() == [
        "skill://multi-demo/SKILL.md",
        "skill://multi-demo/references/checklist.md",
        "skill://multi-demo/scripts/run.py",
    ]
    checklist = manifest.find_file("skill://multi-demo/references/checklist.md")
    assert checklist is not None
    raw = (skill_dir / "references" / "checklist.md").read_bytes()
    assert checklist.digest == compute_digest(raw)
    assert checklist.size == len(raw)

    # Any manifest file is readable; digests are recomputed from stored bytes.
    assert source.read_file("skill://multi-demo/scripts/run.py") == b"print('hi')\n"
    assert source.read_file("skill://multi-demo/SKILL.md") is not None
    assert source.read_file("skill://multi-demo/missing.md") is None


def test_source_serves_drifted_digest_as_computed(tmp_path: Path) -> None:
    storage = RegistryStorage(tmp_path / "registry.json")
    entry = build_registry_entry(_make_skill_dir(tmp_path))
    entry.files[0]["digest"] = "sha256:" + "0" * 64  # forge a drift
    storage.publish(entry)

    source = RegistrySkillSource(storage)
    manifest = source.get_manifest("skill://multi-demo/SKILL.md")
    assert manifest is not None
    raw = (tmp_path / "multi-demo" / "SKILL.md").read_bytes()
    served = manifest.find_file("skill://multi-demo/SKILL.md")
    assert served is not None
    assert served.digest == compute_digest(raw)  # computed, not the drifted value


def test_source_refuses_v2_entry_missing_content(tmp_path: Path) -> None:
    storage = RegistryStorage(tmp_path / "registry.json")
    entry = build_registry_entry(_make_skill_dir(tmp_path))
    del entry.file_contents["references/checklist.md"]
    storage.publish(entry)

    source = RegistrySkillSource(storage)
    assert source.get_manifest("skill://multi-demo/SKILL.md") is None


def test_registry_json_is_plain_json_roundtrip(tmp_path: Path) -> None:
    storage = RegistryStorage(tmp_path / "registry.json")
    storage.publish(build_registry_entry(_make_skill_dir(tmp_path)))

    raw = json.loads((tmp_path / "registry.json").read_text(encoding="utf-8"))
    row = raw["skills"]["multi-demo"][0]
    assert row["origin"] == "local"
    assert isinstance(row["files"], list)
    assert isinstance(row["file_contents"], dict)
    assert row["files"][0]["path"] == "SKILL.md"
    assert row["files"][0]["digest"].startswith("sha256:")
