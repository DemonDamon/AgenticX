import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)

"""
AgenticX: 一个统一的多智能体框架

AgenticX是一个完整的多智能体应用开发框架，提供从核心抽象到企业级功能的全套解决方案。

主要模块：
- core: 核心抽象层，包含Agent、Task、Tool、Workflow等基础组件
- llms: LLM服务提供层，支持多种大语言模型
- tools: 工具系统，包含内置工具和远程工具支持
- memory: 记忆系统，提供短期和长期记忆
- protocols: 智能体通信协议，支持A2A协作
- observability: 可观测性系统，提供监控、分析和评估功能
- integrations: 第三方集成，包含mem0等

特性：
- 统一的核心抽象
- 灵活的编排引擎
- 可插拔的组件生态
- 企业级安全基座
- 全面的可观测性
- 卓越的开发者体验
"""

# 版本信息
__version__ = "0.1.3"
__author__ = "Ziran Li"
__email__ = "bingzhenli@hotmail.com"

# 核心模块导出
from .core import (
    # 基础抽象
    Agent, Task, BaseTool, tool, Workflow, WorkflowNode, WorkflowEdge,
    Message, ProtocolMessage, User, Organization, Component,
    
    # M5: Agent Core Components
    Event, EventLog, AnyEvent,
    TaskStartEvent, TaskEndEvent, ToolCallEvent, ToolResultEvent,
    ErrorEvent, LLMCallEvent, LLMResponseEvent, HumanRequestEvent,
    HumanResponseEvent, FinishTaskEvent,
    
    PromptManager, ContextRenderer, XMLContextRenderer, PromptTemplate,
    ErrorHandler, ErrorClassifier, CircuitBreaker, CircuitBreakerOpenError,
    CommunicationInterface, BroadcastCommunication, AsyncCommunicationInterface,
    AgentExecutor, ToolRegistry, ActionParser,
    
    # M6: Task Contract & Outcome Validation
    TaskOutputParser, TaskResultValidator, OutputRepairLoop,
    ParseResult, ValidationResult, RepairStrategy,
    ParseError, ValidationError, RepairError,
    
    # M7: Orchestration & Routing Engine
    WorkflowEngine, WorkflowGraph, TriggerService,
    ScheduledTrigger, EventDrivenTrigger,
    ExecutionContext, NodeExecution, WorkflowStatus, NodeStatus
)

# LLM模块导出
from .llms import (
    BaseLLMProvider, LLMResponse, LiteLLMProvider,
    OpenAIProvider, AnthropicProvider, OllamaProvider,
    KimiProvider, MoonshotProvider
)

# 工具模块导出
from .tools import (
    BaseTool, FunctionTool, tool, ToolExecutor, ToolError,
    ToolTimeoutError, ToolValidationError, CredentialStore,
    RemoteTool, MCPClient, MCPServerConfig,
    load_mcp_config, create_mcp_client
)

# 记忆模块导出
from .memory import (
    BaseMemory, ShortTermMemory, Mem0, KnowledgeBase,
    MemoryComponent, MCPMemory, Mem0Wrapper
)

# 协议模块导出
from .protocols import (
    # 接口和模型
    AgentCard, Skill, CollaborationTask,
    TaskCreationRequest, TaskStatusResponse,
    
    # 服务端和客户端
    A2AWebServiceWrapper, A2AClient, A2ASkillTool,
    A2ASkillToolFactory, InMemoryTaskStore,
    
    # 异常
    TaskError, TaskNotFoundError, TaskAlreadyExistsError,
    A2AClientError, A2AConnectionError, A2ATaskError
)

