"""
Spawn Worker - 递归 Worker 工具

内化自 AgentScope 的 meta_planner_agent/tool.py::create_worker

提供"递归 Worker"能力：
- Planner 可以动态创建子 Worker 执行具体任务
- 子 Worker 共享父 Agent 的配置
- 支持结构化输出和流式响应

设计原则（来自 AgentScope）：
- 任务分解：将复杂任务分配给专门的子 Worker
- 工具隔离：每个 Worker 可以有独立的工具集
- 结果汇总：子 Worker 返回结构化结果供 Planner 决策
"""

from typing import Optional, Dict, Any, List, Callable, AsyncGenerator, Union
from datetime import datetime, timezone
import asyncio
import logging
import json
from enum import Enum

from pydantic import BaseModel, Field

from agenticx.core.discovery import (
    DiscoveryBus, DiscoveryRegistry, Discovery, DiscoveryType, get_discovery_bus
)
from agenticx.core.interruption import (
    InterruptionManager, InterruptSignal, InterruptReason, InterruptStrategy,
    ExecutionSnapshot, get_interrupt_manager
)
from agenticx.core.context_compiler import ContextCompiler, create_context_compiler

logger = logging.getLogger(__name__)


# =============================================================================
# 结果模型（内化自 AgentScope 的 ResultModel）
# =============================================================================

class WorkerResult(BaseModel):
    """
    Worker 执行结果模型。
    
    内化自 AgentScope 的 ResultModel，用于结构化返回子任务结果。
    """
    success: bool = Field(
        description="任务是否成功完成"
    )
    message: str = Field(
        description="任务结果详情，包含必要信息如生成的文件路径、偏差、错误信息等"
    )
    artifacts: List[str] = Field(
        default_factory=list,
        description="产出物列表（文件路径、URL 等）"
    )
    insights: List[str] = Field(
        default_factory=list,
        description="发现的关键洞察"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="额外元数据"
    )


class WorkerStatus(str, Enum):
    """Worker 执行状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# =============================================================================
# Worker 配置
# =============================================================================

class WorkerConfig(BaseModel):
    """
    Worker 配置。
    
    定义子 Worker 的行为和资源。
    """
    name: str = Field(
        default="Worker",
        description="Worker 名称"
    )
    max_iterations: int = Field(
        default=10,
        ge=1,
        le=50,
        description="最大迭代次数"
    )
    timeout_seconds: int = Field(
        default=300,
        ge=30,
        description="超时时间（秒）"
    )
    tools: List[str] = Field(
        default_factory=list,
        description="可用工具名称列表"
    )
    inherit_tools: bool = Field(
        default=True,
        description="是否继承父 Agent 的工具"
    )
    system_prompt: Optional[str] = Field(
        default=None,
        description="自定义系统提示（None 则使用默认）"
    )


# =============================================================================
# Worker 执行上下文
# =============================================================================

class WorkerContext(BaseModel):
    """Worker 执行上下文"""
    task_description: str = Field(
        description="任务描述"
    )
    parent_agent_id: Optional[str] = Field(
        default=None,
        description="父 Agent ID"
    )
    parent_plan_id: Optional[str] = Field(
        default=None,
        description="父计划 ID"
    )
    subtask_index: Optional[int] = Field(
        default=None,
        description="子任务索引"
    )
    background_context: Optional[str] = Field(
        default=None,
        description="背景上下文信息"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    # [NEW] 是否共享父 Agent 的 ContextCompiler
    share_context_compiler: bool = Field(
        default=True,
        description="是否与父 Agent 共享 ContextCompiler（减少重复压缩开销）"
    )


# =============================================================================
# Worker 执行记录
# =============================================================================

class WorkerExecution(BaseModel):
    """Worker 执行记录"""
    id: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    )
    config: WorkerConfig = Field(default_factory=WorkerConfig)
    context: WorkerContext
    status: WorkerStatus = Field(default=WorkerStatus.PENDING)
    result: Optional[WorkerResult] = None
    iterations: int = Field(default=0)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error: Optional[str] = None
    
    def start(self) -> None:
        """标记开始执行"""
        self.status = WorkerStatus.RUNNING
        self.started_at = datetime.now(timezone.utc).isoformat()
    
    def complete(self, result: WorkerResult) -> None:
        """标记完成"""
        self.status = WorkerStatus.COMPLETED
        self.result = result
        self.finished_at = datetime.now(timezone.utc).isoformat()
    
    def fail(self, error: str) -> None:
        """标记失败"""
        self.status = WorkerStatus.FAILED
        self.error = error
        self.finished_at = datetime.now(timezone.utc).isoformat()
    
    def cancel(self) -> None:
        """标记取消"""
        self.status = WorkerStatus.CANCELLED
        self.finished_at = datetime.now(timezone.utc).isoformat()


# =============================================================================
# WorkerSpawner - 核心组件
# =============================================================================

class WorkerSpawner:
    """
    Worker 生成器 - 提供递归 Worker 创建能力。
    
    内化自 AgentScope 的 create_worker 模式，提供：
    - 动态创建子 Worker
    - 任务执行和结果收集
    - 流式响应（可选）
    
    使用示例:
    ```python
    spawner = WorkerSpawner(llm_provider=my_llm)
    
    # 创建并执行 Worker
    result = await spawner.spawn_worker(
        task_description="搜索并分析 AgentScope 的 PlanNotebook 实现",
        config=WorkerConfig(max_iterations=5)
    )
    
    if result.success:
        print(f"任务完成: {result.message}")
    ```
    """
    
    default_system_prompt: str = """You are a specialized Worker agent.

