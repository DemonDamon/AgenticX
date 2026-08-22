#!/usr/bin/env python3
"""
AgenticX 端到端测试：Agent + LLM + Tools 集成测试

测试真实的 Agent 使用 LLM 进行 Function Call 来调用工具完成任务。
包括计算器、文件操作、代码执行等场景。
"""

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Any, Optional

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.core import Agent, Task, Message
from agenticx.llms import LiteLLMProvider
from agenticx.tools import tool, ToolExecutor, FileTool


class AgentToolsE2ETester:
    """Agent + Tools 端到端测试器"""
    
    def __init__(self, api_key: Optional[str] = None, model: str = "deepseek/deepseek-chat"):
        """
        初始化测试器
        
        Args:
            api_key: LLM API 密钥，如果为 None 则从环境变量读取
            model: 使用的模型名称
        """
        self.model = model
        self.api_key = api_key or os.getenv("DEEPSEEK_API_KEY")
        
        if not self.api_key:
            print("⚠️  警告: 未设置 API 密钥，将使用模拟模式")
            self.use_mock = True
        else:
            self.use_mock = False
        
        # 初始化 LLM Provider
        if not self.use_mock:
            self.llm = LiteLLMProvider(model=self.model, api_key=self.api_key)
        
        # 初始化工具执行器
        self.executor = ToolExecutor()
        
        # 注册工具
        self.tools = self._setup_tools()
        
        # 创建 Agent
        self.agent = Agent(
            name="AgenticX测试助手",
            role="智能助手",
            goal="帮助用户完成各种计算、文件操作和代码执行任务",
            backstory="我是一个能够调用工具的智能助手，可以进行数学计算、文件操作和代码执行。",
            organization_id="test_org"
        )
    
    def _setup_tools(self) -> Dict[str, Any]:
        """设置可用工具"""
        
        @tool(name="calculator")
        def calculate(expression: str) -> str:
            """执行数学计算
            
            Args:
                expression: 数学表达式，如 "1000 + 2000" 或 "10 * 5 + 3"
                
            Returns:
                计算结果
            """
            try:
                # 安全的数学表达式计算
                allowed_chars = set('0123456789+-*/()., ')
                if not all(c in allowed_chars for c in expression):
                    return f"错误：表达式包含不安全的字符"
                
                result = eval(expression)
                return f"计算结果：{expression} = {result}"
            except Exception as e:
                return f"计算错误：{str(e)}"
        
        @tool(name="file_writer")
        def write_file(filename: str, content: str) -> str:
            """写入文件
            
            Args:
                filename: 文件名
                content: 文件内容
                
            Returns:
                操作结果
            """
            try:
                with tempfile.NamedTemporaryFile(mode='w', suffix=f"_{filename}", delete=False) as f:
                    f.write(content)
                    temp_path = f.name
                return f"文件已写入：{temp_path}"
            except Exception as e:
                return f"写入失败：{str(e)}"
        
        @tool(name="code_executor")
        def execute_python(code: str) -> str:
            """执行 Python 代码
            
            Args:
                code: Python 代码
                
            Returns:
                执行结果
            """
            try:
                # 简单的代码执行（实际应用中需要更安全的沙箱）
                local_vars = {}
                exec(code, {"__builtins__": {"print": print, "len": len, "str": str, "int": int, "float": float}}, local_vars)
                
                # 获取 result 变量的值
                if 'result' in local_vars:
                    return f"代码执行成功，结果：{local_vars['result']}"
                else:
                    return "代码执行成功（无返回值）"
            except Exception as e:
                return f"代码执行错误：{str(e)}"
        
        return {
            "calculator": calculate,
            "file_writer": write_file,
            "code_executor": execute_python
        }
    
    def _tools_to_openai_schema(self) -> List[Dict[str, Any]]:
        """将工具转换为 OpenAI Function Call 格式"""
        schemas = []
        for tool_name, tool_func in self.tools.items():
            schemas.append(tool_func.to_openai_schema())
        return schemas
    
    def _mock_llm_response(self, user_input: str) -> Dict[str, Any]:
        """模拟 LLM 响应（当没有真实 API 时使用）"""
        user_lower = user_input.lower()
        
        if "计算" in user_input or "+" in user_input or "-" in user_input or "*" in user_input or "/" in user_input:
            # 尝试提取数学表达式
            import re
            numbers = re.findall(r'\d+', user_input)
            if len(numbers) >= 2:
                if "+" in user_input:
                    expression = f"{numbers[0]} + {numbers[1]}"
                elif "*" in user_input:
                    expression = f"{numbers[0]} * {numbers[1]}"
                else:
                    expression = f"{numbers[0]} + {numbers[1]}"
                
                return {
                    "choices": [{
                        "message": {
                            "content": "我来帮您计算",
                            "tool_calls": [{
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": "calculator",
                                    "arguments": json.dumps({"expression": expression})
                                }
                            }]
                        }
                    }]
                }
        
        elif "写文件" in user_input or "保存" in user_input:
            return {
                "choices": [{
                    "message": {
                        "content": "我来帮您写文件",
                        "tool_calls": [{
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "file_writer",
                                "arguments": json.dumps({
                                    "filename": "test.txt",
                                    "content": "这是测试内容"
                                })
                            }
                        }]
                    }
                }]
            }
        
        elif "代码" in user_input or "python" in user_lower:
            return {
                "choices": [{
                    "message": {
                        "content": "我来执行代码",
                        "tool_calls": [{
                            "id": "call_1",
                            "type": "function",
                            "function": {
                                "name": "code_executor",
                                "arguments": json.dumps({
                                    "code": "result = 2 ** 10"
                                })
                            }
                        }]
                    }
                }]
            }
        
        # 默认响应
        return {
            "choices": [{
                "message": {
                    "content": f"收到您的请求：{user_input}。我现在还没有合适的工具来处理这个请求。"
                }
            }]
        }
    
    async def process_user_input(self, user_input: str) -> str:
        """处理用户输入，让 Agent 调用工具完成任务"""
        
        print(f"\n🤖 Agent: {self.agent.name}")
        print(f"📝 用户输入: {user_input}")
        print("-" * 50)
        
        # 构建 system prompt
        system_prompt = f"""你是 {self.agent.name}，{self.agent.backstory}

你有以下工具可以使用：
{json.dumps(self._tools_to_openai_schema(), indent=2, ensure_ascii=False)}

请根据用户的请求，选择合适的工具来完成任务。如果需要计算，使用 calculator 工具；如果需要写文件，使用 file_writer 工具；如果需要执行代码，使用 code_executor 工具。

用户请求：{user_input}"""

        try:
            if self.use_mock:
                print("🔄 使用模拟模式...")
                response = self._mock_llm_response(user_input)
            else:
                print("🔄 调用真实 LLM...")
                # 调用真实 LLM
                llm_response = await self.llm.ainvoke(
                    system_prompt,
                    tools=self._tools_to_openai_schema()
                )
                response = {"choices": [{"message": llm_response.content}]}
            
            # 解析 LLM 响应
            message = response["choices"][0]["message"]
            
            if isinstance(message, dict) and "tool_calls" in message:
                # LLM 决定调用工具
                tool_calls = message["tool_calls"]
                results = []
                
                for tool_call in tool_calls:
                    function_name = tool_call["function"]["name"]
                    function_args = json.loads(tool_call["function"]["arguments"])
                    
                    print(f"🔧 调用工具: {function_name}")
                    print(f"📋 参数: {function_args}")
                    
                    if function_name in self.tools:
                        tool_func = self.tools[function_name]
                        result = self.executor.execute(tool_func, **function_args)
                        
                        if result.success:
                            print(f"✅ 工具执行成功: {result.result}")
                            results.append(result.result)
                        else:
                            print(f"❌ 工具执行失败: {result.error}")
                            results.append(f"工具执行失败: {result.error}")
                    else:
                        error_msg = f"未找到工具: {function_name}"
                        print(f"❌ {error_msg}")
                        results.append(error_msg)
                
                return "\n".join(results)
            
            else:
                # LLM 直接回复，没有调用工具
                if isinstance(message, dict):
                    content = message.get("content", str(message))
                else:
                    content = str(message)
                print(f"💬 Agent 回复: {content}")
                return content
                
        except Exception as e:
            error_msg = f"处理请求时出错: {str(e)}"
            print(f"❌ {error_msg}")
            return error_msg
    
    def run_interactive_test(self):
        """运行交互式测试"""
        print("🚀 AgenticX 端到端交互式测试")
        print("=" * 60)
        print(f"🤖 Agent: {self.agent.name}")
        print(f"🎯 目标: {self.agent.goal}")
        print(f"🔧 可用工具: {', '.join(self.tools.keys())}")
        
        if self.use_mock:
            print("⚠️  模拟模式：使用预设的工具调用逻辑")
        else:
            print(f"🌐 真实模式：使用 {self.model}")
        
        print("\n💡 示例命令:")
        print("- 帮我计算 1000 + 2000")
        print("- 计算 15 * 8")
        print("- 写一个文件保存计算结果")
        print("- 执行 Python 代码计算 2 的 10 次方")
        print("- 退出")
        print("=" * 60)
        
        while True:
            try:
                user_input = input("\n👤 您: ").strip()
                
                if user_input.lower() in ['退出', 'exit', 'quit', 'q']:
                    print("👋 再见！")
                    break
                
                if not user_input:
                    continue
                
                # 异步处理用户输入
                result = asyncio.run(self.process_user_input(user_input))
                print(f"\n🎉 最终结果: {result}")
                
            except KeyboardInterrupt:
                print("\n👋 再见！")
                break
            except Exception as e:
                print(f"\n❌ 错误: {str(e)}")
    
    def run_batch_test(self):
        """运行批量测试"""
        print("🧪 AgenticX 端到端批量测试")
        print("=" * 60)
        
        test_cases = [
            "帮我计算 1000 + 2000",
            "计算 25 * 4",
            "帮我算一下 100 / 5",
            "写一个文件保存测试内容",
            "执行 Python 代码计算平方根"
        ]
        
        passed = 0
        total = len(test_cases)
        
        for i, test_case in enumerate(test_cases, 1):
            print(f"\n📋 测试 {i}/{total}: {test_case}")
            try:
                result = asyncio.run(self.process_user_input(test_case))
                if "错误" not in result and "失败" not in result:
                    print(f"✅ 测试通过")
                    passed += 1
                else:
                    print(f"❌ 测试失败: {result}")
            except Exception as e:
                print(f"❌ 测试异常: {str(e)}")
        
        print(f"\n📊 测试结果: {passed}/{total} 通过")
        return passed == total


def main():
    """主函数"""
    import argparse
    
    parser = argparse.ArgumentParser(description="AgenticX 端到端测试")
    parser.add_argument("--mode", choices=["interactive", "batch"], default="interactive",
                       help="测试模式：interactive（交互式）或 batch（批量测试）")
    parser.add_argument("--api-key", help="LLM API 密钥")
    parser.add_argument("--model", default="deepseek/deepseek-chat", help="使用的模型")
    
    args = parser.parse_args()
    
    # 创建测试器
    tester = AgentToolsE2ETester(
        api_key=args.api_key,
        model=args.model
    )
    
    if args.mode == "interactive":
        tester.run_interactive_test()
    else:
        success = tester.run_batch_test()
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
