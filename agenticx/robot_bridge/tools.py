#!/usr/bin/env python3
"""Studio tools that drive a robot policy session through the local robot bridge.

The agent only sends task-level commands (start / change task / reset / stop /
status / snapshot); the real-time control loop stays inside the bridge process.

Author: Hongyi Zhao
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agenticx.cli.config_manager import ConfigManager, RobotSettings

from .client import RobotBridgeClient, RobotBridgeError, resolve_client

_log = logging.getLogger(__name__)

_POLL_INTERVAL_S = 1.0
_START_WAIT_S = 15.0
_RESET_CHECK_WAIT_S = 10.0
_TRACEBACK_TAIL_LINES = 20
_NOT_HOME_WARNING = "机器人可能未回到初始位姿，请人工检查"


def _tool(
    name: str, description: str, properties: dict[str, Any], required: list[str]
) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


_SESSION_ID = {"type": "string", "description": "robot_rollout_start 返回的 session_id"}

ROBOT_TOOLS: list[dict[str, Any]] = [
    _tool(
        "robot_rollout_start",
        "在本机机器人上启动一个策略会话：加载策略、连接机器人并开始运行。启动前会请用户确认。"
        "实时控制由本机桥接服务负责，这里只下发任务级指令；结束时务必调用 robot_stop。",
        {
            "profile": {
                "type": "string",
                "description": "配置 robot.profiles 中的机器人别名",
            },
            "task": {"type": "string", "description": "交给策略的自然语言任务"},
            "policy_path": {
                "type": "string",
                "description": "可选，策略路径（本地目录或模型仓库 id），缺省用 profile 的默认策略",
            },
            "duration_s": {
                "type": "number",
                "description": "可选，每段运行秒数，0 表示不限",
            },
        },
        ["profile", "task"],
    ),
    _tool(
        "robot_set_task",
        "修改机器人会话的当前任务，下一次推理生效。",
        {
            "session_id": _SESSION_ID,
            "task": {"type": "string", "description": "新的自然语言任务"},
        },
        ["session_id", "task"],
    ),
    _tool(
        "robot_reset",
        "让机器人停止当前动作、回到初始位姿并恢复初始任务，返回回位校验结果。",
        {"session_id": _SESSION_ID},
        ["session_id"],
    ),
    _tool(
        "robot_stop",
        "停止机器人会话：停止运动、回到初始位姿、校验位姿并断开硬件。任何时候都可以直接调用，无需确认。",
        {"session_id": _SESSION_ID},
        ["session_id"],
    ),
    _tool(
        "robot_status",
        "查看机器人会话的状态、当前任务、事件与最近一次回位校验结果。",
        {
            "session_id": _SESSION_ID,
            "since": {"type": "integer", "description": "可选，只返回该序号之后的事件"},
        },
        ["session_id"],
    ),
    _tool(
        "robot_snapshot",
        "拍一张机器人相机快照，图片会自动附加到下一轮供你查看现场。",
        {
            "session_id": _SESSION_ID,
            "camera": {
                "type": "string",
                "description": "可选，相机名，缺省用第一个相机",
            },
        },
        ["session_id"],
    ),
]

ROBOT_TOOL_NAMES: frozenset[str] = frozenset(
    spec["function"]["name"] for spec in ROBOT_TOOLS
)


def robot_config_enabled() -> bool:
    """True when ``~/.agenticx/config.yaml`` has ``robot.enabled: true``."""
    try:
        return bool(ConfigManager.load().robot.enabled)
    except Exception:  # noqa: BLE001
        return False


def merge_robot_tools_into(tool_list: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Append robot tool specs when enabled; dedupe by function name."""
    if not robot_config_enabled():
        return tool_list
    seen: set[str] = set()
    for t in tool_list:
        if not isinstance(t, dict):
            continue
        fn = t.get("function", {})
        if isinstance(fn, dict):
            n = str(fn.get("name", "") or "").strip()
            if n:
                seen.add(n)
    out = list(tool_list)
    for spec in ROBOT_TOOLS:
        name = spec["function"]["name"]
        if name in seen:
            continue
        out.append(spec)
        seen.add(name)
    return out


# ---------------------------------------------------------------------- helpers


@dataclass
class _Call:
    settings: RobotSettings
    session: Any
    confirm_gate: Any
    emit_event: Any


def _ok(**fields: Any) -> str:
    return json.dumps({"ok": True, **fields}, ensure_ascii=False)


def _fail(code: str, error: str, hint: str = "", **extra: Any) -> str:
    return json.dumps(
        {"ok": False, "error_code": code, "error": error, "hint": hint, **extra},
        ensure_ascii=False,
    )


def _text(args: dict[str, Any], key: str) -> str:
    return str(args.get(key) or "").strip()


