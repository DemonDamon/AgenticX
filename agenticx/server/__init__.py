"""
AgenticX Server Module

提供 Agent HTTP Server 功能，支持 OpenAI Chat Completions API 兼容接口。

Example:
    >>> from agenticx.server import AgentServer
    >>> 
    >>> async def my_agent(request):
    ...     # 处理请求并返回响应
    ...     return "Hello from AgenticX!"
    >>> 
    >>> server = AgentServer(agent_handler=my_agent)
    >>> server.run(port=8000)

或者使用流式响应：
    >>> async def my_stream_agent(request):
    ...     yield "Hello "
    ...     yield "from "
    ...     yield "AgenticX!"
    >>> 
    >>> server = AgentServer(stream_handler=my_stream_agent)
    >>> server.run(port=8000)
"""

from .types import (
    # 枚举
    MessageRole,
    FinishReason,
    # 消息
    Message,
    # 请求/响应
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
    Choice,
    StreamChoice,
    Usage,
    # 模型
    ModelInfo,
    ModelsResponse,
    # 错误
    ErrorResponse,
)

from .protocol import ProtocolHandler
from .openai_protocol import OpenAIProtocolHandler, AgentHandler, StreamAgentHandler
from .server import AgentServer, create_server

__all__ = [
    # 核心类
    "AgentServer",
    "create_server",
    # 协议
    "ProtocolHandler",
    "OpenAIProtocolHandler",
    # 类型别名
    "AgentHandler",
    "StreamAgentHandler",
    # 枚举
    "MessageRole",
    "FinishReason",
    # 数据类
    "Message",
    "ChatCompletionRequest",
    "ChatCompletionResponse",
    "ChatCompletionChunk",
    "Choice",
    "StreamChoice",
    "Usage",
    "ModelInfo",
    "ModelsResponse",
    "ErrorResponse",
]

__version__ = "0.1.0"
