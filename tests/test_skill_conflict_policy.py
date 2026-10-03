"""Same-name conflict and cache isolation policy tests (SP3, SEP-2640).

Three prohibitions, each with a negative case:
1. Same-origin (name, version) collision  -> publish rejected with a bump hint.
2. Cross-origin same name                  -> allowed to coexist.
3. Silent replacement of a published version (changed file list under the
   same version)                           -> rejected, stored entry untouched.
Plus: remote-skill caches (``cache/``) and GEPA proposals (``.proposals/``)
are excluded from filesystem skill discovery.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.skills.registry import (
    RegistryStorage,
    build_registry_entry,
    publish_with_auto_bump,
)
from agenticx.tools.skill_bundle import SkillBundleLoader


def _make_skill_dir(
    tmp_path: Path,
    name: str,
    version: str = "1.0.0",
    *,
    body: str = "Original body.\n",
) -> Path:
    skill_dir = tmp_path / name
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: Conflict demo\nversion: {version}\n---\n\n"
        f"# {name}\n\n{body}",
        encoding="utf-8",
    )
    return skill_dir


def _storage(tmp_path: Path) -> RegistryStorage:
    return RegistryStorage(tmp_path / "registry.json")


# ---------------------------------------------------- same-origin collisions


def test_same_origin_name_version_rejected_with_bump_hint(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    storage.publish(build_registry_entry(_make_skill_dir(tmp_path, "collide")))

    # Different content, same (name, version, origin) must be rejected.
    other = _make_skill_dir(tmp_path / "other-copy", "collide", body="Changed body.\n")
    with pytest.raises(ValueError, match="bump the version"):
        storage.publish(build_registry_entry(other, origin="local"))


def test_cross_origin_same_name_and_version_coexist(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    local_entry = build_registry_entry(_make_skill_dir(tmp_path, "shared"))
    mcp_entry = build_registry_entry(_make_skill_dir(tmp_path / "mcp-copy", "shared"))
    mcp_entry.origin = "mcp"

    storage.publish(local_entry)
    storage.publish(mcp_entry)  # same name+version, different origin: allowed

    rows = [e for e in storage.list_entries() if e.name == "shared"]
    assert sorted(e.origin for e in rows) == ["local", "mcp"]
    assert storage.get_latest("shared", origin="local") is not None
    assert storage.get_latest("shared", origin="mcp") is not None

    # Deleting one origin leaves the other intact.
    storage.delete("shared", "1.0.0", origin="local")
    assert storage.get_latest("shared", origin="local") is None
    assert storage.get_latest("shared", origin="mcp") is not None


# ------------------------------------------------------ silent replacement


def test_same_version_changed_file_list_is_not_silently_replaced(
    tmp_path: Path,
) -> None:
    storage = _storage(tmp_path)
    skill_dir = _make_skill_dir(tmp_path, "mutate")
    storage.publish(build_registry_entry(skill_dir))

    # Add a file and change content under the SAME version.
    (skill_dir / "references").mkdir()
    (skill_dir / "references" / "extra.md").write_text("- extra\n", encoding="utf-8")
    (skill_dir / "SKILL.md").write_text(
        "---\nname: mutate\ndescription: Conflict demo\nversion: 1.0.0\n---\n\n"
        "# mutate\n\nRewritten body.\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="bump the version"):
        storage.publish(build_registry_entry(skill_dir))

    # The stored entry was not mutated by the rejected publish.
    stored = storage.get_latest("mutate")
    assert stored is not None
    assert stored.file_contents is not None
    assert set(stored.file_contents) == {"SKILL.md"}
    assert "Original body." in stored.file_contents["SKILL.md"]


def test_publish_with_auto_bump_resolves_collision(tmp_path: Path) -> None:
    storage = _storage(tmp_path)
    storage.publish(build_registry_entry(_make_skill_dir(tmp_path, "bump")))

    revised = _make_skill_dir(tmp_path / "revised", "bump", body="Revised body.\n")
    stored = publish_with_auto_bump(storage, build_registry_entry(revised))

    assert stored.version == "1.0.1"
    rows = [e for e in storage.list_entries() if e.name == "bump"]
    assert sorted(e.version for e in rows) == ["1.0.0", "1.0.1"]


# --------------------------------------------------- discovery exclusions


def _write_skill_md(skill_dir: Path, name: str) -> None:
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: Discovery demo\n---\n\n# {name}\n",
        encoding="utf-8",
    )


def test_discovery_excludes_cache_and_proposal_dirs(tmp_path: Path) -> None:
    root = tmp_path / "skills-root"
    _write_skill_md(root / "real-skill", "real-skill")
    # Level-1 exclusions: remote skill caches + hidden proposal queue.
    _write_skill_md(root / "cache" / "cached-skill", "cached-skill")
    _write_skill_md(root / ".proposals" / "proposed-skill", "proposed-skill")
    # Level-2 exclusion: a cache dir nested inside a grouping dir.
    _write_skill_md(root / "bundles" / "packed-skill", "packed-skill")
    _write_skill_md(root / "bundles" / "cache" / "nested-skill", "nested-skill")

    loader = SkillBundleLoader(search_paths=[root])
    discovered = {meta.name for meta in loader.scan()}

    assert discovered == {"real-skill", "packed-skill"}
    assert "cached-skill" not in discovered
    assert "proposed-skill" not in discovered
    assert "nested-skill" not in discovered
