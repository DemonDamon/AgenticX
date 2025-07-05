"""
测试通用 MCP 架构 - 展示如何轻松接入任何 MCP 服务器
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.tools import MCPClient, create_mcp_client, load_mcp_config

async def demo_universal_mcp():
    """演示通用 MCP 架构的使用"""
    print("=== AgenticX 通用 MCP 架构演示 ===\n")
    
    # 方式1: 直接使用 MCPClient（推荐）
    print("1. 自动发现并创建工具（推荐方式）")
    print("-" * 50)
    
    try:
        # 从配置文件创建客户端
        client = await create_mcp_client("mineru-mcp")
        
        # 自动发现所有可用工具
        print("🔍 正在发现 MCP 服务器提供的工具...")
        tools = await client.discover_tools()
        
        print(f"✅ 发现 {len(tools)} 个工具:")
        for i, tool in enumerate(tools, 1):
            print(f"  {i}. {tool.name}: {tool.description}")
            if tool.inputSchema.get('properties'):
                print(f"     参数: {list(tool.inputSchema['properties'].keys())}")
        
        print("\n🛠️ 创建工具实例...")
        # 创建特定工具
        parse_tool = await client.create_tool("parse_documents")
        print(f"✅ 创建工具: {parse_tool.name}")
        print(f"   描述: {parse_tool.description}")
        
        # 或者创建所有工具
        all_tools = await client.create_all_tools()
        print(f"✅ 创建了 {len(all_tools)} 个工具实例")
        
        # 测试工具调用
        print("\n📄 测试文档解析...")
        test_file = project_root / "tests" / "RAGAS.pdf"
        if test_file.exists():
            result = await parse_tool.arun(
                file_sources=str(test_file),
                language="ch",
                enable_ocr=False
            )
            print(f"✅ 解析成功! 结果长度: {len(str(result))} 字符")
            
            # 保存结果
            output_file = project_root / "tests" / "mineru_output_universal.md"
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write(str(result))
            print(f"📁 结果已保存到: {output_file}")
        else:
            print("⚠️  测试文件不存在，跳过实际调用")
            
    except Exception as e:
        print(f"❌ 错误: {e}")
    
    print("\n" + "="*60)
    print("2. 接入其他 MCP 服务器的示例")
    print("-" * 50)
    
    # 演示如何接入其他 MCP 服务器
    print("""
💡 接入任何 MCP 服务器只需 3 步:

1️⃣ 在 ~/.cursor/mcp.json 中添加服务器配置:
{
  "mcpServers": {
    "my-custom-server": {
      "command": "my-mcp-server",
      "args": ["--port", "8080"],
      "env": {
        "API_KEY": "your-api-key"
      }
    }
  }
}

2️⃣ 创建客户端并发现工具:
```python
client = await create_mcp_client("my-custom-server")
tools = await client.discover_tools()  # 自动发现所有工具
```

3️⃣ 使用工具:
```python
# 创建特定工具
my_tool = await client.create_tool("some_tool_name")
result = await my_tool.arun(param1="value1", param2="value2")

# 或创建所有工具
all_tools = await client.create_all_tools()
```

🎉 无需编写任何适配代码！框架会自动:
- 发现服务器提供的工具
- 解析工具的参数 schema
- 生成对应的 Pydantic 模型
- 创建可用的工具实例
""")
    
    print("\n" + "="*60)
    print("3. 高级用法示例")
    print("-" * 50)
    
    print("""
🔧 高级用法:

# 批量创建多个服务器的工具
servers = ["mineru-mcp", "weather-mcp", "database-mcp"]
all_tools = []
for server_name in servers:
    client = await create_mcp_client(server_name)
    tools = await client.create_all_tools()
    all_tools.extend(tools)

# 在 Agent 中使用
from agenticx.core import Agent
agent = Agent(
    name="universal_agent",
    role="通用助手",
    goal="使用各种 MCP 工具完成任务",
    tools=all_tools  # 来自多个 MCP 服务器的工具
)

# 动态工具发现
def discover_available_tools():
    configs = load_mcp_config()
    available_tools = {}
    for server_name in configs:
        client = MCPClient(configs[server_name])
        tools = await client.discover_tools()
        available_tools[server_name] = [tool.name for tool in tools]
    return available_tools
""")

if __name__ == "__main__":
    asyncio.run(demo_universal_mcp()) 