"""
冒烟测试：MCP Sampling 机制

验证：
1. Sampling 回调可以正确桥接到 LLMProvider
2. 消息格式转换正确
3. 错误处理正常

注意：此测试需要 LLMProvider，但不需要真实的 MCP Server（使用 Mock）。
"""
import pytest
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig
import mcp.types as mcp_types


class MockLLMProvider:
    """Mock LLM Provider 用于测试"""
    
    def __init__(self, model="test-model"):
        self.model = model
    
    async def ainvoke(self, messages, **kwargs):
        """模拟 LLM 调用"""
        from agenticx.llms.response import LLMResponse, LLMChoice, TokenUsage
        import time
        
        # 返回模拟响应（补全所有必填字段）
        return LLMResponse(
            id="test-response-id",
            model_name=self.model,
            created=int(time.time()),
            content="Mock LLM response",
            choices=[
                LLMChoice(
                    index=0,
                    content="Mock LLM response",
                    finish_reason="stop"
                )
            ],
            token_usage=TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15)
        )


@pytest.mark.asyncio
async def test_sampling_callback_basic():
    """测试基本的 Sampling 回调功能"""
    config = MCPServerConfig(
        name="test-server",
        command="echo",
        args=["test"],
        env={},
    )
    
    # 创建带 LLM Provider 的客户端
    llm_provider = MockLLMProvider()
    client = MCPClientV2(config, llm_provider=llm_provider)
    
    # 创建采样请求参数
    params = mcp_types.CreateMessageRequestParams(
        messages=[
            mcp_types.SamplingMessage(
                role="user",
                content=mcp_types.TextContent(
                    type="text",
                    text="Hello, world!"
                )
            )
        ],
        maxTokens=100,
        temperature=0.7,
    )
    
    # 创建模拟上下文
    mock_context = MagicMock()
    
    # 调用 sampling 回调
    result = await client._handle_sampling(mock_context, params)
    
    # 验证结果
    assert not isinstance(result, mcp_types.ErrorData), f"Sampling should succeed, got error: {result}"
    assert isinstance(result, mcp_types.CreateMessageResult)
    assert result.role == "assistant"
    assert result.model == "test-model"
    assert isinstance(result.content, mcp_types.TextContent)
    assert "Mock LLM response" in result.content.text
    
    await client.close()


@pytest.mark.asyncio
async def test_sampling_without_llm_provider():
    """测试没有 LLM Provider 时的错误处理"""
    config = MCPServerConfig(
        name="test-server",
        command="echo",
        args=["test"],
        env={},
    )
    
    # 创建不带 LLM Provider 的客户端
    client = MCPClientV2(config, llm_provider=None)
    
    params = mcp_types.CreateMessageRequestParams(
        messages=[
            mcp_types.SamplingMessage(
                role="user",
                content=mcp_types.TextContent(type="text", text="test")
            )
        ],
        maxTokens=100,
    )
    
    mock_context = MagicMock()
    
    # 调用应该返回错误
    result = await client._handle_sampling(mock_context, params)
    
    assert isinstance(result, mcp_types.ErrorData)
    assert result.code == mcp_types.INVALID_REQUEST
    assert "not supported" in result.message.lower()
    
    await client.close()


@pytest.mark.asyncio
async def test_sampling_error_handling():
    """测试 Sampling 回调的错误处理"""
    config = MCPServerConfig(
        name="test-server",
        command="echo",
        args=["test"],
        env={},
    )
    
    # 创建会抛出异常的 LLM Provider
    class FailingLLMProvider:
        async def ainvoke(self, messages, **kwargs):
            raise RuntimeError("LLM call failed")
    
    llm_provider = FailingLLMProvider()
    client = MCPClientV2(config, llm_provider=llm_provider)
    
    params = mcp_types.CreateMessageRequestParams(
        messages=[
            mcp_types.SamplingMessage(
                role="user",
                content=mcp_types.TextContent(type="text", text="test")
            )
        ],
        maxTokens=100,
    )
    
    mock_context = MagicMock()
    
    # 调用应该捕获异常并返回错误
    result = await client._handle_sampling(mock_context, params)
    
    assert isinstance(result, mcp_types.ErrorData)
    assert result.code == mcp_types.INTERNAL_ERROR
    assert "failed" in result.message.lower()
    
    await client.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

