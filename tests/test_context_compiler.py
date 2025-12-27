"""
Context Compiler 冒烟测试（增强版）

测试 ADK "Compiled View" 机制在 AgenticX 中的实现。

测试覆盖：
1. CompactedEvent 数据模型
2. CompactionConfig 配置
3. EventLog 压缩辅助方法
4. CompiledContextRenderer 逆序编译
5. SimpleEventSummarizer
6. ContextCompiler 核心逻辑
7. Token 计数器（TokenCounter）
8. 多策略压缩
9. 可观测性功能
"""

import pytest
import asyncio
from datetime import datetime, timezone, timedelta
from typing import List

# 导入待测试的模块
from agenticx.core.event import (
    Event, EventLog, AnyEvent,
    TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent,
    ErrorEvent, LLMCallEvent, LLMResponseEvent, FinishTaskEvent,
    CompactedEvent, CompactionConfig
)
from agenticx.core.prompt import CompiledContextRenderer
from agenticx.core.context_compiler import (
    ContextCompiler, SimpleEventSummarizer, create_context_compiler,
    create_mining_compiler, DEFAULT_COMPACTION_PROMPT, MINING_TASK_PROMPT,
    PROMPT_TEMPLATES, CompactionStrategy
)
from agenticx.core.token_counter import (
    TokenCounter, TokenStats, ModelFamily,
    count_tokens, estimate_cost, truncate_text
)
from agenticx.core.agent import Agent
from agenticx.core.task import Task


# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def sample_agent():
    """创建测试用 Agent"""
    return Agent(
        name="TestAgent",
        role="Test Role",
        goal="Test Goal",
        backstory="Test Backstory",
        organization_id="org-test-001"
    )


@pytest.fixture
def sample_task():
    """创建测试用 Task"""
    return Task(
        description="Test task description",
        expected_output="Expected output",
        context={"info": "Additional context"}
    )


@pytest.fixture
def empty_event_log():
    """创建空的 EventLog"""
    return EventLog(agent_id="agent-1", task_id="task-1")


@pytest.fixture
def populated_event_log():
    """创建包含多个事件的 EventLog"""
    event_log = EventLog(agent_id="agent-1", task_id="task-1")
    
    base_time = datetime.now(timezone.utc)
    
    # 添加一系列事件
    events = [
        TaskStartEvent(
            task_description="Mining task",
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time
        ),
        ToolCallEvent(
            tool_name="search",
            tool_args={"query": "test"},
            intent="Search for information",
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time + timedelta(seconds=1)
        ),
        ToolResultEvent(
            tool_name="search",
            success=True,
            result="Found 10 results",
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time + timedelta(seconds=2)
        ),
        LLMCallEvent(
            prompt="Analyze results",
            model="gpt-4",
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time + timedelta(seconds=3)
        ),
        LLMResponseEvent(
            response="Analysis complete",
            token_usage={"total_tokens": 100},
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time + timedelta(seconds=4)
        ),
        ToolCallEvent(
            tool_name="write_file",
            tool_args={"path": "output.txt"},
            intent="Save results",
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time + timedelta(seconds=5)
        ),
        ToolResultEvent(
            tool_name="write_file",
            success=False,
            error="Permission denied",
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time + timedelta(seconds=6)
        ),
        ErrorEvent(
            error_type="permission_error",
            error_message="Cannot write to file",
            recoverable=True,
            agent_id="agent-1",
            task_id="task-1",
            timestamp=base_time + timedelta(seconds=7)
        ),
    ]
    
    for event in events:
        event_log.append(event)
    
    return event_log


# =============================================================================
# 1. CompactedEvent 数据模型测试
# =============================================================================

class TestCompactedEvent:
    """测试 CompactedEvent 数据模型"""
    
    def test_create_compacted_event(self):
        """测试创建 CompactedEvent"""
        event = CompactedEvent(
            summary="This is a summary of 5 events.",
            start_timestamp=1000.0,
            end_timestamp=2000.0,
            compressed_event_ids=["e1", "e2", "e3", "e4", "e5"],
            token_count_before=500,
            token_count_after=100
        )
        
        assert event.type == "compacted"
        assert event.summary == "This is a summary of 5 events."
        assert event.start_timestamp == 1000.0
        assert event.end_timestamp == 2000.0
        assert len(event.compressed_event_ids) == 5
        assert event.token_count_before == 500
        assert event.token_count_after == 100
    
    def test_compression_ratio(self):
        """测试压缩率计算"""
        event = CompactedEvent(
            summary="Summary",
            start_timestamp=1000.0,
            end_timestamp=2000.0,
            token_count_before=1000,
            token_count_after=200
        )
        
        ratio = event.get_compression_ratio()
        assert ratio == 0.2  # 200/1000 = 0.2
    
    def test_compression_ratio_zero_before(self):
        """测试 token_count_before 为 0 时的压缩率"""
        event = CompactedEvent(
            summary="Summary",
            start_timestamp=1000.0,
            end_timestamp=2000.0,
            token_count_before=0,
            token_count_after=100
        )
        
        ratio = event.get_compression_ratio()
        assert ratio == 1.0  # 默认返回 1.0
    
    def test_covers_event(self):
        """测试事件覆盖判断"""
        compacted = CompactedEvent(
            summary="Summary",
            start_timestamp=1000.0,
            end_timestamp=2000.0
        )
        
        # 创建在范围内的事件
        inside_event = TaskStartEvent(
            task_description="Test",
            timestamp=datetime.fromtimestamp(1500.0, tz=timezone.utc)
        )
        
        # 创建在范围外的事件
        outside_event = TaskStartEvent(
            task_description="Test",
            timestamp=datetime.fromtimestamp(3000.0, tz=timezone.utc)
        )
        
        assert compacted.covers_event(inside_event) == True
        assert compacted.covers_event(outside_event) == False


