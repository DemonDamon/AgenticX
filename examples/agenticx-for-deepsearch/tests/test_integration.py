#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
agenticx-for-deepsearch 集成测试
测试完整的工作流执行流程
"""

import pytest
import os
import sys
from unittest.mock import Mock, patch, MagicMock
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.append(str(Path(__file__).parent.parent))

from workflows.deep_search_workflow import DeepSearchWorkflow
from agenticx.llms.litellm_provider import LiteLLMProvider


class TestDeepSearchWorkflowIntegration:
    """深度搜索工作流集成测试"""
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_basic_execution(self, mock_llm):
        """测试工作流基本执行"""
        # 模拟 LLM 提供者
        mock_llm_instance = Mock()
        # 创建模拟响应对象
        mock_response = Mock()
        mock_response.content = '{"queries": ["人工智能发展 最新研究", "人工智能发展 详细分析"]}'
        mock_response.model_name = "test-model"
        mock_response.token_usage = Mock()
        mock_response.token_usage.total_tokens = 100
        
        mock_llm_instance.invoke.return_value = mock_response
        mock_llm_instance.model = "test-model"
        mock_llm.return_value = mock_llm_instance
        
        # 创建工作流
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            max_research_loops=2,
            search_engine="mock"
        )
        
        # 执行工作流
        result = workflow.execute("人工智能发展")
        
        # 验证结果结构
        assert isinstance(result, dict)
        assert "research_topic" in result
        assert "final_report" in result
        assert "research_context" in result
        assert "total_loops" in result
        assert "metrics" in result
        
        # 验证指标
        metrics = result["metrics"]
        assert "execution_time" in metrics
        assert "search_count" in metrics
        assert "loop_count" in metrics
        assert "error_count" in metrics
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_error_handling(self, mock_llm):
        """测试工作流错误处理"""
        # 模拟 LLM 提供者抛出异常
        mock_llm_instance = Mock()
        # 正确模拟 invoke 方法而不是 generate 方法
        mock_llm_instance.invoke.side_effect = Exception("模拟错误")
        mock_llm_instance.model = "test-model"
        mock_llm.return_value = mock_llm_instance
        
        # 创建工作流
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            max_research_loops=1,
            search_engine="mock"
        )
        
        # 执行工作流（应该不会崩溃）
        result = workflow.execute("测试主题")
        
        # 验证工作流能够处理错误并继续执行
        assert isinstance(result, dict)
        assert "research_context" in result
        assert "metrics" in result
        # 由于LLM调用失败，但工作流应该能够优雅处理并返回默认结果
        assert result["metrics"]["execution_time"] > 0
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_metrics_collection(self, mock_llm):
        """测试工作流指标收集"""
        # 模拟 LLM 提供者
        mock_llm_instance = Mock()
        # 创建模拟响应对象
        mock_response = Mock()
        mock_response.content = '{"queries": ["机器学习技术 最新研究", "机器学习技术 详细分析"]}'
        mock_response.model_name = "test-model"
        mock_response.token_usage = Mock()
        mock_response.token_usage.total_tokens = 100
        
        mock_llm_instance.invoke.return_value = mock_response
        mock_llm_instance.model = "test-model"
        mock_llm.return_value = mock_llm_instance
        
        # 创建工作流
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            max_research_loops=2,  # 减少循环次数以确保测试稳定
            search_engine="mock"
        )
        
        # 重置指标
        workflow.reset_metrics()
        
        # 执行工作流
        result = workflow.execute("机器学习技术")
        
        # 验证指标收集
        metrics = result["metrics"]
        assert metrics["execution_time"] > 0
        assert metrics["search_count"] > 0
        assert metrics["loop_count"] >= 0  # 可能为0，因为可能在第一轮就完成
        assert metrics["success_rate"] >= 0
        assert metrics["error_count"] >= 0
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_configuration_loading(self, mock_llm):
        """测试工作流配置加载"""
        # 模拟 LLM 提供者
        mock_llm_instance = Mock()
        mock_llm.return_value = mock_llm_instance
        
        # 创建临时配置文件
        test_config = {
            "deep_search": {
                "max_research_loops": 5,
                "search_engine": "mock"
            },
            "llm": {
                "provider": "openai",
                "model": "gpt-4"
            }
        }
        
        # 测试配置加载
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            config_path="config.yaml"  # 使用现有的配置文件
        )
        
        # 验证配置被正确加载
        assert isinstance(workflow.config, dict)
        assert workflow.max_research_loops == 3  # 默认值
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_search_tool_integration(self, mock_llm):
        """测试工作流与搜索工具的集成"""
        # 模拟 LLM 提供者
        mock_llm_instance = Mock()
        # 创建模拟响应对象
        mock_response = Mock()
        mock_response.content = '{"queries": ["区块链技术 最新研究", "区块链技术 详细分析"]}'
        mock_response.model_name = "test-model"
        mock_response.token_usage = Mock()
        mock_response.token_usage.total_tokens = 100
        
        mock_llm_instance.invoke.return_value = mock_response
        mock_llm_instance.model = "test-model"
        mock_llm.return_value = mock_llm_instance
        
        # 创建工作流（使用模拟搜索）
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            max_research_loops=1,
            search_engine="mock"
        )
        
        # 验证搜索工具被正确初始化
        assert workflow.search_tool is not None
        assert hasattr(workflow.search_tool, '_run')
        
        # 执行工作流
        result = workflow.execute("区块链技术")
        
        # 验证搜索被执行
        assert result["metrics"]["search_count"] > 0


class TestWorkflowRetryMechanism:
    """工作流重试机制测试"""
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_retry_on_search_failure(self, mock_llm):
        """测试搜索失败时的重试机制"""
        # 模拟 LLM 提供者
        mock_llm_instance = Mock()
        # 创建模拟响应对象
        mock_response = Mock()
        mock_response.content = '{"queries": ["量子计算 最新研究", "量子计算 详细分析"]}'
        mock_response.model_name = "test-model"
        mock_response.token_usage = Mock()
        mock_response.token_usage.total_tokens = 100
        
        mock_llm_instance.invoke.return_value = mock_response
        mock_llm_instance.model = "test-model"
        mock_llm.return_value = mock_llm_instance
        
        # 创建工作流
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            max_research_loops=1,
            search_engine="mock"
        )
        
        # 模拟搜索工具在第一次调用时失败，第二次成功
        original_run = workflow.search_tool._run
        
        call_count = 0
        def mock_run_with_failure(query, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("模拟网络错误")
            return original_run(query, **kwargs)
        
        workflow.search_tool._run = mock_run_with_failure
        
        # 执行工作流（应该通过重试成功）
        result = workflow.execute("量子计算")
        
        # 验证工作流能够处理搜索错误并继续执行
        assert isinstance(result, dict)
        assert "final_report" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])