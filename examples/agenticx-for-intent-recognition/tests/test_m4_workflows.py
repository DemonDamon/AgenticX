"""M4模块工作流测试
测试意图处理工作流的功能
"""

import pytest
import unittest
import time
from unittest.mock import Mock, MagicMock

from agenticx.llms.base import BaseLLMProvider
from agenticx.core.task import Task
from agenticx.core.agent_executor import AgentExecutor
from agenticx.tools.base import BaseTool

from agents.intent_agent import IntentRecognitionAgent
from agents.general_agent import GeneralIntentAgent
from agents.search_agent import SearchIntentAgent
from agents.function_agent import FunctionIntentAgent
from tools.hybrid_extractor import HybridExtractor
from tools.rule_matching_tool import RuleMatchingTool
from tools.entity_models import ExtractionResult

from workflows import (
    IntentRecognitionWorkflow,
    GeneralIntentWorkflow,
    SearchIntentWorkflow,
    FunctionIntentWorkflow,
    PipelineResult,
    ConversationContext,
    SearchQuery,
    FunctionCall
)


class TestIntentRecognitionWorkflow:
    """测试意图识别主工作流"""
    
    @pytest.fixture
    def mock_llm_provider(self):
        """模拟LLM提供者"""
        mock_llm = Mock(spec=BaseLLMProvider)
        return mock_llm
    
    @pytest.fixture
    def mock_intent_agent(self):
        """模拟意图代理"""
        mock_agent = Mock(spec=IntentRecognitionAgent)
        return mock_agent
    
    @pytest.fixture
    def mock_entity_extractor(self):
        """模拟实体抽取器"""
        mock_extractor = Mock(spec=HybridExtractor)
        mock_extractor.extract = Mock()
        mock_extractor.extract.return_value = ExtractionResult(
            entities={"PERSON": [{"text": "张三", "label": "PERSON", "entity_type": "person", "confidence": 0.9, "start": 0, "end": 2}]},
            confidence=0.8,
            extraction_method="hybrid"
        )
        return mock_extractor
    
    @pytest.fixture
    def mock_rule_tool(self):
        """模拟规则匹配工具"""
        mock_tool = Mock(spec=RuleMatchingTool)
        mock_result = Mock()
        mock_result.data = [{"intent": "test_intent", "confidence": 0.7}]
        mock_tool.execute.return_value = mock_result
        return mock_tool
    
    @pytest.fixture
    def workflow(self, mock_llm_provider, mock_intent_agent, mock_entity_extractor, mock_rule_tool):
        """创建工作流实例"""
        return IntentRecognitionWorkflow(
            llm_provider=mock_llm_provider,
            intent_agent=mock_intent_agent,
            entity_extractor=mock_entity_extractor,
            rule_tool=mock_rule_tool
        )
    
    def test_workflow_initialization(self, workflow):
        """测试工作流初始化"""
        assert workflow is not None
        assert workflow.workflow.name == "intent_recognition_workflow"
        assert len(workflow.workflow.nodes) == 5
        assert len(workflow.workflow.edges) == 4
    
    def test_workflow_execution(self, workflow):
        """测试工作流执行"""
        # 模拟代理执行结果
        mock_result = Mock()
        mock_result.output = "general_conversation"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("你好，今天天气怎么样？")
        
        assert isinstance(result, PipelineResult)
        assert result.intent is not None
        assert result.processing_time >= 0
        assert result.total_processing_time >= 0
        assert "rules_count" in result.metadata
        assert "strategies_used" in result.metadata
    
    def test_workflow_with_empty_text(self, workflow):
        """测试空文本处理"""
        result = workflow.execute("")
        
        assert isinstance(result, PipelineResult)
        assert "error" in result.metadata
    
    def test_get_workflow_info(self, workflow):
        """测试获取工作流信息"""
        info = workflow.get_workflow_info()
        
        assert info["name"] == "intent_recognition_workflow"
        assert "nodes" in info
        assert "edges_count" in info
        assert len(info["nodes"]) == 5


