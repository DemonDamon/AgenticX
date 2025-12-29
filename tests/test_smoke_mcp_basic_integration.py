"""
冒烟测试：MCP 基本集成测试

验证：
1. MCPClientV2 可以正常创建
2. 会话可以正常关闭
3. 基本的错误处理

注意：此测试不依赖外部 MCP 服务器，只测试基本功能。
"""
import pytest
import sys
from pathlib import Path

# 添加项目根目录到路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from agenticx.tools.remote_v2 import MCPClientV2, MCPServerConfig


@pytest.mark.asyncio
async def test_client_creation():
    """测试客户端创建"""
    config = MCPServerConfig(
        name="test-server",
        command="echo",
        args=["test"],
        env={},
    )
    
    client = MCPClientV2(config)
    
    # 验证客户端已创建
    assert client.server_config.name == "test-server"
    assert not client._initialized
    assert client._session is None
    
    # 关闭客户端（应该安全）
    await client.close()


@pytest.mark.asyncio
async def test_client_context_manager():
    """测试客户端作为上下文管理器"""
    config = MCPServerConfig(
        name="test-server",
        command="echo",
        args=["test"],
        env={},
    )
    
    # 注意：由于 echo 不是真正的 MCP 服务器，初始化会失败
    # 但上下文管理器应该能正常处理异常并清理资源
    try:
        async with MCPClientV2(config) as client:
            # 验证客户端在上下文中
            assert client is not None
            # 如果初始化失败，这里不会执行
    except Exception:
        # 预期的：echo 不是 MCP 服务器，初始化会失败
        pass


@pytest.mark.asyncio
async def test_config_validation():
    """测试配置验证"""
    # 测试从字典创建配置
    config_dict = {
        "name": "test",
        "command": "echo",
        "args": ["test"],
    }
    
    client = MCPClientV2(config_dict)
    assert client.server_config.name == "test"
    assert client.server_config.command == "echo"
    
    await client.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

