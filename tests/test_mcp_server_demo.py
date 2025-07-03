#!/usr/bin/env python3
"""
AgenticX MCP Server 演示测试

演示如何通过 MCP 协议调用远程工具服务。
"""

import asyncio
import json
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.tools import BaseTool


class MCPServerSimulator:
    """模拟 MCP Server"""
    
    def __init__(self, server_name: str):
        self.server_name = server_name
        self.capabilities = {}
    
    def register_capability(self, name: str, description: str, schema: Dict):
        """注册服务能力"""
        self.capabilities[name] = {
            "description": description,
            "schema": schema,
            "handler": None
        }
    
    def set_handler(self, capability: str, handler):
        """设置能力处理器"""
        if capability in self.capabilities:
            self.capabilities[capability]["handler"] = handler
    
    async def list_capabilities(self) -> Dict[str, Any]:
        """列出所有可用能力（MCP 标准接口）"""
        return {
            "server": self.server_name,
            "capabilities": {
                name: {
                    "description": cap["description"],
                    "schema": cap["schema"]
                }
                for name, cap in self.capabilities.items()
            }
        }
    
    async def execute_capability(self, capability: str, params: Dict) -> Dict[str, Any]:
        """执行指定能力（MCP 标准接口）"""
        if capability not in self.capabilities:
            return {"error": f"Capability {capability} not found"}
        
        cap_info = self.capabilities[capability]
        handler = cap_info["handler"]
        
        if not handler:
            return {"error": f"No handler for capability {capability}"}
        
        try:
            if asyncio.iscoroutinefunction(handler):
                result = await handler(**params)
            else:
                result = handler(**params)
            
            return {
                "result": result,
                "status": "success"
            }
        except Exception as e:
            return {
                "error": str(e),
                "status": "error"
            }


class MCPClient:
    """MCP 客户端"""
    
    def __init__(self):
        self.servers = {}
    
    def register_server(self, server_id: str, server: MCPServerSimulator):
        """注册 MCP Server"""
        self.servers[server_id] = server
    
    async def discover_capabilities(self) -> Dict[str, Any]:
        """发现所有服务器的能力"""
        all_capabilities = {}
        
        for server_id, server in self.servers.items():
            caps = await server.list_capabilities()
            all_capabilities[server_id] = caps
        
        return all_capabilities
    
    async def call_capability(self, server_id: str, capability: str, params: Dict) -> Dict:
        """统一的能力调用接口"""
        if server_id not in self.servers:
            return {"error": f"Server {server_id} not found"}
        
        server = self.servers[server_id]
        return await server.execute_capability(capability, params)


class MCPToolAdapter(BaseTool):
    """将 MCP 服务适配为 AgenticX 工具"""
    
    def __init__(self, client: MCPClient, server_id: str, capability: str, 
                 name: str, description: str):
        super().__init__(name=name, description=description)
        self.client = client
        self.server_id = server_id
        self.capability = capability
    
    def _run(self, **kwargs):
        """同步执行（通过异步包装）"""
        try:
            # 检查是否已经在事件循环中
            loop = asyncio.get_running_loop()
            # 如果在事件循环中，创建任务
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self._arun(**kwargs))
                return future.result()
        except RuntimeError:
            # 没有运行的事件循环，可以直接使用 asyncio.run
            return asyncio.run(self._arun(**kwargs))
    
    async def _arun(self, **kwargs):
        """异步执行"""
        result = await self.client.call_capability(
            self.server_id, 
            self.capability, 
            kwargs
        )
        
        if result.get("status") == "success":
            return result["result"]
        else:
            raise Exception(result.get("error", "Unknown error"))


