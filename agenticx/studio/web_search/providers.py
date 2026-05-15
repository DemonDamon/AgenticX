#!/usr/bin/env python3
"""Search provider implementations (DuckDuckGo HTML + paid APIs).

Author: Damon Li
"""

from __future__ import annotations

import logging
import re
from html import unescape
from typing import List
from urllib.parse import parse_qs, unquote, urlparse

import httpx

from agenticx.studio.web_search.contracts import WebSearchResult

logger = logging.getLogger(__name__)

_TAG_RE = re.compile(r"<[^>]+>")
_DDG_HTML_LINK_RE = re.compile(
    r"""(<a[^>]*class=['"][^'"]*result__a[^'"]*['"][^>]*>)(.*?)</a>""",
    re.I | re.DOTALL,
)
_DDG_HTML_SNIPPET_RE = re.compile(
    r"""<a[^>]*class=['"][^'"]*result__snippet[^'"]*['"][^>]*>(.*?)</a>""",
    re.I | re.DOTALL,
)
_DDG_LITE_LINK_RE = re.compile(
    r"""(<a[^>]*class=['"]result-link['"][^>]*>)(.*?)</a>""",
    re.I | re.DOTALL,
)
_DDG_LITE_SNIPPET_RE = re.compile(
    r"""<td[^>]*class=['"]result-snippet['"][^>]*>(.*?)</td>""",
    re.I | re.DOTALL,
)
_HREF_RE = re.compile(r"""href=['"]([^'"]+)['"]""", re.I)


def _strip_html_fragment(raw: str, *, max_len: int) -> str:
    text = unescape(_TAG_RE.sub(" ", raw or ""))
    text = " ".join(text.split())
    if len(text) > max_len:
        return text[: max_len - 1].rstrip() + "…"
    return text


def _unwrap_ddg_redirect(href: str) -> str:
    if "uddg=" in href:
        try:
            q = parse_qs(urlparse(href).query)
            udg = (q.get("uddg") or [None])[0]
            if udg:
                return unquote(udg)
        except Exception:
            pass
    return href


def _looks_like_ddg_challenge(status_code: int, html: str) -> bool:
    t = (html or "").lower()
    if status_code == 202:
        return True
    return (
        "anomaly.js" in t
        or "automated requests" in t
        or "unusual traffic" in t
        or "challenge" in t
        or "unfortunately" in t
    )


def _href_from_anchor_tag(tag_open: str) -> str:
    m = _HREF_RE.search(tag_open or "")
    return (m.group(1).strip() if m else "")


def search_duckduckgo_lite(query: str, max_results: int, snippet_chars: int) -> List[WebSearchResult]:
    """Fallback for DDG anti-bot page on html endpoint."""
    results: List[WebSearchResult] = []
    try:
        with httpx.Client(timeout=25.0, follow_redirects=True) as client:
            resp = client.get(
                "https://lite.duckduckgo.com/lite/",
                params={"q": query},
                headers={"User-Agent": "Mozilla/5.0 (compatible; MachiWebSearch/1.0)"},
            )
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        logger.warning("DuckDuckGo Lite search failed: %s", exc)
        return results

    snippets = _DDG_LITE_SNIPPET_RE.findall(html)
    idx_snip = 0
    for tag_open, title_html in _DDG_LITE_LINK_RE.findall(html):
        if len(results) >= max_results:
            break
        href = _href_from_anchor_tag(tag_open)
        url = _unwrap_ddg_redirect(href.strip())
        title = _strip_html_fragment(title_html, max_len=min(200, snippet_chars))
        snippet = ""
        if idx_snip < len(snippets):
            snippet = _strip_html_fragment(snippets[idx_snip], max_len=snippet_chars)
            idx_snip += 1
        if not url or url.startswith("#"):
            continue
        if url.startswith("//"):
            url = f"https:{url}"
        results.append(WebSearchResult(title=title or url, url=url, snippet=snippet))
    return results


def search_duckduckgo_html(query: str, max_results: int, snippet_chars: int) -> List[WebSearchResult]:
    """Free HTML search (no API key)."""
    results: List[WebSearchResult] = []
    try:
        with httpx.Client(timeout=25.0, follow_redirects=True) as client:
            resp = client.post(
                "https://html.duckduckgo.com/html/",
                data={"q": query},
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; MachiWebSearch/1.0)",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            )
            status_code = resp.status_code
            resp.raise_for_status()
            html = resp.text
    except Exception as exc:
        logger.warning("DuckDuckGo HTML search failed: %s", exc)
        return search_duckduckgo_lite(query, max_results, snippet_chars)

    if _looks_like_ddg_challenge(status_code, html):
        logger.info("DuckDuckGo HTML returned challenge page, falling back to Lite endpoint")
        return search_duckduckgo_lite(query, max_results, snippet_chars)

    snippets = _DDG_HTML_SNIPPET_RE.findall(html)
    idx_snip = 0
    for tag_open, title_html in _DDG_HTML_LINK_RE.findall(html):
        if len(results) >= max_results:
            break
        href = _href_from_anchor_tag(tag_open)
        url = _unwrap_ddg_redirect(href.strip())
        title = _strip_html_fragment(title_html, max_len=min(200, snippet_chars))
        snippet = ""
        if idx_snip < len(snippets):
            snippet = _strip_html_fragment(snippets[idx_snip], max_len=snippet_chars)
            idx_snip += 1
        if not url or url.startswith("#"):
            continue
        results.append(WebSearchResult(title=title or url, url=url, snippet=snippet))
    return results


