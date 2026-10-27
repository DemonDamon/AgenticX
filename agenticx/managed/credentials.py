#!/usr/bin/env python3
"""Credential providers for managed sessions.

Local development resolves ``${cred:NAME}`` from the credential store.
The enterprise provider calls the vault control plane and never logs tokens.

Author: Damon Li
"""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from typing import Any, Literal, Mapping, Protocol, Sequence
from urllib.parse import urlsplit

import httpx

from agenticx.runtime.credential_store import CredentialStore, MissingCredentialError, resolve_refs

CredentialType = Literal["static_bearer", "mcp_oauth", "bearer", "environment_variable"]
PLACEHOLDER_PREFIX = "agxsec_"
MAX_VAULT_IDS = 20
_MCP_URL_MAX_LEN = 512
_SECRET_REF_RE = re.compile(r"^\$\{cred:[A-Z][A-Z0-9_]{1,63}\}$")
_CREDENTIAL_TYPES = frozenset({"static_bearer", "mcp_oauth", "bearer", "environment_variable"})


class CredentialResolutionError(Exception):
    """Vault validation or resolution failed. The message never contains a secret."""

    def __init__(self, message: str, *, status: int = 0) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class ResolvedCredential:
    """One decrypted credential. ``secret`` stays in process memory only."""

    credential_id: str
    vault_id: str
    vault_index: int
    type: CredentialType
    display_name: str | None
    secret: str
    mcp_server_url: str | None = None
    host: str | None = None
    secret_name: str | None = None
    networking: Literal["unrestricted", "limited"] | None = None
    allowed_hosts: tuple[str, ...] = ()
    refresh_error: bool = False

    def label(self) -> str:
        """Redaction label: secret name, display name, or credential id."""
        if self.secret_name:
            return self.secret_name
        if self.display_name:
            return self.display_name
        return self.credential_id


@dataclass(frozen=True)
class CredentialBundle:
    """Credentials for one turn, in vault-id order then credential order."""

    credentials: tuple[ResolvedCredential, ...] = ()
    skipped: tuple[tuple[str, str], ...] = ()

    def mcp_credential_for(self, server_url: str) -> ResolvedCredential | None:
        """First static bearer or OAuth credential whose normalized URL matches."""
        target = normalize_mcp_url(server_url)
        if target is None:
            return None
        for credential in self.credentials:
            if credential.type not in {"static_bearer", "mcp_oauth"}:
                continue
            if credential.mcp_server_url == target:
                return credential
        return None

    def bearer_for_host(self, host: str) -> ResolvedCredential | None:
        """First bearer credential whose host equals ``host`` (case-insensitive)."""
        wanted = (host or "").lower().rstrip(".")
        if not wanted:
            return None
        for credential in self.credentials:
            if credential.type != "bearer":
                continue
            stored = (credential.host or "").lower().rstrip(".")
            if stored == wanted:
                return credential
        return None

    def env_credentials(self) -> tuple[ResolvedCredential, ...]:
        return tuple(item for item in self.credentials if item.type == "environment_variable")


class CredentialProvider(Protocol):
    """Validate vault ids at session create and resolve them at each turn."""

    async def validate_vault_ids(
        self,
        tenant_id: str,
        vault_ids: Sequence[str],
    ) -> list[tuple[str, str]]: ...

    async def resolve(
        self,
        tenant_id: str,
        session_id: str,
        vault_ids: Sequence[str],
    ) -> CredentialBundle: ...

    async def aclose(self) -> None: ...


