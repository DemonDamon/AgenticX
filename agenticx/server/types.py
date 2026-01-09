"""
AgenticX Server Types

定义 Agent Server 的核心数据模型。
"""

from enum import Enum
from typing import Optional, Dict, Any, List, Union
from dataclasses import dataclass, field
from datetime import datetime


class MessageRole(str, Enum):
    """消息角色"""
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"
    FUNCTION = "function"  # Legacy, for compatibility


class FinishReason(str, Enum):
    """完成原因"""
    STOP = "stop"
    LENGTH = "length"
    TOOL_CALLS = "tool_calls"
    CONTENT_FILTER = "content_filter"
    FUNCTION_CALL = "function_call"  # Legacy


@dataclass
class Message:
    """
    聊天消息
    
    兼容 OpenAI Chat API 消息格式。
    """
    role: MessageRole
    content: Optional[str] = None
    name: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    function_call: Optional[Dict[str, Any]] = None  # Legacy
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {"role": self.role.value}
        if self.content is not None:
            result["content"] = self.content
        if self.name is not None:
            result["name"] = self.name
        if self.tool_calls is not None:
            result["tool_calls"] = self.tool_calls
        if self.tool_call_id is not None:
            result["tool_call_id"] = self.tool_call_id
        if self.function_call is not None:
            result["function_call"] = self.function_call
        return result
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Message":
        """从字典创建"""
        role = data.get("role", "user")
        if isinstance(role, str):
            role = MessageRole(role)
        return cls(
            role=role,
            content=data.get("content"),
            name=data.get("name"),
            tool_calls=data.get("tool_calls"),
            tool_call_id=data.get("tool_call_id"),
            function_call=data.get("function_call"),
        )


@dataclass
class ChatCompletionRequest:
    """
    Chat Completion 请求
    
    兼容 OpenAI Chat Completions API。
    """
    model: str
    messages: List[Message]
    temperature: float = 1.0
    top_p: float = 1.0
    n: int = 1
    stream: bool = False
    stop: Optional[Union[str, List[str]]] = None
    max_tokens: Optional[int] = None
    presence_penalty: float = 0.0
    frequency_penalty: float = 0.0
    logit_bias: Optional[Dict[str, float]] = None
    user: Optional[str] = None
    tools: Optional[List[Dict[str, Any]]] = None
    tool_choice: Optional[Union[str, Dict[str, Any]]] = None
    functions: Optional[List[Dict[str, Any]]] = None  # Legacy
    function_call: Optional[Union[str, Dict[str, Any]]] = None  # Legacy
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ChatCompletionRequest":
        """从字典创建"""
        messages = [
            Message.from_dict(m) if isinstance(m, dict) else m
            for m in data.get("messages", [])
        ]
        return cls(
            model=data.get("model", "agenticx"),
            messages=messages,
            temperature=data.get("temperature", 1.0),
            top_p=data.get("top_p", 1.0),
            n=data.get("n", 1),
            stream=data.get("stream", False),
            stop=data.get("stop"),
            max_tokens=data.get("max_tokens"),
            presence_penalty=data.get("presence_penalty", 0.0),
            frequency_penalty=data.get("frequency_penalty", 0.0),
            logit_bias=data.get("logit_bias"),
            user=data.get("user"),
            tools=data.get("tools"),
            tool_choice=data.get("tool_choice"),
            functions=data.get("functions"),
            function_call=data.get("function_call"),
        )


@dataclass
class Choice:
    """
    响应选项
    """
    index: int
    message: Message
    finish_reason: Optional[FinishReason] = None
    logprobs: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {
            "index": self.index,
            "message": self.message.to_dict(),
        }
        if self.finish_reason:
            result["finish_reason"] = self.finish_reason.value
        if self.logprobs:
            result["logprobs"] = self.logprobs
        return result


@dataclass
class StreamChoice:
    """
    流式响应选项
    """
    index: int
    delta: Dict[str, Any]
    finish_reason: Optional[FinishReason] = None
    logprobs: Optional[Dict[str, Any]] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {
            "index": self.index,
            "delta": self.delta,
        }
        if self.finish_reason:
            result["finish_reason"] = self.finish_reason.value
        if self.logprobs:
            result["logprobs"] = self.logprobs
        return result


@dataclass
class Usage:
    """
    Token 使用统计
    """
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    
    def to_dict(self) -> Dict[str, int]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }


@dataclass
class ChatCompletionResponse:
    """
    Chat Completion 响应
    
    兼容 OpenAI Chat Completions API 响应格式。
    """
    id: str
    object: str = "chat.completion"
    created: int = field(default_factory=lambda: int(datetime.now().timestamp()))
    model: str = "agenticx"
    choices: List[Choice] = field(default_factory=list)
    usage: Optional[Usage] = None
    system_fingerprint: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {
            "id": self.id,
            "object": self.object,
            "created": self.created,
            "model": self.model,
            "choices": [c.to_dict() for c in self.choices],
        }
        if self.usage:
            result["usage"] = self.usage.to_dict()
        if self.system_fingerprint:
            result["system_fingerprint"] = self.system_fingerprint
        return result


@dataclass
class ChatCompletionChunk:
    """
    Chat Completion 流式响应块
    """
    id: str
    object: str = "chat.completion.chunk"
    created: int = field(default_factory=lambda: int(datetime.now().timestamp()))
    model: str = "agenticx"
    choices: List[StreamChoice] = field(default_factory=list)
    system_fingerprint: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {
            "id": self.id,
            "object": self.object,
            "created": self.created,
            "model": self.model,
            "choices": [c.to_dict() for c in self.choices],
        }
        if self.system_fingerprint:
            result["system_fingerprint"] = self.system_fingerprint
        return result


@dataclass
class ModelInfo:
    """
    模型信息
    """
    id: str
    object: str = "model"
    created: int = field(default_factory=lambda: int(datetime.now().timestamp()))
    owned_by: str = "agenticx"
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "object": self.object,
            "created": self.created,
            "owned_by": self.owned_by,
        }


@dataclass
class ModelsResponse:
    """
    模型列表响应
    """
    object: str = "list"
    data: List[ModelInfo] = field(default_factory=list)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "object": self.object,
            "data": [m.to_dict() for m in self.data],
        }


@dataclass
class ErrorResponse:
    """
    错误响应
    """
    error: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        return {"error": self.error}
    
    @classmethod
    def create(
        cls,
        message: str,
        type: str = "invalid_request_error",
        param: Optional[str] = None,
        code: Optional[str] = None,
    ) -> "ErrorResponse":
        """创建错误响应"""
        error = {
            "message": message,
            "type": type,
        }
        if param:
            error["param"] = param
        if code:
            error["code"] = code
        return cls(error=error)
