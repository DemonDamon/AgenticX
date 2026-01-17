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

# Marketplace (lazy / best-effort import to avoid sandbox SSL issues)
try:
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
except Exception:  # pragma: no cover - sandbox may block requests SSL
    ToolMarketplace = None  # type: ignore
    ToolManifest = None  # type: ignore
    ToolListing = None  # type: ignore
    ToolReview = None  # type: ignore
    MarketplaceToolStatus = None  # type: ignore
    MarketplaceToolCategory = None  # type: ignore
    MarketplaceException = None  # type: ignore
    MarketplaceToolNotFoundException = None  # type: ignore
    ToolAlreadyExistsException = None  # type: ignore
    MarketplacePermissionDeniedException = None  # type: ignore
    RemoteMarketplaceClient = None  # type: ignore
    get_marketplace = None  # type: ignore

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
    HumanResponseEvent, FinishTaskEvent,
    # Context Compiler 新增
    CompactedEvent, CompactionConfig
)
from .prompt import PromptManager, ContextRenderer, XMLContextRenderer, PromptTemplate, CompiledContextRenderer

# Context Compiler (参考自 ADK 的 Compiled View)
from .context_compiler import (
    ContextCompiler, EventSummarizer, LLMEventSummarizer, SimpleEventSummarizer,
    create_context_compiler, create_mining_compiler,
    DEFAULT_COMPACTION_PROMPT, MINING_TASK_PROMPT, PROMPT_TEMPLATES,
    CompactionStrategy
)

# Token Counter (精确 Token 计数)
from .token_counter import (
    TokenCounter, TokenStats, ModelFamily,
    count_tokens, estimate_cost, truncate_text
)
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

# Code-as-Action executor (lightweight, sandboxed)
from .code_action_executor import CodeActionExecutor, CodeActionResult

# Slave Parallel Executor (task-level parallelism)
from .slave_parallel_executor import SlaveParallelExecutor, ParallelTaskResult

# Plan Notebook (参考自 AgentScope 的 Plan Module)
from .plan_storage import (
    Plan, SubTask, 
    PlanStorageBase, InMemoryPlanStorage, SQLitePlanStorage
)
from .plan_notebook import (
    PlanNotebook, DefaultPlanToHint, ToolResult as PlanToolResult
)

# Discovery Loop (参考自 AgentScope 的动态能力扩展)
from .discovery import (
    Discovery, DiscoveryType, DiscoveryPriority, DiscoveryStatus,
    DiscoveryBus, DiscoveryRegistry, DiscoveryEvent,
    get_discovery_bus, reset_discovery_bus,
)

# Interruption & State Recovery (参考自 AgentScope 的 Realtime Steering)
from .interruption import (
    InterruptSignal, InterruptReason, InterruptStrategy,
    ExecutionSnapshot, InterruptionManager, InterruptibleTask,
    get_interrupt_manager, reset_interrupt_manager,
)

# Memory Extraction Pipeline (参考自 AIGNE Framework)
from .memory_extraction import (
    MemoryFact, MemoryScope, MemoryExtractionConfig, ExtractionResult,
    BaseMemoryExtractor, LLMMemoryExtractor, SimpleMemoryExtractor,
    SessionMemoryManager, UserMemoryManager,
    create_memory_extractor, create_session_memory_manager,
)

# Hooks System (参考 crewAI，用于 Eigent 增强)
from .hooks import (
    LLMCallHookContext,
    ToolCallHookContext,
    LLMHookFunction,
    ToolHookFunction,
    register_before_llm_call_hook,
    register_after_llm_call_hook,
    unregister_before_llm_call_hook,
    unregister_after_llm_call_hook,
    execute_before_llm_call_hooks,
    execute_after_llm_call_hooks,
    clear_all_llm_hooks,
    get_registered_llm_hooks,
    register_before_tool_call_hook,
    register_after_tool_call_hook,
    unregister_before_tool_call_hook,
    unregister_after_tool_call_hook,
    execute_before_tool_call_hooks,
    execute_after_tool_call_hooks,
    clear_all_tool_hooks,
    get_registered_tool_hooks,
)

# GuideRails (post-output validation)
from .guiderails import (
    GuideRailsAction, GuideRailsResult, GuideRailsConfig, GuideRailsContext,
    GuideRailsAbortError, GuideRailsRunResult, GuideRailsValidator,
    BaseGuideRailsValidator, GuideRails,
)