class MCPDemo:
    """MCP 演示"""
    
    def __init__(self):
        self.client = MCPClient()
        self.setup_servers()
    
    def setup_servers(self):
        """设置演示服务器"""
        
        # 计算服务器
        calc_server = MCPServerSimulator("calculator-service")
        calc_server.register_capability(
            "calculate",
            "执行数学计算",
            {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "数学表达式"}
                },
                "required": ["expression"]
            }
        )
        
        def calculator_handler(expression: str):
            """计算器处理器"""
            try:
                # 安全的数学表达式计算
                allowed_chars = set('0123456789+-*/()., ')
                if not all(c in allowed_chars for c in expression):
                    return f"错误：表达式包含不安全的字符"
                
                result = eval(expression)
                return f"计算结果：{expression} = {result}"
            except Exception as e:
                return f"计算错误：{str(e)}"
        
        calc_server.set_handler("calculate", calculator_handler)
        self.client.register_server("calculator", calc_server)
        
        # 文本处理服务器
        text_server = MCPServerSimulator("text-service")
        text_server.register_capability(
            "process_text",
            "处理文本",
            {
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "要处理的文本"},
                    "operation": {"type": "string", "description": "操作类型：upper, lower, reverse"}
                },
                "required": ["text", "operation"]
            }
        )
        
        def text_handler(text: str, operation: str):
            """文本处理器"""
            if operation == "upper":
                return text.upper()
            elif operation == "lower":
                return text.lower()
            elif operation == "reverse":
                return text[::-1]
            else:
                return f"未知操作：{operation}"
        
        text_server.set_handler("process_text", text_handler)
        self.client.register_server("text", text_server)
        
        # 数据分析服务器
        data_server = MCPServerSimulator("data-service")
        data_server.register_capability(
            "analyze_data",
            "分析数据",
            {
                "type": "object",
                "properties": {
                    "data": {"type": "array", "description": "数据数组"},
                    "operation": {"type": "string", "description": "分析操作：sum, avg, max, min"}
                },
                "required": ["data", "operation"]
            }
        )
        
        def data_handler(data: List[float], operation: str):
            """数据分析处理器"""
            if not data:
                return "数据为空"
            
            if operation == "sum":
                return f"总和：{sum(data)}"
            elif operation == "avg":
                return f"平均值：{sum(data) / len(data):.2f}"
            elif operation == "max":
                return f"最大值：{max(data)}"
            elif operation == "min":
                return f"最小值：{min(data)}"
            else:
                return f"未知操作：{operation}"
        
        data_server.set_handler("analyze_data", data_handler)
        self.client.register_server("data", data_server)
    
    async def demo_service_discovery(self):
        """演示服务发现"""
        print("🔍 MCP 服务发现演示")
        print("=" * 50)
        
        capabilities = await self.client.discover_capabilities()
        
        for server_id, server_info in capabilities.items():
            print(f"\n📡 服务器: {server_info['server']}")
            print(f"🆔 ID: {server_id}")
            print("🔧 能力:")
            
            for cap_name, cap_info in server_info['capabilities'].items():
                print(f"  - {cap_name}: {cap_info['description']}")
    
    async def demo_direct_calls(self):
        """演示直接调用"""
        print("\n💻 MCP 直接调用演示")
        print("=" * 50)
        
        # 计算服务调用
        calc_result = await self.client.call_capability(
            "calculator", "calculate", {"expression": "2893891 * 21382"}
        )
        print(f"🧮 计算服务: {calc_result}")
        
        # 文本处理调用
        text_result = await self.client.call_capability(
            "text", "process_text", {"text": "Hello AgenticX", "operation": "upper"}
        )
        print(f"📝 文本服务: {text_result}")
        
        # 数据分析调用
        data_result = await self.client.call_capability(
            "data", "analyze_data", {"data": [10, 20, 30, 40, 50], "operation": "avg"}
        )
        print(f"📊 数据服务: {data_result}")
    
    async def demo_tool_adapter(self):
        """演示工具适配器"""
        print("\n🔧 MCP 工具适配器演示")
        print("=" * 50)
        
        # 创建工具适配器
        calc_tool = MCPToolAdapter(
            self.client, "calculator", "calculate",
            "mcp_calculator", "MCP 计算器工具"
        )
        
        text_tool = MCPToolAdapter(
            self.client, "text", "process_text",
            "mcp_text_processor", "MCP 文本处理工具"
        )
        
        # 使用工具
        print("🧮 使用 MCP 计算器工具:")
        calc_result = calc_tool.run(expression="25 * 4")
        print(f"  结果: {calc_result}")
        
        print("\n📝 使用 MCP 文本处理工具:")
        text_result = text_tool.run(text="AgenticX MCP Demo", operation="reverse")
        print(f"  结果: {text_result}")
    
    async def run_demo(self):
        """运行完整演示"""
        print("🚀 AgenticX MCP Server 演示")
        print("=" * 60)
        
        await self.demo_service_discovery()
        await self.demo_direct_calls()
        await self.demo_tool_adapter()
        
        print("\n" + "=" * 60)
        print("🎉 MCP 演示完成！")
        print("\n💡 MCP 的优势:")
        print("1. 🔌 标准化协议 - 统一的服务接口")
        print("2. 🔍 动态发现 - 运行时发现服务能力")
        print("3. 🔧 工具适配 - 轻松集成到 AgenticX 工具系统")
        print("4. 🌐 分布式 - 支持远程服务调用")
        print("5. 🔄 解耦合 - 服务实现与客户端分离")


def main():
    """主函数"""
    demo = MCPDemo()
    asyncio.run(demo.run_demo())


if __name__ == "__main__":
    main() 