#!/usr/bin/env python3
"""HTTP client for a desktop Managed Agents worker.

Author: Damon Li
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

import httpx

from agenticx.managed.protocol import (
    WORK_POLL_MAX_WAIT_SECONDS,
    SessionRecord,
    WorkItemRecord,
)
from agenticx.managed.sse import aiter_sse


class MAWorkerError(Exception):
    """A non-2xx response from the Managed Agents host."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class WorkLeaseLostError(MAWorkerError):
    """HTTP 409 whose code is ``work_lease_lost``."""


class WorkerAuthError(MAWorkerError):
    """HTTP 401 or 403."""


@dataclass(frozen=True)
class WorkAssignment:
    """One claimed work item plus the session and agent version to run."""

    work: WorkItemRecord
    session: SessionRecord
    agent_id: str
    agent_version: int
    manifest: dict[str, Any]
    inbox_after_seq: int


class MAWorkerClient:
    """Bearer-token client for the worker work-queue API.

    A client constructed without ``http`` owns its ``httpx.AsyncClient`` and
    closes it in ``aclose``. ``trust_env`` is false so local proxy variables
    do not redirect loopback calls.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self._base = base_url.rstrip("/")
        self._token = token
        self._owns_http = http is None
        self._http = http or httpx.AsyncClient(
            trust_env=False,
            timeout=httpx.Timeout(60.0, connect=10.0),
        )

    async def poll(
        self,
        environment_id: str,
        device_id: str,
        *,
        max_wait_seconds: int = WORK_POLL_MAX_WAIT_SECONDS,
    ) -> WorkAssignment | None:
        response = await self._send(
            "POST",
            f"/ma/v1/environments/{environment_id}/work/poll",
            json={"device_id": device_id, "max_wait_seconds": max_wait_seconds},
            timeout=httpx.Timeout(max_wait_seconds + 15, connect=10.0),
        )
        payload = response.json()
        work = payload.get("work") if isinstance(payload, dict) else None
        if not work:
            return None
        agent = payload.get("agent") if isinstance(payload, dict) else None
        if not isinstance(agent, dict):
            raise MAWorkerError(response.status_code, "invalid_request", "missing agent")
        return WorkAssignment(
            work=WorkItemRecord.model_validate(work),
            session=SessionRecord.model_validate(payload.get("session")),
            agent_id=str(agent.get("agent_id") or ""),
            agent_version=int(agent.get("version") or 0),
            manifest=dict(agent.get("manifest") or {}),
            inbox_after_seq=int(payload.get("inbox_after_seq") or 0),
        )

    async def ack(self, work_id: str, device_id: str) -> WorkItemRecord:
        return await self._work("POST", f"/ma/v1/work/{work_id}/ack", device_id)

    async def heartbeat(self, work_id: str, device_id: str) -> WorkItemRecord:
        return await self._work("POST", f"/ma/v1/work/{work_id}/heartbeat", device_id)

    async def complete(
        self,
        work_id: str,
        device_id: str,
        consumed_through_seq: int,
    ) -> WorkItemRecord:
        response = await self._send(
            "POST",
            f"/ma/v1/work/{work_id}/complete",
            json={
                "device_id": device_id,
                "consumed_through_seq": consumed_through_seq,
            },
        )
        return _parse_work(response.json())

    async def fail(self, work_id: str, device_id: str, error: str) -> WorkItemRecord:
        response = await self._send(
            "POST",
            f"/ma/v1/work/{work_id}/fail",
            json={"device_id": device_id, "error": error},
        )
        return _parse_work(response.json())

    async def ingest(
        self,
        session_id: str,
        work_id: str,
        device_id: str,
        events: Sequence[Mapping[str, Any]],
    ) -> list[dict[str, Any]]:
        response = await self._send(
            "POST",
            f"/ma/v1/sessions/{session_id}/events:ingest",
            json={
                "work_id": work_id,
                "device_id": device_id,
                "events": [dict(event) for event in events],
            },
        )
        payload = response.json()
        stored = payload.get("events") if isinstance(payload, dict) else None
        if not isinstance(stored, list):
            return []
        return [item for item in stored if isinstance(item, dict)]

    async def list_events(
        self,
        session_id: str,
        *,
        after_seq: int = 0,
        limit: int = 500,
        types: Sequence[str] = (),
    ) -> tuple[list[dict[str, Any]], bool]:
        params: list[tuple[str, str | int]] = [
            ("after_seq", after_seq),
            ("limit", limit),
        ]
        params.extend(("types", event_type) for event_type in types)
        response = await self._send(
            "GET",
            f"/ma/v1/sessions/{session_id}/events",
            params=params,
        )
        payload = response.json()
        data = payload.get("data") if isinstance(payload, dict) else None
        rows = [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []
        has_more = bool(payload.get("has_more")) if isinstance(payload, dict) else False
        return rows, has_more

    async def inbox(
        self,
        session_id: str,
        work_id: str,
        device_id: str,
        *,
        after_seq: int,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield inbox wire events. Comment frames such as pings are skipped."""
        url = f"{self._base}/ma/v1/sessions/{session_id}/inbox/stream"
        params = {
            "work_id": work_id,
            "device_id": device_id,
            "after_seq": after_seq,
        }
        async with self._http.stream(
            "GET",
            url,
            params=params,
            headers=self._headers(),
            timeout=httpx.Timeout(None, connect=10.0),
        ) as response:
            if response.status_code >= 400:
                await response.aread()
                self._raise_for(response)
            async for message in aiter_sse(response.aiter_lines()):
                payload = message.json()
                if isinstance(payload, dict):
                    yield payload

    async def list_eligible_environments(self) -> list[dict[str, str]]:
        """GET /ma/v1/work/environments and return ``[{"id", "name"}]``."""
        response = await self._send("GET", "/ma/v1/work/environments")
        try:
            payload = response.json()
        except Exception:
            payload = None
        data = payload.get("data") if isinstance(payload, dict) else None
        if not isinstance(data, list):
            raise MAWorkerError(
                response.status_code,
                "invalid_response",
                "invalid environments response",
            )
        found: list[dict[str, str]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            env_id = str(item.get("id") or "").strip()
            if not env_id:
                continue
            name = str(item.get("name") or env_id)
            found.append({"id": env_id, "name": name})
        return found

    async def aclose(self) -> None:
        """Close the client only when this object created it."""
        if self._owns_http:
            await self._http.aclose()

    async def _work(self, method: str, path: str, device_id: str) -> WorkItemRecord:
        response = await self._send(method, path, json={"device_id": device_id})
        return _parse_work(response.json())

    async def _send(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: list[tuple[str, str | int]] | None = None,
        timeout: httpx.Timeout | None = None,
    ) -> httpx.Response:
        response = await self._http.request(
            method,
            f"{self._base}{path}",
            json=json,
            params=params,
            headers=self._headers(),
            timeout=timeout,
        )
        if response.status_code >= 400:
            self._raise_for(response)
        return response

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._token}"}

    def _scrub(self, message: str) -> str:
        if self._token and self._token in message:
            return message.replace(self._token, "[redacted]")
        return message

    def _raise_for(self, response: httpx.Response) -> None:
        code = "http_error"
        message = response.reason_phrase or "request failed"
        try:
            body = response.json()
        except Exception:
            body = None
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                if error.get("code"):
                    code = str(error["code"])
                if error.get("message"):
                    message = str(error["message"])
        message = self._scrub(message)
        if response.status_code in {401, 403}:
            raise WorkerAuthError(response.status_code, code, message)
        if response.status_code == 409 and code == "work_lease_lost":
            raise WorkLeaseLostError(response.status_code, code, message)
        raise MAWorkerError(response.status_code, code, message)


def _parse_work(payload: Any) -> WorkItemRecord:
    work = payload.get("work") if isinstance(payload, dict) else None
    return WorkItemRecord.model_validate(work)


__all__ = [
    "MAWorkerClient",
    "MAWorkerError",
    "WorkAssignment",
    "WorkLeaseLostError",
    "WorkerAuthError",
]
