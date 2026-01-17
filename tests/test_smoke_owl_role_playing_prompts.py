"""
OWL 角色扮演模式 Prompt 模板冒烟测试

验证 P0.2 功能点：
- User Agent Prompt 模板生成
- Assistant Agent Prompt 模板生成
- 任务上下文注入逻辑
"""

import pytest
from agenticx.collaboration.prompts.role_playing_prompts import RolePlayingPrompts


def test_user_prompt_generation():
    """测试 User Agent Prompt 生成"""
    task = "搜索 Python 最新版本并总结"
    prompt = RolePlayingPrompts.get_user_system_prompt(task)
    
    assert "RULES OF USER" in prompt
    assert "TASK_DONE" in prompt
    assert task in prompt
    assert "Instruction: [YOUR INSTRUCTION]" in prompt
    assert "Never flip roles" in prompt


def test_assistant_prompt_generation():
    """测试 Assistant Agent Prompt 生成"""
    task = "搜索 Python 最新版本并总结"
    prompt = RolePlayingPrompts.get_assistant_system_prompt(task)
    
    assert "RULES OF ASSISTANT" in prompt
    assert task in prompt
    assert "Solution: [YOUR_SOLUTION]" in prompt
    assert "Never flip roles" in prompt
    assert "Never instruct me" in prompt


def test_task_context_injection_not_done():
    """测试任务上下文注入（任务未完成）"""
    original_content = "I will search for Python version."
    task = "搜索 Python 最新版本"
    
    modified = RolePlayingPrompts.inject_task_context(original_content, task, is_task_done=False)
    
    assert original_content in modified
    assert task in modified
    assert "<auxiliary_information>" in modified
    assert "never say" in modified.lower() and "i will" in modified.lower()


def test_task_context_injection_done():
    """测试任务上下文注入（任务已完成）"""
    original_content = "I found Python 3.12.0"
    task = "搜索 Python 最新版本"
    
    modified = RolePlayingPrompts.inject_task_context(original_content, task, is_task_done=True)
    
    assert original_content in modified
    assert task in modified
    assert "final answer" in modified.lower()
    assert "<task>" in modified


def test_user_followup_injection():
    """测试 User Agent 后续指令提示注入"""
    original_content = "I have completed the search."
    task = "搜索 Python 最新版本"
    
    modified = RolePlayingPrompts.inject_user_followup(original_content, task)
    
    assert original_content in modified
    assert task in modified
    assert "next instruction" in modified.lower()
    assert "TASK_DONE" in modified


def test_prompt_contains_task():
    """测试 Prompt 中包含任务描述"""
    task = "处理 Excel 文件并提取数据"
    
    user_prompt = RolePlayingPrompts.get_user_system_prompt(task)
    assistant_prompt = RolePlayingPrompts.get_assistant_system_prompt(task)
    
    assert task in user_prompt
    assert task in assistant_prompt


def test_prompt_format_consistency():
    """测试 Prompt 格式一致性"""
    task = "测试任务"
    
    user_prompt = RolePlayingPrompts.get_user_system_prompt(task)
    assistant_prompt = RolePlayingPrompts.get_assistant_system_prompt(task)
    
    # 验证格式标记存在
    assert "=====" in user_prompt
    assert "=====" in assistant_prompt
    assert "<task>" in user_prompt
    assert "<tips>" in user_prompt
    assert "<tips>" in assistant_prompt


def test_empty_task_handling():
    """测试空任务处理"""
    task = ""
    
    user_prompt = RolePlayingPrompts.get_user_system_prompt(task)
    assistant_prompt = RolePlayingPrompts.get_assistant_system_prompt(task)
    
    # 即使任务为空，Prompt 也应该正常生成
    assert len(user_prompt) > 0
    assert len(assistant_prompt) > 0
    assert "<task></task>" in user_prompt or task in user_prompt