# =============================================================================
# 2. CompactionConfig 配置测试
# =============================================================================

class TestCompactionConfig:
    """测试 CompactionConfig 配置"""
    
    def test_default_config(self):
        """测试默认配置"""
        config = CompactionConfig()
        
        assert config.enabled == True
        assert config.compaction_interval == 10
        assert config.overlap_size == 2
        assert config.max_context_tokens == 8000
        assert config.summarizer_model is None
        assert config.summarizer_prompt is None
    
    def test_custom_config(self):
        """测试自定义配置"""
        config = CompactionConfig(
            enabled=False,
            compaction_interval=5,
            overlap_size=1,
            max_context_tokens=4000,
            summarizer_model="gpt-3.5-turbo"
        )
        
        assert config.enabled == False
        assert config.compaction_interval == 5
        assert config.overlap_size == 1
        assert config.max_context_tokens == 4000
        assert config.summarizer_model == "gpt-3.5-turbo"


# =============================================================================
# 3. EventLog 压缩辅助方法测试
# =============================================================================

class TestEventLogCompactionHelpers:
    """测试 EventLog 的压缩辅助方法"""
    
    def test_get_last_compaction_empty(self, empty_event_log):
        """测试空 EventLog 获取最后压缩事件"""
        assert empty_event_log.get_last_compaction() is None
    
    def test_get_last_compaction_no_compaction(self, populated_event_log):
        """测试无压缩事件时获取最后压缩事件"""
        assert populated_event_log.get_last_compaction() is None
    
    def test_get_last_compaction_with_compaction(self, populated_event_log):
        """测试有压缩事件时获取最后压缩事件"""
        compacted = CompactedEvent(
            summary="Test summary",
            start_timestamp=1000.0,
            end_timestamp=2000.0
        )
        populated_event_log.append(compacted)
        
        result = populated_event_log.get_last_compaction()
        assert result is not None
        assert result.summary == "Test summary"
    
    def test_get_events_since_last_compaction(self, populated_event_log):
        """测试获取最后压缩以来的事件"""
        # 无压缩时，返回所有非压缩事件
        events = populated_event_log.get_events_since_last_compaction()
        assert len(events) == 8  # 与 populated_event_log 中的事件数一致
    
    def test_get_compaction_count(self, populated_event_log):
        """测试获取压缩事件数量"""
        assert populated_event_log.get_compaction_count() == 0
        
        # 添加压缩事件
        populated_event_log.append(CompactedEvent(
            summary="S1", start_timestamp=1000.0, end_timestamp=2000.0
        ))
        populated_event_log.append(CompactedEvent(
            summary="S2", start_timestamp=2000.0, end_timestamp=3000.0
        ))
        
        assert populated_event_log.get_compaction_count() == 2
    
    def test_estimate_token_count(self, populated_event_log):
        """测试 token 估算"""
        token_count = populated_event_log.estimate_token_count()
        assert token_count > 0  # 应该有一些 token
    
    def test_should_compact_disabled(self, populated_event_log):
        """测试禁用压缩时的判断"""
        config = CompactionConfig(enabled=False)
        assert populated_event_log.should_compact(config) == False
    
    def test_should_compact_by_interval(self, populated_event_log):
        """测试按事件数触发压缩"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=5  # 8 个事件 >= 5，应触发
        )
        assert populated_event_log.should_compact(config) == True
    
    def test_should_compact_not_enough_events(self, populated_event_log):
        """测试事件数不足时不触发压缩"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=20  # 8 个事件 < 20，不应触发
        )
        assert populated_event_log.should_compact(config) == False


# =============================================================================
# 4. CompiledContextRenderer 测试
# =============================================================================

