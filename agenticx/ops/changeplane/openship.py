"""Read-only HTTP adapter. GET only; never POST write actions.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from agenticx.ops.changeplane.types import (
    ACTION_DISABLED,
    ALLOWED_SNAPSHOT_ATTRS,
    ChangePlaneResult,
    DeploymentSnapshot,
)
from agenticx.ops.query import clamp_limit

_ATTR_MAX = 512
_SUMMARY_MAX = 512


def _clip(text: str, limit: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text
    return encoded[:limit].decode("utf-8", errors="ignore")


def _first_str(row: dict, keys: tuple[str, ...]) -> str:
    for key in keys:
        if key not in row:
            continue
        value = row.get(key)
        if value is None or isinstance(value, (dict, list)):
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _parse_ts(raw: object) -> datetime | None:
    if raw is None or raw == "":
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _snapshot_bag(row: dict) -> dict:
    for key in ("meta", "config", "snapshot"):
        bag = row.get(key)
        if isinstance(bag, dict):
            return bag
    return {}


def _build_attrs(row: dict, bag: dict, project_id: str, status: str, environment: str) -> dict[str, str]:
    attrs: dict[str, str] = {"source": "openship"}
    if status:
        attrs["status"] = status
    if environment:
        attrs["environment"] = environment
    if project_id:
        attrs["project_id"] = project_id
    mapping = (
        ("branch", _first_str(bag, ("branch",))),
        ("repo_url", _first_str(bag, ("repoUrl", "repo_url"))),
        ("runtime_mode", _first_str(bag, ("runtimeMode", "runtime_mode"))),
        ("deploy_target", _first_str(bag, ("deployTarget", "deploy_target"))),
        ("previous_deployment_id", _first_str(bag, ("previousActiveDeploymentId", "previous_deployment_id"))),
    )
    for key, value in mapping:
        if value:
            attrs[key] = _clip(value, _ATTR_MAX)
    return {k: v for k, v in attrs.items() if k in ALLOWED_SNAPSHOT_ATTRS}


def parse_one_deployment(row: dict) -> DeploymentSnapshot | None:
    deployment_id = _first_str(row, ("id", "deployment_id", "deploymentId"))
    if not deployment_id:
        return None
    project_id = _first_str(row, ("projectId", "project_id"))
    status = _first_str(row, ("status",))
    environment = _first_str(row, ("environment",))
    bag = _snapshot_bag(row)
    branch = _first_str(bag, ("branch",))
    summary = " ".join(part for part in (status, environment, branch) if part)
    attrs = _build_attrs(row, bag, project_id, status, environment)
    return DeploymentSnapshot(
        deployment_id=deployment_id,
        project_id=project_id,
        status=status,
        environment=environment,
        summary=_clip(summary, _SUMMARY_MAX),
        ts=_parse_ts(row.get("createdAt") or row.get("created_at") or row.get("ts")),
        attrs=attrs,
    )


def parse_deployment_list(payload: Any) -> list[DeploymentSnapshot]:
    rows: list = []
    if isinstance(payload, list):
        rows = payload
    elif isinstance(payload, dict):
        deployments = payload.get("deployments")
        if isinstance(deployments, list):
            rows = deployments
        else:
            data = payload.get("data")
            if isinstance(data, list):
                rows = data
    out: list[DeploymentSnapshot] = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        snap = parse_one_deployment(item)
        if snap is not None:
            out.append(snap)
    return out


def _disabled() -> ChangePlaneResult:
    return ChangePlaneResult(ok=False, reason=ACTION_DISABLED)


class OpenshipProvider:
    def __init__(self, base_url: str = "", token: str = "") -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.token = token or ""
        self.last_reason = ""

    def list_deployments(
        self, *, project_id: str = "", limit: int = 50
    ) -> list[DeploymentSnapshot]:
        self.last_reason = ""
        if not self.base_url:
            self.last_reason = "not_configured"
            return []
        path = "/api/deployments"
        pid = (project_id or "").strip()
        if not pid:
            pid = str(os.environ.get("AGENTICX_CHANGEPLANE_PROJECT_ID") or "").strip()
        if pid:
            path = f"{path}?{urlencode({'projectId': pid})}"
        payload, reason = self._get_json(path)
        if payload is None:
            self.last_reason = reason
            return []
        return parse_deployment_list(payload)[: clamp_limit(limit)]

    def get_deployment(self, deployment_id: str) -> DeploymentSnapshot | None:
        self.last_reason = ""
        did = str(deployment_id or "").strip()
        if not did or not self.base_url:
            if not self.base_url:
                self.last_reason = "not_configured"
            return None
        payload, reason = self._get_json(f"/api/deployments/{did}")
        if payload is None:
            self.last_reason = reason
            return None
        parsed = parse_deployment_list(payload)
        if parsed:
            return parsed[0]
        if isinstance(payload, dict):
            return parse_one_deployment(payload)
        return None

    def restart(self, deployment_id: str) -> ChangePlaneResult:
        return _disabled()

    def rollback(self, deployment_id: str) -> ChangePlaneResult:
        return _disabled()

    def redeploy(self, deployment_id: str) -> ChangePlaneResult:
        return _disabled()

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _get_json(self, path: str) -> tuple[Any | None, str]:
        url = f"{self.base_url}{path}"
        req = Request(url, headers=self._headers(), method="GET")
        try:
            with urlopen(req, timeout=10) as resp:
                status = int(getattr(resp, "status", 200) or 200)
                body = resp.read()
        except HTTPError as exc:
            return None, f"openship_http_{exc.code}"
        except (URLError, TimeoutError, OSError, ValueError):
            return None, "openship_network"
        if status != 200:
            return None, f"openship_http_{status}"
        try:
            return json.loads(body.decode("utf-8")), ""
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None, "openship_http_200"
