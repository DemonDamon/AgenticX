"""
后台任务池 (内化自 Agno)

设计原理：
- Agno 使用共享线程池执行 Memory 持久化、Session 更新等非关键任务
- 这些任务不阻塞主 LLM 响应路径，显著降低感知延迟
- 本模块提供 AgenticX 的后台任务池实现

技术约束：
- 不新增外部依赖（使用标准库 concurrent.futures 和 asyncio）
- Python 3.10+ 兼容

使用场景：
- Memory 持久化到外部存储
- 可观测性数据上报
- Session 状态异步同步
- 非关键的日志写入

来源参考：
- agno/utils/agent.py: wait_for_open_threads, wait_for_thread_tasks_stream
- agno/memory/manager.py: 后台记忆更新
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import traceback
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union
from weakref import WeakSet

logger = logging.getLogger(__name__)

# 类型变量
T = TypeVar("T")


class TaskStatus(str, Enum):
    """后台任务状态。"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskPriority(int, Enum):
    """任务优先级（数值越小优先级越高）。"""
    CRITICAL = 0    # 关键任务，如错误上报
    HIGH = 1        # 高优先级，如 Memory 持久化
    NORMAL = 2      # 普通任务
    LOW = 3         # 低优先级，如日志归档


@dataclass
class BackgroundTask:
    """后台任务的封装。"""
    id: str
    name: str
    func: Callable[..., Any]
    args: tuple = field(default_factory=tuple)
    kwargs: Dict[str, Any] = field(default_factory=dict)
    priority: TaskPriority = TaskPriority.NORMAL
    status: TaskStatus = TaskStatus.PENDING
    result: Any = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    
    @property
    def execution_time_ms(self) -> Optional[float]:
        """执行耗时（毫秒）。"""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at) * 1000
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "priority": self.priority.name,
            "status": self.status.value,
            "result": str(self.result) if self.result else None,
            "error": self.error,
            "execution_time_ms": self.execution_time_ms,
        }


