#!/usr/bin/env python3
"""Direct-mode sync between Near providers and Codex ``config.toml``.

When the active Near harness is ``codex``, selecting a catalog model can
rewrite ``~/.codex/config.toml`` so the same OpenAI-compatible upstream is
reachable from the Codex CLI — similar in spirit to Claude Code Direct sync.

Codex 0.16x custom providers use ``[model_providers.<id>]`` with
``wire_api = "responses"`` (the only supported wire API). Gateways that only
expose Chat Completions may still fail at runtime until they also serve
``/v1/responses``; Near still writes the provider block + default model so a
compatible gateway works without a second manual config step.

API keys are stored in ``$CODEX_HOME/.agenticx/<provider>.token`` (mode 0600)
and referenced via ``auth.command = /bin/cat`` — not embedded in config.toml.

Gateways known to reject OpenAI's hosted ``web_search`` Responses tool
(currently official Xiaomi MiMo at ``api.xiaomimimo.com``) also get
``web_search = "disabled"``. Other OpenAI-compatible Responses gateways keep
Codex's default. Switching away from a limited gateway removes a Near-set
``disabled`` value so the default is restored.

Builtin / python-agent paths must never call into this module for writes.

Author: Damon Li
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, Mapping, Optional
from urllib.parse import urlparse

from agenticx.llms.known_base_urls import (
    default_provider_base_url,
    is_codex_non_openai_compat_provider,
)

try:
    import tomllib  # py311+
except ModuleNotFoundError:  # pragma: no cover
    import tomli as tomllib  # type: ignore

DEFAULT_CODEX_CONFIG_PATH = Path.home() / ".codex" / "config.toml"
_RESERVED_PROVIDER_IDS = frozenset({"openai", "ollama", "lmstudio"})
_MANAGED_PREFIX = "agenticx-"

# Codex 0.167 defaults ``web_search`` to ``cached``, which always registers
# OpenAI's hosted Responses tool type ``web_search``. Official Xiaomi MiMo
# (api.xiaomimimo.com) rejects that tool with responses_feature_not_supported.
# Live-probed 2026-11-10: 彩讯/aibox, Bailian MAAS, MiniMax, Moonshot, and
# DeepSeek accepted a default Codex turn with web_search left enabled.
_WEB_SEARCH_UNSUPPORTED_HOST_SUFFIXES = (".xiaomimimo.com",)
_WEB_SEARCH_UNSUPPORTED_HOSTS = frozenset({"xiaomimimo.com"})
_CODEX_WEB_SEARCH_DISABLED = "disabled"

# Codex 0.167 with model_reasoning_effort=low/minimal sends
# ``reasoning.effort`` on the Responses body. BaiLian / DashScope
# compatible-mode (including dedicated MAAS hosts) maps that to
# enable_thinking=true without setting native result_format=message,
# and the algo layer then rejects the turn with:
#   The result_format parameter must be "message" when enable_thinking is true
# Live-probed 2026-11-11 on Damon's MAAS qwen-plus: effort=low/minimal
# reproduce that 400; effort=none or omitting effort succeeds. Adding
# query_params result_format=message and/or enable_thinking=false does
# not fix it. Near therefore writes model_reasoning_effort="none" for
# these gateways so a leftover "low" (from another model, or Codex's
# own default) is not forwarded. Official MiMo / DeepSeek / MiniMax /
# 彩讯 are unchanged.
_CODEX_REASONING_EFFORT_NONE = "none"
_BAILIAN_DASHSCOPE_PROVIDER_NAMES = frozenset(
    {"bailian", "dashscope", "aliyun", "alibaba", "tongyi"}
)
_BAILIAN_DASHSCOPE_HOSTS = frozenset(
    {
        "dashscope.aliyuncs.com",
        "dashscope-intl.aliyuncs.com",
        "maas.aliyuncs.com",
    }
)
_BAILIAN_DASHSCOPE_HOST_SUFFIXES = (
    ".dashscope.aliyuncs.com",
    ".dashscope-intl.aliyuncs.com",
    ".maas.aliyuncs.com",
)


def _codex_gateway_host(base_url: str) -> str:
    return (urlparse(str(base_url or "").strip()).hostname or "").lower()


def is_codex_bailian_dashscope_gateway(
    provider_name: str, base_url: str = ""
) -> bool:
    """True for Aliyun BaiLian / DashScope / MAAS Responses gateways."""
    name = str(provider_name or "").strip().lower().replace("_", "-")
    if name in _BAILIAN_DASHSCOPE_PROVIDER_NAMES:
        return True
    if "bailian" in name or "dashscope" in name:
        return True
    host = _codex_gateway_host(base_url)
    if not host:
        return False
    if host in _BAILIAN_DASHSCOPE_HOSTS:
        return True
    return any(host.endswith(suffix) for suffix in _BAILIAN_DASHSCOPE_HOST_SUFFIXES)


def codex_gateway_lacks_hosted_web_search(base_url: str) -> bool:
    """True when this Responses gateway rejects OpenAI's hosted web_search tool."""
    host = _codex_gateway_host(base_url)
    if not host:
        return False
    if host in _WEB_SEARCH_UNSUPPORTED_HOSTS:
        return True
    return any(host.endswith(suffix) for suffix in _WEB_SEARCH_UNSUPPORTED_HOST_SUFFIXES)