def _traceback_tail(text: Any) -> str | None:
    if not text:
        return None
    return "\n".join(str(text).splitlines()[-_TRACEBACK_TAIL_LINES:])


async def _ask(call: _Call, question: str, context: dict[str, Any]) -> bool:
    from agenticx.cli.agent_tools import _confirm

    return await _confirm(
        question,
        confirm_gate=call.confirm_gate,
        emit_event=call.emit_event,
        session=call.session,
        context=context,
    )


def _cancelled_text(what: str, call: _Call) -> str:
    from agenticx.cli.agent_tools import _cancelled

    return _cancelled(what, call.confirm_gate)


async def _wait_state(
    client: RobotBridgeClient, sid: str, targets: set[str], timeout_s: float
) -> dict[str, Any] | None:
    """Poll until the session reaches one of ``targets``; None on timeout."""
    deadline = time.monotonic() + timeout_s
    since = 0
    while True:
        st = await client.get_session(sid, since)
        if st.get("state") in targets:
            return st
        since = int(st.get("last_seq") or since)
        if time.monotonic() >= deadline:
            return None
        await asyncio.sleep(_POLL_INTERVAL_S)


async def _wait_pose_check(
    client: RobotBridgeClient, sid: str, context: str, since: int, timeout_s: float
) -> dict[str, Any] | None:
    """Wait for a new ``pose_check`` event; the status field alone may still hold an older result."""
    deadline = time.monotonic() + timeout_s
    while True:
        st = await client.get_session(sid, since)
        for event in st.get("events") or []:
            detail = event.get("detail") if isinstance(event, dict) else None
            if (
                event.get("type") == "pose_check"
                and isinstance(detail, dict)
                and detail.get("context") == context
            ):
                return detail
        since = int(st.get("last_seq") or since)
        if time.monotonic() >= deadline:
            return None
        await asyncio.sleep(_POLL_INTERVAL_S)


async def _best_effort_stop(
    client: RobotBridgeClient, sid: str, settings: RobotSettings
) -> None:
    try:
        await client.stop(sid, timeout_s=settings.stop_timeout_s)
    except Exception:  # noqa: BLE001 - cleanup path; must not mask the original outcome
        _log.warning("best-effort stop of robot session %s failed", sid, exc_info=True)


def _session_failure(st: dict[str, Any], sid: str) -> str:
    return _fail(
        str(st.get("error_code") or "robot_session_failed"),
        str(st.get("error") or "机器人会话失败"),
        str(st.get("hint") or ""),
        session_id=sid,
        failure_traceback_tail=_traceback_tail(st.get("failure_traceback")),
    )


# ---------------------------------------------------------------------- tools


async def _rollout_start(args: dict[str, Any], call: _Call) -> str:
    settings = call.settings
    profile_name = _text(args, "profile")
    profile = settings.profiles.get(profile_name)
    if profile is None:
        names = ", ".join(sorted(settings.profiles)) or "（无）"
        return _fail(
            "robot_unknown_profile",
            f"未找到机器人配置「{profile_name}」",
            f"可用 profile：{names}（在 ~/.agenticx/config.yaml 的 robot.profiles 中配置）",
        )
    task = _text(args, "task")
    if not task:
        return _fail("robot_invalid_args", "task 不能为空")
    policy_path = (
        _text(args, "policy_path") or str(profile.get("policy_path") or "").strip()
    )
    if not policy_path:
        return _fail(
            "robot_policy_required",
            "未指定策略",
            "传入 policy_path，或在 profile 中配置 policy_path",
        )
    mrt_raw = profile.get("max_relative_target", settings.default_max_relative_target)
    if mrt_raw is None:
        return _fail(
            "max_relative_target_required",
            "未配置单步限幅 max_relative_target",
            "在 profile 或 robot.default_max_relative_target 中设置",
        )
    try:
        mrt = float(mrt_raw)
    except (TypeError, ValueError):
        return _fail(
            "robot_invalid_args", f"max_relative_target 必须是数字，收到 {mrt_raw!r}"
        )
    if mrt <= 0:
        return _fail(
            "robot_invalid_args", f"max_relative_target 必须大于 0，收到 {mrt}"
        )
    try:
        duration_s = float(args.get("duration_s") or 0)
    except (TypeError, ValueError):
        return _fail(
            "robot_invalid_args",
            f"duration_s 必须是数字，收到 {args.get('duration_s')!r}",
        )
    if duration_s < 0:
        return _fail("robot_invalid_args", "duration_s 不能为负数")
    client = resolve_client(settings)

    robot_type = str(profile["type"]).strip()
    question = (
        f"将在机器人「{profile_name}」（{robot_type}）上启动策略 {policy_path}，任务：「{task}」。"
        f"启动后机器人会开始运动（单步限幅 {mrt}）。请确认急停可及、工作区内无人，是否继续？"
    )
    context = {
        "tool": "robot_rollout_start",
        "risk": "robot",
        "profile": profile_name,
        "policy_path": policy_path,
        "task": task,
        "max_relative_target": mrt,
    }
    if not await _ask(call, question, context):
        return _cancelled_text("机器人未启动", call)

    robot: dict[str, Any] = {"type": robot_type, "max_relative_target": mrt}
    for key in ("port", "id", "cameras", "extra"):
        if profile.get(key) not in (None, "", {}):
            robot[key] = profile[key]
    body = {
        "robot": robot,
        "policy_path": policy_path,
        "task": task,
        "duration_s": duration_s,
        "home_tolerance": settings.home_tolerance,
        "offline_backbone": settings.offline_backbone,
    }
    created = await client.create_session(body)
    sid = str(created.get("session_id") or "")
    if not sid:
        return _fail("bridge_bad_response", "机器人桥接服务没有返回 session_id")
    try:
        return await _load_and_start(client, sid, settings)
    except RobotBridgeError as exc:
        return _fail(exc.code, exc.message, exc.hint, session_id=sid)