class BackgroundTaskPool:
    """
    后台任务池，用于执行非阻塞的后台任务。
    
    设计原理（内化自 Agno）：
    - 使用 ThreadPoolExecutor 处理 CPU 密集型或同步阻塞任务
    - 使用 asyncio.create_task 处理异步任务
    - 提供任务追踪和优雅关闭机制
    - 支持任务优先级（通过提交顺序近似实现）
    
    线程安全：
    - 内部使用锁保护任务列表
    - 可在多线程环境中安全使用
    
    Example:
        >>> pool = BackgroundTaskPool(max_workers=4)
        >>> 
        >>> # 提交同步任务
        >>> task_id = pool.submit(
        ...     save_to_database, 
        ...     args=(data,), 
        ...     name="save_memory",
        ...     priority=TaskPriority.HIGH
        ... )
        >>> 
        >>> # 提交异步任务
        >>> task_id = await pool.submit_async(
        ...     async_upload_metrics,
        ...     args=(metrics,),
        ...     name="upload_metrics"
        ... )
        >>> 
        >>> # 等待所有任务完成（如在关闭时）
        >>> await pool.wait_all(timeout=30.0)
        >>> pool.shutdown()
    """
    
    # 全局默认实例（单例模式）
    _default_instance: Optional["BackgroundTaskPool"] = None
    _instance_lock = threading.Lock()
    
    def __init__(
        self,
        max_workers: int = 4,
        thread_name_prefix: str = "agenticx-bg-",
    ):
        """
        初始化后台任务池。
        
        Args:
            max_workers: 最大工作线程数
            thread_name_prefix: 线程名前缀（便于调试）
        """
        self.max_workers = max_workers
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix=thread_name_prefix,
        )
        self._tasks: Dict[str, BackgroundTask] = {}
        self._futures: Dict[str, Future] = {}
        self._async_tasks: WeakSet[asyncio.Task] = WeakSet()
        self._lock = threading.Lock()
        self._task_counter = 0
        self._shutdown = False
        
        logger.debug(f"BackgroundTaskPool initialized with {max_workers} workers")
    
    @classmethod
    def get_default(cls, max_workers: int = 4) -> "BackgroundTaskPool":
        """获取全局默认实例（懒加载单例）。"""
        if cls._default_instance is None:
            with cls._instance_lock:
                if cls._default_instance is None:
                    cls._default_instance = cls(max_workers=max_workers)
        return cls._default_instance
    
    def _generate_task_id(self) -> str:
        """生成唯一的任务 ID。"""
        with self._lock:
            self._task_counter += 1
            return f"bg-task-{self._task_counter}-{int(time.time() * 1000)}"
    
    def submit(
        self,
        func: Callable[..., T],
        args: tuple = (),
        kwargs: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
        priority: TaskPriority = TaskPriority.NORMAL,
    ) -> str:
        """
        提交同步任务到后台线程池。
        
        Args:
            func: 要执行的函数
            args: 位置参数
            kwargs: 关键字参数
            name: 任务名称（用于追踪）
            priority: 任务优先级
            
        Returns:
            任务 ID
            
        Raises:
            RuntimeError: 如果任务池已关闭
        """
        if self._shutdown:
            raise RuntimeError("BackgroundTaskPool has been shut down")
        
        task_id = self._generate_task_id()
        task_name = name or func.__name__
        
        task = BackgroundTask(
            id=task_id,
            name=task_name,
            func=func,
            args=args,
            kwargs=kwargs or {},
            priority=priority,
        )
        
        def _execute():
            task.status = TaskStatus.RUNNING
            task.started_at = time.time()
            try:
                task.result = func(*args, **(kwargs or {}))
                task.status = TaskStatus.COMPLETED
                logger.debug(f"Background task '{task_name}' completed successfully")
            except Exception as e:
                task.status = TaskStatus.FAILED
                task.error = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
                logger.warning(f"Background task '{task_name}' failed: {e}")
            finally:
                task.completed_at = time.time()
        
        with self._lock:
            self._tasks[task_id] = task
            future = self._executor.submit(_execute)
            self._futures[task_id] = future
        
        logger.debug(f"Submitted background task '{task_name}' with id={task_id}")
        return task_id
    
    async def submit_async(
        self,
        coro_func: Callable[..., Any],
        args: tuple = (),
        kwargs: Optional[Dict[str, Any]] = None,
        name: Optional[str] = None,
        priority: TaskPriority = TaskPriority.NORMAL,
    ) -> str:
        """
        提交异步任务。
        
        Args:
            coro_func: 协程函数
            args: 位置参数
            kwargs: 关键字参数
            name: 任务名称
            priority: 任务优先级
            
        Returns:
            任务 ID
        """
        if self._shutdown:
            raise RuntimeError("BackgroundTaskPool has been shut down")
        
        task_id = self._generate_task_id()
        task_name = name or coro_func.__name__
        
        task = BackgroundTask(
            id=task_id,
            name=task_name,
            func=coro_func,
            args=args,
            kwargs=kwargs or {},
            priority=priority,
        )
        
        async def _execute():
            task.status = TaskStatus.RUNNING
            task.started_at = time.time()
            try:
                task.result = await coro_func(*args, **(kwargs or {}))
                task.status = TaskStatus.COMPLETED
                logger.debug(f"Async background task '{task_name}' completed successfully")
            except Exception as e:
                task.status = TaskStatus.FAILED
                task.error = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
                logger.warning(f"Async background task '{task_name}' failed: {e}")
            finally:
                task.completed_at = time.time()
        
        with self._lock:
            self._tasks[task_id] = task
            async_task = asyncio.create_task(_execute())
            self._async_tasks.add(async_task)
        
        logger.debug(f"Submitted async background task '{task_name}' with id={task_id}")
        return task_id
    
    def get_task(self, task_id: str) -> Optional[BackgroundTask]:
        """获取任务信息。"""
        with self._lock:
            return self._tasks.get(task_id)
    
    def get_task_status(self, task_id: str) -> Optional[TaskStatus]:
        """获取任务状态。"""
        task = self.get_task(task_id)
        return task.status if task else None
    
    def get_pending_count(self) -> int:
        """获取待处理任务数。"""
        with self._lock:
            return sum(1 for t in self._tasks.values() if t.status in (TaskStatus.PENDING, TaskStatus.RUNNING))
    
    def get_stats(self) -> Dict[str, Any]:
        """获取任务池统计信息。"""
        with self._lock:
            total = len(self._tasks)
            completed = sum(1 for t in self._tasks.values() if t.status == TaskStatus.COMPLETED)
            failed = sum(1 for t in self._tasks.values() if t.status == TaskStatus.FAILED)
            pending = sum(1 for t in self._tasks.values() if t.status in (TaskStatus.PENDING, TaskStatus.RUNNING))
            
            avg_time = 0.0
            completed_tasks = [t for t in self._tasks.values() if t.execution_time_ms is not None]
            if completed_tasks:
                avg_time = sum(t.execution_time_ms for t in completed_tasks) / len(completed_tasks)
            
            return {
                "total_tasks": total,
                "completed": completed,
                "failed": failed,
                "pending": pending,
                "avg_execution_time_ms": avg_time,
                "max_workers": self.max_workers,
                "shutdown": self._shutdown,
            }
    
    def wait(self, task_id: str, timeout: Optional[float] = None) -> Optional[Any]:
        """
        等待特定任务完成并返回结果。
        
        Args:
            task_id: 任务 ID
            timeout: 超时时间（秒）
            
        Returns:
            任务结果，如果任务失败或超时返回 None
        """
        with self._lock:
            future = self._futures.get(task_id)
        
        if future:
            try:
                future.result(timeout=timeout)
            except Exception:
                pass
        
        task = self.get_task(task_id)
        return task.result if task and task.status == TaskStatus.COMPLETED else None
    
    async def wait_async(self, task_id: str, timeout: Optional[float] = None) -> Optional[Any]:
        """
        异步等待特定任务完成。
        """
        start = time.time()
        while True:
            task = self.get_task(task_id)
            if task and task.status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
                return task.result if task.status == TaskStatus.COMPLETED else None
            
            if timeout and (time.time() - start) > timeout:
                return None
            
            await asyncio.sleep(0.01)  # 短暂让出控制权
    
    async def wait_all(self, timeout: Optional[float] = None) -> bool:
        """
        等待所有后台任务完成。
        
        Args:
            timeout: 超时时间（秒）
            
        Returns:
            是否所有任务都已完成
        """
        start = time.time()
        
        # 等待线程池任务
        with self._lock:
            futures = list(self._futures.values())
        
        for future in futures:
            remaining = None
            if timeout:
                remaining = timeout - (time.time() - start)
                if remaining <= 0:
                    return False
            try:
                future.result(timeout=remaining)
            except Exception:
                pass
        
        # 等待异步任务
        with self._lock:
            async_tasks = list(self._async_tasks)
        
        if async_tasks:
            remaining = None
            if timeout:
                remaining = timeout - (time.time() - start)
                if remaining <= 0:
                    return False
            
            try:
                await asyncio.wait_for(
                    asyncio.gather(*async_tasks, return_exceptions=True),
                    timeout=remaining,
                )
            except asyncio.TimeoutError:
                return False
        
        return True
    
    def shutdown(self, wait: bool = True, cancel_futures: bool = False) -> None:
        """
        关闭任务池。
        
        Args:
            wait: 是否等待正在执行的任务完成
            cancel_futures: 是否取消尚未开始的任务
        """
        self._shutdown = True
        self._executor.shutdown(wait=wait, cancel_futures=cancel_futures)
        logger.info("BackgroundTaskPool shut down")
    
    def __enter__(self) -> "BackgroundTaskPool":
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.shutdown(wait=True)


