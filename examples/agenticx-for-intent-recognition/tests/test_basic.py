#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
agenticx-for-intent-recognition 基础测试
"""

import pytest
from agenticx import Agent, Task


def test_agent_creation():
    """测试智能体创建"""
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


def test_task_creation():
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
    pytest.main([__file__])