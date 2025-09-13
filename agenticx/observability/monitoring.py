"""
AgenticX M9: 监控系统 (Monitoring System)

本模块实现了实时监控功能，收集系统性能指标、资源使用情况和运行状态。
支持Prometheus等监控系统集成，提供全面的可观测性。
"""

import time
import psutil
import threading
from typing import Dict, Any, List, Optional, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from collections import defaultdict, deque
import json
import logging

from .callbacks import BaseCallbackHandler, CallbackHandlerConfig
from ..core.event import AnyEvent, ErrorEvent, TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent
from ..core.agent import Agent
from ..core.task import Task
from ..core.workflow import Workflow
from ..llms.response import LLMResponse


logger = logging.getLogger(__name__)


class MetricType(Enum):
    """指标类型"""
    COUNTER = "counter"        # 计数器
    GAUGE = "gauge"           # 仪表盘
    HISTOGRAM = "histogram"   # 直方图
    SUMMARY = "summary"       # 汇总


@dataclass
class MetricValue:
    """指标值"""
    value: float
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    labels: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "value": self.value,
            "timestamp": self.timestamp.isoformat(),
            "labels": self.labels
        }


@dataclass
class PerformanceMetrics:
    """性能指标"""
    # 任务指标
    task_count: int = 0
    task_success_count: int = 0
    task_failure_count: int = 0
    task_duration_avg: float = 0.0
    task_duration_max: float = 0.0
    task_duration_min: float = float('inf')
    
    # 工具指标
    tool_call_count: int = 0
    tool_success_count: int = 0
    tool_failure_count: int = 0
    tool_duration_avg: float = 0.0
    
    # LLM指标
    llm_call_count: int = 0
    llm_token_usage: int = 0
    llm_cost_total: float = 0.0
    llm_duration_avg: float = 0.0
    
    # 错误指标
    error_count: int = 0
    error_rate: float = 0.0
    
    # 资源指标
    memory_usage: float = 0.0
    cpu_usage: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_count": self.task_count,
            "task_success_count": self.task_success_count,
            "task_failure_count": self.task_failure_count,
            "task_success_rate": self.task_success_count / max(self.task_count, 1),
            "task_duration_avg": self.task_duration_avg,
            "task_duration_max": self.task_duration_max,
            "task_duration_min": self.task_duration_min if self.task_duration_min != float('inf') else 0,
            "tool_call_count": self.tool_call_count,
            "tool_success_count": self.tool_success_count,
            "tool_failure_count": self.tool_failure_count,
            "tool_success_rate": self.tool_success_count / max(self.tool_call_count, 1),
            "tool_duration_avg": self.tool_duration_avg,
            "llm_call_count": self.llm_call_count,
            "llm_token_usage": self.llm_token_usage,
            "llm_cost_total": self.llm_cost_total,
            "llm_duration_avg": self.llm_duration_avg,
            "error_count": self.error_count,
            "error_rate": self.error_rate,
            "memory_usage": self.memory_usage,
            "cpu_usage": self.cpu_usage
        }


@dataclass
class SystemMetrics:
    """系统指标"""
    # 系统资源
    cpu_percent: float = 0.0
    memory_percent: float = 0.0
    disk_usage: float = 0.0
    
    # 网络
    network_sent: int = 0
    network_recv: int = 0
    
    # 进程
    process_count: int = 0
    thread_count: int = 0
    
    # 时间戳
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "cpu_percent": self.cpu_percent,
            "memory_percent": self.memory_percent,
            "disk_usage": self.disk_usage,
            "network_sent": self.network_sent,
            "network_recv": self.network_recv,
            "process_count": self.process_count,
            "thread_count": self.thread_count,
            "timestamp": self.timestamp.isoformat()
        }


