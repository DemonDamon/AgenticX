"""
BaseSessionService: 会话服务抽象基类

借鉴 ADK 的 SessionService 设计，提供统一的会话管理接口。
"""

from abc import ABC, abstractmethod
from pydantic import BaseModel, Field  # type: ignore
from typing import Any, Dict, List, Optional, Union
from datetime import datetime, timezone
from enum import Enum
import uuid


class SessionNotFoundError(Exception):
    """会话未找到异常"""
    def __init__(self, session_id: str, app_name: Optional[str] = None, user_id: Optional[str] = None):
        self.session_id = session_id
        self.app_name = app_name
        self.user_id = user_id
        msg = f"Session not found: {session_id}"
        if app_name:
            msg += f" (app={app_name})"
        if user_id:
            msg += f" (user={user_id})"
        super().__init__(msg)


class SessionAlreadyExistsError(Exception):
    """会话已存在异常"""
    def __init__(self, session_id: str):
        self.session_id = session_id
        super().__init__(f"Session already exists: {session_id}")


class SessionState(BaseModel):
    """
    会话状态
    
    借鉴 ADK 的三层状态模型：
    - app_state: 应用级状态（跨用户共享）
    - user_state: 用户级状态（跨会话共享）
    - session_state: 会话级状态（仅当前会话）
    - temp_state: 临时状态（不持久化）
    """
    app_state: Dict[str, Any] = Field(default_factory=dict, description="应用级状态")
    user_state: Dict[str, Any] = Field(default_factory=dict, description="用户级状态")
    session_state: Dict[str, Any] = Field(default_factory=dict, description="会话级状态")
    temp_state: Dict[str, Any] = Field(default_factory=dict, description="临时状态（不持久化）")
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        获取状态值（按优先级查找：temp > session > user > app）
        """
        if key in self.temp_state:
            return self.temp_state[key]
        if key in self.session_state:
            return self.session_state[key]
        if key in self.user_state:
            return self.user_state[key]
        if key in self.app_state:
            return self.app_state[key]
        return default
    
    def set(self, key: str, value: Any, level: str = "session") -> None:
        """
        设置状态值
        
        Args:
            key: 状态键
            value: 状态值
            level: 状态级别 (app/user/session/temp)
        """
        if level == "app":
            self.app_state[key] = value
        elif level == "user":
            self.user_state[key] = value
        elif level == "session":
            self.session_state[key] = value
        elif level == "temp":
            self.temp_state[key] = value
        else:
            raise ValueError(f"Invalid state level: {level}")
    
    def update(self, updates: Dict[str, Any], level: str = "session") -> None:
        """批量更新状态"""
        for key, value in updates.items():
            self.set(key, value, level)
    
    def to_dict(self, include_temp: bool = False) -> Dict[str, Any]:
        """转换为字典（用于持久化）"""
        result = {
            "app_state": self.app_state,
            "user_state": self.user_state,
            "session_state": self.session_state,
        }
        if include_temp:
            result["temp_state"] = self.temp_state
        return result


class SessionEvent(BaseModel):
    """
    会话事件
    
    记录会话中发生的事件，用于事件溯源和审计。
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="事件 ID")
    type: str = Field(description="事件类型")
    data: Dict[str, Any] = Field(default_factory=dict, description="事件数据")
    timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="事件时间戳"
    )
    agent_id: Optional[str] = Field(default=None, description="Agent ID")
    invocation_id: Optional[str] = Field(default=None, description="调用 ID")
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "type": self.type,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
            "agent_id": self.agent_id,
            "invocation_id": self.invocation_id,
        }