# M9: 可观测性模块导出
from .observability import (
    # 核心回调系统
    BaseCallbackHandler, CallbackManager, CallbackRegistry,
    CallbackError, CallbackHandlerConfig,
    
    # 日志和监控
    LoggingCallbackHandler, LogLevel, LogFormat, StructuredLogger,
    MonitoringCallbackHandler, MetricsCollector, PerformanceMetrics,
    SystemMetrics, PrometheusExporter,
    
    # 轨迹分析
    TrajectoryCollector, ExecutionTrajectory, TrajectoryStep,
    TrajectoryMetadata, TrajectorySummarizer, FailureAnalyzer,
    BottleneckDetector, PerformanceAnalyzer, ExecutionInsights,
    FailureReport, PerformanceReport,
    
    # 评估和基准测试
    MetricsCalculator, BenchmarkRunner, AutoEvaluator,
    EvaluationResult, BenchmarkResult, EvaluationMetrics,
    
    # 实时通信
    WebSocketCallbackHandler, EventStream, RealtimeMonitor,
    
    # 辅助工具
    EventProcessor, TimeSeriesData, StatisticsCalculator,
    DataExporter
)

# 便捷导入
from .core import Agent, Task, BaseTool, tool, Workflow
from .llms import LiteLLMProvider as LLM
from .observability import CallbackManager, LoggingCallbackHandler, TrajectoryCollector

# 主要类列表
__all__ = [
    # 版本信息
    "__version__", "__author__", "__email__",
    
    # 核心类
    "Agent", "Task", "BaseTool", "tool", "Workflow", "WorkflowNode", "WorkflowEdge",
    "Message", "ProtocolMessage", "User", "Organization", "Component",
    
    # 事件系统
    "Event", "EventLog", "AnyEvent",
    "TaskStartEvent", "TaskEndEvent", "ToolCallEvent", "ToolResultEvent",
    "ErrorEvent", "LLMCallEvent", "LLMResponseEvent", "HumanRequestEvent",
    "HumanResponseEvent", "FinishTaskEvent",
    
    # Agent执行
    "AgentExecutor", "ToolRegistry", "ActionParser",
    "PromptManager", "ContextRenderer", "XMLContextRenderer",
    "ErrorHandler", "ErrorClassifier", "CircuitBreaker",
    "CommunicationInterface", "BroadcastCommunication",
    
    # 任务验证
    "TaskOutputParser", "TaskResultValidator", "OutputRepairLoop",
    "ParseResult", "ValidationResult", "RepairStrategy",
    
    # 工作流引擎
    "WorkflowEngine", "WorkflowGraph", "TriggerService",
    "ScheduledTrigger", "EventDrivenTrigger",
    "ExecutionContext", "NodeExecution", "WorkflowStatus", "NodeStatus",
    
    # LLM相关
    "BaseLLMProvider", "LLMResponse", "LiteLLMProvider", "LLM",
    "OpenAIProvider", "AnthropicProvider", "OllamaProvider",
    "KimiProvider", "MoonshotProvider",
    
    # 工具相关
    "BaseTool", "FunctionTool", "tool", "ToolExecutor", 
    "ToolError", "ToolTimeoutError", "ToolValidationError",
    "CredentialStore", "RemoteTool", "MCPClient", "MCPServerConfig",
    
    # 记忆相关
    "BaseMemory", "ShortTermMemory", "Mem0", "KnowledgeBase",
    "MemoryComponent", "MCPMemory", "Mem0Wrapper",
    
    # 协议相关
    "AgentProtocol", "TaskProtocol", "ToolProtocol",
    "AgentCard", "Skill", "CollaborationTask",
    "A2AWebServiceWrapper", "A2AClient", "A2ASkillTool",
    "A2ASkillToolFactory", "InMemoryTaskStore",
    
    # 可观测性相关
    "BaseCallbackHandler", "CallbackManager", "CallbackRegistry",
    "LoggingCallbackHandler", "LogLevel", "LogFormat", "StructuredLogger",
    "MonitoringCallbackHandler", "MetricsCollector", "PerformanceMetrics",
    "TrajectoryCollector", "ExecutionTrajectory", "TrajectoryStep",
    "TrajectorySummarizer", "FailureAnalyzer", "BottleneckDetector",
    "MetricsCalculator", "BenchmarkRunner", "AutoEvaluator",
    "WebSocketCallbackHandler", "EventStream", "RealtimeMonitor",
    "EventProcessor", "TimeSeriesData", "StatisticsCalculator", "DataExporter"
]