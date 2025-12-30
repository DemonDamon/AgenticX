from typing import Dict, List, Optional, Any, Callable
from abc import ABC, abstractmethod
from datetime import datetime
from .event import (
    EventLog, AnyEvent, ToolCallEvent, ToolResultEvent, ErrorEvent, 
    LLMCallEvent, LLMResponseEvent, HumanRequestEvent, HumanResponseEvent,
    CompactedEvent, CompactionConfig, TaskStartEvent, TaskEndEvent, FinishTaskEvent
)
from .agent import Agent
from .task import Task


class ContextRenderer(ABC):
    """
    Abstract base class for context renderers.
    Different renderers can implement different formatting strategies.
    """
    
    @abstractmethod
    def render(self, event_log: EventLog, agent: Agent, task: Task) -> str:
        """
        Render the event log into a context string.
        
        Args:
            event_log: The event log to render
            agent: The agent context
            task: The task context
            
        Returns:
            A formatted context string
        """
        pass


class XMLContextRenderer(ContextRenderer):
    """
    Context renderer that uses XML-like tags for high information density.
    This implements the "Own Your Context Window" principle from 12-Factor Agents.
    """
    
    def render(self, event_log: EventLog, agent: Agent, task: Task) -> str:
        """
        Render context using XML-like structured format for maximum information density.
        """
        context_parts = []
        
        # Add agent context
        context_parts.append(f"<agent_context>")
        context_parts.append(f"  <agent_id>{agent.id}</agent_id>")
        context_parts.append(f"  <agent_name>{agent.name}</agent_name>")
        context_parts.append(f"  <role>{agent.role}</role>")
        context_parts.append(f"  <goal>{agent.goal}</goal>")
        if agent.backstory:
            context_parts.append(f"  <backstory>{agent.backstory}</backstory>")
        context_parts.append(f"</agent_context>")
        
        # Add task context
        context_parts.append(f"<task_context>")
        context_parts.append(f"  <task_id>{task.id}</task_id>")
        context_parts.append(f"  <description>{task.description}</description>")
        context_parts.append(f"  <expected_output>{task.expected_output}</expected_output>")
        if task.context:
            context_parts.append(f"  <additional_context>{task.context}</additional_context>")
        context_parts.append(f"</task_context>")
        
        # Add execution history
        if event_log.events:
            context_parts.append(f"<execution_history>")
            for event in event_log.events:
                context_parts.append(self._render_event(event))
            context_parts.append(f"</execution_history>")
        
        # Add current state
        current_state = event_log.get_current_state()
        context_parts.append(f"<current_state>")
        context_parts.append(f"  <status>{current_state['status']}</status>")
        context_parts.append(f"  <step_count>{current_state['step_count']}</step_count>")
        context_parts.append(f"</current_state>")
        
        return "\n".join(context_parts)
    
    def _render_event(self, event: AnyEvent) -> str:
        """Render a single event in XML format."""
        if isinstance(event, ToolCallEvent):
            return f"  <tool_call intent='{event.intent}' tool='{event.tool_name}' args='{event.tool_args}' />"
        elif isinstance(event, ToolResultEvent):
            status = "success" if event.success else "error"
            result = event.result if event.success else event.error
            return f"  <tool_result tool='{event.tool_name}' status='{status}' result='{result}' />"
        elif isinstance(event, ErrorEvent):
            return f"  <error type='{event.error_type}' recoverable='{event.recoverable}'>{event.error_message}</error>"
        elif isinstance(event, HumanRequestEvent):
            return f"  <human_request urgency='{event.urgency}'>{event.question}</human_request>"
        elif isinstance(event, HumanResponseEvent):
            return f"  <human_response>{event.response}</human_response>"
        else:
            # Generic event rendering
            return f"  <event type='{event.type}' data='{event.data}' />"


