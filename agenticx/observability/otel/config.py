"""
OpenTelemetry 配置模块

提供 OTel 配置管理和一键启用功能。

内化来源:
- alibaba/loongsuite-python-agent: bootstrap 机制
- OpenTelemetry Python SDK 最佳实践

Usage:
    from agenticx.observability.otel import enable_otel
    
    # 一键启用（默认控制台输出）
    enable_otel()
    
    # 指定 OTLP endpoint
    enable_otel(
        service_name="my-agent",
        otlp_endpoint="http://localhost:4317",
    )
    
    # 通过环境变量
    # export AGENTICX_OTEL_ENABLED=true
    # export AGENTICX_OTEL_SERVICE_NAME=my-agent
    # export AGENTICX_OTEL_ENDPOINT=http://localhost:4317
"""

from __future__ import annotations

import os
import logging
from dataclasses import dataclass, field
from typing import Optional, Any, Dict, TYPE_CHECKING

if TYPE_CHECKING:
    from .handler import OTelCallbackHandler

logger = logging.getLogger(__name__)

# 全局状态
_otel_enabled: bool = False
_otel_config: Optional["OTelConfig"] = None
_otel_handler: Optional["OTelCallbackHandler"] = None


@dataclass
class OTelConfig:
    """
    OpenTelemetry 配置
    
    Attributes:
        service_name: 服务名称，用于标识 Trace 来源
        otlp_endpoint: OTLP 导出端点（gRPC），如 http://localhost:4317
        export_to_console: 是否输出到控制台（调试用）
        export_to_span_tree: 是否同时导出到 SpanTree（复用现有分析能力）
        enabled: 是否启用
        resource_attributes: 额外的资源属性
        trace_sample_rate: 采样率 (0.0-1.0)，1.0 表示全采样
    """
    service_name: str = "agenticx"
    otlp_endpoint: Optional[str] = None
    export_to_console: bool = True
    export_to_span_tree: bool = False
    enabled: bool = True
    resource_attributes: Dict[str, Any] = field(default_factory=dict)
    trace_sample_rate: float = 1.0
    
    @classmethod
    def from_env(cls) -> "OTelConfig":
        """
        从环境变量加载配置
        
        支持的环境变量:
        - AGENTICX_OTEL_ENABLED: 是否启用 (true/false)
        - AGENTICX_OTEL_SERVICE_NAME: 服务名称
        - AGENTICX_OTEL_ENDPOINT: OTLP 端点
        - AGENTICX_OTEL_CONSOLE: 是否控制台输出 (true/false)
        - AGENTICX_OTEL_SPAN_TREE: 是否导出到 SpanTree (true/false)
        - AGENTICX_OTEL_SAMPLE_RATE: 采样率 (0.0-1.0)
        """
        def str_to_bool(value: str, default: bool = False) -> bool:
            return value.lower() in ("true", "1", "yes", "on") if value else default
        
        return cls(
            service_name=os.environ.get("AGENTICX_OTEL_SERVICE_NAME", "agenticx"),
            otlp_endpoint=os.environ.get("AGENTICX_OTEL_ENDPOINT"),
            export_to_console=str_to_bool(
                os.environ.get("AGENTICX_OTEL_CONSOLE", "true"), True
            ),
            export_to_span_tree=str_to_bool(
                os.environ.get("AGENTICX_OTEL_SPAN_TREE", ""), False
            ),
            enabled=str_to_bool(
                os.environ.get("AGENTICX_OTEL_ENABLED", ""), False
            ),
            trace_sample_rate=float(
                os.environ.get("AGENTICX_OTEL_SAMPLE_RATE", "1.0")
            ),
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "service_name": self.service_name,
            "otlp_endpoint": self.otlp_endpoint,
            "export_to_console": self.export_to_console,
            "export_to_span_tree": self.export_to_span_tree,
            "enabled": self.enabled,
            "resource_attributes": self.resource_attributes,
            "trace_sample_rate": self.trace_sample_rate,
        }


def _check_otel_dependencies() -> bool:
    """
    检查 OpenTelemetry 依赖是否安装
    
    Returns:
        True 如果依赖已安装，False 否则
    """
    try:
        import opentelemetry.sdk  # noqa: F401  # type: ignore
        import opentelemetry.trace  # noqa: F401  # type: ignore
        return True
    except ImportError:
        return False


