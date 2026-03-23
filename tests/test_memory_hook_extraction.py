"""Test MemoryHook fact extraction.

Author: Damon Li
"""

from agenticx.runtime.hooks.memory_hook import MemoryHook


def test_extract_facts_captures_memory_request():
    hook = MemoryHook()
    chat_history = [
        {"role": "user", "content": "帮我记住火山方舟的codingplan入口在开通管理Tab下面"},
        {"role": "assistant", "content": "好的，火山方舟 Coding Plan 入口：控制台 → 开通管理 → Coding Plan。URL: https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement"},
        {"role": "user", "content": "谢谢"},
        {"role": "assistant", "content": "不客气，已记录。"},
    ]
    facts = hook._extract_facts_heuristic(chat_history)
    assert len(facts) >= 1
    assert any("记住" in f or "火山" in f for f in facts)


def test_extract_facts_captures_assistant_url():
    hook = MemoryHook()
    chat_history = [
        {"role": "user", "content": "查一下火山方舟的控制台地址"},
        {"role": "assistant", "content": "火山方舟控制台地址: https://console.volcengine.com/ark/ ，进入后可在左侧找到模型管理。"},
        {"role": "user", "content": "好的"},
        {"role": "assistant", "content": "还有什么需要帮助的吗？"},
    ]
    facts = hook._extract_facts_heuristic(chat_history)
    assert len(facts) >= 1
    assert any("https" in f or "volcengine" in f for f in facts)


def test_extract_facts_captures_outcomes():
    hook = MemoryHook()
    chat_history = [
        {"role": "user", "content": "查一下当前项目的测试覆盖率"},
        {"role": "assistant", "content": "当前测试覆盖率为 87.3%，共 142 个测试用例全部通过。"},
        {"role": "user", "content": "不错"},
        {"role": "assistant", "content": "覆盖率良好，建议关注 memory 模块的边界用例。"},
    ]
    facts = hook._extract_facts_heuristic(chat_history)
    assert len(facts) >= 1


def test_extract_facts_skips_short_content():
    hook = MemoryHook()
    chat_history = [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "你好"},
    ]
    facts = hook._extract_facts_heuristic(chat_history)
    assert len(facts) == 0
