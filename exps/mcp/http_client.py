import asyncio
import logging
import json

# 设置日志级别以查看更多信息
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mcp_client")

from fastmcp.client import Client

# 服务器URL - 连接到我们的计算器服务器
SERVER_URL = "http://127.0.0.1:8001/sse"

async def main():
    """
    连接到计算器服务器并测试各种工具
    """
    print(f"准备连接到 FastMCP 服务器: {SERVER_URL}")
    
    try:
        # 使用 FastMCP 的 Client 连接到服务器
        async with Client(SERVER_URL) as mcp_client:
            print("连接成功！获取可用工具列表...")
            
            # 列出所有可用的工具
            tools = await mcp_client.list_tools()
            print("可用工具:")
            for tool in tools:
                print(f"- {tool.name}: {tool.description}")
            
            # 测试加法工具
            print("\n测试加法: 5 + 7")
            add_result = await mcp_client.call_tool("add", {"a": 5, "b": 7})
            print(f"  结果: {add_result[0].text}")
            
            # 测试减法工具
            print("\n测试减法: 10 - 4")
            subtract_result = await mcp_client.call_tool("subtract", {"a": 10, "b": 4})
            print(f"  结果: {subtract_result[0].text}")
            
            # 测试乘法工具
            print("\n测试乘法: 6 * 8")
            multiply_result = await mcp_client.call_tool("multiply", {"a": 6, "b": 8})
            print(f"  结果: {multiply_result[0].text}")
            
            # 测试除法工具
            print("\n测试除法: 20 / 5")
            divide_result = await mcp_client.call_tool("divide", {"a": 20, "b": 5})
            print(f"  结果: {divide_result[0].text}")
            
            # 测试除以零的情况
            print("\n测试除以零: 10 / 0")
            try:
                await mcp_client.call_tool("divide", {"a": 10, "b": 0})
            except Exception as e:
                print(f"  预期的错误: {e}")
            
            # 读取 PI 常量资源
            print("\n读取资源 'constants://pi'")
            try:
                pi_result = await mcp_client.read_resource("constants://pi")
                print(f"  PI值: {pi_result}")
            except Exception as e:
                print(f"  读取资源失败: {e}")
                
    except Exception as e:
        print(f"错误: {e}")
        import traceback
        print(traceback.format_exc())

if __name__ == "__main__":
    print("=" * 50)
    print("FastMCP 计算器客户端测试")
    print("=" * 50)
    print(f"连接到服务器: {SERVER_URL}")
    print("=" * 50)
    
    asyncio.run(main()) 