class TestGeneralIntentWorkflow:
    """测试通用意图处理工作流"""
    
    @pytest.fixture
    def mock_llm_provider(self):
        """模拟LLM提供者"""
        return Mock(spec=BaseLLMProvider)
    
    @pytest.fixture
    def mock_general_agent(self):
        """模拟通用代理"""
        return Mock(spec=GeneralIntentAgent)
    
    @pytest.fixture
    def workflow(self, mock_llm_provider, mock_general_agent):
        """创建通用意图工作流实例"""
        return GeneralIntentWorkflow(
            llm_provider=mock_llm_provider,
            general_agent=mock_general_agent
        )
    
    def test_workflow_initialization(self, workflow):
        """测试工作流初始化"""
        assert workflow is not None
        assert workflow.workflow.name == "general_intent_workflow"
        assert len(workflow.workflow.nodes) == 3
    
    def test_sentiment_analysis(self, workflow):
        """测试情感分析"""
        mock_result = Mock()
        mock_result.output = "这是一个友好的回复"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("今天真是太好了！")
        
        assert isinstance(result, PipelineResult)
        assert result.intent == "000_general_conversation"
        assert "sentiment" in result.metadata
        assert result.metadata["sentiment"] == "positive"
    
    def test_negative_sentiment(self, workflow):
        """测试负面情感"""
        mock_result = Mock()
        mock_result.output = "理解您的感受"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("今天真是糟糕透了")
        
        assert result.metadata["sentiment"] == "negative"
    
    def test_conversation_context(self, workflow):
        """测试对话上下文"""
        context = ConversationContext(
            history=[
                {"role": "user", "content": "你好"},
                {"role": "assistant", "content": "您好！"}
            ],
            current_turn=1
        )
        
        mock_result = Mock()
        mock_result.output = "继续对话"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("谢谢你的帮助", context)
        
        assert isinstance(result, PipelineResult)
        assert result.intent == "000_general_conversation"


class TestSearchIntentWorkflow:
    """测试搜索意图处理工作流"""
    
    @pytest.fixture
    def mock_llm_provider(self):
        """模拟LLM提供者"""
        return Mock(spec=BaseLLMProvider)
    
    @pytest.fixture
    def mock_search_agent(self):
        """模拟搜索代理"""
        return Mock(spec=SearchIntentAgent)
    
    @pytest.fixture
    def mock_entity_extractor(self):
        """模拟实体抽取器"""
        mock_extractor = Mock(spec=HybridExtractor)
        mock_extractor.extract = Mock()
        mock_extractor.extract.return_value = ExtractionResult(
             entities={"TECH": [{"text": "Python", "label": "TECH", "entity_type": "keyword", "confidence": 0.9, "start": 0, "end": 6}]},
            confidence=0.8,
            extraction_method="hybrid"
        )
        return mock_extractor
    
    @pytest.fixture
    def workflow(self, mock_llm_provider, mock_search_agent, mock_entity_extractor):
        """创建搜索意图工作流实例"""
        return SearchIntentWorkflow(
            llm_provider=mock_llm_provider,
            search_agent=mock_search_agent,
            entity_extractor=mock_entity_extractor
        )
    
    def test_workflow_initialization(self, workflow):
        """测试工作流初始化"""
        assert workflow is not None
        assert workflow.workflow.name == "search_intent_workflow"
        assert len(workflow.workflow.nodes) == 3
    
    def test_information_search(self, workflow):
        """测试信息搜索"""
        mock_result = Mock()
        mock_result.output = "搜索结果"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("什么是Python编程语言？")
        
        assert isinstance(result, PipelineResult)
        assert result.intent.startswith("001_")
        assert "search_query" in result.metadata
        assert result.metadata["query_type"] == "information"
    
    def test_how_to_search(self, workflow):
        """测试方法搜索"""
        mock_result = Mock()
        mock_result.output = "教程结果"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("如何学习Python编程？")
        
        assert result.metadata["query_type"] == "how_to"
        assert result.metadata["intent_subtype"] == "technical"
    
    def test_recommendation_search(self, workflow):
        """测试推荐搜索"""
        mock_result = Mock()
        mock_result.output = "推荐结果"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("推荐一些好用的Python库")
        
        assert result.metadata["query_type"] == "recommendation"
    
    def test_search_entities(self, workflow):
        """测试搜索实体抽取"""
        mock_result = Mock()
        mock_result.output = "搜索结果"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("搜索最新的机器学习算法")
        
        assert "SEARCH_TERM" in result.entities
        assert len(result.entities["SEARCH_TERM"]) > 0