def _top_level_scalar_value(text: str, key: str) -> Optional[str]:
    pattern = re.compile(r"^" + re.escape(key) + r"\s*=")
    for line in (text or "").splitlines():
        if line.startswith("["):
            break
        if not pattern.match(line):
            continue
        raw = line.split("=", 1)[1].strip()
        quote = raw[0] if raw else ""
        if len(raw) >= 2 and quote in ("'", '"') and raw[-1] == quote:
            return raw[1:-1]
        return raw
    return None


def _remove_top_level_key(text: str, key: str) -> str:
    pattern = re.compile(r"^" + re.escape(key) + r"\s*=")
    lines = (text or "").splitlines(keepends=True)
    out: list[str] = []
    removed = False
    for line in lines:
        if not removed and not line.startswith("[") and pattern.match(line):
            removed = True
            continue
        out.append(line)
    return "".join(out)


class CodexSettingsError(ValueError):
    """Raised when Codex config.toml cannot be applied safely."""


def codex_config_path(override: Optional[os.PathLike[str] | str] = None) -> Path:
    if override is not None:
        return Path(override).expanduser()
    raw = os.environ.get("AGX_CODEX_CONFIG_PATH", "").strip()
    if raw:
        return Path(raw).expanduser()
    return DEFAULT_CODEX_CONFIG_PATH


def sanitize_codex_provider_id(provider_name: str) -> str:
    """Build a non-reserved ``model_providers`` id for a Near provider."""
    raw = str(provider_name or "").strip().lower().replace("_", "-")
    if not raw:
        raise CodexSettingsError("provider_name is required")
    slug = re.sub(r"[^a-z0-9-]+", "-", raw).strip("-")
    if not slug:
        slug = "provider"
    pid = f"{_MANAGED_PREFIX}{slug}"
    if pid in _RESERVED_PROVIDER_IDS:
        pid = f"{_MANAGED_PREFIX}near-{slug}"
    return pid


def normalize_codex_base_url(url: str) -> str:
    """Normalize Near ``base_url`` for Codex ``model_providers.*.base_url``.

    Codex appends ``/responses`` itself. Keep a trailing ``/v1`` root when
    present; strip only trailing slashes and a terminal ``/responses``.
    """
    text = str(url or "").strip()
    if not text:
        return ""
    text = text.rstrip("/")
    lower = text.lower()
    if lower.endswith("/responses"):
        text = text[: -len("/responses")].rstrip("/")
    if lower.endswith("/chat/completions"):
        text = text[: -len("/chat/completions")].rstrip("/")
    return text


