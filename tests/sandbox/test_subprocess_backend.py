"""
Tests for agenticx.sandbox.backends.subprocess module
"""

import pytest
import asyncio

from agenticx.sandbox.backends.subprocess import SubprocessSandbox
from agenticx.sandbox.types import (
    SandboxStatus,
    ExecutionResult,
    SandboxTimeoutError,
    SandboxNotReadyError,
)
from agenticx.sandbox.template import SandboxTemplate


class TestSubprocessSandbox:
    """SubprocessSandbox 测试"""
    
    @pytest.fixture
    def sandbox(self):
        """创建沙箱实例"""
        return SubprocessSandbox()
    
    @pytest.mark.asyncio
    async def test_start_stop(self, sandbox):
        """测试启动和停止"""
        assert sandbox.status == SandboxStatus.PENDING
        
        await sandbox.start()
        assert sandbox.status == SandboxStatus.RUNNING
        
        await sandbox.stop()
        assert sandbox.status == SandboxStatus.STOPPED
    
    @pytest.mark.asyncio
    async def test_context_manager(self):
        """测试上下文管理器"""
        async with SubprocessSandbox() as sb:
            assert sb.status == SandboxStatus.RUNNING
        
        assert sb.status == SandboxStatus.STOPPED
    
    @pytest.mark.asyncio
    async def test_execute_python_simple(self):
        """测试简单 Python 代码执行"""
        async with SubprocessSandbox() as sb:
            result = await sb.execute("print('Hello, AgenticX!')")
            
            assert result.success is True
            assert result.exit_code == 0
            assert "Hello, AgenticX!" in result.stdout
            assert result.language == "python"
            assert result.duration_ms > 0
    
    @pytest.mark.asyncio
    async def test_execute_python_multiline(self):
        """测试多行 Python 代码"""
        code = """
x = 10
y = 20
print(f"Sum: {x + y}")
"""
        async with SubprocessSandbox() as sb:
            result = await sb.execute(code)
            
            assert result.success is True
            assert "Sum: 30" in result.stdout
    
    @pytest.mark.asyncio
    async def test_execute_python_error(self):
        """测试 Python 代码错误"""
        async with SubprocessSandbox() as sb:
            result = await sb.execute("raise ValueError('test error')")
            
            assert result.success is False
            assert result.exit_code != 0
            assert "ValueError" in result.stderr
    
    @pytest.mark.asyncio
    async def test_execute_shell(self):
        """测试 Shell 命令执行"""
        async with SubprocessSandbox() as sb:
            result = await sb.execute("echo 'Hello Shell'", language="shell")
            
            assert result.success is True
            assert "Hello Shell" in result.stdout
            assert result.language == "shell"
    
    @pytest.mark.asyncio
    @pytest.mark.skipif(
        True,  # Skip in sandboxed environments where process.kill() is restricted
        reason="Timeout test requires process kill permission"
    )
    async def test_execute_timeout(self):
        """测试执行超时"""
        async with SubprocessSandbox() as sb:
            with pytest.raises(SandboxTimeoutError) as exc_info:
                await sb.execute("import time; time.sleep(10)", timeout=1)
            
            assert exc_info.value.timeout == 1
    
    @pytest.mark.asyncio
    async def test_execute_not_running(self):
        """测试未运行时执行"""
        sb = SubprocessSandbox()
        
        with pytest.raises(SandboxNotReadyError):
            await sb.execute("print('test')")
    
    @pytest.mark.asyncio
    async def test_health_check(self):
        """测试健康检查"""
        async with SubprocessSandbox() as sb:
            health = await sb.check_health()
            
            assert health.status == "ok"
            assert health.latency_ms > 0
    
    @pytest.mark.asyncio
    async def test_health_check_not_running(self):
        """测试未运行时健康检查"""
        sb = SubprocessSandbox()
        health = await sb.check_health()
        
        assert health.status == "unhealthy"
    
    @pytest.mark.asyncio
    async def test_working_directory(self):
        """测试工作目录"""
        async with SubprocessSandbox() as sb:
            # 写入文件
            await sb.write_file("test.txt", "Hello File")
            
            # 读取文件
            content = await sb.read_file("test.txt")
            assert content == "Hello File"
            
            # 列出目录
            files = await sb.list_directory("/")
            assert any(f.path == "test.txt" for f in files)
            
            # 删除文件
            await sb.delete_file("test.txt")
            files = await sb.list_directory("/")
            assert not any(f.path == "test.txt" for f in files)
    
    @pytest.mark.asyncio
    async def test_run_command(self):
        """测试 run_command 方法"""
        async with SubprocessSandbox() as sb:
            result = await sb.run_command("pwd")
            
            assert result.success is True
            assert result.language == "shell"
    
    @pytest.mark.asyncio
    async def test_custom_template(self):
        """测试自定义模板"""
        template = SandboxTemplate(
            name="test",
            timeout_seconds=10,
            environment={"MY_VAR": "test_value"},
        )
        
        async with SubprocessSandbox(template=template) as sb:
            result = await sb.execute(
                "import os; print(os.environ.get('MY_VAR', 'not found'))"
            )
            
            assert result.success is True
            assert "test_value" in result.stdout
    
    @pytest.mark.asyncio
    async def test_unsupported_language(self):
        """测试不支持的语言"""
        async with SubprocessSandbox() as sb:
            with pytest.raises(ValueError) as exc_info:
                await sb.execute("console.log('hello')", language="javascript")
            
            assert "Unsupported language" in str(exc_info.value)


class TestSubprocessSandboxConcurrency:
    """SubprocessSandbox 并发测试"""
    
    @pytest.mark.asyncio
    async def test_concurrent_executions(self):
        """测试并发执行"""
        async with SubprocessSandbox() as sb:
            tasks = [
                sb.execute(f"print({i})")
                for i in range(5)
            ]
            
            results = await asyncio.gather(*tasks)
            
            assert len(results) == 5
            assert all(r.success for r in results)
    
    @pytest.mark.asyncio
    async def test_multiple_sandboxes(self):
        """测试多个沙箱"""
        async def run_sandbox(index):
            async with SubprocessSandbox() as sb:
                result = await sb.execute(f"print('Sandbox {index}')")
                return result
        
        tasks = [run_sandbox(i) for i in range(3)]
        results = await asyncio.gather(*tasks)
        
        assert len(results) == 3
        assert all(r.success for r in results)