class TestCompiledContextRenderer:
    """测试编译视图渲染器"""
    
    def test_render_empty_log(self, empty_event_log, sample_agent, sample_task):
        """测试渲染空 EventLog"""
        renderer = CompiledContextRenderer()
        result = renderer.render(empty_event_log, sample_agent, sample_task)
        
        assert "<agent_context>" in result
        assert "<task_context>" in result
        assert "<current_state>" in result
        assert "<execution_history>" not in result  # 空日志无执行历史
    
    def test_render_with_events(self, populated_event_log, sample_agent, sample_task):
        """测试渲染有事件的 EventLog"""
        renderer = CompiledContextRenderer()
        result = renderer.render(populated_event_log, sample_agent, sample_task)
        
        assert "<execution_history>" in result
        assert "<tool_call" in result
        assert "<tool_result" in result
        assert "<error" in result
    
    def test_render_with_compaction(self, populated_event_log, sample_agent, sample_task):
        """测试渲染包含压缩事件的 EventLog"""
        # 添加一个压缩事件，覆盖前几个事件
        base_time = datetime.now(timezone.utc)
        compacted = CompactedEvent(
            summary="Summary of initial events",
            start_timestamp=(base_time - timedelta(seconds=10)).timestamp(),
            end_timestamp=(base_time + timedelta(seconds=3)).timestamp(),  # 覆盖前4个事件
            compressed_event_ids=["e1", "e2", "e3", "e4"]
        )
        populated_event_log.append(compacted)
        
        renderer = CompiledContextRenderer()
        result = renderer.render(populated_event_log, sample_agent, sample_task)
        
        # 应该包含压缩摘要
        assert "<compacted_summary" in result
        assert "Summary of initial events" in result
    
    def test_compaction_stats(self, populated_event_log, sample_agent, sample_task):
        """测试压缩统计信息"""
        renderer = CompiledContextRenderer(include_stats=True)
        result = renderer.render(populated_event_log, sample_agent, sample_task)
        
        assert "<compaction_stats>" in result
        assert "<original_events>" in result
        assert "<compiled_events>" in result


# =============================================================================
# 5. SimpleEventSummarizer 测试
# =============================================================================

class TestSimpleEventSummarizer:
    """测试简单事件摘要器"""
    
    @pytest.mark.asyncio
    async def test_summarize_empty(self):
        """测试摘要空事件列表"""
        summarizer = SimpleEventSummarizer()
        result = await summarizer.summarize([])
        assert result == "No events."
    
    @pytest.mark.asyncio
    async def test_summarize_tool_events(self, populated_event_log):
        """测试摘要工具事件"""
        summarizer = SimpleEventSummarizer()
        events = populated_event_log.events
        result = await summarizer.summarize(events)
        
        assert "Period summary" in result
        assert "events" in result
        # 应该包含工具名称
        assert "search" in result or "write_file" in result
    
    @pytest.mark.asyncio
    async def test_summarize_with_errors(self, populated_event_log):
        """测试摘要包含错误的事件"""
        summarizer = SimpleEventSummarizer()
        events = populated_event_log.events
        result = await summarizer.summarize(events)
        
        # 应该提到错误
        assert "Error" in result or "error" in result


# =============================================================================
# 6. ContextCompiler 核心逻辑测试
# =============================================================================

class TestContextCompiler:
    """测试上下文编译器"""
    
    @pytest.mark.asyncio
    async def test_maybe_compact_not_needed(self, populated_event_log):
        """测试不需要压缩时的行为"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=20  # 阈值高于当前事件数
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        result = await compiler.maybe_compact(populated_event_log)
        assert result is None  # 不应触发压缩
    
    @pytest.mark.asyncio
    async def test_compact_events(self, populated_event_log):
        """测试执行压缩"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=5,  # 低阈值，触发压缩
            overlap_size=2
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        original_count = len(populated_event_log.events)
        result = await compiler.compact(populated_event_log)
        
        assert result is not None
        assert isinstance(result, CompactedEvent)
        assert result.summary != ""
        assert len(populated_event_log.events) == original_count + 1  # 新增了压缩事件
    
    @pytest.mark.asyncio
    async def test_compacted_event_added_to_log(self, populated_event_log):
        """测试压缩事件被添加到 EventLog"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=3
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        await compiler.compact(populated_event_log)
        
        last_compaction = populated_event_log.get_last_compaction()
        assert last_compaction is not None
        assert last_compaction.type == "compacted"
    
    @pytest.mark.asyncio
    async def test_multiple_compactions(self, populated_event_log):
        """测试多次压缩"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=3,
            overlap_size=1
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        # 第一次压缩
        result1 = await compiler.compact(populated_event_log)
        assert result1 is not None
        
        # 添加更多事件
        for i in range(5):
            populated_event_log.append(ToolCallEvent(
                tool_name=f"tool_{i}",
                tool_args={},
                intent=f"Intent {i}",
                timestamp=datetime.now(timezone.utc)
            ))
        
        # 第二次压缩
        result2 = await compiler.compact(populated_event_log)
        assert result2 is not None
        
        # 应该有两个压缩事件
        assert populated_event_log.get_compaction_count() == 2