class MetricsCollector:
    """
    指标收集器
    
    收集和聚合各种性能指标。
    """
    
    def __init__(self, max_history: int = 1000):
        self.max_history = max_history
        
        # 指标存储
        self.metrics: Dict[str, List[MetricValue]] = defaultdict(list)
        self.counters: Dict[str, float] = defaultdict(float)
        self.gauges: Dict[str, float] = defaultdict(float)
        
        # 性能指标
        self.performance_metrics = PerformanceMetrics()
        
        # 系统指标历史
        self.system_metrics_history: deque = deque(maxlen=max_history)
        
        # 任务执行时间跟踪
        self.task_start_times: Dict[str, float] = {}
        self.tool_start_times: Dict[str, float] = {}
        self.llm_start_times: Dict[str, float] = {}
        
        # 锁（使用递归锁避免死锁）
        self._lock = threading.RLock()
    
    def add_metric(self, name: str, value: float, labels: Optional[Dict[str, str]] = None):
        """添加指标"""
        with self._lock:
            metric_value = MetricValue(value=value, labels=labels or {})
            self.metrics[name].append(metric_value)
            
            # 限制历史记录
            if len(self.metrics[name]) > self.max_history:
                self.metrics[name].pop(0)
    
    def increment_counter(self, name: str, value: float = 1.0, labels: Optional[Dict[str, str]] = None):
        """增加计数器"""
        with self._lock:
            self.counters[name] += value
            self.add_metric(name, self.counters[name], labels)
    
    def set_gauge(self, name: str, value: float, labels: Optional[Dict[str, str]] = None):
        """设置仪表盘值"""
        with self._lock:
            self.gauges[name] = value
            self.add_metric(name, value, labels)
    
    def get_metric(self, name: str) -> List[MetricValue]:
        """获取指标"""
        return self.metrics.get(name, [])
    
    def get_latest_metric(self, name: str) -> Optional[MetricValue]:
        """获取最新指标值"""
        metrics = self.get_metric(name)
        return metrics[-1] if metrics else None
    
    def get_counter(self, name: str) -> float:
        """获取计数器值"""
        return self.counters.get(name, 0.0)
    
    def get_gauge(self, name: str) -> float:
        """获取仪表盘值"""
        return self.gauges.get(name, 0.0)
    
    def update_performance_metrics(self, **kwargs):
        """更新性能指标"""
        with self._lock:
            for key, value in kwargs.items():
                if hasattr(self.performance_metrics, key):
                    setattr(self.performance_metrics, key, value)
    
    def collect_system_metrics(self) -> SystemMetrics:
        """收集系统指标"""
        try:
            # CPU - 使用非阻塞方式
            cpu_percent = psutil.cpu_percent(interval=None)
            
            # 内存
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            
            # 磁盘
            try:
                disk = psutil.disk_usage('/')
                disk_usage = disk.percent
            except:
                disk_usage = 0.0
            
            # 网络
            net_io = psutil.net_io_counters()
            network_sent = net_io.bytes_sent
            network_recv = net_io.bytes_recv
            
            # 进程
            process_count = len(psutil.pids())
            thread_count = threading.active_count()
            
            system_metrics = SystemMetrics(
                cpu_percent=cpu_percent,
                memory_percent=memory_percent,
                disk_usage=disk_usage,
                network_sent=network_sent,
                network_recv=network_recv,
                process_count=process_count,
                thread_count=thread_count
            )
            
            # 存储历史
            self.system_metrics_history.append(system_metrics)
            
            return system_metrics
            
        except Exception as e:
            logger.error(f"收集系统指标时发生错误: {e}")
            return SystemMetrics()
    
    def get_system_metrics_history(self) -> List[SystemMetrics]:
        """获取系统指标历史"""
        return list(self.system_metrics_history)
    
    def get_all_metrics(self) -> Dict[str, Any]:
        """获取所有指标"""
        return {
            "performance_metrics": self.performance_metrics.to_dict(),
            "counters": dict(self.counters),
            "gauges": dict(self.gauges),
            "system_metrics": self.system_metrics_history[-1].to_dict() if self.system_metrics_history else {},
            "metrics_count": len(self.metrics),
            "total_events": sum(len(values) for values in self.metrics.values())
        }
    
    def reset(self):
        """重置所有指标"""
        with self._lock:
            self.metrics.clear()
            self.counters.clear()
            self.gauges.clear()
            self.performance_metrics = PerformanceMetrics()
            self.system_metrics_history.clear()
            self.task_start_times.clear()
            self.tool_start_times.clear()
            self.llm_start_times.clear()


