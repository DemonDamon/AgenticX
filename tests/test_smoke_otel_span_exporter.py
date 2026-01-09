"""
冒烟测试: SpanTreeExporter

测试内容:
- SpanTreeExporter 初始化
- Span 导出和转换
- SpanTree 生成

内化来源: alibaba/loongsuite-python-agent
"""

import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone


class TestSpanTreeExporterImport:
    """测试导入"""
    
    def test_span_tree_exporter_import(self):
        """测试 SpanTreeExporter 可导入"""
        from agenticx.observability.otel import SpanTreeExporter
        assert SpanTreeExporter is not None
    
    def test_create_span_tree_provider_import(self):
        """测试 create_span_tree_provider 可导入"""
        from agenticx.observability.otel import create_span_tree_provider
        assert create_span_tree_provider is not None


class TestSpanTreeExporterBasic:
    """基本功能测试"""
    
    def test_exporter_init(self):
        """测试导出器初始化"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter()
        assert exporter._max_spans == 10000
        assert len(exporter._spans) == 0
        
        exporter = SpanTreeExporter(max_spans=100)
        assert exporter._max_spans == 100
    
    def test_exporter_get_stats(self):
        """测试统计信息"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter()
        stats = exporter.get_stats()
        
        assert isinstance(stats, dict)
        assert "collected_spans" in stats
        assert "export_count" in stats
        assert "dropped_count" in stats
        assert "max_spans" in stats
    
    def test_exporter_get_spans_empty(self):
        """测试空导出器"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter()
        spans = exporter.get_spans()
        
        assert isinstance(spans, list)
        assert len(spans) == 0
    
    def test_exporter_clear(self):
        """测试清除"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter()
        # 手动添加一些数据
        exporter._spans.append({"name": "test"})
        
        count = exporter.clear()
        assert count == 1
        assert len(exporter._spans) == 0
    
    def test_exporter_get_span_tree_empty(self):
        """测试空 SpanTree"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter()
        span_tree = exporter.get_span_tree()
        
        assert span_tree is not None
        assert span_tree.get_span_count() == 0
    
    def test_exporter_force_flush(self):
        """测试 force_flush"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter()
        result = exporter.force_flush()
        assert result is True
    
    def test_exporter_shutdown(self):
        """测试 shutdown"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter()
        # 不应抛出异常
        exporter.shutdown()


@pytest.mark.skipif(
    not pytest.importorskip("opentelemetry.sdk", reason="OTel SDK not installed"),
    reason="OpenTelemetry SDK not installed"
)
class TestSpanTreeExporterWithOTel:
    """使用真实 OTel SDK 测试"""
    
    def test_export_spans(self):
        """测试导出 Span"""
        from agenticx.observability.otel import SpanTreeExporter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        
        # 创建导出器
        exporter = SpanTreeExporter()
        
        # 创建 Provider
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        
        # 创建 tracer 并生成 span
        tracer = provider.get_tracer("test")
        
        with tracer.start_as_current_span("test_span") as span:
            span.set_attribute("test.attr", "value")
        
        # 验证 span 被收集
        assert len(exporter._spans) == 1
        assert exporter._spans[0]["name"] == "test_span"
        assert exporter._spans[0]["attributes"]["test.attr"] == "value"
    
    def test_export_nested_spans(self):
        """测试导出嵌套 Span"""
        from agenticx.observability.otel import SpanTreeExporter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        
        exporter = SpanTreeExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        tracer = provider.get_tracer("test")
        
        with tracer.start_as_current_span("parent") as parent:
            with tracer.start_as_current_span("child") as child:
                child.set_attribute("level", "child")
            parent.set_attribute("level", "parent")
        
        # 验证两个 span 被收集
        assert len(exporter._spans) == 2
        
        # 获取 SpanTree
        span_tree = exporter.get_span_tree()
        assert span_tree.get_span_count() == 2
    
    def test_get_span_tree_with_data(self):
        """测试生成 SpanTree"""
        from agenticx.observability.otel import SpanTreeExporter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        
        exporter = SpanTreeExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        tracer = provider.get_tracer("test")
        
        with tracer.start_as_current_span("root"):
            with tracer.start_as_current_span("child1"):
                pass
            with tracer.start_as_current_span("child2"):
                pass
        
        span_tree = exporter.get_span_tree()
        
        # 验证 SpanTree
        assert span_tree.get_span_count() == 3
        summary = span_tree.get_summary()
        assert summary["total_spans"] == 3
    
    def test_create_span_tree_provider(self):
        """测试便捷创建函数"""
        from agenticx.observability.otel import create_span_tree_provider
        
        provider, exporter = create_span_tree_provider(
            service_name="test-service",
            max_spans=500,
        )
        
        assert provider is not None
        assert exporter is not None
        assert exporter._max_spans == 500
        
        # 使用 provider
        tracer = provider.get_tracer("test")
        with tracer.start_as_current_span("test"):
            pass
        
        assert len(exporter._spans) == 1


class TestSpanTreeExporterEdgeCases:
    """边界条件测试"""
    
    def test_max_spans_limit(self):
        """测试最大 Span 限制"""
        from agenticx.observability.otel import SpanTreeExporter
        
        exporter = SpanTreeExporter(max_spans=2)
        
        # 手动添加超过限制的数据
        exporter._spans.append({"name": "span1"})
        exporter._spans.append({"name": "span2"})
        
        # 验证达到限制
        assert len(exporter._spans) == 2
        
        stats = exporter.get_stats()
        assert stats["max_spans"] == 2
    
    def test_exporter_without_otel_sdk(self):
        """测试无 OTel SDK 时的行为"""
        from agenticx.observability.otel.span_exporter import SpanTreeExporter
        
        # 即使没有 OTel SDK，也应该能创建实例
        exporter = SpanTreeExporter()
        assert exporter is not None
        
        # 基本操作应该工作
        span_tree = exporter.get_span_tree()
        assert span_tree is not None


class TestSpanConversion:
    """Span 转换测试"""
    
    @pytest.mark.skipif(
        not pytest.importorskip("opentelemetry.sdk", reason="OTel SDK not installed"),
        reason="OpenTelemetry SDK not installed"
    )
    def test_span_attributes_preserved(self):
        """测试 Span 属性保留"""
        from agenticx.observability.otel import SpanTreeExporter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        
        exporter = SpanTreeExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        tracer = provider.get_tracer("test")
        
        with tracer.start_as_current_span("test") as span:
            span.set_attribute("string.attr", "value")
            span.set_attribute("int.attr", 42)
            span.set_attribute("bool.attr", True)
        
        span_data = exporter._spans[0]
        
        assert span_data["attributes"]["string.attr"] == "value"
        assert span_data["attributes"]["int.attr"] == 42
        assert span_data["attributes"]["bool.attr"] is True
    
    @pytest.mark.skipif(
        not pytest.importorskip("opentelemetry.sdk", reason="OTel SDK not installed"),
        reason="OpenTelemetry SDK not installed"
    )
    def test_span_timing_preserved(self):
        """测试 Span 时间信息保留"""
        from agenticx.observability.otel import SpanTreeExporter
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import SimpleSpanProcessor
        import time
        
        exporter = SpanTreeExporter()
        provider = TracerProvider()
        provider.add_span_processor(SimpleSpanProcessor(exporter))
        tracer = provider.get_tracer("test")
        
        with tracer.start_as_current_span("test"):
            time.sleep(0.01)  # 10ms
        
        span_data = exporter._spans[0]
        
        assert span_data["start_time"] is not None
        assert span_data["end_time"] is not None
        assert span_data["duration_ms"] is not None
        assert span_data["duration_ms"] >= 10  # 至少 10ms


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