# =============================================================================
# 7. 工厂函数测试
# =============================================================================

class TestFactoryFunction:
    """测试工厂函数"""
    
    def test_create_with_simple_summarizer(self):
        """测试创建使用简单摘要器的编译器"""
        compiler = create_context_compiler(
            llm_provider=None,
            use_simple_summarizer=True
        )
        
        assert compiler is not None
        assert isinstance(compiler.summarizer, SimpleEventSummarizer)
    
    def test_create_with_custom_config(self):
        """测试使用自定义配置创建编译器"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=15,
            overlap_size=3
        )
        compiler = create_context_compiler(config=config, use_simple_summarizer=True)
        
        assert compiler.config.compaction_interval == 15
        assert compiler.config.overlap_size == 3


# =============================================================================
# 8. 默认压缩提示词测试
# =============================================================================

class TestDefaultPrompt:
    """测试默认压缩提示词"""
    
    def test_prompt_contains_placeholder(self):
        """测试提示词包含占位符"""
        assert "{events}" in DEFAULT_COMPACTION_PROMPT
    
    def test_prompt_contains_requirements(self):
        """测试提示词包含要求说明"""
        assert "Requirements" in DEFAULT_COMPACTION_PROMPT
        assert "Preserve" in DEFAULT_COMPACTION_PROMPT or "preserve" in DEFAULT_COMPACTION_PROMPT


# =============================================================================
# 9. 集成测试
# =============================================================================

class TestIntegration:
    """集成测试"""
    
    @pytest.mark.asyncio
    async def test_full_workflow(self):
        """测试完整工作流：创建 -> 添加事件 -> 压缩 -> 渲染"""
        # 1. 创建 EventLog
        event_log = EventLog(agent_id="agent-1", task_id="task-1")
        
        # 2. 添加大量事件
        base_time = datetime.now(timezone.utc)
        for i in range(20):
            event_log.append(ToolCallEvent(
                tool_name=f"tool_{i % 5}",
                tool_args={"param": i},
                intent=f"Action {i}",
                timestamp=base_time + timedelta(seconds=i)
            ))
            event_log.append(ToolResultEvent(
                tool_name=f"tool_{i % 5}",
                success=i % 3 != 0,  # 每第3个失败
                result=f"Result {i}" if i % 3 != 0 else None,
                error=f"Error {i}" if i % 3 == 0 else None,
                timestamp=base_time + timedelta(seconds=i, milliseconds=500)
            ))
        
        # 3. 创建编译器并压缩
        config = CompactionConfig(
            enabled=True,
            compaction_interval=10,
            overlap_size=2
        )
        compiler = create_context_compiler(config=config, use_simple_summarizer=True)
        
        # 执行压缩
        compacted = await compiler.maybe_compact(event_log)
        assert compacted is not None
        
        # 4. 渲染上下文
        agent = Agent(name="TestAgent", role="Tester", goal="Test goal", organization_id="org-test-001")
        task = Task(description="Test task", expected_output="Output")
        
        renderer = CompiledContextRenderer()
        rendered = renderer.render(event_log, agent, task)
        
        # 5. 验证渲染结果
        assert "<compacted_summary" in rendered
        assert "<compaction_stats>" in rendered
        
        # 压缩后的事件数应该少于原始（在编译后的视图中）
        stats_lines = [l for l in rendered.split('\n') if 'compiled_events' in l]
        assert len(stats_lines) > 0


# =============================================================================
# 10. Token 计数器测试
# =============================================================================

class TestTokenCounter:
    """测试 Token 计数器"""
    
    def test_count_tokens_english(self):
        """测试英文文本的 token 计数"""
        counter = TokenCounter()
        text = "Hello, this is a test message."
        tokens = counter.count_tokens(text)
        assert tokens > 0
        assert tokens < len(text)  # token 数应该少于字符数
    
    def test_count_tokens_chinese(self):
        """测试中文文本的 token 计数"""
        counter = TokenCounter()
        text = "这是一段中文测试文本"
        tokens = counter.count_tokens(text)
        assert tokens > 0
    
    def test_count_tokens_empty(self):
        """测试空文本"""
        counter = TokenCounter()
        assert counter.count_tokens("") == 0
        assert counter.count_tokens(None) == 0
    
    def test_model_family_detection(self):
        """测试模型家族检测"""
        assert TokenCounter(model="gpt-4").model_family == ModelFamily.GPT4
        assert TokenCounter(model="gpt-4o").model_family == ModelFamily.GPT4O
        assert TokenCounter(model="gpt-3.5-turbo").model_family == ModelFamily.GPT35_TURBO
        assert TokenCounter(model="claude-3-sonnet").model_family == ModelFamily.CLAUDE
        assert TokenCounter(model="gemini-pro").model_family == ModelFamily.GEMINI
        assert TokenCounter(model="qwen-plus").model_family == ModelFamily.QWEN
        assert TokenCounter(model="deepseek-chat").model_family == ModelFamily.DEEPSEEK
        assert TokenCounter(model="unknown-model").model_family == ModelFamily.UNKNOWN
    
    def test_estimate_cost(self):
        """测试成本估算"""
        counter = TokenCounter(model="gpt-4")
        cost = counter.estimate_cost(input_tokens=1000, output_tokens=500)
        
        assert "input_cost_usd" in cost
        assert "output_cost_usd" in cost
        assert "total_cost_usd" in cost
        assert cost["total_tokens"] == 1500
    
    def test_truncate_to_token_limit(self):
        """测试文本截断"""
        counter = TokenCounter()
        long_text = "This is a very long text. " * 100
        
        truncated = counter.truncate_to_token_limit(long_text, max_tokens=50)
        truncated_tokens = counter.count_tokens(truncated)
        
        assert truncated_tokens <= 50
        assert truncated.endswith("...")
    
    def test_count_messages_tokens(self):
        """测试消息列表的 token 计数"""
        counter = TokenCounter()
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "Hello!"},
            {"role": "assistant", "content": "Hi there!"}
        ]
        
        tokens = counter.count_messages_tokens(messages)
        assert tokens > 0


class TestTokenStats:
    """测试 Token 统计收集器"""
    
    def test_record_and_summary(self):
        """测试记录和摘要"""
        stats = TokenStats()
        
        stats.record("Hello, how are you?", "I'm fine, thank you!")
        stats.record("What's the weather?", "It's sunny today.")
        
        summary = stats.get_summary()
        
        assert summary["total_calls"] == 2
        assert summary["total_input_tokens"] > 0
        assert summary["total_output_tokens"] > 0
    
    def test_reset(self):
        """测试重置"""
        stats = TokenStats()
        stats.record("Test input", "Test output")
        
        stats.reset()
        
        summary = stats.get_summary()
        assert summary["total_calls"] == 0


class TestConvenienceFunctions:
    """测试便捷函数"""
    
    def test_count_tokens_function(self):
        """测试 count_tokens 便捷函数"""
        tokens = count_tokens("Hello world")
        assert tokens > 0
    
    def test_estimate_cost_function(self):
        """测试 estimate_cost 便捷函数"""
        cost = estimate_cost(1000, 500, model="gpt-4")
        assert cost["total_cost_usd"] > 0
    
    def test_truncate_text_function(self):
        """测试 truncate_text 便捷函数"""
        long_text = "Hello world! " * 50
        truncated = truncate_text(long_text, max_tokens=20)
        assert len(truncated) < len(long_text)


# =============================================================================
# 11. 多策略压缩测试
# =============================================================================

class TestCompactionStrategies:
    """测试多策略压缩"""
    
    @pytest.mark.asyncio
    async def test_sliding_window_strategy(self, populated_event_log):
        """测试滑动窗口策略"""
        config = CompactionConfig(enabled=True, compaction_interval=5)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.SLIDING_WINDOW
        )
        
        result = await compiler.compact(populated_event_log)
        assert result is not None
    
    @pytest.mark.asyncio
    async def test_emergency_strategy(self, populated_event_log):
        """测试紧急压缩策略"""
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.EMERGENCY
        )
        
        result = await compiler.compact(populated_event_log)
        assert result is not None


# =============================================================================
# 12. Prompt 模板测试
# =============================================================================

class TestPromptTemplates:
    """测试 Prompt 模板"""
    
    def test_mining_prompt_exists(self):
        """测试挖掘任务 Prompt 存在"""
        assert "mining" in PROMPT_TEMPLATES
        assert "{events}" in MINING_TASK_PROMPT
    
    def test_mining_prompt_content(self):
        """测试挖掘任务 Prompt 内容"""
        assert "Failed Paths" in MINING_TASK_PROMPT or "FAILED" in MINING_TASK_PROMPT
        assert "Unexplored" in MINING_TASK_PROMPT or "unexplored" in MINING_TASK_PROMPT


# =============================================================================
# 13. 可观测性测试
# =============================================================================

class TestObservability:
    """测试可观测性功能"""
    
    @pytest.mark.asyncio
    async def test_compaction_stats(self, populated_event_log):
        """测试压缩统计"""
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        await compiler.compact(populated_event_log)
        stats = compiler.get_compaction_stats()
        
        assert stats["total_compactions"] == 1
        assert "average_compression_ratio" in stats
    
    @pytest.mark.asyncio
    async def test_compare_views(self, populated_event_log):
        """测试视图对比"""
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        # 先压缩
        await compiler.compact(populated_event_log)
        
        # 对比视图
        comparison = compiler.compare_views(populated_event_log)
        
        assert "original_view" in comparison
        assert "compiled_view" in comparison
        assert "savings" in comparison
        assert comparison["original_view"]["event_count"] > 0


# =============================================================================
# 14. 工厂函数测试
# =============================================================================

class TestFactoryFunctionsAdvanced:
    """测试高级工厂函数"""
    
    def test_create_mining_compiler(self):
        """测试创建挖掘任务专用编译器"""
        # 由于没有 LLM provider，这里只测试参数传递
        # 实际使用时需要传入 llm_provider
        config = CompactionConfig(
            enabled=True,
            compaction_interval=15,
            overlap_size=3
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            task_type="mining"
        )
        
        assert compiler.task_type == "mining"
        assert compiler.config.compaction_interval == 15
        assert compiler.config.overlap_size == 3
    
    def test_create_compiler_with_strategy(self):
        """测试使用不同策略创建编译器"""
        compiler = create_context_compiler(
            use_simple_summarizer=True,
            strategy=CompactionStrategy.EMERGENCY,
            task_type="mining"
        )
        
        assert compiler.strategy == CompactionStrategy.EMERGENCY
        assert compiler.task_type == "mining"


# =============================================================================
# 15. TIME_BASED 策略测试
# =============================================================================

class TestTimeBasedStrategy:
    """测试基于时间的压缩策略"""
    
    @pytest.fixture
    def time_spread_event_log(self, sample_agent, sample_task):
        """创建时间跨度较大的事件日志"""
        import time
        event_log = EventLog(agent_id=sample_agent.id, task_id=sample_task.id)
        
        # 模拟不同时间点的事件（跨越两个时间窗口）
        base_time = time.time() - 600  # 10 分钟前
        
        # 第一个时间窗口的事件（约 10 分钟前）
        for i in range(5):
            event = ToolCallEvent(
                tool_name=f"tool_{i}",
                tool_args={"arg": i},
                intent="test intent",
                agent_id=sample_agent.id,
                task_id=sample_task.id
            )
            event.timestamp = base_time + i * 10  # 每 10 秒一个事件
            event_log.append(event)
        
        # 第二个时间窗口的事件（最近）
        current_time = time.time()
        for i in range(5):
            event = ToolCallEvent(
                tool_name=f"recent_tool_{i}",
                tool_args={"arg": i},
                intent="recent intent",
                agent_id=sample_agent.id,
                task_id=sample_task.id
            )
            event.timestamp = current_time - 50 + i * 10
            event_log.append(event)
        
        return event_log
    
    @pytest.mark.asyncio
    async def test_time_based_strategy_groups_by_window(self, time_spread_event_log):
        """测试时间策略按窗口分组"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=3,
            time_window_seconds=300  # 5 分钟窗口
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.TIME_BASED
        )
        
        # 获取待压缩事件
        events_to_compact = compiler._time_based_events(time_spread_event_log)
        
        # 应该压缩较早的时间窗口，保留最近的窗口
        assert len(events_to_compact) > 0
        # 最近的事件（recent_tool_*）不应该被压缩
        recent_tool_names = [e.tool_name for e in events_to_compact if hasattr(e, 'tool_name')]
        assert not any('recent_tool' in name for name in recent_tool_names)
    
    @pytest.mark.asyncio
    async def test_time_based_single_window_no_compact(self, populated_event_log):
        """测试单窗口情况不压缩"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=3,
            time_window_seconds=3600  # 1 小时窗口（所有事件在同一窗口）
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.TIME_BASED
        )
        
        events_to_compact = compiler._time_based_events(populated_event_log)
        # 所有事件在同一时间窗口，不应该压缩
        assert len(events_to_compact) == 0


# =============================================================================
# 16. TOPIC_BASED 策略测试
# =============================================================================

class TestTopicBasedStrategy:
    """测试基于主题的压缩策略"""
    
    @pytest.fixture
    def mixed_topic_event_log(self, sample_agent, sample_task):
        """创建包含多种主题的事件日志"""
        event_log = EventLog(agent_id=sample_agent.id, task_id=sample_task.id)
        
        # 添加多组工具调用链
        for i in range(5):
            # 工具调用
            call_event = ToolCallEvent(
                tool_name=f"search_tool",
                tool_args={"query": f"query_{i}"},
                intent="search intent",
                agent_id=sample_agent.id,
                task_id=sample_task.id
            )
            event_log.append(call_event)
            
            # 工具结果
            result_event = ToolResultEvent(
                tool_name=f"search_tool",
                result=f"result_{i}",
                success=True,
                agent_id=sample_agent.id,
                task_id=sample_task.id
            )
            event_log.append(result_event)
        
        # 添加 LLM 交互
        for i in range(5):
            llm_call = LLMCallEvent(
                model="gpt-4",
                prompt=f"prompt_{i}",
                agent_id=sample_agent.id,
                task_id=sample_task.id
            )
            event_log.append(llm_call)
            
            llm_response = LLMResponseEvent(
                model="gpt-4",
                response=f"response_{i}",
                token_usage={"total_tokens": 100},
                agent_id=sample_agent.id,
                task_id=sample_task.id
            )
            event_log.append(llm_response)
        
        return event_log
    
    @pytest.mark.asyncio
    async def test_topic_based_groups_events(self, mixed_topic_event_log):
        """测试主题策略按类型分组"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=3,
            overlap_size=2
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.TOPIC_BASED
        )
        
        events_to_compact = compiler._topic_based_events(mixed_topic_event_log)
        
        # 应该有事件被选中压缩（完整的工具链或 LLM 交互）
        assert len(events_to_compact) > 0
    
    @pytest.mark.asyncio
    async def test_topic_based_preserves_incomplete_chains(self, sample_agent, sample_task):
        """测试主题策略保留未完成的工具调用"""
        event_log = EventLog(agent_id=sample_agent.id, task_id=sample_task.id)
        
        # 添加一个未完成的工具调用（只有 call，没有 result）
        incomplete_call = ToolCallEvent(
            tool_name="incomplete_tool",
            tool_args={"arg": "value"},
            intent="incomplete call",
            agent_id=sample_agent.id,
            task_id=sample_task.id
        )
        event_log.append(incomplete_call)
        
        config = CompactionConfig(
            enabled=True,
            compaction_interval=1
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.TOPIC_BASED
        )
        
        events_to_compact = compiler._topic_based_events(event_log)
        
        # 未完成的工具调用不应该被压缩
        incomplete_ids = [e.id for e in events_to_compact if hasattr(e, 'tool_name') and e.tool_name == "incomplete_tool"]
        assert len(incomplete_ids) == 0


