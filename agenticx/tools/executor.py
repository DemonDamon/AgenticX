"""
ToolExecutor: 工具执行引擎

提供安全的工具执行环境，包括沙箱隔离、错误处理、重试逻辑等。

支持两种沙箱模式：
1. 内置简单沙箱（SandboxEnvironment）- 基于 exec 的简单隔离
2. 高级沙箱（agenticx.sandbox）- 进程/容器级隔离，支持 subprocess/microsandbox/docker
"""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Union, TYPE_CHECKING
from datetime import datetime
from pydantic import BaseModel, Field

from .base import BaseTool, ToolError, ToolTimeoutError
from ..tools.security import ApprovalRequiredError

if TYPE_CHECKING:
    from ..sandbox import SandboxBase, SandboxTemplate
    from ..sandbox.types import ExecutionResult as SandboxExecutionResult

logger = logging.getLogger(__name__)


class ToolCallingRecord(BaseModel):
    """工具调用记录
    
    参考：camel/types/agents.py:ToolCallingRecord
    """
    tool_name: str = Field(description="工具名称")
    tool_args: Dict[str, Any] = Field(description="工具参数")
    agent_id: Optional[str] = Field(default=None, description="Agent ID")
    task_id: Optional[str] = Field(default=None, description="Task ID")
    timestamp: datetime = Field(default_factory=datetime.now, description="调用时间戳")
    success: bool = Field(description="是否成功")
    result: Optional[Any] = Field(default=None, description="执行结果")
    error: Optional[str] = Field(default=None, description="错误信息")
    execution_time: float = Field(default=0.0, description="执行时间（秒）")
    retry_count: int = Field(default=0, description="重试次数")


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
        state: Any = None,
    ):
        self.tool_name = tool_name
        self.success = success
        self.result = result
        self.error = error
        self.execution_time = execution_time
        self.retry_count = retry_count
        self.state = state
    
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


class SandboxConfig:
    """
    沙箱配置
    
    用于配置 ToolExecutor 使用的高级沙箱系统。
    """
    
    def __init__(
        self,
        backend: str = "auto",
        template_name: Optional[str] = None,
        timeout_seconds: int = 300,
        cpu: float = 1.0,
        memory_mb: int = 2048,
        network_enabled: bool = False,
        auto_cleanup: bool = True,
    ):
        """
        初始化沙箱配置
        
        Args:
            backend: 后端选择 ("auto", "subprocess", "microsandbox", "docker")
            template_name: 预定义模板名称
            timeout_seconds: 执行超时（秒）
            cpu: CPU 限制
            memory_mb: 内存限制（MB）
            network_enabled: 是否启用网络
            auto_cleanup: 是否自动清理
        """
        self.backend = backend
        self.template_name = template_name
        self.timeout_seconds = timeout_seconds
        self.cpu = cpu
        self.memory_mb = memory_mb
        self.network_enabled = network_enabled
        self.auto_cleanup = auto_cleanup
    
    def to_template(self) -> "SandboxTemplate":
        """转换为 SandboxTemplate"""
        from ..sandbox import SandboxTemplate, SandboxType
        return SandboxTemplate(
            name=f"executor-{id(self)}",
            type=SandboxType.CODE_INTERPRETER,
            cpu=self.cpu,
            memory_mb=self.memory_mb,
            timeout_seconds=self.timeout_seconds,
            network_enabled=self.network_enabled,
            backend=self.backend,
        )


