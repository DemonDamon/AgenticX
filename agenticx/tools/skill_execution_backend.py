"""Skill Execution Backend.

Provides an abstraction layer for executing skills with different backends
(local process, sandbox isolation, etc.).

This module enables SkillBundle to flexibly choose how skills are executed,
supporting both direct local execution and sandboxed execution for security.

Author: Damon Li
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "filter": filter,
    "float": float,
    "format": format,
    "frozenset": frozenset,
    "getattr": getattr,
    "hasattr": hasattr,
    "hash": hash,
    "int": int,
    "isinstance": isinstance,
    "issubclass": issubclass,
    "iter": iter,
    "len": len,
    "list": list,
    "map": map,
    "max": max,
    "min": min,
    "next": next,
    "print": print,
    "range": range,
    "repr": repr,
    "reversed": reversed,
    "round": round,
    "set": set,
    "slice": slice,
    "sorted": sorted,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "type": type,
    "zip": zip,
}

for _exc in (
    BaseException,
    Exception,
    ValueError,
    TypeError,
    KeyError,
    IndexError,
    RuntimeError,
    AttributeError,
    ImportError,
    OSError,
    StopIteration,
    AssertionError,
    ZeroDivisionError,
    NotImplementedError,
    LookupError,
    ArithmeticError,
):
    _SAFE_BUILTINS[_exc.__name__] = _exc

_SAFE_MODULES = ("json", "re", "math", "datetime", "collections", "itertools", "functools")


class SkillExecutionBackend(ABC):
    """Abstract base class for skill execution backends."""

    @abstractmethod
    def execute(
        self,
        code: str,
        skill_name: str,
        timeout: Optional[float] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        """Execute skill code.

        Returns:
            Dict with keys: success, output, error, execution_time, skill_name
        """
        pass


class LocalSkillBackend(SkillExecutionBackend):
    """Local process execution backend.

    Executes skills in the current Python process with a restricted
    global namespace.  The ``__builtins__`` are limited to a curated
    safe subset; only explicitly whitelisted standard-library modules
    are importable via a guarded ``__import__``.
    """

    def execute(
        self,
        code: str,
        skill_name: str,
        timeout: Optional[float] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        import sys
        from io import StringIO

        old_stdout = sys.stdout
        old_stderr = sys.stderr
        output_buffer = StringIO()

        try:
            import builtins

            sys.stdout = output_buffer
            sys.stderr = output_buffer

            start_time = time.time()

            def _guarded_import(name: str, *args: Any, **kw: Any) -> Any:
                if name.split(".")[0] not in _SAFE_MODULES:
                    raise ImportError(
                        f"Module '{name}' is not in the skill execution allowlist"
                    )
                return builtins.__import__(name, *args, **kw)

            exec_globals: Dict[str, Any] = {
                "__builtins__": {**_SAFE_BUILTINS, "__import__": _guarded_import},
            }

            exec(code, exec_globals)  # noqa: S102

            execution_time = time.time() - start_time
            output = output_buffer.getvalue()

            return {
                "success": True,
                "output": output,
                "error": None,
                "execution_time": execution_time,
                "skill_name": skill_name,
            }

        except Exception as e:
            execution_time = time.time() - start_time
            output = output_buffer.getvalue()

            return {
                "success": False,
                "output": output,
                "error": str(e),
                "execution_time": execution_time,
                "skill_name": skill_name,
            }

        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr


_SANDBOX_TYPE_MAP = {
    "code_interpreter": "CODE_INTERPRETER",
    "browser": "BROWSER",
    "aio": "AIO",
}


class SandboxSkillBackend(SkillExecutionBackend):
    """Sandbox execution backend.

    Executes skills in an isolated sandbox environment using the
    ``agenticx.sandbox`` module.  The ``sandbox_type`` must be one of the
    values defined in ``agenticx.sandbox.types.SandboxType``
    (``code_interpreter``, ``browser``, ``aio``).

    Unknown types raise ``ValueError`` immediately — no silent fallback.
    """

    def __init__(self, sandbox_type: str = "code_interpreter", **sandbox_kwargs: Any):
        if sandbox_type not in _SANDBOX_TYPE_MAP:
            raise ValueError(
                f"Unsupported sandbox_type: {sandbox_type!r}. "
                f"Allowed: {list(_SANDBOX_TYPE_MAP.keys())}"
            )
        self.sandbox_type = sandbox_type
        self.sandbox_kwargs = sandbox_kwargs

    def execute(
        self,
        code: str,
        skill_name: str,
        timeout: Optional[float] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        import asyncio

        try:
            from agenticx.sandbox.types import SandboxType

            sb_type = SandboxType(_SANDBOX_TYPE_MAP[self.sandbox_type].lower())

            async def _run() -> Dict[str, Any]:
                from agenticx.sandbox import Sandbox

                async with Sandbox.create(type=sb_type, **self.sandbox_kwargs) as sandbox:
                    result = await sandbox.execute(code, language="python", timeout=timeout)
                    return {
                        "success": result.success,
                        "output": result.stdout or "",
                        "error": result.stderr if not result.success else None,
                        "execution_time": result.duration_ms / 1000.0,
                        "skill_name": skill_name,
                    }

            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop and loop.is_running():
                import concurrent.futures

                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(asyncio.run, _run())
                    return future.result(timeout=timeout or 300)
            else:
                return asyncio.run(_run())

        except Exception as e:
            import traceback

            logger.error(f"Sandbox execution failed for {skill_name}: {e}")
            return {
                "success": False,
                "output": "",
                "error": f"Sandbox execution failed: {e}\n{traceback.format_exc()}",
                "execution_time": 0.0,
                "skill_name": skill_name,
            }


def get_default_backend() -> SkillExecutionBackend:
    """Get the default execution backend (local with restricted globals)."""
    return LocalSkillBackend()


def get_backend(backend_type: str = "local", **kwargs: Any) -> SkillExecutionBackend:
    """Factory function to get execution backend.

    Args:
        backend_type: ``"local"`` or ``"sandbox"``
        **kwargs: Arguments passed to backend constructor

    Raises:
        ValueError: If backend_type is unknown.
    """
    if backend_type == "local":
        return LocalSkillBackend(**kwargs)
    elif backend_type == "sandbox":
        return SandboxSkillBackend(**kwargs)
    else:
        raise ValueError(f"Unknown backend type: {backend_type}")
