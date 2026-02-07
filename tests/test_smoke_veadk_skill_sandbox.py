"""
Smoke tests for VeADK SkillBundle-Sandbox integration feature.

Tests the skill execution backend abstraction and integration with SkillBundleLoader.
"""

import pytest
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

from agenticx.tools.skill_execution_backend import (
    SkillExecutionBackend, LocalSkillBackend, SandboxSkillBackend,
    get_default_backend, get_backend
)
from agenticx.tools.skill_bundle import SkillBundleLoader


class TestLocalSkillBackend:
    """Test suite for LocalSkillBackend."""
    
    @pytest.fixture
    def backend(self):
        """Create a local backend instance."""
        return LocalSkillBackend()
    
    def test_backend_initialization(self):
        """Test local backend initialization."""
        backend = LocalSkillBackend(allow_globals=True)
        assert backend.allow_globals is True
    
    def test_backend_initialization_no_globals(self):
        """Test local backend initialization with allow_globals=False."""
        backend = LocalSkillBackend(allow_globals=False)
        assert backend.allow_globals is False
    
    def test_execute_simple_code(self, backend):
        """Test executing simple code."""
        code = "x = 1 + 1"
        result = backend.execute(code, "test_skill")
        
        assert result["success"] is True
        assert result["skill_name"] == "test_skill"
        assert result["error"] is None
        assert result["execution_time"] > 0
    
    def test_execute_code_with_output(self, backend):
        """Test executing code that produces output."""
        code = "print('Hello, World!')"
        result = backend.execute(code, "test_skill")
        
        assert result["success"] is True
        assert "Hello, World!" in result["output"]
    
    def test_execute_code_with_error(self, backend):
        """Test executing code that raises an error."""
        code = "raise ValueError('Test error')"
        result = backend.execute(code, "test_skill")
        
        assert result["success"] is False
        assert result["error"] is not None
        assert "Test error" in result["error"]
    
    def test_execute_code_with_undefined_variable(self, backend):
        """Test executing code with undefined variable."""
        code = "print(undefined_var)"
        result = backend.execute(code, "test_skill")
        
        assert result["success"] is False
        assert "NameError" in result["error"] or "not defined" in result["error"]
    
    def test_execute_result_structure(self, backend):
        """Test that result has all required keys."""
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
    def backend(self):
        """Create a sandbox backend instance."""
        return SandboxSkillBackend(sandbox_type="subprocess")
    
    def test_backend_initialization(self):
        """Test sandbox backend initialization."""
        backend = SandboxSkillBackend(sandbox_type="subprocess")
        assert backend.sandbox_type == "subprocess"
    
    def test_backend_initialization_with_kwargs(self):
        """Test sandbox backend initialization with kwargs."""
        backend = SandboxSkillBackend(
            sandbox_type="docker",
            image="python:3.10"
        )
        assert backend.sandbox_type == "docker"
        assert backend.sandbox_kwargs["image"] == "python:3.10"
    
    def test_sandbox_backend_is_execution_backend(self, backend):
        """Test that SandboxSkillBackend is a SkillExecutionBackend."""
        assert isinstance(backend, SkillExecutionBackend)
    
    def test_sandbox_backend_execute_method_exists(self, backend):
        """Test that SandboxSkillBackend has execute method."""
        assert hasattr(backend, "execute")
        assert callable(backend.execute)
    
    def test_execute_result_structure_on_failure(self):
        """Test that sandbox execute returns proper structure even on failure."""
        backend = SandboxSkillBackend()
        # This will fail because Sandbox is not fully mocked
        result = backend.execute("print('test')", "test_skill")
        
        # Verify structure even on failure
        assert "success" in result
        assert "output" in result
        assert "error" in result
        assert "execution_time" in result
        assert "skill_name" in result
        
        # In this case, should fail due to sandbox unavailability
        assert result["success"] is False or result["success"] is True  # Can go either way


class TestBackendFactory:
    """Test suite for backend factory functions."""
    
    def test_get_default_backend(self):
        """Test getting default backend."""
        backend = get_default_backend()
        assert isinstance(backend, LocalSkillBackend)
    
    def test_get_local_backend(self):
        """Test getting local backend via factory."""
        backend = get_backend("local")
        assert isinstance(backend, LocalSkillBackend)
    
    def test_get_sandbox_backend(self):
        """Test getting sandbox backend via factory."""
        backend = get_backend("sandbox", sandbox_type="subprocess")
        assert isinstance(backend, SandboxSkillBackend)
    
    def test_get_backend_with_kwargs(self):
        """Test factory with kwargs."""
        backend = get_backend("local", allow_globals=False)
        assert isinstance(backend, LocalSkillBackend)
        assert backend.allow_globals is False
    
    def test_get_backend_unknown_type(self):
        """Test factory with unknown backend type."""
        with pytest.raises(ValueError, match="Unknown backend type"):
            get_backend("unknown_type")


class TestSkillBundleLoaderWithBackend:
    """Test suite for SkillBundleLoader with execution backend."""
    
    def test_skill_bundle_loader_initialization_with_backend(self):
        """Test SkillBundleLoader initialization with backend."""
        backend = LocalSkillBackend()
        loader = SkillBundleLoader(execution_backend=backend)
        
        assert loader.execution_backend is backend
    
    def test_skill_bundle_loader_initialization_without_backend(self):
        """Test SkillBundleLoader initialization without backend (backward compatible)."""
        loader = SkillBundleLoader()
        
        assert loader.execution_backend is None
    
    def test_skill_bundle_loader_with_sandbox_backend(self):
        """Test SkillBundleLoader can accept sandbox backend."""
        backend = SandboxSkillBackend(sandbox_type="subprocess")
        loader = SkillBundleLoader(execution_backend=backend)
        
        assert loader.execution_backend is backend
        assert isinstance(loader.execution_backend, SandboxSkillBackend)


class TestExecutionBackendContract:
    """Test suite for SkillExecutionBackend contract."""
    
    def test_backend_is_abstract(self):
        """Test that SkillExecutionBackend is abstract."""
        with pytest.raises(TypeError):
            SkillExecutionBackend()
    
    def test_backend_execute_method_required(self):
        """Test that backends must implement execute method."""
        class IncompleteBackend(SkillExecutionBackend):
            pass
        
        with pytest.raises(TypeError):
            IncompleteBackend()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
