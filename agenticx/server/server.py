"""
AgenticX Agent Server

提供 HTTP API 服务，将 Agent 暴露为 RESTful API。

支持 OpenAI Chat Completions API 兼容接口。
"""

import asyncio
import json
import logging
from typing import Any, Dict, Optional, Callable, Awaitable, AsyncIterator, Union

logger = logging.getLogger(__name__)

# 尝试导入 FastAPI
try:
    from fastapi import FastAPI, Request, HTTPException  # type: ignore
    from fastapi.responses import StreamingResponse, JSONResponse  # type: ignore
    from fastapi.middleware.cors import CORSMiddleware  # type: ignore
    import uvicorn  # type: ignore
    FASTAPI_AVAILABLE = True
except ImportError:
    FASTAPI_AVAILABLE = False
    FastAPI = None
    uvicorn = None

from .protocol import ProtocolHandler
from .openai_protocol import OpenAIProtocolHandler, AgentHandler, StreamAgentHandler
from .types import (
    ChatCompletionRequest,
    ChatCompletionResponse,
    ErrorResponse,
)
from .middleware import MiddlewareConfig, register_production_middlewares
from .webhook import register_webhook_routes
from ..hooks import HookEvent, trigger_hook_event, load_discovered_hooks


class AgentServer:
    """
    Agent HTTP Server
    
    将 AgenticX Agent 暴露为 HTTP API 服务。
    
    支持：
    - OpenAI Chat Completions API 兼容接口
    - 流式响应（SSE）
    - CORS 跨域支持
    - 健康检查端点
    - Redis 共享状态后端（可选，用于多实例水平扩展）
    
    Example:
        >>> from agenticx.server import AgentServer
        >>> 
        >>> async def my_agent(request):
        ...     return "Hello from AgenticX!"
        >>> 
        >>> server = AgentServer(agent_handler=my_agent)
        >>> server.run(port=8000)
    
    或者使用 CLI：
        >>> agenticx serve --port 8000
    """
    
    def __init__(
        self,
        agent_handler: Optional[AgentHandler] = None,
        stream_handler: Optional[StreamAgentHandler] = None,
        model_name: str = "agenticx",
        title: str = "AgenticX Agent Server",
        version: str = "1.0.0",
        cors_origins: Optional[list] = None,
        middleware_config: Optional[MiddlewareConfig] = None,
        enable_production_middlewares: bool = True,
        redis_url: Optional[str] = None,
        webhook_enabled: bool = False,
        webhook_token: Optional[str] = None,
        webhook_path: str = "/hooks",
    ):
        """
        初始化 Agent Server
        
        Args:
            agent_handler: Agent 处理函数
            stream_handler: 流式 Agent 处理函数
            model_name: 模型名称
            title: API 标题
            version: API 版本
            cors_origins: 允许的 CORS 来源
            middleware_config: 生产中间件配置
            enable_production_middlewares: 是否启用生产中间件链
            redis_url: Redis 连接 URL（如 redis://:password@host:6379/0）
        """
        if not FASTAPI_AVAILABLE:
            raise ImportError(
                "FastAPI is required for AgentServer. "
                "Install with: pip install fastapi uvicorn"
            )
        
        self._model_name = model_name
        self._title = title
        self._version = version
        self._cors_origins = cors_origins or ["*"]
        self._middleware_config = middleware_config
        self._enable_production_middlewares = enable_production_middlewares
        self._redis_url = redis_url
        self._webhook_enabled = webhook_enabled
        self._webhook_token = webhook_token
        self._webhook_path = webhook_path
        
        # 协议处理器
        self._protocol = OpenAIProtocolHandler(
            model_name=model_name,
            agent_handler=agent_handler,
            stream_handler=stream_handler,
        )
        
        # FastAPI 应用
        self._app = self._create_app()
    
    @property
    def app(self) -> "FastAPI":
        """获取 FastAPI 应用实例"""
        return self._app
    
    @property
    def protocol(self) -> OpenAIProtocolHandler:
        """获取协议处理器"""
        return self._protocol
    
    def set_agent_handler(self, handler: AgentHandler) -> None:
        """设置 Agent 处理函数"""
        self._protocol.set_agent_handler(handler)
    
    def set_stream_handler(self, handler: StreamAgentHandler) -> None:
        """设置流式 Agent 处理函数"""
        self._protocol.set_stream_handler(handler)
    
    def _create_app(self) -> "FastAPI":
        """创建 FastAPI 应用"""
        app = FastAPI(
            title=self._title,
            version=self._version,
            description="AgenticX Agent Server - OpenAI Compatible API",
        )
        
        # 添加 CORS 中间件
        app.add_middleware(
            CORSMiddleware,
            allow_origins=self._cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
        if self._enable_production_middlewares:
            register_production_middlewares(app, self._middleware_config)
        
        # Redis lifecycle
        redis_url = self._redis_url

        @app.on_event("startup")
        async def _startup_redis():
            from .redis_backend import init_redis_backend, get_redis_backend
            backend = await init_redis_backend(url=redis_url)
            if backend.connected:
                logger.info("Redis shared-state backend ready — horizontal scaling enabled")
            else:
                logger.info("Running without Redis — single-instance memory mode")
            try:
                load_discovered_hooks()
            except Exception as exc:
                logger.debug("Failed to load discovered hooks on startup: %s", exc)
            await trigger_hook_event(
                HookEvent(
                    type="server",
                    action="startup",
                    agent_id=self._model_name,
                    context={"redis_connected": backend.connected},
                )
            )

        @app.on_event("shutdown")
        async def _shutdown_redis():
            from .redis_backend import get_redis_backend
            backend = get_redis_backend()
            if backend:
                await backend.close()
            await trigger_hook_event(
                HookEvent(
                    type="server",
                    action="shutdown",
                    agent_id=self._model_name,
                )
            )

        # 注册路由
        self._register_routes(app)
        
        return app
    
    def _register_routes(self, app: "FastAPI") -> None:
        """注册 API 路由"""
        
        @app.get("/")
        async def root():
            """根路径"""
            return {
                "name": self._title,
                "version": self._version,
                "status": "running",
            }
        
        @app.get("/openai/v1/models")
        @app.get("/v1/models")
        async def list_models():
            """列出可用模型"""
            return await self._protocol.list_models()
        
        @app.post("/openai/v1/chat/completions")
        @app.post("/v1/chat/completions")
        async def chat_completions(request: Request):
            """Chat Completions API"""
            try:
                body = await request.json()
            except json.JSONDecodeError:
                return JSONResponse(
                    status_code=400,
                    content=ErrorResponse.create(
                        message="Invalid JSON in request body",
                        type="invalid_request_error",
                    ).to_dict(),
                )
            
            # 验证请求
            error_msg = self._protocol.validate_request(body)
            if error_msg:
                return JSONResponse(
                    status_code=400,
                    content=ErrorResponse.create(
                        message=error_msg,
                        type="invalid_request_error",
                    ).to_dict(),
                )
            
            # 解析请求
            try:
                chat_request = ChatCompletionRequest.from_dict(body)
            except Exception as e:
                return JSONResponse(
                    status_code=400,
                    content=ErrorResponse.create(
                        message=f"Invalid request: {str(e)}",
                        type="invalid_request_error",
                    ).to_dict(),
                )

            # Message received hook event
            user_content = ""
            if chat_request.messages:
                user_content = chat_request.messages[-1].content or ""
            await trigger_hook_event(
                HookEvent(
                    type="message",
                    action="received",
                    agent_id=self._model_name,
                    context={
                        "channel": "http",
                        "path": "/v1/chat/completions",
                        "content": user_content,
                    },
                )
            )
            await trigger_hook_event(
                HookEvent(
                    type="message",
                    action="preprocessed",
                    agent_id=self._model_name,
                    context={
                        "channel": "http",
                        "path": "/v1/chat/completions",
                        "message_count": len(chat_request.messages),
                    },
                )
            )
            
            # 处理流式请求
            if chat_request.stream:
                return StreamingResponse(
                    self._stream_response(chat_request),
                    media_type="text/event-stream",
                )
            
            # 处理非流式请求
            try:
                response = await self._protocol.handle_chat_completion(chat_request)
                first_choice = ""
                if response.choices:
                    first_choice = response.choices[0].message.content or ""
                await trigger_hook_event(
                    HookEvent(
                        type="message",
                        action="sent",
                        agent_id=self._model_name,
                        context={
                            "channel": "http",
                            "path": "/v1/chat/completions",
                            "content": first_choice,
                            "success": True,
                        },
                    )
                )
                return JSONResponse(content=response.to_dict())
            except Exception as e:
                logger.error(f"Chat completion error: {e}")
                await trigger_hook_event(
                    HookEvent(
                        type="message",
                        action="sent",
                        agent_id=self._model_name,
                        context={
                            "channel": "http",
                            "path": "/v1/chat/completions",
                            "content": "",
                            "success": False,
                            "error": str(e),
                        },
                    )
                )
                return JSONResponse(
                    status_code=500,
                    content=ErrorResponse.create(
                        message=f"Internal server error: {str(e)}",
                        type="server_error",
                    ).to_dict(),
                )

        if self._webhook_enabled:
            if not self._webhook_token:
                raise ValueError("webhook_token is required when webhook_enabled=True")

            async def _wake_handler(payload: Dict[str, Any]) -> None:
                await trigger_hook_event(
                    HookEvent(
                        type="command",
                        action="wake",
                        agent_id=self._model_name,
                        context=payload,
                    )
                )

            async def _agent_handler(payload: Dict[str, Any]) -> None:
                request = ChatCompletionRequest.from_dict(
                    {
                        "model": payload.get("model", self._model_name),
                        "messages": [{"role": "user", "content": payload.get("message", "")}],
                        "stream": False,
                    }
                )
                await self._protocol.handle_chat_completion(request)

            register_webhook_routes(
                app,
                token=self._webhook_token,
                path_prefix=self._webhook_path,
                wake_handler=_wake_handler,
                agent_handler=_agent_handler,
            )
    
    async def _stream_response(
        self,
        request: ChatCompletionRequest,
    ) -> AsyncIterator[str]:
        """
        生成 SSE 流式响应
        
        Args:
            request: Chat Completion 请求
            
        Yields:
            SSE 格式的数据
        """
        try:
            async for chunk in self._protocol.handle_chat_completion_stream(request):
                data = json.dumps(chunk.to_dict(), ensure_ascii=False)
                yield f"data: {data}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            error_data = {"error": str(e)}
            yield f"data: {json.dumps(error_data, ensure_ascii=False)}\n\n"
    
    def run(
        self,
        host: str = "0.0.0.0",
        port: int = 8000,
        reload: bool = False,
        workers: int = 1,
        log_level: str = "info",
    ) -> None:
        """
        启动服务器
        
        Args:
            host: 监听地址
            port: 监听端口
            reload: 是否启用热重载
            workers: 工作进程数
            log_level: 日志级别
        """
        logger.info(f"Starting AgentServer on {host}:{port}")
        uvicorn.run(
            self._app,
            host=host,
            port=port,
            reload=reload,
            workers=workers,
            log_level=log_level,
        )
    
    async def run_async(
        self,
        host: str = "0.0.0.0",
        port: int = 8000,
    ) -> None:
        """
        异步启动服务器
        
        Args:
            host: 监听地址
            port: 监听端口
        """
        config = uvicorn.Config(
            self._app,
            host=host,
            port=port,
        )
        server = uvicorn.Server(config)
        await server.serve()


def create_server(
    agent_handler: Optional[AgentHandler] = None,
    stream_handler: Optional[StreamAgentHandler] = None,
    model_name: str = "agenticx",
    redis_url: Optional[str] = None,
    **kwargs,
) -> AgentServer:
    """
    创建 Agent Server 的便捷函数
    
    Args:
        agent_handler: Agent 处理函数
        stream_handler: 流式 Agent 处理函数
        model_name: 模型名称
        redis_url: Redis 连接 URL（可选）
        **kwargs: 传递给 AgentServer 的其他参数
        
    Returns:
        AgentServer: 服务器实例
    """
    return AgentServer(
        agent_handler=agent_handler,
        stream_handler=stream_handler,
        model_name=model_name,
        redis_url=redis_url,
        **kwargs,
    )
