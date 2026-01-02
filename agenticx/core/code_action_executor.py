"""
CodeActionExecutor - 轻量级“代码即行动”执行器

设计目标：
- 不新增依赖，纯 Python 实现
- 受限执行：限制内置函数、禁止 import
- 允许注入工具表，供代码调用（如 tools["add"](1,2)）
"""

from __future__ import annotations

import asyncio
import builtins
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional


SAFE_BUILTINS = {
    "abs",
    "min",
    "max",
    "sum",
    "len",
    "range",
    "enumerate",
    "zip",
    "sorted",
    "all",
    "any",
    "round",
}


@dataclass
class CodeActionResult:
    success: bool
    result: Any = None
    error: Optional[str] = None


class CodeActionExecutor:
    """
    受限 Python 代码执行器。

    - 禁止 import
    - 限制内置函数为 SAFE_BUILTINS
    - 提供 tools 映射给代码使用
    """

    def __init__(
        self,
        tools: Optional[Dict[str, Callable[..., Any]]] = None,
        max_code_len: int = 2000,
        timeout_sec: float = 2.0,
        extra_builtins: Optional[Dict[str, Any]] = None,
    ):
        self.tools = tools or {}
        self.max_code_len = max_code_len
        self.timeout_sec = timeout_sec
        self.extra_builtins = extra_builtins or {}

    def _build_globals(self) -> Dict[str, Any]:
        safe_globals = {"__builtins__": {k: getattr(builtins, k) for k in SAFE_BUILTINS}}
        safe_globals["__builtins__"].update(self.extra_builtins)
        safe_globals["tools"] = self.tools
        return safe_globals

    def _basic_guard(self, code: str) -> Optional[str]:
        if len(code) > self.max_code_len:
            return f"code too long (> {self.max_code_len})"
        banned = ["import ", "__", "eval(", "exec(", "open(", "os.", "sys."]
        for b in banned:
            if b in code:
                return f"banned construct detected: {b}"
        return None

    async def _exec_async(self, code: str, locals_ctx: Optional[Dict[str, Any]]) -> CodeActionResult:
        guard = self._basic_guard(code)
        if guard:
            return CodeActionResult(success=False, error=guard)

        g = self._build_globals()
        l = locals_ctx or {}

        def runner():
            exec(code, g, l)
            return l.get("result")

        # 单次执行专用线程池，超时后可取消
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(runner)
            try:
                result = future.result(timeout=self.timeout_sec)
                return CodeActionResult(success=True, result=result)
            except FuturesTimeoutError:
                future.cancel()
                return CodeActionResult(success=False, error=f"execution timed out ({self.timeout_sec}s)")
            except Exception as e:
                future.cancel()
                return CodeActionResult(success=False, error=str(e) or repr(e))

    def execute(self, code: str, locals_ctx: Optional[Dict[str, Any]] = None) -> CodeActionResult:
        """
        同步执行，内部使用线程 + 超时；在已有事件循环时降级为阻塞执行（无超时）。
        """
        try:
            coro = self._exec_async(code, locals_ctx)
            return asyncio.run(asyncio.wait_for(coro, timeout=self.timeout_sec))
        except asyncio.TimeoutError:
            return CodeActionResult(success=False, error=f"execution timed out ({self.timeout_sec}s)")
        except RuntimeError:
            # 已有事件循环，退化为阻塞执行（带超时）
            guard = self._basic_guard(code)
            if guard:
                return CodeActionResult(success=False, error=guard)
            g = self._build_globals()
            l = locals_ctx or {}
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(lambda: exec(code, g, l))
                try:
                    future.result(timeout=self.timeout_sec)
                    return CodeActionResult(success=True, result=l.get("result"))
                except FuturesTimeoutError:
                    future.cancel()
                    return CodeActionResult(success=False, error=f"execution timed out ({self.timeout_sec}s)")
                except Exception as e:
                    future.cancel()
                    return CodeActionResult(success=False, error=str(e) or repr(e))

    async def execute_async(self, code: str, locals_ctx: Optional[Dict[str, Any]] = None) -> CodeActionResult:
        """
        异步执行，带超时。
        """
        try:
            return await asyncio.wait_for(self._exec_async(code, locals_ctx), timeout=self.timeout_sec)
        except asyncio.TimeoutError:
            return CodeActionResult(success=False, error=f"execution timed out ({self.timeout_sec}s)")


__all__ = ["CodeActionExecutor", "CodeActionResult"]

