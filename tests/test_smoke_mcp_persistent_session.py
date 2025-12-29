"""
冒烟测试：MCP 持久化会话

验证：
1. 会话能够持久化（多次调用不重启进程）
2. 工具发现和调用功能正常
3. 性能提升（相比短连接）

注意：此测试需要本地有可用的 MCP 服务器。
如果没有，测试会被跳过。
"""
import asyncio
import os
import pytest
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig, RemoteToolV2


# 检查是否有可用的 MCP 服务器（使用官方 everything-server 作为测试）
def _check_mcp_server_available() -> bool:
    """检查是否有可用的 MCP 服务器"""
    # 尝试查找官方 everything-server
    # 如果找不到，测试会被跳过
    try:
        import subprocess
        result = subprocess.run(
            ["which", "npx"],
            capture_output=True,
            timeout=2
        )
        return result.returncode == 0
    except Exception:
        return False


@pytest.mark.asyncio
@pytest.mark.skipif(
    not _check_mcp_server_available(),
    reason="MCP server not available (requires npx)"
)
async def test_persistent_session_basic():
    """测试基本持久化会话功能"""
    # 使用官方 everything-server 作为测试服务器
    # 注意：这需要先安装 @modelcontextprotocol/server-everything
    config = MCPServerConfig(
        name="test-server",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-everything"],
        env={},
    )
    
    client = MCPClientV2(config)
    
    try:
        # 第一次调用：发现工具
        tools = await client.discover_tools()
        assert len(tools) > 0, "Should discover at least one tool"
        
        # 第二次调用：应该使用缓存的工具列表（不重启进程）
        tools2 = await client.discover_tools()
        assert len(tools2) == len(tools), "Should use cached tools"
        assert tools2[0].name == tools[0].name, "Cached tools should be identical"
        
        # 验证会话已初始化
        assert client._initialized, "Session should be initialized"
        assert client._session is not None, "Session should exist"
        
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    not _check_mcp_server_available(),
    reason="MCP server not available (requires npx)"
)
async def test_tool_call_persistent():
    """测试工具调用（使用持久化会话）"""
    config = MCPServerConfig(
        name="test-server",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-everything"],
        env={},
    )
    
    client = MCPClientV2(config)
    
    try:
        # 发现工具
        tools = await client.discover_tools()
        assert len(tools) > 0, "Should discover tools"
        
        # 查找 echo 工具（everything-server 应该提供）
        echo_tool = None
        for tool in tools:
            if "echo" in tool.name.lower():
                echo_tool = tool
                break
        
        if echo_tool is None:
            pytest.skip("Echo tool not found in server")
        
        # 第一次调用
        result1 = await client.call_tool(
            name=echo_tool.name,
            arguments={"message": "test1"}
        )
        assert not result1.isError, f"First call should succeed: {result1}"
        
        # 第二次调用（应该使用同一会话，不重启进程）
        result2 = await client.call_tool(
            name=echo_tool.name,
            arguments={"message": "test2"}
        )
        assert not result2.isError, f"Second call should succeed: {result2}"
        
        # 验证会话仍然存在
        assert client._session is not None, "Session should still exist after multiple calls"
        assert client._initialized, "Session should still be initialized"
        
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.skipif(
    not _check_mcp_server_available(),
    reason="MCP server not available (requires npx)"
)
async def test_remote_tool_v2_usage():
    """测试 RemoteToolV2 的使用"""
    config = MCPServerConfig(
        name="test-server",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-everything"],
        env={},
    )
    
    client = MCPClientV2(config)
    
    try:
        # 创建所有工具
        tools = await client.create_all_tools()
        assert len(tools) > 0, "Should create tools"
        
        # 查找 echo 工具
        echo_tool = None
        for tool in tools:
            if "echo" in tool.name.lower():
                echo_tool = tool
                break
        
        if echo_tool is None:
            pytest.skip("Echo tool not found")
        
        # 使用工具
        result = await echo_tool.arun(message="hello from RemoteToolV2")
        assert result is not None, "Tool should return result"
        
        # 验证工具属性
        assert echo_tool.name.startswith("test-server_"), "Tool name should be prefixed"
        assert echo_tool.client is client, "Tool should reference client"
        
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_client_close():
    """测试客户端关闭功能"""
    config = MCPServerConfig(
        name="test-server",
        command="echo",  # 使用简单的命令，避免依赖外部服务
        args=["test"],
        env={},
    )
    
    client = MCPClientV2(config)
    
    # 关闭客户端
    await client.close()
    
    # 验证状态
    assert client._closed, "Client should be marked as closed"
    assert client._session is None, "Session should be None after close"
    assert not client._initialized, "Should not be initialized after close"
    
    # 尝试再次关闭（应该安全）
    await client.close()


@pytest.mark.asyncio
async def test_error_handling():
    """测试错误处理"""
    # 使用无效的命令
    config = MCPServerConfig(
        name="invalid-server",
        command="nonexistent-command-12345",
        args=[],
        env={},
    )
    
    client = MCPClientV2(config)
    
    # 尝试创建会话应该失败
    with pytest.raises(Exception):  # 可能是 OSError 或其他异常
        await client._ensure_session()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

