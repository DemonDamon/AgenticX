#!/usr/bin/env python3
"""Web search service: provider routing and formatting.

Author: Damon Li
"""

from __future__ import annotations

from typing import List, Optional

from agenticx.cli.config_manager import ConfigManager
from agenticx.studio.web_search.contracts import WebSearchResult, WebSearchRuntimeConfig
from agenticx.studio.web_search import providers


class WebSearchService:
    """Run queries using configured provider with DuckDuckGo fallback."""

    def __init__(self, cfg: WebSearchRuntimeConfig) -> None:
        self._cfg = cfg

    @classmethod
    def from_config(cls, raw: Optional[dict] = None) -> "WebSearchService":
        merged = ConfigManager.get_value("web_search")
        if raw is not None:
            base = merged if isinstance(merged, dict) else {}
            merged = {**base, **raw}
        cfg = WebSearchRuntimeConfig.from_merged_yaml(merged if isinstance(merged, dict) else {})
        return cls(cfg)

    def search(
        self,
        query: str,
        *,
        max_results: Optional[int] = None,
        provider_override: Optional[str] = None,
    ) -> List[WebSearchResult]:
        q = (query or "").strip()
        if not q:
            return []
        n = int(max_results if max_results is not None else self._cfg.max_results)
        n = max(1, min(20, n))
        snip = self._cfg.fetch_snippet_chars
        prov = (provider_override or self._cfg.default_provider or "duckduckgo").lower().strip()
        pconf = self._cfg.providers if isinstance(self._cfg.providers, dict) else {}

        primary: List[WebSearchResult] = []
        if prov == "bocha":
            b = pconf.get("bocha") if isinstance(pconf.get("bocha"), dict) else {}
            primary = providers.search_bocha(str(b.get("api_key", "")), q, n, snip)
        elif prov == "tavily":
            b = pconf.get("tavily") if isinstance(pconf.get("tavily"), dict) else {}
            primary = providers.search_tavily(str(b.get("api_key", "")), q, n, snip)
        elif prov == "serper":
            b = pconf.get("serper") if isinstance(pconf.get("serper"), dict) else {}
            primary = providers.search_serper(str(b.get("api_key", "")), q, n, snip)
        elif prov == "google":
            b = pconf.get("google") if isinstance(pconf.get("google"), dict) else {}
            primary = providers.search_google_cse(
                str(b.get("api_key", "")),
                str(b.get("cx", "") or ""),
                q,
                n,
                snip,
            )
        elif prov == "bing":
            b = pconf.get("bing") if isinstance(pconf.get("bing"), dict) else {}
            primary = providers.search_bing(str(b.get("api_key", "")), q, n, snip)
        else:
            primary = providers.search_duckduckgo_html(q, n, snip)

        if primary or prov == "duckduckgo":
            return primary

        return providers.search_duckduckgo_html(q, n, snip)

    @staticmethod
    def format_results(results: List[WebSearchResult]) -> str:
        if not results:
            return "No search results found."
        lines: List[str] = []
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r.title}\n   URL: {r.url}\n   摘要: {r.snippet}\n")
        return "\n".join(lines).rstrip()