# =========================================================================
# 便捷函数
# =========================================================================

def submit_background_task(
    func: Callable[..., T],
    args: tuple = (),
    kwargs: Optional[Dict[str, Any]] = None,
    name: Optional[str] = None,
    priority: TaskPriority = TaskPriority.NORMAL,
) -> str:
    """
    提交后台任务的便捷函数（使用全局默认池）。
    
    Example:
        >>> from agenticx.core.background import submit_background_task, TaskPriority
        >>> 
        >>> task_id = submit_background_task(
        ...     save_memory,
        ...     args=(memory_data,),
        ...     name="save_user_memory",
        ...     priority=TaskPriority.HIGH
        ... )
    """
    pool = BackgroundTaskPool.get_default()
    return pool.submit(func, args, kwargs, name, priority)


async def submit_async_background_task(
    coro_func: Callable[..., Any],
    args: tuple = (),
    kwargs: Optional[Dict[str, Any]] = None,
    name: Optional[str] = None,
    priority: TaskPriority = TaskPriority.NORMAL,
) -> str:
    """
    提交异步后台任务的便捷函数。
    """
    pool = BackgroundTaskPool.get_default()
    return await pool.submit_async(coro_func, args, kwargs, name, priority)


def get_background_pool_stats() -> Dict[str, Any]:
    """获取全局后台任务池统计信息。"""
    pool = BackgroundTaskPool.get_default()
    return pool.get_stats()

