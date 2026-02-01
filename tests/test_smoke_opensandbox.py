"""OpenSandbox integration smoke tests.

Tests the following functionality:
1. ExecdClient basic interface
2. File operations (SubprocessSandbox)
3. Command execution (SubprocessSandbox)
4. Stateful code execution (JupyterKernelManager)
5. Sandbox tools (SandboxFileTool, SandboxCommandTool, SandboxCodeInterpreterTool)

Run with:
    pytest tests/test_smoke_opensandbox.py -v

Author: Damon Li
"""

import asyncio
import pytest
import tempfile
import os
import shutil


# ==================== ExecdClient 测试 ====================

class TestExecdClient:
    """ExecdClient 基础接口测试"""
    
    def test_import_execd_client(self):
        """测试 ExecdClient 可以导入"""
        from agenticx.sandbox import ExecdClient, CodeExecutionResult, CommandExecutionResult
        assert ExecdClient is not None
        assert CodeExecutionResult is not None
        assert CommandExecutionResult is not None
    
    def test_execd_client_init(self):
        """测试 ExecdClient 初始化"""
        from agenticx.sandbox import ExecdClient
        
        client = ExecdClient(
            endpoint="http://localhost:44772",
            token="test_token",
            timeout=30.0,
        )
        
        assert client.endpoint == "http://localhost:44772"
        assert not client.is_connected
    
    def test_code_execution_result_dataclass(self):
        """测试 CodeExecutionResult 数据类"""
        from agenticx.sandbox import CodeExecutionResult
        
        result = CodeExecutionResult(
            stdout="Hello World",
            stderr="",
            result="2",
            exit_code=0,
            success=True,
            duration_ms=100.0,
            language="python",
        )
        
        assert result.stdout == "Hello World"
        assert result.success
        assert result.output == "2"  # result 优先于 stdout


# ==================== 文件操作测试 ====================

class TestFileOperations:
    """SubprocessSandbox 文件操作测试"""
    
    @pytest.fixture
    def sandbox(self):
        """创建测试沙箱"""
        from agenticx.sandbox.backends.subprocess import SubprocessSandbox
        from agenticx.sandbox import SandboxTemplate
        
        return SubprocessSandbox(
            template=SandboxTemplate(name="test", timeout_seconds=30)
        )
    
    @pytest.mark.asyncio
    async def test_write_and_read_file(self, sandbox):
        """测试文件写入和读取"""
        async with sandbox:
            # 写入文件
            await sandbox.write_file("test.txt", "Hello World")
            
            # 读取文件
            content = await sandbox.read_file("test.txt")
            assert content == "Hello World"
    
    @pytest.mark.asyncio
    async def test_list_directory(self, sandbox):
        """测试目录列表"""
        async with sandbox:
            # 创建测试文件
            await sandbox.write_file("file1.txt", "content1")
            await sandbox.write_file("file2.txt", "content2")
            
            # 列出目录
            files = await sandbox.list_directory("/")
            
            # 验证文件存在
            file_paths = [f.path for f in files]
            assert any("file1.txt" in p for p in file_paths)
            assert any("file2.txt" in p for p in file_paths)
    
    @pytest.mark.asyncio
    async def test_delete_file(self, sandbox):
        """测试文件删除"""
        async with sandbox:
            # 创建并删除文件
            await sandbox.write_file("to_delete.txt", "temp content")
            await sandbox.delete_file("to_delete.txt")
            
            # 验证文件已删除
            with pytest.raises(FileNotFoundError):
                await sandbox.read_file("to_delete.txt")
    
    @pytest.mark.asyncio
    async def test_read_nonexistent_file(self, sandbox):
        """测试读取不存在的文件"""
        async with sandbox:
            with pytest.raises(FileNotFoundError):
                await sandbox.read_file("nonexistent.txt")


# ==================== 命令执行测试 ====================

