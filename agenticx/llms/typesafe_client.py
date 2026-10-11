"""Internal TypeSafe System One HTTP client (not a chat provider, not MCP)."""

from __future__ import annotations

from typing import Any

import httpx

from agenticx.llms.typesafe_config import DEFAULT_TYPESAFE_BASE_URL, DEFAULT_TIMEOUT_SEC


class TypesafeError(Exception):
    """Base error for TypeSafe System One calls."""


class TypesafeTimeout(TypesafeError):
    """Remote System One call timed out."""


class TypesafeHttpError(TypesafeError):
    def __init__(self, status_code: int, message: str = "", *, retryable: bool | None = None) -> None:
        self.status_code = int(status_code)
        self.message = message or f"HTTP {self.status_code}"
        if retryable is None:
            retryable = self.status_code in {408, 409, 425, 429} or self.status_code >= 500
        self.retryable = bool(retryable)
        super().__init__(self.message)


def _system_one_url(base_url: str) -> str:
    root = (base_url or DEFAULT_TYPESAFE_BASE_URL).rstrip("/")
    return f"{root}/v1/systemone"


async def system_one(
    *,
    state: Any,
    questions: dict[str, Any],
    model: str,
    api_key: str,
    timeout_sec: float = DEFAULT_TIMEOUT_SEC,
    base_url: str = DEFAULT_TYPESAFE_BASE_URL,
    transport: httpx.AsyncBaseTransport | None = None,
) -> dict[str, Any]:
    """POST /v1/systemone and return the raw JSON dict.

    The client does not retry. Callers decide fallback on timeout / HTTP error.
    Honors HTTPS_PROXY / HTTP_PROXY via default httpx env trust.
    """
    payload = {"state": state, "questions": questions, "model": model}
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    client_kwargs: dict[str, Any] = {
        "timeout": timeout_sec,
        "trust_env": True,
    }
    if transport is not None:
        client_kwargs["transport"] = transport
    try:
        async with httpx.AsyncClient(**client_kwargs) as client:
            response = await client.post(_system_one_url(base_url), json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise TypesafeTimeout(str(exc) or "typesafe timeout") from exc
    except httpx.RequestError as exc:
        raise TypesafeHttpError(0, str(exc), retryable=True) from exc

    if response.status_code >= 400:
        retryable = response.status_code == 429 or response.status_code >= 500
        if response.status_code == 401:
            retryable = False
        detail = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                detail = str(body.get("error") or body.get("message") or "")
        except Exception:
            detail = (response.text or "")[:240]
        raise TypesafeHttpError(response.status_code, detail or response.reason_phrase, retryable=retryable)

    data = response.json()
    if not isinstance(data, dict):
        raise TypesafeHttpError(response.status_code, "systemone response is not an object", retryable=False)
    return data
