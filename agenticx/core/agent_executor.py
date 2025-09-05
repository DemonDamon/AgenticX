import json
import asyncio
from typing import Dict, Any, List, Optional, Callable, Union
from abc import ABC, abstractmethod

from ..llms.base import BaseLLMProvider
from ..llms.response import LLMResponse
from ..tools.base import BaseTool
from agenticx.tools.security import ApprovalRequiredError
from .agent import Agent
from .task import Task
from .event import (
    EventLog, AnyEvent, TaskStartEvent, TaskEndEvent, ToolCallEvent, 
    ToolResultEvent, ErrorEvent, LLMCallEvent, LLMResponseEvent,
    HumanRequestEvent, HumanResponseEvent, FinishTaskEvent
)
from .prompt import PromptManager
from .error_handler import ErrorHandler
from .communication import CommunicationInterface


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
    """
    
    def __init__(
        self,
        llm_provider: BaseLLMProvider,
        tools: Optional[List[BaseTool]] = None,
        prompt_manager: Optional[PromptManager] = None,
        error_handler: Optional[ErrorHandler] = None,
        communication: Optional[CommunicationInterface] = None,
        max_iterations: int = 50
    ):
        self.llm_provider = llm_provider
        self.prompt_manager = prompt_manager or PromptManager()
        self.error_handler = error_handler or ErrorHandler()
        self.communication = communication
        self.max_iterations = max_iterations
        
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
                # Get next action from LLM
                action = self._get_next_action(agent, task, event_log)
                
                # Execute the action
                self._execute_action(action, event_log)
                
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
        
        # Call LLM
        llm_call_event = LLMCallEvent(
            prompt=prompt,
            model=getattr(self.llm_provider, 'model', 'unknown'),
            agent_id=agent.id,
            task_id=task.id
        )
        event_log.append(llm_call_event)

        # 始终用self.llm_provider调用LLM，不用agent.model
        response = self.llm_provider.invoke([{"role": "user", "content": prompt}])

        # Handle token usage safely
        token_usage = None
        if response.token_usage:
            if hasattr(response.token_usage, '__dict__'):
                token_usage = response.token_usage.__dict__
            elif isinstance(response.token_usage, dict):
                token_usage = response.token_usage
        
        llm_response_event = LLMResponseEvent(
            response=response.content,
            token_usage=token_usage,
            cost=response.cost,
            agent_id=agent.id,
            task_id=task.id
        )
        event_log.append(llm_response_event)

        # Parse action
        action = self.action_parser.parse_action(response.content)
        
        return action
    
    def _execute_action(self, action: Dict[str, Any], event_log: EventLog):
        """
        Execute an action based on its type.
        This is the core switch statement that routes actions.
        
        Args:
            action: The action to execute
            event_log: Event log to record events
        """
        action_type = action["action"]
        
        if action_type == "tool_call":
            self._execute_tool_call(action, event_log)
        elif action_type == "human_request":
            self._execute_human_request(action, event_log)
        elif action_type == "finish_task":
            self._execute_finish_task(action, event_log)
        else:
            raise ValueError(f"Unknown action type: {action_type}")
    
    def _execute_tool_call(self, action: Dict[str, Any], event_log: EventLog):
        """Execute a tool call action."""
        tool_name = action["tool"]
        tool_args = action.get("args", {})
        intent = action.get("reasoning", "No reasoning provided")
        
        # Record tool call event
        tool_call_event = ToolCallEvent(
            tool_name=tool_name,
            tool_args=tool_args,
            intent=intent,
            agent_id=event_log.agent_id,
            task_id=event_log.task_id
        )
        event_log.append(tool_call_event)
        
        # Get tool
        tool = self.tool_registry.get(tool_name)
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
            execution_result = executor.execute(tool, **tool_args)
            
            if execution_result.success:
                tool_result_event = ToolResultEvent(
                    tool_name=tool_name,
                    success=True,
                    result=execution_result.result,
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
    
    def _execute_finish_task(self, action: Dict[str, Any], event_log: EventLog):
        """Execute a finish task action."""
        result = action["result"]
        reasoning = action.get("reasoning", "Task completed")
        
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