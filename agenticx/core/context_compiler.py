"""
Context Compiler (上下文编译器) - 增强版

参考自 Google ADK 的 "Compiled View" 机制。
核心思想：上下文不是事件的简单拼接，而是对 EventLog 的按需"编译"。

增强功能（v2）：
- 精确 Token 计数：使用 tiktoken 进行精确统计
- 多策略压缩：滑动窗口、主题分块、紧急压缩等
- 挖掘任务专用 Prompt：保留失败路径和探索线索
- 可观测性：原始视图 vs 编译视图对照
"""

from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any, Callable, Literal
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
import logging
import math
import json

from .event import (
    EventLog, AnyEvent, CompactedEvent, CompactionConfig,
    ToolCallEvent, ToolResultEvent, ErrorEvent, LLMCallEvent, LLMResponseEvent,
    TaskStartEvent, TaskEndEvent, FinishTaskEvent, HumanRequestEvent, HumanResponseEvent
)
from .token_counter import TokenCounter, TokenStats, count_tokens
from .overflow_recovery import OverflowRecoveryConfig, OverflowRecoveryPipeline

logger = logging.getLogger(__name__)


# =============================================================================
# 压缩策略枚举
# =============================================================================

class CompactionStrategy(str, Enum):
    """压缩策略"""
    SLIDING_WINDOW = "sliding_window"    # 滑动窗口（默认）
    TOPIC_BASED = "topic_based"          # 按主题分块
    TIME_BASED = "time_based"            # 按时间窗口
    EMERGENCY = "emergency"              # 紧急压缩（超过 token 阈值时）
    HYBRID = "hybrid"                    # 混合策略


# =============================================================================
# 专用 Prompt 模板库
# =============================================================================

# 默认通用 Prompt
DEFAULT_COMPACTION_PROMPT = """You are a context summarizer for an AI agent system. Your job is to compress a sequence of events into a concise summary while preserving critical information.

## Events to Summarize
{events}

## Requirements
1. Preserve key information:
   - What tools were called and their results (especially errors and failures)
   - Important decisions made by the agent
   - Any user inputs or human feedback
   - Critical state changes

2. Be concise but complete. Aim for 30-50% compression ratio.

3. Use structured format:
   - Start with a one-sentence overall summary
   - List key actions and their outcomes
   - Note any important lessons learned

## Output
Provide your summary directly, without any preamble."""


# 智能体自动挖掘专用 Prompt（优化版）
MINING_TASK_PROMPT = """You are summarizing the execution history of an AI agent performing an **automatic exploration/mining task**.

## Events to Summarize
{events}

## Critical Requirements for Mining Tasks

### 1. MUST Preserve (Critical for avoiding repeated failures):
- **Failed Paths**: List every approach that was tried and failed, with reasons
- **Dead Ends**: Resources/APIs/methods that were found to be unusable
- **Error Patterns**: Common error types encountered and their triggers
- **Blocked Directions**: Paths that were explicitly blocked or rate-limited

### 2. MUST Preserve (Critical for continued exploration):
- **Discovered Patterns**: Any patterns or insights found during exploration
- **Successful Techniques**: Methods that worked, even partially
- **Unexplored Leads**: Promising directions not yet fully investigated
- **Resource States**: Current status of external resources (APIs, files, etc.)

### 3. Progress Tracking:
- Overall exploration coverage estimate (e.g., "~40% of potential paths explored")
- Priority ranking for remaining directions
- Key milestones achieved

## Output Format
```
📊 EXPLORATION SUMMARY
[One-sentence progress summary]

❌ TRIED & FAILED:
- [path/method]: [why it failed]
- ...

✅ WORKING APPROACHES:
- [method]: [what worked and results]
- ...

🔍 UNEXPLORED LEADS:
- [direction]: [priority: high/medium/low]
- ...

⚠️ IMPORTANT NOTES:
- [any critical warnings or constraints]
```

Provide your summary now:"""


# 对话历史压缩 Prompt
CONVERSATION_PROMPT = """Summarize this conversation history between a user and an AI agent.

## Conversation Events
{events}

## Requirements
1. Preserve the key topics discussed
2. Keep important user requests and agent responses
3. Maintain the logical flow of the conversation
4. Note any unresolved questions or pending tasks

## Output
A concise summary that would allow the conversation to continue seamlessly."""


# 工具执行序列压缩 Prompt
TOOL_SEQUENCE_PROMPT = """Summarize this sequence of tool executions.

## Tool Events
{events}

## Requirements
1. Group related tool calls together
2. Highlight successes and failures
3. Note any patterns or dependencies between tools
4. Preserve error details for failed calls

## Output
A structured summary of what tools were used and their outcomes."""


# Prompt 模板映射
PROMPT_TEMPLATES = {
    "default": DEFAULT_COMPACTION_PROMPT,
    "mining": MINING_TASK_PROMPT,
    "conversation": CONVERSATION_PROMPT,
    "tool_sequence": TOOL_SEQUENCE_PROMPT,
}


# =============================================================================
# 事件摘要器
# =============================================================================

class EventSummarizer(ABC):
    """
    事件摘要生成器的抽象基类。
    """
    
    @abstractmethod
    async def summarize(
        self, 
        events: List[AnyEvent], 
        prompt_template: Optional[str] = None,
        task_type: Optional[str] = None
    ) -> str:
        """
        生成事件列表的摘要。
        
        Args:
            events: 需要摘要的事件列表。
            prompt_template: 自定义的提示词模板（可选）。
            task_type: 任务类型，用于选择专用 Prompt（如 'mining'）。
            
        Returns:
            摘要文本。
        """
        pass