class TestCommandExecution:
    """SubprocessSandbox 命令执行测试"""
    
    @pytest.fixture
    def sandbox(self):
        """创建测试沙箱"""
        from agenticx.sandbox.backends.subprocess import SubprocessSandbox
        from agenticx.sandbox import SandboxTemplate
        
        return SubprocessSandbox(
            template=SandboxTemplate(name="test", timeout_seconds=30)
        )
    
    @pytest.mark.asyncio
    async def test_run_command(self, sandbox):
        """测试命令执行"""
        async with sandbox:
            result = await sandbox.run_command("echo 'Hello World'")
            
            assert result.success
            assert "Hello World" in result.stdout
            assert result.exit_code == 0
    
    @pytest.mark.asyncio
    async def test_run_command_with_error(self, sandbox):
        """测试命令执行失败"""
        async with sandbox:
            result = await sandbox.run_command("exit 1")
            
            assert not result.success
            assert result.exit_code == 1
    
    @pytest.mark.asyncio
    async def test_list_processes(self, sandbox):
        """测试进程列表"""
        async with sandbox:
            processes = await sandbox.list_processes()
            
            # 至少应该有一些进程
            assert isinstance(processes, list)


# ==================== 状态化代码执行测试 ====================

class TestStatefulExecution:
    """JupyterKernelManager 状态化执行测试"""
    
    def test_import_jupyter_kernel(self):
        """测试 Jupyter kernel 模块可以导入"""
        from agenticx.sandbox import (
            JupyterKernelManager,
            StatefulCodeInterpreter,
            is_jupyter_available,
        )
        assert JupyterKernelManager is not None
        assert StatefulCodeInterpreter is not None
    
    @pytest.mark.skip(reason="Jupyter kernel tests require a running kernel environment - skip in CI")
    @pytest.mark.asyncio
    async def test_stateful_variable_persistence(self):
        """测试变量跨执行持久化"""
        from agenticx.sandbox import StatefulCodeInterpreter, is_jupyter_available
        
        if not is_jupyter_available():
            pytest.skip("Jupyter not available")
        
        async with StatefulCodeInterpreter(use_jupyter=True) as interpreter:
            # 第一次执行：定义变量
            result1 = await interpreter.execute("x = 1 + 1")
            assert result1.success
            
            # 第二次执行：使用变量
            result2 = await interpreter.execute("print(x)")
            assert result2.success
            assert "2" in result2.stdout
    
    @pytest.mark.skip(reason="Jupyter kernel tests require a running kernel environment - skip in CI")
    @pytest.mark.asyncio
    async def test_stateful_function_persistence(self):
        """测试函数定义跨执行持久化"""
        from agenticx.sandbox import StatefulCodeInterpreter, is_jupyter_available
        
        if not is_jupyter_available():
            pytest.skip("Jupyter not available")
        
        async with StatefulCodeInterpreter(use_jupyter=True) as interpreter:
            # 第一次执行：定义函数
            result1 = await interpreter.execute(
                "def greet(name): return f'Hello, {name}!'"
            )
            assert result1.success
            
            # 第二次执行：调用函数
            result2 = await interpreter.execute("print(greet('World'))")
            assert result2.success
            assert "Hello, World!" in result2.stdout
    
    @pytest.mark.skip(reason="Jupyter kernel tests require a running kernel environment - skip in CI")
    @pytest.mark.asyncio
    async def test_stateful_import_persistence(self):
        """测试 import 跨执行持久化"""
        from agenticx.sandbox import StatefulCodeInterpreter, is_jupyter_available
        
        if not is_jupyter_available():
            pytest.skip("Jupyter not available")
        
        async with StatefulCodeInterpreter(use_jupyter=True) as interpreter:
            # 第一次执行：导入模块
            result1 = await interpreter.execute("import os")
            assert result1.success
            
            # 第二次执行：使用导入的模块
            result2 = await interpreter.execute("print(os.getcwd())")
            assert result2.success


# ==================== 沙箱工具测试 ====================