def normalize_mcp_url(raw: str) -> str | None:
    """Normalize an MCP URL the same way the vault control plane matches manifests.

    Query strings are kept so a manifest URL can be compared. Any failed check
    returns None, which never matches a credential. The length cap is 512,
    matching ``normalizeMcpServerUrlKeepingQuery``.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text or len(text) > _MCP_URL_MAX_LEN:
        return None
    for char in text:
        code = ord(char)
        if code < 0x21 or code > 0x7E:
            return None
    parsed = urlsplit(text)
    if parsed.scheme.lower() != "https":
        return None
    if parsed.username or parsed.password or parsed.fragment:
        return None
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    netloc = host if port in (None, 443) else f"{host}:{port}"
    path = re.sub(r"/+$", "", parsed.path or "")
    query = f"?{parsed.query}" if parsed.query else ""
    return f"https://{netloc}{path}{query}"


def host_matches(host: str, pattern: str, *, include_subdomains: bool) -> bool:
    """Match a hostname against a pattern.

    A pattern starting with ``*.`` matches subdomains only, never the bare
    domain. Otherwise the host must equal the pattern, or (when
    ``include_subdomains`` is true) be a subdomain of it.
    """
    left = (host or "").lower().rstrip(".")
    right = (pattern or "").lower().rstrip(".")
    if not left or not right:
        return False
    if right.startswith("*."):
        suffix = right[2:]
        return bool(suffix) and left.endswith("." + suffix)
    if left == right:
        return True
    if include_subdomains and left.endswith("." + right):
        return True
    return False


def new_placeholder() -> str:
    """Return a 39-character placeholder (``agxsec_`` plus 32 hex chars)."""
    return PLACEHOLDER_PREFIX + secrets.token_hex(16)


@dataclass(frozen=True)
class LocalCredentialSpec:
    """One credential in a development agents file.

    ``secret_ref`` is a ``${cred:NAME}`` reference. The file never holds a value.
    """

    credential_id: str
    type: CredentialType
    secret_ref: str
    display_name: str | None = None
    mcp_server_url: str | None = None
    host: str | None = None
    secret_name: str | None = None
    networking: Literal["unrestricted", "limited"] | None = None
    allowed_hosts: tuple[str, ...] = ()


class LocalCredentialProvider:
    """Resolve development vaults through the on-disk credential store."""

    def __init__(
        self,
        vaults: Mapping[str, Sequence[LocalCredentialSpec]],
        *,
        store: CredentialStore | None = None,
    ) -> None:
        self._vaults = {key: tuple(value) for key, value in vaults.items()}
        self._store = store

    async def validate_vault_ids(
        self,
        tenant_id: str,
        vault_ids: Sequence[str],
    ) -> list[tuple[str, str]]:
        del tenant_id
        return [
            (vault_id, "active" if vault_id in self._vaults else "missing")
            for vault_id in vault_ids
        ]

    async def resolve(
        self,
        tenant_id: str,
        session_id: str,
        vault_ids: Sequence[str],
    ) -> CredentialBundle:
        del tenant_id, session_id
        resolved: list[ResolvedCredential] = []
        for index, vault_id in enumerate(vault_ids):
            specs = self._vaults.get(vault_id)
            if specs is None:
                raise CredentialResolutionError(f"vault not found: {vault_id}")
            for spec in specs:
                resolved.append(self._resolve_spec(spec, vault_id, index))
        return CredentialBundle(credentials=tuple(resolved))

    async def aclose(self) -> None:
        return None

    def _resolve_spec(
        self,
        spec: LocalCredentialSpec,
        vault_id: str,
        vault_index: int,
    ) -> ResolvedCredential:
        if _SECRET_REF_RE.fullmatch(spec.secret_ref) is None:
            raise CredentialResolutionError("secret_ref must be a ${cred:NAME} reference")
        try:
            secret = resolve_refs(spec.secret_ref, self._store)
        except MissingCredentialError as err:
            raise CredentialResolutionError(
                f"local credential not defined: {err.name}"
            ) from None
        return ResolvedCredential(
            credential_id=spec.credential_id,
            vault_id=vault_id,
            vault_index=vault_index,
            type=spec.type,
            display_name=spec.display_name,
            secret=secret,
            mcp_server_url=spec.mcp_server_url,
            host=spec.host,
            secret_name=spec.secret_name,
            networking=spec.networking,
            allowed_hosts=spec.allowed_hosts,
        )


def _as_str(value: Any) -> str:
    return value if isinstance(value, str) else ""


def _secret_of(item: Mapping[str, Any]) -> str:
    credential_type = item.get("type")
    if credential_type in {"static_bearer", "bearer"}:
        return _as_str(item.get("token"))
    if credential_type == "mcp_oauth":
        return _as_str(item.get("access_token"))
    if credential_type == "environment_variable":
        return _as_str(item.get("secret_value"))
    return ""


def _map_credential(item: Mapping[str, Any]) -> ResolvedCredential | None:
    credential_type = item.get("type")
    if credential_type not in _CREDENTIAL_TYPES:
        return None
    raw_url = item.get("mcp_server_url")
    mcp_url = normalize_mcp_url(raw_url) if isinstance(raw_url, str) else None
    raw_host = item.get("host")
    host = raw_host.strip().lower().rstrip(".") if isinstance(raw_host, str) and raw_host.strip() else None
    networking_raw = item.get("networking")
    networking: Literal["unrestricted", "limited"] | None = None
    allowed: tuple[str, ...] = ()
    if isinstance(networking_raw, Mapping):
        kind = networking_raw.get("type")
        if kind in {"unrestricted", "limited"}:
            networking = kind
        hosts = networking_raw.get("allowed_hosts") or []
        if isinstance(hosts, list):
            allowed = tuple(
                str(entry).strip().lower().rstrip(".")
                for entry in hosts
                if isinstance(entry, str) and str(entry).strip()
            )
    display = item.get("display_name")
    display_name = display if isinstance(display, str) and display else None
    secret_name = item.get("secret_name")
    try:
        vault_index = int(item.get("vault_index") or 0)
    except (TypeError, ValueError):
        vault_index = 0
    return ResolvedCredential(
        credential_id=_as_str(item.get("credential_id")),
        vault_id=_as_str(item.get("vault_id")),
        vault_index=vault_index,
        type=credential_type,
        display_name=display_name,
        secret=_secret_of(item),
        mcp_server_url=mcp_url,
        host=host,
        secret_name=secret_name if isinstance(secret_name, str) else None,
        networking=networking,
        allowed_hosts=allowed,
        refresh_error=item.get("refresh_error") == "failed",
    )


class EnterpriseVaultProvider:
    """Resolve credentials through the admin-console internal vault API."""

    def __init__(
        self,
        base_url: str,
        internal_token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._base_url = base_url
        self._client = httpx.AsyncClient(
            base_url=base_url,
            timeout=timeout,
            trust_env=False,
            transport=transport,
            headers={"Authorization": f"Bearer {internal_token}"},
        )
        self._closed = False

    def __repr__(self) -> str:
        return f"EnterpriseVaultProvider(base_url={self._base_url!r})"

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        await self._client.aclose()

    async def validate_vault_ids(
        self,
        tenant_id: str,
        vault_ids: Sequence[str],
    ) -> list[tuple[str, str]]:
        payload = await self._post(
            "/api/internal/ma/vaults/validate",
            {"tenant_id": tenant_id, "vault_ids": list(vault_ids)},
        )
        rows = payload.get("vaults")
        if not isinstance(rows, list):
            raise CredentialResolutionError("vault service unavailable")
        found: list[tuple[str, str]] = []
        for row in rows:
            if not isinstance(row, Mapping):
                raise CredentialResolutionError("vault service unavailable")
            found.append((_as_str(row.get("id")), _as_str(row.get("status")) or "missing"))
        return found

    async def resolve(
        self,
        tenant_id: str,
        session_id: str,
        vault_ids: Sequence[str],
    ) -> CredentialBundle:
        payload = await self._post(
            "/api/internal/ma/vault-resolve",
            {
                "tenant_id": tenant_id,
                "session_id": session_id,
                "vault_ids": list(vault_ids),
            },
        )
        raw_credentials = payload.get("credentials")
        if not isinstance(raw_credentials, list):
            raise CredentialResolutionError("vault service unavailable")
        credentials: list[ResolvedCredential] = []
        for item in raw_credentials:
            if not isinstance(item, Mapping):
                raise CredentialResolutionError("vault service unavailable")
            mapped = _map_credential(item)
            if mapped is not None:
                credentials.append(mapped)
        raw_skipped = payload.get("skipped") or []
        skipped: list[tuple[str, str]] = []
        if isinstance(raw_skipped, list):
            for item in raw_skipped:
                if isinstance(item, Mapping):
                    skipped.append((_as_str(item.get("vault_id")), _as_str(item.get("reason"))))
        return CredentialBundle(credentials=tuple(credentials), skipped=tuple(skipped))

    async def _post(self, path: str, body: Mapping[str, Any]) -> Mapping[str, Any]:
        try:
            response = await self._client.post(path, json=dict(body))
        except httpx.HTTPError:
            raise CredentialResolutionError("vault service unavailable") from None
        if response.status_code != 200:
            raise CredentialResolutionError(
                f"vault service returned {response.status_code}",
                status=response.status_code,
            )
        try:
            payload = response.json()
        except ValueError:
            raise CredentialResolutionError("vault service unavailable") from None
        if not isinstance(payload, Mapping):
            raise CredentialResolutionError("vault service unavailable")
        return payload


__all__ = [
    "MAX_VAULT_IDS",
    "PLACEHOLDER_PREFIX",
    "CredentialBundle",
    "CredentialProvider",
    "CredentialResolutionError",
    "CredentialType",
    "EnterpriseVaultProvider",
    "LocalCredentialProvider",
    "LocalCredentialSpec",
    "ResolvedCredential",
    "host_matches",
    "new_placeholder",
    "normalize_mcp_url",
]
