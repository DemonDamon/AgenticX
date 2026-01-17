"""
Eigent 简单问题直接回答冒烟测试

测试问题复杂度判断和简单问题直接回答功能。
"""

import pytest # type: ignore
from unittest.mock import MagicMock, AsyncMock, patch

from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.workforce.workforce_pattern import WorkforcePattern


@pytest.fixture
def mock_llm_provider():
    """模拟 LLM 提供者"""
    provider = MagicMock()
    return provider


@pytest.fixture
def test_agents():
    """创建测试 Agents"""
    coordinator = Agent.fast_construct(
        name="Coordinator",
        role="coordinator",
        goal="Assign tasks",
        organization_id="test-org"
    )
    task_planner = Agent.fast_construct(
        name="TaskPlanner",
        role="planner",
        goal="Plan tasks",
        organization_id="test-org"
    )
    worker = Agent.fast_construct(
        name="Worker",
        role="worker",
        goal="Execute tasks",
        organization_id="test-org"
    )
    return coordinator, task_planner, [worker]


@pytest.mark.asyncio
async def test_is_simple_question_keyword_detection(test_agents, mock_llm_provider):
    """测试关键词快速检测简单问题"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # 测试简单问候
    assert await workforce.is_simple_question("Hello") is True
    assert await workforce.is_simple_question("Hi there") is True
    assert await workforce.is_simple_question("Thanks") is True
    assert await workforce.is_simple_question("Thank you") is True
    
    # 测试简单提问
    assert await workforce.is_simple_question("What is AI?") is True
    assert await workforce.is_simple_question("Who is Albert Einstein?") is True


@pytest.mark.asyncio
async def test_is_simple_question_llm_judgment(test_agents, mock_llm_provider):
    """测试 LLM 判断问题复杂度"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # Mock LLM 返回 "no"（简单问题）
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.return_value = {"result": "no"}
        
        result = await workforce.is_simple_question("This is a complex question that doesn't have keywords")
        
        assert result is True  # "no" means simple question


@pytest.mark.asyncio
async def test_is_complex_task_detection(test_agents, mock_llm_provider):
    """测试复杂任务检测"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # Mock LLM 返回 "yes"（复杂任务）
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.return_value = {"result": "yes"}
        
        result = await workforce.is_simple_question("Create a Python script to analyze data")
        
        assert result is False  # "yes" means complex task


@pytest.mark.asyncio
async def test_is_simple_question_with_context(test_agents, mock_llm_provider):
    """测试带对话上下文的问题判断"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    conversation_context = "Previous: User asked about AI"
    
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.return_value = {"result": "no"}
        
        result = await workforce.is_simple_question(
            "Tell me more",
            conversation_context=conversation_context
        )
        
        assert result is True
        # 验证上下文被传递
        call_args = mock_run.call_args
        task_arg = call_args[0][1]  # 第二个参数是 task
        assert "Previous: User asked about AI" in task_arg.description


@pytest.mark.asyncio
async def test_answer_simple_question(test_agents, mock_llm_provider):
    """测试直接回答简单问题"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.return_value = {"result": "AI stands for Artificial Intelligence"}
        
        answer = await workforce.answer_simple_question("What is AI?")
        
        assert "AI stands for Artificial Intelligence" in answer


@pytest.mark.asyncio
async def test_answer_simple_question_with_context(test_agents, mock_llm_provider):
    """测试带上下文的简单问题回答"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    conversation_context = "User: What is machine learning?\nAssistant: Machine learning is..."
    
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.return_value = {"result": "More details about ML"}
        
        answer = await workforce.answer_simple_question(
            "Tell me more",
            conversation_context=conversation_context
        )
        
        assert "More details about ML" in answer
        
        # 验证上下文被传递
        call_args = mock_run.call_args
        task_arg = call_args[0][1]
        assert "Machine learning is..." in task_arg.description


@pytest.mark.asyncio
async def test_is_simple_question_error_handling(test_agents, mock_llm_provider):
    """测试问题判断错误处理"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # Mock 抛出异常
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.side_effect = ValueError("LLM error")
        
        # 错误时应默认为复杂任务（安全降级）
        result = await workforce.is_simple_question("Some question")
        
        assert result is False


@pytest.mark.asyncio
async def test_answer_simple_question_error_handling(test_agents, mock_llm_provider):
    """测试简单问题回答错误处理"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # Mock 抛出异常
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.side_effect = ValueError("LLM error")
        
        answer = await workforce.answer_simple_question("What is AI?")
        
        # 应该返回错误提示
        assert "trouble generating a response" in answer
        assert "Error:" in answer


@pytest.mark.asyncio
async def test_chinese_simple_question_detection(test_agents, mock_llm_provider):
    """测试中文简单问题检测"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # 测试中文关键词
    assert await workforce.is_simple_question("你好") is True
    assert await workforce.is_simple_question("谢谢") is True
    assert await workforce.is_simple_question("什么是人工智能？") is True


@pytest.mark.asyncio
async def test_long_question_requires_llm_judgment(test_agents, mock_llm_provider):
    """测试长问题需要 LLM 判断"""
    coordinator, task_planner, workers = test_agents
    
    workforce = WorkforcePattern(
        coordinator_agent=coordinator,
        task_agent=task_planner,
        workers=workers,
        llm_provider=mock_llm_provider,
    )
    
    # 即使包含简单关键词，长问题也需要 LLM 判断
    long_question = "Hello, " + "A" * 100 + " what is the best approach?"
    
    with patch.object(workforce.task_executor, 'run') as mock_run:
        mock_run.return_value = {"result": "yes"}  # 复杂任务
        
        result = await workforce.is_simple_question(long_question)
        
        # 应该调用 LLM 而不是关键词匹配
        assert mock_run.called
        assert result is False  # 复杂任务
