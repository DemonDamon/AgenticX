"""Enterprise-managed web search client for Desktop.

The Desktop sends only its enterprise PAT and query to the Portal. Search
provider credentials, failover, quotas, and policy remain server-side.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.parse import urlsplit

import httpx

from agenticx.cli.config_manager import ConfigManager
from agenticx.studio.web_search.contracts import WEB_SEARCH_MAX_RESULTS_CAP, WebSearchResult


class EnterpriseManagedSearchError(RuntimeError):
    """A safe, user-facing failure from the managed search boundary."""

    def __init__(self, message: str, *, status_code: int = 0, code: str = "") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True)
class EnterpriseManagedSearchBatch:
    hits: List[WebSearchResult]
    provider: str


def _enabled(value: Any) -> bool:
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _enterprise_config(raw: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    if raw is not None:
        return raw if isinstance(raw, dict) else {}
    # Enterprise PAT and Portal origin are account credentials written by the
    # Desktop main process to the global user config. Never read them through
    # ConfigManager.get_value(), where a project-local config can override the
    # global section.
    global_config = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
    loaded = global_config.get("enterprise")
    return loaded if isinstance(loaded, dict) else {}


def enterprise_managed_search_active(raw: Optional[Dict[str, Any]] = None) -> bool:
    """True once an enterprise account owns Desktop capabilities.

    Deliberately checks the managed state, not local ``web_search.enabled``.
    Missing/corrupt login details must fail closed at call time instead of
    silently dropping into a local provider.
    """

    return _enabled(_enterprise_config(raw).get("enabled", False))


def _portal_origin(raw: str) -> str:
    value = str(raw or "").strip().rstrip("/")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise EnterpriseManagedSearchError("企业组织地址无效，请重新登录")
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme == "http" and hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise EnterpriseManagedSearchError("企业组织地址必须使用 HTTPS，请重新登录")
    return f"{parsed.scheme}://{parsed.netloc}"


def _response_error(payload: Any, status_code: int) -> EnterpriseManagedSearchError:
    message = ""
    code = ""
    if isinstance(payload, dict):
        err = payload.get("error")
        if isinstance(err, dict):
            message = str(err.get("message") or "").strip()
            code = str(err.get("code") or "").strip()
        if not message:
            message = str(payload.get("message") or "").strip()
    if not message:
        if status_code == 401:
            message = "企业登录已失效，请重新登录"
        elif status_code == 403:
            message = "企业管理员已关闭联网搜索或当前账号没有权限"
        elif status_code == 429:
            message = "今日联网搜索额度已用完，请联系管理员调整"
        else:
            message = "企业联网搜索暂时不可用，请稍后重试"
    return EnterpriseManagedSearchError(message, status_code=status_code, code=code)


class EnterpriseManagedWebSearchClient:
    """Call the tenant-managed search endpoint without receiving provider keys."""

    def __init__(
        self,
        *,
        portal_origin: str,
        token: str,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        self._portal_origin = _portal_origin(portal_origin)
        self._token = str(token or "").strip()
        self._transport = transport
        if not self._token:
            raise EnterpriseManagedSearchError("企业登录信息不完整，请重新登录")

    @classmethod
    def from_config(
        cls,
        raw: Optional[Dict[str, Any]] = None,
        *,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> Optional["EnterpriseManagedWebSearchClient"]:
        cfg = _enterprise_config(raw)
        if not _enabled(cfg.get("enabled", False)):
            return None
        return cls(
            portal_origin=str(cfg.get("base_url") or cfg.get("default_portal_url") or ""),
            token=str(cfg.get("token") or ""),
            transport=transport,
        )

    def search(self, query: str, max_results: int) -> EnterpriseManagedSearchBatch:
        q = str(query or "").strip()
        if not q:
            return EnterpriseManagedSearchBatch(hits=[], provider="enterprise")
        n = max(1, min(WEB_SEARCH_MAX_RESULTS_CAP, int(max_results)))
        endpoint = f"{self._portal_origin}/api/desktop/v1/web-search"
        try:
            with httpx.Client(
                timeout=httpx.Timeout(50.0, connect=10.0),
                follow_redirects=False,
                transport=self._transport,
            ) as client:
                response = client.post(
                    endpoint,
                    headers={
                        "Authorization": f"Bearer {self._token}",
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                    },
                    json={"query": q, "max_results": n},
                )
        except EnterpriseManagedSearchError:
            raise
        except Exception as exc:
            raise EnterpriseManagedSearchError(
                "无法连接企业联网搜索服务，请检查网络后重试"
            ) from exc

        try:
            payload: Any = response.json()
        except Exception:
            payload = {}
        if not response.is_success:
            raise _response_error(payload, response.status_code)
        if not isinstance(payload, dict) or payload.get("ok") is not True:
            raise EnterpriseManagedSearchError("企业联网搜索返回了无法识别的结果")

        hits: List[WebSearchResult] = []
        raw_hits = payload.get("hits")
        if isinstance(raw_hits, list):
            for item in raw_hits:
                if not isinstance(item, dict):
                    continue
                url = str(item.get("url") or "").strip()
                parsed_url = urlsplit(url)
                if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
                    continue
                title = str(item.get("title") or "").strip() or url
                snippet = str(item.get("snippet") or "").strip()
                hits.append(WebSearchResult(title=title, url=url, snippet=snippet))
                if len(hits) >= n:
                    break

        provider = str(payload.get("provider") or "enterprise").strip() or "enterprise"
        return EnterpriseManagedSearchBatch(hits=hits, provider=provider)
