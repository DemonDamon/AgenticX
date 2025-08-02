"""M4 工具系统智能化优化测试

测试工具智能选择引擎的核心功能。
"""

import pytest
from unittest.mock import Mock, patch
from datetime import datetime, timedelta

from agenticx.tools.intelligence import (
    ToolIntelligenceEngine,
    ToolUsageHistory,
    ToolChainAssembler,
    TaskComplexity,
    TaskFeatures,
    ToolResult,
    PerformanceMetrics
)
from agenticx.tools.base import BaseTool
from agenticx.core.task import Task


class MockTool(BaseTool):
    """测试用的模拟工具"""
    
    def __init__(self, name: str, description: str = ""):
        super().__init__(name=name, description=description)
    
    def _run(self, **kwargs):
        return f"Mock result from {self.name}"


class TestToolIntelligenceEngine:
    """工具智能选择引擎测试"""
    
    def setup_method(self):
        """测试前准备"""
        # 使用临时路径避免测试间状态污染
        import tempfile
        import os
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.json')
        temp_file.close()
        os.unlink(temp_file.name)  # 删除文件，只保留路径
        self.usage_history = ToolUsageHistory(storage_path=temp_file.name)
        self.engine = ToolIntelligenceEngine(self.usage_history)
        
        # 注册测试工具
        self.data_tool = MockTool("data_processor", "数据处理工具")
        self.web_tool = MockTool("web_scraper", "网页抓取工具")
        self.file_tool = MockTool("file_manager", "文件管理工具")
        
        self.engine.register_tool(
            self.data_tool, 
            domains=["data_analysis"], 
            capabilities=["data_processing"]
        )
        self.engine.register_tool(
            self.web_tool, 
            domains=["web_scraping"], 
            capabilities=["web_request", "html_parsing"]
        )
        self.engine.register_tool(
            self.file_tool, 
            domains=["file_operations"], 
            capabilities=["file_operations"]
        )
    
    def test_tool_registration(self):
        """测试工具注册"""
        assert "data_processor" in self.engine.available_tools
        assert "web_scraper" in self.engine.available_tools
        assert "file_manager" in self.engine.available_tools
        
        # 检查领域映射
        assert "data_processor" in self.engine.domain_expertise["data_analysis"]
        assert "web_scraper" in self.engine.domain_expertise["web_scraping"]
        
        # 检查能力映射
        assert "data_processor" in self.engine.capability_mapping["data_processing"]
        assert "web_scraper" in self.engine.capability_mapping["web_request"]
    
    def test_task_analysis(self):
        """测试任务分析"""
        # 创建测试任务
        task = Mock(spec=Task)
        task.description = "分析销售数据并生成报告"
        task.requirements = ["数据处理", "报告生成"]
        task.priority = 2
        
        # 分析任务
        features = self.engine.analyze_task(task)
        
        assert isinstance(features, TaskFeatures)
        assert features.complexity in [TaskComplexity.SIMPLE, TaskComplexity.MODERATE, TaskComplexity.COMPLEX]
        assert features.domain in ["data_analysis", "general"]
        assert features.priority == 2
        assert "data_processing" in features.required_capabilities
    
    def test_tool_selection_without_history(self):
        """测试无历史数据时的工具选择"""
        task_features = TaskFeatures(
            complexity=TaskComplexity.SIMPLE,
            domain="data_analysis",
            required_capabilities=["data_processing"]
        )
        
        tool, confidence, reasoning = self.engine.select_optimal_tool(task_features)
        
        assert tool is not None
        assert tool.name == "data_processor"
        assert 0.0 <= confidence <= 1.0
        assert isinstance(reasoning, str)
        assert len(reasoning) > 0
    
    def test_tool_selection_with_history(self):
        """测试有历史数据时的工具选择"""
        # 添加历史数据
        self.usage_history.record_usage(
            tool_name="data_processor",
            task_domain="data_analysis",
            success=True,
            execution_time=5.0
        )
        self.usage_history.record_usage(
            tool_name="data_processor",
            task_domain="data_analysis",
            success=True,
            execution_time=6.0
        )
        
        task_features = TaskFeatures(
            complexity=TaskComplexity.SIMPLE,
            domain="data_analysis",
            required_capabilities=["data_processing"]
        )
        
        tool, confidence, reasoning = self.engine.select_optimal_tool(task_features)
        
        assert tool.name == "data_processor"
        assert confidence > 0.5  # 有良好历史记录应该有较高置信度
    
    def test_tool_validation(self):
        """测试工具选择验证"""
        task_features = TaskFeatures(
            complexity=TaskComplexity.SIMPLE,
            domain="data_analysis",
            required_capabilities=["data_processing"]
        )
        
        validation = self.engine.validate_tool_selection(self.data_tool, task_features)
        
        assert isinstance(validation.is_valid, bool)
        assert isinstance(validation.errors, list)
        assert isinstance(validation.warnings, list)
        assert isinstance(validation.suggestions, list)
        assert 0.0 <= validation.confidence_score <= 1.0
    
    def test_learning_from_execution(self):
        """测试从执行结果学习"""
        task_features = TaskFeatures(
            complexity=TaskComplexity.SIMPLE,
            domain="data_analysis",
            required_capabilities=["data_processing"]
        )
        
        tool_result = ToolResult(
            tool_name="data_processor",
            success=True,
            execution_time=8.0,
            result_data={"processed_rows": 1000}
        )
        
        # 学习前的历史记录数
        initial_count = len(self.usage_history.records)
        
        # 执行学习
        self.engine.learn_from_execution(tool_result, task_features)
        
        # 验证历史记录增加
        assert len(self.usage_history.records) == initial_count + 1
        
        # 验证记录内容
        latest_record = self.usage_history.records[-1]
        assert latest_record.tool_name == "data_processor"
        assert latest_record.success == True
        assert latest_record.execution_time == 8.0


