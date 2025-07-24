#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
agenticx-for-deepsearch 基础测试
"""

import pytest
import os
import sys
from unittest.mock import Mock, patch
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.append(str(Path(__file__).parent.parent))

from agenticx import Agent, Task
from agents import QueryGeneratorAgent, ResearchSummarizerAgent
from tools import GoogleSearchTool, MockGoogleSearchTool
from workflows.deep_search_workflow import DeepSearchWorkflow
from agenticx.llms.litellm_provider import LiteLLMProvider


class TestAgentCreation:
    """智能体创建测试"""
    
    def test_agent_creation(self):
        """测试基础智能体创建"""
        agent = Agent(
            id="test_agent",
            name="测试智能体",
            role="测试助手",
            goal="执行测试任务",
            backstory="我是一个用于测试的智能体",
            organization_id="test"
        )
        
        assert agent.id == "test_agent"
        assert agent.name == "测试智能体"
        assert agent.role == "测试助手"
    
    def test_query_generator_agent(self):
        """测试查询生成智能体"""
        agent = QueryGeneratorAgent(organization_id="test")
        
        assert agent.id == "query_generator_agent"
        assert agent.name == "查询生成专家"
        assert agent.role == "Expert Search Query Formulator"
        assert len(agent.tool_names) == 0  # 该智能体不需要工具
    
    def test_research_summarizer_agent(self):
        """测试研究总结智能体"""
        agent = ResearchSummarizerAgent(organization_id="test")
        
        assert agent.id == "research_summarizer_agent"
        assert agent.name == "首席研究分析师"
        assert agent.role == "Chief Research Analyst"
        assert "google_search_tool" in agent.tool_names


class TestAgentFunctionality:
    """智能体功能测试"""
    
    def test_query_generator_prompts(self):
        """测试查询生成智能体的提示词生成"""
        agent = QueryGeneratorAgent()
        
        # 测试初始查询生成
        initial_prompt = agent.generate_initial_queries("人工智能发展", 3)
        assert "人工智能发展" in initial_prompt
        assert "JSON" in initial_prompt
        assert "queries" in initial_prompt
        
        # 测试后续查询生成
        followup_prompt = agent.generate_followup_queries(
            "人工智能发展", 
            "已有发现内容", 
            "知识空白内容", 
            2
        )
        assert "人工智能发展" in followup_prompt
        assert "已有发现内容" in followup_prompt
        assert "知识空白内容" in followup_prompt
    
    def test_research_summarizer_prompts(self):
        """测试研究总结智能体的提示词生成"""
        agent = ResearchSummarizerAgent()
        
        # 测试搜索和总结提示词
        search_prompt = agent.create_search_and_summarize_prompt("AI技术", "人工智能研究")
        assert "AI技术" in search_prompt
        assert "人工智能研究" in search_prompt
        assert "google_search_tool" in search_prompt
        
        # 测试反思提示词
        reflection_prompt = agent.create_reflection_prompt("AI研究", ["总结1", "总结2"])
        assert "AI研究" in reflection_prompt
        assert "总结1" in reflection_prompt
        assert "JSON" in reflection_prompt
        
        # 测试最终报告提示词
        report_prompt = agent.create_final_report_prompt("AI研究", ["总结1", "总结2"])
        assert "AI研究" in report_prompt
        assert "总结1" in report_prompt


class TestTools:
    """工具测试"""
    
    def test_mock_google_search_tool(self):
        """测试模拟Google搜索工具"""
        tool = MockGoogleSearchTool()
        
        # 测试工具基本信息
        assert tool.name == "google_search_tool"
        assert "Google Search API" in tool.description
        
        # 测试搜索功能
        results = tool._run("人工智能")
        assert isinstance(results, list)
        assert len(results) > 0
        
        for result in results:
            assert "title" in result
            assert "link" in result
            assert "snippet" in result
    
    @patch.dict(os.environ, {"GOOGLE_API_KEY": "test_key"})
    def test_google_search_tool_creation(self):
        """测试Google搜索工具创建"""
        tool = GoogleSearchTool(api_key="test_key")
        
        assert tool.name == "google_search_tool"
        assert "Google Search API" in tool.description


class TestWorkflow:
    """工作流测试"""
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_creation(self, mock_llm):
        """测试工作流创建"""
        mock_llm_instance = Mock()
        mock_llm.return_value = mock_llm_instance
        
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            max_research_loops=3,
            search_engine="mock"
        )
        
        assert workflow.max_research_loops == 3
        assert workflow.organization_id == "deepsearch"
        assert workflow.metrics["search_count"] == 0
        assert workflow.metrics["loop_count"] == 0
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_metrics(self, mock_llm):
        """测试工作流指标收集"""
        mock_llm_instance = Mock()
        mock_llm.return_value = mock_llm_instance
        
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            max_research_loops=2,
            search_engine="mock"
        )
        
        # 测试指标重置
        workflow.reset_metrics()
        metrics = workflow.get_metrics()
        
        assert metrics["execution_time"] == 0.0
        assert metrics["search_count"] == 0
        assert metrics["loop_count"] == 0
        assert metrics["error_count"] == 0
    
    @patch('agenticx.llms.litellm_provider.LiteLLMProvider')
    def test_workflow_config_loading(self, mock_llm):
        """测试工作流配置加载"""
        mock_llm_instance = Mock()
        mock_llm.return_value = mock_llm_instance
        
        # 测试默认配置
        workflow = DeepSearchWorkflow(
            llm_provider=mock_llm_instance,
            config_path="nonexistent.yaml"
        )
        
        # 应该使用默认配置
        assert isinstance(workflow.config, dict)


class TestTaskCreation:
    """任务创建测试"""
    
    def test_task_creation(self):
        """测试任务创建"""
        task = Task(
            id="test_task",
            description="这是一个测试任务",
            expected_output="测试结果"
        )
        
        assert task.id == "test_task"
        assert task.description == "这是一个测试任务"
        assert task.expected_output == "测试结果"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])