#!/usr/bin/env python3
"""Credential store CRUD, reference resolution, and redaction.

Author: Damon Li
"""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from agenticx.runtime.credential_store import (
    REDACT_MIN_LEN,
    CredentialError,
    CredentialStore,
    MissingCredentialError,
    find_references,
    redact_text,
    resolve_mapping,
    resolve_refs,
)


def test_crud_round_trip_hides_value_from_list(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path / "credentials.yaml")
    created = store.set("OPENAI_KEY", "sk-test-value-0123456789", "openai")
    assert created.name == "OPENAI_KEY"
    assert created.description == "openai"
    assert created.updated_at.endswith("Z")
    assert store.get("OPENAI_KEY") == "sk-test-value-0123456789"

    listed = store.list()
    assert [item.name for item in listed] == ["OPENAI_KEY"]
    assert "sk-test-value-0123456789" not in repr(listed)

    updated = store.set("OPENAI_KEY", None, "renamed")
    assert updated.description == "renamed"
    assert store.get("OPENAI_KEY") == "sk-test-value-0123456789"

    replaced = store.set("GITHUB_TOKEN", "ghp_test_value_0123456789", None)
    assert replaced.description == ""
    assert [item.name for item in store.list()] == ["GITHUB_TOKEN", "OPENAI_KEY"]

    assert store.delete("OPENAI_KEY") is True
    assert store.get("OPENAI_KEY") is None
    assert store.delete("OPENAI_KEY") is False
    assert store.delete("not-a-name") is False


def test_create_requires_value_and_name_pattern(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path / "credentials.yaml")
    with pytest.raises(CredentialError, match="value is required"):
        store.set("NEW_TOKEN", None, "missing")
    for bad in ("a", "ab-cd", "1TOKEN", "lower", ""):
        with pytest.raises(CredentialError, match="invalid credential name"):
            store.set(bad, "value-0123456789")
    assert store.get("nope") is None
    meta = store.set("AB", "value-0123456789", "ok")
    assert meta.name == "AB"


def test_file_mode_is_0600_and_directory_mode_unchanged(tmp_path: Path) -> None:
    parent = tmp_path / "credhome"
    parent.mkdir()
    before = stat.S_IMODE(parent.stat().st_mode)
    path = parent / "credentials.yaml"
    store = CredentialStore(path)
    store.set("AB_TOKEN", "value-0123456789", "d")
    store.set("AB_TOKEN", "value-0123456789xxxx", "d2")
    assert stat.S_IMODE(parent.stat().st_mode) == before
    if os.name == "nt":
        return
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def test_yaml_round_trip_keeps_special_characters(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path / "credentials.yaml")
    secret = "abc:def#ghi-0123456789"
    store.set("TOKEN_VALUE", secret, "has:colon")
    again = CredentialStore(tmp_path / "credentials.yaml")
    assert again.get("TOKEN_VALUE") == secret
    assert again.list()[0].description == "has:colon"


def test_resolve_refs_plain_missing_and_present(tmp_path: Path) -> None:
    path = tmp_path / "credentials.yaml"
    store = CredentialStore(path)
    assert resolve_refs("plain-text", store) == "plain-text"
    assert not path.exists()
    with pytest.raises(MissingCredentialError) as exc_info:
        resolve_refs("x ${cred:NO_SUCH_KEY} y", store)
    assert exc_info.value.name == "NO_SUCH_KEY"
    assert issubclass(MissingCredentialError, ValueError)

    store.set("OPENAI_KEY", "sk-test-value-0123456789", "")
    store.set("OTHER_KEY", "prefix-${cred:OPENAI_KEY}", "")
    assert resolve_refs("Bearer ${cred:OPENAI_KEY}", store) == "Bearer sk-test-value-0123456789"
    # One pass: a stored value that itself looks like a reference is not expanded.
    assert resolve_refs("${cred:OTHER_KEY}", store) == "prefix-${cred:OPENAI_KEY}"
    assert find_references("a ${cred:OPENAI_KEY} ${cred:OPENAI_KEY} ${cred:OTHER_KEY}") == [
        "OPENAI_KEY",
        "OTHER_KEY",
    ]


def test_resolve_mapping(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path / "credentials.yaml")
    store.set("GITHUB_TOKEN", "ghp_test_value_0123456789", "")
    resolved = resolve_mapping(
        {"GITHUB_TOKEN": "${cred:GITHUB_TOKEN}", "PLAIN": "ok"},
        store,
    )
    assert resolved == {
        "GITHUB_TOKEN": "ghp_test_value_0123456789",
        "PLAIN": "ok",
    }
    assert resolve_mapping({}, store) == {}


def test_redact_text_longest_first_short_values_and_empty_store(tmp_path: Path) -> None:
    missing = CredentialStore(tmp_path / "missing.yaml")
    assert redact_text("leave me", missing) == "leave me"
    assert missing.known_secrets() == []

    store = CredentialStore(tmp_path / "credentials.yaml")
    long_value = "aaaa-bbbb-cccc-dddd"
    short_value = "aaaa-bbbb"
    assert len(short_value) >= REDACT_MIN_LEN
    store.set("LONG_TOKEN", long_value, "")
    store.set("SHORT_TOK", short_value, "")
    store.set("TINY_KEY", "abc", "")
    text = f"{long_value} and {short_value} and abc"
    assert redact_text(text, store) == "[REDACTED:LONG_TOKEN] and [REDACTED:SHORT_TOK] and abc"
    assert "abc" in redact_text("abc", store)
