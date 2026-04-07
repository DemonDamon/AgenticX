"""
Smoke tests for VeADK SkillBundle-Sandbox integration feature.

Tests the skill execution backend abstraction and integration with SkillBundleLoader.

Author: Damon Li
"""

import pytest

from agenticx.tools.skill_bundle import SkillBundleLoader
from agenticx.tools.skill_execution_backend import (
    LocalSkillBackend,
    SandboxSkillBackend,
    SkillExecutionBackend,
    get_backend,
    get_default_backend,
)


class TestLocalSkillBackend:
    """Test suite for LocalSkillBackend."""

    @pytest.fixture
    def backend(self) -> LocalSkillBackend:
        return LocalSkillBackend()

    def test_backend_initialization(self) -> None:
        backend = LocalSkillBackend()
        assert isinstance(backend, LocalSkillBackend)

    def test_execute_simple_code(self, backend: LocalSkillBackend) -> None:
        code = "x = 1 + 1"
        result = backend.execute(code, "test_skill")

        assert result["success"] is True
        assert result["skill_name"] == "test_skill"
        assert result["error"] is None
        assert result["execution_time"] > 0

    def test_execute_code_with_output(self, backend: LocalSkillBackend) -> None:
        code = "print('Hello, World!')"
        result = backend.execute(code, "test_skill")

        assert result["success"] is True
        assert "Hello, World!" in result["output"]

    def test_execute_code_with_error(self, backend: LocalSkillBackend) -> None:
        code = "raise ValueError('Test error')"
        result = backend.execute(code, "test_skill")

        assert result["success"] is False
        assert result["error"] is not None
        assert "Test error" in result["error"]

    def test_execute_code_with_undefined_variable(self, backend: LocalSkillBackend) -> None:
        code = "print(undefined_var)"
        result = backend.execute(code, "test_skill")

        assert result["success"] is False
        assert "NameError" in result["error"] or "not defined" in result["error"]

    def test_execute_result_structure(self, backend: LocalSkillBackend) -> None:
        code = "x = 42"
        result = backend.execute(code, "test_skill")

        assert "success" in result
        assert "output" in result
        assert "error" in result
        assert "execution_time" in result
        assert "skill_name" in result


class TestSandboxSkillBackend:
    """Test suite for SandboxSkillBackend."""

    @pytest.fixture
    def backend(self) -> SandboxSkillBackend:
        return SandboxSkillBackend(sandbox_type="code_interpreter")

    def test_backend_initialization(self) -> None:
        backend = SandboxSkillBackend(sandbox_type="code_interpreter")
        assert backend.sandbox_type == "code_interpreter"

    def test_backend_initialization_with_kwargs(self) -> None:
        backend = SandboxSkillBackend(
            sandbox_type="code_interpreter",
            backend="subprocess",
        )
        assert backend.sandbox_type == "code_interpreter"
        assert backend.sandbox_kwargs["backend"] == "subprocess"

    def test_rejects_legacy_subprocess_type(self) -> None:
        with pytest.raises(ValueError, match="Unsupported sandbox_type"):
            SandboxSkillBackend(sandbox_type="subprocess")

    def test_sandbox_backend_is_execution_backend(self, backend: SandboxSkillBackend) -> None:
        assert isinstance(backend, SkillExecutionBackend)

    def test_sandbox_backend_execute_method_exists(self, backend: SandboxSkillBackend) -> None:
        assert hasattr(backend, "execute")
        assert callable(backend.execute)

    def test_execute_result_structure_on_failure(self) -> None:
        backend = SandboxSkillBackend()
        result = backend.execute("print('test')", "test_skill")

        assert "success" in result
        assert "output" in result
        assert "error" in result
        assert "execution_time" in result
        assert "skill_name" in result


class TestBackendFactory:
    """Test suite for backend factory functions."""

    def test_get_default_backend(self) -> None:
        backend = get_default_backend()
        assert isinstance(backend, LocalSkillBackend)

    def test_get_local_backend(self) -> None:
        backend = get_backend("local")
        assert isinstance(backend, LocalSkillBackend)

    def test_get_sandbox_backend(self) -> None:
        backend = get_backend("sandbox", sandbox_type="code_interpreter")
        assert isinstance(backend, SandboxSkillBackend)

    def test_get_backend_unknown_type(self) -> None:
        with pytest.raises(ValueError, match="Unknown backend type"):
            get_backend("unknown_type")


class TestSkillBundleLoaderWithBackend:
    """Test suite for SkillBundleLoader with execution backend."""

    def test_skill_bundle_loader_initialization_with_backend(self) -> None:
        backend = LocalSkillBackend()
        loader = SkillBundleLoader(execution_backend=backend)

        assert loader.execution_backend is backend

    def test_skill_bundle_loader_initialization_without_backend(self) -> None:
        loader = SkillBundleLoader()

        assert loader.execution_backend is None

    def test_skill_bundle_loader_with_sandbox_backend(self) -> None:
        backend = SandboxSkillBackend(sandbox_type="code_interpreter")
        loader = SkillBundleLoader(execution_backend=backend)

        assert loader.execution_backend is backend
        assert isinstance(loader.execution_backend, SandboxSkillBackend)


class TestExecutionBackendContract:
    """Test suite for SkillExecutionBackend contract."""

    def test_backend_is_abstract(self) -> None:
        with pytest.raises(TypeError):
            SkillExecutionBackend()  # type: ignore[abstract]

    def test_backend_execute_method_required(self) -> None:
        class IncompleteBackend(SkillExecutionBackend):
            pass

        with pytest.raises(TypeError):
            IncompleteBackend()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
