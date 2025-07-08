"""
AgenticX LLM Module Tests

测试 agenticx.llms 模块中所有类的功能。
"""

import pytest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
import sys
import os
import time

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from agenticx.llms import (
    BaseLLMProvider,
    LLMResponse,
    TokenUsage,
    LLMChoice,
    LiteLLMProvider,
    OpenAIProvider,
    AnthropicProvider,
    OllamaProvider,
    GeminiProvider
)


@pytest.fixture
def mock_litellm_response():
    """创建一个模拟的 litellm.ModelResponse 对象"""
    response = MagicMock()
    response.id = "chatcmpl-123"
    response.model = "gpt-3.5-turbo"
    response.created = int(time.time())
    
    # 模拟 choices
    choice = MagicMock()
    choice.index = 0
    choice.finish_reason = "stop"
    choice.message.content = "This is a test response."
    response.choices = [choice]
    
    # 模拟 usage - litellm v1.35.0+ returns a Pydantic model
    usage = MagicMock()
    usage.prompt_tokens = 10
    usage.completion_tokens = 20
    usage.total_tokens = 30
    response.usage = usage
    
    # 模拟 cost
    response.completion_cost = 0.00015
    
    # 模拟其他元数据
    response._response_ms = 500
    response.custom_llm_provider = "openai"
    
    return response

@pytest.fixture
def mock_litellm_stream_chunks():
    """创建模拟的流式响应块"""
    def _create_chunk(content):
        chunk = MagicMock()
        chunk.choices[0].delta.content = content
        return chunk

    return [
        _create_chunk("This "),
        _create_chunk("is "),
        _create_chunk("a "),
        _create_chunk("streamed "),
        _create_chunk("response."),
        _create_chunk(None) # 模拟空内容块
    ]

class TestLLMDataClasses:
    """测试LLM相关的数据类"""

    def test_token_usage(self):
        usage = TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30)
        assert usage.prompt_tokens == 10
        assert usage.total_tokens == 30

    def test_llm_choice(self):
        choice = LLMChoice(index=0, content="Hello", finish_reason="stop")
        assert choice.index == 0
        assert choice.content == "Hello"

    def test_llm_response(self):
        usage = TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30)
        choice = LLMChoice(index=0, content="Test", finish_reason="stop")
        response = LLMResponse(
            id="res-123",
            model_name="test-model",
            created=12345,
            content="Test",
            choices=[choice],
            token_usage=usage,
            cost=0.01
        )
        assert response.id == "res-123"
        assert response.content == "Test"
        assert response.token_usage.total_tokens == 30
        assert len(response.choices) == 1

class TestLiteLLMProvider:
    """测试 LiteLLMProvider"""

    @patch('litellm.completion')
    def test_invoke_sync(self, mock_completion, mock_litellm_response):
        """测试同步调用 invoke"""
        mock_completion.return_value = mock_litellm_response
        
        provider = LiteLLMProvider(model="gpt-3.5-turbo")
        response = provider.invoke([{"role": "user", "content": "Hello, world!"}])
        
        mock_completion.assert_called_once()
        assert isinstance(response, LLMResponse)
        assert response.content == "This is a test response."
        assert response.token_usage.prompt_tokens == 10
        assert response.cost > 0
        assert response.model_name == "gpt-3.5-turbo"

    @pytest.mark.asyncio
    @patch('litellm.acompletion', new_callable=AsyncMock)
    async def test_ainvoke_async(self, mock_acompletion, mock_litellm_response):
        """测试异步调用 ainvoke"""
        mock_acompletion.return_value = mock_litellm_response
        
        provider = LiteLLMProvider(model="gpt-4")
        response = await provider.ainvoke([{"role": "user", "content": "Hello, async world!"}])
        
        mock_acompletion.assert_called_once()
        assert isinstance(response, LLMResponse)
        assert response.content == "This is a test response."
        assert response.token_usage.total_tokens == 30

    @patch('litellm.completion')
    def test_stream_sync(self, mock_completion, mock_litellm_stream_chunks):
        """测试同步流式调用 stream"""
        mock_completion.return_value = mock_litellm_stream_chunks
        
        provider = LiteLLMProvider(model="test-model")
        stream = provider.stream([{"role": "user", "content": "Stream test"}])
        
        result = "".join([chunk for chunk in stream])
        
        mock_completion.assert_called_once()
        assert result == "This is a streamed response."

    @pytest.mark.asyncio
    @patch('litellm.acompletion', new_callable=AsyncMock)
    async def test_astream_async(self, mock_acompletion, mock_litellm_stream_chunks):
        """测试异步流式调用 astream"""
        async def mock_stream_gen():
            for chunk in mock_litellm_stream_chunks:
                yield chunk

        mock_acompletion.return_value = mock_stream_gen()
        
        provider = LiteLLMProvider(model="test-model")
        stream = provider.astream([{"role": "user", "content": "Async stream test"}])
        
        result = "".join([chunk async for chunk in stream])
        
        mock_acompletion.assert_called_once()
        assert result == "This is a streamed response."

class TestConvenienceProviders:
    """测试便利提供商类"""

    def test_openai_provider(self):
        provider = OpenAIProvider(model="gpt-4-turbo")
        assert isinstance(provider, LiteLLMProvider)
        assert provider.model == "gpt-4-turbo"

    def test_anthropic_provider(self):
        provider = AnthropicProvider(model="claude-3-opus-20240229")
        assert isinstance(provider, LiteLLMProvider)
        assert provider.model == "claude-3-opus-20240229"

    def test_ollama_provider(self):
        provider = OllamaProvider(model="ollama/llama3")
        assert isinstance(provider, LiteLLMProvider)
        assert provider.model == "ollama/llama3"

    def test_gemini_provider(self):
        provider = GeminiProvider(model="gemini/gemini-pro")
        assert isinstance(provider, LiteLLMProvider)
        assert provider.model == "gemini/gemini-pro"


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 