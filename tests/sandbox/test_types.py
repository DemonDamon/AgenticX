"""
Tests for agenticx.sandbox.types module
"""

import pytest
from agenticx.sandbox.types import (
    SandboxType,
    SandboxStatus,
    CodeLanguage,
    ExecutionResult,
    HealthStatus,
    FileInfo,
    ProcessInfo,
    SandboxError,
    SandboxTimeoutError,
    SandboxExecutionError,
    SandboxResourceError,
    SandboxNotReadyError,
    SandboxBackendError,
)


class TestSandboxType:
    """SandboxType 枚举测试"""
    
    def test_code_interpreter_type(self):
        assert SandboxType.CODE_INTERPRETER.value == "code_interpreter"
    
    def test_browser_type(self):
        assert SandboxType.BROWSER.value == "browser"
    
    def test_aio_type(self):
        assert SandboxType.AIO.value == "aio"
    
    def test_string_comparison(self):
        assert SandboxType.CODE_INTERPRETER == "code_interpreter"
        assert SandboxType.BROWSER == "browser"


class TestSandboxStatus:
    """SandboxStatus 枚举测试"""
    
    def test_status_values(self):
        assert SandboxStatus.PENDING.value == "pending"
        assert SandboxStatus.CREATING.value == "creating"
        assert SandboxStatus.RUNNING.value == "running"
        assert SandboxStatus.STOPPING.value == "stopping"
        assert SandboxStatus.STOPPED.value == "stopped"
        assert SandboxStatus.ERROR.value == "error"


class TestCodeLanguage:
    """CodeLanguage 枚举测试"""
    
    def test_language_values(self):
        assert CodeLanguage.PYTHON.value == "python"
        assert CodeLanguage.SHELL.value == "shell"
        assert CodeLanguage.JAVASCRIPT.value == "javascript"


class TestExecutionResult:
    """ExecutionResult 数据类测试"""
    
    def test_default_values(self):
        result = ExecutionResult()
        assert result.stdout == ""
        assert result.stderr == ""
        assert result.exit_code == 0
        assert result.success is True
        assert result.duration_ms == 0.0
        assert result.language == "python"
        assert result.truncated is False
        assert result.metadata == {}
    
    def test_custom_values(self):
        result = ExecutionResult(
            stdout="Hello, World!",
            stderr="Warning: deprecated",
            exit_code=0,
            success=True,
            duration_ms=150.5,
            language="shell",
        )
        assert result.stdout == "Hello, World!"
        assert result.stderr == "Warning: deprecated"
        assert result.duration_ms == 150.5
        assert result.language == "shell"
    
    def test_failed_execution(self):
        result = ExecutionResult(
            stdout="",
            stderr="Error: division by zero",
            exit_code=1,
            success=False,
        )
        assert result.success is False
        assert result.exit_code == 1


class TestHealthStatus:
    """HealthStatus 数据类测试"""
    
    def test_default_values(self):
        status = HealthStatus()
        assert status.status == "unknown"
        assert status.message == ""
        assert status.latency_ms == 0.0
        assert status.checked_at is not None
    
    def test_healthy_status(self):
        status = HealthStatus(
            status="ok",
            message="Sandbox is healthy",
            latency_ms=5.2,
        )
        assert status.status == "ok"
        assert status.latency_ms == 5.2
        assert status.is_healthy is True
    
    def test_unhealthy_status(self):
        status = HealthStatus(
            status="unhealthy",
            message="Connection timeout",
        )
        assert status.status == "unhealthy"
        assert status.is_healthy is False


class TestFileInfo:
    """FileInfo 数据类测试"""
    
    def test_default_values(self):
        info = FileInfo(path="/test.txt", size=100)
        assert info.path == "/test.txt"
        assert info.size == 100
        assert info.is_dir is False
        assert info.modified_at is None
        assert info.permissions == ""
    
    def test_directory_info(self):
        info = FileInfo(
            path="/data",
            size=4096,
            is_dir=True,
        )
        assert info.is_dir is True


class TestProcessInfo:
    """ProcessInfo 数据类测试"""
    
    def test_default_values(self):
        info = ProcessInfo(pid=1234, command="python script.py")
        assert info.pid == 1234
        assert info.command == "python script.py"
        assert info.status == "running"
        assert info.cpu_percent == 0.0
        assert info.memory_mb == 0.0


class TestSandboxExceptions:
    """沙箱异常测试"""
    
    def test_sandbox_error(self):
        error = SandboxError("Generic error")
        assert str(error) == "Generic error"
    
    def test_timeout_error(self):
        error = SandboxTimeoutError("Execution timeout", timeout=30)
        assert error.timeout == 30
        assert "Execution timeout" in str(error)
    
    def test_execution_error(self):
        error = SandboxExecutionError(
            "Code error",
            exit_code=1,
            stderr="NameError: name 'x' is not defined",
        )
        assert error.exit_code == 1
        assert "NameError" in error.stderr
    
    def test_resource_error(self):
        error = SandboxResourceError("Out of memory", resource_type="memory")
        assert error.resource_type == "memory"
    
    def test_not_ready_error(self):
        error = SandboxNotReadyError("Sandbox not started")
        assert isinstance(error, SandboxError)
    
    def test_backend_error(self):
        error = SandboxBackendError("Backend unavailable", backend="docker")
        assert error.backend == "docker"
