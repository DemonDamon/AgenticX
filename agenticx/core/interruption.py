"""
Interruption & State Recovery - 实时中断与状态恢复

参考自 AgentScope 的 Realtime Steering 机制

提供长周期任务的实时中断能力：
- 优雅中断正在执行的 Worker
- 保存执行状态以便恢复
- 支持检查点（Checkpoint）机制

设计原则（来自 AgentScope）：
- _is_interrupted 元数据标记
- 异步 CancelledError 处理
- 状态快照与恢复
"""

from typing import Optional, Dict, Any, List, Callable, Awaitable
from datetime import datetime, timezone
from enum import Enum
import asyncio
import logging
import json
from pathlib import Path

from pydantic import BaseModel, Field  # type: ignore

logger = logging.getLogger(__name__)


# =============================================================================
# 中断类型
# =============================================================================

class InterruptReason(str, Enum):
    """中断原因"""
    USER_REQUEST = "user_request"        # 用户主动中断
    TIMEOUT = "timeout"                  # 超时
    ERROR = "error"                      # 错误
    RESOURCE_LIMIT = "resource_limit"    # 资源限制
    PRIORITY_CHANGE = "priority_change"  # 优先级变更
    EMERGENCY = "emergency"              # 紧急中断


class InterruptStrategy(str, Enum):
    """中断策略"""
    IMMEDIATE = "immediate"      # 立即中断
    GRACEFUL = "graceful"        # 优雅中断（完成当前步骤）
    CHECKPOINT = "checkpoint"    # 等到下一个检查点


# =============================================================================
# 中断信号
# =============================================================================

class InterruptSignal(BaseModel):
    """
    中断信号。
    
    参考自 AgentScope 的 _is_interrupted 元数据模式。
    """
    id: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")[:16]
    )
    reason: InterruptReason = Field(
        description="中断原因"
    )
    strategy: InterruptStrategy = Field(
        default=InterruptStrategy.GRACEFUL,
        description="中断策略"
    )
    message: Optional[str] = Field(
        default=None,
        description="中断消息"
    )
    save_state: bool = Field(
        default=True,
        description="是否保存状态"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="额外元数据"
    )
    
    def to_metadata(self) -> Dict[str, Any]:
        """转换为元数据格式（兼容 AgentScope）"""
        return {
            "_is_interrupted": True,
            "_interrupt_reason": self.reason.value,
            "_interrupt_strategy": self.strategy.value,
            "_interrupt_message": self.message,
            "_interrupt_timestamp": self.created_at,
        }


# =============================================================================
# 执行状态快照
# =============================================================================