class LLMEventSummarizer(EventSummarizer):
    """
    基于 LLM 的事件摘要生成器。
    
    使用 LLM 来理解事件语义并生成高质量摘要。
    """
    
    def __init__(
        self, 
        llm_provider: Any,
        model: Optional[str] = None,
        default_task_type: str = "default",
        token_counter: Optional[TokenCounter] = None
    ):
        """
        Args:
            llm_provider: LLM 提供者实例。
            model: 指定的模型名称（可选）。
            default_task_type: 默认任务类型（用于选择 Prompt）。
            token_counter: Token 计数器（可选）。
        """
        self.llm_provider = llm_provider
        self.model = model
        self.default_task_type = default_task_type
        self.token_counter = token_counter or TokenCounter(model=model)
        self.stats = TokenStats(model=model)
    
    async def summarize(
        self, 
        events: List[AnyEvent], 
        prompt_template: Optional[str] = None,
        task_type: Optional[str] = None
    ) -> str:
        """使用 LLM 生成摘要。"""
        if not events:
            return "No events to summarize."
        
        # 将事件格式化为文本
        events_text = self._format_events_for_llm(events)
        
        # 选择 Prompt 模板
        if prompt_template:
            template = prompt_template
        else:
            task = task_type or self.default_task_type
            template = PROMPT_TEMPLATES.get(task, DEFAULT_COMPACTION_PROMPT)
        
        prompt = template.format(events=events_text)
        
        # 记录输入 token
        input_tokens = self.token_counter.count_tokens(prompt)
        logger.debug(f"Summarization prompt: {input_tokens} tokens")
        
        # 调用 LLM
        try:
            response = self.llm_provider.invoke([{"role": "user", "content": prompt}])
            summary = response.content
            
            # 记录统计
            self.stats.record(prompt, summary, {"event_count": len(events)})
            
            return summary
        except Exception as e:
            logger.error(f"LLM summarization failed: {e}")
            return self._fallback_summary(events)
    
    def _format_events_for_llm(self, events: List[AnyEvent]) -> str:
        """将事件列表格式化为 LLM 可读的文本。"""
        lines = []
        for i, event in enumerate(events, 1):
            line = self._format_single_event(event, i)
            if line:
                lines.append(line)
        return "\n".join(lines)
    
    def _format_single_event(self, event: AnyEvent, index: int) -> str:
        """格式化单个事件。"""
        if isinstance(event, ToolCallEvent):
            args_str = str(event.tool_args)[:100] + "..." if len(str(event.tool_args)) > 100 else str(event.tool_args)
            return f"{index}. [TOOL_CALL] {event.tool_name}({args_str}) - Intent: {event.intent}"
        elif isinstance(event, ToolResultEvent):
            status = "✓" if event.success else "✗"
            result = event.result if event.success else event.error
            result_str = str(result)[:200] + "..." if result and len(str(result)) > 200 else str(result)
            return f"{index}. [TOOL_RESULT] {event.tool_name} {status}: {result_str}"
        elif isinstance(event, ErrorEvent):
            return f"{index}. [ERROR] {event.error_type}: {event.error_message}"
        elif isinstance(event, LLMCallEvent):
            return f"{index}. [LLM_CALL] Model: {event.model}"
        elif isinstance(event, LLMResponseEvent):
            tokens = event.token_usage.get('total_tokens', 'N/A') if event.token_usage else 'N/A'
            response_preview = event.response[:200] + "..." if len(event.response) > 200 else event.response
            return f"{index}. [LLM_RESPONSE] Tokens: {tokens}, Preview: {response_preview}"
        elif isinstance(event, TaskStartEvent):
            return f"{index}. [TASK_START] {event.task_description}"
        elif isinstance(event, TaskEndEvent):
            return f"{index}. [TASK_END] Success: {event.success}"
        elif isinstance(event, FinishTaskEvent):
            result_str = str(event.final_result)[:200] + "..." if len(str(event.final_result)) > 200 else str(event.final_result)
            return f"{index}. [FINISH] Result: {result_str}"
        elif isinstance(event, HumanRequestEvent):
            return f"{index}. [HUMAN_REQUEST] {event.question}"
        elif isinstance(event, HumanResponseEvent):
            return f"{index}. [HUMAN_RESPONSE] {event.response}"
        else:
            return f"{index}. [{event.type.upper()}] {event.data}"
    
    def _fallback_summary(self, events: List[AnyEvent]) -> str:
        """降级摘要：当 LLM 调用失败时使用。"""
        tool_calls = [e for e in events if isinstance(e, ToolCallEvent)]
        tool_results = [e for e in events if isinstance(e, ToolResultEvent)]
        errors = [e for e in events if isinstance(e, ErrorEvent)]
        
        parts = [f"📊 Summary of {len(events)} events"]
        
        if tool_calls:
            tools_used = set(e.tool_name for e in tool_calls)
            parts.append(f"Tools: {', '.join(sorted(tools_used))}")
        
        if tool_results:
            successes = sum(1 for e in tool_results if e.success)
            failures = len(tool_results) - successes
            parts.append(f"Results: {successes} success, {failures} failures")
        
        if errors:
            parts.append(f"Errors: {len(errors)}")
            # 包含最后一个错误
            last_error = errors[-1]
            parts.append(f"Last error: {last_error.error_message[:100]}")
        
        return ". ".join(parts) + "."
    
    def get_stats(self) -> Dict[str, Any]:
        """获取摘要统计信息。"""
        return self.stats.get_summary()


