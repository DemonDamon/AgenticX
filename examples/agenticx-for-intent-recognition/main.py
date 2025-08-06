#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
agenticx-for-intent-recognition - AgenticX项目
"""

import os
from agenticx import Agent, Task, AgentExecutor
from agenticx.llms import OpenAIProvider


def main():
    """主函数"""
    # 创建智能体
    agent = Agent(
        id="main_agent",
        name="主智能体",
        role="助手",
        goal="帮助用户完成任务",
        backstory="我是一个专业的AI助手",
        organization_id="default"
    )
    
    # 创建任务
    task = Task(
        id="main_task",
        description="请介绍一下自己",
        expected_output="简洁的自我介绍"
    )
    
    # 配置LLM
    llm = OpenAIProvider(
        model="gpt-4o-mini",
        api_key=os.getenv("OPENAI_API_KEY")
    )
    
    # 执行任务
    executor = AgentExecutor(agent=agent, llm=llm)
    result = executor.run(task)
    
    print(f"执行结果: {result}")


if __name__ == "__main__":
    main()