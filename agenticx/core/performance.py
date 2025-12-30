"""
性能监控模块 (参考自 Agno)

设计原理：
- Agno 提供 `PerformanceEval` 用于测量 Agent 的实例化时间和内存占用
- 本模块提供 AgenticX 的轻量级性能监控实现
- 支持实时监控和基准测试两种模式

技术约束：
- 不新增外部依赖（使用标准库 time、tracemalloc、resource）
- Python 3.10+ 兼容
- 监控开销尽可能小（< 1% 性能影响）

来源参考：
- agno/eval/performance.py: PerformanceEval
- agno/utils/timer.py: Timer

使用场景：
- Agent 实例化性能测试
- 执行循环耗时分析
- 内存增长追踪
- 生产环境性能采样
"""

from __future__ import annotations

import gc
import logging
import sys
import time
import tracemalloc
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import Enum
from functools import wraps
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union

logger = logging.getLogger(__name__)

T = TypeVar("T")


class MetricType(str, Enum):
    """指标类型。"""
    LATENCY = "latency"           # 延迟（毫秒）
    MEMORY = "memory"             # 内存（字节）
    THROUGHPUT = "throughput"     # 吞吐量（次/秒）
    COUNT = "count"               # 计数


@dataclass
class PerformanceMetric:
    """单个性能指标。"""
    name: str
    type: MetricType
    value: float
    unit: str
    timestamp: float = field(default_factory=time.time)
    tags: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "type": self.type.value,
            "value": self.value,
            "unit": self.unit,
            "timestamp": self.timestamp,
            "tags": self.tags,
        }


@dataclass
class PerformanceReport:
    """性能报告。"""
    name: str
    metrics: List[PerformanceMetric] = field(default_factory=list)
    start_time: float = field(default_factory=time.time)
    end_time: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def duration_ms(self) -> Optional[float]:
        """总耗时（毫秒）。"""
        if self.end_time:
            return (self.end_time - self.start_time) * 1000
        return None
    
    def add_metric(self, metric: PerformanceMetric) -> None:
        """添加指标。"""
        self.metrics.append(metric)
    
    def get_metric(self, name: str) -> Optional[PerformanceMetric]:
        """获取指标。"""
        for m in self.metrics:
            if m.name == name:
                return m
        return None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "duration_ms": self.duration_ms,
            "metrics": [m.to_dict() for m in self.metrics],
            "metadata": self.metadata,
        }
    
    def summary(self) -> str:
        """生成人类可读的摘要。"""
        lines = [f"Performance Report: {self.name}"]
        if self.duration_ms:
            lines.append(f"  Total Duration: {self.duration_ms:.2f} ms")
        for m in self.metrics:
            lines.append(f"  {m.name}: {m.value:.4f} {m.unit}")
        return "\n".join(lines)


class Timer:
    """
    轻量级计时器（参考自 Agno 的 utils/timer.py）。
    
    支持两种使用方式：
    1. 上下文管理器
    2. 手动 start/stop
    
    Example:
        >>> # 上下文管理器方式
        >>> with Timer() as t:
        ...     do_something()
        >>> print(f"耗时: {t.elapsed_ms:.2f} ms")
        >>> 
        >>> # 手动控制方式
        >>> timer = Timer()
        >>> timer.start()
        >>> do_something()
        >>> timer.stop()
        >>> print(f"耗时: {timer.elapsed_ms:.2f} ms")
    """
    
    def __init__(self, name: Optional[str] = None):
        self.name = name
        self._start_time: Optional[float] = None
        self._end_time: Optional[float] = None
        self._paused_time: float = 0.0
        self._pause_start: Optional[float] = None
    
    def start(self) -> "Timer":
        """开始计时。"""
        self._start_time = time.perf_counter()
        self._end_time = None
        self._paused_time = 0.0
        return self
    
    def stop(self) -> "Timer":
        """停止计时。"""
        if self._pause_start:
            self.resume()
        self._end_time = time.perf_counter()
        return self
    
    def pause(self) -> "Timer":
        """暂停计时。"""
        if self._pause_start is None:
            self._pause_start = time.perf_counter()
        return self
    
    def resume(self) -> "Timer":
        """恢复计时。"""
        if self._pause_start is not None:
            self._paused_time += time.perf_counter() - self._pause_start
            self._pause_start = None
        return self
    
    @property
    def elapsed_ns(self) -> float:
        """已用时间（纳秒）。"""
        if self._start_time is None:
            return 0.0
        end = self._end_time or time.perf_counter()
        return (end - self._start_time - self._paused_time) * 1e9
    
    @property
    def elapsed_us(self) -> float:
        """已用时间（微秒）。"""
        return self.elapsed_ns / 1000
    
    @property
    def elapsed_ms(self) -> float:
        """已用时间（毫秒）。"""
        return self.elapsed_ns / 1e6
    
    @property
    def elapsed_s(self) -> float:
        """已用时间（秒）。"""
        return self.elapsed_ns / 1e9
    
    def __enter__(self) -> "Timer":
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.stop()
    
    def __repr__(self) -> str:
        name_str = f"'{self.name}' " if self.name else ""
        return f"<Timer {name_str}elapsed={self.elapsed_ms:.3f}ms>"


