#!/usr/bin/env python3
"""Local credential store and ``${cred:NAME}`` references.

Secrets live only in ``~/.agenticx/credentials.yaml``. Provider and MCP
settings store references; callers resolve them at the process boundary and
redact known values before tool results or session snapshots leave memory.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import yaml

_log = logging.getLogger(__name__)

CRED_REF_RE = re.compile(r"\$\{cred:([A-Z][A-Z0-9_]{1,63})\}")
NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
REDACT_MIN_LEN = 8


class CredentialError(ValueError):
    """Credential name, file, or write request is invalid."""


class MissingCredentialError(CredentialError):
    """A ``${cred:NAME}`` reference has no stored value."""

    def __init__(self, name: str) -> None:
        self.name = name
        super().__init__(f"credential not defined: {name}")


@dataclass(frozen=True)
class CredentialMeta:
    """Credential fields safe to return to clients. Never includes the value."""

    name: str
    description: str
    updated_at: str


def credentials_path() -> Path:
    """Resolve the credential file the same way ``ConfigManager.GLOBAL_CONFIG_PATH`` does.

    ``Path.home()`` is read at call time so tests that redirect ``HOME`` see a
    sandbox path instead of the developer machine.
    """

    return Path.home() / ".agenticx" / "credentials.yaml"


class CredentialStore:
    """Read and write the on-disk credential file.

    Each public method reads the file again. ``default_store()`` returns a new
    instance every time so there is no process-wide cache.
    """

    def __init__(self, path: Path | None = None) -> None:
        self.path = path if path is not None else credentials_path()

    def list(self) -> list[CredentialMeta]:
        creds = self._read()
        return [
            CredentialMeta(
                name=name,
                description=str(item.get("description") or ""),
                updated_at=str(item.get("updated_at") or ""),
            )
            for name, item in sorted(creds.items())
        ]

    def get(self, name: str) -> str | None:
        if not NAME_RE.fullmatch(name or ""):
            return None
        item = self._read().get(name)
        if item is None:
            return None
        value = item.get("value")
        return "" if value is None else str(value)

    def set(
        self,
        name: str,
        value: str | None,
        description: str | None = None,
    ) -> CredentialMeta:
        """Create or update one credential.

        ``value`` is required when ``name`` does not exist yet. On update,
        ``value=None`` keeps the stored secret and only ``description`` changes.
        ``description=None`` on update keeps the previous description.
        """

        if not NAME_RE.fullmatch(name or ""):
            raise CredentialError("invalid credential name")
        creds = self._read()
        existing = creds.get(name)
        if existing is None and value is None:
            raise CredentialError("value is required when creating a credential")
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if existing is None:
            entry = {
                "value": "" if value is None else value,
                "description": description or "",
                "updated_at": now,
            }
        else:
            entry = {
                "value": existing.get("value") if value is None else value,
                "description": (
                    existing.get("description") or ""
                    if description is None
                    else description
                ),
                "updated_at": now,
            }
        creds[name] = entry
        self._write(creds)
        return CredentialMeta(
            name=name,
            description=str(entry.get("description") or ""),
            updated_at=now,
        )

    def delete(self, name: str) -> bool:
        if not NAME_RE.fullmatch(name or ""):
            return False
        creds = self._read()
        if name not in creds:
            return False
        del creds[name]
        self._write(creds)
        return True

    def known_secrets(self) -> list[tuple[str, str]]:
        """Return ``(name, value)`` pairs long enough to redact safely."""

        found: list[tuple[str, str]] = []
        for name, item in self._read().items():
            value = item.get("value")
            text = "" if value is None else str(value)
            if len(text) >= REDACT_MIN_LEN:
                found.append((name, text))
        return found

    def _read(self) -> dict[str, dict]:
        path = self.path
        if not path.is_file():
            return {}
        try:
            loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise CredentialError("cannot read credentials file") from exc
        except yaml.YAMLError as exc:
            raise CredentialError("credentials file is not valid YAML") from exc
        if loaded is None:
            return {}
        if not isinstance(loaded, dict):
            raise CredentialError("credentials file must be a YAML object")
        raw = loaded.get("credentials") or {}
        if not isinstance(raw, dict):
            raise CredentialError("credentials section must be a mapping")
        creds: dict[str, dict] = {}
        for name, entry in raw.items():
            if isinstance(entry, dict):
                creds[str(name)] = entry
        return creds

    def _write(self, creds: dict[str, dict]) -> None:
        payload = {
            "version": 1,
            "credentials": {
                name: {
                    "value": "" if item.get("value") is None else str(item.get("value")),
                    "description": str(item.get("description") or ""),
                    "updated_at": str(item.get("updated_at") or ""),
                }
                for name, item in creds.items()
            },
        }
        path = self.path
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=".credentials-",
            suffix=".yaml",
            dir=str(path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                yaml.safe_dump(
                    payload,
                    handle,
                    allow_unicode=True,
                    sort_keys=False,
                    default_flow_style=False,
                )
            if os.name != "nt":
                os.chmod(tmp_name, 0o600)
            os.replace(tmp_name, path)
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
        if os.name != "nt":
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass


def default_store() -> CredentialStore:
    """Return a store that re-reads ``credentials.yaml`` on the next method call."""

    return CredentialStore()


def resolve_refs(value: str, store: CredentialStore | None = None) -> str:
    """Replace ``${cred:NAME}`` references. Text without a reference is unchanged."""

    if not isinstance(value, str) or "${cred:" not in value:
        return value
    active = store or default_store()

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1)
        secret = active.get(name)
        if secret is None:
            raise MissingCredentialError(name)
        return secret

    return CRED_REF_RE.sub(_replace, value)


def resolve_mapping(
    mapping: Mapping[str, str],
    store: CredentialStore | None = None,
) -> dict[str, str]:
    """Resolve credential references in each mapping value."""

    if not mapping:
        return {}
    active = store
    resolved: dict[str, str] = {}
    for key, raw in mapping.items():
        text = raw if isinstance(raw, str) else str(raw)
        if "${cred:" not in text:
            resolved[str(key)] = text
            continue
        if active is None:
            active = default_store()
        resolved[str(key)] = resolve_refs(text, active)
    return resolved


def redact_text(text: str, store: CredentialStore | None = None) -> str:
    """Replace known secret values with ``[REDACTED:NAME]``.

    Longer values are replaced first so a shorter secret that is a prefix of a
    longer one does not split it. An empty store, a missing file, or an
    unreadable file leaves ``text`` unchanged.
    """

    if not text:
        return text
    try:
        secrets = (store or default_store()).known_secrets()
    except CredentialError:
        _log.warning(
            "credential redaction skipped because the credentials file could not be read"
        )
        return text
    if not secrets:
        return text
    ordered = sorted(secrets, key=lambda item: (-len(item[1]), item[0]))
    lookup: dict[str, str] = {}
    for name, value in ordered:
        lookup.setdefault(value, name)
    pattern = "|".join(re.escape(value) for value in lookup)
    return re.compile(pattern).sub(lambda match: f"[REDACTED:{lookup[match.group(0)]}]", text)


def find_references(text: str) -> list[str]:
    """Return credential names referenced by ``text``, in first-seen order."""

    if not text or "${cred:" not in text:
        return []
    found: list[str] = []
    for name in CRED_REF_RE.findall(text):
        if name not in found:
            found.append(name)
    return found
