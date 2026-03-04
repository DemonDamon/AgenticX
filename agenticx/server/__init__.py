"""
AgenticX Server Module

提供 Agent HTTP Server 功能，支持 OpenAI Chat Completions API 兼容接口。

Example:
    >>> from agenticx.server import AgentServer
    >>> 
    >>> async def my_agent(request):
    ...     # 处理请求并返回响应
    ...     return "Hello from AgenticX!"
    >>> 
    >>> server = AgentServer(agent_handler=my_agent)
    >>> server.run(port=8000)

或者使用流式响应：
    >>> async def my_stream_agent(request):
    ...     yield "Hello "
    ...     yield "from "
    ...     yield "AgenticX!"
    >>> 
    >>> server = AgentServer(stream_handler=my_stream_agent)
    >>> server.run(port=8000)
"""

from .types import (
    # 枚举
    MessageRole,
    FinishReason,
    # 消息
    Message,
    # 请求/响应
    ChatCompletionRequest,
    ChatCompletionResponse,
    ChatCompletionChunk,
    Choice,
    StreamChoice,
    Usage,
    # 模型
    ModelInfo,
    ModelsResponse,
    # 错误
    ErrorResponse,
)

from .protocol import ProtocolHandler
from .openai_protocol import OpenAIProtocolHandler, AgentHandler, StreamAgentHandler
from .server import AgentServer, create_server
# 前端兼容路由
from .api_routes import register_api_routes
from .api_models import (
    ChatRequest,
    SupplementChatRequest,
    UpdateTaskRequest,
    TaskInfo,
    HealthResponse,
)
from .event_hooks import setup_event_hooks, clear_event_hooks
from .middleware import (
    MiddlewareConfig,
    RequestIdMiddleware,
    TimeoutMiddleware,
    RateLimitMiddleware,
    CircuitBreakerMiddleware,
    register_production_middlewares,
)
from .tenant import TenantContext, TenantIsolationMiddleware
from .health import (
    HealthProbe,
    DependencyChecker,
    SelfHealingManager,
    get_health_probe,
    HealthStatus,
    CheckResult,
)
from .resilience import (
    IdempotencyStore,
    RedisIdempotencyStore,
    GracefulDegradation,
    RetryableEndpoint,
    retryable_endpoint,
    get_idempotency_store,
    get_graceful_degradation,
)
from .redis_backend import (
    RedisBackend,
    init_redis_backend,
    get_redis_backend,
    set_redis_backend,
)
from .auth import (
    AuthState,
    JWTAuthMiddleware,
    get_current_user,
    get_current_user_optional,
    require_role,
    require_permission,
)

__all__ = [
    # 核心类
    "AgentServer",
    "create_server",
    # 协议
    "ProtocolHandler",
    "OpenAIProtocolHandler",
    # 类型别名
    "AgentHandler",
    "StreamAgentHandler",
    # 枚举
    "MessageRole",
    "FinishReason",
    # 数据类
    "Message",
    "ChatCompletionRequest",
    "ChatCompletionResponse",
    "ChatCompletionChunk",
    "Choice",
    "StreamChoice",
    "Usage",
    "ModelInfo",
    "ModelsResponse",
    "ErrorResponse",
    # 前端兼容
    "register_api_routes",
    "ChatRequest",
    "SupplementChatRequest",
    "UpdateTaskRequest",
    "TaskInfo",
    "HealthResponse",
    "setup_event_hooks",
    "clear_event_hooks",
    "MiddlewareConfig",
    "RequestIdMiddleware",
    "TimeoutMiddleware",
    "RateLimitMiddleware",
    "CircuitBreakerMiddleware",
    "register_production_middlewares",
    "TenantContext",
    "TenantIsolationMiddleware",
    "AuthState",
    "JWTAuthMiddleware",
    "get_current_user",
    "get_current_user_optional",
    "require_role",
    "require_permission",
    "HealthProbe",
    "DependencyChecker",
    "SelfHealingManager",
    "get_health_probe",
    "HealthStatus",
    "CheckResult",
    "IdempotencyStore",
    "RedisIdempotencyStore",
    "GracefulDegradation",
    "RetryableEndpoint",
    "retryable_endpoint",
    "get_idempotency_store",
    "get_graceful_degradation",
    "RedisBackend",
    "init_redis_backend",
    "get_redis_backend",
    "set_redis_backend",
]

__version__ = "0.1.0"
