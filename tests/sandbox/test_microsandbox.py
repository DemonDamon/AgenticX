"""Tests for agenticx.sandbox.backends.microsandbox module.

Tests the microsandbox backend implementation using the
zerocore-ai/microsandbox Python SDK.

Note:
    - Most tests require a running microsandbox server.
    - Tests are skipped if the microsandbox SDK is not available
      or the server is not running.
    - Basic functionality tests (e.g., import, availability check)
      always run.

Author: Damon Li
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from agenticx.sandbox.backends.microsandbox import (
    MicrosandboxSandbox,
    is_microsandbox_available,
    MICROSANDBOX_AVAILABLE,
)
from agenticx.sandbox.types import (
    SandboxStatus,
    ExecutionResult,
    HealthStatus,
    SandboxTimeoutError,
    SandboxNotReadyError,
    SandboxBackendError,
    SandboxExecutionError,
)
from agenticx.sandbox.template import SandboxTemplate


# Skip condition: microsandbox SDK not available
skip_if_no_sdk = pytest.mark.skipif(
    not MICROSANDBOX_AVAILABLE,
    reason="microsandbox SDK is not installed"
)


class TestMicrosandboxAvailability:
    """Microsandbox SDK availability tests (always run)."""

    def test_is_microsandbox_available(self):
        """Test the is_microsandbox_available function."""
        result = is_microsandbox_available()
        # Return value should be boolean
        assert isinstance(result, bool)

    def test_microsandbox_available_constant(self):
        """Test the MICROSANDBOX_AVAILABLE constant."""
        assert isinstance(MICROSANDBOX_AVAILABLE, bool)

    def test_import_error_handling(self):
        """Test error handling when SDK is not available."""
        if not MICROSANDBOX_AVAILABLE:
            with pytest.raises(SandboxBackendError) as exc_info:
                MicrosandboxSandbox()
            assert "not installed" in str(exc_info.value).lower()


@skip_if_no_sdk
class TestMicrosandboxSandboxInit:
    """MicrosandboxSandbox initialization tests."""

    def test_default_init(self):
        """Test default initialization."""
        sandbox = MicrosandboxSandbox()

        assert sandbox.status == SandboxStatus.PENDING
        assert sandbox.sandbox_id is not None
        assert sandbox.namespace == "default"
        assert "127.0.0.1:5555" in sandbox.server_url

    def test_custom_init(self):
        """Test initialization with custom parameters."""
        sandbox = MicrosandboxSandbox(
            sandbox_id="test-sandbox",
            server_url="http://localhost:8080",
            api_key="test-key",
            namespace="test-ns",
            image="python:3.11",
        )

        assert sandbox.sandbox_id == "test-sandbox"
        assert sandbox.server_url == "http://localhost:8080"
        assert sandbox.namespace == "test-ns"

    def test_template_init(self):
        """Test initialization with a template."""
        template = SandboxTemplate(
            name="test",
            cpu=2.0,
            memory_mb=1024,
            timeout_seconds=60,
        )

        sandbox = MicrosandboxSandbox(template=template)

        assert sandbox.template == template
        assert sandbox.template.cpu == 2.0
        assert sandbox.template.memory_mb == 1024


@skip_if_no_sdk
class TestMicrosandboxSandboxMocked:
    """MicrosandboxSandbox mocked tests (no real server required)."""

    @pytest.fixture
    def mock_python_sandbox(self):
        """Create a mocked PythonSandbox instance."""
        mock = MagicMock()
        mock._is_started = False
        mock._session = None

        # Mock start method
        async def mock_start(*args, **kwargs):
            mock._is_started = True
        mock.start = AsyncMock(side_effect=mock_start)

        # Mock stop method
        async def mock_stop():
            mock._is_started = False
        mock.stop = AsyncMock(side_effect=mock_stop)

        # Mock run method
        mock_execution = MagicMock()
        mock_execution.output = AsyncMock(return_value="Hello, World!")
        mock_execution.error = AsyncMock(return_value="")
        mock_execution.has_error = MagicMock(return_value=False)
        mock.run = AsyncMock(return_value=mock_execution)

        # Mock command.run method
        mock_cmd_execution = MagicMock()
        mock_cmd_execution.output = AsyncMock(return_value="/home/user")
        mock_cmd_execution.error = AsyncMock(return_value="")
        mock_cmd_execution.exit_code = 0
        mock.command = MagicMock()
        mock.command.run = AsyncMock(return_value=mock_cmd_execution)

        # Mock metrics attribute
        mock.metrics = MagicMock()
        mock.metrics.cpu = AsyncMock(return_value=25.5)
        mock.metrics.memory = AsyncMock(return_value=128)
        mock.metrics.disk = AsyncMock(return_value=1024000)
        mock.metrics.is_running = AsyncMock(return_value=True)

        return mock

    @pytest.mark.asyncio
    async def test_start_stop_mocked(self, mock_python_sandbox):
        """Test start and stop with mocked backend."""
        with patch('agenticx.sandbox.backends.microsandbox.PythonSandbox', return_value=mock_python_sandbox):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = MagicMock()
                mock_session.close = AsyncMock()
                mock_session_class.return_value = mock_session

                sandbox = MicrosandboxSandbox()

                # Test start
                await sandbox.start()
                assert sandbox.status == SandboxStatus.RUNNING
                mock_python_sandbox.start.assert_called_once()

                # Test stop
                await sandbox.stop()
                assert sandbox.status == SandboxStatus.STOPPED
                mock_python_sandbox.stop.assert_called_once()

    @pytest.mark.asyncio
    async def test_execute_python_mocked(self, mock_python_sandbox):
        """Test Python code execution with mocked backend."""
        with patch('agenticx.sandbox.backends.microsandbox.PythonSandbox', return_value=mock_python_sandbox):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = MagicMock()
                mock_session.close = AsyncMock()
                mock_session_class.return_value = mock_session

                sandbox = MicrosandboxSandbox()
                await sandbox.start()

                result = await sandbox.execute("print('Hello, World!')")

                assert result.success is True
                assert result.stdout == "Hello, World!"
                assert result.stderr == ""
                mock_python_sandbox.run.assert_called_once_with("print('Hello, World!')")

                await sandbox.stop()

    @pytest.mark.asyncio
    async def test_execute_shell_mocked(self, mock_python_sandbox):
        """Test shell command execution with mocked backend."""
        with patch('agenticx.sandbox.backends.microsandbox.PythonSandbox', return_value=mock_python_sandbox):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = MagicMock()
                mock_session.close = AsyncMock()
                mock_session_class.return_value = mock_session

                sandbox = MicrosandboxSandbox()
                await sandbox.start()

                result = await sandbox.execute("pwd", language="shell")

                assert result.success is True
                assert result.stdout == "/home/user"
                mock_python_sandbox.command.run.assert_called_once_with("pwd")

                await sandbox.stop()

    @pytest.mark.asyncio
    async def test_get_metrics_mocked(self, mock_python_sandbox):
        """Test resource metrics retrieval with mocked backend."""
        with patch('agenticx.sandbox.backends.microsandbox.PythonSandbox', return_value=mock_python_sandbox):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = MagicMock()
                mock_session.close = AsyncMock()
                mock_session_class.return_value = mock_session

                sandbox = MicrosandboxSandbox()
                await sandbox.start()

                metrics = await sandbox.get_metrics()

                assert metrics["cpu_percent"] == 25.5
                assert metrics["memory_mb"] == 128
                assert metrics["disk_bytes"] == 1024000
                assert metrics["is_running"] is True

                await sandbox.stop()

    @pytest.mark.asyncio
    async def test_stateful_execution_mocked(self, mock_python_sandbox):
        """Test stateful execution with mocked backend."""
        # Simulate stateful execution: first call sets a variable, second reads it
        execution_results = [
            ("", "", False),  # x = 1
            ("1\n", "", False),  # print(x)
        ]
        call_count = [0]

        async def mock_run(code):
            idx = min(call_count[0], len(execution_results) - 1)
            call_count[0] += 1
            stdout, stderr, has_error = execution_results[idx]

            mock_exec = MagicMock()
            mock_exec.output = AsyncMock(return_value=stdout)
            mock_exec.error = AsyncMock(return_value=stderr)
            mock_exec.has_error = MagicMock(return_value=has_error)
            return mock_exec

        mock_python_sandbox.run = AsyncMock(side_effect=mock_run)

        with patch('agenticx.sandbox.backends.microsandbox.PythonSandbox', return_value=mock_python_sandbox):
            with patch('aiohttp.ClientSession') as mock_session_class:
                mock_session = MagicMock()
                mock_session.close = AsyncMock()
                mock_session_class.return_value = mock_session

                sandbox = MicrosandboxSandbox(namespace="test-ns")
                await sandbox.start()

                # First execution: set a variable
                result1 = await sandbox.execute("x = 1")
                assert result1.success is True

                # Second execution: read the variable
                result2 = await sandbox.execute("print(x)")
                assert result2.success is True
                assert "1" in result2.stdout

                await sandbox.stop()


@skip_if_no_sdk
class TestMicrosandboxErrorMapping:
    """Error mapping tests."""

    def test_map_timeout_error(self):
        """Test timeout error mapping."""
        sandbox = MicrosandboxSandbox()
        error = TimeoutError("Operation timed out")

        mapped = sandbox._map_error(error)

        assert isinstance(mapped, SandboxTimeoutError)
        assert "timed out" in str(mapped).lower()

    def test_map_not_started_error(self):
        """Test not-started error mapping."""
        sandbox = MicrosandboxSandbox()
        error = RuntimeError("Sandbox is not started")

        mapped = sandbox._map_error(error)

        assert isinstance(mapped, SandboxNotReadyError)

    def test_map_execution_error(self):
        """Test execution error mapping."""
        sandbox = MicrosandboxSandbox()
        error = RuntimeError("Failed to execute code: syntax error")

        mapped = sandbox._map_error(error)

        assert isinstance(mapped, SandboxExecutionError)

    def test_map_backend_error(self):
        """Test backend error mapping."""
        sandbox = MicrosandboxSandbox()
        error = RuntimeError("Connection refused")

        mapped = sandbox._map_error(error)

        assert isinstance(mapped, SandboxBackendError)
        assert mapped.backend == "microsandbox"

    def test_map_unknown_error(self):
        """Test unknown error mapping."""
        sandbox = MicrosandboxSandbox()
        error = ValueError("Unknown error")

        mapped = sandbox._map_error(error)

        assert isinstance(mapped, SandboxBackendError)


@skip_if_no_sdk
class TestMicrosandboxNotRunning:
    """Tests for sandbox not-running state."""

    @pytest.mark.asyncio
    async def test_execute_not_running(self):
        """Test execution when sandbox is not running."""
        sandbox = MicrosandboxSandbox()

        with pytest.raises(SandboxNotReadyError):
            await sandbox.execute("print('test')")

    @pytest.mark.asyncio
    async def test_get_metrics_not_running(self):
        """Test metrics retrieval when sandbox is not running."""
        sandbox = MicrosandboxSandbox()

        with pytest.raises(SandboxNotReadyError):
            await sandbox.get_metrics()

    @pytest.mark.asyncio
    async def test_read_file_not_running(self):
        """Test file reading when sandbox is not running."""
        sandbox = MicrosandboxSandbox()

        with pytest.raises(SandboxNotReadyError):
            await sandbox.read_file("/tmp/test.txt")

    @pytest.mark.asyncio
    async def test_health_check_not_running(self):
        """Test health check when sandbox is not running."""
        sandbox = MicrosandboxSandbox()
        health = await sandbox.check_health()

        assert health.status == "unhealthy"
        assert "not running" in health.message.lower()


@skip_if_no_sdk
class TestMicrosandboxProperties:
    """Property tests."""

    def test_namespace_property(self):
        """Test the namespace property."""
        sandbox = MicrosandboxSandbox(namespace="test-ns")
        assert sandbox.namespace == "test-ns"

    def test_server_url_property(self):
        """Test the server_url property."""
        sandbox = MicrosandboxSandbox(server_url="http://example.com:5555")
        assert sandbox.server_url == "http://example.com:5555"


# =============================================================================
# Integration tests (require a real microsandbox server)
# =============================================================================

@skip_if_no_sdk
@pytest.mark.skipif(
    True,  # Skip integration tests by default; enable manually
    reason="Integration tests require a running microsandbox server"
)
class TestMicrosandboxIntegration:
    """Integration tests (require a real microsandbox server).

    To enable:
        1. Install microsandbox: pip install microsandbox
        2. Start the server: msb server start
        3. Change the skipif condition to False
    """

    @pytest.mark.asyncio
    async def test_real_start_stop(self):
        """Test real sandbox start and stop."""
        sandbox = MicrosandboxSandbox()

        await sandbox.start()
        assert sandbox.status == SandboxStatus.RUNNING

        await sandbox.stop()
        assert sandbox.status == SandboxStatus.STOPPED

    @pytest.mark.asyncio
    async def test_real_execute_python(self):
        """Test real Python code execution."""
        async with MicrosandboxSandbox() as sandbox:
            result = await sandbox.execute("print('Hello, Microsandbox!')")

            assert result.success is True
            assert "Hello, Microsandbox!" in result.stdout

    @pytest.mark.asyncio
    async def test_real_stateful_execution(self):
        """Test real stateful execution."""
        async with MicrosandboxSandbox() as sandbox:
            # Set a variable
            result1 = await sandbox.execute("x = 42")
            assert result1.success is True

            # Read the variable
            result2 = await sandbox.execute("print(x)")
            assert result2.success is True
            assert "42" in result2.stdout

    @pytest.mark.asyncio
    async def test_real_shell_command(self):
        """Test real shell command execution."""
        async with MicrosandboxSandbox() as sandbox:
            result = await sandbox.execute("echo 'Hello Shell'", language="shell")

            assert result.success is True
            assert "Hello Shell" in result.stdout

    @pytest.mark.asyncio
    async def test_real_metrics(self):
        """Test real resource metrics retrieval."""
        async with MicrosandboxSandbox() as sandbox:
            metrics = await sandbox.get_metrics()

            assert "cpu_percent" in metrics
            assert "memory_mb" in metrics
            assert "disk_bytes" in metrics
            assert metrics["is_running"] is True

    @pytest.mark.asyncio
    async def test_real_file_operations(self):
        """Test real file operations."""
        async with MicrosandboxSandbox() as sandbox:
            # Write a file
            await sandbox.write_file("/tmp/test.txt", "Hello File")

            # Read the file
            content = await sandbox.read_file("/tmp/test.txt")
            assert content == "Hello File"

            # List directory
            files = await sandbox.list_directory("/tmp")
            assert any("test.txt" in f.path for f in files)

            # Delete the file
            await sandbox.delete_file("/tmp/test.txt")

    @pytest.mark.asyncio
    async def test_real_health_check(self):
        """Test real health check."""
        async with MicrosandboxSandbox() as sandbox:
            health = await sandbox.check_health()

            assert health.status == "ok"
            assert health.latency_ms > 0