class MemoryTracker:
    """
    内存追踪器。
    
    使用 tracemalloc 追踪内存分配，适用于找出内存泄漏或优化内存使用。
    
    Example:
        >>> with MemoryTracker() as tracker:
        ...     data = [i for i in range(1000000)]
        >>> print(f"内存增长: {tracker.peak_mb:.2f} MB")
    """
    
    def __init__(self):
        self._start_snapshot: Optional[Any] = None
        self._end_snapshot: Optional[Any] = None
        self._started = False
    
    def start(self) -> "MemoryTracker":
        """开始追踪。"""
        gc.collect()  # 先进行垃圾回收
        tracemalloc.start()
        self._start_snapshot = tracemalloc.take_snapshot()
        self._started = True
        return self
    
    def stop(self) -> "MemoryTracker":
        """停止追踪。"""
        if self._started:
            self._end_snapshot = tracemalloc.take_snapshot()
            tracemalloc.stop()
            self._started = False
        return self
    
    @property
    def current_bytes(self) -> int:
        """当前已追踪的内存（字节）。"""
        if tracemalloc.is_tracing():
            current, _ = tracemalloc.get_traced_memory()
            return current
        return 0
    
    @property
    def peak_bytes(self) -> int:
        """峰值内存（字节）。"""
        if tracemalloc.is_tracing():
            _, peak = tracemalloc.get_traced_memory()
            return peak
        return 0
    
    @property
    def peak_kb(self) -> float:
        """峰值内存（KB）。"""
        return self.peak_bytes / 1024
    
    @property
    def peak_mb(self) -> float:
        """峰值内存（MB）。"""
        return self.peak_bytes / (1024 * 1024)
    
    def get_diff_stats(self, limit: int = 10) -> List[Dict[str, Any]]:
        """
        获取内存增长的差异统计。
        
        Args:
            limit: 返回的最大条目数
            
        Returns:
            按内存增长排序的分配信息列表
        """
        if self._start_snapshot and self._end_snapshot:
            diff = self._end_snapshot.compare_to(self._start_snapshot, "lineno")
            results = []
            for stat in diff[:limit]:
                results.append({
                    "file": stat.traceback.format()[0] if stat.traceback else "unknown",
                    "size_diff_bytes": stat.size_diff,
                    "count_diff": stat.count_diff,
                })
            return results
        return []
    
    def __enter__(self) -> "MemoryTracker":
        self.start()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.stop()


