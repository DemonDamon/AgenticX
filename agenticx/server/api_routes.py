"""
前端兼容 API 路由

实现前端依赖的所有 API 端点。

参考：
- backend/app/controller/chat_controller.py:75-319
- src/store/chatStore.ts:586-610
- Eigent 前端架构设计
"""

import logging
from typing import Optional
from fastapi import Request, HTTPException  # type: ignore
from fastapi.responses import StreamingResponse, JSONResponse, HTMLResponse  # type: ignore

from .api_models import (
    ChatRequest,
    SupplementChatRequest,
    UpdateTaskRequest,
    HealthResponse,
    RegisterRequest,
    LoginRequest,
)
from .user_manager import get_user_manager
import secrets
from .sse_adapter import create_sse_stream
from ..collaboration.task_lock import (
    TaskLock,
    get_or_create_task_lock,
    Action,
    ActionData,
    TaskStatus,
)
from ..collaboration.workforce.events import WorkforceEventBus
from .sse_formatter import SSEFormatter, SSEEvent

logger = logging.getLogger(__name__)


def register_api_routes(app, event_bus: Optional[WorkforceEventBus] = None):
    """注册前端兼容 API 路由到 FastAPI 应用
    
    参考：Eigent 前端架构设计
    
    Args:
        app: FastAPI 应用实例
        event_bus: WorkforceEventBus 实例（可选）
    """
    if event_bus is None:
        event_bus = WorkforceEventBus()
    
    formatter = SSEFormatter()
    
    @app.post("/chat")
    async def start_chat(request: Request):
        """启动聊天（SSE 流式响应）
        
        参考：backend/app/controller/chat_controller.py:75-128
        """
        try:
            body = await request.json()
            chat_request = ChatRequest(**body)
        except Exception as e:
            logger.error(f"[APIRoutes] Invalid chat request: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
        
        # 获取或创建 TaskLock
        task_lock = get_or_create_task_lock(chat_request.project_id)
        
        # 添加对话历史
        task_lock.add_conversation("user", chat_request.question)
        
        # 设置状态为确认中
        task_lock.set_status(TaskStatus.CONFIRMING)
        
        # 创建 SSE 流
        sse_stream = create_sse_stream(
            project_id=chat_request.project_id,
            task_lock=task_lock,
            event_bus=event_bus,
            timeout=30.0,
        )
        
        # 发送 confirmed 事件
        async def enhanced_stream():
            # 先发送 confirmed 事件
            yield formatter.format_confirmed(chat_request.question)
            
            # 然后转发 SSE 流
            async for event in sse_stream:
                yield event
        
        return StreamingResponse(
            enhanced_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
    
    @app.post("/chat/{project_id}")
    async def supplement_chat(project_id: str, request: Request):
        """多轮对话（继续对话）
        
        参考：backend/app/controller/chat_controller.py:131-188
        """
        try:
            body = await request.json()
            supplement_request = SupplementChatRequest(**body)
        except Exception as e:
            logger.error(f"[APIRoutes] Invalid supplement request: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
        
        # 获取或创建 TaskLock
        task_lock = get_or_create_task_lock(project_id)
        
        # 添加对话历史
        task_lock.add_conversation("user", supplement_request.question)
        
        # 将问题放入队列
        action_data = ActionData(
            action=Action.SUPPLEMENT,
            data={"question": supplement_request.question},
        )
        await task_lock.put_queue(action_data)
        
        return JSONResponse(
            status_code=201,
            content={"status": "accepted", "project_id": project_id},
        )
    
    @app.delete("/chat/{project_id}/skip-task")
    async def skip_task(project_id: str):
        """停止任务（优雅停止）
        
        参考：backend/app/controller/chat_controller.py:287-319
        """
        try:
            task_lock = get_or_create_task_lock(project_id)
            
            # 发送停止动作
            action_data = ActionData(
                action=Action.STOP,
                data={},
            )
            await task_lock.put_queue(action_data)
            
            # 设置状态为暂停
            task_lock.set_status(TaskStatus.PAUSED)
            
            return JSONResponse(
                status_code=201,
                content={"status": "stopped", "project_id": project_id},
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Error skipping task: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.put("/task/{project_id}")
    async def update_task(project_id: str, request: Request):
        """更新任务列表
        
        参考：src/store/chatStore.ts:2139
        """
        try:
            body = await request.json()
            update_request = UpdateTaskRequest(**body)
        except Exception as e:
            logger.error(f"[APIRoutes] Invalid update task request: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid request: {str(e)}")
        
        try:
            task_lock = get_or_create_task_lock(project_id)
            
            # 将更新任务动作放入队列
            action_data = ActionData(
                action=Action.UPDATE_TASK,
                data={"tasks": [task.dict() for task in update_request.task]},
            )
            await task_lock.put_queue(action_data)
            
            return JSONResponse(
                status_code=200,
                content={"status": "updated", "project_id": project_id},
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Error updating task: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.post("/task/{project_id}/start")
    async def start_task(project_id: str):
        """启动任务执行
        
        参考：src/store/chatStore.ts:2142
        """
        try:
            task_lock = get_or_create_task_lock(project_id)
            
            # 发送启动动作
            action_data = ActionData(
                action=Action.START,
                data={},
            )
            await task_lock.put_queue(action_data)
            
            # 设置状态为已确认
            task_lock.set_status(TaskStatus.CONFIRMED)
            
            return JSONResponse(
                status_code=200,
                content={"status": "started", "project_id": project_id},
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Error starting task: {e}")
            raise HTTPException(status_code=500, detail=str(e))
    
    @app.get("/health")
    async def health():
        """健康检查
        
        参考：backend/app/controller/health_controller.py:15-21
        """
        return HealthResponse().dict()
    
    # 获取用户管理器实例
    user_manager = get_user_manager()
    
    @app.post("/api/register")
    async def register(request: Request):
        """用户注册端点"""
        try:
            body = await request.json()
            register_request = RegisterRequest(**body)
            
            logger.info(f"[APIRoutes] Registration attempt for email: {register_request.email}")
            
            # 注册用户
            user = user_manager.register_user(
                email=register_request.email,
                password=register_request.password,
                username=register_request.username,
            )
            
            # 生成 token（简化实现，生产环境应使用 JWT）
            token = secrets.token_urlsafe(32)
            
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,  # 0 表示成功
                    "token": token,
                    "username": user["username"],
                    "email": user["email"],
                    "user_id": user["id"],
                },
            )
        except ValueError as e:
            logger.warning(f"[APIRoutes] Registration failed: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": str(e)},
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Registration error: {e}")
            return JSONResponse(
                status_code=500,
                content={"code": 10, "text": f"Registration failed: {str(e)}"},
            )
    
    @app.post("/api/login")
    async def login(request: Request):
        """登录端点
        
        验证用户凭据并返回认证 token。
        """
        try:
            body = await request.json()
            login_request = LoginRequest(**body)
            
            logger.info(f"[APIRoutes] Login attempt for email: {login_request.email}")
            
            # 验证用户
            user = user_manager.authenticate_user(
                email=login_request.email,
                password=login_request.password,
            )
            
            if not user:
                return JSONResponse(
                    status_code=401,
                    content={
                        "code": 10,
                        "text": "Invalid email or password",
                    },
                )
            
            # 生成 token（简化实现，生产环境应使用 JWT）
            token = secrets.token_urlsafe(32)
            
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,  # 0 表示成功
                    "token": token,
                    "username": user["username"],
                    "email": user["email"],
                    "user_id": user["id"],
                },
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Login error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Login failed: {str(e)}"},
            )
    
    @app.post("/api/login-by_stack")
    async def login_by_stack(request: Request):
        """通过 Stack 令牌登录
        
        支持通过外部令牌进行单点登录。
        """
        try:
            token = request.query_params.get("token", "")
            body = await request.json()
            
            logger.info(f"[APIRoutes] Stack login attempt with token: {token[:10]}...")
            
            # 简化实现：直接生成新的会话令牌
            session_token = secrets.token_urlsafe(32)
            
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,
                    "token": session_token,
                    "username": "stack_user",
                    "email": "stack@example.com",
                    "user_id": "stack_user_id",
                },
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Stack login error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Stack login failed: {str(e)}"},
            )
    
    @app.get("/api/user/key")
    async def get_user_key():
        """获取用户的 API key 信息
        
        返回用户配置的云服务 API key（用于云模式）。
        """
        return JSONResponse(
            status_code=200,
            content={
                "value": "",  # 用户需要在设置中配置
                "api_url": "https://api.openai.com/v1",
                "warning_code": None,
            },
        )
    
    @app.put("/api/user/key")
    async def update_user_key(request: Request):
        """更新用户的 API key"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] API key updated")
            
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,
                    "message": "API key updated",
                    "value": body.get("value", ""),
                    "api_url": body.get("api_url", "https://api.openai.com/v1"),
                },
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Update API key error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Update failed: {str(e)}"},
            )
    
    @app.get("/api/user/privacy")
    async def get_user_privacy():
        """获取用户隐私设置
        
        返回默认的隐私设置（所有选项默认关闭，需要用户主动开启）
        """
        return JSONResponse(
            status_code=200,
            content={
                "take_screenshot": False,
                "access_local_software": False,
                "access_your_address": False,
                "password_storage": False,
            },
        )
    
    @app.put("/api/user/privacy")
    async def update_user_privacy(request: Request):
        """更新用户隐私设置"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] Privacy settings updated: {body}")
            
            # 这里可以保存到数据库，目前只返回成功
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,
                    "message": "Privacy settings updated",
                    **body,
                },
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Update privacy error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Update failed: {str(e)}"},
            )
    
    @app.get("/api/configs")
    async def get_configs():
        """获取配置列表
        
        返回空的配置列表（前端会处理空列表的情况）
        """
        return JSONResponse(
            status_code=200,
            content=[],
        )
    
    @app.post("/api/configs")
    async def create_config(request: Request):
        """创建配置"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] Create config: {body.get('config_name', 'unknown')}")
            
            # 返回创建的配置（带 ID）
            config = {
                "id": 1,
                **body,
            }
            return JSONResponse(
                status_code=200,
                content=config,
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Create config error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Create failed: {str(e)}"},
            )
    
    @app.put("/api/configs/{config_id}")
    async def update_config(config_id: str, request: Request):
        """更新配置"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] Update config {config_id}: {body.get('config_name', 'unknown')}")
            
            config = {
                "id": int(config_id),
                **body,
            }
            return JSONResponse(
                status_code=200,
                content=config,
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Update config error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Update failed: {str(e)}"},
            )
    
    @app.delete("/api/configs/{config_id}")
    async def delete_config(config_id: str):
        """删除配置"""
        try:
            logger.info(f"[APIRoutes] Delete config {config_id}")
            return JSONResponse(
                status_code=200,
                content={"code": 0, "message": "Config deleted"},
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Delete config error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Delete failed: {str(e)}"},
            )
    
    @app.get("/api/chat/histories")
    async def get_chat_histories():
        """获取聊天历史
        
        返回空的聊天历史列表
        """
        return JSONResponse(
            status_code=200,
            content={
                "items": [],
            },
        )
    
    @app.get("/api/chat/histories/grouped")
    async def get_grouped_chat_histories(request: Request):
        """获取分组的聊天历史
        
        支持 include_tasks 查询参数
        """
        include_tasks = request.query_params.get("include_tasks", "true").lower() == "true"
        
        return JSONResponse(
            status_code=200,
            content={
                "projects": [],
            },
        )
    
    @app.get("/api/providers")
    async def get_providers(request: Request):
        """获取模型提供商列表
        
        返回配置的模型提供商信息。
        支持 prefer 查询参数，用于筛选首选提供商。
        """
        prefer = request.query_params.get("prefer", "false").lower() == "true"
        
        # 默认提供商列表（可以从配置文件或数据库读取）
        providers = [
            {
                "id": 1,
                "provider_name": "openai",
                "api_key": "",  # 用户需要在设置中配置
                "endpoint_url": "https://api.openai.com/v1",
                "api_url": "https://api.openai.com/v1",
                "is_valid": False,  # 未配置 API key 时为 False
                "prefer": True,  # 默认首选
                "model_type": "openai",
                "encrypted_config": {},
            },
            {
                "id": 2,
                "provider_name": "anthropic",
                "api_key": "",
                "endpoint_url": "https://api.anthropic.com",
                "api_url": "https://api.anthropic.com",
                "is_valid": False,
                "prefer": False,
                "model_type": "anthropic",
                "encrypted_config": {},
            },
        ]
        
        # 如果请求首选提供商，只返回 prefer=True 的
        if prefer:
            providers = [p for p in providers if p.get("prefer", False)]
        
        return JSONResponse(
            status_code=200,
            content={
                "items": providers,
            },
        )
    
    @app.post("/api/providers")
    async def create_provider(request: Request):
        """创建模型提供商"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] Create provider: {body.get('provider_name', 'unknown')}")
            
            # 返回创建的提供商（带 ID）
            provider = {
                "id": 1,
                "is_valid": True,
                "prefer": body.get("prefer", False),
                **body,
            }
            return JSONResponse(
                status_code=200,
                content=provider,
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Create provider error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Create failed: {str(e)}"},
            )
    
    @app.put("/api/providers/{provider_id}")
    async def update_provider(provider_id: str, request: Request):
        """更新模型提供商"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] Update provider {provider_id}: {body.get('provider_name', 'unknown')}")
            
            provider = {
                "id": int(provider_id),
                "is_valid": True,
                **body,
            }
            return JSONResponse(
                status_code=200,
                content=provider,
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Update provider error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Update failed: {str(e)}"},
            )
    
    @app.delete("/api/providers/{provider_id}")
    async def delete_provider(provider_id: str):
        """删除模型提供商"""
        try:
            logger.info(f"[APIRoutes] Delete provider {provider_id}")
            return JSONResponse(
                status_code=200,
                content={"code": 0, "message": "Provider deleted"},
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Delete provider error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Delete failed: {str(e)}"},
            )
    
    @app.post("/api/provider")
    async def create_provider_legacy(request: Request):
        """创建或更新模型提供商（旧版 API）"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] Create/update provider (legacy): {body.get('provider_name', 'unknown')}")
            
            provider = {
                "id": body.get("id", 1),
                "is_valid": True,
                "prefer": body.get("prefer", False),
                **body,
            }
            return JSONResponse(
                status_code=200,
                content=provider,
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Create provider error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Create failed: {str(e)}"},
            )
    
    @app.post("/api/provider/prefer")
    async def set_provider_prefer(request: Request):
        """设置首选提供商"""
        try:
            body = await request.json()
            provider_id = body.get("provider_id")
            logger.info(f"[APIRoutes] Set provider {provider_id} as preferred")
            
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,
                    "message": "Preferred provider updated",
                    "provider_id": provider_id,
                },
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Set prefer error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Update failed: {str(e)}"},
            )
    
    @app.get("/api/config/info")
    async def get_config_info():
        """获取配置信息
        
        返回集成配置信息，每个集成包含 env_vars 和 toolkit 字段。
        前端使用此接口获取可用的集成列表及其配置要求。
        """
        return JSONResponse(
            status_code=200,
            content={
                "Notion": {
                    "env_vars": [],
                    "toolkit": "notion_mcp_toolkit",
                },
                "Google Calendar": {
                    "env_vars": [],
                    "toolkit": "google_calendar_toolkit",
                },
                "Search": {
                    "env_vars": ["GOOGLE_API_KEY", "SEARCH_ENGINE_ID"],
                    "toolkit": "search_toolkit",
                },
                "GitHub": {
                    "env_vars": ["GITHUB_TOKEN"],
                    "toolkit": "github_toolkit",
                },
                "Slack": {
                    "env_vars": ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"],
                    "toolkit": "slack_toolkit",
                },
            },
        )
    
    @app.get("/api/user/invite_code")
    async def get_invite_code():
        """获取用户邀请码"""
        return JSONResponse(
            status_code=200,
            content={
                "invite_code": "AGENTICX2026",
                "uses_remaining": 10,
            },
        )
    
    @app.get("/api/subscription")
    async def get_subscription():
        """获取订阅信息"""
        return JSONResponse(
            status_code=200,
            content={
                "plan": "free",
                "status": "active",
                "expires_at": None,
            },
        )
    
    @app.get("/api/mcp/users")
    async def get_mcp_users():
        """获取 MCP 用户列表"""
        return JSONResponse(
            status_code=200,
            content={
                "items": [],
            },
        )
    
    @app.get("/api/mcp/categories")
    async def get_mcp_categories():
        """获取 MCP 分类"""
        return JSONResponse(
            status_code=200,
            content={
                "categories": [
                    {"id": 1, "name": "Development", "count": 0},
                    {"id": 2, "name": "Data", "count": 0},
                    {"id": 3, "name": "Communication", "count": 0},
                ],
            },
        )
    
    @app.get("/api/mcps")
    async def get_mcps(request: Request):
        """获取 MCP 服务列表"""
        return JSONResponse(
            status_code=200,
            content={
                "items": [],
                "total": 0,
            },
        )
    
    @app.post("/api/mcp/install")
    async def install_mcp(request: Request):
        """安装 MCP 服务"""
        try:
            mcp_id = request.query_params.get("mcp_id")
            logger.info(f"[APIRoutes] Install MCP: {mcp_id}")
            
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,
                    "message": "MCP installed successfully",
                    "mcp_id": mcp_id,
                },
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Install MCP error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Install failed: {str(e)}"},
            )
    
    @app.post("/api/mcp/import/local")
    async def import_local_mcp(request: Request):
        """导入本地 MCP 服务"""
        try:
            body = await request.json()
            logger.info(f"[APIRoutes] Import local MCP: {body.get('name', 'unknown')}")
            
            return JSONResponse(
                status_code=200,
                content={
                    "code": 0,
                    "message": "MCP imported successfully",
                },
            )
        except Exception as e:
            logger.error(f"[APIRoutes] Import MCP error: {e}")
            return JSONResponse(
                status_code=400,
                content={"code": 10, "text": f"Import failed: {str(e)}"},
            )
    
    @app.get("/api/browser/cookies")
    async def get_browser_cookies(request: Request):
        """获取浏览器 cookies"""
        return JSONResponse(
            status_code=200,
            content={
                "cookies": [],
            },
        )
    
    @app.delete("/api/browser/cookies")
    async def delete_browser_cookies():
        """清除浏览器 cookies"""
        logger.info("[APIRoutes] Clear browser cookies")
        return JSONResponse(
            status_code=200,
            content={
                "code": 0,
                "message": "Cookies cleared",
            },
        )
    
    @app.get("/api/chat/files")
    async def get_chat_files(request: Request):
        """获取聊天相关文件"""
        project_id = request.query_params.get("project_id")
        
        return JSONResponse(
            status_code=200,
            content={
                "files": [],
            },
        )
    
    @app.get("/api/oauth/{provider}/login")
    async def oauth_login(provider: str):
        """模拟 OAuth 登录跳转
        
        处理前端的安装跳转请求。
        """
        logger.info(f"[APIRoutes] OAuth login request for: {provider}")
        
        # 返回一个简单的成功页面，提示用户配置成功
        # 实际场景中这里会重定向到 OAuth 提供商
        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html>
            <head>
                <title>Integration Installed</title>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f5f5f5; margin: 0; }}
                    .card {{ background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }}
                    h1 {{ color: #22c55e; margin: 0 0 1rem 0; font-size: 1.5rem; }}
                    p {{ color: #666; margin: 0.5rem 0; line-height: 1.6; }}
                    .button {{ background: #3b82f6; color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer; margin-top: 1.5rem; transition: background-color 0.2s; }}
                    .button:hover {{ background: #2563eb; }}
                    .button:active {{ background: #1d4ed8; }}
                    .button-secondary {{ background: #6b7280; }}
                    .button-secondary:hover {{ background: #4b5563; }}
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>✅ {provider.title()} 已安装</h1>
                    <p>集成已成功启用。</p>
                    <p>The integration has been successfully enabled.</p>
                    <button class="button" onclick="closeWindow()">关闭窗口 / Close Window</button>
                    <script>
                        function closeWindow() {{
                            // 尝试多种关闭方式
                            if (window.opener) {{
                                // 如果是弹窗，尝试关闭
                                try {{
                                    window.close();
                                }} catch (e) {{
                                    // 如果无法关闭，尝试返回上一页
                                    if (window.history.length > 1) {{
                                        window.history.back();
                                    }} else {{
                                        window.location.href = '/';
                                    }}
                                }}
                            }} else {{
                                // 如果不是弹窗，返回上一页或首页
                                if (window.history.length > 1) {{
                                    window.history.back();
                                }} else {{
                                    window.location.href = '/';
                                }}
                            }}
                        }}
                        
                        // 尝试自动关闭窗口（如果是弹窗）
                        setTimeout(() => {{
                            if (window.opener) {{
                                try {{
                                    window.close();
                                }} catch (e) {{
                                    // 自动关闭失败，用户可以使用按钮手动关闭
                                }}
                            }}
                        }}, 2000);
                    </script>
                </div>
            </body>
        </html>
        """)
    
    @app.get("/oauth/status/{provider}")
    async def oauth_status(provider: str):
        """获取 OAuth 授权状态
        
        用于轮询检查授权是否完成（如 Google Calendar）。
        """
        logger.info(f"[APIRoutes] OAuth status check for: {provider}")
        
        # 默认返回未完成状态，实际应该检查真实的授权状态
        return JSONResponse(
            status_code=200,
            content={
                "status": "pending",  # pending, success, failed, cancelled
                "error": None,
            },
        )
    
    @app.post("/install/tool/{tool_name}")
    async def install_tool(tool_name: str, request: Request):
        """安装工具/集成
        
        处理 Notion、Google Calendar 等工具的安装请求。
        """
        logger.info(f"[APIRoutes] Install tool request: {tool_name}")
        
        try:
            # 根据不同的工具返回不同的响应
            if tool_name.lower() == "notion":
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "toolkit_name": "notion_mcp_toolkit",
                        "warning": None,
                    },
                )
            elif tool_name.lower() == "google_calendar":
                # Google Calendar 可能需要授权流程
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "status": "authorizing",  # 或 "success" 如果已授权
                        "message": "Please complete authorization in browser",
                    },
                )
            else:
                return JSONResponse(
                    status_code=200,
                    content={
                        "success": True,
                        "toolkit_name": f"{tool_name}_toolkit",
                    },
                )
        except Exception as e:
            logger.error(f"[APIRoutes] Install tool error: {e}")
            return JSONResponse(
                status_code=500,
                content={
                    "success": False,
                    "error": str(e),
                },
            )
    
    @app.get("/api/oauth/{provider}/token")
    async def oauth_token(provider: str, request: Request):
        """获取 OAuth token
        
        用于获取已授权的 OAuth token。
        """
        logger.info(f"[APIRoutes] OAuth token request for: {provider}")
        
        # 返回模拟的 token
        return JSONResponse(
            status_code=200,
            content={
                "access_token": "mock_token",
                "token_type": "Bearer",
                "expires_in": 3600,
            },
        )
    
    @app.get("/api/oauth/{provider}/callback")
    async def oauth_callback(provider: str, request: Request):
        """OAuth 回调处理
        
        处理 OAuth 提供商的回调请求。
        """
        code = request.query_params.get("code")
        error = request.query_params.get("error")
        
        logger.info(f"[APIRoutes] OAuth callback for: {provider}, code: {code}, error: {error}")
        
        if error:
            return HTMLResponse(content=f"""
            <!DOCTYPE html>
            <html>
                <head>
                    <title>Authorization Failed</title>
                    <meta charset="UTF-8">
                    <style>
                        body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f5f5f5; margin: 0; }}
                        .card {{ background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }}
                        h1 {{ color: #ef4444; margin: 0 0 1rem 0; font-size: 1.5rem; }}
                        p {{ color: #666; margin: 0.5rem 0; line-height: 1.6; }}
                        .error {{ color: #dc2626; font-weight: 500; }}
                        .button {{ background: #dc2626; color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer; margin-top: 1.5rem; transition: background-color 0.2s; }}
                        .button:hover {{ background: #b91c1c; }}
                        .button:active {{ background: #991b1b; }}
                    </style>
                </head>
                <body>
                    <div class="card">
                        <h1>❌ 授权失败</h1>
                        <p class="error">错误: {error}</p>
                        <p>Error: {error}</p>
                        <p>您可以关闭此窗口。</p>
                        <button class="button" onclick="closeWindow()">关闭窗口 / Close Window</button>
                        <script>
                            function closeWindow() {{
                                if (window.opener) {{
                                    try {{
                                        window.close();
                                    }} catch (e) {{
                                        if (window.history.length > 1) {{
                                            window.history.back();
                                        }} else {{
                                            window.location.href = '/';
                                        }}
                                    }}
                                }} else {{
                                    if (window.history.length > 1) {{
                                        window.history.back();
                                    }} else {{
                                        window.location.href = '/';
                                    }}
                                }}
                            }}
                            setTimeout(() => {{
                                if (window.opener) {{
                                    try {{
                                        window.close();
                                    }} catch (e) {{
                                        // 自动关闭失败，用户可以使用按钮手动关闭
                                    }}
                                }}
                            }}, 3000);
                        </script>
                    </div>
                </body>
            </html>
            """)
        
        # 成功回调
        return HTMLResponse(content=f"""
        <!DOCTYPE html>
        <html>
            <head>
                <title>Authorization Successful</title>
                <meta charset="UTF-8">
                <style>
                    body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f5f5f5; margin: 0; }}
                    .card {{ background: white; padding: 2.5rem; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }}
                    h1 {{ color: #22c55e; margin: 0 0 1rem 0; font-size: 1.5rem; }}
                    p {{ color: #666; margin: 0.5rem 0; line-height: 1.6; }}
                    .button {{ background: #3b82f6; color: white; border: none; padding: 0.75rem 2rem; border-radius: 6px; font-size: 1rem; font-weight: 500; cursor: pointer; margin-top: 1.5rem; transition: background-color 0.2s; }}
                    .button:hover {{ background: #2563eb; }}
                    .button:active {{ background: #1d4ed8; }}
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>✅ 授权成功</h1>
                    <p>{provider.title()} 已成功授权。</p>
                    <p>{provider.title()} has been successfully authorized.</p>
                    <p>您可以关闭此窗口并返回应用程序。</p>
                    <button class="button" onclick="closeWindow()">关闭窗口 / Close Window</button>
                    <script>
                        function closeWindow() {{
                            if (window.opener) {{
                                try {{
                                    window.close();
                                }} catch (e) {{
                                    if (window.history.length > 1) {{
                                        window.history.back();
                                    }} else {{
                                        window.location.href = '/';
                                    }}
                                }}
                            }} else {{
                                if (window.history.length > 1) {{
                                    window.history.back();
                                }} else {{
                                    window.location.href = '/';
                                }}
                            }}
                        }}
                        setTimeout(() => {{
                            if (window.opener) {{
                                try {{
                                    window.close();
                                }} catch (e) {{
                                    // 自动关闭失败，用户可以使用按钮手动关闭
                                }}
                            }}
                        }}, 2000);
                    </script>
                </div>
            </body>
        </html>
        """)
    
    logger.info("[APIRoutes] Registered frontend compatible routes")