class CompiledContextRenderer(ContextRenderer):
    """
    编译视图渲染器（Compiled View Renderer）。
    
    核心思想（参考自 ADK）：
    - 上下文不是事件的简单拼接，而是对 EventLog 的"编译"结果。
    - 当存在 CompactedEvent 时，其覆盖的原始事件会被"遮蔽"，仅输出摘要。
    
    渲染算法（逆序编译）：
    1. 从最新的事件开始向前遍历。
    2. 遇到 CompactedEvent 时，记录其 start_timestamp 作为"遮蔽边界"。
    3. 所有 timestamp >= 边界的原始事件被跳过，替换为 CompactedEvent 的 summary。
    4. timestamp < 边界的事件正常渲染。
    
    这种机制确保：
    - 长对话历史可以被自动压缩，控制 Token 成本。
    - 近期的详细信息仍然完整保留，确保 Agent 的短期行为精确。
    
    性能优化：
    - 使用缓存避免重复编译（基于事件数量和最后事件 ID）
    - 增量编译：仅处理自上次编译以来的新事件
    """
    
    def __init__(self, max_recent_events: int = 20, include_stats: bool = True, enable_cache: bool = True):
        """
        Args:
            max_recent_events: 始终保留最近 N 个事件的完整信息（不被压缩）。
            include_stats: 是否在渲染结果中包含压缩统计信息。
            enable_cache: 是否启用编译缓存（提升性能）。
        """
        self.max_recent_events = max_recent_events
        self.include_stats = include_stats
        self.enable_cache = enable_cache
        
        # 缓存相关
        self._cache_key: Optional[str] = None
        self._cached_compiled_events: Optional[List[AnyEvent]] = None
        self._cache_hits = 0
        self._cache_misses = 0
    
    def render(self, event_log: EventLog, agent: Agent, task: Task) -> str:
        """
        使用编译视图渲染上下文。
        
        核心逻辑：
        1. 收集所有 CompactedEvent 及其覆盖范围。
        2. 逆序扫描事件，构建"编译后"的事件列表。
        3. 输出 XML 格式的上下文。
        """
        context_parts = []
        
        # === Agent & Task Context ===
        context_parts.append(self._render_agent_context(agent))
        context_parts.append(self._render_task_context(task))
        
        # === Compiled Execution History ===
        if event_log.events:
            compiled_events = self._compile_events(event_log.events)
            context_parts.append("<execution_history>")
            for event in compiled_events:
                context_parts.append(self._render_event(event))
            context_parts.append("</execution_history>")
            
            # === Compaction Stats ===
            if self.include_stats:
                context_parts.append(self._render_compaction_stats(event_log, compiled_events))
        
        # === Current State ===
        current_state = event_log.get_current_state()
        context_parts.append(f"<current_state>")
        context_parts.append(f"  <status>{current_state['status']}</status>")
        context_parts.append(f"  <step_count>{current_state['step_count']}</step_count>")
        context_parts.append(f"</current_state>")
        
        return "\n".join(context_parts)
    
    def _compile_events(self, events: List[AnyEvent]) -> List[AnyEvent]:
        """
        执行逆序编译算法（带缓存优化）。
        
        Returns:
            编译后的事件列表（按时间顺序排列）。
        """
        if not events:
            return []
        
        # 缓存检查
        if self.enable_cache:
            cache_key = self._compute_cache_key(events)
            if cache_key == self._cache_key and self._cached_compiled_events is not None:
                self._cache_hits += 1
                return self._cached_compiled_events
            self._cache_misses += 1
        
        # 收集所有 CompactedEvent 的覆盖边界
        compaction_boundaries: List[tuple] = []  # [(start_ts, end_ts, compacted_event), ...]
        for event in events:
            if isinstance(event, CompactedEvent):
                compaction_boundaries.append((event.start_timestamp, event.end_timestamp, event))
        
        # 如果没有压缩事件，直接返回原始事件列表
        if not compaction_boundaries:
            result = list(events)
            if self.enable_cache:
                self._cache_key = cache_key
                self._cached_compiled_events = result
            return result
        
        # 按 end_timestamp 降序排序，优先处理最新的压缩
        compaction_boundaries.sort(key=lambda x: x[1], reverse=True)
        
        compiled_events = []
        mask_end_time = float('inf')  # 当前的遮蔽上界
        
        # 逆序遍历事件
        for event in reversed(events):
            event_ts = self._get_timestamp(event)
            
            if isinstance(event, CompactedEvent):
                # 检查此 CompactedEvent 是否被更新的压缩所覆盖
                if event_ts < mask_end_time:
                    compiled_events.insert(0, event)
                    mask_end_time = min(mask_end_time, event.start_timestamp)
            else:
                # 普通事件：检查是否在遮蔽范围内
                if event_ts < mask_end_time:
                    compiled_events.insert(0, event)
        
        # 更新缓存
        if self.enable_cache:
            self._cache_key = cache_key
            self._cached_compiled_events = compiled_events
        
        return compiled_events
    
    def _compute_cache_key(self, events: List[AnyEvent]) -> str:
        """计算事件列表的缓存键。"""
        if not events:
            return "empty"
        # 基于事件数量和最后几个事件的 ID 生成缓存键
        last_ids = [e.id for e in events[-3:]]  # 取最后 3 个事件的 ID
        compaction_count = sum(1 for e in events if isinstance(e, CompactedEvent))
        return f"{len(events)}_{compaction_count}_{'_'.join(last_ids)}"
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """获取缓存统计信息。"""
        total = self._cache_hits + self._cache_misses
        hit_rate = self._cache_hits / total if total > 0 else 0.0
        return {
            "cache_hits": self._cache_hits,
            "cache_misses": self._cache_misses,
            "hit_rate": round(hit_rate, 3),
            "cache_enabled": self.enable_cache
        }
    
    def clear_cache(self) -> None:
        """清除缓存。"""
        self._cache_key = None
        self._cached_compiled_events = None
    
    def _get_timestamp(self, event: AnyEvent) -> float:
        """获取事件的时间戳（统一为 float）。"""
        if isinstance(event, CompactedEvent):
            return event.end_timestamp
        if hasattr(event, 'timestamp'):
            ts = event.timestamp
            if isinstance(ts, datetime):
                return ts.timestamp()
            return float(ts)
        return 0.0
    
    def _render_agent_context(self, agent: Agent) -> str:
        """渲染 Agent 上下文。"""
        parts = [
            "<agent_context>",
            f"  <agent_id>{agent.id}</agent_id>",
            f"  <agent_name>{agent.name}</agent_name>",
            f"  <role>{agent.role}</role>",
            f"  <goal>{agent.goal}</goal>",
        ]
        if agent.backstory:
            parts.append(f"  <backstory>{agent.backstory}</backstory>")
        parts.append("</agent_context>")
        return "\n".join(parts)
    
    def _render_task_context(self, task: Task) -> str:
        """渲染 Task 上下文。"""
        parts = [
            "<task_context>",
            f"  <task_id>{task.id}</task_id>",
            f"  <description>{task.description}</description>",
            f"  <expected_output>{task.expected_output}</expected_output>",
        ]
        if task.context:
            parts.append(f"  <additional_context>{task.context}</additional_context>")
        parts.append("</task_context>")
        return "\n".join(parts)
    
    def _render_event(self, event: AnyEvent) -> str:
        """渲染单个事件为 XML 格式。"""
        if isinstance(event, CompactedEvent):
            return f"  <compacted_summary start='{event.start_timestamp}' end='{event.end_timestamp}'>{event.summary}</compacted_summary>"
        elif isinstance(event, ToolCallEvent):
            return f"  <tool_call intent='{event.intent}' tool='{event.tool_name}' args='{event.tool_args}' />"
        elif isinstance(event, ToolResultEvent):
            status = "success" if event.success else "error"
            result = event.result if event.success else event.error
            return f"  <tool_result tool='{event.tool_name}' status='{status}' result='{result}' />"
        elif isinstance(event, ErrorEvent):
            return f"  <error type='{event.error_type}' recoverable='{event.recoverable}'>{event.error_message}</error>"
        elif isinstance(event, HumanRequestEvent):
            return f"  <human_request urgency='{event.urgency}'>{event.question}</human_request>"
        elif isinstance(event, HumanResponseEvent):
            return f"  <human_response>{event.response}</human_response>"
        elif isinstance(event, TaskStartEvent):
            return f"  <task_start>{event.task_description}</task_start>"
        elif isinstance(event, TaskEndEvent):
            status = "success" if event.success else "failed"
            return f"  <task_end status='{status}' />"
        elif isinstance(event, FinishTaskEvent):
            return f"  <finish_task>{event.final_result}</finish_task>"
        elif isinstance(event, LLMCallEvent):
            # LLM 调用事件通常不需要完整渲染 prompt（太长），只记录元数据
            return f"  <llm_call model='{event.model}' />"
        elif isinstance(event, LLMResponseEvent):
            # 同样，LLM 响应也简化处理
            tokens = event.token_usage.get('total_tokens', 'N/A') if event.token_usage else 'N/A'
            return f"  <llm_response tokens='{tokens}' />"
        else:
            return f"  <event type='{event.type}' />"
    
    def _render_compaction_stats(self, event_log: EventLog, compiled_events: List[AnyEvent]) -> str:
        """渲染压缩统计信息。"""
        original_count = len(event_log.events)
        compiled_count = len(compiled_events)
        compaction_count = event_log.get_compaction_count()
        
        parts = [
            "<compaction_stats>",
            f"  <original_events>{original_count}</original_events>",
            f"  <compiled_events>{compiled_count}</compiled_events>",
            f"  <compaction_count>{compaction_count}</compaction_count>",
            f"  <compression_ratio>{compiled_count / max(original_count, 1):.2f}</compression_ratio>",
            "</compaction_stats>"
        ]
        return "\n".join(parts)