class PrometheusExporter:
    """
    Prometheus指标导出器
    
    将收集的指标导出为Prometheus格式。
    """
    
    def __init__(self, metrics_collector: MetricsCollector):
        self.metrics_collector = metrics_collector
    
    def export_metrics(self) -> str:
        """导出Prometheus格式的指标"""
        metrics_lines = []
        
        # 性能指标
        performance = self.metrics_collector.performance_metrics
        
        # 任务指标
        metrics_lines.append(f'# HELP agenticx_tasks_total Total number of tasks')
        metrics_lines.append(f'# TYPE agenticx_tasks_total counter')
        metrics_lines.append(f'agenticx_tasks_total {performance.task_count}')
        
        metrics_lines.append(f'# HELP agenticx_tasks_success_total Total number of successful tasks')
        metrics_lines.append(f'# TYPE agenticx_tasks_success_total counter')
        metrics_lines.append(f'agenticx_tasks_success_total {performance.task_success_count}')
        
        metrics_lines.append(f'# HELP agenticx_tasks_failure_total Total number of failed tasks')
        metrics_lines.append(f'# TYPE agenticx_tasks_failure_total counter')
        metrics_lines.append(f'agenticx_tasks_failure_total {performance.task_failure_count}')
        
        # 工具指标
        metrics_lines.append(f'# HELP agenticx_tool_calls_total Total number of tool calls')
        metrics_lines.append(f'# TYPE agenticx_tool_calls_total counter')
        metrics_lines.append(f'agenticx_tool_calls_total {performance.tool_call_count}')
        
        # LLM指标
        metrics_lines.append(f'# HELP agenticx_llm_calls_total Total number of LLM calls')
        metrics_lines.append(f'# TYPE agenticx_llm_calls_total counter')
        metrics_lines.append(f'agenticx_llm_calls_total {performance.llm_call_count}')
        
        metrics_lines.append(f'# HELP agenticx_llm_tokens_total Total number of tokens used')
        metrics_lines.append(f'# TYPE agenticx_llm_tokens_total counter')
        metrics_lines.append(f'agenticx_llm_tokens_total {performance.llm_token_usage}')
        
        metrics_lines.append(f'# HELP agenticx_llm_cost_total Total cost of LLM calls')
        metrics_lines.append(f'# TYPE agenticx_llm_cost_total counter')
        metrics_lines.append(f'agenticx_llm_cost_total {performance.llm_cost_total}')
        
        # 错误指标
        metrics_lines.append(f'# HELP agenticx_errors_total Total number of errors')
        metrics_lines.append(f'# TYPE agenticx_errors_total counter')
        metrics_lines.append(f'agenticx_errors_total {performance.error_count}')
        
        # 系统指标
        if self.metrics_collector.system_metrics_history:
            latest_system = self.metrics_collector.system_metrics_history[-1]
            
            metrics_lines.append(f'# HELP agenticx_cpu_usage_percent CPU usage percentage')
            metrics_lines.append(f'# TYPE agenticx_cpu_usage_percent gauge')
            metrics_lines.append(f'agenticx_cpu_usage_percent {latest_system.cpu_percent}')
            
            metrics_lines.append(f'# HELP agenticx_memory_usage_percent Memory usage percentage')
            metrics_lines.append(f'# TYPE agenticx_memory_usage_percent gauge')
            metrics_lines.append(f'agenticx_memory_usage_percent {latest_system.memory_percent}')
        
        return '\n'.join(metrics_lines)
    
    def export_to_file(self, filename: str):
        """导出指标到文件"""
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(self.export_metrics())


