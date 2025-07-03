#!/usr/bin/env python3
"""
AgenticX LLM Module Test Runner

快速运行 agenticx.llms 模块的所有测试。
"""

import sys
import os
import traceback
from unittest.mock import patch, MagicMock
import asyncio
import time

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

def run_basic_tests():
    """运行基础功能测试"""
    print("=== AgenticX LLM Module Test Runner ===\n")
    
    try:
        # 测试导入
        print("1. 测试模块导入...")
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
        print("   ✅ 所有LLM类导入成功\n")
        
        # 测试数据类
        print("2. 测试数据类...")
        usage = TokenUsage(prompt_tokens=10, completion_tokens=20, total_tokens=30)
        choice = LLMChoice(index=0, content="Test content", finish_reason="stop")
        response = LLMResponse(
            id="test-123",
            model_name="test-model",
            created=int(time.time()),
            content="Test content",
            choices=[choice],
            token_usage=usage,
            cost=0.01
        )
        
        assert usage.total_tokens == 30
        assert choice.content == "Test content"
        assert response.content == "Test content"
        assert len(response.choices) == 1
        print("   ✅ 数据类创建和属性测试通过\n")
        
        # 测试便利提供商类
        print("3. 测试便利提供商类...")
        openai_provider = OpenAIProvider(model="gpt-4")
        anthropic_provider = AnthropicProvider(model="claude-3-opus-20240229")
        ollama_provider = OllamaProvider(model="ollama/llama3")
        gemini_provider = GeminiProvider(model="gemini/gemini-pro")
        
        assert isinstance(openai_provider, LiteLLMProvider)
        assert isinstance(anthropic_provider, LiteLLMProvider)
        assert isinstance(ollama_provider, LiteLLMProvider)
        assert isinstance(gemini_provider, LiteLLMProvider)
        
        assert openai_provider.model == "gpt-4"
        assert anthropic_provider.model == "claude-3-opus-20240229"
        print("   ✅ 便利提供商类测试通过\n")
        
        # 测试LiteLLMProvider（模拟调用）
        print("4. 测试LiteLLMProvider（模拟调用）...")
        
        # 创建模拟响应
        mock_response = MagicMock()
        mock_response.id = "chatcmpl-test"
        mock_response.model = "gpt-3.5-turbo"
        mock_response.created = int(time.time())
        
        # 模拟choices
        mock_choice = MagicMock()
        mock_choice.index = 0
        mock_choice.finish_reason = "stop"
        mock_choice.message.content = "Hello from test!"
        mock_response.choices = [mock_choice]
        
        # 模拟usage
        mock_response.usage = {
            "prompt_tokens": 5,
            "completion_tokens": 10,
            "total_tokens": 15
        }
        
        # 模拟cost
        mock_response.cost = {"completion_cost": 0.0001}
        mock_response._response_ms = 200
        mock_response.custom_llm_provider = "openai"
        
        # 测试同步调用
        with patch('litellm.completion', return_value=mock_response):
            provider = LiteLLMProvider(model="gpt-3.5-turbo")
            result = provider.invoke("Hello, world!")
            
            assert isinstance(result, LLMResponse)
            assert result.content == "Hello from test!"
            assert result.token_usage.total_tokens == 15
            assert result.cost == 0.0001
        
        print("   ✅ LiteLLMProvider同步调用测试通过\n")
        
        # 测试流式调用（模拟）
        print("5. 测试流式调用（模拟）...")
        
        # 创建模拟流式响应
        def create_mock_chunk(content):
            chunk = MagicMock()
            chunk.choices = [MagicMock()]
            chunk.choices[0].delta.content = content
            return chunk
        
        mock_chunks = [
            create_mock_chunk("Hello "),
            create_mock_chunk("from "),
            create_mock_chunk("stream!"),
            create_mock_chunk(None)  # 空内容块
        ]
        
        with patch('litellm.completion', return_value=mock_chunks):
            provider = LiteLLMProvider(model="gpt-3.5-turbo")
            stream_result = "".join([chunk for chunk in provider.stream("Stream test")])
            
            assert stream_result == "Hello from stream!"
        
        print("   ✅ 流式调用测试通过\n")
        
        print("🎉 所有LLM模块测试都通过了！AgenticX LLM 模块功能正常。")
        return True
        
    except Exception as e:
        print(f"❌ 测试失败: {str(e)}")
        print(f"详细错误信息:\n{traceback.format_exc()}")
        return False

def run_async_tests():
    """运行异步功能测试"""
    print("\n=== 异步功能测试 ===")
    
    try:
        from agenticx.llms import LiteLLMProvider, LLMResponse
        from unittest.mock import AsyncMock
        
        async def test_async_invoke():
            # 创建模拟异步响应
            mock_response = MagicMock()
            mock_response.id = "async-test"
            mock_response.model = "gpt-4"
            mock_response.created = int(time.time())
            
            mock_choice = MagicMock()
            mock_choice.index = 0
            mock_choice.finish_reason = "stop"
            mock_choice.message.content = "Async response!"
            mock_response.choices = [mock_choice]
            
            mock_response.usage = {
                "prompt_tokens": 8,
                "completion_tokens": 12,
                "total_tokens": 20
            }
            mock_response.cost = {"completion_cost": 0.0002}
            
            with patch('litellm.acompletion', new_callable=AsyncMock, return_value=mock_response):
                provider = LiteLLMProvider(model="gpt-4")
                result = await provider.ainvoke("Async test")
                
                assert isinstance(result, LLMResponse)
                assert result.content == "Async response!"
                assert result.token_usage.total_tokens == 20
                
            return True
        
        async def test_async_stream():
            # 创建模拟异步流
            async def mock_async_stream():
                chunks = ["Async ", "stream ", "test!"]
                for chunk_content in chunks:
                    chunk = MagicMock()
                    chunk.choices = [MagicMock()]
                    chunk.choices[0].delta.content = chunk_content
                    yield chunk
            
            with patch('litellm.acompletion', new_callable=AsyncMock, return_value=mock_async_stream()):
                provider = LiteLLMProvider(model="gpt-4")
                stream_result = "".join([chunk async for chunk in provider.astream("Async stream test")])
                
                assert stream_result == "Async stream test!"
                
            return True
        
        # 运行异步测试
        result1 = asyncio.run(test_async_invoke())
        result2 = asyncio.run(test_async_stream())
        
        if result1 and result2:
            print("   ✅ 异步调用测试通过")
            print("   ✅ 异步流式调用测试通过")
            return True
        else:
            return False
            
    except Exception as e:
        print(f"❌ 异步测试失败: {str(e)}")
        return False

if __name__ == "__main__":
    success = run_basic_tests()
    
    if success:
        success_async = run_async_tests()
        if success_async:
            print("\n🎊 所有测试（包括异步功能）都通过了！")
        else:
            print("\n⚠️ 基础测试通过，但异步功能测试失败")
    
    sys.exit(0 if success else 1) 