class PerformanceMonitor:
    """
    性能监控器（参考自 Agno 的 PerformanceEval）。
    
    提供统一的性能监控接口，支持：
    - 延迟测量
    - 内存追踪
    - 吞吐量计算
    - 基准测试
    
    Example:
        >>> monitor = PerformanceMonitor("agent_execution")
        >>> 
        >>> with monitor.measure("instantiation"):
        ...     agent = Agent.fast_construct(...)
        >>> 
        >>> with monitor.measure("llm_call"):
        ...     response = await llm.invoke(...)
        >>> 
        >>> report = monitor.get_report()
        >>> print(report.summary())
    """
    
    def __init__(
        self,
        name: str,
        enable_memory_tracking: bool = False,
        auto_gc: bool = True,
    ):
        """
        初始化性能监控器。
        
        Args:
            name: 监控器名称
            enable_memory_tracking: 是否启用内存追踪（有一定开销）
            auto_gc: 测量前是否自动进行垃圾回收
        """
        self.name = name
        self.enable_memory_tracking = enable_memory_tracking
        self.auto_gc = auto_gc
        self._metrics: List[PerformanceMetric] = []
        self._start_time = time.time()
        self._timers: Dict[str, Timer] = {}
        self._memory_trackers: Dict[str, MemoryTracker] = {}
    
    @contextmanager
    def measure(self, operation_name: str, tags: Optional[Dict[str, str]] = None):
        """
        测量操作耗时的上下文管理器。
        
        Args:
            operation_name: 操作名称
            tags: 可选的标签
            
        Yields:
            Timer 实例
            
        Example:
            >>> with monitor.measure("llm_call", tags={"model": "gpt-4"}):
            ...     response = await llm.invoke(prompt)
        """
        if self.auto_gc:
            gc.collect()
        
        timer = Timer(operation_name)
        memory_tracker = MemoryTracker() if self.enable_memory_tracking else None
        
        self._timers[operation_name] = timer
        
        try:
            timer.start()
            if memory_tracker:
                memory_tracker.start()
                self._memory_trackers[operation_name] = memory_tracker
            
            yield timer
            
        finally:
            timer.stop()
            if memory_tracker:
                memory_tracker.stop()
            
            # 记录延迟指标
            self._metrics.append(PerformanceMetric(
                name=f"{operation_name}_latency",
                type=MetricType.LATENCY,
                value=timer.elapsed_ms,
                unit="ms",
                tags=tags or {},
            ))
            
            # 记录内存指标
            if memory_tracker:
                self._metrics.append(PerformanceMetric(
                    name=f"{operation_name}_memory_peak",
                    type=MetricType.MEMORY,
                    value=memory_tracker.peak_bytes,
                    unit="bytes",
                    tags=tags or {},
                ))
    
    def record_metric(
        self,
        name: str,
        value: float,
        metric_type: MetricType,
        unit: str,
        tags: Optional[Dict[str, str]] = None,
    ) -> None:
        """
        手动记录指标。
        
        Args:
            name: 指标名称
            value: 指标值
            metric_type: 指标类型
            unit: 单位
            tags: 可选标签
        """
        self._metrics.append(PerformanceMetric(
            name=name,
            type=metric_type,
            value=value,
            unit=unit,
            tags=tags or {},
        ))
    
    def get_report(self) -> PerformanceReport:
        """获取性能报告。"""
        return PerformanceReport(
            name=self.name,
            metrics=self._metrics.copy(),
            start_time=self._start_time,
            end_time=time.time(),
            metadata={
                "enable_memory_tracking": self.enable_memory_tracking,
                "auto_gc": self.auto_gc,
            },
        )
    
    def reset(self) -> None:
        """重置监控器。"""
        self._metrics.clear()
        self._timers.clear()
        self._memory_trackers.clear()
        self._start_time = time.time()