class TestFunctionIntentWorkflow:
    """测试工具调用意图处理工作流"""
    
    @pytest.fixture
    def mock_llm_provider(self):
        """模拟LLM提供者"""
        return Mock(spec=BaseLLMProvider)
    
    @pytest.fixture
    def mock_function_agent(self):
        """模拟工具调用代理"""
        return Mock(spec=FunctionIntentAgent)
    
    @pytest.fixture
    def mock_entity_extractor(self):
        """模拟实体抽取器"""
        mock_extractor = Mock(spec=HybridExtractor)
        mock_extractor.extract = Mock()
        mock_extractor.extract.return_value = ExtractionResult(
             entities={"FILE": [{"text": "document.txt", "label": "FILE", "entity_type": "other", "confidence": 0.9, "start": 0, "end": 12}]},
            confidence=0.8,
            extraction_method="hybrid"
        )
        return mock_extractor
    
    @pytest.fixture
    def mock_tools(self):
        """模拟可用工具"""
        mock_tool = Mock(spec=BaseTool)
        mock_tool.name = "test_tool"
        mock_tool.description = "Test tool for testing"
        mock_tool.type = "function"
        return [mock_tool]
    
    @pytest.fixture
    def workflow(self, mock_llm_provider, mock_function_agent, mock_entity_extractor, mock_tools):
        """创建工具调用意图工作流实例"""
        return FunctionIntentWorkflow(
            llm_provider=mock_llm_provider,
            function_agent=mock_function_agent,
            entity_extractor=mock_entity_extractor,
            available_tools=mock_tools
        )
    
    def test_workflow_initialization(self, workflow):
        """测试工作流初始化"""
        assert workflow is not None
        assert workflow.workflow.name == "function_intent_workflow"
        assert len(workflow.workflow.nodes) == 3
    
    def test_file_management_function(self, workflow):
        """测试文件管理功能"""
        mock_result = Mock()
        mock_result.output = "文件操作完成"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("请创建一个名为report.txt的文件")
        
        assert isinstance(result, PipelineResult)
        assert result.intent.startswith("002_")
        assert "function_call" in result.metadata
        assert "parameter_completeness" in result.metadata
    
    def test_email_function(self, workflow):
        """测试邮件功能"""
        mock_result = Mock()
        mock_result.output = "邮件发送完成"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("发送邮件给zhang@example.com")
        
        assert result.metadata["tool_type"] == "communication"
    
    def test_parameter_extraction(self, workflow):
        """测试参数抽取"""
        mock_result = Mock()
        mock_result.output = "操作完成"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("打开文件C:\\Users\\test\\document.pdf")
        
        assert "FUNCTION_PARAMETERS" in result.entities
        parameters_text = result.entities["FUNCTION_PARAMETERS"][0]["text"]
        assert "action" in parameters_text or "file_path" in parameters_text
    
    def test_tool_validation(self, workflow):
        """测试工具验证"""
        mock_result = Mock()
        mock_result.output = "验证通过"
        
        with unittest.mock.patch('agenticx.core.agent_executor.AgentExecutor.run', return_value=mock_result):
            result = workflow.execute("计算 2 + 3")
        
        assert "validation_result" in result.metadata
        validation = result.metadata["validation_result"]
        assert "status" in validation
        assert "confidence" in validation


class TestWorkflowIntegration:
    """测试工作流集成"""
    
    def test_pipeline_result_model(self):
        """测试流水线结果模型"""
        result = PipelineResult(
            intent="test_intent",
            entities={"TEST": [{"text": "test", "label": "TEST", "entity_type": "other", "confidence": 0.8, "start": 0, "end": 4}]},
            confidence=0.9,
            rule_matches=[],
            processing_time=0.1,
            total_processing_time=0.1,
            metadata={"test": "data"}
        )
        
        assert result.intent == "test_intent"
        assert result.confidence == 0.9
        assert "TEST" in result.entities
        assert result.metadata["test"] == "data"
    
    def test_conversation_context_model(self):
        """测试对话上下文模型"""
        context = ConversationContext(
            history=[
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hi"}
            ],
            current_turn=1,
            session_id="test_session"
        )
        
        assert len(context.history) == 2
        assert context.current_turn == 1
        assert context.session_id == "test_session"
    
    def test_search_query_model(self):
        """测试搜索查询模型"""
        query = SearchQuery(
            query="test query",
            query_type="information",
            entities=["test", "query"],
            intent_subtype="technical",
            parameters={"sort_by": "relevance"}
        )
        
        assert query.query == "test query"
        assert query.query_type == "information"
        assert len(query.entities) == 2
        assert query.parameters["sort_by"] == "relevance"
    
    def test_function_call_model(self):
        """测试工具调用模型"""
        function_call = FunctionCall(
            function_name="TestTool",
            function_type="test",
            parameters={"param1": "value1"},
            confidence=0.8,
            validation_status="validated"
        )
        
        assert function_call.function_name == "TestTool"
        assert function_call.function_type == "test"
        assert function_call.parameters["param1"] == "value1"
        assert function_call.confidence == 0.8
        assert function_call.validation_status == "validated"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])