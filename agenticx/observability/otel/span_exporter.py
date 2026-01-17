"""
OTelSpanExporter - 将 OTel Span 导出到 AgenticX SpanTree

本模块实现了 OpenTelemetry SpanExporter，将 OTel Span 转换为
AgenticX 的 SpanNode 格式，复用现有的 SpanTree 分析和可视化能力。

内化来源:
- alibaba/loongsuite-python-agent: Span 收集机制
- AgenticX SpanTree: 层次化 Span 管理

Usage:
    from agenticx.observability.otel import SpanTreeExporter
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    
    # 创建导出器
    exporter = SpanTreeExporter()
    
    # 添加到 TracerProvider
    provider = TracerProvider()
    provider.add_span_processor(BatchSpanProcessor(exporter))
    
    # 执行后获取 SpanTree
    span_tree = exporter.get_span_tree()
    print(span_tree.to_mermaid())
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Sequence
from datetime import datetime, timezone

from ..span_tree import SpanTree, SpanNode

logger = logging.getLogger(__name__)

# 尝试导入 OpenTelemetry
_OTEL_AVAILABLE = False
try:
    from opentelemetry.sdk.trace import ReadableSpan  # type: ignore
    from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult  # type: ignore
    _OTEL_AVAILABLE = True
except ImportError:
    # 创建占位符
    ReadableSpan = Any
    SpanExporter = object
    SpanExportResult = None


class SpanTreeExporter(SpanExporter if _OTEL_AVAILABLE else object):
    """
    将 OTel Span 导出到 AgenticX SpanTree
    
    这是一个 OpenTelemetry SpanExporter 实现，收集 Span 并转换为
    AgenticX SpanNode 格式，支持使用 SpanTree 进行分析和可视化。
    
    Usage:
        >>> exporter = SpanTreeExporter()
        >>> # 配置 TracerProvider...
        >>> # 执行任务...
        >>> span_tree = exporter.get_span_tree()
        >>> print(span_tree.get_summary())
        >>> print(span_tree.to_mermaid())
    """
    
    def __init__(self, max_spans: int = 10000):
        """
        初始化 SpanTreeExporter
        
        Args:
            max_spans: 最大收集 Span 数量，防止内存溢出
        """
        self._spans: List[Dict[str, Any]] = []
        self._max_spans = max_spans
        self._export_count = 0
        self._dropped_count = 0
    
    def export(self, spans: Sequence["ReadableSpan"]) -> "SpanExportResult":
        """
        导出 Span（实现 SpanExporter 接口）
        
        Args:
            spans: OTel ReadableSpan 序列
            
        Returns:
            SpanExportResult.SUCCESS
        """
        if not _OTEL_AVAILABLE:
            return None
        
        for span in spans:
            if len(self._spans) >= self._max_spans:
                self._dropped_count += 1
                continue
            
            span_data = self._convert_span(span)
            self._spans.append(span_data)
            self._export_count += 1
        
        return SpanExportResult.SUCCESS
    
    def shutdown(self) -> None:
        """关闭导出器"""
        logger.debug(f"SpanTreeExporter 关闭: exported={self._export_count}, dropped={self._dropped_count}")
    
    def force_flush(self, timeout_millis: int = 30000) -> bool:
        """强制刷新（对于内存收集器，这是空操作）"""
        return True
    
    def _convert_span(self, span: "ReadableSpan") -> Dict[str, Any]:
        """
        将 OTel ReadableSpan 转换为字典格式
        
        Args:
            span: OTel ReadableSpan
            
        Returns:
            SpanNode 兼容的字典
        """
        ctx = span.get_span_context()
        parent = span.parent
        
        # 转换时间戳
        start_time = None
        end_time = None
        duration_ms = None
        
        if span.start_time:
            # OTel 时间戳是纳秒
            start_time = datetime.fromtimestamp(span.start_time / 1e9, tz=timezone.utc)
        if span.end_time:
            end_time = datetime.fromtimestamp(span.end_time / 1e9, tz=timezone.utc)
        if span.start_time and span.end_time:
            duration_ms = (span.end_time - span.start_time) / 1e6
        
        # 转换属性
        attributes = dict(span.attributes) if span.attributes else {}
        
        # 转换事件
        events = []
        if span.events:
            for event in span.events:
                events.append({
                    "name": event.name,
                    "timestamp": datetime.fromtimestamp(event.timestamp / 1e9, tz=timezone.utc).isoformat()
                    if event.timestamp else None,
                    "attributes": dict(event.attributes) if event.attributes else {},
                })
        
        # 确定状态
        status = "ok"
        if span.status:
            status_code = span.status.status_code
            if hasattr(status_code, 'name'):
                status = status_code.name.lower()
            elif status_code == 2:  # StatusCode.ERROR
                status = "error"
        
        return {
            "name": span.name,
            "span_id": format(ctx.span_id, '016x'),
            "trace_id": format(ctx.trace_id, '032x'),
            "parent_id": format(parent.span_id, '016x') if parent else None,
            "start_time": start_time,
            "end_time": end_time,
            "duration_ms": duration_ms,
            "status": status,
            "attributes": attributes,
            "events": events,
        }
    
    def get_span_tree(self) -> SpanTree:
        """
        获取收集的 Span 作为 SpanTree
        
        Returns:
            SpanTree 实例
        """
        return SpanTree.from_spans(self._spans)
    
    def get_spans(self) -> List[Dict[str, Any]]:
        """
        获取原始 Span 数据
        
        Returns:
            Span 字典列表
        """
        return self._spans.copy()
    
    def clear(self) -> int:
        """
        清除收集的 Span
        
        Returns:
            清除的 Span 数量
        """
        count = len(self._spans)
        self._spans.clear()
        return count
    
    def get_stats(self) -> Dict[str, Any]:
        """
        获取导出器统计信息
        
        Returns:
            统计信息字典
        """
        return {
            "collected_spans": len(self._spans),
            "export_count": self._export_count,
            "dropped_count": self._dropped_count,
            "max_spans": self._max_spans,
        }


def create_span_tree_provider(
    service_name: str = "agenticx",
    max_spans: int = 10000,
) -> tuple[Any, "SpanTreeExporter"]:
    """
    创建配置了 SpanTreeExporter 的 TracerProvider
    
    便捷函数，一步完成 Provider 和 Exporter 的配置。
    
    Args:
        service_name: 服务名称
        max_spans: 最大 Span 数量
        
    Returns:
        (TracerProvider, SpanTreeExporter) 元组
        
    Raises:
        ImportError: 如果 OTel SDK 未安装
        
    Example:
        >>> provider, exporter = create_span_tree_provider("my-agent")
        >>> trace.set_tracer_provider(provider)
        >>> # 执行任务...
        >>> span_tree = exporter.get_span_tree()
    """
    if not _OTEL_AVAILABLE:
        raise ImportError(
            "OpenTelemetry SDK 未安装。请运行: pip install agenticx[otel]"
        )
    
    from opentelemetry import trace  # type: ignore
    from opentelemetry.sdk.trace import TracerProvider  # type: ignore
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # type: ignore
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME  # type: ignore
    
    # 创建资源
    resource = Resource.create({SERVICE_NAME: service_name})
    
    # 创建 Provider
    provider = TracerProvider(resource=resource)
    
    # 创建 Exporter
    exporter = SpanTreeExporter(max_spans=max_spans)
    
    # 使用 SimpleSpanProcessor 以确保 Span 立即导出（便于测试）
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    
    return provider, exporter


__all__ = [
    "SpanTreeExporter",
    "create_span_tree_provider",
]
