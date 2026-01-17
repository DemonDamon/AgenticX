"""
CAMEL ToolCallingRecord 工具调用追踪冒烟测试

验证 P1.2 功能点：
- ToolCallingRecord 数据模型可正常创建
- ToolExecutor.execute() 中记录工具调用
- get_tool_calling_history() API 返回正确历史记录
"""

import pytest
from unittest.mock import Mock
from agenticx.tools.executor import ToolExecutor, ToolCallingRecord
from agenticx.tools.base import BaseTool


class MockTool(BaseTool):
    """模拟工具用于测试"""
    
    def __init__(self, name: str = "mock_tool", should_fail: bool = False):
        super().__init__(name=name, description="Mock tool for testing")
        self.should_fail = should_fail
    
    def _run(self, **kwargs):
        """实现抽象方法"""
        if self.should_fail:
            raise Exception("Tool execution failed")
        return {"result": "success", "kwargs": kwargs}


def test_tool_calling_record_model():
    """测试 ToolCallingRecord Pydantic 模型"""
    from datetime import datetime
    
    record = ToolCallingRecord(
        tool_name="test_tool",
        tool_args={"param1": "value1"},
        agent_id="agent_1",
        task_id="task_1",
        timestamp=datetime.now(),
        success=True,
        result="Result",
        execution_time=1.5,
        retry_count=0,
    )
    
    assert record.tool_name == "test_tool"
    assert record.tool_args == {"param1": "value1"}
    assert record.agent_id == "agent_1"
    assert record.task_id == "task_1"
    assert record.success is True
    assert record.execution_time == 1.5


def test_executor_records_tool_calls():
    """测试 ToolExecutor 记录工具调用"""
    executor = ToolExecutor()
    tool = MockTool(name="test_tool")
    
    result = executor.execute(
        tool=tool,
        agent_id="agent_1",
        task_id="task_1",
        param1="value1",
    )
    
    assert result.success is True
    
    # 验证记录已保存
    history = executor.get_tool_calling_history()
    assert len(history) == 1
    assert history[0].tool_name == "test_tool"
    assert history[0].agent_id == "agent_1"
    assert history[0].task_id == "task_1"
    assert history[0].success is True


def test_executor_records_failed_tool_calls():
    """测试 ToolExecutor 记录失败的工具调用"""
    executor = ToolExecutor(max_retries=0)  # 禁用重试
    tool = MockTool(name="failing_tool", should_fail=True)
    
    result = executor.execute(
        tool=tool,
        agent_id="agent_1",
        task_id="task_1",
    )
    
    assert result.success is False
    
    # 验证失败记录已保存
    history = executor.get_tool_calling_history()
    assert len(history) == 1
    assert history[0].tool_name == "failing_tool"
    assert history[0].success is False
    assert history[0].error is not None


def test_get_tool_calling_history_filtering():
    """测试工具调用历史过滤功能"""
    executor = ToolExecutor()
    
    # 执行多个工具调用
    tool1 = MockTool(name="tool_1")
    tool2 = MockTool(name="tool_2")
    
    executor.execute(tool=tool1, agent_id="agent_1", task_id="task_1")
    executor.execute(tool=tool2, agent_id="agent_1", task_id="task_2")
    executor.execute(tool=tool1, agent_id="agent_2", task_id="task_1")
    
    # 按 agent_id 过滤
    agent1_history = executor.get_tool_calling_history(agent_id="agent_1")
    assert len(agent1_history) == 2
    
    # 按 task_id 过滤
    task1_history = executor.get_tool_calling_history(task_id="task_1")
    assert len(task1_history) == 2
    
    # 按 tool_name 过滤
    tool1_history = executor.get_tool_calling_history(tool_name="tool_1")
    assert len(tool1_history) == 2
    
    # 组合过滤
    combined = executor.get_tool_calling_history(
        agent_id="agent_1",
        tool_name="tool_1"
    )
    assert len(combined) == 1


def test_get_tool_calling_history_limit():
    """测试工具调用历史数量限制"""
    executor = ToolExecutor()
    
    # 执行多个工具调用
    for i in range(150):
        tool = MockTool(name=f"tool_{i}")
        executor.execute(tool=tool, agent_id="agent_1", task_id="task_1")
    
    # 获取历史（默认限制 100）
    history = executor.get_tool_calling_history()
    assert len(history) == 100  # 应该返回最近的 100 条
    
    # 自定义限制
    limited_history = executor.get_tool_calling_history(limit=50)
    assert len(limited_history) == 50


def test_tool_calling_history_persistence():
    """测试工具调用历史在多次调用间保持"""
    executor = ToolExecutor()
    
    tool1 = MockTool(name="tool_1")
    executor.execute(tool=tool1, agent_id="agent_1", task_id="task_1")
    
    tool2 = MockTool(name="tool_2")
    executor.execute(tool=tool2, agent_id="agent_1", task_id="task_1")
    
    # 验证两条记录都存在
    history = executor.get_tool_calling_history()
    assert len(history) == 2
    assert history[0].tool_name == "tool_1"
    assert history[1].tool_name == "tool_2"
