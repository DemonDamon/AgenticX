"""
AgenticX Core Module

This module contains the core abstractions and data structures for the AgenticX framework.
"""

from .agent import Agent, AgentContext, AgentResult
from .task import Task
from .tool import BaseTool, FunctionTool, tool
from .workflow import Workflow, WorkflowNode, WorkflowEdge
from .message import Message, ProtocolMessage
from .platform import User, Organization
from .component import Component

# M5: Agent Core Components
from .event import (
    Event, EventLog, AnyEvent,
    TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent,
    ErrorEvent, LLMCallEvent, LLMResponseEvent, HumanRequestEvent,
    HumanResponseEvent, FinishTaskEvent
)
from .prompt import PromptManager, ContextRenderer, XMLContextRenderer, PromptTemplate
from .error_handler import ErrorHandler, ErrorClassifier, CircuitBreaker, CircuitBreakerOpenError
from .communication import CommunicationInterface, BroadcastCommunication, AsyncCommunicationInterface
from .agent_executor import AgentExecutor, ToolRegistry, ActionParser

# M6: Task Contract & Outcome Validation
from .task_validator import (
    TaskOutputParser, TaskResultValidator, OutputRepairLoop,
    ParseResult, ValidationResult, RepairStrategy,
    ParseError, ValidationError, RepairError
)

# M7: Orchestration & Routing Engine
from .workflow_engine import (
    WorkflowEngine, WorkflowGraph, TriggerService,
    ScheduledTrigger, EventDrivenTrigger,
    ExecutionContext, NodeExecution, WorkflowStatus, NodeStatus,
    WorkflowResult
)

# 为了向后兼容，添加 WorkflowContext 别名
WorkflowContext = ExecutionContext

__all__ = [
    # Core abstractions
    "Agent",
    "AgentContext",
    "AgentResult",
    "Task", 
    "BaseTool",
    "FunctionTool",
    "tool",
    "Workflow",
    "WorkflowNode", 
    "WorkflowEdge",
    "Message",
    "ProtocolMessage",
    "Component",
    # Platform entities
    "User",
    "Organization",
    # M5: Agent Core Components
    # Event System
    "Event",
    "EventLog", 
    "AnyEvent",
    "TaskStartEvent",
    "TaskEndEvent",
    "ToolCallEvent", 
    "ToolResultEvent",
    "ErrorEvent",
    "LLMCallEvent",
    "LLMResponseEvent", 
    "HumanRequestEvent",
    "HumanResponseEvent",
    "FinishTaskEvent",
    # Prompt Management
    "PromptManager",
    "ContextRenderer",
    "XMLContextRenderer", 
    "PromptTemplate",
    # Error Handling
    "ErrorHandler",
    "ErrorClassifier",
    "CircuitBreaker",
    "CircuitBreakerOpenError",
    # Communication
    "CommunicationInterface",
    "BroadcastCommunication", 
    "AsyncCommunicationInterface",
    # Agent Execution
    "AgentExecutor",
    "ToolRegistry",
    "ActionParser",
    # Task Validation
    "TaskOutputParser",
    "TaskResultValidator",
    "OutputRepairLoop",
    "ParseResult",
    "ValidationResult",
    "RepairStrategy",
    "ParseError",
    "ValidationError",
    "RepairError",
    # Workflow Orchestration
    "WorkflowEngine",
    "WorkflowGraph",
    "TriggerService",
    "ScheduledTrigger",
    "EventDrivenTrigger",
    "ExecutionContext",
    "WorkflowContext",  # 别名
    "WorkflowResult",
    "NodeExecution",
    "WorkflowStatus",
    "NodeStatus"
]