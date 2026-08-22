"""Tool execution with retries, policy checks, and audit records."""

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Union, TYPE_CHECKING
from datetime import datetime
from pydantic import BaseModel, Field  # type: ignore

from .base import BaseTool, ToolError, ToolTimeoutError
from ..tools.security import ApprovalRequiredError

if TYPE_CHECKING:
    from agenticx.safety.layer import SafetyLayer

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


class ToolExecutor:
    """
    工具执行引擎
    
    负责执行工具，提供重试、超时、策略检查和错误处理。
    """
    
    def __init__(
        self,
        max_retries: int = 3,
        retry_delay: float = 1.0,
        default_timeout: Optional[float] = None,
        # Declarative tool policy (inspired by OpenClaw)
        policy_stack: Optional[Any] = None,
        # Optional SafetyLayer for sanitizing tool outputs
        safety_layer: Optional["SafetyLayer"] = None,
    ):
        """
        初始化工具执行器
        
        Args:
            max_retries: 最大重试次数
            retry_delay: 重试延迟（秒）
            default_timeout: 默认超时时间（秒）
            policy_stack: Optional ToolPolicyStack for declarative access
                control.  When set, ``execute()`` / ``aexecute()`` will
                call ``policy_stack.check(tool.name)`` before running the
                tool and raise ``ToolPolicyDeniedError`` on denial.
                Inspired by OpenClaw's 6-layer tool policy.
        """
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.default_timeout = default_timeout
        self.policy_stack = policy_stack
        self.safety_layer = safety_layer
        
        # 执行统计
        self._execution_stats = {
            "total_executions": 0,
            "successful_executions": 0,
            "failed_executions": 0,
            "total_execution_time": 0.0,
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
        
        # --- Declarative policy check (OpenClaw-inspired) ---
        if self.policy_stack is not None:
            self.policy_stack.check(tool.name)
        
        while retry_count <= self.max_retries:
            try:
                # 设置超时
                timeout = getattr(tool, 'timeout', None) or self.default_timeout
                if timeout:
                    tool.timeout = timeout
                
                # Pre-execution input validation
                if self.safety_layer is not None:
                    input_result = self.safety_layer.validate_tool_input(tool.name, kwargs)
                    if input_result.is_blocked:
                        blocked_rules = [v.rule_id for v in input_result.violations if v.is_blocking]
                        raise ToolError(f"Input blocked by safety policy: {', '.join(blocked_rules)}")

                result = tool.run(**kwargs)
                if self.safety_layer is not None and isinstance(result, str):
                    result = self.safety_layer.sanitize_tool_output(result, tool_name=tool.name)
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
        
        # --- Declarative policy check (OpenClaw-inspired) ---
        if self.policy_stack is not None:
            self.policy_stack.check(tool.name)
        
        while retry_count <= self.max_retries:
            try:
                # 设置超时
                timeout = getattr(tool, 'timeout', None) or self.default_timeout
                if timeout:
                    tool.timeout = timeout
                
                # Pre-execution input validation
                if self.safety_layer is not None:
                    input_result = self.safety_layer.validate_tool_input(tool.name, kwargs)
                    if input_result.is_blocked:
                        blocked_rules = [v.rule_id for v in input_result.violations if v.is_blocking]
                        raise ToolError(f"Input blocked by safety policy: {', '.join(blocked_rules)}")

                result = await tool.arun(**kwargs)
                if self.safety_layer is not None and isinstance(result, str):
                    result = self.safety_layer.sanitize_tool_output(result, tool_name=tool.name)
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
        }