class TestToolUsageHistory:
    """工具使用历史测试"""
    
    def setup_method(self):
        """测试前准备"""
        # 使用临时路径避免测试间状态污染
        import tempfile
        import os
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.json')
        temp_file.close()
        os.unlink(temp_file.name)  # 删除文件，只保留路径
        self.history = ToolUsageHistory(storage_path=temp_file.name)
    
    def test_record_usage(self):
        """测试记录使用"""
        self.history.record_usage(
            tool_name="test_tool",
            task_domain="test_domain",
            success=True,
            execution_time=5.0,
            context={"test": "data"}
        )
        
        assert len(self.history.records) == 1
        record = self.history.records[0]
        assert record.tool_name == "test_tool"
        assert record.task_domain == "test_domain"
        assert record.success == True
        assert record.execution_time == 5.0
        assert record.context == {"test": "data"}
    
    def test_get_tool_history(self):
        """测试获取工具历史"""
        # 添加测试数据
        self.history.record_usage("tool1", "domain1", True, 5.0)
        self.history.record_usage("tool1", "domain2", False, 10.0)
        self.history.record_usage("tool2", "domain1", True, 3.0)
        
        # 测试按工具名过滤
        tool1_history = self.history.get_tool_history("tool1")
        assert len(tool1_history) == 2
        
        # 测试按工具名和领域过滤
        tool1_domain1_history = self.history.get_tool_history("tool1", "domain1")
        assert len(tool1_domain1_history) == 1
        assert tool1_domain1_history[0]['success'] == True
    
    def test_get_domain_statistics(self):
        """测试获取领域统计"""
        # 添加测试数据
        for i in range(10):
            success = i < 8  # 80% 成功率
            self.history.record_usage(f"tool{i%3}", "test_domain", success, 5.0 + i)
        
        stats = self.history.get_domain_statistics("test_domain")
        
        assert stats['total_executions'] == 10
        assert abs(stats['success_rate'] - 0.8) < 0.01  # 允许小误差
        assert stats['avg_execution_time'] > 0
        assert 'tool_usage' in stats
        assert stats['most_used_tool'] is not None
    
    def test_analyze_usage_patterns(self):
        """测试使用模式分析"""
        # 添加测试数据
        for i in range(20):
            success = i < 15  # 75% 成功率
            self.history.record_usage("frequent_tool", "common_domain", success, 5.0)
        
        analysis = self.history.analyze_usage_patterns()
        
        assert 'patterns' in analysis
        assert 'recommendations' in analysis
        assert 'tool_frequency' in analysis
        assert 'domain_frequency' in analysis
        
        assert isinstance(analysis['patterns'], list)
        assert isinstance(analysis['recommendations'], list)
    
    def test_cleanup_old_records(self):
        """测试清理旧记录"""
        # 添加新旧记录
        old_time = datetime.now() - timedelta(days=100)
        recent_time = datetime.now() - timedelta(days=10)
        
        # 模拟旧记录
        old_record = self.history.records.append(
            type('MockRecord', (), {
                'tool_name': 'old_tool',
                'timestamp': old_time,
                'task_domain': 'test',
                'success': True,
                'execution_time': 5.0,
                'context': {}
            })()
        )
        
        # 添加新记录
        self.history.record_usage("new_tool", "test_domain", True, 5.0)
        
        initial_count = len(self.history.records)
        
        # 清理90天前的记录
        self.history.cleanup_old_records(days=90)
        
        # 验证旧记录被清理
        assert len(self.history.records) < initial_count