class Session(BaseModel):
    """
    会话
    
    表示一个用户与应用的交互会话。
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="会话 ID")
    app_name: str = Field(description="应用名称")
    user_id: str = Field(description="用户 ID")
    
    # 状态
    state: SessionState = Field(default_factory=SessionState, description="会话状态")
    
    # 事件历史
    events: List[SessionEvent] = Field(default_factory=list, description="事件历史")
    
    # 元数据
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="创建时间"
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="更新时间"
    )
    metadata: Dict[str, Any] = Field(default_factory=dict, description="元数据")
    
    # 当前调用（可选）
    current_invocation_id: Optional[str] = Field(default=None, description="当前调用 ID")
    
    def append_event(self, event: SessionEvent) -> None:
        """追加事件"""
        self.events.append(event)
        self.updated_at = datetime.now(timezone.utc)
    
    def get_events_by_type(self, event_type: str) -> List[SessionEvent]:
        """根据类型获取事件"""
        return [e for e in self.events if e.type == event_type]
    
    def get_last_event(self) -> Optional[SessionEvent]:
        """获取最后一个事件"""
        return self.events[-1] if self.events else None
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "app_name": self.app_name,
            "user_id": self.user_id,
            "state": self.state.to_dict(),
            "events": [e.to_dict() for e in self.events],
            "created_at": self.created_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "metadata": self.metadata,
            "current_invocation_id": self.current_invocation_id,
        }


class BaseSessionService(ABC):
    """
    会话服务抽象基类
    
    定义会话管理的统一接口，子类需要实现具体的存储逻辑。
    借鉴 ADK 的 BaseSessionService 设计。
    """
    
    @abstractmethod
    async def get_session(
        self,
        app_name: str,
        user_id: str,
        session_id: str
    ) -> Optional[Session]:
        """
        获取会话
        
        Args:
            app_name: 应用名称
            user_id: 用户 ID
            session_id: 会话 ID
            
        Returns:
            会话对象，如果不存在返回 None
        """
        pass
    
    @abstractmethod
    async def create_session(
        self,
        app_name: str,
        user_id: str,
        session_id: Optional[str] = None,
        state: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Session:
        """
        创建会话
        
        Args:
            app_name: 应用名称
            user_id: 用户 ID
            session_id: 会话 ID（可选，自动生成）
            state: 初始状态
            metadata: 元数据
            
        Returns:
            创建的会话对象
        """
        pass
    
    @abstractmethod
    async def update_session(
        self,
        session: Session
    ) -> Session:
        """
        更新会话
        
        Args:
            session: 会话对象
            
        Returns:
            更新后的会话对象
        """
        pass
    
    @abstractmethod
    async def delete_session(
        self,
        app_name: str,
        user_id: str,
        session_id: str
    ) -> bool:
        """
        删除会话
        
        Args:
            app_name: 应用名称
            user_id: 用户 ID
            session_id: 会话 ID
            
        Returns:
            是否删除成功
        """
        pass
    
    @abstractmethod
    async def list_sessions(
        self,
        app_name: str,
        user_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Session]:
        """
        列出会话
        
        Args:
            app_name: 应用名称
            user_id: 用户 ID（可选，不指定则列出应用下所有会话）
            limit: 返回数量限制
            offset: 偏移量
            
        Returns:
            会话列表
        """
        pass
    
    @abstractmethod
    async def append_event(
        self,
        session: Session,
        event: SessionEvent
    ) -> SessionEvent:
        """
        追加事件到会话
        
        Args:
            session: 会话对象
            event: 事件对象
            
        Returns:
            追加的事件对象
        """
        pass
    
    async def get_or_create_session(
        self,
        app_name: str,
        user_id: str,
        session_id: Optional[str] = None,
        state: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Session:
        """
        获取或创建会话
        
        Args:
            app_name: 应用名称
            user_id: 用户 ID
            session_id: 会话 ID
            state: 初始状态（仅创建时使用）
            metadata: 元数据（仅创建时使用）
            
        Returns:
            会话对象
        """
        if session_id:
            session = await self.get_session(app_name, user_id, session_id)
            if session:
                return session
        
        return await self.create_session(
            app_name=app_name,
            user_id=user_id,
            session_id=session_id,
            state=state,
            metadata=metadata
        )
    
    async def update_state(
        self,
        session: Session,
        updates: Dict[str, Any],
        level: str = "session"
    ) -> Session:
        """
        更新会话状态
        
        Args:
            session: 会话对象
            updates: 状态更新
            level: 状态级别
            
        Returns:
            更新后的会话对象
        """
        session.state.update(updates, level)
        return await self.update_session(session)