class TestSandboxTools:
    """沙箱工具测试"""
    
    def test_import_sandbox_tools(self):
        """测试沙箱工具可以导入"""
        from agenticx.tools import (
            SandboxFileTool,
            SandboxCommandTool,
            SandboxCodeInterpreterTool,
            create_sandbox_tools,
            register_sandbox_tools,
        )
        assert SandboxFileTool is not None
        assert SandboxCommandTool is not None
        assert SandboxCodeInterpreterTool is not None
        assert create_sandbox_tools is not None
        assert register_sandbox_tools is not None
    
    def test_sandbox_file_tool_schema(self):
        """测试 SandboxFileTool 的 schema"""
        from agenticx.tools import SandboxFileTool
        
        tool = SandboxFileTool()
        schema = tool.to_openai_schema()
        
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "sandbox_file"
        assert "path" in schema["function"]["parameters"]["properties"]
        assert "operation" in schema["function"]["parameters"]["properties"]
    
    def test_sandbox_command_tool_schema(self):
        """测试 SandboxCommandTool 的 schema"""
        from agenticx.tools import SandboxCommandTool
        
        tool = SandboxCommandTool()
        schema = tool.to_openai_schema()
        
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "sandbox_command"
        assert "command" in schema["function"]["parameters"]["properties"]
    
    def test_sandbox_code_interpreter_tool_schema(self):
        """测试 SandboxCodeInterpreterTool 的 schema"""
        from agenticx.tools import SandboxCodeInterpreterTool
        
        tool = SandboxCodeInterpreterTool()
        schema = tool.to_openai_schema()
        
        assert schema["type"] == "function"
        assert schema["function"]["name"] == "sandbox_code_interpreter"
        assert "code" in schema["function"]["parameters"]["properties"]
        assert "language" in schema["function"]["parameters"]["properties"]
    
    @pytest.mark.asyncio
    async def test_sandbox_file_tool_with_sandbox(self):
        """测试 SandboxFileTool 与沙箱集成"""
        from agenticx.tools import SandboxFileTool
        from agenticx.sandbox.backends.subprocess import SubprocessSandbox
        from agenticx.sandbox import SandboxTemplate
        
        sandbox = SubprocessSandbox(
            template=SandboxTemplate(name="test", timeout_seconds=30)
        )
        
        async with sandbox:
            tool = SandboxFileTool(sandbox=sandbox)
            
            # 写入文件
            result = await tool.arun(
                path="test.txt",
                operation="write",
                content="Hello from tool"
            )
            assert result["success"]
            
            # 读取文件
            result = await tool.arun(
                path="test.txt",
                operation="read"
            )
            assert result["success"]
            assert result["content"] == "Hello from tool"
    
    @pytest.mark.asyncio
    async def test_sandbox_command_tool_with_sandbox(self):
        """测试 SandboxCommandTool 与沙箱集成"""
        from agenticx.tools import SandboxCommandTool
        from agenticx.sandbox.backends.subprocess import SubprocessSandbox
        from agenticx.sandbox import SandboxTemplate
        
        sandbox = SubprocessSandbox(
            template=SandboxTemplate(name="test", timeout_seconds=30)
        )
        
        async with sandbox:
            tool = SandboxCommandTool(sandbox=sandbox)
            
            result = await tool.arun(command="echo 'Hello from command tool'")
            
            assert result["success"]
            assert "Hello from command tool" in result["stdout"]
    
    def test_create_sandbox_tools(self):
        """测试 create_sandbox_tools 函数"""
        from agenticx.tools import create_sandbox_tools
        
        tools = create_sandbox_tools()
        
        assert len(tools) == 3
        assert tools[0].name == "sandbox_file"
        assert tools[1].name == "sandbox_command"
        assert tools[2].name == "sandbox_code_interpreter"


# ==================== 错误处理测试 ====================

class TestErrorHandling:
    """错误处理测试"""
    
    def test_execd_exceptions_exist(self):
        """测试 execd 异常类存在"""
        from agenticx.sandbox import (
            ExecdConnectionError,
            ExecdExecutionError,
            ExecdTimeoutError,
        )
        assert ExecdConnectionError is not None
        assert ExecdExecutionError is not None
        assert ExecdTimeoutError is not None
    
    @pytest.mark.asyncio
    async def test_sandbox_not_configured_error(self):
        """测试沙箱未配置错误"""
        from agenticx.tools import SandboxFileTool
        from agenticx.tools.base import ToolError
        
        tool = SandboxFileTool()  # 没有配置沙箱
        
        with pytest.raises(ToolError) as exc_info:
            await tool.arun(path="test.txt", operation="read")
        
        assert "Sandbox not configured" in str(exc_info.value)


