#!/usr/bin/env python3
"""Configuration models for built-in web search.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

ProviderName = Literal["duckduckgo", "bocha", "tavily", "serper", "google", "bing"]

# Upper bound for configured/tool-requested result counts (providers may return fewer).
WEB_SEARCH_MAX_RESULTS_CAP = 50


@dataclass
class WebSearchResult:
    """One search hit."""

    title: str
    url: str
    snippet: str


@dataclass
class WebSearchRuntimeConfig:
    """Effective config loaded from ``~/.agenticx/config.yaml : web_search``."""

    enabled: bool = True
    default_provider: ProviderName = "duckduckgo"
    max_results: int = 5
    fetch_snippet_chars: int = 600
    providers: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_merged_yaml(cls, raw: Optional[Dict[str, Any]]) -> "WebSearchRuntimeConfig":
        data = raw if isinstance(raw, dict) else {}
        prov = data.get("providers")
        if not isinstance(prov, dict):
            prov = {}
        enabled = data.get("enabled", True)
        if isinstance(enabled, str):
            enabled = enabled.strip().lower() in ("1", "true", "yes", "on")
        dp = str(data.get("default_provider", "duckduckgo") or "duckduckgo").lower().strip()
        if dp not in {"duckduckgo", "bocha", "tavily", "serper", "google", "bing"}:
            dp = "duckduckgo"
        mr = int(data.get("max_results", 5) or 5)
        mr = max(1, min(WEB_SEARCH_MAX_RESULTS_CAP, mr))
        fsc = int(data.get("fetch_snippet_chars", 600) or 600)
        fsc = max(80, min(4000, fsc))
        return cls(
            enabled=bool(enabled),
            default_provider=dp,  # type: ignore[arg-type]
            max_results=mr,
            fetch_snippet_chars=fsc,
            providers=dict(prov),
        )

    def to_client_dict(self) -> Dict[str, Any]:
        """Shape returned to Desktop: secrets masked by route layer."""
        return {
            "enabled": self.enabled,
            "default_provider": self.default_provider,
            "max_results": self.max_results,
            "fetch_snippet_chars": self.fetch_snippet_chars,
            "providers": dict(self.providers),
        }


def normalize_followup_lines(body: str, *, limit: int = 3) -> List[str]:
    """Turn followup block body into at most ``limit`` non-empty lines."""
    out: List[str] = []
    for line in (body or "").splitlines():
        t = line.strip()
        if t:
            out.append(t)
        if len(out) >= limit:
            break
    return out
