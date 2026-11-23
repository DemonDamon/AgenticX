#!/usr/bin/env python3
"""Built-in official provider default base URLs.

Python counterpart of desktop ``KNOWN_BASE_URLS`` in
``desktop/electron/main.ts``, plus the ``_DEFAULT_*_BASE_URL`` (and
equivalent) values in ``agenticx/llms/*_provider.py``.

When the two sources disagree, prefer the Python provider default —
that is the URL the official provider client actually calls. Today
that only matters for Qianfan: desktop still lists the legacy
``aip.baidubce.com`` RPC root, while ``qianfan_provider.py`` uses the
OpenAI-compatible ``https://qianfan.baidubce.com/v2``.

Author: Damon Li
"""

from __future__ import annotations

# Official Near provider ids (and a few Python-module aliases) → default root.
# Keep this list aligned with desktop KNOWN_BASE_URLS when adding a vendor.
KNOWN_PROVIDER_BASE_URLS: dict[str, str] = {
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "volcengine": "https://ark.cn-beijing.volces.com/api/v3",
    "ark": "https://ark.cn-beijing.volces.com/api/v3",
    "zhipu": "https://open.bigmodel.cn/api/paas/v4",
    "bailian": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    "qianfan": "https://qianfan.baidubce.com/v2",
    "minimax": "https://api.minimax.chat/v1",
    "kimi": "https://api.moonshot.cn/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "mimo": "https://api.xiaomimimo.com/v1",
    "xiaomi": "https://api.xiaomimimo.com/v1",
}

# Official APIs that are not OpenAI-compatible. Codex 0.167 custom
# providers can only speak ``wire_api = "responses"``.
CODEX_NON_OPENAI_COMPAT_PROVIDERS = frozenset({"anthropic"})

_ALIASES = {
    "moonshot": "kimi",
}


def _canonical_provider_id(provider_name: str) -> str:
    raw = str(provider_name or "").strip().lower()
    if not raw:
        return ""
    return _ALIASES.get(raw, raw)


def default_provider_base_url(provider_name: str) -> str:
    """Return the built-in default base URL, or ``""`` if there is none."""
    key = _canonical_provider_id(provider_name)
    if not key:
        return ""
    return KNOWN_PROVIDER_BASE_URLS.get(key, "")


def is_codex_non_openai_compat_provider(provider_name: str) -> bool:
    """True when the official vendor API is not an OpenAI-compatible gateway."""
    return _canonical_provider_id(provider_name) in CODEX_NON_OPENAI_COMPAT_PROVIDERS


__all__ = [
    "CODEX_NON_OPENAI_COMPAT_PROVIDERS",
    "KNOWN_PROVIDER_BASE_URLS",
    "default_provider_base_url",
    "is_codex_non_openai_compat_provider",
]