def enable_otel(
    service_name: str = "agenticx",
    otlp_endpoint: Optional[str] = None,
    export_to_console: bool = True,
    export_to_span_tree: bool = False,
    trace_sample_rate: float = 1.0,
    resource_attributes: Optional[Dict[str, Any]] = None,
) -> "OTelCallbackHandler":
    """
    一键启用 OpenTelemetry 集成
    
    此函数会：
    1. 初始化 OpenTelemetry TracerProvider
    2. 配置导出器（Console 和/或 OTLP）
    3. 创建并返回 OTelCallbackHandler
    
    Args:
        service_name: 服务名称
        otlp_endpoint: OTLP 导出端点，如 http://localhost:4317
        export_to_console: 是否输出到控制台
        export_to_span_tree: 是否导出到 SpanTree
        trace_sample_rate: 采样率
        resource_attributes: 额外资源属性
        
    Returns:
        OTelCallbackHandler 实例
        
    Raises:
        ImportError: 如果 OpenTelemetry 依赖未安装
        
    Example:
        >>> handler = enable_otel()
        >>> # 或
        >>> handler = enable_otel(
        ...     service_name="my-agent",
        ...     otlp_endpoint="http://localhost:4317",
        ... )
    """
    global _otel_enabled, _otel_config, _otel_handler
    
    # 检查依赖
    if not _check_otel_dependencies():
        raise ImportError(
            "OpenTelemetry 依赖未安装。请运行: pip install agenticx[otel]\n"
            "或: pip install opentelemetry-api opentelemetry-sdk opentelemetry-exporter-otlp"
        )
    
    # 创建配置
    _otel_config = OTelConfig(
        service_name=service_name,
        otlp_endpoint=otlp_endpoint,
        export_to_console=export_to_console,
        export_to_span_tree=export_to_span_tree,
        enabled=True,
        trace_sample_rate=trace_sample_rate,
        resource_attributes=resource_attributes or {},
    )
    
    # 初始化 OpenTelemetry
    _setup_otel_provider(_otel_config)
    
    # 创建 handler
    from .handler import OTelCallbackHandler
    _otel_handler = OTelCallbackHandler(config=_otel_config)
    
    _otel_enabled = True
    logger.info(f"OpenTelemetry 已启用: service={service_name}, endpoint={otlp_endpoint}")
    
    return _otel_handler


def _setup_otel_provider(config: OTelConfig) -> None:
    """
    设置 OpenTelemetry TracerProvider
    
    内化自 loongsuite-python-agent 的 bootstrap 逻辑
    """
    from opentelemetry import trace  # type: ignore
    from opentelemetry.sdk.trace import TracerProvider  # type: ignore
    from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter  # type: ignore
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME  # type: ignore
    
    # 构建资源
    resource_attrs = {SERVICE_NAME: config.service_name}
    resource_attrs.update(config.resource_attributes)
    resource = Resource.create(resource_attrs)
    
    # 创建 TracerProvider
    # 使用采样率（如果需要）
    if config.trace_sample_rate < 1.0:
        from opentelemetry.sdk.trace.sampling import TraceIdRatioBased  # type: ignore
        sampler = TraceIdRatioBased(config.trace_sample_rate)
        provider = TracerProvider(resource=resource, sampler=sampler)
    else:
        provider = TracerProvider(resource=resource)
    
    # 添加 Console 导出器
    if config.export_to_console:
        console_exporter = ConsoleSpanExporter()
        provider.add_span_processor(BatchSpanProcessor(console_exporter))
    
    # 添加 OTLP 导出器
    if config.otlp_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter  # type: ignore
            otlp_exporter = OTLPSpanExporter(endpoint=config.otlp_endpoint)
            provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
            logger.info(f"OTLP 导出器已配置: {config.otlp_endpoint}")
        except ImportError:
            logger.warning(
                "OTLP 导出器未安装。请运行: pip install opentelemetry-exporter-otlp"
            )
    
    # 设置全局 TracerProvider
    trace.set_tracer_provider(provider)


def disable_otel() -> None:
    """
    禁用 OpenTelemetry 集成
    
    注意：已创建的 Span 不会被影响，只是停止创建新的 Span。
    """
    global _otel_enabled, _otel_handler
    
    _otel_enabled = False
    if _otel_handler:
        _otel_handler.set_enabled(False)
    
    logger.info("OpenTelemetry 已禁用")


def is_otel_enabled() -> bool:
    """
    检查 OpenTelemetry 是否已启用
    
    Returns:
        True 如果已启用，False 否则
    """
    return _otel_enabled


def get_otel_config() -> Optional[OTelConfig]:
    """
    获取当前 OpenTelemetry 配置
    
    Returns:
        OTelConfig 实例，如果未启用则返回 None
    """
    return _otel_config


def get_otel_handler() -> Optional["OTelCallbackHandler"]:
    """
    获取当前 OTelCallbackHandler 实例
    
    Returns:
        OTelCallbackHandler 实例，如果未启用则返回 None
    """
    return _otel_handler


__all__ = [
    "OTelConfig",
    "enable_otel",
    "disable_otel",
    "is_otel_enabled",
    "get_otel_config",
    "get_otel_handler",
]
