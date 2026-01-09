"""
AgenticX Server Protocol

定义协议处理器的抽象基类，支持多种 API 协议。
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, AsyncIterator, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from .types import ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk


class ProtocolHandler(ABC):
    """
    协议处理器抽象基类
    
    定义处理不同 API 协议的接口。当前支持 OpenAI 协议，
    未来可扩展支持其他协议（如 Anthropic、Google 等）。
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """协议名称"""
        pass
    
    @property
    @abstractmethod
    def version(self) -> str:
        """协议版本"""
        pass
    
    @abstractmethod
    async def handle_chat_completion(
        self,
        request: "ChatCompletionRequest",
    ) -> "ChatCompletionResponse":
        """
        处理 Chat Completion 请求
        
        Args:
            request: Chat Completion 请求
            
        Returns:
            ChatCompletionResponse: 响应
        """
        pass
    
    @abstractmethod
    async def handle_chat_completion_stream(
        self,
        request: "ChatCompletionRequest",
    ) -> AsyncIterator["ChatCompletionChunk"]:
        """
        处理流式 Chat Completion 请求
        
        Args:
            request: Chat Completion 请求
            
        Yields:
            ChatCompletionChunk: 流式响应块
        """
        pass
    
    @abstractmethod
    async def list_models(self) -> Dict[str, Any]:
        """
        列出可用模型
        
        Returns:
            模型列表
        """
        pass
    
    def validate_request(self, request: Dict[str, Any]) -> Optional[str]:
        """
        验证请求
        
        Args:
            request: 请求数据
            
        Returns:
            错误消息，如果验证通过则返回 None
        """
        if "messages" not in request:
            return "messages is required"
        if not isinstance(request["messages"], list):
            return "messages must be a list"
        if len(request["messages"]) == 0:
            return "messages must not be empty"
        return None
