"""
ToolExecutor: 工具执行引擎

提供安全的工具执行环境，包括沙箱隔离、错误处理、重试逻辑等。
"""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Union

from .base import BaseTool, ToolError, ToolTimeoutError
from ..tools.security import ApprovalRequiredError

logger = logging.getLogger(__name__)


class ExecutionResult:
    """工具执行结果"""
    
    def __init__(
        self,
        tool_name: str,
        success: bool,
        result: Any = None,
        error: Optional[Exception] = None,
        execution_time: float = 0.0,
        retry_count: int = 0,
    ):
        self.tool_name = tool_name
        self.success = success
        self.result = result
        self.error = error
        self.execution_time = execution_time
        self.retry_count = retry_count
    
    def __repr__(self) -> str:
        status = "SUCCESS" if self.success else "FAILED"
        return f"ExecutionResult({self.tool_name}, {status}, {self.execution_time:.3f}s)"


class SandboxEnvironment:
    """
    沙箱环境（基础实现）
    
    为需要执行代码的工具提供隔离和安全的环境
    未来可以扩展为 Docker 或其他容器化方案
    """
    
    def __init__(self, allowed_modules: Optional[List[str]] = None):
        """
        初始化沙箱环境
        
        Args:
            allowed_modules: 允许导入的模块列表
        """
        self.allowed_modules = allowed_modules or [
            "math", "json", "datetime", "random", "string", "re"
        ]
    
    def is_safe_code(self, code: str) -> bool:
        """
        检查代码是否安全
        
        Args:
            code: 要检查的代码
            
        Returns:
            是否安全
        """
        # 简单的安全检查（生产环境需要更严格的实现）
        dangerous_keywords = [
            "import os", "import sys", "import subprocess",
            "__import__", "eval", "exec", "open", "file",
            "input", "raw_input"
        ]
        
        for keyword in dangerous_keywords:
            if keyword in code:
                logger.warning(f"Dangerous code detected: {keyword}")
                return False
        
        return True
    
    def execute_code(self, code: str, globals_dict: Optional[Dict] = None) -> Any:
        """
        在沙箱中执行代码
        
        Args:
            code: 要执行的代码
            globals_dict: 全局变量字典
            
        Returns:
            执行结果
            
        Raises:
            ValueError: 代码不安全
            Exception: 代码执行错误
        """
        if not self.is_safe_code(code):
            raise ValueError("Code contains dangerous operations")
        
        # 创建安全的导入函数
        def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
            if name in self.allowed_modules:
                return __import__(name, globals, locals, fromlist, level)
            else:
                raise ImportError(f"Module '{name}' is not allowed in sandbox")
        
        # 创建受限的全局环境
        safe_globals = {
            "__builtins__": {
                "len": len, "str": str, "int": int, "float": float,
                "bool": bool, "list": list, "dict": dict, "tuple": tuple,
                "set": set, "range": range, "enumerate": enumerate,
                "zip": zip, "map": map, "filter": filter,
                "sum": sum, "min": min, "max": max, "abs": abs,
                "round": round, "sorted": sorted, "reversed": reversed,
                "__import__": safe_import,  # 添加安全的导入函数
                "print": print,  # 添加 print 函数
            }
        }
        
        if globals_dict:
            safe_globals.update(globals_dict)
        
        # 执行代码
        local_vars = {}
        exec(code, safe_globals, local_vars)
        
        # 返回结果（如果有 result 变量）
        return local_vars.get("result")