def resolve_codex_gateway_base_url(
    provider_name: str, base_url: Optional[str] = None
) -> str:
    """Resolve a usable Codex gateway URL, or raise ``CodexSettingsError``.

    Prefer the caller/config ``base_url``. If it is missing, fall back to the
    built-in official default (see ``agenticx.llms.known_base_urls``). Official
    Anthropic is rejected: Codex custom providers only speak the OpenAI
    Responses API. If nothing usable can be resolved, fail closed — never
    return an empty URL that would leave a new model name on a leftover
    ``model_provider``.
    """
    name = str(provider_name or "").strip()
    if not name:
        raise CodexSettingsError("provider_name is required")
    if is_codex_non_openai_compat_provider(name):
        raise CodexSettingsError(
            f"provider {name!r} is not an OpenAI-compatible Responses "
            "gateway; Codex custom providers require wire_api=responses. "
            "Refusing to sync this provider into ~/.codex/config.toml."
        )
    configured = normalize_codex_base_url(str(base_url or ""))
    if configured:
        return configured
    fallback = normalize_codex_base_url(default_provider_base_url(name))
    if fallback:
        return fallback
    raise CodexSettingsError(
        f"cannot resolve a Codex gateway for provider {name!r}: no "
        "base_url in the provider config and no built-in default. "
        "Refusing to write the new model onto a leftover model_provider."
    )


def _escape_toml_basic_string(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace('"', '\\"')
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\t", "\\t")
    )


def _upsert_top_level_string(text: str, key: str, value: str) -> str:
    line = f'{key} = "{_escape_toml_basic_string(value)}"'
    pattern = re.compile(rf"(?m)^{re.escape(key)}\s*=\s*.*$")
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    body = text or ""
    match = re.search(r"(?m)^\[", body)
    if match:
        idx = match.start()
        prefix = body[:idx].rstrip()
        suffix = body[idx:]
        if prefix:
            return prefix + "\n" + line + "\n\n" + suffix.lstrip("\n")
        return line + "\n\n" + suffix.lstrip("\n")
    if body.strip():
        return body.rstrip() + "\n" + line + "\n"
    return line + "\n"


def _remove_table(text: str, header: str) -> str:
    """Remove a TOML table whose header line equals ``header`` (no brackets)."""
    pattern = re.compile(
        rf"(?ms)^\[{re.escape(header)}\][^\n]*\n(?:(?!^\[).*\n?)*"
    )
    return pattern.sub("", text)


def managed_token_path(provider_id: str, codex_home: Path) -> Path:
    """Path for the Near-managed bearer token file (mode 0600)."""
    return Path(codex_home) / ".agenticx" / f"{provider_id}.token"


