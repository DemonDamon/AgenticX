"""
冒烟测试: OpenTelemetry AI 语义约定对齐 (Spring AI 内化)

本测试验证 AgenticX 可观测性模块的 OpenTelemetry 语义约定对齐功能:
- A1: AI 属性常量定义
- A2: PrometheusExporter 指标命名对齐
- A3: 向后兼容别名支持

内化来源: Spring AI ChatModelObservationDocumentation
参考文档: OpenTelemetry Semantic Conventions for GenAI
"""

import pytest
from agenticx.observability import (
    AiObservationAttributes,
    AiOperationType,
    LegacyMetricNames,
    OTelMetricNames,
    METRIC_NAME_MAPPING,
    MetricsCollector,
    PrometheusExporter,
    PerformanceMetrics
)


class TestAiObservationAttributes:
    """测试 AI 观测属性常量"""
    
    def test_operation_type_attribute(self):
        """测试操作类型属性名称遵循 OpenTelemetry 规范"""
        assert AiObservationAttributes.AI_OPERATION_TYPE == "gen_ai.operation.name"
    
    def test_provider_attribute(self):
        """测试提供商属性名称遵循 OpenTelemetry 规范"""
        assert AiObservationAttributes.AI_PROVIDER == "gen_ai.system"
    
    def test_request_model_attribute(self):
        """测试请求模型属性名称"""
        assert AiObservationAttributes.REQUEST_MODEL == "gen_ai.request.model"
    
    def test_token_usage_attributes(self):
        """测试 Token 用量属性名称遵循 OpenTelemetry 规范"""
        assert AiObservationAttributes.USAGE_INPUT_TOKENS == "gen_ai.usage.input_tokens"
        assert AiObservationAttributes.USAGE_OUTPUT_TOKENS == "gen_ai.usage.output_tokens"
        assert AiObservationAttributes.USAGE_TOTAL_TOKENS == "gen_ai.usage.total_tokens"
    
    def test_response_attributes(self):
        """测试响应属性名称"""
        assert AiObservationAttributes.RESPONSE_MODEL == "gen_ai.response.model"
        assert AiObservationAttributes.RESPONSE_ID == "gen_ai.response.id"
        assert AiObservationAttributes.RESPONSE_FINISH_REASONS == "gen_ai.response.finish_reasons"
    
    def test_agenticx_extension_attributes(self):
        """测试 AgenticX 扩展属性使用正确的命名空间"""
        assert AiObservationAttributes.AGENTICX_AGENT_ID == "agenticx.agent.id"
        assert AiObservationAttributes.AGENTICX_TASK_ID == "agenticx.task.id"
        assert AiObservationAttributes.AGENTICX_TOOL_NAME == "agenticx.tool.name"
    
    def test_get_all_otel_attributes(self):
        """测试获取所有 OpenTelemetry 标准属性"""
        otel_attrs = AiObservationAttributes.get_all_otel_attributes()
        
        # 应包含 gen_ai.* 属性
        assert "AI_OPERATION_TYPE" in otel_attrs
        assert "gen_ai.operation.name" in otel_attrs.values()
        
        # 不应包含 agenticx.* 扩展属性
        assert "AGENTICX_AGENT_ID" not in otel_attrs
    
    def test_get_agenticx_attributes(self):
        """测试获取所有 AgenticX 扩展属性"""
        agenticx_attrs = AiObservationAttributes.get_agenticx_attributes()
        
        # 应只包含 AGENTICX_ 前缀的属性
        assert all(name.startswith("AGENTICX_") for name in agenticx_attrs.keys())
        assert "agenticx.agent.id" in agenticx_attrs.values()


class TestAiOperationType:
    """测试 AI 操作类型枚举"""
    
    def test_chat_operation(self):
        """测试聊天操作类型"""
        assert AiOperationType.CHAT.value == "chat"
    
    def test_embedding_operation(self):
        """测试嵌入操作类型"""
        assert AiOperationType.EMBEDDING.value == "embedding"
    
    def test_tool_call_operation(self):
        """测试工具调用操作类型"""
        assert AiOperationType.TOOL_CALL.value == "tool_call"
    
    def test_all_operation_types(self):
        """测试所有操作类型都是字符串"""
        for op_type in AiOperationType:
            assert isinstance(op_type.value, str)


class TestMetricNameMapping:
    """测试指标名称映射"""
    
    def test_mapping_exists(self):
        """测试映射表存在"""
        assert isinstance(METRIC_NAME_MAPPING, dict)
        assert len(METRIC_NAME_MAPPING) > 0
    
    def test_legacy_to_otel_mapping(self):
        """测试旧名称到新名称的映射"""
        assert LegacyMetricNames.LLM_CALLS_TOTAL in METRIC_NAME_MAPPING
        assert METRIC_NAME_MAPPING[LegacyMetricNames.LLM_CALLS_TOTAL] == OTelMetricNames.LLM_CALLS_TOTAL


class TestOTelMetricNames:
    """测试 OpenTelemetry 指标名称"""
    
    def test_gen_ai_token_usage(self):
        """测试 GenAI Token 用量指标名称"""
        assert OTelMetricNames.TOKEN_USAGE == "gen_ai.client.token.usage"
    
    def test_agenticx_namespace(self):
        """测试 AgenticX 指标使用正确的命名空间"""
        assert OTelMetricNames.TASKS_TOTAL.startswith("agenticx.")
        assert OTelMetricNames.LLM_CALLS_TOTAL.startswith("agenticx.")


