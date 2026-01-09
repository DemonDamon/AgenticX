"""
Tests for agenticx.server.openai_protocol module
"""

import pytest
import asyncio

from agenticx.server.types import (
    Message,
    MessageRole,
    ChatCompletionRequest,
    ChatCompletionResponse,
    FinishReason,
)
from agenticx.server.openai_protocol import OpenAIProtocolHandler


class TestMessage:
    """Message 数据类测试"""
    
    def test_create_user_message(self):
        msg = Message(role=MessageRole.USER, content="Hello")
        assert msg.role == MessageRole.USER
        assert msg.content == "Hello"
    
    def test_to_dict(self):
        msg = Message(role=MessageRole.ASSISTANT, content="Hi there!")
        data = msg.to_dict()
        assert data["role"] == "assistant"
        assert data["content"] == "Hi there!"
    
    def test_from_dict(self):
        data = {"role": "user", "content": "Test message"}
        msg = Message.from_dict(data)
        assert msg.role == MessageRole.USER
        assert msg.content == "Test message"


class TestChatCompletionRequest:
    """ChatCompletionRequest 数据类测试"""
    
    def test_from_dict_minimal(self):
        data = {
            "model": "test-model",
            "messages": [{"role": "user", "content": "Hello"}],
        }
        request = ChatCompletionRequest.from_dict(data)
        assert request.model == "test-model"
        assert len(request.messages) == 1
        assert request.temperature == 1.0
        assert request.stream is False
    
    def test_from_dict_with_options(self):
        data = {
            "model": "test-model",
            "messages": [{"role": "user", "content": "Hello"}],
            "temperature": 0.7,
            "max_tokens": 100,
            "stream": True,
        }
        request = ChatCompletionRequest.from_dict(data)
        assert request.temperature == 0.7
        assert request.max_tokens == 100
        assert request.stream is True


class TestOpenAIProtocolHandler:
    """OpenAIProtocolHandler 测试"""
    
    @pytest.fixture
    def handler(self):
        return OpenAIProtocolHandler(model_name="test-model")
    
    def test_properties(self, handler):
        assert handler.name == "openai"
        assert handler.version == "v1"
    
    @pytest.mark.asyncio
    async def test_handle_chat_completion_default(self, handler):
        """测试默认 echo 行为"""
        request = ChatCompletionRequest(
            model="test-model",
            messages=[Message(role=MessageRole.USER, content="Hello World")],
        )
        
        response = await handler.handle_chat_completion(request)
        
        assert isinstance(response, ChatCompletionResponse)
        assert response.model == "test-model"
        assert len(response.choices) == 1
        assert response.choices[0].message.content == "Hello World"
        assert response.choices[0].finish_reason == FinishReason.STOP
    
    @pytest.mark.asyncio
    async def test_handle_chat_completion_with_handler(self):
        """测试自定义 handler"""
        async def my_handler(request):
            return "Custom response!"
        
        handler = OpenAIProtocolHandler(
            model_name="custom-model",
            agent_handler=my_handler,
        )
        
        request = ChatCompletionRequest(
            model="custom-model",
            messages=[Message(role=MessageRole.USER, content="Test")],
        )
        
        response = await handler.handle_chat_completion(request)
        
        assert response.choices[0].message.content == "Custom response!"
    
    @pytest.mark.asyncio
    async def test_handle_chat_completion_stream(self, handler):
        """测试流式响应"""
        request = ChatCompletionRequest(
            model="test-model",
            messages=[Message(role=MessageRole.USER, content="Hi")],
            stream=True,
        )
        
        chunks = []
        async for chunk in handler.handle_chat_completion_stream(request):
            chunks.append(chunk)
        
        # 至少应该有 role chunk, content chunk, 和 finish chunk
        assert len(chunks) >= 2
        # 第一个 chunk 应该包含 role
        assert "role" in chunks[0].choices[0].delta
        # 最后一个 chunk 应该有 finish_reason
        assert chunks[-1].choices[0].finish_reason == FinishReason.STOP
    
    @pytest.mark.asyncio
    async def test_list_models(self, handler):
        """测试模型列表"""
        models = await handler.list_models()
        
        assert models["object"] == "list"
        assert len(models["data"]) >= 1
        assert models["data"][0]["id"] == "test-model"
    
    def test_validate_request_valid(self, handler):
        """测试有效请求验证"""
        request = {
            "model": "test",
            "messages": [{"role": "user", "content": "Hello"}],
        }
        error = handler.validate_request(request)
        assert error is None
    
    def test_validate_request_missing_messages(self, handler):
        """测试缺少 messages 的请求"""
        request = {"model": "test"}
        error = handler.validate_request(request)
        assert "messages is required" in error
    
    def test_validate_request_empty_messages(self, handler):
        """测试空 messages 的请求"""
        request = {"model": "test", "messages": []}
        error = handler.validate_request(request)
        assert "must not be empty" in error
    
    def test_add_model(self, handler):
        """测试添加模型"""
        handler.add_model("another-model", owned_by="test-org")
        # 验证通过 list_models
    
    @pytest.mark.asyncio
    async def test_stream_with_custom_handler(self):
        """测试自定义流式 handler"""
        async def my_stream_handler(request):
            yield "Hello "
            yield "World!"
        
        handler = OpenAIProtocolHandler(
            model_name="stream-model",
            stream_handler=my_stream_handler,
        )
        
        request = ChatCompletionRequest(
            model="stream-model",
            messages=[Message(role=MessageRole.USER, content="Test")],
            stream=True,
        )
        
        content_parts = []
        async for chunk in handler.handle_chat_completion_stream(request):
            delta = chunk.choices[0].delta
            if "content" in delta:
                content_parts.append(delta["content"])
        
        full_content = "".join(content_parts)
        assert "Hello " in full_content
        assert "World!" in full_content


class TestChatCompletionResponse:
    """ChatCompletionResponse 测试"""
    
    def test_to_dict(self):
        from agenticx.server.types import Choice, Usage
        
        response = ChatCompletionResponse(
            id="test-id",
            model="test-model",
            choices=[
                Choice(
                    index=0,
                    message=Message(role=MessageRole.ASSISTANT, content="Hello"),
                    finish_reason=FinishReason.STOP,
                )
            ],
            usage=Usage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
        )
        
        data = response.to_dict()
        
        assert data["id"] == "test-id"
        assert data["model"] == "test-model"
        assert data["object"] == "chat.completion"
        assert len(data["choices"]) == 1
        assert data["choices"][0]["message"]["content"] == "Hello"
        assert data["usage"]["total_tokens"] == 15
