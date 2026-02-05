"""
API 请求/响应数据模型

定义前端兼容 API 的数据结构。

参考：
- src/store/chatStore.ts:591-610 (前端请求格式)
- backend/app/model/chat.py (后端数据模型)
- Eigent 前端架构设计
"""

from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field  # type: ignore


class NewAgentRequest(BaseModel):
    """新 Agent 请求"""
    name: str
    description: str
    tools: List[str] = Field(default_factory=list)
    mcp_tools: Dict[str, Any] = Field(default_factory=dict)


class ChatRequest(BaseModel):
    """POST /chat 请求模型
    
    参考：src/store/chatStore.ts:591-610
    """
    project_id: str
    task_id: str
    question: str
    model_platform: str
    email: str
    model_type: str
    api_key: str
    api_url: Optional[str] = None
    language: str = "en"
    browser_port: int = 9222
    max_retries: int = 3
    allow_local_system: bool = False
    installed_mcp: Dict[str, Any] = Field(default_factory=dict)
    summary_prompt: str = ""
    new_agents: List[NewAgentRequest] = Field(default_factory=list)
    attaches: List[str] = Field(default_factory=list)  # file paths
    extra_params: Optional[Dict[str, Any]] = None
    search_config: Optional[Dict[str, str]] = None
    env_path: Optional[str] = None


class SupplementChatRequest(BaseModel):
    """POST /chat/{project_id} 请求模型（多轮对话）
    
    参考：backend/app/controller/chat_controller.py:131-188
    """
    question: str
    task_id: Optional[str] = None


class TaskInfo(BaseModel):
    """任务信息模型
    
    参考：src/types/chatbox.d.ts:25-42
    """
    id: str
    content: str
    status: Optional[str] = None  # "waiting" | "running" | "completed" | "failed" | "skipped"


class UpdateTaskRequest(BaseModel):
    """PUT /task/{project_id} 请求模型
    
    参考：src/store/chatStore.ts:2139
    """
    task: List[TaskInfo]


class HealthResponse(BaseModel):
    """GET /health 响应模型
    
    参考：backend/app/controller/health_controller.py:15-21
    """
    status: str = "ok"
    service: str = "agenticx"


class RegisterRequest(BaseModel):
    """POST /api/register 请求模型"""
    email: str
    password: str
    username: Optional[str] = None
    invite_code: Optional[str] = None


class LoginRequest(BaseModel):
    """POST /api/login 请求模型"""
    email: str
    password: str
