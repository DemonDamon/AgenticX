"""
AgenticX OpenAI Protocol Handler

实现 OpenAI Chat Completions API 兼容的协议处理器。
"""

import uuid
import asyncio
import logging
from typing import Any, Dict, AsyncIterator, Optional, Callable, Awaitable

from .protocol import ProtocolHandler
from .types import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
    Choice,
    StreamChoice,
    Message,
    MessageRole,
    FinishReason,
    Usage,
    ModelInfo,
    ModelsResponse,
)

logger = logging.getLogger(__name__)


# Agent 处理函数类型
AgentHandler = Callable[[ChatCompletionRequest], Awaitable[str]]
StreamAgentHandler = Callable[[ChatCompletionRequest], AsyncIterator[str]]


class OpenAIProtocolHandler(ProtocolHandler):
    """
    OpenAI 协议处理器
    
    实现与 OpenAI Chat Completions API 兼容的接口。
    
    Example:
        >>> handler = OpenAIProtocolHandler()
        >>> handler.set_agent_handler(my_agent_function)
        >>> response = await handler.handle_chat_completion(request)
    """
    
    def __init__(
        self,
        model_name: str = "agenticx",
        agent_handler: Optional[AgentHandler] = None,
        stream_handler: Optional[StreamAgentHandler] = None,
    ):
        """
        初始化 OpenAI 协议处理器
        
        Args:
            model_name: 模型名称
            agent_handler: Agent 处理函数（非流式）
            stream_handler: Agent 流式处理函数
        """
        self._model_name = model_name
        self._agent_handler = agent_handler
        self._stream_handler = stream_handler
        self._available_models = [
            ModelInfo(id=model_name, owned_by="agenticx"),
        ]
    
    @property
    def name(self) -> str:
        return "openai"
    
    @property
    def version(self) -> str:
        return "v1"
    
    def set_agent_handler(self, handler: AgentHandler) -> None:
        """设置 Agent 处理函数"""
        self._agent_handler = handler
    
    def set_stream_handler(self, handler: StreamAgentHandler) -> None:
        """设置流式 Agent 处理函数"""
        self._stream_handler = handler
    
    def add_model(self, model_id: str, owned_by: str = "agenticx") -> None:
        """添加可用模型"""
        self._available_models.append(ModelInfo(id=model_id, owned_by=owned_by))
    
    async def handle_chat_completion(
        self,
        request: ChatCompletionRequest,
    ) -> ChatCompletionResponse:
        """
        处理 Chat Completion 请求
        
        Args:
            request: Chat Completion 请求
            
        Returns:
            ChatCompletionResponse: 响应
        """
        request_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        
        # 调用 Agent 处理
        if self._agent_handler:
            try:
                content = await self._agent_handler(request)
            except Exception as e:
                logger.error(f"Agent handler error: {e}")
                content = f"Error: {str(e)}"
        else:
            # 默认 echo 行为
            last_message = request.messages[-1] if request.messages else None
            content = last_message.content if last_message else "No message provided"
        
        # 构建响应
        message = Message(
            role=MessageRole.ASSISTANT,
            content=content,
        )
        
        choice = Choice(
            index=0,
            message=message,
            finish_reason=FinishReason.STOP,
        )
        
        # 计算 token（简单估算）
        prompt_tokens = sum(
            len(m.content or "") // 4 for m in request.messages
        )
        completion_tokens = len(content) // 4
        
        usage = Usage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        )
        
        return ChatCompletionResponse(
            id=request_id,
            model=request.model,
            choices=[choice],
            usage=usage,
        )
    
    async def handle_chat_completion_stream(
        self,
        request: ChatCompletionRequest,
    ) -> AsyncIterator[ChatCompletionChunk]:
        """
        处理流式 Chat Completion 请求
        
        Args:
            request: Chat Completion 请求
            
        Yields:
            ChatCompletionChunk: 流式响应块
        """
        request_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        
        # 发送初始 chunk（role）
        yield ChatCompletionChunk(
            id=request_id,
            model=request.model,
            choices=[
                StreamChoice(
                    index=0,
                    delta={"role": "assistant"},
                )
            ],
        )
        
        # 调用流式 Agent 处理
        if self._stream_handler:
            try:
                async for chunk_content in self._stream_handler(request):
                    yield ChatCompletionChunk(
                        id=request_id,
                        model=request.model,
                        choices=[
                            StreamChoice(
                                index=0,
                                delta={"content": chunk_content},
                            )
                        ],
                    )
            except Exception as e:
                logger.error(f"Stream handler error: {e}")
                yield ChatCompletionChunk(
                    id=request_id,
                    model=request.model,
                    choices=[
                        StreamChoice(
                            index=0,
                            delta={"content": f"Error: {str(e)}"},
                        )
                    ],
                )
        elif self._agent_handler:
            # 将非流式处理转换为流式
            try:
                content = await self._agent_handler(request)
                # 模拟流式输出
                for char in content:
                    yield ChatCompletionChunk(
                        id=request_id,
                        model=request.model,
                        choices=[
                            StreamChoice(
                                index=0,
                                delta={"content": char},
                            )
                        ],
                    )
                    await asyncio.sleep(0.01)  # 模拟延迟
            except Exception as e:
                logger.error(f"Agent handler error: {e}")
        else:
            # 默认 echo
            last_message = request.messages[-1] if request.messages else None
            content = last_message.content if last_message else "No message"
            yield ChatCompletionChunk(
                id=request_id,
                model=request.model,
                choices=[
                    StreamChoice(
                        index=0,
                        delta={"content": content},
                    )
                ],
            )
        
        # 发送结束 chunk
        yield ChatCompletionChunk(
            id=request_id,
            model=request.model,
            choices=[
                StreamChoice(
                    index=0,
                    delta={},
                    finish_reason=FinishReason.STOP,
                )
            ],
        )
    
    async def list_models(self) -> Dict[str, Any]:
        """
        列出可用模型
        
        Returns:
            模型列表
        """
        response = ModelsResponse(data=self._available_models)
        return response.to_dict()
