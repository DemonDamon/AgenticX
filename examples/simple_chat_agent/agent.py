#!/usr/bin/env python3
"""
每日灵感助手 - 简单对话智能体

用户发送任意问题，助手流式回复一句简短的创意/灵感。
支持 LLM：百炼(Dashscope) > OpenAI > 0 配置预制回复。
"""

import asyncio
import os
from typing import AsyncIterator

# 预制回复（无 LLM 时使用）
FALLBACK_REPLIES = [
    "今天也要保持好奇心，每一个问题都是探索的起点。",
    "灵感来自日常的细微观察，试着放慢脚步看看周围。",
    "最好的创作往往源于最真实的感受。",
    "别怕试错，每一次尝试都在靠近答案。",
    "简单的问题往往藏着深刻的洞见。",
]


async def stream_handler(request) -> AsyncIterator[str]:
    """
    流式 Agent 处理函数。

    优先级：百炼(BAILIAN_API_KEY) > OpenAI(OPENAI_API_KEY) > 预制回复。
    """
    # 从 messages 提取最后一条用户消息
    last_msg = request.messages[-1] if request.messages else None
    user_input = (last_msg.content or "").strip() if last_msg else ""

    # 尝试使用 LLM
    llm = _get_llm()
    if llm:
        try:
            messages = [{"role": m.role.value, "content": m.content or ""} for m in request.messages]
            async for chunk in llm.astream(messages):
                if isinstance(chunk, str):
                    yield chunk
                await asyncio.sleep(0)
            return
        except Exception:
            pass

    # 无 LLM 或 LLM 失败：用预制回复模拟流式
    reply = FALLBACK_REPLIES[hash(user_input or "default") % len(FALLBACK_REPLIES)]
    for char in reply:
        yield char
        await asyncio.sleep(0.02)


def _get_llm():
    """获取 LLM。优先级：百炼 > OpenAI > None（预制回复）。"""
    # 1. 百炼（阿里云 Dashscope）
    api_key = os.getenv("BAILIAN_API_KEY") or os.getenv("DASHSCOPE_API_KEY")
    if api_key:
        try:
            from agenticx.llms import BailianProvider
            return BailianProvider(
                model=os.getenv("BAILIAN_CHAT_MODEL") or os.getenv("DASHSCOPE_CHAT_MODEL") or "qwen-plus",
                api_key=api_key,
                base_url=os.getenv("BAILIAN_API_BASE") or os.getenv("DASHSCOPE_API_BASE") or "https://dashscope.aliyuncs.com/compatible-mode/v1",
            )
        except Exception:
            pass

    # 2. OpenAI
    if os.getenv("OPENAI_API_KEY"):
        try:
            from agenticx.llms import LiteLLMProvider
            return LiteLLMProvider(model=os.getenv("OPENAI_CHAT_MODEL") or "gpt-3.5-turbo")
        except Exception:
            pass

    return None