# Handoff Mechanism (参考自 AIGNE Framework)
from .handoff import (
    HandoffOutput, AgentHandoffEvent, AgentHandoffError,
    HandoffCycleError, HandoffTargetNotFoundError,
    is_handoff_output, parse_handoff_output,
    create_handoff_event, check_handoff_cycle,
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
    # Context Compiler (参考自 ADK)
    "CompactedEvent",
    "CompactionConfig",
    "ContextCompiler",
    "EventSummarizer",
    "LLMEventSummarizer",
    "SimpleEventSummarizer",
    "create_context_compiler",
    "create_mining_compiler",
    "DEFAULT_COMPACTION_PROMPT",
    "MINING_TASK_PROMPT",
    "PROMPT_TEMPLATES",
    "CompactionStrategy",
    # Token Counter
    "TokenCounter",
    "TokenStats",
    "ModelFamily",
    "count_tokens",
    "estimate_cost",
    "truncate_text",
    # Prompt Management
    "PromptManager",
    "ContextRenderer",
    "XMLContextRenderer", 
    "CompiledContextRenderer",
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

    # Code-as-Action
    "CodeActionExecutor",
    "CodeActionResult",

    # Slave Parallelism
    "SlaveParallelExecutor",
    "ParallelTaskResult",
    "NodeExecution",
    "WorkflowStatus",
    "NodeStatus",
    # Plan Notebook (参考自 AgentScope)
    "Plan",
    "SubTask",
    "PlanStorageBase",
    "InMemoryPlanStorage",
    "SQLitePlanStorage",
    "PlanNotebook",
    "DefaultPlanToHint",
    "PlanToolResult",
    # Discovery Loop (参考自 AgentScope)
    "Discovery",
    "DiscoveryType",
    "DiscoveryPriority",
    "DiscoveryStatus",
    "DiscoveryBus",
    "DiscoveryRegistry",
    "DiscoveryEvent",
    "get_discovery_bus",
    "reset_discovery_bus",
    # Interruption & State Recovery (参考自 AgentScope)
    "InterruptSignal",
    "InterruptReason",
    "InterruptStrategy",
    "ExecutionSnapshot",
    "InterruptionManager",
    "InterruptibleTask",
    "get_interrupt_manager",
    "reset_interrupt_manager",
    # Memory Extraction Pipeline (参考自 AIGNE)
    "MemoryFact",
    "MemoryScope",
    "MemoryExtractionConfig",
    "ExtractionResult",
    "BaseMemoryExtractor",
    "LLMMemoryExtractor",
    "SimpleMemoryExtractor",
    "SessionMemoryManager",
    "UserMemoryManager",
    "create_memory_extractor",
    "create_session_memory_manager",
    # GuideRails
    "GuideRailsAction",
    "GuideRailsResult",
    "GuideRailsConfig",
    "GuideRailsContext",
    "GuideRailsAbortError",
    "GuideRailsRunResult",
    "GuideRailsValidator",
    "BaseGuideRailsValidator",
    "GuideRails",
    # Handoff Mechanism (参考自 AIGNE)
    "HandoffOutput",
    "AgentHandoffEvent",
    "AgentHandoffError",
    "HandoffCycleError",
    "HandoffTargetNotFoundError",
    "is_handoff_output",
    "parse_handoff_output",
    "create_handoff_event",
    "check_handoff_cycle",
    # Hooks System (参考 crewAI，用于 Eigent 增强)
    "LLMCallHookContext",
    "ToolCallHookContext",
    "LLMHookFunction",
    "ToolHookFunction",
    "register_before_llm_call_hook",
    "register_after_llm_call_hook",
    "unregister_before_llm_call_hook",
    "unregister_after_llm_call_hook",
    "execute_before_llm_call_hooks",
    "execute_after_llm_call_hooks",
    "clear_all_llm_hooks",
    "get_registered_llm_hooks",
    "register_before_tool_call_hook",
    "register_after_tool_call_hook",
    "unregister_before_tool_call_hook",
    "unregister_after_tool_call_hook",
    "execute_before_tool_call_hooks",
    "execute_after_tool_call_hooks",
    "clear_all_tool_hooks",
    "get_registered_tool_hooks",
]