def benchmark(
    func: Optional[Callable[..., T]] = None,
    *,
    iterations: int = 100,
    warmup: int = 10,
    name: Optional[str] = None,
) -> Union[Callable[..., T], Callable[[Callable[..., T]], Callable[..., T]]]:
    """
    基准测试装饰器。
    
    对函数进行多次调用并计算统计信息。
    
    Args:
        func: 要测试的函数
        iterations: 测试迭代次数
        warmup: 预热迭代次数（不计入统计）
        name: 测试名称
        
    Returns:
        装饰后的函数
        
    Example:
        >>> @benchmark(iterations=1000)
        ... def my_function():
        ...     return Agent.fast_construct(name="test", ...)
        >>> 
        >>> result = my_function()  # 自动打印基准测试结果
    """
    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @wraps(fn)
        def wrapper(*args, **kwargs) -> T:
            test_name = name or fn.__name__
            
            # 预热
            for _ in range(warmup):
                fn(*args, **kwargs)
            
            # 正式测试
            gc.collect()
            times: List[float] = []
            
            for _ in range(iterations):
                start = time.perf_counter_ns()
                result = fn(*args, **kwargs)
                elapsed = time.perf_counter_ns() - start
                times.append(elapsed)
            
            # 计算统计信息
            times.sort()
            avg_ns = sum(times) / len(times)
            min_ns = times[0]
            max_ns = times[-1]
            p50_ns = times[len(times) // 2]
            p99_ns = times[int(len(times) * 0.99)]
            
            logger.info(
                f"Benchmark '{test_name}' ({iterations} iterations):\n"
                f"  avg: {avg_ns/1000:.2f} μs\n"
                f"  min: {min_ns/1000:.2f} μs\n"
                f"  max: {max_ns/1000:.2f} μs\n"
                f"  p50: {p50_ns/1000:.2f} μs\n"
                f"  p99: {p99_ns/1000:.2f} μs"
            )
            
            return result
        
        return wrapper
    
    if func is not None:
        return decorator(func)
    return decorator


# =========================================================================
# Agent 专用性能评估 (对标 Agno PerformanceEval)
# =========================================================================

@dataclass
class AgentPerformanceResult:
    """Agent 性能评估结果。"""
    agent_name: str
    instantiation_time_us: float      # 实例化时间（微秒）
    memory_per_instance_kb: float     # 单实例内存（KB）
    iterations: int
    speedup_vs_standard: float        # 相对标准构造的加速比
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "agent_name": self.agent_name,
            "instantiation_time_us": self.instantiation_time_us,
            "memory_per_instance_kb": self.memory_per_instance_kb,
            "iterations": self.iterations,
            "speedup_vs_standard": self.speedup_vs_standard,
        }
    
    def summary(self) -> str:
        return (
            f"Agent Performance: {self.agent_name}\n"
            f"  Instantiation: {self.instantiation_time_us:.2f} μs\n"
            f"  Memory: {self.memory_per_instance_kb:.2f} KB/instance\n"
            f"  Speedup: {self.speedup_vs_standard:.1f}x vs standard"
        )


def evaluate_agent_performance(
    agent_class: type,
    agent_kwargs: Dict[str, Any],
    iterations: int = 1000,
    warmup: int = 100,
) -> AgentPerformanceResult:
    """
    评估 Agent 的性能（对标 Agno PerformanceEval）。
    
    Args:
        agent_class: Agent 类
        agent_kwargs: Agent 构造参数
        iterations: 测试迭代次数
        warmup: 预热迭代次数
        
    Returns:
        AgentPerformanceResult: 性能评估结果
        
    Example:
        >>> from agenticx.core.agent import Agent
        >>> from agenticx.core.performance import evaluate_agent_performance
        >>> 
        >>> result = evaluate_agent_performance(
        ...     Agent,
        ...     {"name": "TestAgent", "role": "Tester", "goal": "Test", "organization_id": "org-1"},
        ...     iterations=1000
        ... )
        >>> print(result.summary())
    """
    agent_name = agent_kwargs.get("name", "Unknown")
    
    # 预热
    for _ in range(warmup):
        if hasattr(agent_class, "fast_construct"):
            agent_class.fast_construct(**agent_kwargs)
        else:
            agent_class(**agent_kwargs)
    
    gc.collect()
    
    # 测量 fast_construct 性能
    fast_times: List[float] = []
    for _ in range(iterations):
        start = time.perf_counter_ns()
        if hasattr(agent_class, "fast_construct"):
            agent_class.fast_construct(**agent_kwargs)
        else:
            agent_class(**agent_kwargs)
        fast_times.append(time.perf_counter_ns() - start)
    
    avg_fast_ns = sum(fast_times) / len(fast_times)
    
    # 测量标准构造性能
    standard_times: List[float] = []
    for _ in range(iterations):
        start = time.perf_counter_ns()
        agent_class(**agent_kwargs)
        standard_times.append(time.perf_counter_ns() - start)
    
    avg_standard_ns = sum(standard_times) / len(standard_times)
    
    # 测量内存
    gc.collect()
    tracemalloc.start()
    agents = []
    for _ in range(100):  # 创建 100 个实例测量平均内存
        if hasattr(agent_class, "fast_construct"):
            agents.append(agent_class.fast_construct(**agent_kwargs))
        else:
            agents.append(agent_class(**agent_kwargs))
    current, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    
    memory_per_instance_kb = (current / 100) / 1024  # 平均每个实例的内存
    
    return AgentPerformanceResult(
        agent_name=agent_name,
        instantiation_time_us=avg_fast_ns / 1000,
        memory_per_instance_kb=memory_per_instance_kb,
        iterations=iterations,
        speedup_vs_standard=avg_standard_ns / avg_fast_ns if avg_fast_ns > 0 else float('inf'),
    )

