"""
AgenticX Core Module

This module contains the core abstractions and data structures for the AgenticX framework.
"""

# Core tool components (v2)
from .tool_v2 import (
    BaseTool,
    ToolMetadata,
    ToolParameter,
    ToolResult,
    ToolContext,
    ToolStatus,
    ParameterType,
    ToolCategory,
)

# Registry and factory
from .registry import (
    ToolRegistry,
    ToolFactory,
    ToolRegistrationError,
    ToolNotFoundError,
    ToolValidationError,
    get_registry as get_tool_registry,
    get_factory as get_tool_factory,
)

# Execution engine
from .executor import (
    ToolExecutor,
    ExecutionConfig,
    ExecutionMetrics,
    ResourceMonitor,
    SandboxedEnvironment,
    get_executor as get_tool_executor,
)

# Security management
from .security import (
    SecurityManager,
    SecurityLevel,
    Permission,
    SecurityPolicy,
    AuditLogEntry,
    SecurityException,
    PermissionDeniedException,
    RateLimitExceededException,
    AuthenticationException,
    AuthorizationException,
    CredentialStore,
    get_security_manager,
    check_permission,
    authorize_action,
    log_audit,
)

# Protocol adapters
from .adapters import (
    ProtocolType,
    ProtocolAdapter,
    ProtocolAdapterFactory,
    OpenAIAdapter,
    MCPAdapter,
    MultiProtocolAdapter,
    create_openai_adapter,
    create_mcp_adapter,
    create_multi_protocol_adapter,
)

# Marketplace
from .marketplace import (
    ToolMarketplace,
    ToolManifest,
    ToolListing,
    ToolReview,
    ToolStatus as MarketplaceToolStatus,
    ToolCategory as MarketplaceToolCategory,
    MarketplaceException,
    ToolNotFoundException as MarketplaceToolNotFoundException,
    ToolAlreadyExistsException,
    PermissionDeniedException as MarketplacePermissionDeniedException,
    RemoteMarketplaceClient,
    get_marketplace,
)

# Tool System Integration
from .tool_system import (
    ToolSystem,
    ToolSystemConfig,
    create_tool_system,
    get_tool_system,
    shutdown_tool_system,
)

# Legacy imports for backward compatibility
from .agent import Agent, AgentContext, AgentResult
from .task import Task
from .tool import BaseTool as LegacyBaseTool, FunctionTool, tool
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
from .agent_executor import AgentExecutor, ToolRegistry as LegacyToolRegistry, ActionParser

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
    # Tool System v2 - Core Components
    "BaseTool",
    "ToolMetadata", 
    "ToolParameter",
    "ToolResult",
    "ToolContext",
    "ToolStatus",
    "ParameterType",
    "ToolCategory",
    
    # Tool System v2 - Registry & Factory
    "ToolRegistry",
    "ToolFactory", 
    "ToolRegistrationError",
    "ToolNotFoundError",
    "ToolValidationError",
    "get_tool_registry",
    "get_tool_factory",
    
    # Tool System v2 - Execution Engine
    "ToolExecutor",
    "ExecutionConfig",
    "ExecutionMetrics", 
    "ResourceMonitor",
    "SandboxedEnvironment",
    "get_tool_executor",
    
    # Tool System v2 - Security Management
    "SecurityManager",
    "SecurityLevel",
    "Permission",
    "SecurityPolicy", 
    "AuditLogEntry",
    "SecurityException",
    "PermissionDeniedException",
    "RateLimitExceededException",
    "AuthenticationException", 
    "AuthorizationException",
    "CredentialStore",
    "get_security_manager",
    "check_permission",
    "authorize_action",
    "log_audit",
    
    # Tool System v2 - Protocol Adapters
    "ProtocolType",
    "ProtocolAdapter",
    "ProtocolAdapterFactory",
    "OpenAIAdapter", 
    "MCPAdapter",
    "MultiProtocolAdapter",
    "create_openai_adapter",
    "create_mcp_adapter",
    "create_multi_protocol_adapter",
    
    # Tool System v2 - Marketplace
    "ToolMarketplace",
    "ToolManifest",
    "ToolListing", 
    "ToolReview",
    "MarketplaceToolStatus",
    "MarketplaceToolCategory",
    "MarketplaceException",
    "MarketplaceToolNotFoundException",
    "ToolAlreadyExistsException",
    "MarketplacePermissionDeniedException",
    "RemoteMarketplaceClient",
    "get_marketplace",
    
    # Tool System Integration
    "ToolSystem",
    "ToolSystemConfig",
    "create_tool_system",
    "get_tool_system",
    "shutdown_tool_system",
    
    # Legacy Core abstractions (for backward compatibility)
    "Agent",
    "AgentContext",
    "AgentResult",
    "Task", 
    "LegacyBaseTool",
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
    "LegacyToolRegistry",
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