def search_bocha(api_key: str, query: str, max_results: int, snippet_chars: int) -> List[WebSearchResult]:
    results: List[WebSearchResult] = []
    if not api_key.strip():
        return results
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                "https://api.bochaai.com/v1/web-search",
                headers={
                    "Authorization": f"Bearer {api_key.strip()}",
                    "Content-Type": "application/json",
                },
                json={"query": query, "count": max_results, "summary": True},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Bocha search failed: %s", exc)
        return results
    pages = []
    if isinstance(data, dict) and "data" in data:
        wp = (data.get("data") or {}).get("webPages") or {}
        pages = wp.get("value") or []
    for p in pages[:max_results]:
        if not isinstance(p, dict):
            continue
        title = str(p.get("name") or p.get("title") or "")[:200]
        url = str(p.get("url") or "")
        sn = str(p.get("summary") or p.get("snippet") or "")
        sn = _strip_html_fragment(sn, max_len=snippet_chars)
        if url:
            results.append(WebSearchResult(title=title or url, url=url, snippet=sn))
    return results


def search_tavily(api_key: str, query: str, max_results: int, snippet_chars: int) -> List[WebSearchResult]:
    results: List[WebSearchResult] = []
    if not api_key.strip():
        return results
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                "https://api.tavily.com/search",
                json={
                    "api_key": api_key.strip(),
                    "query": query,
                    "max_results": max_results,
                    "search_depth": "basic",
                    "include_answer": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Tavily search failed: %s", exc)
        return results
    for item in (data.get("results") or [])[:max_results]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        title = str(item.get("title") or "")[:200]
        sn = str(item.get("content") or "")
        sn = _strip_html_fragment(sn, max_len=snippet_chars)
        if url:
            results.append(WebSearchResult(title=title or url, url=url, snippet=sn))
    return results


def search_serper(api_key: str, query: str, max_results: int, snippet_chars: int) -> List[WebSearchResult]:
    results: List[WebSearchResult] = []
    if not api_key.strip():
        return results
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": api_key.strip(), "Content-Type": "application/json"},
                json={"q": query, "num": max_results},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Serper search failed: %s", exc)
        return results
    for item in (data.get("organic") or [])[:max_results]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("link") or "")
        title = str(item.get("title") or "")[:200]
        sn = str(item.get("snippet") or "")
        sn = _strip_html_fragment(sn, max_len=snippet_chars)
        if url:
            results.append(WebSearchResult(title=title or url, url=url, snippet=sn))
    return results


def search_google_cse(api_key: str, cx: str, query: str, max_results: int, snippet_chars: int) -> List[WebSearchResult]:
    results: List[WebSearchResult] = []
    if not api_key.strip() or not str(cx or "").strip():
        return results
    n = min(max_results, 10)
    try:
        with httpx.Client(timeout=25.0) as client:
            resp = client.get(
                "https://www.googleapis.com/customsearch/v1",
                params={"key": api_key.strip(), "cx": str(cx).strip(), "q": query, "num": n},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Google CSE search failed: %s", exc)
        return results
    for item in (data.get("items") or []):
        if not isinstance(item, dict):
            continue
        url = str(item.get("link") or "")
        title = str(item.get("title") or "")[:200]
        sn = str(item.get("snippet") or "")
        sn = _strip_html_fragment(sn, max_len=snippet_chars)
        if url:
            results.append(WebSearchResult(title=title or url, url=url, snippet=sn))
    return results


def search_bing(api_key: str, query: str, max_results: int, snippet_chars: int) -> List[WebSearchResult]:
    results: List[WebSearchResult] = []
    if not api_key.strip():
        return results
    try:
        with httpx.Client(timeout=25.0) as client:
            resp = client.get(
                "https://api.bing.microsoft.com/v7.0/search",
                headers={"Ocp-Apim-Subscription-Key": api_key.strip()},
                params={"q": query, "count": max_results},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.warning("Bing search failed: %s", exc)
        return results
    blocks = ((data.get("webPages") or {}).get("value")) or []
    for item in blocks[:max_results]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("url") or "")
        title = str(item.get("name") or "")[:200]
        sn = str(item.get("snippet") or "")
        sn = _strip_html_fragment(sn, max_len=snippet_chars)
        if url:
            results.append(WebSearchResult(title=title or url, url=url, snippet=sn))
    return results