async def _load_and_start(
    client: RobotBridgeClient, sid: str, settings: RobotSettings
) -> str:
    try:
        st = await _wait_state(
            client, sid, {"idle", "failed", "stopped"}, settings.load_timeout_s
        )
    except BaseException:
        # Cancelled or lost the bridge mid-load: do not leave a session holding the hardware.
        await _best_effort_stop(client, sid, settings)
        raise
    if st is None:
        await _best_effort_stop(client, sid, settings)
        return _fail(
            "robot_load_timeout",
            f"策略加载超过 {settings.load_timeout_s:.0f}s 仍未完成，已停止该会话",
            "首次加载较慢时可调大 robot.load_timeout_s",
            session_id=sid,
        )
    if st.get("state") == "failed":
        return _session_failure(st, sid)
    if st.get("state") == "stopped":
        return _fail("robot_session_stopped", "会话在加载期间已被停止", session_id=sid)

    started = await client.start(sid)
    if not started.get("accepted"):
        return _fail(
            "robot_start_rejected",
            "机器人会话拒绝开始运行",
            "用 robot_status 查看状态，或 robot_stop 释放机器人",
            session_id=sid,
        )
    st = await _wait_state(
        client, sid, {"running", "failed"}, _START_WAIT_S
    ) or await client.get_session(sid)
    if st.get("state") == "failed":
        return _session_failure(st, sid)
    return _ok(
        session_id=sid,
        state=st.get("state"),
        task=st.get("task"),
        cameras=st.get("cameras") or [],
        supports_text_queries=st.get("supports_text_queries"),
        next="用 robot_status 查看进度，用 robot_snapshot 看现场（图片自动附到下一轮）；结束务必 robot_stop",
    )


async def _set_task(args: dict[str, Any], call: _Call) -> str:
    sid = _text(args, "session_id")
    task = _text(args, "task")
    if not sid or not task:
        return _fail("robot_invalid_args", "session_id 与 task 都不能为空")
    client = resolve_client(call.settings)
    if call.settings.confirm_each_task:
        question = f"将把机器人当前任务改为「{task}」（下一次推理生效，机器人动作可能随之改变），是否继续？"
        context = {
            "tool": "robot_set_task",
            "risk": "robot",
            "session_id": sid,
            "task": task,
        }
        if not await _ask(call, question, context):
            return _cancelled_text("机器人任务未修改", call)
    result = await client.set_task(sid, task)
    return _ok(
        changed=bool(result.get("changed")),
        task=result.get("task", task),
        note="若当前策略不读取语言指令，改任务不会改变动作",
    )


async def _reset(args: dict[str, Any], call: _Call) -> str:
    sid = _text(args, "session_id")
    if not sid:
        return _fail("robot_invalid_args", "session_id 不能为空")
    client = resolve_client(call.settings)
    if call.settings.confirm_each_task:
        question = "将让机器人停止当前动作并回到初始位姿（会运动约 3 秒），是否继续？"
        context = {"tool": "robot_reset", "risk": "robot", "session_id": sid}
        if not await _ask(call, question, context):
            return _cancelled_text("机器人未复位", call)
    since = int((await client.get_session(sid)).get("last_seq") or 0)
    result = await client.reset(sid)
    check = await _wait_pose_check(client, sid, "reset", since, _RESET_CHECK_WAIT_S)
    out: dict[str, Any] = {
        "restored": bool(result.get("restored")),
        "pose_check": check,
    }
    if check is None:
        out["note"] = "回位校验结果尚未返回，可稍后 robot_status 查看"
    elif check.get("verified") is False:
        out["warning"] = _NOT_HOME_WARNING
    return _ok(**out)


