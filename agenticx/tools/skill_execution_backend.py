"""
Skill Execution Backend

Provides an abstraction layer for executing skills with different backends
(local process, sandbox isolation, etc.).

This module enables SkillBundle to flexibly choose how skills are executed,
supporting both direct local execution and sandboxed execution for security.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)


class SkillExecutionBackend(ABC):
    """
    Abstract base class for skill execution backends.
    
    Defines the interface for executing skill code with different execution strategies.
    """
    
    @abstractmethod
    def execute(self, 
                code: str,
                skill_name: str,
                timeout: Optional[float] = None,
                **kwargs: Any) -> Dict[str, Any]:
        """
        Execute skill code.
        
        Args:
            code: Python code to execute
            skill_name: Name of the skill being executed
            timeout: Optional timeout in seconds
            **kwargs: Additional parameters for the backend
            
        Returns:
            Dict with execution result containing:
                - success: bool indicating if execution succeeded
                - output: The execution output (stdout/result)
                - error: Error message if execution failed
                - execution_time: Execution time in seconds
        """
        pass


class LocalSkillBackend(SkillExecutionBackend):
    """
    Local process execution backend.
    
    Executes skills directly in the current Python process.
    Fast but no isolation.
    """
    
    def __init__(self, allow_globals: bool = True):
        """
        Initialize local backend.
        
        Args:
            allow_globals: Whether to allow access to global namespace
        """
        self.allow_globals = allow_globals
    
    def execute(self, 
                code: str,
                skill_name: str,
                timeout: Optional[float] = None,
                **kwargs: Any) -> Dict[str, Any]:
        """
        Execute skill code locally.
        
        Args:
            code: Python code to execute
            skill_name: Name of the skill
            timeout: Optional timeout (not enforced in local execution)
            **kwargs: Additional parameters
            
        Returns:
            Execution result dict
        """
        import sys
        from io import StringIO
        import time
        
        # Capture output
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        output_buffer = StringIO()
        
        try:
            sys.stdout = output_buffer
            sys.stderr = output_buffer
            
            start_time = time.time()
            
            # Prepare execution environment
            exec_globals = {}
            if self.allow_globals:
                exec_globals.update(globals())
            
            # Execute code
            exec(code, exec_globals)
            
            execution_time = time.time() - start_time
            output = output_buffer.getvalue()
            
            return {
                "success": True,
                "output": output,
                "error": None,
                "execution_time": execution_time,
                "skill_name": skill_name
            }
            
        except Exception as e:
            execution_time = time.time() - start_time
            output = output_buffer.getvalue()
            error_msg = str(e)
            
            return {
                "success": False,
                "output": output,
                "error": error_msg,
                "execution_time": execution_time,
                "skill_name": skill_name
            }
            
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr


class SandboxSkillBackend(SkillExecutionBackend):
    """
    Sandbox execution backend.
    
    Executes skills in isolated sandbox environment for security.
    Uses AgenticX Sandbox module.
    """
    
    def __init__(self, sandbox_type: str = "subprocess", **sandbox_kwargs: Any):
        """
        Initialize sandbox backend.
        
        Args:
            sandbox_type: Type of sandbox ("subprocess", "docker", "microsandbox")
            **sandbox_kwargs: Additional arguments for sandbox configuration
        """
        self.sandbox_type = sandbox_type
        self.sandbox_kwargs = sandbox_kwargs
        self._sandbox = None
    
    def execute(self, 
                code: str,
                skill_name: str,
                timeout: Optional[float] = None,
                **kwargs: Any) -> Dict[str, Any]:
        """
        Execute skill code in sandbox.
        
        Args:
            code: Python code to execute
            skill_name: Name of the skill
            timeout: Optional timeout in seconds
            **kwargs: Additional parameters
            
        Returns:
            Execution result dict
        """
        try:
            # Import here to avoid hard dependency
            from agenticx.sandbox import Sandbox
            from agenticx.sandbox.types import SandboxType, ExecutionRequest
            
            # Map string type to SandboxType
            type_map = {
                "subprocess": SandboxType.SUBPROCESS,
                "docker": SandboxType.DOCKER,
                "microsandbox": SandboxType.MICROSANDBOX,
            }
            
            sandbox_type = type_map.get(self.sandbox_type, SandboxType.SUBPROCESS)
            
            # Create execution request
            request = ExecutionRequest(
                code=code,
                language="python",
                timeout=timeout
            )
            
            # Create and execute in sandbox
            with Sandbox.create(
                sandbox_type=sandbox_type,
                **self.sandbox_kwargs
            ) as sandbox:
                result = sandbox.execute(request)
                
                return {
                    "success": result.success,
                    "output": result.stdout or "",
                    "error": result.error or (result.stderr if not result.success else None),
                    "execution_time": result.execution_time or 0.0,
                    "skill_name": skill_name
                }
                
        except Exception as e:
            import traceback
            logger.error(f"Sandbox execution failed for {skill_name}: {e}")
            return {
                "success": False,
                "output": "",
                "error": f"Sandbox execution failed: {str(e)}\n{traceback.format_exc()}",
                "execution_time": 0.0,
                "skill_name": skill_name
            }


def get_default_backend() -> SkillExecutionBackend:
    """
    Get the default execution backend.
    
    Returns:
        A LocalSkillBackend instance as the default
    """
    return LocalSkillBackend()


def get_backend(backend_type: str = "local", **kwargs: Any) -> SkillExecutionBackend:
    """
    Factory function to get execution backend.
    
    Args:
        backend_type: "local" or "sandbox"
        **kwargs: Arguments passed to backend constructor
        
    Returns:
        SkillExecutionBackend instance
    """
    if backend_type == "local":
        return LocalSkillBackend(**kwargs)
    elif backend_type == "sandbox":
        return SandboxSkillBackend(**kwargs)
    else:
        raise ValueError(f"Unknown backend type: {backend_type}")