def write_managed_token(path: Path, api_key: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = str(api_key or "")
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass
        raise
    return path


def _render_model_provider_table(
    provider_id: str,
    *,
    name: str,
    base_url: str,
    token_file: Optional[Path] = None,
) -> str:
    lines = [
        f"[model_providers.{provider_id}]",
        f'name = "{_escape_toml_basic_string(name)}"',
        f'base_url = "{_escape_toml_basic_string(base_url)}"',
        'wire_api = "responses"',
    ]
    if token_file is not None:
        # Prefer auth.command over embedding the secret in config.toml.
        # Codex runs the command and uses stdout as the bearer token.
        lines.extend(
            [
                f"[model_providers.{provider_id}.auth]",
                'command = "/bin/cat"',
                f'args = ["{_escape_toml_basic_string(str(token_file))}"]',
            ]
        )
    return "\n".join(lines) + "\n"


def merge_provider_into_codex_config(
    text: str,
    *,
    provider_name: str,
    model_id: str,
    api_key: Optional[str],
    base_url: Optional[str],
    display_name: Optional[str] = None,
    token_file: Optional[Path] = None,
) -> str:
    """Return updated config.toml text with Near provider + model applied.

    Preserves unrelated tables (mcp_servers, features, …) via surgical edits.
    ``base_url`` may be omitted for official vendors that have a built-in
    default; the matching ``model_providers.*`` block is still written.
    If no usable gateway can be resolved, raise ``CodexSettingsError``
    without mutating the previous model / model_provider pair.
    """
    model = str(model_id or "").strip()
    if not model:
        raise CodexSettingsError("model_id is required")

    normalized = resolve_codex_gateway_base_url(provider_name, base_url)

    out = text if isinstance(text, str) else ""
    out = _upsert_top_level_string(out, "model", model)

    provider_id = sanitize_codex_provider_id(provider_name)
    label = str(display_name or provider_name or provider_id).strip() or provider_id
    out = _upsert_top_level_string(out, "model_provider", provider_id)
    if codex_gateway_lacks_hosted_web_search(normalized):
        out = _upsert_top_level_string(out, "web_search", _CODEX_WEB_SEARCH_DISABLED)
    elif _top_level_scalar_value(out, "web_search") == _CODEX_WEB_SEARCH_DISABLED:
        # Restore the Codex default (cached) when leaving a limited gateway.
        # Do not clobber an explicit cached/indexed/live setting.
        out = _remove_top_level_key(out, "web_search")
    if is_codex_bailian_dashscope_gateway(provider_name, normalized):
        out = _upsert_top_level_string(
            out, "model_reasoning_effort", _CODEX_REASONING_EFFORT_NONE
        )
    elif _top_level_scalar_value(out, "model_reasoning_effort") == (
        _CODEX_REASONING_EFFORT_NONE
    ):
        # Drop a Near-set "none" when leaving BaiLian/DashScope so other
        # gateways regain the Codex default. Do not clobber a leftover
        # low/minimal/high that the user or Codex wrote for those
        # gateways.
        out = _remove_top_level_key(out, "model_reasoning_effort")
    out = _remove_table(out, f"model_providers.{provider_id}.auth")
    out = _remove_table(out, f"model_providers.{provider_id}")
    use_token = token_file if str(api_key or "").strip() else None
    block = _render_model_provider_table(
        provider_id,
        name=label,
        base_url=normalized,
        token_file=use_token,
    )
    body = out.rstrip()
    if body:
        out = body + "\n\n" + block
    else:
        out = block
    if not out.endswith("\n"):
        out += "\n"
    return out


def load_codex_config_text(path: Optional[os.PathLike[str] | str] = None) -> str:
    target = codex_config_path(path)
    if not target.exists():
        return ""
    try:
        return target.read_text(encoding="utf-8")
    except OSError as exc:
        raise CodexSettingsError(f"cannot read Codex config: {exc}") from exc


def parse_codex_config(text: str) -> Dict[str, Any]:
    raw = (text or "").strip()
    if not raw:
        return {}
    try:
        data = tomllib.loads(raw)
    except Exception as exc:  # noqa: BLE001 — surface as settings error
        raise CodexSettingsError(f"invalid TOML in Codex config: {exc}") from exc
    if not isinstance(data, dict):
        raise CodexSettingsError("Codex config root must be a TOML table")
    return data


def _backup_path(target: Path) -> Path:
    return target.with_name(f"{target.name}.agenticx.bak")


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = text if text.endswith("\n") else text + "\n"
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass
        raise


def write_codex_config(
    text: str,
    path: Optional[os.PathLike[str] | str] = None,
    *,
    backup_on_first_rewrite: bool = True,
) -> Path:
    target = codex_config_path(path)
    parse_codex_config(text)
    if backup_on_first_rewrite and target.exists():
        bak = _backup_path(target)
        if not bak.exists():
            try:
                shutil.copy2(target, bak)
            except OSError as exc:
                raise CodexSettingsError(f"cannot backup Codex config: {exc}") from exc
    atomic_write_text(target, text)
    return target


def apply_provider_to_codex_settings(
    *,
    provider_name: str,
    model_id: str,
    api_key: Optional[str],
    base_url: Optional[str],
    display_name: Optional[str] = None,
    path: Optional[os.PathLike[str] | str] = None,
) -> Dict[str, Any]:
    """Load → merge → safe write. Invalid existing TOML is not clobbered."""
    target = codex_config_path(path)
    current = load_codex_config_text(target)
    if current.strip():
        parse_codex_config(current)
    resolved_base = resolve_codex_gateway_base_url(provider_name, base_url)
    provider_id = sanitize_codex_provider_id(provider_name)
    token_file: Optional[Path] = None
    key = str(api_key or "").strip()
    if key:
        token_file = write_managed_token(
            managed_token_path(provider_id, target.parent), key
        )
    merged = merge_provider_into_codex_config(
        current,
        provider_name=provider_name,
        model_id=model_id,
        api_key=api_key,
        base_url=resolved_base,
        display_name=display_name,
        token_file=token_file,
    )
    write_codex_config(merged, target)
    return parse_codex_config(merged)


def _lookup_provider_raw(
    providers: Mapping[str, Any], name: str
) -> Optional[Mapping[str, Any]]:
    if name in providers and isinstance(providers.get(name), Mapping):
        return providers[name]  # type: ignore[return-value]
    needle = name.lower()
    for key, value in providers.items():
        if str(key).lower() == needle and isinstance(value, Mapping):
            return value
    return None


def apply_named_provider_to_codex_settings(
    provider_name: str,
    model_id: str,
    *,
    path: Optional[os.PathLike[str] | str] = None,
    providers: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Resolve ``provider_name`` from AgenticX config (or ``providers``) and apply."""
    name = str(provider_name or "").strip()
    if not name:
        raise CodexSettingsError("provider_name is required")
    model = str(model_id or "").strip()
    if not model:
        raise CodexSettingsError("model_id is required")

    if providers is not None:
        raw = _lookup_provider_raw(providers, name)
        if not isinstance(raw, Mapping):
            raise CodexSettingsError(f"unknown provider: {name}")
        api_key = raw.get("api_key")
        base_url = raw.get("base_url")
        display_name = raw.get("display_name") or name
    else:
        from agenticx.cli.config_manager import ConfigManager
        from agenticx.runtime.credential_store import resolve_refs

        cfg = ConfigManager.load()
        raw = _lookup_provider_raw(cfg.providers or {}, name)
        if not isinstance(raw, Mapping):
            raise CodexSettingsError(f"unknown provider: {name}")
        api_key = raw.get("api_key")
        base_url = raw.get("base_url")
        display_name = raw.get("display_name") or name
        if isinstance(api_key, str):
            api_key = resolve_refs(api_key)

    return apply_provider_to_codex_settings(
        provider_name=name,
        model_id=model,
        api_key=str(api_key or "") or None,
        base_url=str(base_url or "") or None,
        display_name=str(display_name or "") or None,
        path=path,
    )


def maybe_sync_codex_settings(
    harness_id: Optional[str],
    provider_name: Optional[str],
    model_id: Optional[str],
    *,
    path: Optional[os.PathLike[str] | str] = None,
    providers: Optional[Mapping[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """No-op unless harness is ``codex`` and provider/model are set."""
    hid = str(harness_id or "").strip().lower()
    if hid not in {"codex"}:
        return None
    provider = str(provider_name or "").strip()
    model = str(model_id or "").strip()
    if not provider or not model:
        return None
    if provider.startswith("__"):
        return None
    try:
        return apply_named_provider_to_codex_settings(
            provider, model, path=path, providers=providers
        )
    except CodexSettingsError:
        return None
    except Exception:
        return None


__all__ = [
    "CodexSettingsError",
    "DEFAULT_CODEX_CONFIG_PATH",
    "apply_named_provider_to_codex_settings",
    "apply_provider_to_codex_settings",
    "atomic_write_text",
    "codex_config_path",
    "codex_gateway_lacks_hosted_web_search",
    "is_codex_bailian_dashscope_gateway",
    "load_codex_config_text",
    "managed_token_path",
    "maybe_sync_codex_settings",
    "merge_provider_into_codex_config",
    "normalize_codex_base_url",
    "parse_codex_config",
    "resolve_codex_gateway_base_url",
    "sanitize_codex_provider_id",
    "write_codex_config",
    "write_managed_token",
]
