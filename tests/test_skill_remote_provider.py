"""RemoteSkillProvider tests: reading-point verification, refresh, cache.

Covers the three rejection paths required by SP1 Task 3 (digest mismatch,
reads outside the manifest, dynamic skills) plus retain/release semantics,
refresh digest diffs, and the immutable on-disk cache.
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Dict, List, Optional

import pytest

from agenticx.skills.manifest import (
    SkillIntegrityError,
    SkillManifest,
    SkillNotFoundError,
    compute_digest,
)
from agenticx.skills.remote_provider import RemoteSkillProvider


# --------------------------------------------------------------------- fakes


class FakeResourceContent:
    def __init__(
        self,
        uri: str,
        *,
        text: Optional[str] = None,
        blob: Optional[str] = None,
        mime_type: Optional[str] = None,
    ) -> None:
        self.uri = uri
        self.text = text
        self.blob = blob
        self.mimeType = mime_type


class FakeReadResult:
    def __init__(self, contents: List[FakeResourceContent]) -> None:
        self.contents = contents


class FakeSkillsClient:
    """In-memory stand-in for the MCPClientV2 skills surface."""

    def __init__(self) -> None:
        self.skills: Dict[str, SkillManifest] = {}
        self.resources: Dict[str, bytes] = {}
        self.blob_uris: set = set()
        self.get_calls: List[str] = []
        self.read_calls: List[str] = []

    def add_skill(self, manifest: SkillManifest, files: Optional[Dict[str, bytes]] = None) -> None:
        self.skills[manifest.uri] = manifest
        for uri, content in (files or {}).items():
            self.resources[uri] = content

    def add_blob_resource(self, uri: str, content: bytes) -> None:
        self.resources[uri] = content
        self.blob_uris.add(uri)

    async def list_skills(self) -> List[SkillManifest]:
        return list(self.skills.values())

    async def get_skill(self, uri: str) -> SkillManifest:
        self.get_calls.append(uri)
        manifest = self.skills.get(uri)
        if manifest is None:
            raise SkillNotFoundError(uri)
        return manifest

    async def read_resource(self, uri: str) -> FakeReadResult:
        self.read_calls.append(uri)
        content = self.resources.get(uri)
        if content is None:
            raise AssertionError(f"no fake resource registered for {uri}")
        if uri in self.blob_uris:
            return FakeReadResult(
                [FakeResourceContent(uri, blob=base64.b64encode(content).decode())]
            )
        return FakeReadResult([FakeResourceContent(uri, text=content.decode("utf-8"))])


def _build_skill(
    name: str = "demo",
    extra_files: Optional[Dict[str, bytes]] = None,
    frontmatter: Optional[Dict] = None,
) -> "tuple[SkillManifest, Dict[str, bytes]]":
    """Build a manifest + file map whose digests match the byte contents."""
    skill_md = (
        f"---\nname: {name}\ndescription: {name} skill\n---\n\n# {name}\n\nbody\n"
    ).encode()
    files: Dict[str, bytes] = {"SKILL.md": skill_md}
    files.update(extra_files or {})
    resources = []
    for rel, content in files.items():
        uri = f"skill://{name}/{rel}"
        resources.append(
            {"uri": uri, "digest": compute_digest(content), "size": len(content)}
        )
    manifest = SkillManifest(
        uri=f"skill://{name}/SKILL.md",
        frontmatter=frontmatter
        if frontmatter is not None
        else {"name": name, "description": f"{name} skill"},
        resources=resources,
    )
    return manifest, {f"skill://{name}/{rel}": c for rel, c in files.items()}


def _provider(tmp_path: Path, client: FakeSkillsClient, server_id: str = "srv-a") -> RemoteSkillProvider:
    return RemoteSkillProvider(client, server_id, cache_root=tmp_path / "cache")


# ------------------------------------------------------- happy path + retain


async def test_read_file_verifies_and_writes_immutable_cache(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill(extra_files={"ref.md": b"# ref\n"})
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)

    retained = await provider.retain(manifest.uri)
    assert retained.uri == manifest.uri
    assert provider.retained(manifest.uri) is not None

    result = await provider.read_file(f"skill://demo/SKILL.md")
    assert result.uri == "skill://demo/SKILL.md"
    assert result.text == files["skill://demo/SKILL.md"].decode()
    assert result.content == files["skill://demo/SKILL.md"]

    # Cache layout: <cache_root>/<server_id>/<skill_name>/<relative path>
    cached = tmp_path / "cache" / "srv-a" / "demo" / "SKILL.md"
    assert cached.exists()
    assert cached.read_bytes() == files["skill://demo/SKILL.md"]
    # Immutable cache: read-only after write.
    assert (cached.stat().st_mode & 0o777) == 0o444


async def test_read_supporting_file_and_blob_contents(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill(extra_files={"data.bin": b"\x00\x01binary"})
    client.add_skill(manifest, files)
    client.add_blob_resource("skill://demo/data.bin", b"\x00\x01binary")
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    blob = await provider.read_file("skill://demo/data.bin")
    assert blob.content == b"\x00\x01binary"

    ref = await provider.read_file("skill://demo/ref.md") if "skill://demo/ref.md" in files else None


async def test_release_clears_retention(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)

    await provider.retain(manifest.uri)
    provider.release(manifest.uri)
    assert provider.retained(manifest.uri) is None

    with pytest.raises(SkillIntegrityError, match="outside any retained"):
        await provider.read_file("skill://demo/SKILL.md")


# --------------------------------------------------------------- rejections


async def test_read_file_rejects_uri_without_any_retained_manifest(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)

    with pytest.raises(SkillIntegrityError, match="outside any retained"):
        await provider.read_file("skill://demo/SKILL.md")


async def test_read_file_rejects_uri_from_unretained_skill(tmp_path):
    client = FakeSkillsClient()
    manifest_a, files_a = _build_skill(name="alpha")
    manifest_b, files_b = _build_skill(name="beta")
    client.add_skill(manifest_a, files_a)
    client.add_skill(manifest_b, files_b)
    provider = _provider(tmp_path, client)

    await provider.retain(manifest_a.uri)
    with pytest.raises(SkillIntegrityError, match="outside any retained"):
        await provider.read_file("skill://beta/SKILL.md")


async def test_read_file_rejects_uri_missing_from_explicit_manifest(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)

    with pytest.raises(SkillIntegrityError, match="not part of the manifest"):
        await provider.read_file("skill://demo/ghost.md", manifest=manifest)


async def test_read_file_digest_mismatch_rejects_and_refreshes(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    # Same length, different bytes -> digest mismatch (size check passes).
    good = files["skill://demo/SKILL.md"]
    tampered = good.replace(b"body", b"BODY")
    assert len(tampered) == len(good)
    client.resources["skill://demo/SKILL.md"] = tampered

    with pytest.raises(SkillIntegrityError) as excinfo:
        await provider.read_file("skill://demo/SKILL.md")
    assert "refreshed" in str(excinfo.value)

    # The provider re-fetched the manifest (retain + refresh-on-failure).
    assert client.get_calls.count(manifest.uri) == 2
    # Tampered content must not be cached.
    assert not (tmp_path / "cache" / "srv-a" / "demo" / "SKILL.md").exists()


async def test_read_file_size_mismatch_rejected(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    client.resources["skill://demo/SKILL.md"] = b"short"
    with pytest.raises(SkillIntegrityError, match="size mismatch"):
        await provider.read_file("skill://demo/SKILL.md")


async def test_read_file_rejects_tampered_frontmatter(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    # Digest matches a *different* file whose frontmatter diverges from the
    # manifest entry.
    evil = (
        b"---\nname: evil\ndescription: demo skill\n---\n\n# evil\n\nbody\n"
    )
    client.resources["skill://demo/SKILL.md"] = evil
    entry = manifest.resources[0]
    entry = entry.model_copy(update={"digest": compute_digest(evil)})
    client.skills[manifest.uri] = manifest.model_copy(
        update={"resources": [entry] + list(manifest.resources[1:])}
    )
    provider._retained[manifest.uri] = client.skills[manifest.uri]

    with pytest.raises(SkillIntegrityError, match="frontmatter"):
        await provider.read_file("skill://demo/SKILL.md")


# ------------------------------------------------------------ dynamic skills


def _dynamic_manifest() -> SkillManifest:
    return SkillManifest(
        uri="skill://gen/SKILL.md",
        frontmatter={"name": "gen", "description": "generated"},
        resources="dynamic",
    )


async def test_dynamic_skill_allows_arbitrary_uris_but_verifies_frontmatter(tmp_path):
    client = FakeSkillsClient()
    manifest = _dynamic_manifest()
    client.add_skill(
        manifest,
        {
            "skill://gen/SKILL.md": b"---\nname: gen\ndescription: generated\n---\n\n# gen\n",
            "skill://gen/data.csv": b"a,b\n1,2\n",
        },
    )
    provider = _provider(tmp_path, client)
    await provider.retain("skill://gen/SKILL.md")

    result = await provider.read_file("skill://gen/SKILL.md")
    assert result.text.startswith("---\nname: gen")

    # Arbitrary URIs under the skill root are allowed (no digest to check).
    dynamic_file = await provider.read_file("skill://gen/data.csv")
    assert dynamic_file.content == b"a,b\n1,2\n"


async def test_dynamic_skill_frontmatter_mismatch_rejected(tmp_path):
    client = FakeSkillsClient()
    manifest = _dynamic_manifest()
    client.add_skill(
        manifest,
        {"skill://gen/SKILL.md": b"---\nname: evil\ndescription: generated\n---\n\n"},
    )
    provider = _provider(tmp_path, client)
    await provider.retain("skill://gen/SKILL.md")

    with pytest.raises(SkillIntegrityError, match="frontmatter"):
        await provider.read_file("skill://gen/SKILL.md")


async def test_dynamic_skill_traversal_uri_never_escapes_cache_root(tmp_path):
    client = FakeSkillsClient()
    manifest = _dynamic_manifest()
    client.add_skill(
        manifest,
        {"skill://gen/../../escape.md": b"evil\n"},
    )
    provider = _provider(tmp_path, client)
    await provider.retain("skill://gen/SKILL.md")

    result = await provider.read_file("skill://gen/../../escape.md")
    assert result.content == b"evil\n"
    # Nothing may be written outside the provider's cache directory.
    assert not (tmp_path / "escape.md").exists()
    assert not (tmp_path / "cache" / "..").joinpath("escape.md").exists()


# ------------------------------------------------------------------- refresh


async def test_refresh_diffs_digest_sets(tmp_path):
    client = FakeSkillsClient()
    manifest_v1, files_v1 = _build_skill(
        extra_files={"a.md": b"aaa\n", "b.md": b"bbb\n"}
    )
    client.add_skill(manifest_v1, files_v1)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest_v1.uri)

    # Server changes: a.md content differs, b.md removed, c.md added.
    manifest_v2, files_v2 = _build_skill(
        extra_files={"a.md": b"AAA\n", "c.md": b"ccc\n"}
    )
    client.skills[manifest_v1.uri] = manifest_v2
    client.resources = files_v2

    refresh = await provider.refresh(manifest_v1.uri)
    assert refresh.changed is True
    changes = refresh.digest_changes()
    assert set(changes) == {
        "skill://demo/a.md",
        "skill://demo/b.md",
        "skill://demo/c.md",
    }
    assert changes["skill://demo/a.md"] == compute_digest(b"AAA\n")
    assert changes["skill://demo/b.md"] is None  # removed
    # Retained manifest is replaced by the new one.
    assert provider.retained(manifest_v1.uri) is manifest_v2


async def test_refresh_unchanged_manifest_reports_no_change(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    refresh = await provider.refresh(manifest.uri)
    assert refresh.changed is False
    assert refresh.digest_changes() == {}


async def test_refresh_on_missing_skill_clears_retention(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    client.skills.pop(manifest.uri)
    refresh = await provider.refresh(manifest.uri)
    assert refresh.changed is True
    assert refresh.new_manifest is None
    assert provider.retained(manifest.uri) is None


async def test_refresh_after_server_manifest_change_enables_new_reads(tmp_path):
    client = FakeSkillsClient()
    manifest_v1, files_v1 = _build_skill()
    client.add_skill(manifest_v1, files_v1)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest_v1.uri)

    # Server rotates the skill body (new digest everywhere).
    manifest_v2, files_v2 = _build_skill()
    manifest_v2 = manifest_v2.model_copy(deep=True)
    new_body = b"---\nname: demo\ndescription: demo skill\n---\n\n# demo\n\nnew body\n"
    files_v2 = {"skill://demo/SKILL.md": new_body}
    manifest_v2 = SkillManifest(
        uri=manifest_v1.uri,
        frontmatter=manifest_v1.frontmatter,
        resources=[
            {"uri": "skill://demo/SKILL.md", "digest": compute_digest(new_body), "size": len(new_body)}
        ],
    )
    client.skills[manifest_v1.uri] = manifest_v2
    client.resources = files_v2

    refresh = await provider.refresh(manifest_v1.uri)
    assert refresh.changed is True

    result = await provider.read_file("skill://demo/SKILL.md")
    assert result.content == new_body


# ------------------------------------------------------------- cache re-check


async def test_cache_hit_reverifies_tampered_cache_and_refetches(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    await provider.read_file("skill://demo/SKILL.md")
    cached = tmp_path / "cache" / "srv-a" / "demo" / "SKILL.md"
    assert cached.exists()

    # Tamper the on-disk cache (chmod needed: the file is read-only).
    cached.chmod(0o644)
    cached.write_bytes(b"---\nname: demo\ndescription: demo skill\n---\n\nTAMPERED\n")

    # Second read must not serve the tampered bytes; it re-fetches and
    # re-verified content wins.
    result = await provider.read_file("skill://demo/SKILL.md")
    assert result.content == files["skill://demo/SKILL.md"]
    assert cached.read_bytes() == files["skill://demo/SKILL.md"]
    # Cache file is immutable again.
    assert (cached.stat().st_mode & 0o777) == 0o444


async def test_cache_hit_avoids_refetch_when_bytes_are_valid(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)
    await provider.retain(manifest.uri)

    await provider.read_file("skill://demo/SKILL.md")
    reads_before = len(client.read_calls)
    await provider.read_file("skill://demo/SKILL.md")
    assert len(client.read_calls) == reads_before


async def test_list_and_get_delegate_to_client(tmp_path):
    client = FakeSkillsClient()
    manifest_a, files_a = _build_skill(name="alpha")
    manifest_b, files_b = _build_skill(name="beta")
    client.add_skill(manifest_a, files_a)
    client.add_skill(manifest_b, files_b)
    provider = _provider(tmp_path, client)

    listed = await provider.list_skills()
    assert {m.uri for m in listed} == {manifest_a.uri, manifest_b.uri}

    fetched = await provider.get_skill(manifest_a.uri)
    assert fetched.uri == manifest_a.uri
    # get_skill does not retain.
    assert provider.retained(manifest_a.uri) is None


def test_clear_cache_removes_server_directory(tmp_path):
    client = FakeSkillsClient()
    manifest, files = _build_skill()
    client.add_skill(manifest, files)
    provider = _provider(tmp_path, client)

    import asyncio

    asyncio.run(provider.retain(manifest.uri))
    asyncio.run(provider.read_file("skill://demo/SKILL.md"))
    server_dir = tmp_path / "cache" / "srv-a"
    assert server_dir.exists()

    provider.clear_cache()
    assert not server_dir.exists()