# =============================================================================
# 17. HYBRID 策略测试
# =============================================================================

class TestHybridStrategy:
    """测试混合压缩策略"""
    
    @pytest.mark.asyncio
    async def test_hybrid_selects_sliding_window_for_simple_case(self, populated_event_log):
        """测试简单情况下混合策略选择滑动窗口"""
        config = CompactionConfig(
            enabled=True,
            compaction_interval=3,
            time_window_seconds=300
        )
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.HYBRID
        )
        
        events_to_compact = compiler._hybrid_events(populated_event_log)
        
        # 简单情况下应该能选择一种策略并返回事件
        # 具体选择哪种策略取决于事件特征
        assert isinstance(events_to_compact, list)
    
    @pytest.mark.asyncio
    async def test_hybrid_calculates_topic_diversity(self, sample_agent, sample_task):
        """测试主题多样性计算"""
        event_log = EventLog(agent_id=sample_agent.id, task_id=sample_task.id)
        
        # 添加多种类型的事件
        event_log.append(ToolCallEvent(
            tool_name="tool1", tool_args={}, intent="intent",
            agent_id=sample_agent.id, task_id=sample_task.id
        ))
        event_log.append(ToolResultEvent(
            tool_name="tool1", result="result", success=True,
            agent_id=sample_agent.id, task_id=sample_task.id
        ))
        event_log.append(ErrorEvent(
            error_type="TestError", error_message="test error",
            agent_id=sample_agent.id, task_id=sample_task.id
        ))
        event_log.append(LLMCallEvent(
            model="gpt-4", prompt="prompt",
            agent_id=sample_agent.id, task_id=sample_task.id
        ))
        
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.HYBRID
        )
        
        events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
        diversity = compiler._calculate_topic_diversity(events)
        
        # 多种事件类型应该有较高的多样性
        assert 0 <= diversity <= 1
        assert diversity > 0.5  # 4 种不同类型应该有较高多样性
    
    @pytest.mark.asyncio
    async def test_hybrid_zero_diversity_for_single_type(self, sample_agent, sample_task):
        """测试单一类型事件的多样性为 0"""
        event_log = EventLog(agent_id=sample_agent.id, task_id=sample_task.id)
        
        # 只添加一种类型的事件
        for i in range(5):
            event_log.append(ToolCallEvent(
                tool_name=f"tool_{i}", tool_args={}, intent="intent",
                agent_id=sample_agent.id, task_id=sample_task.id
            ))
        
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config,
            strategy=CompactionStrategy.HYBRID
        )
        
        events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
        diversity = compiler._calculate_topic_diversity(events)
        
        # 单一类型应该多样性为 0
        assert diversity == 0.0