class TestToolChainAssembler:
    """工具链组装器测试"""
    
    def setup_method(self):
        """测试前准备"""
        # 使用临时路径避免测试间状态污染
        import tempfile
        import os
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.json')
        temp_file.close()
        os.unlink(temp_file.name)  # 删除文件，只保留路径
        self.usage_history = ToolUsageHistory(storage_path=temp_file.name)
        self.engine = ToolIntelligenceEngine(self.usage_history)
        self.assembler = ToolChainAssembler(self.engine)
        
        # 注册测试工具
        self.data_tool = MockTool("data_processor")
        self.web_tool = MockTool("web_scraper")
        
        self.engine.register_tool(
            self.data_tool, 
            domains=["data_analysis"], 
            capabilities=["data_processing"]
        )
        self.engine.register_tool(
            self.web_tool, 
            domains=["web_scraping"], 
            capabilities=["web_request"]
        )
    
    def test_simple_task_assembly(self):
        """测试简单任务的工具链组装"""
        task = Mock(spec=Task)
        task.description = "处理数据文件"
        task.requirements = ["数据处理"]
        
        chain = self.assembler.assemble_tool_chain(task)
        
        assert chain is not None
        assert len(chain.steps) >= 1
        assert chain.estimated_duration is not None
        assert chain.success_probability is not None
        assert 0.0 <= chain.success_probability <= 1.0
    
    def test_chain_validation(self):
        """测试工具链验证"""
        task = Mock(spec=Task)
        task.description = "简单任务"
        
        chain = self.assembler.assemble_tool_chain(task)
        validation = self.assembler.validate_tool_chain(chain)
        
        assert isinstance(validation.is_valid, bool)
        assert isinstance(validation.errors, list)
        assert isinstance(validation.warnings, list)
        assert isinstance(validation.suggestions, list)
        assert 0.0 <= validation.confidence_score <= 1.0
    
    def test_template_registration(self):
        """测试模板注册"""
        template = [
            {
                'tool_name': 'data_processor',
                'order': 0,
                'dependencies': [],
                'input_mapping': {},
                'output_mapping': {'result': 'processed_data'}
            }
        ]
        
        self.assembler.register_chain_template(
            name="data_processing_template",
            template=template,
            applicable_domains=["data_analysis"]
        )
        
        assert "data_processing_template" in self.assembler.chain_templates
        template_info = self.assembler.chain_templates["data_processing_template"]
        assert "data_analysis" in template_info['domains']


if __name__ == "__main__":
    pytest.main([__file__, "-v"])