async def _stop(args: dict[str, Any], call: _Call) -> str:
    # Never gated by a confirmation: stopping must always be reachable.
    sid = _text(args, "session_id")
    if not sid:
        return _fail("robot_invalid_args", "session_id 不能为空")
    settings = call.settings
    client = resolve_client(settings)
    result = await client.stop(sid, timeout_s=settings.stop_timeout_s)
    if result.get("state") == "stopping":
        deadline = time.monotonic() + settings.stop_timeout_s
        while time.monotonic() < deadline:
            await asyncio.sleep(_POLL_INTERVAL_S)
            st = await client.get_session(sid)
            if st.get("state") == "stopped":
                result = st
                break
    state = result.get("state")
    pose_check = result.get("pose_check")
    out: dict[str, Any] = {"state": state, "pose_check": pose_check}
    if state != "stopped":
        out["warning"] = "停止尚未完成，请稍后用 robot_status 确认"
    elif isinstance(pose_check, dict) and pose_check.get("verified") is False:
        out["warning"] = _NOT_HOME_WARNING
    return _ok(**out)


async def _status(args: dict[str, Any], call: _Call) -> str:
    sid = _text(args, "session_id")
    if not sid:
        return _fail("robot_invalid_args", "session_id 不能为空")
    try:
        since = max(0, int(args.get("since") or 0))
    except (TypeError, ValueError):
        since = 0
    st = await resolve_client(call.settings).get_session(sid, since)
    view = dict(st)
    view["failure_traceback_tail"] = _traceback_tail(
        view.pop("failure_traceback", None)
    )
    return json.dumps(view, ensure_ascii=False)


async def _snapshot(args: dict[str, Any], call: _Call) -> str:
    from agenticx.cli.agent_tools import (
        _VIEW_IMAGE_MAX_BYTES,
        _VIEW_IMAGE_MAX_PENDING,
        _data_url_from_bytes,
        _pending_visual_attachments,
        _session_vision_capable,
    )

    sid = _text(args, "session_id")
    if not sid:
        return _fail("robot_invalid_args", "session_id 不能为空")
    if not _session_vision_capable(call.session):
        return _fail(
            "robot_vision_unavailable",
            "当前模型不支持看图",
            "请切换到支持视觉的模型后再调用 robot_snapshot",
        )
    pending = _pending_visual_attachments(call.session)
    if len(pending) >= _VIEW_IMAGE_MAX_PENDING:
        return _fail(
            "robot_too_many_images",
            f"本轮待附加的图片已达上限（{_VIEW_IMAGE_MAX_PENDING} 张）",
        )
    camera = _text(args, "camera") or None
    snap = await resolve_client(call.settings).snapshot(sid, camera)
    try:
        data = base64.b64decode(str(snap["png_base64"]), validate=True)
    except (KeyError, binascii.Error, ValueError):
        return _fail("bridge_bad_response", "快照数据无法解码")
    if len(data) > _VIEW_IMAGE_MAX_BYTES:
        return _fail(
            "robot_image_too_large",
            f"快照超过 {_VIEW_IMAGE_MAX_BYTES // (1024 * 1024)}MB 上限",
        )
    path = str(snap.get("path") or "")
    camera_name = str(snap.get("camera") or camera or "")
    pending.append(
        {
            "name": Path(path).name if path else f"robot_{camera_name or 'camera'}.png",
            "data_url": _data_url_from_bytes(data, "image/png"),
            "mime_type": "image/png",
            "size": len(data),
            "source": path,
            "note": f"robot camera {camera_name}",
        }
    )
    return _ok(
        camera=camera_name,
        width=snap.get("width"),
        height=snap.get("height"),
        path=path,
        attached="图片已附加到下一轮，可直接据此判断现场",
    )


_HANDLERS: dict[str, Callable[[dict[str, Any], _Call], Awaitable[str]]] = {
    "robot_rollout_start": _rollout_start,
    "robot_set_task": _set_task,
    "robot_reset": _reset,
    "robot_stop": _stop,
    "robot_status": _status,
    "robot_snapshot": _snapshot,
}


async def dispatch_robot_tool(
    name: str,
    arguments: dict[str, Any],
    session: Any,
    *,
    confirm_gate: Any,
    emit_event: Any,
) -> str:
    """Run one robot tool; every outcome is a JSON string, except the confirm-denied CANCELLED text."""
    settings = ConfigManager.load().robot
    if not settings.enabled:
        return _fail("robot_disabled", "机器人工具未启用（robot.enabled=false）")
    handler = _HANDLERS.get(name)
    if handler is None:
        return _fail("robot_unknown_tool", f"未知的机器人工具：{name}")
    call = _Call(
        settings=settings,
        session=session,
        confirm_gate=confirm_gate,
        emit_event=emit_event,
    )
    try:
        return await handler(arguments if isinstance(arguments, dict) else {}, call)
    except RobotBridgeError as exc:
        return _fail(exc.code, exc.message, exc.hint)