## Your Target
Complete the given task thoroughly and efficiently using your available tools.

## Guidelines
1. Break down complex tasks into smaller steps
2. Use tools appropriately to gather information or perform actions
3. Document your findings and progress
4. Return a structured result when finished

## Output Format
When you complete the task, provide:
- success: Whether the task was completed successfully
- message: A detailed summary of what was accomplished
- artifacts: List of any files, URLs, or outputs created
- insights: Key discoveries or learnings from the task
"""
    
    def __init__(
        self,
        llm_provider: Optional[Any] = None,
        default_tools: Optional[List[Callable]] = None,
        max_concurrent_workers: int = 3,
        discovery_bus: Optional[DiscoveryBus] = None,
        interrupt_manager: Optional[InterruptionManager] = None,
        context_compiler: Optional[ContextCompiler] = None,
    ):
        """
        初始化 Worker 生成器。
        
        Args:
            llm_provider: LLM 提供者实例（用于 Worker 的推理）
            default_tools: 默认工具列表
            max_concurrent_workers: 最大并发 Worker 数
            discovery_bus: [NEW] 发现总线（用于 Discovery Loop）
            interrupt_manager: [NEW] 中断管理器（用于实时中断）
            context_compiler: [NEW] 父 Agent 的 ContextCompiler（用于上下文共享）
        """
        self.llm_provider = llm_provider
        self.default_tools = default_tools or []
        self.max_concurrent_workers = max_concurrent_workers
        
        # [NEW] 发现总线
        self.discovery_bus = discovery_bus or get_discovery_bus()
        
        # [NEW] 中断管理器
        self.interrupt_manager = interrupt_manager or get_interrupt_manager()
        
        # [NEW] 父 Agent 的 ContextCompiler（子 Worker 可共享以减少开销）
        self._parent_context_compiler = context_compiler
        
        # 活跃 Worker 追踪
        self._active_workers: Dict[str, WorkerExecution] = {}
        self._worker_history: List[WorkerExecution] = []
        
        # 并发控制
        self._semaphore = asyncio.Semaphore(max_concurrent_workers)
    
    async def spawn_worker(
        self,
        task_description: str,
        config: Optional[WorkerConfig] = None,
        context: Optional[Dict[str, Any]] = None,
        stream: bool = False,
    ) -> Union[WorkerResult, AsyncGenerator[Dict[str, Any], None]]:
        """
        创建并执行子 Worker。
        
        这是核心工具方法，可以被 LLM 调用来委派任务给子 Worker。
        
        Args:
            task_description: 任务描述，应包含所有必要信息
            config: Worker 配置（可选）
            context: 额外上下文信息（可选）
            stream: 是否返回流式响应
            
        Returns:
            WorkerResult 或流式响应生成器
        """
        config = config or WorkerConfig()
        
        # 创建执行记录
        worker_context = WorkerContext(
            task_description=task_description,
            background_context=context.get("background") if context else None,
            parent_agent_id=context.get("parent_agent_id") if context else None,
            parent_plan_id=context.get("parent_plan_id") if context else None,
            subtask_index=context.get("subtask_index") if context else None,
        )
        
        execution = WorkerExecution(
            config=config,
            context=worker_context,
        )
        
        if stream:
            return self._execute_worker_stream(execution)
        else:
            return await self._execute_worker(execution)
    
    async def _execute_worker(self, execution: WorkerExecution) -> WorkerResult:
        """
        执行 Worker（非流式）。
        
        Args:
            execution: 执行记录
            
        Returns:
            执行结果
        """
        async with self._semaphore:
            self._active_workers[execution.id] = execution
            execution.start()
            
            # [NEW] 创建发现注册器
            discovery_registry = DiscoveryRegistry(
                bus=self.discovery_bus,
                worker_id=execution.id,
                current_task=execution.context.task_description,
            )
            
            try:
                logger.info(f"Worker {execution.id} started: {execution.context.task_description[:50]}...")
                
                # 构建系统提示
                system_prompt = execution.config.system_prompt or self.default_system_prompt
                
                # 执行任务（传入 discovery_registry）
                result = await self._run_worker_loop(
                    execution=execution,
                    system_prompt=system_prompt,
                    discovery_registry=discovery_registry,
                )
                
                # [NEW] 附加发现到结果
                local_discoveries = discovery_registry.get_local_discoveries()
                if local_discoveries:
                    result.metadata["discoveries"] = [d.model_dump() for d in local_discoveries]
                    result.insights.extend([
                        f"[Discovery] {d.type}: {d.name}" for d in local_discoveries
                    ])
                
                execution.complete(result)
                logger.info(f"Worker {execution.id} completed: {result.success}")
                
                return result
                
            except asyncio.CancelledError:
                execution.cancel()
                logger.warning(f"Worker {execution.id} cancelled")
                
                # [NEW] 保存中断快照
                interrupt_signal = self.interrupt_manager.get_interrupt_signal(execution.id)
                if interrupt_signal and interrupt_signal.save_state:
                    snapshot = self.interrupt_manager.create_snapshot(
                        task_id=execution.id,
                        task_type="worker",
                        state={
                            "context": execution.context.model_dump(),
                            "config": execution.config.model_dump(),
                            "iterations": execution.iterations,
                        },
                    )
                    self.interrupt_manager.save_snapshot(snapshot)
                
                return WorkerResult(
                    success=False,
                    message=f"Worker was interrupted: {interrupt_signal.message if interrupt_signal else 'unknown'}",
                    metadata={"interrupted": True, "snapshot_saved": interrupt_signal.save_state if interrupt_signal else False}
                )
                
            except asyncio.TimeoutError:
                execution.fail("Timeout exceeded")
                logger.error(f"Worker {execution.id} timed out")
                return WorkerResult(
                    success=False,
                    message=f"Worker timed out after {execution.config.timeout_seconds}s",
                )
                
            except Exception as e:
                execution.fail(str(e))
                logger.error(f"Worker {execution.id} failed: {e}")
                return WorkerResult(
                    success=False,
                    message=f"Worker failed: {str(e)}",
                )
                
            finally:
                self._active_workers.pop(execution.id, None)
                self._worker_history.append(execution)
    
    async def _execute_worker_stream(
        self,
        execution: WorkerExecution
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        执行 Worker（流式）。
        
        内化自 AgentScope 的流式响应模式。
        
        Args:
            execution: 执行记录
            
        Yields:
            中间状态和最终结果
        """
        async with self._semaphore:
            self._active_workers[execution.id] = execution
            execution.start()
            
            yield {
                "type": "started",
                "worker_id": execution.id,
                "task": execution.context.task_description,
            }
            
            try:
                system_prompt = execution.config.system_prompt or self.default_system_prompt
                
                # 模拟迭代过程
                for iteration in range(execution.config.max_iterations):
                    execution.iterations = iteration + 1
                    
                    yield {
                        "type": "progress",
                        "worker_id": execution.id,
                        "iteration": iteration + 1,
                        "max_iterations": execution.config.max_iterations,
                    }
                    
                    # 检查是否应该完成
                    if await self._should_finish(execution, iteration):
                        break
                    
                    await asyncio.sleep(0.1)  # 模拟处理时间
                
                # [NEW] 检查中断
                if self.interrupt_manager.is_interrupted(execution.id):
                    raise asyncio.CancelledError("Worker interrupted during streaming")
                
                # 生成最终结果
                result = await self._generate_final_result(execution)
                execution.complete(result)
                
                yield {
                    "type": "completed",
                    "worker_id": execution.id,
                    "result": result.model_dump(),
                }
                
            except asyncio.CancelledError:
                execution.cancel()
                yield {
                    "type": "cancelled",
                    "worker_id": execution.id,
                }
                
            except Exception as e:
                execution.fail(str(e))
                yield {
                    "type": "failed",
                    "worker_id": execution.id,
                    "error": str(e),
                }
                
            finally:
                self._active_workers.pop(execution.id, None)
                self._worker_history.append(execution)
    
    async def _run_worker_loop(
        self,
        execution: WorkerExecution,
        system_prompt: str,
        discovery_registry: Optional[DiscoveryRegistry] = None,
    ) -> WorkerResult:
        """
        运行 Worker 主循环。
        
        在实际实现中，这里会调用 LLM 进行推理和工具调用。
        当前为简化实现，直接返回模拟结果。
        
        Args:
            execution: 执行记录
            system_prompt: 系统提示
            discovery_registry: [NEW] 发现注册器
            
        Returns:
            执行结果
        """
        task = execution.context.task_description
        
        # [NEW] 模拟执行步骤以便测试中断
        for i in range(3):
            # 检查中断
            if self.interrupt_manager.is_interrupted(execution.id):
                raise asyncio.CancelledError("Worker interrupted during execution loop")
            
            await asyncio.sleep(0.01)  # 模拟处理时间
            execution.iterations = i + 1
        
        # 如果有 LLM Provider，尝试执行
        if self.llm_provider:
            try:
                # 构建 prompt（包含 Discovery 能力说明）
                discovery_hint = ""
                if discovery_registry:
                    discovery_hint = """
4. If you discover any new tools, APIs, or important insights, report them using the register_discovery function.
"""
                
                prompt = f"""Task: {task}

Instructions:
1. Analyze the task requirements
2. Execute the necessary steps
3. Report your findings
{discovery_hint}
Please complete this task and provide a structured response."""

                # 调用 LLM
                response = await self._invoke_llm(prompt, system_prompt)
                
                # 解析响应
                return self._parse_worker_response(response, task)
                
            except Exception as e:
                logger.warning(f"LLM execution failed: {e}, using fallback")
        
        # 降级：返回模拟结果
        return self._create_fallback_result(task)
    
    async def _invoke_llm(self, prompt: str, system_prompt: str) -> str:
        """调用 LLM"""
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]
        
        if hasattr(self.llm_provider, 'ainvoke'):
            response = await self.llm_provider.ainvoke(messages)
        elif hasattr(self.llm_provider, 'invoke'):
            response = self.llm_provider.invoke(messages)
        else:
            raise ValueError("LLM provider must have ainvoke or invoke method")
        
        if hasattr(response, 'content'):
            return response.content
        elif isinstance(response, str):
            return response
        else:
            return str(response)
    
    def _parse_worker_response(self, response: str, task: str) -> WorkerResult:
        """解析 Worker 响应"""
        # 尝试从响应中提取 JSON
        try:
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            
            if json_start >= 0 and json_end > json_start:
                json_str = response[json_start:json_end]
                data = json.loads(json_str)
                return WorkerResult.model_validate(data)
        except:
            pass
        
        # 降级：从文本构建结果
        return WorkerResult(
            success=True,
            message=response[:500] if len(response) > 500 else response,
            insights=[f"Completed task: {task[:100]}"],
        )
    
    def _create_fallback_result(self, task: str) -> WorkerResult:
        """创建降级结果"""
        return WorkerResult(
            success=True,
            message=f"Task acknowledged: {task[:200]}... (Fallback mode - no LLM available)",
            insights=[
                "Worker operated in fallback mode",
                "LLM provider was not available",
            ],
            metadata={"fallback": True}
        )
    
    async def _should_finish(self, execution: WorkerExecution, iteration: int) -> bool:
        """判断是否应该结束执行"""
        # 简化实现：在第 3 次迭代后结束
        return iteration >= 2
    
    async def _generate_final_result(self, execution: WorkerExecution) -> WorkerResult:
        """生成最终结果"""
        return WorkerResult(
            success=True,
            message=f"Completed task in {execution.iterations} iterations: {execution.context.task_description[:100]}...",
            insights=[f"Task completed after {execution.iterations} iterations"],
            metadata={
                "iterations": execution.iterations,
                "worker_id": execution.id,
            }
        )
    
    # =========================================================================
    # 工具接口（供 LLM Function Calling 使用）
    # =========================================================================
    
    def get_tool_schema(self) -> Dict[str, Any]:
        """
        获取 spawn_worker 工具的 JSON Schema。
        
        Returns:
            用于 LLM function calling 的 Schema
        """
        return {
            "type": "function",
            "function": {
                "name": "spawn_worker",
                "description": "创建一个子 Worker 来执行特定任务。适用于需要独立执行的子任务，如搜索、分析、代码执行等。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "task_description": {
                            "type": "string",
                            "description": "任务描述，应包含所有必要信息以便 Worker 独立完成任务"
                        },
                        "worker_name": {
                            "type": "string",
                            "description": "Worker 名称（可选）"
                        },
                        "max_iterations": {
                            "type": "integer",
                            "description": "最大迭代次数（可选，默认 10）",
                            "default": 10
                        },
                        "tools": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Worker 可用的工具列表（可选）"
                        }
                    },
                    "required": ["task_description"]
                }
            }
        }
    
    async def call_tool(self, **kwargs) -> WorkerResult:
        """
        工具调用入口（供 Agent 工具执行器使用）。
        
        Args:
            **kwargs: 工具参数
            
        Returns:
            WorkerResult
        """
        task_description = kwargs.get("task_description", "")
        worker_name = kwargs.get("worker_name", "Worker")
        max_iterations = kwargs.get("max_iterations", 10)
        tools = kwargs.get("tools", [])
        
        config = WorkerConfig(
            name=worker_name,
            max_iterations=max_iterations,
            tools=tools,
        )
        
        return await self.spawn_worker(
            task_description=task_description,
            config=config,
        )
    
    # =========================================================================
    # 状态管理
    # =========================================================================
    
    def get_active_workers(self) -> List[WorkerExecution]:
        """获取活跃 Worker 列表"""
        return list(self._active_workers.values())
    
    def get_worker_history(self, limit: int = 10) -> List[WorkerExecution]:
        """获取 Worker 历史记录"""
        return self._worker_history[-limit:]
    
    async def cancel_worker(
        self,
        worker_id: str,
        reason: InterruptReason = InterruptReason.USER_REQUEST,
        message: Optional[str] = None,
        save_state: bool = True,
    ) -> bool:
        """
        取消指定 Worker（通过中断机制）。
        
        Args:
            worker_id: Worker ID
            reason: [NEW] 中断原因
            message: [NEW] 中断消息
            save_state: [NEW] 是否保存状态
            
        Returns:
            是否成功发送中断信号
        """
        if worker_id in self._active_workers:
            # [NEW] 发送中断信号
            self.interrupt_manager.interrupt(
                task_id=worker_id,
                reason=reason,
                strategy=InterruptStrategy.GRACEFUL,
                message=message or f"Worker {worker_id} cancelled by user",
                save_state=save_state,
            )
            return True
        return False
    
    async def resume_worker(self, snapshot_id: str) -> Optional[WorkerResult]:
        """
        从快照恢复 Worker 执行。
        
        Args:
            snapshot_id: 快照 ID
            
        Returns:
            Worker 执行结果（如果成功恢复）
        """
        snapshot = self.interrupt_manager.load_snapshot(snapshot_id)
        if not snapshot or not snapshot.can_resume:
            logger.error(f"Cannot resume from snapshot {snapshot_id}")
            return None
        
        logger.info(f"Resuming worker from snapshot {snapshot_id}")
        
        # 从快照恢复上下文和配置
        context_data = snapshot.state.get("context", {})
        config_data = snapshot.state.get("config", {})
        
        context = WorkerContext.model_validate(context_data)
        config = WorkerConfig.model_validate(config_data)
        
        # 重新执行（TODO: 应该从中断点继续而非重新执行）
        return await self.spawn_worker(
            task_description=context.task_description,
            config=config,
            context={
                "background": context.background_context,
                "parent_agent_id": context.parent_agent_id,
                "resumed_from": snapshot_id,
            }
        )
    
    def set_parent_context_compiler(self, compiler: ContextCompiler) -> None:
        """
        设置父 Agent 的 ContextCompiler。
        
        子 Worker 可以共享这个 Compiler 以避免重复压缩开销。
        
        Args:
            compiler: ContextCompiler 实例
        """
        self._parent_context_compiler = compiler
        logger.info("Parent ContextCompiler set for worker spawner")
    
    def get_context_compiler(self, create_if_missing: bool = True) -> Optional[ContextCompiler]:
        """
        获取 ContextCompiler（共享或新建）。
        
        Args:
            create_if_missing: 如果没有设置父 Compiler，是否创建新的
            
        Returns:
            ContextCompiler 实例或 None
        """
        if self._parent_context_compiler:
            return self._parent_context_compiler
        
        if create_if_missing:
            # 创建一个轻量级的简单 Compiler（不使用 LLM）
            return create_context_compiler(use_simple_summarizer=True)
        
        return None
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        total = len(self._worker_history)
        successful = sum(1 for w in self._worker_history if w.status == WorkerStatus.COMPLETED and w.result and w.result.success)
        failed = sum(1 for w in self._worker_history if w.status in [WorkerStatus.FAILED, WorkerStatus.CANCELLED])
        
        stats = {
            "active_workers": len(self._active_workers),
            "total_executions": total,
            "successful": successful,
            "failed": failed,
            "success_rate": successful / total if total > 0 else 0.0,
            "has_shared_context_compiler": self._parent_context_compiler is not None,
        }
        
        # 包含 ContextCompiler 统计（如果有）
        if self._parent_context_compiler:
            stats["context_compiler_stats"] = self._parent_context_compiler.get_compaction_stats()
        
        return stats

