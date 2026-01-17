import json
import asyncio
import time
from typing import Dict, Any, List, Optional, Callable, Union, Tuple
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
import logging
from concurrent.futures import ThreadPoolExecutor
import traceback

from ..llms.base import BaseLLMProvider
from ..llms.response import LLMResponse
from ..tools.base import BaseTool
from agenticx.tools.security import ApprovalRequiredError
from .agent import Agent
from .guiderails import GuideRailsAction, GuideRailsContext, GuideRailsAbortError
from .task import Task
from .event import (
    EventLog, AnyEvent, TaskStartEvent, TaskEndEvent, ToolCallEvent, 
    ToolResultEvent, ErrorEvent, LLMCallEvent, LLMResponseEvent,
    HumanRequestEvent, HumanResponseEvent, FinishTaskEvent,
    CompactionConfig
)
from .prompt import PromptManager, CompiledContextRenderer
from .error_handler import ErrorHandler
from .communication import CommunicationInterface
from .context_compiler import ContextCompiler, create_context_compiler
from .stream_accumulator import StreamContentAccumulator

# Hooks 系统
from ..hooks.llm_hooks import (
    LLMCallHookContext,
    execute_before_llm_call_hooks,
    execute_after_llm_call_hooks,
)
from ..hooks.tool_hooks import (
    ToolCallHookContext,
    execute_before_tool_call_hooks,
    execute_after_tool_call_hooks,
)

logger = logging.getLogger(__name__)


# =========================================================================
# 并行工具执行支持
# =========================================================================

@dataclass
class ParallelToolResult:
    """
    并行工具执行的结果容器。
    
    设计原理：
    - Agno 支持在单次迭代中并行执行 LLM 返回的多个工具调用
    - 使用 asyncio.gather 实现并发，显著降低多工具场景下的延迟
    - 单个工具失败不应阻断其他工具的执行
    """
    tool_name: str
    tool_args: Dict[str, Any]
    success: bool
    result: Any = None
    error: Optional[str] = None
    execution_time_ms: float = 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "tool_args": self.tool_args,
            "success": self.success,
            "result": self.result,
            "error": self.error,
            "execution_time_ms": self.execution_time_ms,
        }


@dataclass
class ParallelExecutionSummary:
    """并行执行的汇总信息。"""
    total_tools: int
    successful: int
    failed: int
    total_time_ms: float
    results: List[ParallelToolResult] = field(default_factory=list)
    
    @property
    def success_rate(self) -> float:
        return self.successful / self.total_tools if self.total_tools > 0 else 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "total_tools": self.total_tools,
            "successful": self.successful,
            "failed": self.failed,
            "total_time_ms": self.total_time_ms,
            "success_rate": self.success_rate,
            "results": [r.to_dict() for r in self.results],
        }


class ToolRegistry:
    """Registry for managing available tools."""
    
    def __init__(self):
        self.tools: Dict[str, BaseTool] = {}
    
    def register(self, tool: BaseTool):
        """Register a tool."""
        self.tools[tool.name] = tool
    
    def get(self, name: str) -> Optional[BaseTool]:
        """Get a tool by name."""
        return self.tools.get(name)
    
    def list_tools(self) -> List[str]:
        """List all available tool names."""
        return list(self.tools.keys())


class ActionParser:
    """Parser for LLM responses to extract structured actions."""
    
    def parse_action(self, response: str) -> Dict[str, Any]:
        """
        Parse LLM response to extract action.
        
        Args:
            response: Raw LLM response
            
        Returns:
            Parsed action dictionary
            
        Raises:
            ValueError: If parsing fails
        """
        try:
            # Try to parse as JSON
            action = json.loads(response.strip())
            
            # Validate required fields
            if "action" not in action:
                raise ValueError("Action field is required")
            
            return action
            
        except json.JSONDecodeError:
            # Try to extract JSON from text
            import re
            json_match = re.search(r'\{.*\}', response, re.DOTALL)
            if json_match:
                try:
                    action = json.loads(json_match.group())
                    if "action" not in action:
                        raise ValueError("Action field is required")
                    return action
                except json.JSONDecodeError:
                    pass
            
            # If all else fails, treat as finish_task
            return {
                "action": "finish_task",
                "result": response,
                "reasoning": "Could not parse structured response, treating as final answer"
            }


