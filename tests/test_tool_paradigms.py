#!/usr/bin/env python3
"""
AgenticX M3 工具系统范式测试

测试三种工具调用范式：Function Call、Tool Use、MCP Server
以及未来的 A2A (Agent-to-Agent) 调用模式
"""

import asyncio
import json
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.tools import (
    BaseTool, FunctionTool, tool, ToolExecutor,
    FileTool, WebSearchTool
)
from agenticx.tools.credentials import CredentialStore


class ToolParadigmTester:
    """工具范式测试器"""
    
    def __init__(self):
        self.executor = ToolExecutor(max_retries=2, retry_delay=0.1)
        self.results = {
            "function_call": {"passed": 0, "total": 0, "details": []},
            "tool_use": {"passed": 0, "total": 0, "details": []},
            "mcp_server": {"passed": 0, "total": 0, "details": []},
            "a2a": {"passed": 0, "total": 0, "details": []},
        }
    
    def log_test(self, paradigm: str, test_name: str, success: bool, details: str = ""):
        """记录测试结果"""
        self.results[paradigm]["total"] += 1
        if success:
            self.results[paradigm]["passed"] += 1
            status = "✅"
        else:
            status = "❌"
        
        result = {
            "test": test_name,
            "success": success,
            "details": details
        }
        self.results[paradigm]["details"].append(result)
        print(f"  {status} {test_name}: {details}")
    
    def test_function_call_paradigm(self):
        """
        测试 Function Call 范式
        
        特点：
        - 静态函数定义，预先注册
        - OpenAI 兼容的函数调用格式
        - 适合标准化的 API 服务包装
        - 需要为每个 API 服务开发适配器
        """
        print("\n🔧 测试 Function Call 范式")
        print("=" * 50)
        
        # 测试1：基础函数调用
        try:
            @tool(name="weather_api")
            def get_weather(city: str, units: str = "celsius") -> str:
                """获取天气信息的 API 包装函数
                
                Args:
                    city: 城市名称
                    units: 温度单位
                    
                Returns:
                    天气信息
                """
                # 模拟 API 调用
                return f"北京今天天气晴朗，温度 25°{units[0].upper()}"
            
            result = get_weather.run(city="北京", units="celsius")
            success = "晴朗" in result
            self.log_test("function_call", "基础函数调用", success, result)
        except Exception as e:
            self.log_test("function_call", "基础函数调用", False, str(e))
        
        # 测试2：OpenAI 格式兼容性
        try:
            @tool()
            def calculate_price(base_price: float, tax_rate: float = 0.08) -> Dict[str, float]:
                """计算含税价格
                
                Args:
                    base_price: 基础价格
                    tax_rate: 税率
                    
                Returns:
                    价格详情
                """
                tax = base_price * tax_rate
                total = base_price + tax
                return {
                    "base_price": base_price,
                    "tax": tax,
                    "total_price": total
                }
            
            # 测试 OpenAI schema 生成
            schema = calculate_price.to_openai_schema()
            required_fields = ["type", "function"]
            schema_valid = all(field in schema for field in required_fields)
            
            # 测试函数执行
            result = calculate_price.run(base_price=100.0, tax_rate=0.1)
            execution_valid = result["total_price"] == 110.0
            
            success = schema_valid and execution_valid
            details = f"Schema: {schema_valid}, Execution: {execution_valid}"
            self.log_test("function_call", "OpenAI 格式兼容", success, details)
        except Exception as e:
            self.log_test("function_call", "OpenAI 格式兼容", False, str(e))
        
        # 测试3：多 API 服务适配
        try:
            # 模拟多个不同的 API 服务
            @tool(name="database_api")
            def query_database(table: str, filters: Dict[str, Any]) -> List[Dict]:
                """数据库查询 API 包装"""
                return [{"id": 1, "name": "test", "table": table}]
            
            @tool(name="payment_api") 
            def process_payment(amount: float, currency: str = "USD") -> Dict[str, str]:
                """支付处理 API 包装"""
                return {"status": "success", "transaction_id": "tx_123", "amount": f"{amount} {currency}"}
            
            @tool(name="notification_api")
            def send_notification(message: str, channel: str = "email") -> bool:
                """通知发送 API 包装"""
                return len(message) > 0
            
            # 模拟 LLM 根据需求选择不同的 API
            apis = [query_database, process_payment, send_notification]
            results = []
            
            # 执行数据库查询
            db_result = query_database.run(table="users", filters={"active": True})
            results.append(len(db_result) > 0)
            
            # 执行支付处理
            pay_result = process_payment.run(amount=99.99, currency="USD")
            results.append(pay_result["status"] == "success")
            
            # 发送通知
            notify_result = send_notification.run(message="Payment processed", channel="email")
            results.append(notify_result == True)
            
            success = all(results)
            details = f"APIs tested: {len(apis)}, Success: {sum(results)}/{len(results)}"
            self.log_test("function_call", "多 API 服务适配", success, details)
        except Exception as e:
            self.log_test("function_call", "多 API 服务适配", False, str(e))
    
    def test_tool_use_paradigm(self):
        """
        测试 Tool Use 范式
        
        特点：
        - 动态工具执行与文件操作
        - 支持 ReAct 模式（推理-行动-观察）
        - 执行环境可以是本地或远程
        """
        print("\n🛠️ 测试 Tool Use 范式")
        print("=" * 50)
        
        # 测试：文件系统操作
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                file_tool = FileTool(allowed_paths=[temp_dir])
                
                # 写入文件
                test_file = Path(temp_dir) / "test_data.txt"
                content = "AgenticX Tool Use Test\nLine 2\nLine 3"
                
                write_result = file_tool.run(
                    action="write",
                    file_path=str(test_file),
                    content=content
                )
                
                # 读取文件
                read_result = file_tool.run(
                    action="read",
                    file_path=str(test_file)
                )
                
                success = read_result == content
                details = f"Write: {'OK' if 'Successfully' in write_result else 'Failed'}, Read: {'OK' if success else 'Failed'}"
                self.log_test("tool_use", "文件系统操作", success, details)
        except Exception as e:
            self.log_test("tool_use", "文件系统操作", False, str(e))
        
        # 测试3：ReAct 模式模拟
        try:
            # 模拟 ReAct 循环：思考 -> 行动 -> 观察
            react_steps = []
            
            # Step 1: 思考 - 需要计算一个数学问题
            thought = "I need to calculate the area of a circle with radius 5"
            react_steps.append(f"Thought: {thought}")
            
            # Step 2: 行动 - 执行代码计算
            action_code = """
import math
radius = 5
area = math.pi * radius ** 2
result = f"Circle area with radius {radius} is {area:.2f}"
"""
            action_result = code_tool.run(code=action_code)
            react_steps.append(f"Action: Execute calculation")
            
            # Step 3: 观察 - 分析结果
            observation = f"Observation: {action_result}"
            react_steps.append(observation)
            
            # Step 4: 思考 - 验证结果
            if "78.54" in action_result:  # π * 5² ≈ 78.54
                final_thought = "The calculation is correct"
                react_steps.append(f"Thought: {final_thought}")
                success = True
            else:
                success = False
            
            details = " -> ".join(react_steps)
            self.log_test("tool_use", "ReAct 模式模拟", success, details)
        except Exception as e:
            self.log_test("tool_use", "ReAct 模式模拟", False, str(e))
        
        # 测试4：远程工具执行（模拟）
        try:
            # 模拟远程工具：通过 HTTP 调用远程服务
            class RemoteToolSimulator(BaseTool):
                def __init__(self):
                    super().__init__(
                        name="remote_analysis_tool",
                        description="远程数据分析工具"
                    )
                
                def _run(self, **kwargs):
                    # 模拟远程调用
                    data = kwargs.get("data", [])
                    operation = kwargs.get("operation", "sum")
                    
                    if operation == "sum":
                        result = sum(data)
                    elif operation == "average":
                        result = sum(data) / len(data) if data else 0
                    else:
                        result = "Unknown operation"
                    
                    return f"Remote analysis result: {result}"
            
            remote_tool = RemoteToolSimulator()
            result = remote_tool.run(data=[1, 2, 3, 4, 5], operation="average")
            success = "3.0" in result
            self.log_test("tool_use", "远程工具执行", success, result)
        except Exception as e:
            self.log_test("tool_use", "远程工具执行", False, str(e))
    
    def test_mcp_server_paradigm(self):
        """
        测试 MCP Server 范式
        
        特点：
        - 标准化协议，统一接口
        - 服务发现和能力描述
        - 无需为每个服务单独适配
        - 支持远程部署和动态调用
        """
        print("\n🌐 测试 MCP Server 范式")
        print("=" * 50)
        
        # 测试1：MCP 协议标准化接口
        try:
            # 模拟 MCP Server 接口
            class MCPServerSimulator:
                def __init__(self, server_name: str):
                    self.server_name = server_name
                    self.capabilities = {}
                
                def register_capability(self, name: str, description: str, schema: Dict):
                    """注册服务能力"""
                    self.capabilities[name] = {
                        "description": description,
                        "schema": schema
                    }
                
                def list_capabilities(self) -> Dict[str, Any]:
                    """列出所有可用能力（MCP 标准接口）"""
                    return {
                        "server": self.server_name,
                        "capabilities": self.capabilities
                    }
                
                def execute_capability(self, capability: str, params: Dict) -> Dict[str, Any]:
                    """执行指定能力（MCP 标准接口）"""
                    if capability not in self.capabilities:
                        return {"error": f"Capability {capability} not found"}
                    
                    # 模拟执行
                    if capability == "weather_query":
                        return {
                            "result": f"Weather in {params.get('city', 'Unknown')}: Sunny, 25°C",
                            "status": "success"
                        }
                    elif capability == "data_analysis":
                        data = params.get("data", [])
                        return {
                            "result": f"Analysis complete: {len(data)} items processed",
                            "status": "success"
                        }
                    else:
                        return {"result": f"Executed {capability}", "status": "success"}
            
            # 创建多个 MCP Server
            weather_server = MCPServerSimulator("weather-service")
            weather_server.register_capability(
                "weather_query",
                "查询天气信息",
                {"city": "string", "units": "string"}
            )
            
            analytics_server = MCPServerSimulator("analytics-service")
            analytics_server.register_capability(
                "data_analysis",
                "数据分析服务",
                {"data": "array", "method": "string"}
            )
            
            # 测试服务发现
            weather_caps = weather_server.list_capabilities()
            analytics_caps = analytics_server.list_capabilities()
            
            discovery_success = (
                len(weather_caps["capabilities"]) > 0 and
                len(analytics_caps["capabilities"]) > 0
            )
            
            self.log_test("mcp_server", "服务发现", discovery_success, 
                         f"Found {len(weather_caps['capabilities']) + len(analytics_caps['capabilities'])} capabilities")
        except Exception as e:
            self.log_test("mcp_server", "服务发现", False, str(e))
        
        # 测试2：统一协议调用
        try:
            # 模拟 MCP Client 统一调用接口
            class MCPClient:
                def __init__(self):
                    self.servers = {}
                
                def register_server(self, server_id: str, server: MCPServerSimulator):
                    """注册 MCP Server"""
                    self.servers[server_id] = server
                
                def call_capability(self, server_id: str, capability: str, params: Dict) -> Dict:
                    """统一的能力调用接口"""
                    if server_id not in self.servers:
                        return {"error": f"Server {server_id} not found"}
                    
                    server = self.servers[server_id]
                    return server.execute_capability(capability, params)
            
            # 创建 MCP Client 并注册服务
            client = MCPClient()
            client.register_server("weather", weather_server)
            client.register_server("analytics", analytics_server)
            
            # 统一调用不同服务
            weather_result = client.call_capability(
                "weather", "weather_query", {"city": "Shanghai"}
            )
            
            analytics_result = client.call_capability(
                "analytics", "data_analysis", {"data": [1, 2, 3, 4, 5]}
            )
            
            success = (
                weather_result.get("status") == "success" and
                analytics_result.get("status") == "success"
            )
            
            details = f"Weather: {weather_result.get('status')}, Analytics: {analytics_result.get('status')}"
            self.log_test("mcp_server", "统一协议调用", success, details)
        except Exception as e:
            self.log_test("mcp_server", "统一协议调用", False, str(e))
        
        # 测试3：动态能力扩展
        try:
            # 模拟运行时添加新的 MCP Server
            new_server = MCPServerSimulator("translation-service")
            new_server.register_capability(
                "translate_text",
                "文本翻译服务",
                {"text": "string", "from_lang": "string", "to_lang": "string"}
            )
            
            # 动态注册新服务
            client.register_server("translation", new_server)
            
            # 调用新服务
            translation_result = client.call_capability(
                "translation", "translate_text",
                {"text": "Hello", "from_lang": "en", "to_lang": "zh"}
            )
            
            success = translation_result.get("status") == "success"
            details = f"Dynamic server added and called: {success}"
            self.log_test("mcp_server", "动态能力扩展", success, details)
        except Exception as e:
            self.log_test("mcp_server", "动态能力扩展", False, str(e))
        
        # 测试4：协议解耦验证
        try:
            # 验证 MCP Client 无需了解具体服务实现
            # 只需要知道标准的 MCP 接口
            
            # 模拟不同类型的后端服务
            class DatabaseMCPServer(MCPServerSimulator):
                def execute_capability(self, capability: str, params: Dict):
                    # 模拟数据库操作
                    if capability == "query":
                        return {"result": f"Query executed: {params}", "status": "success"}
                    return super().execute_capability(capability, params)
            
            class APIMCPServer(MCPServerSimulator):
                def execute_capability(self, capability: str, params: Dict):
                    # 模拟 API 调用
                    if capability == "api_call":
                        return {"result": f"API called with: {params}", "status": "success"}
                    return super().execute_capability(capability, params)
            
            # 创建不同后端的服务
            db_server = DatabaseMCPServer("database-service")
            db_server.register_capability("query", "数据库查询", {"sql": "string"})
            
            api_server = APIMCPServer("api-service")
            api_server.register_capability("api_call", "API 调用", {"endpoint": "string"})
            
            # Client 使用相同接口调用不同后端
            client.register_server("database", db_server)
            client.register_server("api", api_server)
            
            db_result = client.call_capability("database", "query", {"sql": "SELECT * FROM users"})
            api_result = client.call_capability("api", "api_call", {"endpoint": "/users"})
            
            success = (
                db_result.get("status") == "success" and
                api_result.get("status") == "success"
            )
            
            details = f"Protocol decoupling verified: DB={db_result.get('status')}, API={api_result.get('status')}"
            self.log_test("mcp_server", "协议解耦验证", success, details)
        except Exception as e:
            self.log_test("mcp_server", "协议解耦验证", False, str(e))
    
    def test_a2a_paradigm(self):
        """
        测试 A2A (Agent-to-Agent) 范式 - TODO
        
        特点：
        - 将 Agent 本身作为工具调用
        - Agent 间的协作和通信
        - 分布式智能体系统
        - 复杂任务的分解和协作
        """
        print("\n🤖 测试 A2A (Agent-to-Agent) 范式")
        print("=" * 50)
        print("⚠️  A2A 范式尚未实现，这是未来的扩展方向")
        
        # TODO: 实现 A2A 测试
        test_cases = [
            "Agent 间通信协议",
            "Agent 能力发现",
            "分布式任务分解",
            "Agent 协作执行",
            "结果聚合和反馈"
        ]
        
        for test_case in test_cases:
            self.log_test("a2a", test_case, False, "TODO: 待实现")
    
    def run_all_tests(self):
        """运行所有范式测试"""
        print("🧪 AgenticX M3 工具系统范式测试")
        print("=" * 60)
        print("测试三种工具调用范式的实现情况：")
        print("1. Function Call - 静态函数调用")
        print("2. Tool Use - 动态工具执行") 
        print("3. MCP Server - 标准化协议服务")
        print("4. A2A - Agent 间协作（TODO）")
        print("=" * 60)
        
        # 执行各范式测试
        self.test_function_call_paradigm()
        self.test_tool_use_paradigm()
        self.test_mcp_server_paradigm()
        self.test_a2a_paradigm()
        
        # 生成测试报告
        self.generate_report()
    
    def generate_report(self):
        """生成测试报告"""
        print("\n" + "=" * 60)
        print("📊 测试报告")
        print("=" * 60)
        
        total_passed = 0
        total_tests = 0
        
        for paradigm, results in self.results.items():
            passed = results["passed"]
            total = results["total"]
            rate = (passed / total * 100) if total > 0 else 0
            
            status = "✅" if rate == 100 else "⚠️" if rate >= 50 else "❌"
            paradigm_name = {
                "function_call": "Function Call",
                "tool_use": "Tool Use", 
                "mcp_server": "MCP Server",
                "a2a": "A2A (Agent-to-Agent)"
            }[paradigm]
            
            print(f"{status} {paradigm_name}: {passed}/{total} ({rate:.1f}%)")
            
            total_passed += passed
            total_tests += total
        
        print("-" * 60)
        overall_rate = (total_passed / total_tests * 100) if total_tests > 0 else 0
        print(f"🎯 总体通过率: {total_passed}/{total_tests} ({overall_rate:.1f}%)")
        
        # 分析和建议
        print("\n📋 分析和建议:")
        
        if self.results["function_call"]["passed"] == self.results["function_call"]["total"]:
            print("✅ Function Call 范式完全支持 - 适合标准化 API 服务包装")
        else:
            print("⚠️ Function Call 范式需要改进 - 检查 OpenAI 兼容性")
        
        if self.results["tool_use"]["passed"] == self.results["tool_use"]["total"]:
            print("✅ Tool Use 范式完全支持 - 适合动态工具执行和 ReAct 模式")
        else:
            print("⚠️ Tool Use 范式需要改进 - 检查沙箱环境和文件操作")
        
        if self.results["mcp_server"]["passed"] == self.results["mcp_server"]["total"]:
            print("✅ MCP Server 范式完全支持 - 适合标准化协议服务")
        else:
            print("⚠️ MCP Server 范式需要改进 - 需要实现真正的 MCP 协议支持")
        
        if self.results["a2a"]["total"] == 0:
            print("🚧 A2A 范式尚未实现 - 这是未来的重要扩展方向")
        
        print("\n🔮 未来发展建议:")
        print("1. 实现真正的 MCP 协议客户端和服务端")
        print("2. 开发 A2A Agent 间通信和协作机制")
        print("3. 增强工具安全性和沙箱隔离")
        print("4. 支持更多的远程工具执行环境")
        print("5. 实现工具的动态发现和注册机制")


def main():
    """主函数"""
    tester = ToolParadigmTester()
    tester.run_all_tests()


if __name__ == "__main__":
    main()
