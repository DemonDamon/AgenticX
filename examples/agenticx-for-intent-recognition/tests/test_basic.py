#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
agenticx-for-intent-recognition 基础测试
"""

import unittest
from agenticx import Agent, Task


class TestBasic(unittest.TestCase):
    def test_agent_creation(self):
        """测试智能体创建"""
        agent = Agent(
            id="test_agent",
            name="测试智能体",
            role="测试助手",
            goal="执行测试任务",
            backstory="我是一个用于测试的智能体",
            organization_id="test"
        )
        
        self.assertEqual(agent.id, "test_agent")
        self.assertEqual(agent.name, "测试智能体")
        self.assertEqual(agent.role, "测试助手")


    def test_task_creation(self):
        """测试任务创建"""
        task = Task(
            id="test_task",
            description="这是一个测试任务",
            expected_output="测试结果"
        )
        
        self.assertEqual(task.id, "test_task")
        self.assertEqual(task.description, "这是一个测试任务")
        self.assertEqual(task.expected_output, "测试结果")


if __name__ == "__main__":
    unittest.main()