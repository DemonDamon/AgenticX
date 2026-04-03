#!/usr/bin/env python3
"""FastAPI application for the IM remote command gateway server.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse

from agenticx.gateway.adapters.dingtalk import DingTalkAdapter
from agenticx.gateway.adapters.feishu import FeishuAdapter
from agenticx.gateway.adapters.wechat_ilink import WeChatILinkAdapter
from agenticx.gateway.adapters.wecom import WeComAdapter, query_dict_from_request
from agenticx.gateway.config import (
    GatewayServerConfig,
    binding_code_for_device,
    binding_code_table,
    device_token_table,
    load_gateway_config,
)
from agenticx.gateway.connect_page import render_connect_page
from agenticx.gateway.connect_session import ConnectSessionManager
from agenticx.gateway.device_manager import DeviceManager
from agenticx.gateway.models import GatewayMessage, GatewayReply
from agenticx.gateway.router import MessageRouter
from agenticx.gateway.user_device_map import UserDeviceMap, default_bindings_path

logger = logging.getLogger(__name__)


def create_gateway_app(config: Optional[GatewayServerConfig] = None) -> FastAPI:
    cfg = config or GatewayServerConfig()
    app = FastAPI(title="AgenticX IM Gateway", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    device_manager = DeviceManager()
    user_map = UserDeviceMap(default_bindings_path())
    tokens = device_token_table(cfg)
    bindings = binding_code_table(cfg)
    for code, did in bindings.items():
        user_map.register_binding_code(code, did)

    connect_sessions = ConnectSessionManager()
    router = MessageRouter(
        device_manager,
        user_map,
        tokens,
        bindings,
        reply_timeout_seconds=cfg.reply_timeout_seconds,
        connect_sessions=connect_sessions,
    )

    feishu: Optional[FeishuAdapter] = None
    if cfg.adapters.feishu.enabled:
        feishu = FeishuAdapter(
            app_id=cfg.adapters.feishu.app_id,
            app_secret=cfg.adapters.feishu.app_secret,
            encrypt_key=cfg.adapters.feishu.encrypt_key,
            verification_token=cfg.adapters.feishu.verification_token,
        )

    wecom: Optional[WeComAdapter] = None
    if cfg.adapters.wecom.enabled:
        wecom = WeComAdapter(
            corp_id=cfg.adapters.wecom.corp_id,
            agent_id=cfg.adapters.wecom.agent_id,
            secret=cfg.adapters.wecom.secret,
            token=cfg.adapters.wecom.token,
            encoding_aes_key=cfg.adapters.wecom.encoding_aes_key,
        )

    dingtalk: Optional[DingTalkAdapter] = None
    if cfg.adapters.dingtalk.enabled:
        dingtalk = DingTalkAdapter(app_secret=cfg.adapters.dingtalk.app_secret)

    wechat_ilink: Optional[WeChatILinkAdapter] = None
    if cfg.adapters.wechat_ilink.enabled:
        sidecar_url = (cfg.adapters.wechat_ilink.sidecar_url or "").strip()
        if not sidecar_url:
            sidecar_port = int(cfg.adapters.wechat_ilink.sidecar_port or 0)
            if sidecar_port > 0:
                sidecar_url = f"http://127.0.0.1:{sidecar_port}"
        wechat_ilink = WeChatILinkAdapter(sidecar_url=sidecar_url)

    app.state.config = cfg
    app.state.device_manager = device_manager
    app.state.user_map = user_map
    app.state.router = router
    app.state.feishu = feishu
    app.state.wecom = wecom
    app.state.dingtalk = dingtalk
    app.state.wechat_ilink = wechat_ilink
    app.state.connect_sessions = connect_sessions

    @app.on_event("startup")
    async def _startup_wechat_ilink() -> None:
        if wechat_ilink is None:
            return
        await wechat_ilink.start()
        logger.info("gateway lifecycle started wechat_ilink adapter")

    @app.on_event("shutdown")
    async def _shutdown_wechat_ilink() -> None:
        if wechat_ilink is None:
            return
        await wechat_ilink.stop()
        logger.info("gateway lifecycle stopped wechat_ilink adapter")

    def _require_device_token(device_id: str, token: str) -> None:
        did = (device_id or "").strip()
        tok = (token or "").strip()
        if not did or not tok or tokens.get(did) != tok:
            raise HTTPException(status_code=401, detail="invalid device credentials")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/webhook/feishu")
    async def webhook_feishu(request: Request) -> JSONResponse:
        if feishu is None:
            raise HTTPException(status_code=404, detail="feishu adapter disabled")
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid json")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="invalid body")
        immediate, msg = feishu.process_json(body)
        if immediate is not None:
            return JSONResponse(immediate)
        if msg is None:
            return JSONResponse({})
        task = asyncio.create_task(router.route(msg, feishu))

        def _log_err(t: asyncio.Task) -> None:
            try:
                t.result()
            except Exception as exc:
                logger.exception("feishu route failed: %s", exc)

        task.add_done_callback(_log_err)
        return JSONResponse({})

    @app.api_route("/webhook/wecom", methods=["GET", "POST"])
    async def webhook_wecom(request: Request) -> PlainTextResponse:
        if wecom is None:
            raise HTTPException(status_code=404, detail="wecom adapter disabled")
        q = query_dict_from_request(request)
        if request.method == "GET":
            resp = wecom.verify_get_url(q)
            if resp is None:
                raise HTTPException(status_code=400)
            return resp
        body_text = (await request.body()).decode("utf-8")
        msg = await wecom.parse_post(body_text, q)
        if msg is None:
            return PlainTextResponse("success")
        task = asyncio.create_task(router.route(msg, wecom))

        def _log_err(t: asyncio.Task) -> None:
            try:
                t.result()
            except Exception as exc:
                logger.exception("wecom route failed: %s", exc)

        task.add_done_callback(_log_err)
        return PlainTextResponse("success")

    @app.post("/webhook/dingtalk")
    async def webhook_dingtalk(request: Request) -> JSONResponse:
        if dingtalk is None:
            raise HTTPException(status_code=404, detail="dingtalk adapter disabled")
        msg = await dingtalk.parse_message(request)
        if msg is None:
            return JSONResponse({"success": True})
        task = asyncio.create_task(router.route(msg, dingtalk))

        def _log_err(t: asyncio.Task) -> None:
            try:
                t.result()
            except Exception as exc:
                logger.exception("dingtalk route failed: %s", exc)

        task.add_done_callback(_log_err)
        return JSONResponse({"success": True})

    @app.post("/api/command")
    async def api_command(
        request: Request,
        device_id: str = Query(default=""),
        token: str = Query(default=""),
    ) -> JSONResponse:
        """Siri / HTTP shortcut: POST JSON {"text": "..."}; waits for device reply over WebSocket."""
        secret = (cfg.command_api_secret or "").strip()
        body: Dict[str, Any]
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid json")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="invalid body")
        text = str(body.get("text") or body.get("content") or "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="text required")
        did = str(body.get("device_id") or device_id or "").strip()
        tok = str(body.get("token") or token or "").strip()
        header_secret = (request.headers.get("x-agx-command-secret") or "").strip()
        if secret:
            if header_secret != secret and tok != secret:
                raise HTTPException(status_code=401, detail="unauthorized")
        else:
            if not did or not tok:
                raise HTTPException(status_code=401, detail="device_id and token required")
            if tokens.get(did) != tok:
                raise HTTPException(status_code=401, detail="invalid device token")

        if not did and secret:
            raise HTTPException(status_code=400, detail="device_id required in body or query")

        msg = GatewayMessage(
            message_id=str(body.get("message_id") or secrets.token_hex(8)),
            source="siri",
            sender_id="http",
            sender_name="api_command",
            content=text,
            content_type="text",
            attachments=[],
            timestamp=0.0,
            raw=body,
            device_id=did,
        )
        cid = secrets.token_hex(16)
        payload = {"type": "im_message", "correlation_id": cid, "message": msg.model_dump(mode="json")}
        if not device_manager.is_online(did):
            raise HTTPException(status_code=503, detail="device offline")
        sent = await device_manager.send_to_device(did, payload)
        if not sent:
            raise HTTPException(status_code=503, detail="device send failed")
        reply = await device_manager.wait_for_reply(cid, timeout=cfg.reply_timeout_seconds)
        if reply is None:
            raise HTTPException(status_code=504, detail="reply timeout")
        return JSONResponse({"ok": True, "reply": reply.content})

    @app.post("/api/connect/session")
    async def api_connect_session(request: Request) -> JSONResponse:
        """Create a short-lived QR connect session; requires device_id + token."""
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="invalid json")
        if not isinstance(body, dict):
            raise HTTPException(status_code=400, detail="invalid body")
        did = str(body.get("device_id") or "").strip()
        tok = str(body.get("token") or "").strip()
        _require_device_token(did, tok)
        bcode = binding_code_for_device(cfg, did)
        if not bcode:
            raise HTTPException(
                status_code=400,
                detail="gateway_config: set binding_code for this device_id under devices.auth_tokens",
            )
        sess = connect_sessions.create(did, bcode)
        base = str(request.base_url).rstrip("/")
        qr_url = f"{base}/connect/{sess.session_id}"
        out = sess.to_api_dict()
        out["qr_url"] = qr_url
        return JSONResponse(out)

    @app.get("/api/connect/session/{session_id}")
    async def api_connect_session_status(session_id: str) -> JSONResponse:
        s = connect_sessions.get(session_id)
        if s is None:
            raise HTTPException(status_code=404, detail="session not found")
        return JSONResponse(s.to_api_dict())

    @app.get("/connect/{session_id}", response_class=HTMLResponse)
    async def connect_landing(session_id: str, request: Request) -> HTMLResponse:
        s = connect_sessions.get(session_id)
        if s is None:
            return HTMLResponse(
                "<!DOCTYPE html><html><body><p>会话无效或已过期</p></body></html>",
                status_code=404,
            )
        connect_sessions.mark_scanned(session_id)
        page_url = str(request.url)
        return HTMLResponse(render_connect_page(s, page_url=page_url))

    @app.get("/api/device/{device_id}/bindings")
    async def api_list_device_bindings(
        device_id: str,
        token: str = Query(default=""),
    ) -> JSONResponse:
        _require_device_token(device_id, token)
        rows = user_map.get_bindings_for_device(device_id)
        return JSONResponse({"bindings": rows})

    @app.delete("/api/device/{device_id}/bindings")
    async def api_delete_device_binding(
        device_id: str,
        token: str = Query(default=""),
        platform: str = Query(default=""),
        sender_id: str = Query(default=""),
    ) -> JSONResponse:
        _require_device_token(device_id, token)
        plat = (platform or "").strip()
        sid = (sender_id or "").strip()
        if not plat or not sid:
            raise HTTPException(status_code=400, detail="platform and sender_id query params required")
        if user_map.get_device(plat, sid) != (device_id or "").strip():
            raise HTTPException(status_code=404, detail="binding not found")
        user_map.remove_binding(plat, sid)
        return JSONResponse({"ok": True})

    @app.websocket("/ws/device/{device_id}")
    async def ws_device(websocket: WebSocket, device_id: str) -> None:
        await websocket.accept()
        token_q = (websocket.query_params.get("token") or "").strip()
        expected = tokens.get(device_id)
        if expected and token_q != expected:
            await websocket.close(code=4401)
            return
        dm: DeviceManager = app.state.device_manager
        await dm.register(device_id, websocket)
        pending = dm.drain_pending(device_id)
        for pmsg in pending:
            cid = secrets.token_hex(16)
            await dm.send_to_device(
                device_id,
                {"type": "im_message", "correlation_id": cid, "message": pmsg.model_dump(mode="json")},
            )
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                msg_type = str(data.get("type") or "")
                if msg_type == "auth":
                    t = str(data.get("token") or "").strip()
                    if expected and t != expected:
                        await websocket.send_text(json.dumps({"type": "auth_error"}))
                        await websocket.close(code=4401)
                        return
                    await websocket.send_text(json.dumps({"type": "auth_ok"}))
                elif msg_type == "im_reply":
                    cid = str(data.get("correlation_id") or "")
                    payload = data.get("payload") or data.get("reply")
                    if cid and isinstance(payload, dict):
                        reply = GatewayReply.model_validate(payload)
                        dm.resolve_reply(cid, reply)
                elif msg_type == "im_progress":
                    pass
        except WebSocketDisconnect:
            pass
        finally:
            await dm.unregister(device_id, websocket)

    return app


def run_gateway_server(config_path: Path) -> None:
    import uvicorn

    cfg = load_gateway_config(config_path)
    app = create_gateway_app(cfg)
    uvicorn.run(
        app,
        host=cfg.server.host,
        port=cfg.server.port,
        log_level="info",
    )
