"""
AgenticX OpenTelemetry 集成模块

本模块提供 OpenTelemetry 原生集成，将 AgenticX 的执行事件转换为
标准的 OTel Traces、Metrics 和 Logs，支持导出到 Jaeger、Grafana 等平台。

内化来源:
- alibaba/loongsuite-python-agent: TelemetryHandler 机制
- AgenticX TrajectoryCollector: Callback 桥接模式

核心组件:
- OTelConfig: OpenTelemetry 配置
- OTelCallbackHandler: Callback → OTel Span 桥接
- enable_otel(): 一键启用函数

Usage:
    # 最简用法
    from agenticx.observability.otel import enable_otel
    enable_otel()
    
    # 标准用法
    enable_otel(
        service_name="my-agent",
        otlp_endpoint="http://localhost:4317",
    )
    
    # 高级用法
    from agenticx.observability.otel import OTelCallbackHandler, OTelConfig
    
    config = OTelConfig(
        service_name="my-agent",
        export_to_span_tree=True,
    )
    handler = OTelCallbackHandler(config=config)
"""

from .config import (
    OTelConfig,
    enable_otel,
    disable_otel,
    is_otel_enabled,
    get_otel_config,
)

from .handler import (
    OTelCallbackHandler,
)

from .hooks import (
    register_otel_hooks,
    unregister_otel_hooks,
    is_otel_hooks_registered,
)

from .span_exporter import (
    SpanTreeExporter,
    create_span_tree_provider,
)

__all__ = [
    # 配置
    "OTelConfig",
    "enable_otel",
    "disable_otel",
    "is_otel_enabled",
    "get_otel_config",
    # 处理器
    "OTelCallbackHandler",
    # Hooks 桥接
    "register_otel_hooks",
    "unregister_otel_hooks",
    "is_otel_hooks_registered",
    # SpanTree 导出
    "SpanTreeExporter",
    "create_span_tree_provider",
]

__version__ = "1.0.0"