class PromptTemplate:
    """
    A template for generating prompts with placeholders.
    """
    
    def __init__(self, template: str, name: str = "default"):
        self.template = template
        self.name = name
    
    def format(self, **kwargs) -> str:
        """Format the template with provided variables."""
        return self.template.format(**kwargs)


class PromptManager:
    """
    Core component for context engineering and prompt management.
    Implements the "Own Your Prompts" and "Own Your Context Window" principles.
    """
    
    def __init__(self, context_renderer: Optional[ContextRenderer] = None):
        self.context_renderer = context_renderer or XMLContextRenderer()
        self.prompt_templates: Dict[str, PromptTemplate] = {}
        self._register_default_templates()
    
    def _register_default_templates(self):
        """Register default prompt templates."""
        
        # Default ReAct-style template
        react_template = """You are {agent_name}, a {role}.

Your goal: {goal}

{context}

You must respond with a JSON object containing your next action. Choose from these options:
1. Call a tool: {{"action": "tool_call", "tool": "tool_name", "args": {{}}, "reasoning": "why you chose this tool"}}
2. Request human help: {{"action": "human_request", "question": "what you need help with", "context": "additional context", "urgency": "low|medium|high"}}
3. Finish the task: {{"action": "finish_task", "result": "your final result", "reasoning": "why the task is complete"}}

Think step by step and choose the most appropriate action based on the current situation."""
        
        self.register_template("react", react_template)
        
        # Error recovery template
        error_recovery_template = """You are {agent_name}, a {role}.

Your goal: {goal}

{context}

IMPORTANT: Your last action resulted in an error. You need to analyze the error and decide how to recover.

Error details: {error_message}

You must respond with a JSON object containing your recovery action:
1. Try a different approach: {{"action": "tool_call", "tool": "tool_name", "args": {{}}, "reasoning": "how this approach differs from the failed one"}}
2. Request human help: {{"action": "human_request", "question": "what you need help with", "context": "include the error details", "urgency": "medium|high"}}
3. Finish with partial result: {{"action": "finish_task", "result": "best result you can provide", "reasoning": "why you cannot complete fully"}}

Analyze the error carefully and choose the best recovery strategy."""
        
        self.register_template("error_recovery", error_recovery_template)
    
    def register_template(self, name: str, template: str):
        """Register a new prompt template."""
        self.prompt_templates[name] = PromptTemplate(template, name)
    
    def get_template(self, name: str) -> Optional[PromptTemplate]:
        """Get a prompt template by name."""
        return self.prompt_templates.get(name)
    
    def build_context(self, event_log: EventLog, agent: Agent, task: Task) -> str:
        """
        Build high-density context from event log.
        This is the core of context engineering.
        """
        return self.context_renderer.render(event_log, agent, task)
    
    def build_prompt(
        self, 
        template_name: str, 
        event_log: EventLog, 
        agent: Agent, 
        task: Task,
        **extra_vars
    ) -> str:
        """
        Build a complete prompt using a template and context.
        
        Args:
            template_name: Name of the template to use
            event_log: Event log for context
            agent: Agent context
            task: Task context
            **extra_vars: Additional variables for the template
            
        Returns:
            Complete formatted prompt
        """
        template = self.get_template(template_name)
        if not template:
            raise ValueError(f"Template '{template_name}' not found")
        
        # Build context
        context = self.build_context(event_log, agent, task)
        
        # Prepare template variables
        template_vars = {
            "agent_name": agent.name,
            "role": agent.role,
            "goal": agent.goal,
            "context": context,
            **extra_vars
        }
        
        return template.format(**template_vars)
    
    def build_error_recovery_prompt(
        self,
        event_log: EventLog,
        agent: Agent,
        task: Task,
        error_message: str
    ) -> str:
        """
        Build a specialized prompt for error recovery.
        """
        return self.build_prompt(
            "error_recovery",
            event_log,
            agent,
            task,
            error_message=error_message
        )
    
    def set_context_renderer(self, renderer: ContextRenderer):
        """Set a custom context renderer."""
        self.context_renderer = renderer 