class ToolExecutor:
    """
    工具执行引擎
    
    负责安全地执行工具，提供重试、超时、错误处理等功能。
    
    支持两种沙箱模式：
    - 简单沙箱（enable_sandbox=True）: 基于 exec 的简单隔离
    - 高级沙箱（sandbox_config）: 进程/容器级隔离
    
    Example:
        >>> # 使用高级沙箱
        >>> config = SandboxConfig(backend="subprocess", timeout_seconds=60)
        >>> executor = ToolExecutor(sandbox_config=config)
        >>> result = await executor.execute_code_in_sandbox("print('Hello!')")
    """
    
    def __init__(
        self,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        default_timeout: Optional[float] = None,
        enable_sandbox: bool = False,
        sandbox_config: Optional[SandboxConfig] = None,
    ):
        """
        初始化工具执行器
        
        Args:
            max_retries: 最大重试次数
            retry_delay: 重试延迟（秒）
            default_timeout: 默认超时时间（秒）
            enable_sandbox: 是否启用简单沙箱环境
            sandbox_config: 高级沙箱配置（优先于 enable_sandbox）
        """
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.default_timeout = default_timeout
        self.enable_sandbox = enable_sandbox
        self.sandbox_config = sandbox_config
        
        # 简单沙箱环境
        self.sandbox = SandboxEnvironment() if enable_sandbox else None
        
        # 高级沙箱实例（延迟初始化）
        self._advanced_sandbox: Optional["SandboxBase"] = None
        self._sandbox_initialized = False
        
        # 执行统计
        self._execution_stats = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "total_execution_time": 0.0,
            "sandbox_executions": 0,
        }
        
        # 工具调用历史记录
        self._tool_calling_history: List[ToolCallingRecord] = []
    
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
        agent_id: Optional[str] = None,
        task_id: Optional[str] = None,
        **kwargs
    ) -> ExecutionResult:
        """
        同步执行工具
        
        Args:
            tool: 要执行的工具
            agent_id: Agent ID（可选，用于记录）
            task_id: Task ID（可选，用于记录）
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
                state_out = None
                if hasattr(tool, "post_state_hook") and callable(getattr(tool, "post_state_hook")):
                    state_out = getattr(tool, "post_state_hook")()
                
                # 记录成功
                execution_time = time.time() - start_time
                self._execution_stats["successful_executions"] += 1
                self._execution_stats["total_execution_time"] += execution_time
                
                # 记录工具调用
                self._record_tool_call(
                    tool_name=tool.name,
                    tool_args=kwargs,
                    agent_id=agent_id,
                    task_id=task_id,
                    success=True,
                    result=result,
                    execution_time=execution_time,
                    retry_count=retry_count,
                )
                
                return ExecutionResult(
                    tool_name=tool.name,
                    success=True,
                    result=result,
                    state=state_out,
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
        
        # 记录工具调用（失败）
        self._record_tool_call(
            tool_name=tool.name,
            tool_args=kwargs,
            agent_id=agent_id,
            task_id=task_id,
            success=False,
            error=str(last_error) if last_error else None,
            execution_time=execution_time,
            retry_count=retry_count,
        )
        
        return ExecutionResult(
            tool_name=tool.name,
            success=False,
            error=last_error,
            execution_time=execution_time,
            retry_count=retry_count,
        )
    
    def _record_tool_call(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        agent_id: Optional[str] = None,
        task_id: Optional[str] = None,
        success: bool = True,
        result: Optional[Any] = None,
        error: Optional[str] = None,
        execution_time: float = 0.0,
        retry_count: int = 0,
    ):
        """记录工具调用"""
        record = ToolCallingRecord(
            tool_name=tool_name,
            tool_args=tool_args,
            agent_id=agent_id,
            task_id=task_id,
            timestamp=datetime.now(),
            success=success,
            result=result,
            error=error,
            execution_time=execution_time,
            retry_count=retry_count,
        )
        self._tool_calling_history.append(record)
        
        # 限制历史记录数量（保留最近 1000 条）
        if len(self._tool_calling_history) > 1000:
            self._tool_calling_history = self._tool_calling_history[-1000:]
    
    def get_tool_calling_history(
        self,
        agent_id: Optional[str] = None,
        task_id: Optional[str] = None,
        tool_name: Optional[str] = None,
        limit: int = 100,
    ) -> List[ToolCallingRecord]:
        """
        获取工具调用历史
        
        Args:
            agent_id: 按 Agent ID 过滤（可选）
            task_id: 按 Task ID 过滤（可选）
            tool_name: 按工具名称过滤（可选）
            limit: 返回数量限制
            
        Returns:
            工具调用记录列表
        """
        records = self._tool_calling_history.copy()
        
        # 应用过滤
        if agent_id:
            records = [r for r in records if r.agent_id == agent_id]
        if task_id:
            records = [r for r in records if r.task_id == task_id]
        if tool_name:
            records = [r for r in records if r.tool_name == tool_name]
        
        # 返回最近的记录
        return records[-limit:]
    
    async def aexecute(
        self,
        tool: BaseTool,
        agent_id: Optional[str] = None,
        task_id: Optional[str] = None,
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
                state_out = None
                if hasattr(tool, "post_state_hook") and callable(getattr(tool, "post_state_hook")):
                    # 允许 post_state_hook 是协程或同步函数
                    hook = getattr(tool, "post_state_hook")
                    maybe_coro = hook()
                    if asyncio.iscoroutine(maybe_coro):
                        state_out = await maybe_coro
                    else:
                        state_out = maybe_coro
                
                # 记录成功
                execution_time = time.time() - start_time
                self._execution_stats["successful_executions"] += 1
                self._execution_stats["total_execution_time"] += execution_time
                
                # 记录工具调用
                self._record_tool_call(
                    tool_name=tool.name,
                    tool_args=kwargs,
                    agent_id=agent_id,
                    task_id=task_id,
                    success=True,
                    result=result,
                    execution_time=execution_time,
                    retry_count=retry_count,
                )
                
                return ExecutionResult(
                    tool_name=tool.name,
                    success=True,
                    result=result,
                    state=state_out,
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
        
        # 记录工具调用（失败）
        self._record_tool_call(
            tool_name=tool.name,
            tool_args=kwargs,
            agent_id=agent_id,
            task_id=task_id,
            success=False,
            error=str(last_error) if last_error else None,
            execution_time=execution_time,
            retry_count=retry_count,
        )
        
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
            "sandbox_executions": 0,
        }
    
    # ==================== 高级沙箱方法 ====================
    
    async def _ensure_sandbox(self) -> "SandboxBase":
        """
        确保高级沙箱已初始化
        
        Returns:
            SandboxBase: 沙箱实例
        """
        if self._advanced_sandbox is None:
            if self.sandbox_config is None:
                raise ValueError(
                    "sandbox_config is required for advanced sandbox operations. "
                    "Initialize ToolExecutor with sandbox_config parameter."
                )
            
            from ..sandbox import Sandbox, SandboxType
            
            template = self.sandbox_config.to_template()
            self._advanced_sandbox = Sandbox.create(
                type=SandboxType.CODE_INTERPRETER,
                template=template,
                backend=self.sandbox_config.backend,
            )
            await self._advanced_sandbox.start()
            self._sandbox_initialized = True
        
        return self._advanced_sandbox
    
    async def execute_code_in_sandbox(
        self,
        code: str,
        language: str = "python",
        timeout: Optional[int] = None,
    ) -> "SandboxExecutionResult":
        """
        在高级沙箱中执行代码
        
        使用进程级或容器级隔离执行代码，适合执行不可信代码。
        
        Args:
            code: 要执行的代码
            language: 代码语言 ("python", "shell")
            timeout: 执行超时（秒）
            
        Returns:
            SandboxExecutionResult: 执行结果
            
        Example:
            >>> config = SandboxConfig(backend="subprocess")
            >>> executor = ToolExecutor(sandbox_config=config)
            >>> result = await executor.execute_code_in_sandbox("print(1+1)")
            >>> print(result.stdout)
            2
        """
        sandbox = await self._ensure_sandbox()
        
        actual_timeout = timeout
        if actual_timeout is None and self.sandbox_config:
            actual_timeout = self.sandbox_config.timeout_seconds
        
        self._execution_stats["sandbox_executions"] += 1
        
        return await sandbox.execute(
            code=code,
            language=language,
            timeout=actual_timeout,
        )
    
    async def execute_tool_in_sandbox(
        self,
        tool: BaseTool,
        **kwargs,
    ) -> ExecutionResult:
        """
        在高级沙箱中执行工具
        
        如果工具是代码执行类型，会在沙箱中运行。
        否则正常执行工具。
        
        Args:
            tool: 要执行的工具
            **kwargs: 工具参数
            
        Returns:
            ExecutionResult: 执行结果
        """
        # 检查工具是否有 code 参数（代码执行工具）
        code = kwargs.get("code") or kwargs.get("script") or kwargs.get("command")
        
        if code and self.sandbox_config:
            # 在沙箱中执行代码
            language = kwargs.get("language", "python")
            try:
                sandbox_result = await self.execute_code_in_sandbox(
                    code=code,
                    language=language,
                )
                
                return ExecutionResult(
                    tool_name=tool.name,
                    success=sandbox_result.success,
                    result=sandbox_result.stdout or sandbox_result.stderr,
                    execution_time=sandbox_result.duration_ms / 1000.0,
                )
            except Exception as e:
                return ExecutionResult(
                    tool_name=tool.name,
                    success=False,
                    error=e,
                )
        
        # 否则正常执行
        return await self.aexecute(tool, **kwargs)
    
    async def cleanup_sandbox(self) -> None:
        """
        清理高级沙箱资源
        
        在不再需要沙箱时调用，释放资源。
        """
        if self._advanced_sandbox is not None:
            await self._advanced_sandbox.stop()
            self._advanced_sandbox = None
            self._sandbox_initialized = False
            logger.info("Advanced sandbox cleaned up")
    
    async def __aenter__(self) -> "ToolExecutor":
        """进入上下文管理器"""
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文管理器，自动清理沙箱"""
        if self.sandbox_config and self.sandbox_config.auto_cleanup:
            await self.cleanup_sandbox()