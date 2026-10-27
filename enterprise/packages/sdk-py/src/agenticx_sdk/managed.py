#!/usr/bin/env python3
"""Synchronous Managed Agents client. This package does not import ``agenticx``.

Author: Damon Li
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx


class MAApiError(Exception):
    """HTTP or transport failure. ``status`` is 0 for network errors."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


class _StreamRetry(Exception):
    """Internal signal: reconnect the event stream."""


@dataclass(frozen=True)
class _SseMessage:
    id: str | None
    event: str
    data: str


@dataclass(frozen=True)
class MAEndpoints:
    """Control-plane and session-plane roots, each already suffixed with ``/ma/v1``."""

    control: str
    runtime: str

    @classmethod
    def resolve(
        cls,
        base_url: str,
        control_url: str | None = None,
        runtime_url: str | None = None,
    ) -> MAEndpoints:
        """Use ``base_url`` for either root that was not given."""
        control_base = _trim_url(control_url or base_url)
        runtime_base = _trim_url(runtime_url or base_url)
        return cls(control=f"{control_base}/ma/v1", runtime=f"{runtime_base}/ma/v1")


class ManagedAgentsClient:
    """Blocking ``/ma/v1`` client. The token never appears in ``repr`` or errors."""

    def __init__(
        self,
        endpoints: MAEndpoints,
        token: str,
        *,
        http: httpx.Client | None = None,
        timeout: float = 30.0,
    ) -> None:
        if not token.startswith("agx-pat-"):
            raise MAApiError(
                0,
                "invalid_token",
                "token must be an agx-pat- personal access token",
            )
        self.endpoints = endpoints
        self._token = token
        self._owns_http = http is None
        self._http = http if http is not None else httpx.Client(timeout=timeout, trust_env=True)

    def list_agents(self) -> list[dict[str, Any]]:
        """Return agent envelopes from ``GET /agents``."""
        return _data_list(self._send("GET", self._control("agents")))

    def get_agent(self, agent_id: str) -> dict[str, Any]:
        """Return ``{agent, routing}``."""
        payload = self._send("GET", self._control("agents", agent_id))
        if not isinstance(payload, dict):
            raise MAApiError(0, "invalid_response", "invalid response")
        return payload

    def create_agent(self, body: dict[str, Any]) -> dict[str, Any]:
        """Return ``{agent, routing, version}``."""
        payload = self._send("POST", self._control("agents"), payload=body)
        if not isinstance(payload, dict):
            raise MAApiError(0, "invalid_response", "invalid response")
        return payload

    def create_version(
        self,
        agent_id: str,
        *,
        manifest: dict[str, Any],
        expected_latest_version: int,
        note: str | None = None,
    ) -> tuple[dict[str, Any], bool]:
        """Return ``(version, created)``."""
        body: dict[str, Any] = {
            "manifest": manifest,
            "expected_latest_version": expected_latest_version,
        }
        if note is not None:
            body["note"] = note
        payload = self._send("POST", self._control("agents", agent_id, "versions"), payload=body)
        if not isinstance(payload, dict) or not isinstance(payload.get("version"), dict):
            raise MAApiError(0, "invalid_response", "invalid response")
        if not isinstance(payload.get("created"), bool):
            raise MAApiError(0, "invalid_response", "invalid response")
        version = payload["version"]
        created = payload["created"]
        if not isinstance(version, dict) or not isinstance(created, bool):
            raise MAApiError(0, "invalid_response", "invalid response")
        return version, created

    def list_environments(self) -> list[dict[str, Any]]:
        """Return environment records."""
        return _data_list(self._send("GET", self._control("environments")))

    def create_session(self, body: dict[str, Any]) -> dict[str, Any]:
        """Create a session and return the session record."""
        payload = self._send("POST", self._runtime("sessions"), payload=body)
        if not isinstance(payload, dict):
            raise MAApiError(0, "invalid_response", "invalid response")
        return payload

    def get_session(self, session_id: str) -> dict[str, Any]:
        """Return one session record."""
        payload = self._send("GET", self._runtime("sessions", session_id))
        if not isinstance(payload, dict):
            raise MAApiError(0, "invalid_response", "invalid response")
        return payload

    def list_sessions(
        self,
        *,
        agent_id: str | None = None,
        limit: int = 20,
        scope: str = "mine",
    ) -> list[dict[str, Any]]:
        """Return session records. ``scope=tenant`` requires ``ma:admin``."""
        params: dict[str, Any] = {"limit": limit, "scope": scope}
        if agent_id:
            params["agent_id"] = agent_id
        return _data_list(self._send("GET", self._runtime("sessions"), params=params))

    def send_events(self, session_id: str, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Post a client batch and return the stored events."""
        payload = self._send("POST", self._runtime("sessions", session_id, "events"), payload=events)
        if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
            raise MAApiError(0, "invalid_response", "invalid response")
        rows = payload["events"]
        if any(not isinstance(item, dict) for item in rows):
            raise MAApiError(0, "invalid_response", "invalid response")
        return list(rows)

    def list_events(
        self,
        session_id: str,
        *,
        after_seq: int = 0,
        limit: int = 100,
        types: list[str] | None = None,
    ) -> dict[str, Any]:
        """Return ``{data, has_more, next_after_seq}``."""
        params: dict[str, Any] = {"after_seq": after_seq, "limit": limit}
        if types:
            params["types"] = list(types)
        payload = self._send("GET", self._runtime("sessions", session_id, "events"), params=params)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise MAApiError(0, "invalid_response", "invalid response")
        return payload

    def archive_session(self, session_id: str) -> dict[str, Any]:
        """Archive a session and return the updated record."""
        payload = self._send("POST", self._runtime("sessions", session_id, "archive"), payload={})
        if not isinstance(payload, dict):
            raise MAApiError(0, "invalid_response", "invalid response")
        return payload

    def iter_events(
        self,
        session_id: str,
        *,
        after_seq: int = 0,
        until_idle: bool = False,
        max_reconnects: int = 5,
        sleep: Callable[[float], None] = time.sleep,
    ) -> Iterator[dict[str, Any]]:
        """Yield persisted events. Reconnects with ``Last-Event-ID`` and drops duplicates."""
        last_seq = after_seq
        reconnects = 0
        url = self._runtime("sessions", session_id, "events", "stream")
        while True:
            headers = self._stream_headers(last_seq)
            try:
                with self._http.stream(
                    "GET",
                    url,
                    headers=headers,
                    timeout=httpx.Timeout(None, connect=10.0),
                ) as response:
                    status = response.status_code
                    if 400 <= status < 500:
                        _drain(response)
                        raise self._error_from_response(response)
                    if status < 200 or status >= 300:
                        _drain(response)
                        raise _StreamRetry()
                    for frame in _iter_sse(response.iter_lines()):
                        payload = _json_object(frame.data)
                        if payload is None or frame.id is None:
                            continue
                        seq = _frame_seq(frame.id)
                        if seq is None or seq <= last_seq:
                            continue
                        last_seq = seq
                        reconnects = 0
                        yield payload
                        event_type = payload.get("type")
                        if until_idle and event_type in (
                            "session.status_idle",
                            "session.status_terminated",
                        ):
                            return
            except MAApiError:
                raise
            except _StreamRetry:
                pass
            except httpx.HTTPError:
                pass
            reconnects += 1
            if reconnects > max_reconnects:
                raise MAApiError(0, "stream_disconnected", "event stream disconnected")
            sleep(min(2 ** (reconnects - 1), 10))

    def close(self) -> None:
        """Close the client this object created. Injected clients stay open."""
        if self._owns_http:
            self._http.close()
            self._owns_http = False

    def __repr__(self) -> str:
        control = self.endpoints.control
        runtime = self.endpoints.runtime
        return f"ManagedAgentsClient(control={control!r}, runtime={runtime!r})"

    def _control(self, *parts: str) -> str:
        return _join(self.endpoints.control, parts)

    def _runtime(self, *parts: str) -> str:
        return _join(self.endpoints.runtime, parts)

    def _stream_headers(self, last_seq: int) -> dict[str, str]:
        headers = {
            "authorization": f"Bearer {self._token}",
            "accept": "text/event-stream",
        }
        if last_seq > 0:
            headers["last-event-id"] = str(last_seq)
        return headers

    def _send(
        self,
        method: str,
        url: str,
        *,
        payload: Any | None = None,
        params: dict[str, Any] | None = None,
    ) -> Any:
        headers = {"authorization": f"Bearer {self._token}"}
        kwargs: dict[str, Any] = {"headers": headers, "params": params}
        if payload is not None:
            headers["content-type"] = "application/json"
            kwargs["json"] = payload
        try:
            response = self._http.request(method, url, **kwargs)
        except httpx.HTTPError as exc:
            raise MAApiError(0, "network_error", self._redact(str(exc))) from None
        if response.status_code < 200 or response.status_code >= 300:
            raise self._error_from_response(response)
        if not response.content:
            return None
        try:
            return response.json()
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
            raise MAApiError(response.status_code, "invalid_response", "invalid response") from exc

    def _error_from_response(self, response: httpx.Response) -> MAApiError:
        code = "http_error"
        message = f"HTTP {response.status_code}"
        details: dict[str, Any] | None = None
        try:
            body = response.json()
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
            body = None
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                raw_code = error.get("code")
                raw_message = error.get("message")
                if isinstance(raw_code, str) and isinstance(raw_message, str):
                    code = raw_code
                    message = self._redact(raw_message)
                    raw_details = error.get("details")
                    if isinstance(raw_details, dict):
                        details = dict(raw_details)
        return MAApiError(response.status_code, code, message, details)

    def _redact(self, text: str) -> str:
        if not self._token:
            return text
        return text.replace(self._token, "***")


def _trim_url(url: str) -> str:
    return url.strip().rstrip("/")


def _join(root: str, parts: tuple[str, ...]) -> str:
    suffix = "/".join(quote(part, safe="") for part in parts)
    return f"{root}/{suffix}"


def _data_list(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise MAApiError(0, "invalid_response", "invalid response")
    rows = payload["data"]
    if any(not isinstance(item, dict) for item in rows):
        raise MAApiError(0, "invalid_response", "invalid response")
    return list(rows)


def _json_object(raw: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def _frame_seq(raw: str) -> int | None:
    if not raw or raw[0] == "-":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _drain(response: httpx.Response) -> None:
    try:
        response.read()
    except httpx.HTTPError:
        return


def _split_field(line: str) -> tuple[str, str]:
    name, separator, value = line.partition(":")
    if not separator:
        return name, ""
    if value.startswith(" "):
        value = value[1:]
    return name, value


def _iter_sse(lines: Iterator[str]) -> Iterator[_SseMessage]:
    """Parse ``text/event-stream`` lines. Same rules as the Managed Agents host."""
    event_name = "message"
    data_lines: list[str] = []
    message_id: str | None = None
    saw_data = False
    for raw_line in lines:
        line = raw_line[:-1] if raw_line.endswith("\n") else raw_line
        if line.endswith("\r"):
            line = line[:-1]
        if line == "":
            if saw_data:
                yield _SseMessage(id=message_id, event=event_name, data="\n".join(data_lines))
            event_name = "message"
            data_lines = []
            message_id = None
            saw_data = False
            continue
        if line.startswith(":"):
            continue
        name, value = _split_field(line)
        if name == "id":
            message_id = value
        elif name == "event":
            event_name = value or "message"
        elif name == "data":
            data_lines.append(value)
            saw_data = True


__all__ = [
    "MAApiError",
    "MAEndpoints",
    "ManagedAgentsClient",
]