class AgentExecutor:
    """
    The core execution engine for agents.
    Implements the "Own Your Control Flow" principle from 12-Factor Agents.
    
    新增功能：
    - Context Compiler: 自动压缩长对话历史，控制 Token 成本。
    - Compiled Context Renderer: 使用"编译视图"渲染上下文。
    """
    
    def __init__(
        self,
        llm_provider: BaseLLMProvider,
        tools: Optional[List[BaseTool]] = None,
        prompt_manager: Optional[PromptManager] = None,
        error_handler: Optional[ErrorHandler] = None,
        communication: Optional[CommunicationInterface] = None,
        max_iterations: int = 50,
        # Context Compiler 配置
        compaction_config: Optional[CompactionConfig] = None,
        enable_context_compilation: bool = True
    ):
        self.llm_provider = llm_provider
        self.error_handler = error_handler or ErrorHandler()
        self.communication = communication
        self.max_iterations = max_iterations
        
        # Context Compiler 配置
        self.compaction_config = compaction_config or CompactionConfig()
        self.enable_context_compilation = enable_context_compilation
        
        # 如果启用上下文编译，使用 CompiledContextRenderer
        if enable_context_compilation:
            compiled_renderer = CompiledContextRenderer()
            self.prompt_manager = prompt_manager or PromptManager(context_renderer=compiled_renderer)
            self.context_compiler = create_context_compiler(
                llm_provider=llm_provider,
                config=self.compaction_config,
                use_simple_summarizer=False  # 使用 LLM 进行高质量摘要
            )
        else:
            self.prompt_manager = prompt_manager or PromptManager()
            self.context_compiler = None
        
        # Initialize tool registry
        self.tool_registry = ToolRegistry()
        if tools:
            for tool in tools:
                self.tool_registry.register(tool)
        
        # Initialize action parser
        self.action_parser = ActionParser()
    
    def run(self, agent: Agent, task: Task) -> Dict[str, Any]:
        """
        Execute a task using the agent.
        This is the main entry point for agent execution.
        
        Args:
            agent: The agent to execute
            task: The task to perform
            
        Returns:
            Execution result with final output and metadata
        """
        # Initialize event log
        event_log = EventLog(agent_id=agent.id, task_id=task.id)
        result = None # 为 result 提供一个默认值
        
        # Start task
        start_event = TaskStartEvent(
            task_description=task.description,
            agent_id=agent.id,
            task_id=task.id
        )
        event_log.append(start_event)
        
        try:
            # Main execution loop
            result = self._execute_loop(agent, task, event_log)
            
        except ApprovalRequiredError as e:
            # 人工审批请求，直接返回暂停状态
            return {
                "success": True,
                "result": "Paused for human approval",
                "event_log": event_log,
                "stats": self._get_execution_stats(event_log)
            }

        except Exception as e:
            # Handle execution failure
            error_event = self.error_handler.handle(e, {"agent_id": agent.id, "task_id": task.id})
            event_log.append(error_event)
            
            # 如果是不可恢复的错误，直接返回失败
            if not error_event.recoverable:
                return {
                    "success": False,
                    "error": error_event.error_message,
                    "event_log": event_log,
                    "stats": self._get_execution_stats(event_log)
                }

        # 如果工作流暂停，则返回成功（不添加 TaskEndEvent）
        if event_log.needs_human_input():
            return {
                "success": True,
                "result": "Paused for human approval",
                "event_log": event_log,
                "stats": self._get_execution_stats(event_log)
            }
            
        # 只有在没有等待人工输入时才记录结束事件
        end_event = TaskEndEvent(
            success=True,
            result=result,
            agent_id=agent.id,
            task_id=task.id
        )
        event_log.append(end_event)
        
        return {
            "success": True,
            "result": result,
            "event_log": event_log,
            "stats": self._get_execution_stats(event_log)
        }
    
    def _execute_loop(self, agent: Agent, task: Task, event_log: EventLog) -> Any:
        """
        The main think-act loop.
        This implements the core control flow logic.
        """
        iteration = 0
        
        while iteration < self.max_iterations:
            iteration += 1
            
            # Check if we need human input
            if event_log.needs_human_input():
                # In a real implementation, this would pause and wait for human input
                # For now, we'll simulate it or raise an exception
                raise RuntimeError("Human input required but not available in this implementation")
            
            # Check if task is complete
            if event_log.is_complete():
                last_event = event_log.get_last_event()
                if isinstance(last_event, FinishTaskEvent):
                    return last_event.final_result
                else:
                    raise RuntimeError("Task marked as complete but no finish event found")
            
            # Check if we can continue
            if not event_log.can_continue():
                break
            
            try:
                # === Context Compilation Check ===
                # 在每次 LLM 调用前检查是否需要压缩上下文
                if self.context_compiler and self.enable_context_compilation:
                    asyncio.get_event_loop().run_until_complete(
                        self._maybe_compact_context(event_log)
                    )
                
                # Get next action from LLM
                action = self._get_next_action(agent, task, event_log)
                
                # Execute the action (pass agent for hooks access)
                self._execute_action(action, event_log, agent)
                
            except ApprovalRequiredError:
                # 重新抛出 ApprovalRequiredError，让 run 方法处理
                raise
                
            except Exception as e:
                # Handle errors
                error_event = self.error_handler.handle(e)
                event_log.append(error_event)
                
                # Check if we should request human help
                if self.error_handler.should_request_human_help():
                    recent_errors = event_log.get_events_by_type("error")[-3:]
                    # Type cast from List[AnyEvent] to List[ErrorEvent]
                    error_events = [event for event in recent_errors if isinstance(event, ErrorEvent)]
                    human_request = self.error_handler.create_human_help_request(error_events)
                    event_log.append(human_request)
                    break
                
                # If error is not recoverable, stop
                if not error_event.recoverable:
                    break
        
        # If we exit the loop without a finish event, return the best result we have
        return self._get_best_result(event_log)
    
    def _get_next_action(self, agent: Agent, task: Task, event_log: EventLog) -> Dict[str, Any]:
        """
        Get the next action from the LLM.
        
        Args:
            agent: The agent
            task: The task
            event_log: Current event log
            
        Returns:
            Parsed action dictionary
        """
        # Determine which template to use
        last_event = event_log.get_last_event()
        if isinstance(last_event, ErrorEvent):
            # Use error recovery template
            prompt = self.prompt_manager.build_error_recovery_prompt(
                event_log, agent, task, last_event.error_message
            )
        else:
            # Use regular template
            prompt = self.prompt_manager.build_prompt("react", event_log, agent, task)
        
        # 准备消息列表
        messages = [{"role": "user", "content": prompt}]
        
        # === Before LLM Call Hooks ===
        iteration_count = len(event_log.get_events_by_type("llm_call"))
        hook_context = LLMCallHookContext(
            messages=messages,
            agent_id=agent.id,
            agent_name=agent.name,
            task_id=task.id,
            iterations=iteration_count,
            model_name=getattr(self.llm_provider, 'model', 'unknown'),
        )
        
        # 执行全局 before hooks
        should_continue = execute_before_llm_call_hooks(hook_context)
        
        # 执行 Agent 级别的 before hooks
        if should_continue and agent.llm_hooks and agent.llm_hooks.get('before'):
            for hook in agent.llm_hooks['before']:
                try:
                    result = hook(hook_context)
                    if result is False:
                        should_continue = False
                        break
                except Exception as e:
                    logger.warning(f"Agent LLM before hook error: {e}")
        
        if not should_continue:
            # Hooks 阻止了 LLM 调用，返回默认 finish 动作
            logger.info("LLM call blocked by hook")
            return {
                "action": "finish_task",
                "result": "LLM call blocked by hook",
                "reasoning": "A registered hook blocked the LLM call"
            }
        
        # Call LLM
        llm_call_event = LLMCallEvent(
            prompt=prompt,
            model=getattr(self.llm_provider, 'model', 'unknown'),
            agent_id=agent.id,
            task_id=task.id
        )
        event_log.append(llm_call_event)

        # 使用可能被 hooks 修改的 messages
        response = self.llm_provider.invoke(hook_context.messages)

        # Handle token usage safely
        token_usage = None
        if response.token_usage:
            if hasattr(response.token_usage, '__dict__'):
                token_usage = response.token_usage.__dict__
            elif isinstance(response.token_usage, dict):
                token_usage = response.token_usage
        
        # === After LLM Call Hooks ===
        hook_context.response = response.content
        
        # 执行全局 after hooks
        modified_response = execute_after_llm_call_hooks(hook_context)
        
        # 执行 Agent 级别的 after hooks
        if agent.llm_hooks and agent.llm_hooks.get('after'):
            for hook in agent.llm_hooks['after']:
                try:
                    result = hook(hook_context)
                    if result is not None:
                        modified_response = result
                        hook_context.response = result
                except Exception as e:
                    logger.warning(f"Agent LLM after hook error: {e}")
        
        # 使用可能被修改的响应
        final_response = modified_response if modified_response is not None else response.content
        
        # StreamContentAccumulator integration: accumulate response content
        # Even for non-streaming responses, we can use accumulator for consistency
        accumulator = StreamContentAccumulator()
        accumulator.set_base_content("")
        accumulator.add_streaming_content(final_response)
        
        llm_response_event = LLMResponseEvent(
            response=final_response,
            token_usage=token_usage,
            cost=response.cost,
            agent_id=agent.id,
            task_id=task.id
        )
        event_log.append(llm_response_event)

        # Parse action using accumulated content
        accumulated_content = accumulator.get_full_content()
        action = self.action_parser.parse_action(accumulated_content)
        
        return action
    
    def _execute_action(self, action: Dict[str, Any], event_log: EventLog, agent: Optional[Agent] = None):
        """
        Execute an action based on its type.
        This is the core switch statement that routes actions.
        
        Args:
            action: The action to execute
            event_log: Event log to record events
            agent: The agent (optional, for accessing agent-level hooks)
        """
        action_type = action["action"]
        
        if action_type == "tool_call":
            self._execute_tool_call(action, event_log, agent)
        elif action_type == "human_request":
            self._execute_human_request(action, event_log)
        elif action_type == "finish_task":
            self._execute_finish_task(action, event_log, agent)
        else:
            raise ValueError(f"Unknown action type: {action_type}")
    
    def _execute_tool_call(self, action: Dict[str, Any], event_log: EventLog, agent: Optional[Agent] = None):
        """Execute a tool call action with Hooks integration."""
        tool_name = action["tool"]
        tool_args = action.get("args", {})
        intent = action.get("reasoning", "No reasoning provided")
        
        # Get tool first for hook context
        tool = self.tool_registry.get(tool_name)
        
        # === Before Tool Call Hooks ===
        hook_context = ToolCallHookContext(
            tool_name=tool_name,
            tool_input=tool_args.copy(),  # 复制以便 hooks 可以修改
            tool=tool,
            agent_id=event_log.agent_id,
            agent_name=agent.name if agent else None,
            task_id=event_log.task_id,
        )
        
        # 执行全局 before hooks
        should_continue = execute_before_tool_call_hooks(hook_context)
        
        # 执行 Agent 级别的 before hooks
        if should_continue and agent and agent.tool_hooks and agent.tool_hooks.get('before'):
            for hook in agent.tool_hooks['before']:
                try:
                    result = hook(hook_context)
                    if result is False:
                        should_continue = False
                        break
                except Exception as e:
                    logger.warning(f"Agent Tool before hook error: {e}")
        
        if not should_continue:
            # Hooks 阻止了工具调用
            logger.info(f"Tool call '{tool_name}' blocked by hook")
            tool_result_event = ToolResultEvent(
                tool_name=tool_name,
                success=False,
                error="Tool call blocked by hook",
                agent_id=event_log.agent_id,
                task_id=event_log.task_id
            )
            event_log.append(tool_result_event)
            raise ValueError(f"Tool call '{tool_name}' blocked by hook")
        
        # 使用可能被 hooks 修改的参数
        tool_args = hook_context.tool_input
        
        # Record tool call event
        tool_call_event = ToolCallEvent(
            tool_name=tool_name,
            tool_args=tool_args,
            intent=intent,
            agent_id=event_log.agent_id,
            task_id=event_log.task_id
        )
        event_log.append(tool_call_event)
        
        if not tool:
            # Record the error before raising
            tool_result_event = ToolResultEvent(
                tool_name=tool_name,
                success=False,
                error=f"Tool '{tool_name}' not found",
                agent_id=event_log.agent_id,
                task_id=event_log.task_id
            )
            event_log.append(tool_result_event)
            raise ValueError(f"Tool '{tool_name}' not found")
        
        # 使用 ToolExecutor 执行工具
        from ..tools.executor import ToolExecutor

        executor = ToolExecutor()
        try:
            execution_result = executor.execute(
                tool,
                agent_id=event_log.agent_id,
                task_id=event_log.task_id,
                **tool_args
            )
            
            if execution_result.success:
                # === After Tool Call Hooks ===
                hook_context.tool_result = str(execution_result.result) if execution_result.result else ""
                
                # 执行全局 after hooks
                modified_result = execute_after_tool_call_hooks(hook_context)
                
                # 执行 Agent 级别的 after hooks
                if agent and agent.tool_hooks and agent.tool_hooks.get('after'):
                    for hook in agent.tool_hooks['after']:
                        try:
                            result = hook(hook_context)
                            if result is not None:
                                modified_result = result
                                hook_context.tool_result = result
                        except Exception as e:
                            logger.warning(f"Agent Tool after hook error: {e}")
                
                # 使用可能被修改的结果
                final_result = modified_result if modified_result is not None else execution_result.result
                
                tool_result_event = ToolResultEvent(
                    tool_name=tool_name,
                    success=True,
                    result=final_result,
                    agent_id=event_log.agent_id,
                    task_id=event_log.task_id
                )
            else:
                if execution_result.error:
                    raise execution_result.error
                else:
                    raise Exception("Tool execution failed without specific error")

        except ApprovalRequiredError as e:
            # 创建人工请求事件
            human_request_event = HumanRequestEvent(
                question=e.message,
                context=f"Tool: {e.tool_name}, Args: {e.kwargs}",
                urgency="high",
                agent_id=event_log.agent_id,
                task_id=event_log.task_id
            )
            event_log.append(human_request_event)
            # 重新抛出异常，让上层处理
            raise e
            
        except Exception as e:
            # 记录失败
            tool_result_event = ToolResultEvent(
                tool_name=tool_name,
                success=False,
                error=str(e),
                agent_id=event_log.agent_id,
                task_id=event_log.task_id
            )
            event_log.append(tool_result_event)
            raise e
        
        event_log.append(tool_result_event)
    
    def _execute_human_request(self, action: Dict[str, Any], event_log: EventLog):
        """Execute a human request action."""
        question = action["question"]
        context = action.get("context", "")
        urgency = action.get("urgency", "medium")
        
        human_request_event = HumanRequestEvent(
            question=question,
            context=context,
            urgency=urgency,
            agent_id=event_log.agent_id,
            task_id=event_log.task_id
        )
        event_log.append(human_request_event)
    
    def _execute_finish_task(
        self,
        action: Dict[str, Any],
        event_log: EventLog,
        agent: Optional[Agent] = None,
    ):
        """Execute a finish task action."""
        result = action["result"]
        reasoning = action.get("reasoning", "Task completed")

        if agent and agent.guiderails:
            context = GuideRailsContext(
                agent_id=event_log.agent_id,
                task_id=event_log.task_id,
                metadata={"reasoning": reasoning},
            )
            guiderails_result = agent.guiderails.run(
                result,
                context,
                config=agent.guiderails_config,
            )

            if guiderails_result.action == GuideRailsAction.ABORT:
                # Record abort event to event log before raising exception
                abort_summary = guiderails_result.summary()
                abort_event = ErrorEvent(
                    error_type="guiderails_abort",
                    error_message=abort_summary,
                    recoverable=False,
                    agent_id=event_log.agent_id,
                    task_id=event_log.task_id
                )
                event_log.append(abort_event)
                raise GuideRailsAbortError(abort_summary)

            if guiderails_result.action == GuideRailsAction.MODIFY:
                result = guiderails_result.output
                if guiderails_result.reasons:
                    reasoning = f"{reasoning}\nGuideRails: {guiderails_result.summary()}"
        
        finish_event = FinishTaskEvent(
            final_result=result,
            reasoning=reasoning,
            agent_id=event_log.agent_id,
            task_id=event_log.task_id
        )
        event_log.append(finish_event)
    
    def _get_best_result(self, event_log: EventLog) -> Any:
        """
        Extract the best result from the event log when execution ends without a finish event.
        
        Args:
            event_log: The event log
            
        Returns:
            Best available result
        """
        # Look for the last successful tool result
        for event in reversed(event_log.events):
            if isinstance(event, ToolResultEvent) and event.success:
                return event.result
        
        # If no successful tool results, return a summary
        return {
            "status": "incomplete",
            "message": "Task execution ended without completion",
            "steps_completed": len(event_log.events)
        }
    
    def _get_execution_stats(self, event_log: EventLog) -> Dict[str, Any]:
        """
        Generate execution statistics from the event log.
        
        Args:
            event_log: The event log
            
        Returns:
            Statistics dictionary
        """
        stats = {
            "total_events": len(event_log.events),
            "tool_calls": len(event_log.get_events_by_type("tool_call")),
            "llm_calls": len(event_log.get_events_by_type("llm_call")),
            "errors": len(event_log.get_events_by_type("error")),
            "human_requests": len(event_log.get_events_by_type("human_request")),
            "final_state": event_log.get_current_state()
        }
        
        # Calculate token usage
        llm_responses = event_log.get_events_by_type("llm_response")
        total_tokens = 0
        total_cost = 0.0
        
        for event in llm_responses:
            # Type check to ensure we only access token_usage on LLMResponseEvent
            if isinstance(event, LLMResponseEvent):
                if event.token_usage:
                    total_tokens += event.token_usage.get('total_tokens', 0)
                if event.cost:
                    total_cost += event.cost
        
        stats["token_usage"] = total_tokens
        stats["estimated_cost"] = total_cost
        
        return stats
    
    def add_tool(self, tool: BaseTool):
        """Add a tool to the registry."""
        self.tool_registry.register(tool)
    
    def remove_tool(self, tool_name: str):
        """Remove a tool from the registry."""
        if tool_name in self.tool_registry.tools:
            del self.tool_registry.tools[tool_name]
    
    def list_tools(self) -> List[str]:
        """List all available tools."""
        return self.tool_registry.list_tools() 
    
    # =========================================================================
    # 并行工具执行方法
    # =========================================================================
    
    async def execute_parallel_tool_calls(
        self,
        tool_calls: List[Dict[str, Any]],
        event_log: Optional[EventLog] = None,
        fail_fast: bool = False,
        max_concurrency: Optional[int] = None,
    ) -> ParallelExecutionSummary:
        """
        并行执行多个工具调用。
        
        设计原理：
        - Agno 在单次迭代中支持并行执行 LLM 返回的多个独立工具调用
        - 使用 asyncio.gather 实现真正的并发执行
        - 单个工具失败默认不阻断其他工具（除非 fail_fast=True）
        
        Args:
            tool_calls: 工具调用列表，每个元素包含 {"tool": "tool_name", "args": {...}}
            event_log: 可选的事件日志，用于记录执行过程
            fail_fast: 如果为 True，任一工具失败立即终止所有执行
            max_concurrency: 最大并发数，None 表示不限制
            
        Returns:
            ParallelExecutionSummary: 并行执行的汇总结果
            
        Example:
            >>> tool_calls = [
            ...     {"tool": "search", "args": {"query": "AI"}},
            ...     {"tool": "calculator", "args": {"expr": "2+2"}},
            ... ]
            >>> summary = await executor.execute_parallel_tool_calls(tool_calls)
            >>> print(f"成功: {summary.successful}/{summary.total_tools}")
        """
        start_time = time.perf_counter()
        results: List[ParallelToolResult] = []
        
        if not tool_calls:
            return ParallelExecutionSummary(
                total_tools=0,
                successful=0,
                failed=0,
                total_time_ms=0.0,
                results=[],
            )
        
        # 创建异步任务列表
        async def execute_single_tool(call: Dict[str, Any]) -> ParallelToolResult:
            tool_name = call.get("tool", call.get("tool_name", "unknown"))
            tool_args = call.get("args", call.get("tool_args", {}))
            tool_start = time.perf_counter()
            
            try:
                tool = self.tool_registry.get(tool_name)
                if not tool:
                    raise ValueError(f"Tool '{tool_name}' not found")
                
                # 使用 ToolExecutor 执行工具
                from ..tools.executor import ToolExecutor
                executor = ToolExecutor()
                execution_result = executor.execute(
                    tool,
                    agent_id=event_log.agent_id,
                    task_id=event_log.task_id,
                    **tool_args
                )
                
                execution_time_ms = (time.perf_counter() - tool_start) * 1000
                
                if execution_result.success:
                    return ParallelToolResult(
                        tool_name=tool_name,
                        tool_args=tool_args,
                        success=True,
                        result=execution_result.result,
                        execution_time_ms=execution_time_ms,
                    )
                else:
                    return ParallelToolResult(
                        tool_name=tool_name,
                        tool_args=tool_args,
                        success=False,
                        error=str(execution_result.error) if execution_result.error else "Unknown error",
                        execution_time_ms=execution_time_ms,
                    )
                    
            except Exception as e:
                execution_time_ms = (time.perf_counter() - tool_start) * 1000
                return ParallelToolResult(
                    tool_name=tool_name,
                    tool_args=tool_args,
                    success=False,
                    error=str(e),
                    execution_time_ms=execution_time_ms,
                )
        
        # 使用 asyncio.gather 并行执行
        if max_concurrency and max_concurrency > 0:
            # 使用信号量限制并发数
            semaphore = asyncio.Semaphore(max_concurrency)
            
            async def limited_execute(call: Dict[str, Any]) -> ParallelToolResult:
                async with semaphore:
                    return await execute_single_tool(call)
            
            tasks = [limited_execute(call) for call in tool_calls]
        else:
            tasks = [execute_single_tool(call) for call in tool_calls]
        
        if fail_fast:
            # 任一失败立即抛出异常
            results = await asyncio.gather(*tasks)
            # 检查是否有失败
            for result in results:
                if not result.success:
                    raise RuntimeError(f"Tool '{result.tool_name}' failed: {result.error}")
        else:
            # 收集所有结果，不管成功或失败
            results = await asyncio.gather(*tasks, return_exceptions=False)
        
        # 记录事件日志（如果提供）
        if event_log:
            for result in results:
                tool_call_event = ToolCallEvent(
                    tool_name=result.tool_name,
                    tool_args=result.tool_args,
                    intent=f"Parallel execution",
                    agent_id=event_log.agent_id,
                    task_id=event_log.task_id,
                )
                event_log.append(tool_call_event)
                
                tool_result_event = ToolResultEvent(
                    tool_name=result.tool_name,
                    success=result.success,
                    result=result.result if result.success else None,
                    error=result.error if not result.success else None,
                    agent_id=event_log.agent_id,
                    task_id=event_log.task_id,
                )
                event_log.append(tool_result_event)
        
        total_time_ms = (time.perf_counter() - start_time) * 1000
        successful = sum(1 for r in results if r.success)
        failed = len(results) - successful
        
        logger.info(
            f"Parallel tool execution completed: {successful}/{len(results)} successful "
            f"in {total_time_ms:.2f}ms"
        )
        
        return ParallelExecutionSummary(
            total_tools=len(results),
            successful=successful,
            failed=failed,
            total_time_ms=total_time_ms,
            results=results,
        )
    
    def execute_parallel_tool_calls_sync(
        self,
        tool_calls: List[Dict[str, Any]],
        event_log: Optional[EventLog] = None,
        fail_fast: bool = False,
        max_concurrency: Optional[int] = None,
    ) -> ParallelExecutionSummary:
        """
        并行工具执行的同步版本（便于在非异步上下文中使用）。
        """
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
        
        return loop.run_until_complete(
            self.execute_parallel_tool_calls(
                tool_calls=tool_calls,
                event_log=event_log,
                fail_fast=fail_fast,
                max_concurrency=max_concurrency,
            )
        )
    
    # =========================================================================
    # Context Compiler 集成方法
    # =========================================================================
    
    async def _maybe_compact_context(self, event_log: EventLog) -> None:
        """
        检查并执行上下文压缩（如果需要）。
        
        这是 ADK "Compiled View" 机制的核心入口。
        在每次 LLM 调用前检查 EventLog 是否需要压缩。
        """
        if not self.context_compiler:
            return
        
        try:
            compacted_event = await self.context_compiler.maybe_compact(event_log)
            if compacted_event:
                logger.info(
                    f"Context compacted: {len(compacted_event.compressed_event_ids)} events -> "
                    f"{compacted_event.token_count_after} tokens "
                    f"(ratio: {compacted_event.get_compression_ratio():.2f})"
                )
        except Exception as e:
            logger.warning(f"Context compaction failed (non-blocking): {e}")
    
    def set_compaction_config(self, config: CompactionConfig) -> None:
        """动态更新压缩配置。"""
        self.compaction_config = config
        if self.context_compiler:
            self.context_compiler.config = config
    
    def disable_context_compilation(self) -> None:
        """禁用上下文编译。"""
        self.enable_context_compilation = False
    
    def enable_context_compilation_feature(self) -> None:
        """启用上下文编译。"""
        self.enable_context_compilation = True
        if not self.context_compiler:
            self.context_compiler = create_context_compiler(
                llm_provider=self.llm_provider,
                config=self.compaction_config
            )