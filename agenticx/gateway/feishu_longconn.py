#!/usr/bin/env python3
"""Feishu long-connection bot runner (lark-oapi WebSocket mode).

Connects to Feishu server via persistent WebSocket — no public IP required.
Receives im.message.receive_v1 events, forwards them to the local agx serve
/api/chat endpoint, and replies with the result via Feishu OpenAPI.

Usage:
    agx feishu --app-id cli_xxx --app-secret yyy
    FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=yyy agx feishu

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)

_PORT_FILE = os.path.expanduser("~/.agenticx/serve.port")
_TOKEN_FILE = os.path.expanduser("~/.agenticx/serve.token")
_BINDING_FILE = os.path.expanduser("~/.agenticx/feishu_binding.json")
_DESKTOP_BINDING_KEY = "_desktop"


def _read_serve_info() -> tuple[str, str]:
    """Read (port, token) written by agx serve on startup.

    Returns ('', '') if not found.
    """
    port = ""
    token = ""
    try:
        raw = open(_PORT_FILE).read().strip()
        if raw.isdigit():
            port = raw
    except OSError:
        pass
    try:
        token = open(_TOKEN_FILE).read().strip()
    except OSError:
        pass
    return port, token


def _resolve_studio_base(configured: str) -> str:
    """Return studio base URL, auto-detecting port from ~/.agenticx/serve.port if needed."""
    if configured and configured != "http://127.0.0.1:8000":
        return configured
    port, _ = _read_serve_info()
    if port:
        host = "127.0.0.1"
        return f"http://{host}:{port}"
    return configured or "http://127.0.0.1:8000"


def _resolve_desktop_token(configured: str) -> str:
    """Return desktop token, falling back to ~/.agenticx/serve.token."""
    if configured:
        return configured
    _, token = _read_serve_info()
    return token


try:
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import (
        CreateMessageRequest,
        CreateMessageRequestBody,
        ReplyMessageRequest,
        ReplyMessageRequestBody,
    )
    from lark_oapi.api.im.v1.model.p2_im_message_receive_v1 import P2ImMessageReceiveV1
except ImportError:
    lark = None  # type: ignore
    P2ImMessageReceiveV1 = None  # type: ignore


# ---------------------------------------------------------------------------
# Markdown → Feishu post rich-text converter
# ---------------------------------------------------------------------------

def _md_inline_to_elements(text: str) -> List[Dict[str, Any]]:
    """Parse inline Markdown (bold, inline-code, links) into Feishu content elements."""
    elements: List[Dict[str, Any]] = []
    # Pattern order matters: code > bold/italic > link > plain
    pattern = re.compile(
        r"`([^`]+)`"                         # inline code
        r"|(\*\*\*(.+?)\*\*\*)"             # bold+italic
        r"|(\*\*(.+?)\*\*)"                 # bold
        r"|(\*(.+?)\*|_(.+?)_)"             # italic
        r"|\[([^\]]+)\]\(([^)]+)\)"         # link
    )
    last = 0
    for m in pattern.finditer(text):
        if m.start() > last:
            elements.append({"tag": "text", "text": text[last:m.start()]})
        if m.group(1) is not None:
            # inline code
            elements.append({"tag": "text", "text": m.group(1),
                              "styles": ["code_inline"]})
        elif m.group(2) is not None:
            elements.append({"tag": "text", "text": m.group(3),
                              "styles": ["bold", "italic"]})
        elif m.group(4) is not None:
            elements.append({"tag": "text", "text": m.group(5),
                              "styles": ["bold"]})
        elif m.group(6) is not None:
            content = m.group(7) or m.group(8) or ""
            elements.append({"tag": "text", "text": content,
                              "styles": ["italic"]})
        elif m.group(9) is not None:
            elements.append({"tag": "a", "text": m.group(9),
                              "href": m.group(10)})
        last = m.end()
    if last < len(text):
        elements.append({"tag": "text", "text": text[last:]})
    return elements or [{"tag": "text", "text": text}]


def md_to_feishu_post(markdown: str, title: str = "") -> Dict[str, Any]:
    """Convert Markdown text to Feishu post rich-text content dict.

    Feishu post content format:
        {
          "zh_cn": {
            "title": "...",
            "content": [[...elements...], ...]   # each inner list = one paragraph
          }
        }
    Supported Markdown:
        - # / ## / ### headings  → bold paragraph
        - **bold**, *italic*, `code`, [link](url)
        - ``` fenced code blocks → code block paragraphs
        - - / * / 1. list items  → prefixed text
        - --- horizontal rule   → divider line (text fallback)
        - blank lines           → empty paragraph separator
    """
    lines = markdown.splitlines()
    paragraphs: List[List[Dict[str, Any]]] = []
    i = 0
    while i < len(lines):
        line = lines[i]

        # Fenced code block
        if line.strip().startswith("```"):
            lang = line.strip()[3:].strip()
            code_lines: List[str] = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```
            code_text = "\n".join(code_lines)
            if code_text:
                # Feishu code_block tag (only available in some versions; fallback to text)
                para: List[Dict[str, Any]] = [
                    {"tag": "text", "text": f"[{lang}]\n" if lang else ""},
                    {"tag": "text", "text": code_text, "styles": ["code_inline"]},
                ]
                paragraphs.append([e for e in para if e.get("text")])
            continue

        # Horizontal rule
        if re.match(r"^-{3,}$|^\*{3,}$|^_{3,}$", line.strip()):
            paragraphs.append([{"tag": "text", "text": "─" * 20}])
            i += 1
            continue

        # Heading  # / ## / ###
        m = re.match(r"^(#{1,3})\s+(.*)", line)
        if m:
            heading_text = m.group(2).strip()
            paragraphs.append([{"tag": "text", "text": heading_text,
                                 "styles": ["bold"]}])
            i += 1
            continue

        # Unordered list item
        m = re.match(r"^[\-\*\+]\s+(.*)", line)
        if m:
            item_text = m.group(1)
            row = [{"tag": "text", "text": "• "}] + _md_inline_to_elements(item_text)
            paragraphs.append(row)
            i += 1
            continue

        # Ordered list item
        m = re.match(r"^\d+\.\s+(.*)", line)
        if m:
            item_text = m.group(1)
            num = re.match(r"^(\d+)\.", line).group(1)  # type: ignore[union-attr]
            row = [{"tag": "text", "text": f"{num}. "}] + _md_inline_to_elements(item_text)
            paragraphs.append(row)
            i += 1
            continue

        # Blank line → keep as separator (empty paragraph)
        if line.strip() == "":
            if paragraphs and paragraphs[-1]:
                paragraphs.append([])
            i += 1
            continue

        # Normal paragraph line
        paragraphs.append(_md_inline_to_elements(line))
        i += 1

    # Remove trailing empty paragraphs
    while paragraphs and not paragraphs[-1]:
        paragraphs.pop()

    # Feishu requires at least one non-empty paragraph
    if not paragraphs:
        paragraphs = [[{"tag": "text", "text": markdown[:4000]}]]

    return {
        "zh_cn": {
            "title": title,
            "content": paragraphs,
        }
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _session_id(app_id: str, sender_open_id: str) -> str:
    raw = f"feishu-lc:{app_id}:{sender_open_id}".encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()[:20]
    return f"im-feishu-lc-{digest}"


def _is_new_chat(text: str) -> bool:
    t = text.strip().lower()
    return t in ("新对话", "new chat", "/new", "/reset", "重置", "清空上下文")


def _is_status(text: str) -> bool:
    t = text.strip().lower()
    return t in ("状态", "status", "/status", "/ping", "ping")


# ---------------------------------------------------------------------------
# Feishu ↔ Machi session binding (shared with Desktop via JSON file)
# ---------------------------------------------------------------------------

def _read_bindings_file() -> Dict[str, Any]:
    try:
        with open(_BINDING_FILE, encoding="utf-8") as f:
            raw = json.load(f)
            return raw if isinstance(raw, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _write_bindings_file(data: Dict[str, Any]) -> None:
    parent = os.path.dirname(_BINDING_FILE)
    if parent:
        os.makedirs(parent, mode=0o700, exist_ok=True)
    tmp = _BINDING_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, _BINDING_FILE)


def _resolve_binding_for_sender(_open_id: str) -> Optional[Dict[str, Any]]:
    """Return the global desktop binding.

    The desktop integration uses a single global binding key (`_desktop`) as the
    source of truth, so Feishu routing and Desktop badge always point to the same
    session at any given time.
    """
    data = _read_bindings_file()
    desk = data.get(_DESKTOP_BINDING_KEY)
    if isinstance(desk, dict):
        sid = str(desk.get("session_id") or "").strip()
        if sid:
            return {
                "session_id": sid,
                "avatar_id": (str(desk.get("avatar_id") or "").strip() or None),
                "avatar_name": (str(desk.get("avatar_name") or "").strip() or None),
            }
    return None


def _write_binding_key(key: str, binding: Dict[str, Any]) -> None:
    data = _read_bindings_file()
    binding = dict(binding)
    binding["bound_at"] = datetime.now(timezone.utc).isoformat()
    data[key] = binding
    _write_bindings_file(data)


def _clear_binding_key(key: str) -> None:
    data = _read_bindings_file()
    if key in data:
        del data[key]
        _write_bindings_file(data)


_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


def _parse_feishu_command(text: str) -> Optional[Tuple[str, Optional[str]]]:
    """Return (command, arg) or None.

    Commands:
      unbind       — /unbind
      sessions     — /sessions
      bind_avatar  — /bind <name> or /bind @<name>  (non-UUID arg → try avatar name first)
      bind_session — /bind <uuid>                   (UUID arg → exact session_id match)
      bind_help    — /bind  (no arg)
    """
    t = text.strip()
    low = t.lower()
    if low == "/unbind":
        return ("unbind", None)
    if low == "/sessions":
        return ("sessions", None)
    # /bind @分身名 or /bind 分身名 or /bind <session_uuid>
    m = re.match(r"(?i)^/bind\s+@(.+)$", t)
    if m:
        return ("bind_avatar", m.group(1).strip())
    m = re.match(r"(?i)^/bind\s+(.+)$", t)
    if m:
        arg = m.group(1).strip()
        # If arg looks like a UUID → treat as session_id
        if _UUID_RE.match(arg):
            return ("bind_session", arg)
        # Otherwise treat as avatar display name (case-insensitive fuzzy match)
        return ("bind_avatar", arg)
    if re.match(r"(?i)^/bind\s*$", t):
        return ("bind_help", None)
    return None


# ---------------------------------------------------------------------------
# Local agx serve calls
# ---------------------------------------------------------------------------

def _no_proxy_client(**kwargs: Any) -> httpx.AsyncClient:
    """Build an AsyncClient that bypasses all system proxies (http_proxy / all_proxy etc).

    Passing an explicit AsyncHTTPTransport instance prevents httpx from reading
    proxy environment variables (http_proxy / all_proxy / SOCKS etc).
    """
    transport = httpx.AsyncHTTPTransport()
    return httpx.AsyncClient(transport=transport, **kwargs)


async def _delete_session(studio_base: str, session_id: str,
                           headers: Dict[str, str]) -> None:
    async with _no_proxy_client(timeout=30.0) as client:
        try:
            await client.delete(
                f"{studio_base}/api/session",
                params={"session_id": session_id},
                headers=headers,
            )
        except Exception as exc:
            logger.warning("delete session failed: %s", exc)


async def _bootstrap_session(
    studio_base: str,
    session_id: str,
    headers: Dict[str, str],
    avatar_id: Optional[str] = None,
) -> str:
    """GET /api/session to ensure session exists; pass avatar_id when session is avatar-bound.

    Returns the actual session_id from the response (may differ from input when creating new).
    """
    timeout = httpx.Timeout(60.0, connect=30.0)
    params: Dict[str, str] = {}
    sid = (session_id or "").strip()
    if sid:
        params["session_id"] = sid
    aid = (avatar_id or "").strip()
    if aid:
        params["avatar_id"] = aid
    async with _no_proxy_client(timeout=timeout) as client:
        r = await client.get(
            f"{studio_base}/api/session",
            params=params,
            headers=headers,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"session bootstrap failed: {r.status_code} {r.text[:200]}")
        try:
            data = r.json()
            actual_sid = str(data.get("session_id") or "").strip()
            return actual_sid if actual_sid else sid
        except Exception:
            return sid


async def _list_sessions_api(
    studio_base: str, headers: Dict[str, str], avatar_id: Optional[str] = None
) -> List[Dict[str, Any]]:
    async with _no_proxy_client(timeout=30.0) as client:
        params: Dict[str, str] = {}
        if avatar_id:
            params["avatar_id"] = avatar_id
        r = await client.get(
            f"{studio_base}/api/sessions",
            params=params or None,
            headers=headers,
        )
        if r.status_code >= 400:
            raise RuntimeError(f"list sessions failed: {r.status_code} {r.text[:200]}")
        data = r.json()
        sessions = data.get("sessions") if isinstance(data, dict) else None
        return sessions if isinstance(sessions, list) else []


async def _list_avatars_api(studio_base: str, headers: Dict[str, str]) -> List[Dict[str, Any]]:
    async with _no_proxy_client(timeout=30.0) as client:
        r = await client.get(f"{studio_base}/api/avatars", headers=headers)
        if r.status_code >= 400:
            raise RuntimeError(f"list avatars failed: {r.status_code} {r.text[:200]}")
        data = r.json()
        avatars = data.get("avatars") if isinstance(data, dict) else None
        return avatars if isinstance(avatars, list) else []


async def _feishu_cmd_reply(
    studio_base: str,
    headers: Dict[str, str],
    open_id: str,
    cmd: str,
    arg: Optional[str],
) -> str:
    """Handle /bind /unbind /sessions; returns text for Feishu."""
    if cmd == "bind_help":
        return (
            "**飞书绑定 Machi 会话**\n\n"
            "• `/bind 分身名` — 绑定到该分身最近的会话（如 `/bind cole`）\n"
            "• `/bind <session_uuid>` — 绑定到指定会话（从 `/sessions` 复制 id）\n"
            "• `/unbind` — 取消绑定，恢复默认 im 会话\n"
            "• `/sessions` — 列出近期会话\n\n"
            "也可在 Machi 客户端当前窗格点「绑定飞书」按钮。"
        )
    if cmd == "unbind":
        if not open_id:
            return "无法识别飞书用户身份，请使用机器人**单聊**发送 `/unbind`。"
        _clear_binding_key(open_id)
        _clear_binding_key(_DESKTOP_BINDING_KEY)
        return "已取消飞书账号的会话绑定。后续消息将使用默认 Machi 会话。"

    if cmd == "sessions":
        try:
            rows = await _list_sessions_api(studio_base, headers, avatar_id=None)
        except Exception as exc:
            return f"拉取会话列表失败：{exc}"
        lines = ["**近期会话**（复制 session_id 用于 `/bind`）\n"]
        for row in rows[:25]:
            sid = str(row.get("session_id") or "")
            aname = str(row.get("avatar_name") or row.get("avatar_id") or "Meta")
            sname = str(row.get("session_name") or "")[:40]
            title = f"{sname}" if sname else "(无标题)"
            lines.append(f"• `{sid}` — {aname} / {title}")
        if len(rows) > 25:
            lines.append(f"\n…共 {len(rows)} 条，仅显示前 25 条")
        if not rows:
            lines.append("（暂无会话）")
        return "\n".join(lines)

    if cmd == "bind_session" and arg:
        try:
            rows = await _list_sessions_api(studio_base, headers, avatar_id=None)
        except Exception as exc:
            return f"验证会话失败：{exc}"
        match = None
        for row in rows:
            if str(row.get("session_id") or "") == arg:
                match = row
                break
        if not match:
            return f"未找到会话 `{arg}`。先发 `/sessions` 查看有效 id。"
        sid = str(match.get("session_id") or "")
        aid = match.get("avatar_id")
        aid_s = str(aid).strip() if aid else ""
        aname = str(match.get("avatar_name") or "").strip() or None
        try:
            _ = await _bootstrap_session(studio_base, sid, headers,
                                         avatar_id=aid_s or None)
        except Exception as exc:
            return f"无法打开该会话：{exc}"
        if not open_id:
            return (
                "会话已验证，但当前消息缺少飞书用户标识，绑定未保存。"
                "请使用机器人**单聊**发送 `/bind`。"
            )
        binding_payload = {
            "session_id": sid,
            "avatar_id": aid_s or None,
            "avatar_name": aname,
        }
        _write_binding_key(open_id, binding_payload)
        _write_binding_key(_DESKTOP_BINDING_KEY, binding_payload)
        return (
            f"已绑定到会话 `{sid}`"
            + (f"（分身：{aname or aid_s}）" if (aname or aid_s) else "（Meta）")
        )

    if cmd == "bind_avatar" and arg:
        name_query = arg.strip().lstrip("@")
        try:
            avatars = await _list_avatars_api(studio_base, headers)
        except Exception as exc:
            return f"拉取分身列表失败：{exc}"
        found: Optional[Dict[str, Any]] = None
        nq_lower = name_query.lower()
        for a in avatars:
            disp = str(a.get("name") or a.get("display_name") or "")
            aid = str(a.get("id") or a.get("avatar_id") or "")
            if disp.lower() == nq_lower or aid.lower() == nq_lower:
                found = a
                break
        if not found:
            for a in avatars:
                disp = str(a.get("name") or a.get("display_name") or "")
                aid = str(a.get("id") or a.get("avatar_id") or "")
                if nq_lower in disp.lower() or nq_lower in aid.lower():
                    found = a
                    break
        if not found:
            return f"未找到名为「{name_query}」的分身。检查 Machi 里的分身显示名。"
        avatar_id = str(found.get("id") or found.get("avatar_id") or "").strip()
        avatar_name = str(found.get("name") or found.get("display_name") or "").strip()
        if not avatar_id:
            return "分身数据缺少 id，无法绑定。"
        try:
            rows = await _list_sessions_api(studio_base, headers, avatar_id=avatar_id)
        except Exception as exc:
            return f"拉取该分身会话失败：{exc}"

        sid = str(rows[0].get("session_id") or "").strip() if rows else ""

        try:
            # If no existing session, pass empty sid so backend auto-creates one
            actual_sid = await _bootstrap_session(studio_base, sid, headers, avatar_id=avatar_id)
            if actual_sid:
                sid = actual_sid
        except Exception as exc:
            return f"无法打开该会话：{exc}"

        if not sid:
            return "会话创建失败，请重试。"
        if not open_id:
            return (
                "会话已验证，但当前消息缺少飞书用户标识，绑定未保存。"
                "请使用机器人**单聊**发送 `/bind`。"
            )
        binding_payload = {
            "session_id": sid,
            "avatar_id": avatar_id,
            "avatar_name": avatar_name or None,
        }
        _write_binding_key(open_id, binding_payload)
        _write_binding_key(_DESKTOP_BINDING_KEY, binding_payload)
        return (
            f"已绑定到分身「{avatar_name}」的最近会话：\n`{sid}`"
        )

    return "未知指令。"


async def _chat_turn(
    studio_base: str,
    session_id: str,
    text: str,
    sender_name: str,
    headers: Dict[str, str],
    avatar_id: Optional[str] = None,
) -> Tuple[str, str]:
    """Send one message to local agx serve and collect the final reply."""
    timeout = httpx.Timeout(600.0, connect=30.0)
    async with _no_proxy_client(timeout=timeout) as client:
        actual_sid = await _bootstrap_session(
            studio_base, session_id, headers, avatar_id=avatar_id
        )
        target_sid = (actual_sid or session_id or "").strip()

        body = {
            "session_id": target_sid,
            "user_input": text,
            "user_display_name": sender_name,
        }
        final_text = ""
        confirmed_request_ids: set[str] = set()
        async with client.stream(
            "POST",
            f"{studio_base}/api/chat",
            headers=headers,
            json=body,
        ) as stream:
            if stream.status_code >= 400:
                err = (await stream.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"chat failed: {stream.status_code} {err[:300]}")
            buf = ""
            async for chunk in stream.aiter_text():
                buf += chunk
                while "\n\n" in buf:
                    line, buf = buf.split("\n\n", 1)
                    for part in line.split("\n"):
                        if not part.startswith("data: "):
                            continue
                        try:
                            evt = json.loads(part[6:])
                        except json.JSONDecodeError:
                            continue
                        et = str(evt.get("type") or "")
                        data = evt.get("data") if isinstance(evt.get("data"), dict) else {}
                        if et == "token":
                            final_text += str(data.get("text") or "")
                        elif et == "final":
                            t = str(data.get("text") or "")
                            if t:
                                final_text = t
                        elif et == "confirm_required":
                            request_id = str(data.get("id") or data.get("request_id") or "").strip()
                            if not request_id:
                                continue
                            if request_id in confirmed_request_ids:
                                continue
                            confirm_agent_id = str(data.get("agent_id") or "meta").strip() or "meta"
                            confirm_resp = await client.post(
                                f"{studio_base}/api/confirm",
                                headers=headers,
                                json={
                                    "session_id": target_sid,
                                    "request_id": request_id,
                                    "approved": True,
                                    "agent_id": confirm_agent_id,
                                },
                            )
                            if confirm_resp.status_code >= 400:
                                err = confirm_resp.text[:200]
                                raise RuntimeError(
                                    "confirm submit failed: "
                                    f"{confirm_resp.status_code} {err}"
                                )
                            confirmed_request_ids.add(request_id)
                        elif et == "error":
                            raise RuntimeError(str(data.get("text") or "chat error"))
    return final_text.strip() or "（无文本回复）", target_sid


# ---------------------------------------------------------------------------
# Feishu OpenAPI reply
# ---------------------------------------------------------------------------

async def _send_reply(
    lark_client: Any,
    receive_id: str,
    receive_id_type: str,
    text: str,
    message_id: Optional[str] = None,
) -> None:
    """Reply via Feishu OpenAPI using post (rich-text) format for Markdown rendering."""
    post_content = md_to_feishu_post(text[:4000])
    content = json.dumps(post_content, ensure_ascii=False)
    msg_type = "post"
    loop = asyncio.get_event_loop()
    try:
        if message_id:
            req = (
                ReplyMessageRequest.builder()
                .message_id(message_id)
                .request_body(
                    ReplyMessageRequestBody.builder()
                    .content(content)
                    .msg_type(msg_type)
                    .build()
                )
                .build()
            )
            resp = await loop.run_in_executor(
                None, lambda: lark_client.im.v1.message.reply(req)
            )
        else:
            req = (
                CreateMessageRequest.builder()
                .receive_id_type(receive_id_type)
                .request_body(
                    CreateMessageRequestBody.builder()
                    .receive_id(receive_id)
                    .content(content)
                    .msg_type(msg_type)
                    .build()
                )
                .build()
            )
            resp = await loop.run_in_executor(
                None, lambda: lark_client.im.v1.message.create(req)
            )
        if not resp.success():
            logger.warning("Feishu send failed code=%s msg=%s", resp.code, resp.msg)
            # fallback to plain text if post fails
            fallback = json.dumps({"text": text[:4000]}, ensure_ascii=False)
            await _send_plain_text(lark_client, receive_id, receive_id_type,
                                   fallback, message_id, loop)
    except Exception as exc:
        logger.warning("Feishu send error: %s", exc)


async def _send_plain_text(
    lark_client: Any,
    receive_id: str,
    receive_id_type: str,
    content: str,
    message_id: Optional[str],
    loop: Any,
) -> None:
    """Fallback: send plain text message."""
    try:
        if message_id:
            req = (
                ReplyMessageRequest.builder()
                .message_id(message_id)
                .request_body(
                    ReplyMessageRequestBody.builder()
                    .content(content)
                    .msg_type("text")
                    .build()
                )
                .build()
            )
            await loop.run_in_executor(None, lambda: lark_client.im.v1.message.reply(req))
        else:
            req = (
                CreateMessageRequest.builder()
                .receive_id_type(receive_id_type)
                .request_body(
                    CreateMessageRequestBody.builder()
                    .receive_id(receive_id)
                    .content(content)
                    .msg_type("text")
                    .build()
                )
                .build()
            )
            await loop.run_in_executor(None, lambda: lark_client.im.v1.message.create(req))
    except Exception as exc:
        logger.warning("Feishu fallback send error: %s", exc)


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

class FeishuLongConnRunner:
    """Runs a Feishu bot via long-connection WebSocket (lark-oapi SDK)."""

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        studio_base_url: str = "http://127.0.0.1:8000",
        desktop_token: str = "",
        log_level: str = "INFO",
    ) -> None:
        if lark is None:
            raise ImportError("lark-oapi is required: pip install lark-oapi")
        self._app_id = app_id
        self._app_secret = app_secret
        self._studio_base = _resolve_studio_base(studio_base_url.rstrip("/"))
        self._desktop_token = _resolve_desktop_token(desktop_token)
        self._log_level = log_level
        self._sem = asyncio.Semaphore(3)

        self._lark_client = (
            lark.Client.builder()
            .app_id(app_id)
            .app_secret(app_secret)
            .log_level(
                lark.LogLevel.DEBUG if log_level == "DEBUG" else lark.LogLevel.INFO
            )
            .build()
        )

    def _headers(self) -> Dict[str, str]:
        h: Dict[str, str] = {}
        if self._desktop_token:
            h["x-agx-desktop-token"] = self._desktop_token
        return h

    def _build_event_handler(self) -> Any:
        # verification_token is only needed for HTTP callback mode; pass empty for long-conn.
        dispatcher = (
            lark.EventDispatcherHandler.builder("", "")
            .register_p2_im_message_receive_v1(self._on_message_sync)
            .build()
        )
        return dispatcher

    def _on_message_sync(self, data: P2ImMessageReceiveV1) -> None:
        """Sync callback called by lark-oapi; spawn async task."""
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.create_task(self._handle(data))
            else:
                loop.run_until_complete(self._handle(data))
        except RuntimeError:
            # No event loop in this thread — create one
            asyncio.run(self._handle(data))

    async def _handle(self, data: P2ImMessageReceiveV1) -> None:
        async with self._sem:
            try:
                await self._process(data)
            except Exception as exc:
                logger.exception("handle error: %s", exc)

    async def _process(self, data: P2ImMessageReceiveV1) -> None:
        event = data.event
        if event is None:
            return

        message = event.message
        sender = event.sender
        if message is None:
            return

        # Only handle text messages
        msg_type = str(message.message_type or "")
        if msg_type != "text":
            logger.debug("Skipping message_type=%s", msg_type)
            return

        # Extract text content
        content_raw = message.content or "{}"
        try:
            text = str(json.loads(content_raw).get("text", "")).strip()
        except (json.JSONDecodeError, AttributeError):
            text = content_raw.strip()

        if not text:
            return

        # Extract sender open_id
        open_id = ""
        if sender and sender.sender_id:
            open_id = str(sender.sender_id.open_id or "")

        chat_id = str(message.chat_id or "")
        message_id = str(message.message_id or "")
        sender_name = open_id

        logger.info("Feishu msg from=%s chat=%s text=%s", open_id, chat_id, text[:80])

        headers = self._headers()
        default_sid = _session_id(self._app_id, open_id)
        binding = _resolve_binding_for_sender(open_id)
        effective_sid = binding["session_id"] if binding else default_sid
        effective_avatar = binding.get("avatar_id") if binding else None

        cmd = _parse_feishu_command(text)
        if cmd is not None:
            cname, carg = cmd
            try:
                reply = await _feishu_cmd_reply(
                    self._studio_base, headers, open_id, cname, carg
                )
            except Exception as exc:
                logger.exception("feishu command failed: %s", exc)
                reply = f"[Machi] 指令执行出错：{exc}"
        elif _is_new_chat(text):
            await _delete_session(self._studio_base, effective_sid, headers)
            reply = "已开始新对话。"
        elif _is_status(text):
            reply = "Machi 在线，飞书长连接正常。"
            if binding:
                an = binding.get("avatar_name") or binding.get("avatar_id") or ""
                reply += f"\n当前绑定会话：`{effective_sid}`"
                if an:
                    reply += f"（{an}）"
        else:
            try:
                reply, used_sid = await _chat_turn(
                    self._studio_base,
                    effective_sid,
                    text,
                    sender_name,
                    headers,
                    avatar_id=effective_avatar,
                )
                if binding and used_sid and used_sid != effective_sid:
                    try:
                        rebound_payload = {
                            "session_id": used_sid,
                            "avatar_id": effective_avatar,
                            "avatar_name": binding.get("avatar_name"),
                        }
                        if open_id:
                            _write_binding_key(open_id, rebound_payload)
                        _write_binding_key(_DESKTOP_BINDING_KEY, rebound_payload)
                    except Exception as bind_exc:
                        logger.warning("feishu binding rebound failed: %s", bind_exc)
            except Exception as exc:
                logger.exception("chat_turn failed: %s", exc)
                reply = f"[Machi] 执行出错：{exc}"

        # Prefer reply-in-thread; for group chats use chat_id
        receive_id = open_id
        receive_id_type = "open_id"
        if chat_id and chat_id.startswith("oc_"):
            receive_id = chat_id
            receive_id_type = "chat_id"

        await _send_reply(
            self._lark_client,
            receive_id=receive_id,
            receive_id_type=receive_id_type,
            text=reply,
            message_id=message_id or None,
        )

    def run(self) -> None:
        """Start the Feishu long-connection listener (blocking)."""
        if lark is None:
            raise ImportError("lark-oapi is required: pip install lark-oapi")

        logger.info(
            "Feishu long-connection starting | app_id=%s studio=%s",
            self._app_id,
            self._studio_base,
        )

        ws_client = lark.ws.Client(
            self._app_id,
            self._app_secret,
            event_handler=self._build_event_handler(),
            log_level=(
                lark.LogLevel.DEBUG if self._log_level == "DEBUG" else lark.LogLevel.INFO
            ),
        )
        ws_client.start()