class SimpleEventSummarizer(EventSummarizer):
    """
    简单的事件摘要生成器（不使用 LLM）。
    
    适用于测试或低成本场景。
    """
    
    async def summarize(
        self, 
        events: List[AnyEvent], 
        prompt_template: Optional[str] = None,
        task_type: Optional[str] = None
    ) -> str:
        """生成基于规则的简单摘要。"""
        if not events:
            return "No events."
        
        # 统计各类事件
        stats = {
            "tool_calls": 0,
            "tool_successes": 0,
            "tool_failures": 0,
            "errors": 0,
            "llm_calls": 0
        }
        
        tool_names = set()
        error_messages = []
        failed_tools = []
        
        for event in events:
            if isinstance(event, ToolCallEvent):
                stats["tool_calls"] += 1
                tool_names.add(event.tool_name)
            elif isinstance(event, ToolResultEvent):
                if event.success:
                    stats["tool_successes"] += 1
                else:
                    stats["tool_failures"] += 1
                    failed_tools.append(f"{event.tool_name}: {event.error}")
            elif isinstance(event, ErrorEvent):
                stats["errors"] += 1
                error_messages.append(event.error_message)
            elif isinstance(event, LLMCallEvent):
                stats["llm_calls"] += 1
        
        # 构建摘要
        parts = []
        parts.append(f"📊 Period summary ({len(events)} events)")
        
        if tool_names:
            parts.append(f"Tools: {', '.join(sorted(tool_names))}")
        
        if stats["tool_calls"] > 0:
            success_rate = stats["tool_successes"] / stats["tool_calls"] * 100
            parts.append(f"Tool calls: {stats['tool_calls']} ({success_rate:.0f}% success)")
        
        if failed_tools:
            parts.append(f"❌ Failed: {'; '.join(failed_tools[:3])}")
        
        if stats["errors"] > 0:
            parts.append(f"⚠️ Errors: {stats['errors']}")
            if error_messages:
                parts.append(f"Last error: {error_messages[-1][:100]}")
        
        return ". ".join(parts) + "."


# =============================================================================
# 快速启发式压缩器（参考自 DeerFlow ContextManager）
# =============================================================================

