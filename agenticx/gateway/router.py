#!/usr/bin/env python3
"""Route normalized IM messages to connected devices and collect replies.

Author: Damon Li
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING, Optional, Protocol

from agenticx.gateway.device_manager import DeviceManager

if TYPE_CHECKING:
    from agenticx.gateway.connect_session import ConnectSessionManager
from agenticx.gateway.models import GatewayMessage, GatewayReply
from agenticx.gateway.user_device_map import UserDeviceMap

logger = logging.getLogger(__name__)

_SUMMARY_MAX = 2000


class SupportsSendReply(Protocol):
    platform: str

    async def send_reply(self, reply: GatewayReply) -> bool:
        ...


class MessageRouter:
    """Bridges IM adapters, device WebSockets, and optional binding flow."""

    def __init__(
        self,
        device_manager: DeviceManager,
        user_map: UserDeviceMap,
        device_tokens: dict[str, str],
        binding_codes: dict[str, str],
        reply_timeout_seconds: float = 300.0,
        connect_sessions: Optional["ConnectSessionManager"] = None,
    ) -> None:
        self._dm = device_manager
        self._user_map = user_map
        self._device_tokens = device_tokens
        self._binding_codes = binding_codes
        self._reply_timeout = reply_timeout_seconds
        self._connect_sessions = connect_sessions

    async def route(
        self,
        message: GatewayMessage,
        adapter: SupportsSendReply,
    ) -> None:
        platform = message.source
        sender = message.sender_id
        text = (message.content or "").strip()

        bind_code = self._user_map.try_parse_bind_command(text)
        if bind_code:
            device_id = self._binding_codes.get(bind_code) or self._user_map.resolve_binding_code(
                bind_code
            )
            if not device_id:
                await adapter.send_reply(
                    GatewayReply(
                        message_id=message.message_id,
                        source=platform,
                        reply_to_sender_id=sender,
                        chat_id=message.chat_id,
                        content="绑定码无效或已过期。请在 Machi 设置中查看当前绑定码，或在网关配置中登记 binding_code。",
                    )
                )
                return
            self._user_map.set_binding(platform, sender, device_id)
            if self._connect_sessions is not None:
                name = (message.sender_name or "").strip() or sender
                self._connect_sessions.try_complete_bind(bind_code, device_id, platform, name)
            await adapter.send_reply(
                GatewayReply(
                    message_id=message.message_id,
                    source=platform,
                    reply_to_sender_id=sender,
                    chat_id=message.chat_id,
                    content=f"已绑定设备：{device_id}",
                )
            )
            return

        if UserDeviceMap.is_status_command(text):
            device_id = message.device_id or self._user_map.get_device(platform, sender) or ""
            online = self._dm.is_online(device_id) if device_id else False
            pending = self._dm.pending_count(device_id) if device_id else 0
            body = (
                f"设备: {device_id or '未绑定'}\n"
                f"在线: {'是' if online else '否'}\n"
                f"离线队列: {pending} 条"
            )
            await adapter.send_reply(
                GatewayReply(
                    message_id=message.message_id,
                    source=platform,
                    reply_to_sender_id=sender,
                    chat_id=message.chat_id,
                    content=body,
                )
            )
            return

        if UserDeviceMap.is_cancel_command(text):
            await adapter.send_reply(
                GatewayReply(
                    message_id=message.message_id,
                    source=platform,
                    reply_to_sender_id=sender,
                    chat_id=message.chat_id,
                    content="当前版本无法通过消息取消进行中的对话；请在 Machi 桌面端操作。",
                )
            )
            return

        device_id = (message.device_id or "").strip() or self._user_map.get_device(platform, sender) or ""
        if not device_id:
            await adapter.send_reply(
                GatewayReply(
                    message_id=message.message_id,
                    source=platform,
                    reply_to_sender_id=sender,
                    chat_id=message.chat_id,
                    content=(
                        "尚未绑定设备。请在本机 Machi 设置中查看「远程指令」绑定码，"
                        "然后向机器人发送：绑定 <你的绑定码>"
                    ),
                )
            )
            return

        correlation_id = str(uuid.uuid4())
        payload = {
            "type": "im_message",
            "correlation_id": correlation_id,
            "message": message.model_dump(mode="json"),
        }

        if not self._dm.is_online(device_id):
            self._dm.enqueue_pending(device_id, message)
            await adapter.send_reply(
                GatewayReply(
                    message_id=message.message_id,
                    source=platform,
                    reply_to_sender_id=sender,
                    chat_id=message.chat_id,
                    content="设备当前离线，指令已加入队列，电脑上线后会自动处理。",
                )
            )
            return

        sent = await self._dm.send_to_device(device_id, payload)
        if not sent:
            self._dm.enqueue_pending(device_id, message)
            await adapter.send_reply(
                GatewayReply(
                    message_id=message.message_id,
                    source=platform,
                    reply_to_sender_id=sender,
                    chat_id=message.chat_id,
                    content="设备连接异常，指令已排队。",
                )
            )
            return

        reply = await self._dm.wait_for_reply(correlation_id, timeout=self._reply_timeout)
        if reply is None:
            await adapter.send_reply(
                GatewayReply(
                    message_id=message.message_id,
                    source=platform,
                    reply_to_sender_id=sender,
                    chat_id=message.chat_id,
                    content="执行超时或无回复，请稍后重试或查看 Machi 桌面端。",
                )
            )
            return

        content = reply.content
        if len(content) > _SUMMARY_MAX:
            head = content[: _SUMMARY_MAX - 80]
            content = f"{head}\n\n...(全文共 {len(reply.content)} 字，请在 Machi 查看完整回复)"
        reply = GatewayReply(
            message_id=reply.message_id or message.message_id,
            source=reply.source or platform,
            reply_to_sender_id=reply.reply_to_sender_id or sender,
            chat_id=reply.chat_id or message.chat_id,
            content=content,
            content_type=reply.content_type,
            attachments=reply.attachments,
        )
        await adapter.send_reply(reply)