# ==================== 集成测试 ====================

class TestIntegration:
    """集成测试"""
    
    @pytest.mark.asyncio
    async def test_sandbox_workflow(self):
        """测试完整的沙箱工作流"""
        from agenticx.sandbox import CodeInterpreterSandbox
        
        async with CodeInterpreterSandbox(backend="subprocess") as interpreter:
            # 执行 Python 代码
            result = await interpreter.run("print(1 + 1)")
            assert result.success
            assert "2" in result.stdout
            
            # 执行 Shell 命令
            result = await interpreter.run_shell("echo 'Hello Shell'")
            assert result.success
            assert "Hello Shell" in result.stdout
            
            # 文件操作
            await interpreter.write_file("workflow_test.txt", "Workflow content")
            content = await interpreter.read_file("workflow_test.txt")
            assert content == "Workflow content"
    
    @pytest.mark.asyncio
    async def test_sandbox_tools_workflow(self):
        """测试沙箱工具工作流"""
        from agenticx.tools import (
            SandboxFileTool,
            SandboxCommandTool,
        )
        from agenticx.sandbox.backends.subprocess import SubprocessSandbox
        from agenticx.sandbox import SandboxTemplate
        
        sandbox = SubprocessSandbox(
            template=SandboxTemplate(name="test", timeout_seconds=30)
        )
        
        async with sandbox:
            file_tool = SandboxFileTool(sandbox=sandbox)
            command_tool = SandboxCommandTool(sandbox=sandbox)
            
            # 使用命令工具创建文件
            await command_tool.arun(command="echo 'Created by command' > cmd_file.txt")
            
            # 使用文件工具读取
            result = await file_tool.arun(path="cmd_file.txt", operation="read")
            assert "Created by command" in result["content"]


# ==================== Docker 后端测试 ====================

class TestDockerBackend:
    """Docker 后端测试"""
    
    def test_import_docker_sandbox(self):
        """测试 Docker 后端可以导入"""
        from agenticx.sandbox.backends.docker import (
            DockerSandbox,
            is_docker_available,
            is_docker_sdk_available,
        )
        assert DockerSandbox is not None
        assert is_docker_available is not None
        assert is_docker_sdk_available is not None
    
    def test_docker_sandbox_registered(self):
        """测试 Docker 后端已注册"""
        from agenticx.sandbox.backends import list_backends
        
        backends = list_backends()
        assert "docker" in backends
    
    @pytest.mark.skipif(
        not shutil.which("docker"),
        reason="Docker not installed"
    )
    def test_docker_sandbox_init(self):
        """测试 DockerSandbox 初始化"""
        from agenticx.sandbox.backends.docker import DockerSandbox
        from agenticx.sandbox import SandboxTemplate
        
        sandbox = DockerSandbox(
            template=SandboxTemplate(name="test"),
            image="python:3.11-slim",
        )
        
        assert sandbox.image == "python:3.11-slim"
        assert sandbox.container_id is None  # 尚未启动
    
    @pytest.mark.asyncio
    @pytest.mark.skipif(
        not shutil.which("docker"),
        reason="Docker not installed"
    )
    @pytest.mark.skip(reason="Docker tests require Docker daemon - skip in CI")
    async def test_docker_sandbox_workflow(self):
        """测试 Docker 沙箱工作流"""
        from agenticx.sandbox.backends.docker import DockerSandbox
        from agenticx.sandbox import SandboxTemplate
        
        sandbox = DockerSandbox(
            template=SandboxTemplate(name="test", timeout_seconds=30),
            image="python:3.11-slim",
        )
        
        async with sandbox:
            # 执行 Python 代码
            result = await sandbox.execute("print('Hello from Docker!')")
            assert result.success
            assert "Hello from Docker!" in result.stdout
            
            # 执行 Shell 命令
            result = await sandbox.run_command("echo 'Shell works!'")
            assert result.success
            assert "Shell works!" in result.stdout


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
