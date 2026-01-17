"""
CAMEL FailureAnalyzer 故障分析冒烟测试

验证 P0.4 功能点：
- FailureAnalyzer 类可正常创建
- analyze_failure() 方法可正常调用
- evaluate_quality() 方法可正常调用
- 故障分析准确性、推荐策略合理性
"""

import pytest
from unittest.mock import Mock
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.workforce import FailureAnalyzer, RecoveryStrategy
from agenticx.core.error_handler import ErrorHandler


@pytest.fixture
def task_agent():
    """创建测试用的 Task Agent"""
    return Agent.fast_construct(
        name="Task Planner",
        role="planner",
        goal="分析任务失败原因",
        organization_id="test-org"
    )


@pytest.fixture
def executor():
    """创建测试用的 AgentExecutor"""
    executor = Mock()
    executor.run = Mock(return_value={
        "success": True,
        "result": '{"reasoning": "Network error occurred", "recovery_strategy": "retry", "issues": ["Connection timeout"]}'
    })
    return executor


def test_failure_analyzer_creation(task_agent, executor):
    """测试 FailureAnalyzer 可正常创建"""
    analyzer = FailureAnalyzer(
        task_agent=task_agent,
        executor=executor,
    )
    
    assert analyzer is not None
    assert analyzer.task_agent.id == task_agent.id
    assert analyzer.error_handler is not None


def test_failure_analyzer_with_error_handler(task_agent, executor):
    """测试 FailureAnalyzer 可以接受自定义 ErrorHandler"""
    error_handler = ErrorHandler()
    analyzer = FailureAnalyzer(
        task_agent=task_agent,
        executor=executor,
        error_handler=error_handler,
    )
    
    assert analyzer.error_handler is error_handler


@pytest.mark.asyncio
async def test_analyze_failure_basic(task_agent, executor):
    """测试 analyze_failure() 基本功能"""
    analyzer = FailureAnalyzer(
        task_agent=task_agent,
        executor=executor,
    )
    
    task = Task(
        description="Test task",
        expected_output="Result"
    )
    
    result = await analyzer.analyze_failure(
        task=task,
        error_message="Connection timeout",
        failure_count=1,
    )
    
    from agenticx.collaboration.workforce import TaskAnalysisResult
    assert isinstance(result, TaskAnalysisResult)
    assert hasattr(result, "reasoning")
    assert hasattr(result, "recovery_strategy")


@pytest.mark.asyncio
async def test_evaluate_quality_basic(task_agent, executor):
    """测试 evaluate_quality() 基本功能"""
    analyzer = FailureAnalyzer(
        task_agent=task_agent,
        executor=executor,
    )
    
    # Mock executor 返回质量评估结果
    executor.run = Mock(return_value={
        "success": True,
        "result": '{"reasoning": "Quality is good", "quality_score": 85, "issues": [], "recovery_strategy": null}'
    })
    
    task = Task(
        description="Test task",
        expected_output="Result"
    )
    
    result = await analyzer.evaluate_quality(
        task=task,
        task_result="Task completed successfully",
    )
    
    assert hasattr(result, "quality_score") or result.get("quality_score") is not None


def test_error_classification(task_agent, executor):
    """测试错误分类功能"""
    analyzer = FailureAnalyzer(
        task_agent=task_agent,
        executor=executor,
    )
    
    # 测试网络错误分类
    error_exception = Exception("Connection timeout")
    category = analyzer.error_classifier.classify(error_exception)
    assert category == "network_error"
    
    # 测试工具错误分类
    error_exception = Exception("Tool execution failed")
    category = analyzer.error_classifier.classify(error_exception)
    assert category in ["tool_error", "unknown_error"]


@pytest.mark.asyncio
async def test_analyze_failure_with_config(task_agent, executor):
    """测试使用 FailureHandlingConfig 进行分析"""
    from agenticx.collaboration.workforce import FailureHandlingConfig
    
    config = FailureHandlingConfig(
        enabled_strategies=[RecoveryStrategy.RETRY, RecoveryStrategy.REPLAN],
        max_retries=3,
    )
    
    analyzer = FailureAnalyzer(
        task_agent=task_agent,
        executor=executor,
    )
    
    task = Task(
        description="Test task",
        expected_output="Result"
    )
    
    result = await analyzer.analyze_failure(
        task=task,
        error_message="Test error",
        failure_count=1,
        failure_handling_config=config,
    )
    
    # 验证结果结构
    assert hasattr(result, "reasoning") or result.get("reasoning") is not None