class FastHeuristicCompressor:
    """
    快速启发式压缩器（零 LLM 调用）。
    
    灵感来自 DeerFlow 的 ContextManager，用于紧急情况下的快速压缩。
    使用启发式 token 估算和截断策略，避免 LLM 调用开销。
    
    核心策略：
    1. 启发式 token 估算（英文 4 char/token，中文 1 char/token）
    2. 保留前缀消息（系统 prompts、初始目标）
    3. 从尾部添加消息直到达到 token 限制
    4. 单条消息过长时截断而非丢弃
    
    适用场景：
    - Token 即将溢出（紧急压缩）
    - 成本敏感型任务
    - 快速迭代开发/测试
    
    与 AgenticX ContextCompiler 的对比：
    - ContextCompiler: 语义摘要（LLM），保留关键信息，成本较高
    - FastHeuristicCompressor: 截断（无 LLM），速度快，成本零，可能丢失细节
    """
    
    def __init__(
        self, 
        token_limit: int = 8000,
        preserve_prefix_count: int = 2,
        max_message_tokens: int = 2000
    ):
        """
        Args:
            token_limit: Token 上限（超过此值触发压缩）
            preserve_prefix_count: 保留的前缀事件数量（通常是系统消息和初始目标）
            max_message_tokens: 单条消息的最大 token 数（超过则截断）
        """
        self.token_limit = token_limit
        self.preserve_prefix_count = preserve_prefix_count
        self.max_message_tokens = max_message_tokens
        logger.info(
            f"FastHeuristicCompressor initialized: "
            f"limit={token_limit}, preserve_prefix={preserve_prefix_count}"
        )
    
    def compress(self, event_log: EventLog) -> List[AnyEvent]:
        """
        快速压缩事件日志。
        
        策略：
        1. 保留前 N 个事件（prefix）
        2. 从尾部向前添加事件，直到达到 token 限制
        3. 返回压缩后的事件列表
        
        Args:
            event_log: 需要压缩的事件日志
            
        Returns:
            压缩后的事件列表
        """
        events = event_log.events
        
        if not events:
            return []
        
        # 1. 计算可用 token 预算
        available_tokens = self.token_limit
        
        # 2. 保留前缀事件（系统消息、初始目标等）
        prefix_count = min(self.preserve_prefix_count, len(events))
        prefix_events = events[:prefix_count]
        
        # 计算前缀消耗的 tokens
        for event in prefix_events:
            event_tokens = self._estimate_event_tokens(event)
            available_tokens -= event_tokens
        
        logger.debug(
            f"Preserved {prefix_count} prefix events, "
            f"remaining budget: {available_tokens} tokens"
        )
        
        # 3. 从尾部添加事件，直到达到限制
        suffix_events = []
        remaining_events = events[prefix_count:]
        
        for event in reversed(remaining_events):
            event_tokens = self._estimate_event_tokens(event)
            
            # 如果单条消息过长，截断而非完全丢弃
            if event_tokens > self.max_message_tokens:
                truncated_event = self._truncate_event(event, self.max_message_tokens)
                event_tokens = self._estimate_event_tokens(truncated_event)
                event = truncated_event
            
            if event_tokens <= available_tokens:
                suffix_events.insert(0, event)
                available_tokens -= event_tokens
            else:
                # Token 预算耗尽，停止添加
                break
        
        # 4. 合并前缀和后缀
        result = prefix_events + suffix_events
        
        # 日志记录压缩统计
        original_count = len(events)
        result_count = len(result)
        dropped_count = original_count - result_count
        
        logger.info(
            f"Fast compression: {original_count} -> {result_count} events "
            f"({dropped_count} dropped, {available_tokens} tokens remaining)"
        )
        
        return result
    
    def _estimate_event_tokens(self, event: AnyEvent) -> int:
        """
        启发式 token 估算（来自 DeerFlow）。
        
        规则：
        - 英文字符：4 char/token
        - 非英文字符（中文等）：1 char/token
        
        注意：这是近似估算，误差约 ±20%，但速度快（无需 tiktoken）
        
        Args:
            event: 事件对象
            
        Returns:
            估算的 token 数
        """
        # 将事件转换为字符串
        content = str(event.model_dump())
        
        # 统计英文和非英文字符
        english_chars = sum(1 for c in content if ord(c) < 128)
        non_english_chars = len(content) - english_chars
        
        # 计算 tokens（英文 4 char/token，中文 1 char/token）
        estimated_tokens = (english_chars // 4) + non_english_chars
        
        return max(1, estimated_tokens)  # 至少 1 token
    
    def _truncate_event(self, event: AnyEvent, max_tokens: int) -> AnyEvent:
        """
        截断单条事件内容。
        
        策略：保留事件的关键字段，截断较长的字段（如 result, response）
        
        Args:
            event: 原始事件
            max_tokens: 最大允许 token 数
            
        Returns:
            截断后的事件
        """
        # 复制事件数据
        event_data = event.model_dump()
        
        # 识别需要截断的长字段
        truncatable_fields = ["result", "response", "error", "description", "content"]
        
        for field in truncatable_fields:
            if field in event_data and isinstance(event_data[field], str):
                original_value = event_data[field]
                
                # 根据 token 限制计算允许的字符数
                # 保守估计：假设全英文（4 char/token）
                max_chars = max_tokens * 4
                
                if len(original_value) > max_chars:
                    truncated_value = original_value[:max_chars] + "... [truncated]"
                    event_data[field] = truncated_value
                    logger.debug(f"Truncated field '{field}': {len(original_value)} -> {len(truncated_value)} chars")
        
        # 重建事件对象
        event_type = type(event)
        try:
            truncated_event = event_type(**event_data)
            return truncated_event
        except Exception as e:
            logger.warning(f"Failed to rebuild truncated event: {e}, returning original")
            return event
    
    def estimate_total_tokens(self, events: List[AnyEvent]) -> int:
        """
        估算事件列表的总 token 数。
        
        Args:
            events: 事件列表
            
        Returns:
            估算的总 token 数
        """
        return sum(self._estimate_event_tokens(e) for e in events)
    
    def is_over_limit(self, events: List[AnyEvent]) -> bool:
        """
        判断事件列表是否超过 token 限制。
        
        Args:
            events: 事件列表
            
        Returns:
            True 如果超过限制
        """
        total = self.estimate_total_tokens(events)
        return total > self.token_limit
    
    def get_compression_ratio(self, original_events: List[AnyEvent], compressed_events: List[AnyEvent]) -> float:
        """
        计算压缩比率。
        
        Args:
            original_events: 原始事件列表
            compressed_events: 压缩后事件列表
            
        Returns:
            压缩比率（0-1，越小压缩越多）
        """
        original_tokens = self.estimate_total_tokens(original_events)
        compressed_tokens = self.estimate_total_tokens(compressed_events)
        
        if original_tokens == 0:
            return 1.0
        
        return compressed_tokens / original_tokens


# =============================================================================
# 上下文编译器（增强版）
# =============================================================================

class ContextCompiler:
    """
    上下文编译器：实现 EventLog 的智能压缩（增强版）。
    
    核心功能：
    1. 精确 Token 计数（使用 tiktoken）
    2. 多策略压缩支持
    3. 任务类型感知（针对挖掘任务优化）
    4. 可观测性增强
    
    设计原则（借鉴 ADK）：
    - 滑动窗口：使用 overlap 保持语义连续性
    - 按需编译：仅在必要时触发压缩
    - 渐进压缩：每次压缩固定数量的事件
    """
    
    def __init__(
        self,
        summarizer: Optional[EventSummarizer] = None,
        config: Optional[CompactionConfig] = None,
        strategy: CompactionStrategy = CompactionStrategy.SLIDING_WINDOW,
        task_type: str = "default",
        model: Optional[str] = None,
        enable_fast_fallback: bool = True,
        overflow_recovery_config: Optional[OverflowRecoveryConfig] = None,
        # Memory Flush Before Compaction (inspired by OpenClaw)
        flush_handler: Optional[Any] = None,
        flush_config: Optional[Any] = None,
    ):
        """
        Args:
            summarizer: 事件摘要生成器。
            config: 压缩配置。
            strategy: 压缩策略。
            task_type: 任务类型（'default', 'mining', 'conversation', 'tool_sequence'）。
            model: 模型名称（用于精确 token 计数）。
            enable_fast_fallback: 是否启用快速压缩降级（DeerFlow 风格）。
            flush_handler: Optional memory flush handler (MemoryFlushHandler protocol).
                When provided, the handler is called *before* compaction to
                persist important context.  Inspired by OpenClaw's
                ``agents.defaults.compaction.memoryFlush``.
            flush_config: Optional CompactionFlushConfig for the flush handler.
        """
        self.summarizer = summarizer or SimpleEventSummarizer()
        self.config = config or CompactionConfig()
        self.strategy = strategy
        self.task_type = task_type
        self.token_counter = TokenCounter(model=model)
        self.enable_fast_fallback = enable_fast_fallback
        self.overflow_recovery_pipeline = OverflowRecoveryPipeline(
            compiler=self,
            config=overflow_recovery_config or OverflowRecoveryConfig(),
        )
        
        # Memory Flush Before Compaction
        self.flush_handler = flush_handler
        self.flush_config = flush_config
        self.flush_count: int = 0
        
        # 快速压缩器（用于紧急情况）
        self.fast_compressor: Optional[FastHeuristicCompressor] = None
        if enable_fast_fallback:
            self.fast_compressor = FastHeuristicCompressor(
                token_limit=config.max_context_tokens if config else 8000,
                preserve_prefix_count=2
            )
        
        # 统计信息
        self.compaction_history: List[Dict[str, Any]] = []
        self.total_tokens_saved = 0
        self.emergency_compressions = 0  # 紧急压缩次数
    
    async def maybe_compact(self, event_log: EventLog) -> Optional[CompactedEvent]:
        """
        检查并执行压缩（如果需要）。
        """
        should_compact, reason = self._should_compact(event_log)
        
        if not should_compact:
            return None
        
        if reason and str(reason).startswith("token_overflow"):
            self.overflow_recovery_pipeline.reset()
            recovered = await self.overflow_recovery_pipeline.recover(event_log)
            if recovered:
                should_compact, post_reason = self._should_compact(event_log)
                if not should_compact:
                    logger.info("Overflow recovered without additional compaction.")
                    return None
                logger.info(f"Overflow recovered, performing post-recovery compaction. Reason: {post_reason}")
                return await self.compact(event_log, reason=post_reason)

        logger.info(f"Triggering compaction. Reason: {reason}")
        return await self.compact(event_log, reason=reason)
    
    def _should_compact(self, event_log: EventLog) -> tuple:
        """
        判断是否应该压缩。
        
        Returns:
            (should_compact, reason)
        """
        if not self.config.enabled:
            return False, None
        
        # 获取新事件
        new_events = event_log.get_events_since_last_compaction()
        
        # 策略 1：事件数阈值
        if len(new_events) >= self.config.compaction_interval:
            return True, f"event_count ({len(new_events)} >= {self.config.compaction_interval})"
        
        # 策略 2：Token 阈值（紧急压缩）
        total_tokens = self._count_event_log_tokens(event_log)
        if total_tokens > self.config.max_context_tokens:
            return True, f"token_overflow ({total_tokens} > {self.config.max_context_tokens})"
        
        return False, None
    
    def _count_event_log_tokens(self, event_log: EventLog) -> int:
        """精确计算 EventLog 的 token 数。"""
        total = 0
        for event in event_log.events:
            if isinstance(event, CompactedEvent):
                total += self.token_counter.count_tokens(event.summary)
            else:
                # 序列化事件并计数
                event_str = self._event_to_string(event)
                total += self.token_counter.count_tokens(event_str)
        return total
    
    def _event_to_string(self, event: AnyEvent) -> str:
        """将事件转换为字符串（用于 token 计数）。"""
        if isinstance(event, ToolCallEvent):
            return f"Tool: {event.tool_name}, Args: {event.tool_args}, Intent: {event.intent}"
        elif isinstance(event, ToolResultEvent):
            return f"Result: {event.tool_name}, Success: {event.success}, Data: {event.result or event.error}"
        elif isinstance(event, ErrorEvent):
            return f"Error: {event.error_type} - {event.error_message}"
        elif isinstance(event, LLMResponseEvent):
            return f"LLM Response: {event.response}"
        else:
            return str(event.model_dump())
    
    async def compact(
        self, 
        event_log: EventLog,
        reason: Optional[str] = None
    ) -> Optional[CompactedEvent]:
        """
        执行压缩操作（增强版：支持紧急快速压缩 + Memory Flush Before Compaction）。
        """
        # === Memory Flush Before Compaction (OpenClaw) ===
        # Must run *before* token counting / actual compaction so that
        # important context is persisted before it is compressed away.
        await self._maybe_flush_before_compact(event_log)
        
        # 判断是否需要紧急压缩
        current_tokens = self._count_event_log_tokens(event_log)
        is_emergency = self._is_emergency(current_tokens)
        
        # 紧急情况下使用快速压缩器（DeerFlow 风格）
        if is_emergency and self.enable_fast_fallback and self.fast_compressor:
            logger.warning(
                f"EMERGENCY compaction triggered: {current_tokens} tokens "
                f"(limit: {self.config.max_context_tokens}). Using fast heuristic compression."
            )
            return self._fast_compress(event_log, reason="emergency_token_overflow")
        
        # 正常情况：使用语义摘要（原 AgenticX 方式）
        # 根据策略获取待压缩的事件
        events_to_compact = self._get_events_to_compact(event_log)
        
        if not events_to_compact:
            logger.debug("No events to compact.")
            return None
        
        logger.info(f"Compacting {len(events_to_compact)} events (strategy: {self.strategy.value})...")
        
        # 计算时间范围
        start_ts = self._get_event_timestamp(events_to_compact[0])
        end_ts = self._get_event_timestamp(events_to_compact[-1])
        
        # 精确计算压缩前的 token 数
        token_count_before = sum(
            self.token_counter.count_tokens(self._event_to_string(e))
            for e in events_to_compact
        )
        
        # 生成摘要（传递任务类型）
        summary = await self.summarizer.summarize(
            events_to_compact,
            self.config.summarizer_prompt,
            task_type=self.task_type
        )
        
        # 精确计算压缩后的 token 数
        token_count_after = self.token_counter.count_tokens(summary)
        
        # 计算节省的 token
        tokens_saved = token_count_before - token_count_after
        self.total_tokens_saved += max(0, tokens_saved)
        
        # 创建 CompactedEvent
        compacted_event = CompactedEvent(
            summary=summary,
            start_timestamp=start_ts,
            end_timestamp=end_ts,
            compressed_event_ids=[e.id for e in events_to_compact],
            token_count_before=token_count_before,
            token_count_after=token_count_after,
            agent_id=event_log.agent_id,
            task_id=event_log.task_id
        )
        
        # 追加到 EventLog
        event_log.append(compacted_event)
        
        # 记录历史
        self.compaction_history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "events_compacted": len(events_to_compact),
            "token_before": token_count_before,
            "token_after": token_count_after,
            "compression_ratio": compacted_event.get_compression_ratio(),
            "strategy": self.strategy.value,
            "reason": reason
        })
        
        logger.info(
            f"Compaction complete. "
            f"Tokens: {token_count_before} -> {token_count_after} "
            f"(saved: {tokens_saved}, ratio: {compacted_event.get_compression_ratio():.2f})"
        )
        
        return compacted_event
    
    def _is_emergency(self, current_tokens: int) -> bool:
        """
        判断是否为紧急情况（接近 token 限制）。
        
        Args:
            current_tokens: 当前 token 数
            
        Returns:
            True 如果超过限制的 95%
        """
        threshold = self.config.max_context_tokens * 0.95
        return current_tokens >= threshold

    async def _maybe_flush_before_compact(self, event_log: EventLog) -> None:
        """Run the memory flush handler *before* compaction if configured.

        Inspired by OpenClaw's ``agents.defaults.compaction.memoryFlush``:
        a silent Agent turn persists critical information to long-term memory
        so it is not lost during context compaction.
        """
        if self.flush_handler is None or self.flush_config is None:
            return
        if not getattr(self.flush_config, "enabled", True):
            return

        current_tokens = self._count_event_log_tokens(event_log)
        max_tokens = self.config.max_context_tokens

        try:
            should = await self.flush_handler.should_flush(
                current_tokens, max_tokens, self.flush_config
            )
            if should:
                result = await self.flush_handler.execute_flush(self.flush_config)
                self.flush_count += 1
                logger.info(
                    "Memory flush before compaction executed (#%d). Result: %s",
                    self.flush_count,
                    result,
                )
        except Exception:
            # Flush is best-effort; must not block compaction.
            logger.exception("Memory flush before compaction failed; proceeding with compaction.")
    
    def _fast_compress(self, event_log: EventLog, reason: str = "emergency") -> Optional[CompactedEvent]:
        """
        快速压缩（使用 FastHeuristicCompressor）。
        
        注意：这是同步操作，不调用 LLM
        
        Args:
            event_log: 事件日志
            reason: 压缩原因
            
        Returns:
            CompactedEvent 或 None
        """
        if not self.fast_compressor:
            logger.error("Fast compressor not initialized, cannot perform emergency compression")
            return None
        
        original_events = event_log.events.copy()
        
        # 执行快速压缩
        compressed_events = self.fast_compressor.compress(event_log)
        
        # 替换 EventLog 的事件列表
        event_log.events = compressed_events
        
        # 统计
        self.emergency_compressions += 1
        original_count = len(original_events)
        compressed_count = len(compressed_events)
        dropped_count = original_count - compressed_count
        
        # 估算 token 节省（使用启发式）
        original_tokens = self.fast_compressor.estimate_total_tokens(original_events)
        compressed_tokens = self.fast_compressor.estimate_total_tokens(compressed_events)
        tokens_saved = original_tokens - compressed_tokens
        
        # 记录历史
        self.compaction_history.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "events_compacted": dropped_count,
            "token_before": original_tokens,
            "token_after": compressed_tokens,
            "compression_ratio": compressed_tokens / original_tokens if original_tokens > 0 else 1.0,
            "strategy": "emergency",
            "reason": reason,
            "fast_compression": True
        })
        
        logger.warning(
            f"Emergency fast compression complete. "
            f"Events: {original_count} -> {compressed_count} (dropped: {dropped_count}). "
            f"Tokens: {original_tokens} -> {compressed_tokens} (saved: {tokens_saved})"
        )
        
        # 快速压缩不生成 CompactedEvent，而是直接截断事件列表
        return None
    
    def _get_events_to_compact(self, event_log: EventLog) -> List[AnyEvent]:
        """
        根据策略确定本次压缩的事件范围。
        """
        if self.strategy == CompactionStrategy.SLIDING_WINDOW:
            return self._sliding_window_events(event_log)
        elif self.strategy == CompactionStrategy.EMERGENCY:
            return self._emergency_events(event_log)
        elif self.strategy == CompactionStrategy.TIME_BASED:
            return self._time_based_events(event_log)
        elif self.strategy == CompactionStrategy.TOPIC_BASED:
            return self._topic_based_events(event_log)
        elif self.strategy == CompactionStrategy.HYBRID:
            return self._hybrid_events(event_log)
        else:
            # 默认使用滑动窗口
            return self._sliding_window_events(event_log)
    
    def _sliding_window_events(self, event_log: EventLog) -> List[AnyEvent]:
        """滑动窗口策略：标准的渐进压缩。"""
        last_compaction = event_log.get_last_compaction()
        
        if not last_compaction:
            # 首次压缩
            events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
            if len(events) > self.config.compaction_interval:
                return events[:-self.config.overlap_size] if self.config.overlap_size > 0 else events
            return events
        
        # 找到 overlap 事件和新事件
        overlap_events = []
        new_events = []
        
        for event in event_log.events:
            if isinstance(event, CompactedEvent):
                continue
            
            event_ts = self._get_event_timestamp(event)
            
            if event_ts <= last_compaction.end_timestamp:
                overlap_events.append(event)
            else:
                new_events.append(event)
        
        overlap_selected = overlap_events[-self.config.overlap_size:] if overlap_events else []
        return overlap_selected + new_events
    
    def _emergency_events(self, event_log: EventLog) -> List[AnyEvent]:
        """紧急压缩策略：压缩更多事件以快速降低 token 数。"""
        events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
        
        # 紧急模式下，保留更少的最近事件
        keep_recent = max(3, self.config.overlap_size)
        if len(events) > keep_recent:
            return events[:-keep_recent]
        
        return events
    
    def _time_based_events(self, event_log: EventLog) -> List[AnyEvent]:
        """
        基于时间的压缩策略：按时间窗口分组压缩。
        
        算法：
        1. 根据配置的时间窗口大小（默认 5 分钟），将事件分组
        2. 选择最早的、已完成的时间窗口进行压缩
        3. 保留当前活跃时间窗口内的事件
        """
        events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
        if not events:
            return []
        
        # 时间窗口大小（秒）
        window_size = self.config.time_window_seconds
        
        # 按时间窗口分组
        time_buckets: Dict[int, List[AnyEvent]] = {}
        for event in events:
            event_ts = self._get_event_timestamp(event)
            bucket_key = int(event_ts // window_size)
            if bucket_key not in time_buckets:
                time_buckets[bucket_key] = []
            time_buckets[bucket_key].append(event)
        
        if len(time_buckets) < 2:
            # 只有一个时间窗口，不压缩
            return []
        
        # 对 bucket_key 排序，压缩最早的窗口（保留最近的窗口）
        sorted_keys = sorted(time_buckets.keys())
        
        # 压缩所有已完成的时间窗口（除了最后一个）
        events_to_compact = []
        for key in sorted_keys[:-1]:
            events_to_compact.extend(time_buckets[key])
        
        return events_to_compact
    
    def _topic_based_events(self, event_log: EventLog) -> List[AnyEvent]:
        """
        基于主题的压缩策略：将相关事件聚类后压缩。
        
        算法：
        1. 按事件类型分组（ToolCall/ToolResult, LLM, Error, Human）
        2. 在同一类型内，按工具名或其他特征进一步聚类
        3. 选择可以安全压缩的聚类（已完成的工具调用链等）
        """
        events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
        if not events:
            return []
        
        # 按主题分类
        topic_groups: Dict[str, List[AnyEvent]] = {
            "tool_chains": [],      # 工具调用链（ToolCall + ToolResult）
            "llm_interactions": [], # LLM 交互
            "errors": [],           # 错误事件
            "human_io": [],         # 人类交互
            "others": []            # 其他
        }
        
        # 追踪未完成的工具调用
        pending_tool_calls: Dict[str, ToolCallEvent] = {}
        completed_tool_chains: List[AnyEvent] = []
        
        for event in events:
            if isinstance(event, ToolCallEvent):
                pending_tool_calls[event.tool_name] = event
            elif isinstance(event, ToolResultEvent):
                # 找到对应的 ToolCall，形成完整链
                if event.tool_name in pending_tool_calls:
                    completed_tool_chains.append(pending_tool_calls.pop(event.tool_name))
                    completed_tool_chains.append(event)
                else:
                    topic_groups["tool_chains"].append(event)
            elif isinstance(event, (LLMCallEvent, LLMResponseEvent)):
                topic_groups["llm_interactions"].append(event)
            elif isinstance(event, ErrorEvent):
                topic_groups["errors"].append(event)
            elif isinstance(event, (HumanRequestEvent, HumanResponseEvent)):
                topic_groups["human_io"].append(event)
            else:
                topic_groups["others"].append(event)
        
        # 只压缩已完成的工具调用链
        topic_groups["tool_chains"] = completed_tool_chains
        
        # 保留未完成的工具调用（不压缩）
        # pending_tool_calls 中的事件不会被压缩
        
        # 决定压缩哪些主题（优先压缩已完成的工具链和 LLM 交互）
        events_to_compact = []
        
        # 工具链：只有当链足够长时才压缩
        if len(topic_groups["tool_chains"]) >= self.config.compaction_interval:
            # 保留最近的几个事件作为 overlap
            events_to_compact.extend(topic_groups["tool_chains"][:-self.config.overlap_size])
        
        # LLM 交互：通常可以安全压缩
        if len(topic_groups["llm_interactions"]) >= self.config.compaction_interval:
            events_to_compact.extend(topic_groups["llm_interactions"][:-self.config.overlap_size])
        
        return events_to_compact
    
    def _hybrid_events(self, event_log: EventLog) -> List[AnyEvent]:
        """
        混合策略：根据上下文动态选择最优压缩方案。
        
        决策逻辑：
        1. 如果事件跨度超过时间阈值，使用 TIME_BASED
        2. 如果存在明显的主题聚类，使用 TOPIC_BASED
        3. 否则使用 SLIDING_WINDOW
        """
        events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
        if not events:
            return []
        
        # 计算时间跨度
        timestamps = [self._get_event_timestamp(e) for e in events]
        time_span = max(timestamps) - min(timestamps) if timestamps else 0
        
        # 计算主题多样性
        topic_diversity = self._calculate_topic_diversity(events)
        
        # 决策阈值
        time_threshold = self.config.time_window_seconds * 2  # 2 个时间窗口
        diversity_threshold = 0.6  # 主题多样性阈值
        
        logger.debug(
            f"Hybrid strategy analysis: time_span={time_span:.0f}s, "
            f"topic_diversity={topic_diversity:.2f}"
        )
        
        # 选择策略
        if time_span > time_threshold:
            logger.info("Hybrid: Selecting TIME_BASED strategy (large time span)")
            return self._time_based_events(event_log)
        elif topic_diversity > diversity_threshold:
            logger.info("Hybrid: Selecting TOPIC_BASED strategy (high topic diversity)")
            return self._topic_based_events(event_log)
        else:
            logger.info("Hybrid: Selecting SLIDING_WINDOW strategy (default)")
            return self._sliding_window_events(event_log)
    
    def _calculate_topic_diversity(self, events: List[AnyEvent]) -> float:
        """
        计算事件的主题多样性（0-1）。
        
        Returns:
            0 = 所有事件同一主题，1 = 完全不同的主题
        """
        if not events:
            return 0.0
        
        # 统计各类事件
        type_counts: Dict[str, int] = {}
        for event in events:
            event_type = type(event).__name__
            type_counts[event_type] = type_counts.get(event_type, 0) + 1
        
        # 如果只有一种类型，多样性为 0
        if len(type_counts) == 1:
            return 0.0
        
        # 计算 Shannon 熵作为多样性指标
        total = len(events)
        entropy = 0.0
        for count in type_counts.values():
            p = count / total
            if p > 0:
                entropy -= p * math.log2(p)
        
        # 归一化到 0-1（最大熵 = log2(类型数)）
        max_entropy = math.log2(len(type_counts)) if len(type_counts) > 1 else 1
        return entropy / max_entropy if max_entropy > 0 else 0.0
    
    def _get_event_timestamp(self, event: AnyEvent) -> float:
        """获取事件时间戳。"""
        if hasattr(event, 'timestamp'):
            ts = event.timestamp
            if isinstance(ts, datetime):
                return ts.timestamp()
            return float(ts)
        return 0.0
    
    # =========================================================================
    # 可观测性方法
    # =========================================================================
    
    def get_compaction_stats(self) -> Dict[str, Any]:
        """获取压缩统计信息。"""
        if not self.compaction_history:
            return {
                "total_compactions": 0,
                "total_tokens_saved": 0,
                "average_compression_ratio": 0.0
            }
        
        avg_ratio = sum(h["compression_ratio"] for h in self.compaction_history) / len(self.compaction_history)
        total_events = sum(h["events_compacted"] for h in self.compaction_history)
        
        return {
            "total_compactions": len(self.compaction_history),
            "total_events_compacted": total_events,
            "total_tokens_saved": self.total_tokens_saved,
            "average_compression_ratio": round(avg_ratio, 3),
            "history": self.compaction_history[-10:]  # 最近 10 次
        }
    
    # =========================================================================
    # 持久化方法
    # =========================================================================
    
    def export_stats(self, file_path: Optional[str] = None) -> Dict[str, Any]:
        """
        导出压缩统计信息到 JSON 文件或返回字典。
        
        Args:
            file_path: 可选的文件路径。如果提供，将导出到文件。
            
        Returns:
            导出的统计数据字典。
        """
        export_data = {
            "version": "2.2",
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "config": {
                "enabled": self.config.enabled,
                "compaction_interval": self.config.compaction_interval,
                "overlap_size": self.config.overlap_size,
                "max_context_tokens": self.config.max_context_tokens,
                "time_window_seconds": self.config.time_window_seconds,
            },
            "strategy": self.strategy.value,
            "task_type": self.task_type,
            "statistics": {
                "total_compactions": len(self.compaction_history),
                "total_tokens_saved": self.total_tokens_saved,
                "average_compression_ratio": (
                    sum(h["compression_ratio"] for h in self.compaction_history) / 
                    len(self.compaction_history) if self.compaction_history else 0.0
                ),
            },
            "history": self.compaction_history,
        }
        
        if file_path:
            path = Path(file_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=2, ensure_ascii=False)
            logger.info(f"Compaction stats exported to {file_path}")
        
        return export_data
    
    def import_stats(self, file_path: str) -> None:
        """
        从 JSON 文件导入压缩统计信息。
        
        这允许在重启后恢复历史统计。
        
        Args:
            file_path: JSON 文件路径。
        """
        path = Path(file_path)
        if not path.exists():
            logger.warning(f"Stats file not found: {file_path}")
            return
        
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            # 恢复历史记录
            if "history" in data:
                self.compaction_history = data["history"]
            
            # 恢复统计
            if "statistics" in data:
                self.total_tokens_saved = data["statistics"].get("total_tokens_saved", 0)
            
            logger.info(f"Imported {len(self.compaction_history)} compaction records from {file_path}")
            
        except Exception as e:
            logger.error(f"Failed to import stats from {file_path}: {e}")
    
    def reset_stats(self) -> None:
        """重置所有统计信息。"""
        self.compaction_history = []
        self.total_tokens_saved = 0
        logger.info("Compaction stats reset")
    
    def compare_views(self, event_log: EventLog) -> Dict[str, Any]:
        """
        对比原始视图和编译视图。
        
        Returns:
            包含两种视图 token 统计的对比信息。
        """
        # 原始视图：所有非压缩事件
        original_events = [e for e in event_log.events if not isinstance(e, CompactedEvent)]
        original_tokens = sum(
            self.token_counter.count_tokens(self._event_to_string(e))
            for e in original_events
        )
        
        # 编译视图：压缩事件的摘要 + 未被覆盖的原始事件
        compiled_tokens = self._count_compiled_view_tokens(event_log)
        
        return {
            "original_view": {
                "event_count": len(original_events),
                "token_count": original_tokens
            },
            "compiled_view": {
                "event_count": len(event_log.events),
                "token_count": compiled_tokens
            },
            "savings": {
                "tokens_saved": original_tokens - compiled_tokens,
                "compression_ratio": round(compiled_tokens / max(original_tokens, 1), 3)
            }
        }
    
    def _count_compiled_view_tokens(self, event_log: EventLog) -> int:
        """计算编译视图的 token 数。"""
        # 实现逆序编译算法来计算实际会被渲染的 token 数
        compaction_boundaries = []
        for event in event_log.events:
            if isinstance(event, CompactedEvent):
                compaction_boundaries.append((event.start_timestamp, event.end_timestamp, event))
        
        if not compaction_boundaries:
            return self._count_event_log_tokens(event_log)
        
        compaction_boundaries.sort(key=lambda x: x[1], reverse=True)
        
        total_tokens = 0
        mask_end_time = float('inf')
        
        for event in reversed(event_log.events):
            event_ts = self._get_event_timestamp(event)
            
            if isinstance(event, CompactedEvent):
                if event_ts < mask_end_time:
                    total_tokens += self.token_counter.count_tokens(event.summary)
                    mask_end_time = min(mask_end_time, event.start_timestamp)
            else:
                if event_ts < mask_end_time:
                    total_tokens += self.token_counter.count_tokens(self._event_to_string(event))
        
        return total_tokens


# =============================================================================
# 便捷工厂函数
# =============================================================================

def create_context_compiler(
    llm_provider: Optional[Any] = None,
    config: Optional[CompactionConfig] = None,
    use_simple_summarizer: bool = False,
    strategy: CompactionStrategy = CompactionStrategy.SLIDING_WINDOW,
    task_type: str = "default",
    model: Optional[str] = None
) -> ContextCompiler:
    """
    创建 ContextCompiler 实例的便捷工厂函数。
    
    Args:
        llm_provider: LLM 提供者（如果使用 LLM 摘要）。
        config: 压缩配置。
        use_simple_summarizer: 是否使用简单摘要（不调用 LLM）。
        strategy: 压缩策略。
        task_type: 任务类型（'default', 'mining', 'conversation'）。
        model: 模型名称（用于精确 token 计数）。
        
    Returns:
        配置好的 ContextCompiler 实例。
    """
    if use_simple_summarizer or llm_provider is None:
        summarizer = SimpleEventSummarizer()
    else:
        summarizer = LLMEventSummarizer(
            llm_provider, 
            model=model,
            default_task_type=task_type
        )
    
    return ContextCompiler(
        summarizer=summarizer,
        config=config,
        strategy=strategy,
        task_type=task_type,
        model=model
    )


def create_mining_compiler(
    llm_provider: Any,
    model: Optional[str] = None,
    compaction_interval: int = 15,
    overlap_size: int = 3
) -> ContextCompiler:
    """
    创建针对"自动挖掘"任务优化的 ContextCompiler。
    
    特点：
    - 使用 MINING_TASK_PROMPT 保留失败路径
    - 较大的 overlap 确保探索线索不丢失
    """
    config = CompactionConfig(
        enabled=True,
        compaction_interval=compaction_interval,
        overlap_size=overlap_size,
        max_context_tokens=12000,  # 挖掘任务通常需要更多上下文
    )
    
    return create_context_compiler(
        llm_provider=llm_provider,
        config=config,
        strategy=CompactionStrategy.SLIDING_WINDOW,
        task_type="mining",
        model=model
    )