# =============================================================================
# 18. CompactionConfig 新字段测试
# =============================================================================

class TestCompactionConfigExtended:
    """测试 CompactionConfig 扩展字段"""
    
    def test_time_window_seconds_default(self):
        """测试 time_window_seconds 默认值"""
        config = CompactionConfig()
        assert config.time_window_seconds == 300  # 5 分钟
    
    def test_time_window_seconds_custom(self):
        """测试 time_window_seconds 自定义值"""
        config = CompactionConfig(time_window_seconds=600)
        assert config.time_window_seconds == 600


# =============================================================================
# 19. 持久化测试
# =============================================================================

class TestPersistence:
    """测试压缩统计持久化功能"""
    
    @pytest.mark.asyncio
    async def test_export_stats_dict(self, populated_event_log):
        """测试导出统计到字典"""
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        # 执行压缩
        await compiler.compact(populated_event_log)
        
        # 导出（不保存文件）
        exported = compiler.export_stats()
        
        assert "version" in exported
        assert "config" in exported
        assert "statistics" in exported
        assert "history" in exported
        assert exported["statistics"]["total_compactions"] == 1
    
    @pytest.mark.asyncio
    async def test_export_import_stats(self, populated_event_log, tmp_path):
        """测试导出和导入统计"""
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler1 = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        # 执行压缩
        await compiler1.compact(populated_event_log)
        original_tokens_saved = compiler1.total_tokens_saved
        
        # 导出到文件
        export_path = tmp_path / "compaction_stats.json"
        compiler1.export_stats(str(export_path))
        
        assert export_path.exists()
        
        # 创建新的编译器并导入
        compiler2 = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        assert len(compiler2.compaction_history) == 0
        
        compiler2.import_stats(str(export_path))
        
        assert len(compiler2.compaction_history) == 1
        assert compiler2.total_tokens_saved == original_tokens_saved
    
    def test_import_nonexistent_file(self):
        """测试导入不存在的文件"""
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=CompactionConfig()
        )
        
        # 不应该抛出异常
        compiler.import_stats("/nonexistent/path/stats.json")
        
        # 历史应该仍然为空
        assert len(compiler.compaction_history) == 0
    
    @pytest.mark.asyncio
    async def test_reset_stats(self, populated_event_log):
        """测试重置统计"""
        config = CompactionConfig(enabled=True, compaction_interval=3)
        compiler = ContextCompiler(
            summarizer=SimpleEventSummarizer(),
            config=config
        )
        
        await compiler.compact(populated_event_log)
        assert len(compiler.compaction_history) > 0
        
        compiler.reset_stats()
        
        assert len(compiler.compaction_history) == 0
        assert compiler.total_tokens_saved == 0


