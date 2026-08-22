"""窄服务：搜索、取包、扫描。三个接口，没有第四个。

刻意不复用 agenticx.studio 的 server：那是给桌面端本机用的，7900 行 133 个路由，
里面有文件读写和会话操作。跑在服务端等于把那一整片攻击面搬进内网。

这里也刻意不连数据库。它只回答「这个技能是什么、扫出什么」，写库由 admin-console 做——
即使这个服务被打穿，拿到的是一个出网能力，不是租户库的凭据。
"""

from __future__ import annotations

import logging
import secrets
import tempfile
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .bundle import UnsafeBundleError, materialize
from .config import Settings

logger = logging.getLogger("skill-registry")


class SearchResponse(BaseModel):
    ok: bool
    items: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


class FetchRequest(BaseModel):
    source: str = ""
    name: str
    namespace: str = ""


class ScanResponse(BaseModel):
    ok: bool
    name: str
    verdict: str | None = None
    findings: list[dict[str, Any]] = Field(default_factory=list)
    payload: dict[str, Any] | None = None
    file_count: int = 0
    total_bytes: int = 0
    error: str | None = None


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()
    app = FastAPI(title="AgenticX Skill Registry", docs_url=None, redoc_url=None)

    def require_internal_token(
        x_agx_internal_token: str | None = Header(default=None),
    ) -> None:
        # 定长比较，别把 token 是否前缀匹配泄漏成时间差。
        if not x_agx_internal_token or not secrets.compare_digest(
            x_agx_internal_token, resolved.internal_token
        ):
            raise HTTPException(status_code=401, detail="unauthorized")

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        # 健康检查不要 token：编排器探活不该持有凭据。它也不泄漏任何东西。
        return {"status": "ok"}

    @app.get("/registry/search", dependencies=[Depends(require_internal_token)])
    def search(q: str = "") -> SearchResponse:
        try:
            from agenticx.extensions.skillhub_adapter import search_skillhub_market

            result = search_skillhub_market(q)
        except Exception as exc:  # noqa: BLE001 - 上游任何失败都只是「这次搜不到」
            logger.warning("registry search failed: %s", exc)
            return SearchResponse(ok=False, error=str(exc))
        return SearchResponse(
            ok=bool(result.get("ok", True)),
            items=list(result.get("items") or []),
            error=result.get("error"),
        )

    @app.post("/registry/scan", dependencies=[Depends(require_internal_token)])
    def fetch_and_scan(request: FetchRequest) -> ScanResponse:
        """取包并扫描。取和扫不拆成两个接口是有意的。

        拆开的话，调用方就能拿到一个「已取回但没扫」的包，而那正是最该避免的中间态——
        企业侧一个人决定、全公司承受，不该存在跳过扫描的路径。
        """
        name = request.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="name is required")

        try:
            from agenticx.extensions.registry_hub import RegistryHub

            hub = RegistryHub.from_config()
            source = request.source.strip() or hub.source_name_for_type("skillhub") or "skillhub"
            package, error = hub.fetch_skill_package(
                source, name, namespace=request.namespace.strip()
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("registry fetch failed for %s: %s", name, exc)
            return ScanResponse(ok=False, name=name, error=str(exc))

        if package is None:
            return ScanResponse(ok=False, name=name, error=error or "fetch failed")

        files = getattr(package, "files", None) or {}
        with tempfile.TemporaryDirectory(prefix="agx-skill-") as tmp:
            root = Path(tmp)
            try:
                bundle = materialize(files, root, max_total_bytes=resolved.max_bundle_bytes)
            except UnsafeBundleError as exc:
                # 包本身就不该被解出来，这比扫描规则命中更严重：直接拒绝，不给 verdict。
                logger.warning("unsafe bundle rejected for %s: %s", name, exc)
                return ScanResponse(ok=False, name=name, error=f"unsafe bundle: {exc}")

            try:
                from agenticx.skills.guard import scan_result_to_payload, scan_skill

                # source="community"：来自公网注册表的东西按最低可信度扫，
                # 不因为管理员点了导入就当成可信来源。
                result = scan_skill(root, source="community")
                payload = scan_result_to_payload(result, name)
            except Exception as exc:  # noqa: BLE001
                logger.warning("scan failed for %s: %s", name, exc)
                return ScanResponse(ok=False, name=name, error=f"scan failed: {exc}")

        return ScanResponse(
            ok=True,
            name=name,
            verdict=str(payload.get("verdict") or ""),
            findings=list(payload.get("findings") or []),
            payload=payload,
            file_count=bundle.file_count,
            total_bytes=bundle.total_bytes,
        )

    return app