class ToolExecutor:
    """
    工具执行引擎
    
    负责安全地执行工具，提供重试、超时、错误处理等功能
    """
    
    def __init__(
        self,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        default_timeout: Optional[float] = None,
        enable_sandbox: bool = False,
    ):
        """
        初始化工具执行器
        
        Args:
            max_retries: 最大重试次数
            retry_delay: 重试延迟（秒）
            default_timeout: 默认超时时间（秒）
            enable_sandbox: 是否启用沙箱环境
        """
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.default_timeout = default_timeout
        self.enable_sandbox = enable_sandbox
        
        # 沙箱环境
        self.sandbox = SandboxEnvironment() if enable_sandbox else None
        
        # 执行统计
        self._execution_stats = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "total_execution_time": 0.0,
        }
    
    @property
    def execution_stats(self) -> Dict[str, Any]:
        """获取执行统计信息"""
        stats = self._execution_stats.copy()
        if stats["total_executions"] > 0:
            stats["average_execution_time"] = (
                stats["total_execution_time"] / stats["total_executions"]
            )
            stats["success_rate"] = (
                stats["successful_executions"] / stats["total_executions"]
            )
        else:
            stats["average_execution_time"] = 0.0
            stats["success_rate"] = 0.0
        
        return stats
    
    def _should_retry(self, error: Exception, retry_count: int) -> bool:
        """
        判断是否应该重试
        
        Args:
            error: 发生的错误
            retry_count: 当前重试次数
            
        Returns:
            是否应该重试
        """
        if retry_count >= self.max_retries:
            return False
        
        # 某些错误不应该重试
        if isinstance(error, (ToolTimeoutError, KeyboardInterrupt)):
            return False
        
        return True
    
    def execute(
        self,
        tool: BaseTool,
        **kwargs
    ) -> ExecutionResult:
        """
        同步执行工具
        
        Args:
            tool: 要执行的工具
            **kwargs: 工具参数
            
        Returns:
            执行结果
        """
        start_time = time.time()
        retry_count = 0
        last_error = None
        
        self._execution_stats["total_executions"] += 1
        
        while retry_count <= self.max_retries:
            try:
                # 设置超时
                timeout = getattr(tool, 'timeout', None) or self.default_timeout
                if timeout:
                    tool.timeout = timeout
                
                # 执行工具
                result = tool.run(**kwargs)
                
                # 记录成功
                execution_time = time.time() - start_time
                self._execution_stats["successful_executions"] += 1
                self._execution_stats["total_execution_time"] += execution_time
                
                return ExecutionResult(
                    tool_name=tool.name,
                    success=True,
                    result=result,
                    execution_time=execution_time,
                    retry_count=retry_count,
                )
            
            except ApprovalRequiredError as e:
                # 人工审批请求，不计入错误，直接抛出
                raise e
                
            except Exception as e:
                last_error = e
                logger.warning(
                    f"Tool {tool.name} execution failed (attempt {retry_count + 1}): {e}"
                )
                
                if not self._should_retry(e, retry_count):
                    break
                
                retry_count += 1
                if retry_count <= self.max_retries:
                    time.sleep(self.retry_delay)
        
        # 记录失败
        execution_time = time.time() - start_time
        self._execution_stats["failed_executions"] += 1
        self._execution_stats["total_execution_time"] += execution_time
        
        return ExecutionResult(
            tool_name=tool.name,
            success=False,
            error=last_error,
            execution_time=execution_time,
            retry_count=retry_count,
        )
    
    async def aexecute(
        self,
        tool: BaseTool,
        **kwargs
    ) -> ExecutionResult:
        """
        异步执行工具
        
        Args:
            tool: 要执行的工具
            **kwargs: 工具参数
            
        Returns:
            执行结果
        """
        start_time = time.time()
        retry_count = 0
        last_error = None
        
        self._execution_stats["total_executions"] += 1
        
        while retry_count <= self.max_retries:
            try:
                # 设置超时
                timeout = getattr(tool, 'timeout', None) or self.default_timeout
                if timeout:
                    tool.timeout = timeout
                
                # 执行工具
                result = await tool.arun(**kwargs)
                
                # 记录成功
                execution_time = time.time() - start_time
                self._execution_stats["successful_executions"] += 1
                self._execution_stats["total_execution_time"] += execution_time
                
                return ExecutionResult(
                    tool_name=tool.name,
                    success=True,
                    result=result,
                    execution_time=execution_time,
                    retry_count=retry_count,
                )
            
            except ApprovalRequiredError as e:
                # 人工审批请求，不计入错误，直接抛出
                raise e
                
            except Exception as e:
                last_error = e
                logger.warning(
                    f"Tool {tool.name} async execution failed (attempt {retry_count + 1}): {e}"
                )
                
                if not self._should_retry(e, retry_count):
                    break
                
                retry_count += 1
                if retry_count <= self.max_retries:
                    await asyncio.sleep(self.retry_delay)
        
        # 记录失败
        execution_time = time.time() - start_time
        self._execution_stats["failed_executions"] += 1
        self._execution_stats["total_execution_time"] += execution_time
        
        return ExecutionResult(
            tool_name=tool.name,
            success=False,
            error=last_error,
            execution_time=execution_time,
            retry_count=retry_count,
        )
    
    def execute_batch(
        self,
        tools_and_args: List[tuple[BaseTool, Dict[str, Any]]]
    ) -> List[ExecutionResult]:
        """
        批量执行工具（同步）
        
        Args:
            tools_and_args: (工具, 参数) 元组列表
            
        Returns:
            执行结果列表
        """
        results = []
        for tool, args in tools_and_args:
            result = self.execute(tool, **args)
            results.append(result)
        
        return results
    
    async def aexecute_batch(
        self,
        tools_and_args: List[tuple[BaseTool, Dict[str, Any]]],
        concurrent: bool = True,
    ) -> List[ExecutionResult]:
        """
        批量执行工具（异步）
        
        Args:
            tools_and_args: (工具, 参数) 元组列表
            concurrent: 是否并发执行
            
        Returns:
            执行结果列表
        """
        if concurrent:
            # 并发执行
            tasks = [
                self.aexecute(tool, **args)
                for tool, args in tools_and_args
            ]
            return await asyncio.gather(*tasks)
        else:
            # 顺序执行
            results = []
            for tool, args in tools_and_args:
                result = await self.aexecute(tool, **args)
                results.append(result)
            return results
    
    def reset_stats(self):
        """重置执行统计"""
        self._execution_stats = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "total_execution_time": 0.0,
        } 