"""
Tests for agenticx.sandbox.code_interpreter module
"""

import pytest
import asyncio

from agenticx.sandbox.code_interpreter import (
    CodeInterpreterSandbox,
    execute_code,
)
from agenticx.sandbox.types import (
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    SandboxTimeoutError,
    SandboxNotReadyError,
)
from agenticx.sandbox.template import SandboxTemplate


class TestCodeInterpreterSandbox:
    """CodeInterpreterSandbox 测试"""
    
    @pytest.mark.asyncio
    async def test_start_stop(self):
        """测试启动和停止"""
        interpreter = CodeInterpreterSandbox()
        
        assert not interpreter.is_ready
        
        await interpreter.start()
        assert interpreter.is_ready
        assert interpreter.uptime_seconds >= 0
        
        await interpreter.stop()
        assert not interpreter.is_ready
    
    @pytest.mark.asyncio
    async def test_context_manager(self):
        """测试上下文管理器"""
        async with CodeInterpreterSandbox() as interpreter:
            assert interpreter.is_ready
        
        assert not interpreter.is_ready
    
    @pytest.mark.asyncio
    async def test_run_python(self):
        """测试执行 Python 代码"""
        async with CodeInterpreterSandbox() as interpreter:
            result = await interpreter.run("print('Hello from interpreter!')")
            
            assert result.success is True
            assert "Hello from interpreter!" in result.stdout
    
    @pytest.mark.asyncio
    async def test_run_python_convenience(self):
        """测试 run_python 便捷方法"""
        async with CodeInterpreterSandbox() as interpreter:
            result = await interpreter.run_python("print(1 + 1)")
            
            assert result.success is True
            assert "2" in result.stdout
    
    @pytest.mark.asyncio
    async def test_run_shell(self):
        """测试 run_shell 便捷方法"""
        async with CodeInterpreterSandbox() as interpreter:
            result = await interpreter.run_shell("echo 'Shell test'")
            
            assert result.success is True
            assert "Shell test" in result.stdout
    
    @pytest.mark.asyncio
    async def test_execution_history(self):
        """测试执行历史"""
        async with CodeInterpreterSandbox() as interpreter:
            await interpreter.run("print(1)")
            await interpreter.run("print(2)")
            await interpreter.run("print(3)")
            
            assert interpreter.execution_count == 3
            history = interpreter.execution_history
            assert len(history) == 3
    
    @pytest.mark.asyncio
    async def test_health_check(self):
        """测试健康检查"""
        async with CodeInterpreterSandbox() as interpreter:
            health = await interpreter.health_check()
            
            assert health.status == "ok"
    
    @pytest.mark.asyncio
    async def test_file_operations(self):
        """测试文件操作"""
        async with CodeInterpreterSandbox() as interpreter:
            # 写入文件
            await interpreter.write_file("data.txt", "test content")
            
            # 读取文件
            content = await interpreter.read_file("data.txt")
            assert content == "test content"
    
    @pytest.mark.asyncio
    async def test_auto_restart_disabled(self):
        """测试禁用自动重启"""
        interpreter = CodeInterpreterSandbox(auto_restart=False)
        
        with pytest.raises(SandboxNotReadyError):
            await interpreter.run("print('test')")
    
    @pytest.mark.asyncio
    async def test_auto_restart_enabled(self):
        """测试启用自动重启"""
        async with CodeInterpreterSandbox(auto_restart=True) as interpreter:
            result = await interpreter.run("print('auto started')")
            assert result.success is True
    
    @pytest.mark.asyncio
    async def test_timeout(self):
        """测试执行超时"""
        async with CodeInterpreterSandbox() as interpreter:
            with pytest.raises(SandboxTimeoutError):
                await interpreter.run(
                    "import time; time.sleep(60)",
                    timeout=1,
                    retry=False,
                )
    
    @pytest.mark.asyncio
    async def test_repr(self):
        """测试字符串表示"""
        async with CodeInterpreterSandbox() as interpreter:
            repr_str = repr(interpreter)
            assert "CodeInterpreterSandbox" in repr_str
            assert "ready" in repr_str
    
    @pytest.mark.asyncio
    async def test_restart(self):
        """测试重启"""
        async with CodeInterpreterSandbox() as interpreter:
            await interpreter.run("x = 1")
            
            await interpreter.restart()
            
            assert interpreter.is_ready
            # 重启后状态清空
            assert interpreter.execution_count == 1  # 只有重启前的一次


class TestCodeInterpreterSandboxBackends:
    """后端选择测试"""
    
    @pytest.mark.asyncio
    async def test_subprocess_backend(self):
        """测试 subprocess 后端"""
        async with CodeInterpreterSandbox(backend="subprocess") as interpreter:
            result = await interpreter.run("print('subprocess')")
            assert result.success is True
    
    @pytest.mark.asyncio
    async def test_auto_backend(self):
        """测试自动后端选择"""
        async with CodeInterpreterSandbox(backend="auto") as interpreter:
            result = await interpreter.run("print('auto')")
            assert result.success is True


class TestExecuteCodeFunction:
    """execute_code 函数测试"""
    
    @pytest.mark.asyncio
    async def test_simple_execution(self):
        """测试简单执行"""
        result = await execute_code("print('one-shot')")
        
        assert result.success is True
        assert "one-shot" in result.stdout
    
    @pytest.mark.asyncio
    async def test_with_timeout(self):
        """测试带超时的执行"""
        result = await execute_code(
            "print('quick')",
            timeout=10,
        )
        
        assert result.success is True
    
    @pytest.mark.asyncio
    async def test_shell_language(self):
        """测试 Shell 语言"""
        result = await execute_code(
            "echo 'shell command'",
            language="shell",
        )
        
        assert result.success is True
        assert "shell command" in result.stdout
    
    @pytest.mark.asyncio
    async def test_execution_error(self):
        """测试执行错误"""
        result = await execute_code("import nonexistent_module_xyz")
        
        assert result.success is False
        assert "ModuleNotFoundError" in result.stderr


class TestCodeInterpreterSandboxConcurrency:
    """并发测试"""
    
    @pytest.mark.asyncio
    async def test_sequential_runs(self):
        """测试顺序执行"""
        async with CodeInterpreterSandbox() as interpreter:
            for i in range(5):
                result = await interpreter.run(f"print({i})")
                assert result.success is True
    
    @pytest.mark.asyncio
    async def test_concurrent_interpreters(self):
        """测试并发解释器"""
        async def run_interpreter(index):
            async with CodeInterpreterSandbox() as interpreter:
                result = await interpreter.run(f"print('Interpreter {index}')")
                return result
        
        tasks = [run_interpreter(i) for i in range(3)]
        results = await asyncio.gather(*tasks)
        
        assert len(results) == 3
        assert all(r.success for r in results)