class MonitoringCallbackHandler(BaseCallbackHandler):
    """
    监控回调处理器
    
    收集性能指标和系统监控数据。
    """
    
    def __init__(self, 
                 metrics_collector: Optional[MetricsCollector] = None,
                 collect_system_metrics: bool = True,
                 system_metrics_interval: float = 30.0,
                 config: Optional[CallbackHandlerConfig] = None):
        super().__init__(config)
        
        self.metrics_collector = metrics_collector or MetricsCollector()
        self.collect_system_metrics = collect_system_metrics
        self.system_metrics_interval = system_metrics_interval
        
        # 系统指标收集线程
        self.system_metrics_thread: Optional[threading.Thread] = None
        self.system_metrics_stop_event = threading.Event()
        
        # 启动系统指标收集
        if self.collect_system_metrics:
            self._start_system_metrics_collection()
    
    def _start_system_metrics_collection(self):
        """启动系统指标收集"""
        def collect_system_metrics():
            while not self.system_metrics_stop_event.wait(self.system_metrics_interval):
                try:
                    system_metrics = self.metrics_collector.collect_system_metrics()
                    
                    # 更新性能指标中的系统指标
                    self.metrics_collector.update_performance_metrics(
                        memory_usage=system_metrics.memory_percent,
                        cpu_usage=system_metrics.cpu_percent
                    )
                    
                except Exception as e:
                    logger.error(f"收集系统指标时发生错误: {e}")
        
        self.system_metrics_thread = threading.Thread(
            target=collect_system_metrics,
            daemon=True
        )
        self.system_metrics_thread.start()
    
    def _stop_system_metrics_collection(self):
        """停止系统指标收集"""
        if self.system_metrics_thread:
            self.system_metrics_stop_event.set()
            self.system_metrics_thread.join(timeout=5)
    
    def on_task_start(self, agent: Agent, task: Task):
        """任务开始时的监控"""
        task_key = f"{agent.id}:{task.id}"
        self.metrics_collector.task_start_times[task_key] = time.time()
        
        # 增加任务计数
        self.metrics_collector.increment_counter(
            "tasks_started",
            labels={"agent_id": agent.id, "agent_role": agent.role}
        )
    
    def on_task_end(self, agent: Agent, task: Task, result: Dict[str, Any]):
        """任务结束时的监控"""
        task_key = f"{agent.id}:{task.id}"
        
        # 计算执行时间
        if task_key in self.metrics_collector.task_start_times:
            start_time = self.metrics_collector.task_start_times[task_key]
            duration = time.time() - start_time
            del self.metrics_collector.task_start_times[task_key]
            
            # 添加时间指标
            self.metrics_collector.add_metric(
                "task_duration_seconds",
                duration,
                labels={"agent_id": agent.id, "success": str(result.get("success", False))}
            )
            
            # 更新性能指标
            self.metrics_collector.performance_metrics.task_count += 1
            
            if result.get("success", False):
                self.metrics_collector.performance_metrics.task_success_count += 1
                self.metrics_collector.increment_counter(
                    "tasks_completed",
                    labels={"agent_id": agent.id, "status": "success"}
                )
            else:
                self.metrics_collector.performance_metrics.task_failure_count += 1
                self.metrics_collector.increment_counter(
                    "tasks_completed",
                    labels={"agent_id": agent.id, "status": "failure"}
                )
            
            # 更新平均执行时间
            total_tasks = self.metrics_collector.performance_metrics.task_count
            current_avg = self.metrics_collector.performance_metrics.task_duration_avg
            new_avg = (current_avg * (total_tasks - 1) + duration) / total_tasks
            self.metrics_collector.performance_metrics.task_duration_avg = new_avg
            
            # 更新最大最小时间
            if duration > self.metrics_collector.performance_metrics.task_duration_max:
                self.metrics_collector.performance_metrics.task_duration_max = duration
            if duration < self.metrics_collector.performance_metrics.task_duration_min:
                self.metrics_collector.performance_metrics.task_duration_min = duration
    
    def on_tool_start(self, tool_name: str, tool_args: Dict[str, Any]):
        """工具开始时的监控"""
        tool_key = f"{tool_name}:{time.time()}"
        self.metrics_collector.tool_start_times[tool_key] = time.time()
        
        # 增加工具调用计数
        self.metrics_collector.increment_counter(
            "tool_calls_started",
            labels={"tool_name": tool_name}
        )
    
    def on_tool_end(self, tool_name: str, result: Any, success: bool):
        """工具结束时的监控"""
        # 查找最近的工具调用
        matching_keys = [key for key in self.metrics_collector.tool_start_times.keys() 
                        if key.startswith(f"{tool_name}:")]
        
        if matching_keys:
            # 使用最近的一个
            tool_key = max(matching_keys)
            start_time = self.metrics_collector.tool_start_times[tool_key]
            duration = time.time() - start_time
            del self.metrics_collector.tool_start_times[tool_key]
            
            # 添加时间指标
            self.metrics_collector.add_metric(
                "tool_duration_seconds",
                duration,
                labels={"tool_name": tool_name, "success": str(success)}
            )
            
            # 更新性能指标
            self.metrics_collector.performance_metrics.tool_call_count += 1
            
            if success:
                self.metrics_collector.performance_metrics.tool_success_count += 1
                self.metrics_collector.increment_counter(
                    "tool_calls_completed",
                    labels={"tool_name": tool_name, "status": "success"}
                )
            else:
                self.metrics_collector.performance_metrics.tool_failure_count += 1
                self.metrics_collector.increment_counter(
                    "tool_calls_completed",
                    labels={"tool_name": tool_name, "status": "failure"}
                )
            
            # 更新平均执行时间
            total_calls = self.metrics_collector.performance_metrics.tool_call_count
            current_avg = self.metrics_collector.performance_metrics.tool_duration_avg
            new_avg = (current_avg * (total_calls - 1) + duration) / total_calls
            self.metrics_collector.performance_metrics.tool_duration_avg = new_avg
    
    def on_llm_call(self, prompt: str, model: str, metadata: Dict[str, Any]):
        """LLM调用时的监控"""
        llm_key = f"{model}:{time.time()}"
        self.metrics_collector.llm_start_times[llm_key] = time.time()
        
        # 增加LLM调用计数
        self.metrics_collector.increment_counter(
            "llm_calls_started",
            labels={"model": model}
        )
        
        # 记录提示长度
        self.metrics_collector.add_metric(
            "llm_prompt_length",
            len(prompt),
            labels={"model": model}
        )
    
    def on_llm_response(self, response: LLMResponse, metadata: Dict[str, Any]):
        """LLM响应时的监控"""
        # 查找最近的LLM调用
        matching_keys = [key for key in self.metrics_collector.llm_start_times.keys() 
                        if key.startswith(f"{response.model_name}:")]
        
        if matching_keys:
            # 使用最近的一个
            llm_key = max(matching_keys)
            start_time = self.metrics_collector.llm_start_times[llm_key]
            duration = time.time() - start_time
            del self.metrics_collector.llm_start_times[llm_key]
            
            # 添加时间指标
            self.metrics_collector.add_metric(
                "llm_duration_seconds",
                duration,
                labels={"model": response.model_name}
            )
            
            # 更新性能指标
            self.metrics_collector.performance_metrics.llm_call_count += 1
            
            # Token使用量
            total_tokens = response.token_usage.total_tokens
            self.metrics_collector.performance_metrics.llm_token_usage += total_tokens
            self.metrics_collector.add_metric(
                "llm_tokens_used",
                total_tokens,
                labels={"model": response.model_name}
            )
            
            # 成本
            if response.cost is not None:
                self.metrics_collector.performance_metrics.llm_cost_total += response.cost
                self.metrics_collector.add_metric(
                    "llm_cost",
                    response.cost,
                    labels={"model": response.model_name}
                )
            
            # 更新平均执行时间
            total_calls = self.metrics_collector.performance_metrics.llm_call_count
            current_avg = self.metrics_collector.performance_metrics.llm_duration_avg
            new_avg = (current_avg * (total_calls - 1) + duration) / total_calls
            self.metrics_collector.performance_metrics.llm_duration_avg = new_avg
            
            # 响应长度
            self.metrics_collector.add_metric(
                "llm_response_length",
                len(response.content),
                labels={"model": response.model_name}
            )
    
    def on_error(self, error: Exception, context: Dict[str, Any]):
        """错误时的监控"""
        # 增加错误计数
        error_type = context.get("error_type", type(error).__name__)
        self.metrics_collector.increment_counter(
            "errors_total",
            labels={"error_type": error_type, "recoverable": str(context.get("recoverable", True))}
        )
        
        # 更新性能指标
        self.metrics_collector.performance_metrics.error_count += 1
        
        # 计算错误率
        total_events = (
            self.metrics_collector.performance_metrics.task_count +
            self.metrics_collector.performance_metrics.tool_call_count +
            self.metrics_collector.performance_metrics.llm_call_count
        )
        
        if total_events > 0:
            error_rate = self.metrics_collector.performance_metrics.error_count / total_events
            self.metrics_collector.performance_metrics.error_rate = error_rate
            self.metrics_collector.set_gauge("error_rate", error_rate)
    
    def get_metrics(self) -> Dict[str, Any]:
        """获取所有监控指标"""
        return self.metrics_collector.get_all_metrics()
    
    def get_prometheus_metrics(self) -> str:
        """获取Prometheus格式的指标"""
        exporter = PrometheusExporter(self.metrics_collector)
        return exporter.export_metrics()
    
    def reset_metrics(self):
        """重置所有指标"""
        self.metrics_collector.reset()
    
    def get_stats(self) -> Dict[str, Any]:
        """获取处理器统计信息"""
        stats = super().get_stats()
        stats.update({
            "collect_system_metrics": self.collect_system_metrics,
            "system_metrics_interval": self.system_metrics_interval,
            "metrics_collector_stats": self.metrics_collector.get_all_metrics()
        })
        return stats
    
    def __del__(self):
        """析构函数，停止系统指标收集"""
        self._stop_system_metrics_collection()