class ExecutionSnapshot(BaseModel):
    """
    执行状态快照。
    
    用于保存中断时的执行状态，以便后续恢复。
    """
    snapshot_id: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    )
    task_id: str = Field(
        description="任务 ID"
    )
    task_type: str = Field(
        description="任务类型（worker/plan/etc）"
    )
    state: Dict[str, Any] = Field(
        description="状态数据"
    )
    current_step: Optional[int] = Field(
        default=None,
        description="当前步骤索引"
    )
    completed_steps: List[int] = Field(
        default_factory=list,
        description="已完成的步骤"
    )
    interrupt_signal: InterruptSignal = Field(
        description="触发的中断信号"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    can_resume: bool = Field(
        default=True,
        description="是否可以恢复"
    )
    
    def save_to_file(self, path: Path) -> None:
        """保存快照到文件"""
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(self.model_dump(), f, indent=2, ensure_ascii=False)
        logger.info(f"Snapshot saved to {path}")
    
    @classmethod
    def load_from_file(cls, path: Path) -> "ExecutionSnapshot":
        """从文件加载快照"""
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return cls.model_validate(data)


# =============================================================================
# 中断管理器
# =============================================================================

class InterruptionManager:
    """
    中断管理器 - 管理任务的中断和恢复。
    
    核心功能：
    - 发送中断信号
    - 监听中断
    - 保存/恢复执行状态
    
    使用示例:
    ```python
    manager = InterruptionManager()
    
    # 在执行循环中检查中断
    async def worker_loop(task_id):
        for step in steps:
            # 检查中断
            if manager.is_interrupted(task_id):
                snapshot = manager.create_snapshot(task_id, state=...)
                manager.save_snapshot(snapshot)
                raise asyncio.CancelledError()
            
            # 执行步骤
            await execute_step(step)
    
    # 发送中断信号
    manager.interrupt(task_id, reason=InterruptReason.USER_REQUEST)
    ```
    """
    
    def __init__(self, snapshot_dir: Optional[Path] = None):
        """
        初始化中断管理器。
        
        Args:
            snapshot_dir: 快照保存目录
        """
        self.snapshot_dir = snapshot_dir or Path(".agenticx/snapshots")
        
        # 活跃任务的中断信号
        self._interrupt_signals: Dict[str, InterruptSignal] = {}
        
        # 快照存储
        self._snapshots: Dict[str, ExecutionSnapshot] = {}
        
        # 中断回调
        self._interrupt_callbacks: Dict[str, List[Callable]] = {}
    
    def interrupt(
        self,
        task_id: str,
        reason: InterruptReason = InterruptReason.USER_REQUEST,
        strategy: InterruptStrategy = InterruptStrategy.GRACEFUL,
        message: Optional[str] = None,
        save_state: bool = True,
    ) -> InterruptSignal:
        """
        发送中断信号。
        
        Args:
            task_id: 任务 ID
            reason: 中断原因
            strategy: 中断策略
            message: 中断消息
            save_state: 是否保存状态
            
        Returns:
            创建的中断信号
        """
        signal = InterruptSignal(
            reason=reason,
            strategy=strategy,
            message=message,
            save_state=save_state,
        )
        
        self._interrupt_signals[task_id] = signal
        
        logger.info(f"Interrupt signal sent to task {task_id}: {reason.value}")
        
        # 触发回调
        self._trigger_callbacks(task_id, signal)
        
        return signal
    
    def is_interrupted(self, task_id: str) -> bool:
        """
        检查任务是否被中断。
        
        Args:
            task_id: 任务 ID
            
        Returns:
            是否被中断
        """
        return task_id in self._interrupt_signals
    
    def get_interrupt_signal(self, task_id: str) -> Optional[InterruptSignal]:
        """
        获取中断信号。
        
        Args:
            task_id: 任务 ID
            
        Returns:
            中断信号（如果有）
        """
        return self._interrupt_signals.get(task_id)
    
    def clear_interrupt(self, task_id: str) -> bool:
        """
        清除中断信号。
        
        Args:
            task_id: 任务 ID
            
        Returns:
            是否清除成功
        """
        if task_id in self._interrupt_signals:
            del self._interrupt_signals[task_id]
            logger.debug(f"Interrupt signal cleared for task {task_id}")
            return True
        return False
    
    def create_snapshot(
        self,
        task_id: str,
        task_type: str,
        state: Dict[str, Any],
        current_step: Optional[int] = None,
        completed_steps: Optional[List[int]] = None,
    ) -> ExecutionSnapshot:
        """
        创建执行状态快照。
        
        Args:
            task_id: 任务 ID
            task_type: 任务类型
            state: 状态数据
            current_step: 当前步骤
            completed_steps: 已完成步骤
            
        Returns:
            执行快照
        """
        signal = self.get_interrupt_signal(task_id)
        if not signal:
            signal = InterruptSignal(
                reason=InterruptReason.USER_REQUEST,
                strategy=InterruptStrategy.GRACEFUL,
            )
        
        snapshot = ExecutionSnapshot(
            task_id=task_id,
            task_type=task_type,
            state=state,
            current_step=current_step,
            completed_steps=completed_steps or [],
            interrupt_signal=signal,
        )
        
        self._snapshots[snapshot.snapshot_id] = snapshot
        
        logger.info(f"Snapshot created for task {task_id}: {snapshot.snapshot_id}")
        
        return snapshot
    
    def save_snapshot(self, snapshot: ExecutionSnapshot) -> Path:
        """
        保存快照到磁盘。
        
        Args:
            snapshot: 执行快照
            
        Returns:
            快照文件路径
        """
        filename = f"{snapshot.task_id}_{snapshot.snapshot_id}.json"
        path = self.snapshot_dir / filename
        snapshot.save_to_file(path)
        return path
    
    def load_snapshot(self, snapshot_id: str) -> Optional[ExecutionSnapshot]:
        """
        加载快照。
        
        Args:
            snapshot_id: 快照 ID
            
        Returns:
            执行快照（如果存在）
        """
        # 先从内存查找
        if snapshot_id in self._snapshots:
            return self._snapshots[snapshot_id]
        
        # 从磁盘查找
        for path in self.snapshot_dir.glob(f"*_{snapshot_id}.json"):
            snapshot = ExecutionSnapshot.load_from_file(path)
            self._snapshots[snapshot_id] = snapshot
            return snapshot
        
        return None
    
    def list_snapshots(self, task_id: Optional[str] = None) -> List[ExecutionSnapshot]:
        """
        列出快照。
        
        Args:
            task_id: 按任务 ID 过滤（可选）
            
        Returns:
            快照列表
        """
        snapshots = list(self._snapshots.values())
        
        if task_id:
            snapshots = [s for s in snapshots if s.task_id == task_id]
        
        return sorted(snapshots, key=lambda s: s.created_at, reverse=True)
    
    def register_callback(
        self,
        task_id: str,
        callback: Callable[[InterruptSignal], None],
    ) -> None:
        """
        注册中断回调。
        
        Args:
            task_id: 任务 ID
            callback: 回调函数
        """
        if task_id not in self._interrupt_callbacks:
            self._interrupt_callbacks[task_id] = []
        self._interrupt_callbacks[task_id].append(callback)
    
    def _trigger_callbacks(self, task_id: str, signal: InterruptSignal) -> None:
        """触发中断回调"""
        callbacks = self._interrupt_callbacks.get(task_id, [])
        for callback in callbacks:
            try:
                callback(signal)
            except Exception as e:
                logger.error(f"Interrupt callback failed: {e}")
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        return {
            "active_interrupts": len(self._interrupt_signals),
            "snapshots_count": len(self._snapshots),
            "callbacks_registered": sum(len(cbs) for cbs in self._interrupt_callbacks.values()),
        }


# =============================================================================
# 可中断任务包装器
# =============================================================================

class InterruptibleTask:
    """
    可中断任务包装器。
    
    提供简化的 API 来创建可中断的异步任务。
    
    使用示例:
    ```python
    task = InterruptibleTask(
        task_id="worker-001",
        manager=interrupt_manager,
    )
    
    @task.interruptible
    async def my_long_task():
        for i in range(100):
            task.check_interrupt()  # 检查点
            await do_work(i)
        return "completed"
    
    result = await task.run(my_long_task)
    ```
    """
    
    def __init__(
        self,
        task_id: str,
        manager: InterruptionManager,
        auto_save: bool = True,
    ):
        """
        初始化可中断任务。
        
        Args:
            task_id: 任务 ID
            manager: 中断管理器
            auto_save: 是否自动保存快照
        """
        self.task_id = task_id
        self.manager = manager
        self.auto_save = auto_save
        
        self.current_state: Dict[str, Any] = {}
        self.current_step: Optional[int] = None
        self.completed_steps: List[int] = []
    
    def check_interrupt(self) -> None:
        """
        检查中断（检查点）。
        
        如果任务被中断，抛出 CancelledError。
        """
        if self.manager.is_interrupted(self.task_id):
            signal = self.manager.get_interrupt_signal(self.task_id)
            
            if self.auto_save and signal and signal.save_state:
                # 自动保存快照
                snapshot = self.manager.create_snapshot(
                    task_id=self.task_id,
                    task_type="generic",
                    state=self.current_state,
                    current_step=self.current_step,
                    completed_steps=self.completed_steps,
                )
                self.manager.save_snapshot(snapshot)
            
            logger.info(f"Task {self.task_id} interrupted: {signal.reason if signal else 'unknown'}")
            raise asyncio.CancelledError(f"Interrupted: {signal.message if signal else ''}")
    
    def update_state(
        self,
        state: Dict[str, Any],
        current_step: Optional[int] = None,
    ) -> None:
        """
        更新任务状态。
        
        Args:
            state: 状态数据
            current_step: 当前步骤
        """
        self.current_state.update(state)
        if current_step is not None:
            self.current_step = current_step
            if current_step not in self.completed_steps:
                if self.current_step is not None and self.current_step > 0:
                    prev_step = self.current_step - 1
                    if prev_step not in self.completed_steps:
                        self.completed_steps.append(prev_step)
    
    async def run(
        self,
        coro: Awaitable[Any],
        timeout: Optional[float] = None,
    ) -> Any:
        """
        运行可中断任务。
        
        Args:
            coro: 协程
            timeout: 超时时间（秒）
            
        Returns:
            任务结果
        """
        try:
            if timeout:
                return await asyncio.wait_for(coro, timeout=timeout)
            else:
                return await coro
        except asyncio.CancelledError:
            logger.info(f"Task {self.task_id} was cancelled")
            raise
        except asyncio.TimeoutError:
            logger.error(f"Task {self.task_id} timed out")
            self.manager.interrupt(
                self.task_id,
                reason=InterruptReason.TIMEOUT,
                message=f"Timeout after {timeout}s",
            )
            raise


# =============================================================================
# 全局中断管理器（单例）
# =============================================================================

_global_interrupt_manager: Optional[InterruptionManager] = None


def get_interrupt_manager() -> InterruptionManager:
    """获取全局中断管理器实例"""
    global _global_interrupt_manager
    if _global_interrupt_manager is None:
        _global_interrupt_manager = InterruptionManager()
    return _global_interrupt_manager


def reset_interrupt_manager() -> None:
    """重置全局中断管理器（主要用于测试）"""
    global _global_interrupt_manager
    _global_interrupt_manager = None

