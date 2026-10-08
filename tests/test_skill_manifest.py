"""Tests for the Skills over MCP manifest models (SEP-2640 wire shape)."""

from __future__ import annotations

import pytest

from agenticx.skills.manifest import (
    MAX_SKILL_BYTES,
    MAX_SKILL_FILES,
    SkillFileEntry,
    SkillIntegrityError,
    SkillManifest,
    SkillManifestError,
    compute_digest,
    parse_frontmatter_from_markdown,
    skill_name_from_uri,
    verify_file,
    verify_frontmatter,
)


def _entry(uri: str = "skill://demo/SKILL.md", content: bytes = b"hello\n") -> dict:
    return {
        "uri": uri,
        "digest": compute_digest(content),
        "size": len(content),
    }


def _manifest(resources=None, frontmatter=None) -> SkillManifest:
    return SkillManifest(
        uri="skill://demo/SKILL.md",
        frontmatter=frontmatter or {"name": "demo", "description": "demo skill"},
        resources=resources if resources is not None else [_entry()],
    )


# --------------------------------------------------------------------- parsing


def test_from_skill_entry_parses_wire_shape() -> None:
    data = {
        "uri": "skill://demo/SKILL.md",
        "frontmatter": {"name": "demo", "description": "d", "license": "MIT"},
        "resources": [_entry()],
        "resultType": "complete",
        "ttlMs": 300000,
        "cacheScope": "public",
    }
    manifest = SkillManifest.from_skill_entry(data)
    assert manifest.uri == "skill://demo/SKILL.md"
    assert manifest.frontmatter["license"] == "MIT"
    assert len(manifest.resources) == 1
    assert manifest.resources[0].digest.startswith("sha256:")
    assert manifest.resultType == "complete"
    assert manifest.ttlMs == 300000


def test_from_skill_entry_accepts_wire_model() -> None:
    from agenticx.skills.mcp_wire import SkillEntryModel

    model = SkillEntryModel(
        uri="skill://demo/SKILL.md",
        frontmatter={"name": "demo"},
        resources=[_entry()],
    )
    manifest = SkillManifest.from_skill_entry(model)
    assert manifest.name == "demo"


def test_from_skill_entry_dynamic() -> None:
    manifest = SkillManifest.from_skill_entry(
        {"uri": "skill://gen/SKILL.md", "frontmatter": {"name": "gen"}, "resources": "dynamic"}
    )
    assert manifest.is_dynamic
    assert manifest.digest_map() == {}
    assert manifest.file_uris() == []


@pytest.mark.parametrize(
    "payload",
    [
        {"frontmatter": {"name": "x"}, "resources": []},
        {"uri": "skill://x/SKILL.md", "resources": []},
        {"uri": "skill://x/SKILL.md", "frontmatter": "not-a-dict", "resources": []},
        {"uri": "skill://x/SKILL.md", "frontmatter": {"name": "x"}, "resources": "dynami"},
        {"uri": "skill://x/SKILL.md", "frontmatter": {"name": "x"}, "resources": [{"uri": "u"}]},
    ],
)
def test_from_skill_entry_rejects_malformed(payload: dict) -> None:
    with pytest.raises(SkillManifestError):
        SkillManifest.from_skill_entry(payload)


# ------------------------------------------------------------------ integrity


def test_verify_file_accepts_matching_bytes() -> None:
    entry = SkillFileEntry.model_validate(_entry(content=b"hello\n"))
    assert verify_file(entry, b"hello\n") is None


def test_verify_file_rejects_tampered_bytes() -> None:
    entry = SkillFileEntry.model_validate(_entry(content=b"hello\n"))
    err = verify_file(entry, b"hEllo\n")
    assert isinstance(err, SkillIntegrityError)
    assert "digest mismatch" in err.reason


def test_verify_file_rejects_size_mismatch() -> None:
    entry = SkillFileEntry.model_validate(_entry(content=b"hello\n"))
    err = verify_file(entry, b"hi")
    assert isinstance(err, SkillIntegrityError)
    assert "size mismatch" in err.reason


def test_verify_frontmatter_field_by_field() -> None:
    manifest = _manifest(frontmatter={"name": "demo", "description": "d", "extra": {"a": 1}})
    assert verify_frontmatter(manifest, {"name": "demo", "description": "d", "extra": {"a": 1}}) is None
    missing = verify_frontmatter(manifest, {"name": "demo", "description": "d"})
    assert missing is not None and "missing key 'extra'" in missing.reason
    changed = verify_frontmatter(manifest, {"name": "other", "description": "d", "extra": {"a": 1}})
    assert changed is not None and "mismatch" in changed.reason


def test_verify_frontmatter_rejects_non_mapping() -> None:
    manifest = _manifest()
    assert verify_frontmatter(manifest, None) is not None


# --------------------------------------------------------------------- limits


def test_check_limits_warns_but_does_not_block() -> None:
    resources = [
        SkillFileEntry(uri=f"skill://demo/f{i}.md", digest=compute_digest(b"x"), size=1)
        for i in range(MAX_SKILL_FILES + 1)
    ]
    manifest = _manifest(resources=resources)
    warnings = manifest.check_limits()
    assert len(warnings) == 1
    assert str(MAX_SKILL_FILES) in warnings[0]


def test_check_limits_bytes() -> None:
    resources = [
        SkillFileEntry(uri="skill://demo/big.bin", digest=compute_digest(b"x"), size=MAX_SKILL_BYTES + 1)
    ]
    manifest = _manifest(resources=resources)
    warnings = manifest.check_limits()
    assert any("bytes" in w for w in warnings)


def test_check_limits_clean_manifest_has_no_warnings() -> None:
    assert _manifest().check_limits() == []


# --------------------------------------------------------------------- helpers


def test_compute_digest_format() -> None:
    digest = compute_digest(b"abc")
    assert digest.startswith("sha256:")
    assert len(digest) == len("sha256:") + 64


def test_skill_name_from_uri() -> None:
    assert skill_name_from_uri("skill://pdf-processing/SKILL.md") == "pdf-processing"
    assert skill_name_from_uri("skill://acme/billing/refunds/SKILL.md") == "refunds"
    assert skill_name_from_uri("skill://acme/billing/refunds/SKILL.md/") == "refunds"
    # Non-SKILL.md URIs fall back to the last path segment.
    assert skill_name_from_uri("skill://x/references/a.md") == "a.md"


def test_manifest_name_falls_back_to_uri() -> None:
    manifest = SkillManifest(uri="skill://demo/SKILL.md", frontmatter={}, resources=[])
    assert manifest.name == "demo"


def test_parse_frontmatter_from_markdown() -> None:
    text = "---\nname: demo\ndescription: d\n---\n\nbody\n"
    fm = parse_frontmatter_from_markdown(text)
    assert fm == {"name": "demo", "description": "d"}
    assert parse_frontmatter_from_markdown("no frontmatter") == {}


def test_find_file_and_total_bytes() -> None:
    manifest = _manifest(
        resources=[
            SkillFileEntry(uri="skill://demo/SKILL.md", digest=compute_digest(b"a"), size=1),
            SkillFileEntry(uri="skill://demo/ref.md", digest=compute_digest(b"bb"), size=2),
        ]
    )
    assert manifest.find_file("skill://demo/ref.md").size == 2
    assert manifest.find_file("skill://demo/nope.md") is None
    assert manifest.total_bytes() == 3