# =============================================================================
# 20. 缓存优化测试
# =============================================================================

class TestCompiledContextRendererCache:
    """测试 CompiledContextRenderer 缓存优化"""
    
    def test_cache_hit(self, populated_event_log, sample_agent, sample_task):
        """测试缓存命中"""
        renderer = CompiledContextRenderer(enable_cache=True)
        
        # 第一次渲染（缓存未命中）
        result1 = renderer.render(populated_event_log, sample_agent, sample_task)
        stats1 = renderer.get_cache_stats()
        
        assert stats1["cache_misses"] == 1
        assert stats1["cache_hits"] == 0
        
        # 第二次渲染（相同事件，应该缓存命中）
        result2 = renderer.render(populated_event_log, sample_agent, sample_task)
        stats2 = renderer.get_cache_stats()
        
        assert stats2["cache_hits"] == 1
        assert result1 == result2
    
    def test_cache_miss_on_new_event(self, populated_event_log, sample_agent, sample_task):
        """测试添加新事件后缓存未命中"""
        renderer = CompiledContextRenderer(enable_cache=True)
        
        # 第一次渲染
        renderer.render(populated_event_log, sample_agent, sample_task)
        
        # 添加新事件
        new_event = ToolCallEvent(
            tool_name="new_tool",
            tool_args={"arg": "value"},
            intent="new intent",
            agent_id=sample_agent.id,
            task_id=sample_task.id
        )
        populated_event_log.append(new_event)
        
        # 第二次渲染（应该缓存未命中）
        renderer.render(populated_event_log, sample_agent, sample_task)
        stats = renderer.get_cache_stats()
        
        assert stats["cache_misses"] == 2
    
    def test_cache_disabled(self, populated_event_log, sample_agent, sample_task):
        """测试禁用缓存"""
        renderer = CompiledContextRenderer(enable_cache=False)
        
        renderer.render(populated_event_log, sample_agent, sample_task)
        renderer.render(populated_event_log, sample_agent, sample_task)
        
        stats = renderer.get_cache_stats()
        
        # 禁用缓存时，不应该有缓存统计
        assert stats["cache_enabled"] == False
        assert stats["cache_hits"] == 0
    
    def test_clear_cache(self, populated_event_log, sample_agent, sample_task):
        """测试清除缓存"""
        renderer = CompiledContextRenderer(enable_cache=True)
        
        renderer.render(populated_event_log, sample_agent, sample_task)
        renderer.render(populated_event_log, sample_agent, sample_task)  # 缓存命中
        
        stats_before = renderer.get_cache_stats()
        assert stats_before["cache_hits"] == 1
        
        renderer.clear_cache()
        
        renderer.render(populated_event_log, sample_agent, sample_task)  # 缓存未命中
        stats_after = renderer.get_cache_stats()
        
        # clear_cache 不重置统计，只清除缓存内容
        assert stats_after["cache_misses"] == 2


# =============================================================================
# 运行测试
# =============================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])

