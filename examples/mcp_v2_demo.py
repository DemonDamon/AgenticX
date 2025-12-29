"""
MCP Client V2 示例：演示持久化会话和 Sampling 机制

本示例展示如何使用新的 MCPClientV2 来：
1. 连接到 MCP Server（持久化会话）
2. 自动发现和调用工具
3. 启用 Sampling 机制（让工具能反向调用 LLM）

运行前准备：
1. 安装依赖：pip install mcp
2. 确保有可用的 MCP Server（例如 @modelcontextprotocol/server-everything）
"""
import asyncio
import logging
from agenticx.tools import MCPClientV2, MCPServerConfig
from agenticx.llms import LiteLLMProvider

# 配置日志
logging.basicConfig(level=logging.INFO)


async def demo_basic_usage():
    """演示基本用法：持久化会话"""
    print("\n=== Demo 1: Basic Persistent Session ===")
    
    # 配置 MCP Server（使用官方 everything-server）
    config = MCPServerConfig(
        name="everything",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-everything"],
        env={},
    )
    
    # 创建客户端（使用 async with 确保资源清理）
    async with MCPClientV2(config) as client:
        # 发现工具
        tools = await client.discover_tools()
        print(f"发现 {len(tools)} 个工具")
        
        # 列出前 5 个工具
        for tool in tools[:5]:
            print(f"  - {tool.name}: {tool.description}")
        
        # 调用工具（持久化会话，无需重启进程）
        if tools:
            echo_tool = None
            for tool in tools:
                if "echo" in tool.name.lower():
                    echo_tool = tool
                    break
            
            if echo_tool:
                print(f"\n调用工具: {echo_tool.name}")
                result = await client.call_tool(
                    echo_tool.name,
                    arguments={"message": "Hello from AgenticX!"}
                )
                print(f"结果: {result.content[0] if result.content else 'No content'}")
    
    print("✅ 会话已自动关闭")


async def demo_sampling():
    """演示 Sampling 机制：让工具能反向调用 LLM"""
    print("\n=== Demo 2: Sampling with LLM Provider ===")
    
    # 创建 LLM Provider
    llm_provider = LiteLLMProvider(model="gpt-3.5-turbo")
    
    # 配置 MCP Server
    config = MCPServerConfig(
        name="everything",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-everything"],
        env={},
    )
    
    # 创建带 LLM Provider 的客户端（启用 Sampling）
    async with MCPClientV2(config, llm_provider=llm_provider) as client:
        print("客户端已启用 Sampling 机制")
        print("当 MCP Server 需要 LLM 能力时，会自动调用 AgenticX 的 LLMProvider")
        
        # 工具调用过程中，如果 Server 发起 Sampling 请求：
        # 1. MCP Server 调用 sampling/createMessage
        # 2. MCPClientV2._handle_sampling 接收请求
        # 3. 转换消息格式并调用 llm_provider.ainvoke
        # 4. 将 LLM 结果返回给 Server
        
        tools = await client.discover_tools()
        print(f"发现 {len(tools)} 个工具（已启用 Sampling 支持）")


async def demo_remote_tool_v2():
    """演示 RemoteToolV2：作为 AgenticX 标准工具使用"""
    print("\n=== Demo 3: RemoteToolV2 as Standard Tool ===")
    
    config = MCPServerConfig(
        name="everything",
        command="npx",
        args=["-y", "@modelcontextprotocol/server-everything"],
        env={},
    )
    
    async with MCPClientV2(config) as client:
        # 创建所有工具（作为 RemoteToolV2 实例）
        tools = await client.create_all_tools()
        
        # 查找 echo 工具
        echo_tool = None
        for tool in tools:
            if "echo" in tool.name.lower():
                echo_tool = tool
                break
        
        if echo_tool:
            print(f"工具名称: {echo_tool.name}")
            print(f"工具描述: {echo_tool.description}")
            
            # 使用标准的 arun 接口
            result = await echo_tool.arun(message="Test from RemoteToolV2")
            print(f"调用结果: {result}")
            
            # 可以在 Agent 中使用
            # agent = Agent(tools=[echo_tool])


async def main():
    """运行所有演示"""
    try:
        await demo_basic_usage()
    except Exception as e:
        print(f"Demo 1 failed (may need npx): {e}")
    
    try:
        await demo_sampling()
    except Exception as e:
        print(f"Demo 2 failed: {e}")
    
    try:
        await demo_remote_tool_v2()
    except Exception as e:
        print(f"Demo 3 failed: {e}")


if __name__ == "__main__":
    asyncio.run(main())

