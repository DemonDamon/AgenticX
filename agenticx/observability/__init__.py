"""
AgenticX M9: 可观测性与分析模块 (Observability & Analytics)

本模块提供全面的可观测性功能，包括：
- 核心回调系统：事件拦截和处理
- 实时监控：系统指标收集和推送
- 轨迹分析：执行轨迹收集和分析
- 评估基准：性能评估和基准测试

设计理念：
1. 基于现有的事件系统构建，无缝集成
2. 提供多种回调处理器，支持不同的观测需求
3. 实现智能分析，从数据中提取洞察
4. 支持实时监控和可视化
"""

# 核心回调系统
from .callbacks import (
    BaseCallbackHandler,
    CallbackManager,
    CallbackRegistry,
    CallbackError,
    CallbackHandlerConfig
)

# 日志和监控
from .logging import (
    LoggingCallbackHandler,
    LogLevel,
    LogFormat,
    StructuredLogger
)

from .monitoring import (
    MonitoringCallbackHandler,
    MetricsCollector,
    PerformanceMetrics,
    SystemMetrics,
    PrometheusExporter
)

# 轨迹分析
from .trajectory import (
    TrajectoryCollector,
    ExecutionTrajectory,
    TrajectoryStep,
    TrajectoryMetadata
)

from .analysis import (
    TrajectorySummarizer,
    FailureAnalyzer,
    BottleneckDetector,
    PerformanceAnalyzer,
    ExecutionInsights,
    FailureReport,
    PerformanceReport
)

# 评估和基准测试
from .evaluation import (
    MetricsCalculator,
    BenchmarkRunner,
    AutoEvaluator,
    EvaluationResult,
    BenchmarkResult,
    EvaluationMetrics
)

# 实时通信
from .websocket import (
    WebSocketCallbackHandler,
    EventStream,
    RealtimeMonitor
)

# 辅助工具
from .utils import (
    EventProcessor,
    TimeSeriesData,
    StatisticsCalculator,
    DataExporter
)

__all__ = [
    # 核心回调系统
    "BaseCallbackHandler",
    "CallbackManager", 
    "CallbackRegistry",
    "CallbackError",
    "CallbackHandlerConfig",
    
    # 日志和监控
    "LoggingCallbackHandler",
    "LogLevel",
    "LogFormat",
    "StructuredLogger",
    "MonitoringCallbackHandler",
    "MetricsCollector",
    "PerformanceMetrics",
    "SystemMetrics",
    "PrometheusExporter",
    
    # 轨迹分析
    "TrajectoryCollector",
    "ExecutionTrajectory",
    "TrajectoryStep",
    "TrajectoryMetadata",
    "TrajectorySummarizer",
    "FailureAnalyzer",
    "BottleneckDetector",
    "PerformanceAnalyzer",
    "ExecutionInsights",
    "FailureReport",
    "PerformanceReport",
    
    # 评估和基准测试
    "MetricsCalculator",
    "BenchmarkRunner",
    "AutoEvaluator",
    "EvaluationResult",
    "BenchmarkResult",
    "EvaluationMetrics",
    
    # 实时通信
    "WebSocketCallbackHandler",
    "EventStream",
    "RealtimeMonitor",
    
    # 辅助工具
    "EventProcessor",
    "TimeSeriesData",
    "StatisticsCalculator",
    "DataExporter"
] 