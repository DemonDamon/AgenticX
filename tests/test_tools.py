"""
AgenticX M3 工具系统测试

使用 pytest 框架测试 M3 工具系统的各个组件。
"""

import pytest
import asyncio
import tempfile
import sys
from pathlib import Path
from typing import Any

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from agenticx.tools.base import BaseTool, ToolError, ToolValidationError
from agenticx.tools.function_tool import FunctionTool, tool
from agenticx.tools.executor import ToolExecutor, ExecutionResult
from agenticx.tools.credentials import CredentialStore
from agenticx.tools.builtin import FileTool, WebSearchTool

from pydantic import BaseModel, Field


class TestToolsSystem:
    """工具系统测试套件"""
    
    def test_module_imports(self):
        """测试模块导入"""
        # 所有导入都在文件顶部完成，如果能执行到这里说明导入成功
        assert BaseTool is not None
        assert FunctionTool is not None
        assert tool is not None
        assert ToolExecutor is not None
        assert CredentialStore is not None
        
    def test_basic_tool(self):
        """测试基础工具功能"""
        
        class SimpleTool(BaseTool):
            def _run(self, **kwargs):
                return f"Hello, {kwargs.get('name', 'World')}!"
        
        tool_instance = SimpleTool(
            name="simple_tool",
            description="A simple test tool"
        )
        
        assert tool_instance.name == "simple_tool"
        assert tool_instance.description == "A simple test tool"
        
        result = tool_instance.run(name="AgenticX")
        assert result == "Hello, AgenticX!"
    
    def test_function_tool(self):
        """测试函数工具和装饰器"""
        
        @tool(name="calculator", timeout=5.0)
        def add_numbers(a: int, b: int) -> int:
            """Add two numbers.
            
            Args:
                a: First number
                b: Second number
                
            Returns:
                Sum of the numbers
            """
            return a + b
        
        assert add_numbers.name == "calculator"
        assert add_numbers.timeout == 5.0
        
        result = add_numbers.run(a=5, b=3)
        assert result == 8
        
        # 测试 OpenAI schema 生成
        schema = add_numbers.to_openai_schema()
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "calculator"
        assert "Add two numbers" in schema["function"]["description"]
    
    def test_tool_executor(self):
        """测试工具执行器"""
        
        @tool()
        def multiply(x: int, y: int) -> int:
            """Multiply two numbers."""
            return x * y
        
        executor = ToolExecutor(max_retries=2, retry_delay=0.01)
        result = executor.execute(multiply, x=4, y=5)
        
        assert isinstance(result, ExecutionResult)
        assert result.success
        assert result.result == 20
        assert result.retry_count == 0
    
    def test_credential_store(self):
        """测试凭据存储"""
        
        with tempfile.TemporaryDirectory() as temp_dir:
            store = CredentialStore(
                storage_path=Path(temp_dir) / "test_creds",
                enable_encryption=False
            )
            
            # 设置凭据
            store.set_credential("test_org", "test_tool", {"api_key": "secret123"})
            
            # 获取凭据
            creds = store.get_credential("test_org", "test_tool")
            assert creds is not None
            assert creds["api_key"] == "secret123"
            
            # 删除凭据
            assert store.delete_credential("test_org", "test_tool")
            assert store.get_credential("test_org", "test_tool") is None
    
    def test_builtin_tools(self):
        """测试内置工具"""
        
        # 测试文件工具
        with tempfile.TemporaryDirectory() as temp_dir:
            file_tool = FileTool(allowed_paths=[temp_dir])
            
            test_file = Path(temp_dir) / "test.txt"
            content = "Hello, AgenticX Tools!"
            
            # 写入文件
            write_result = file_tool.run(
                action="write",
                file_path=str(test_file),
                content=content
            )
            assert "Successfully wrote" in write_result
            
            # 读取文件
            read_result = file_tool.run(
                action="read",
                file_path=str(test_file)
            )
            assert read_result == content
        
    def test_comprehensive_workflow(self):
        """测试综合工作流"""
        
        @tool(name="calculator")
        def calculate(operation: str, a: float, b: float) -> float:
            """Perform mathematical operations."""
            operations = {
                "add": lambda x, y: x + y,
                "multiply": lambda x, y: x * y,
                "divide": lambda x, y: x / y if y != 0 else float('inf')
            }
            if operation not in operations:
                raise ValueError(f"Unknown operation: {operation}")
            return operations[operation](a, b)
        
        @tool(name="formatter")
        def format_number(value: float, precision: int = 2) -> str:
            """Format a number with specified precision."""
            return f"{value:.{precision}f}"
        
        executor = ToolExecutor()
        
        # 执行计算
        calc_result = executor.execute(
            calculate,
            operation="multiply",
            a=12.5,
            b=8.0
        )
        assert calc_result.success
        assert calc_result.result == 100.0
        
        # 格式化结果
        format_result = executor.execute(
            format_number,
            value=calc_result.result,
            precision=1
        )
        assert format_result.success
        assert format_result.result == "100.0"


if __name__ == "__main__":
    # 如果直接运行此文件，执行基本的测试
    import sys
    
    print("🧪 运行 AgenticX M3 工具系统基础测试...")
    
    test_suite = TestToolsSystem()
    tests = [
        ("模块导入", test_suite.test_module_imports),
        ("基础工具", test_suite.test_basic_tool),
        ("函数工具", test_suite.test_function_tool),
        ("工具执行器", test_suite.test_tool_executor),
        ("凭据存储", test_suite.test_credential_store),
        ("内置工具", test_suite.test_builtin_tools),
        ("综合工作流", test_suite.test_comprehensive_workflow),
    ]
    
    passed = 0
    for test_name, test_func in tests:
        try:
            test_func()
            print(f"✅ {test_name} 测试通过")
            passed += 1
        except Exception as e:
            print(f"❌ {test_name} 测试失败: {e}")
    
    print(f"\n📊 测试结果: {passed}/{len(tests)} 通过")
    
    if passed == len(tests):
        print("🎉 所有基础测试通过！")
    else:
        print("❌ 部分测试失败")
        sys.exit(1)