class TestPrometheusExporterOTelNaming:
    """测试 PrometheusExporter OpenTelemetry 命名"""
    
    @pytest.fixture
    def metrics_collector(self):
        """创建指标收集器"""
        collector = MetricsCollector()
        # 设置一些测试数据
        collector.performance_metrics.task_count = 10
        collector.performance_metrics.task_success_count = 8
        collector.performance_metrics.task_failure_count = 2
        collector.performance_metrics.llm_call_count = 5
        collector.performance_metrics.llm_token_usage = 1000
        collector.performance_metrics.llm_cost_total = 0.05
        collector.performance_metrics.error_count = 1
        return collector
    
    def test_otel_naming_default(self, metrics_collector):
        """测试默认使用 OpenTelemetry 命名"""
        exporter = PrometheusExporter(metrics_collector)
        assert exporter.use_otel_naming is True
    
    def test_otel_format_metrics(self, metrics_collector):
        """测试 OpenTelemetry 格式的指标输出"""
        exporter = PrometheusExporter(metrics_collector, use_otel_naming=True)
        output = exporter.export_metrics()
        
        # 验证 OpenTelemetry GenAI 标准指标
        assert "gen_ai_client_token_usage" in output
        
        # 验证 agenticx.* 命名空间（点号在 Prometheus 中转为下划线）
        assert "agenticx_tasks_total" in output
        assert "agenticx_llm_calls_total" in output
        
        # 验证使用标签区分状态
        assert 'status="success"' in output
        assert 'status="failure"' in output
    
    def test_legacy_format_metrics(self, metrics_collector):
        """测试旧版格式的指标输出"""
        exporter = PrometheusExporter(metrics_collector, use_otel_naming=False)
        output = exporter.export_metrics()
        
        # 验证旧版命名
        assert "agenticx_tasks_total" in output
        assert "agenticx_tasks_success_total" in output
        assert "agenticx_tasks_failure_total" in output
        
        # 验证没有新的命名格式
        assert "gen_ai_client_token_usage" not in output
    
    def test_backward_compatibility(self, metrics_collector):
        """测试向后兼容性 - 可切换回旧命名"""
        exporter_otel = PrometheusExporter(metrics_collector, use_otel_naming=True)
        exporter_legacy = PrometheusExporter(metrics_collector, use_otel_naming=False)
        
        otel_output = exporter_otel.export_metrics()
        legacy_output = exporter_legacy.export_metrics()
        
        # 两种格式应产生不同的输出
        assert otel_output != legacy_output
        
        # 旧版格式应保留原有指标名称
        assert "agenticx_tasks_success_total" in legacy_output
    
    def test_export_to_file(self, metrics_collector, tmp_path):
        """测试导出到文件"""
        exporter = PrometheusExporter(metrics_collector, use_otel_naming=True)
        output_file = tmp_path / "metrics.prom"
        
        exporter.export_to_file(str(output_file))
        
        assert output_file.exists()
        content = output_file.read_text()
        assert "gen_ai_client_token_usage" in content


class TestLegacyMetricNames:
    """测试旧版指标名称常量"""
    
    def test_legacy_naming_convention(self):
        """测试旧版命名使用下划线分隔"""
        assert LegacyMetricNames.TASKS_TOTAL == "agenticx_tasks_total"
        assert LegacyMetricNames.LLM_TOKENS_TOTAL == "agenticx_llm_tokens_total"
    
    def test_all_legacy_names_prefixed(self):
        """测试所有旧版名称都以 agenticx_ 开头"""
        for name in dir(LegacyMetricNames):
            if not name.startswith("_"):
                value = getattr(LegacyMetricNames, name)
                if isinstance(value, str):
                    assert value.startswith("agenticx_"), f"{name} 应以 agenticx_ 开头"


class TestOTelAttributeConformance:
    """测试 OpenTelemetry 属性符合性"""
    
    def test_gen_ai_prefix_for_standard_attributes(self):
        """测试标准属性使用 gen_ai. 前缀"""
        standard_attrs = [
            AiObservationAttributes.AI_OPERATION_TYPE,
            AiObservationAttributes.AI_PROVIDER,
            AiObservationAttributes.REQUEST_MODEL,
            AiObservationAttributes.RESPONSE_MODEL,
            AiObservationAttributes.USAGE_INPUT_TOKENS,
        ]
        for attr in standard_attrs:
            assert attr.startswith("gen_ai."), f"{attr} 应以 gen_ai. 开头"
    
    def test_agenticx_prefix_for_extensions(self):
        """测试扩展属性使用 agenticx. 前缀"""
        extension_attrs = [
            AiObservationAttributes.AGENTICX_AGENT_ID,
            AiObservationAttributes.AGENTICX_TASK_ID,
            AiObservationAttributes.AGENTICX_TOOL_NAME,
        ]
        for attr in extension_attrs:
            assert attr.startswith("agenticx."), f"{attr} 应以 agenticx. 开头"
    
    def test_no_mixed_naming(self):
        """测试没有混合命名（如 gen_ai_agenticx）"""
        all_attrs = AiObservationAttributes.get_all_attributes()
        for name, value in all_attrs.items():
            assert not ("gen_ai" in value and "agenticx" in value), \
                f"{name}={value} 不应混合 gen_ai 和 agenticx 命名空间"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

