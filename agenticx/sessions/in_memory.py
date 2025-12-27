"""
InMemorySessionService: 内存存储的会话服务实现

适用于开发测试和单实例部署场景。
"""

from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
import uuid
import asyncio
from collections import defaultdict

from .base import (
    BaseSessionService,
    Session,
    SessionState,
    SessionEvent,
    SessionNotFoundError,
    SessionAlreadyExistsError,
)


class InMemorySessionService(BaseSessionService):
    """
    内存存储的会话服务
    
    特点：
    - 快速访问
    - 无外部依赖
    - 数据不持久化（重启后丢失）
    - 适用于开发测试
    """
    
    def __init__(self, max_sessions_per_user: int = 100):
        """
        初始化内存会话服务
        
        Args:
            max_sessions_per_user: 每个用户的最大会话数
        """
        self.max_sessions_per_user = max_sessions_per_user
        
        # 存储结构: {app_name: {user_id: {session_id: Session}}}
        self._sessions: Dict[str, Dict[str, Dict[str, Session]]] = defaultdict(
            lambda: defaultdict(dict)
        )
        
        # 线程安全锁
        self._lock = asyncio.Lock()
    
    async def get_session(
        self,
        app_name: str,
        user_id: str,
        session_id: str
    ) -> Optional[Session]:
        """获取会话"""
        async with self._lock:
            return self._sessions[app_name][user_id].get(session_id)
    
    async def create_session(
        self,
        app_name: str,
        user_id: str,
        session_id: Optional[str] = None,
        state: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Session:
        """创建会话"""
        async with self._lock:
            # 生成会话 ID
            if session_id is None:
                session_id = str(uuid.uuid4())
            
            # 检查是否已存在
            if session_id in self._sessions[app_name][user_id]:
                raise SessionAlreadyExistsError(session_id)
            
            # 检查会话数量限制
            if len(self._sessions[app_name][user_id]) >= self.max_sessions_per_user:
                # 删除最旧的会话
                oldest_session_id = min(
                    self._sessions[app_name][user_id].keys(),
                    key=lambda sid: self._sessions[app_name][user_id][sid].created_at
                )
                del self._sessions[app_name][user_id][oldest_session_id]
            
            # 创建会话状态
            session_state = SessionState()
            if state:
                session_state.update(state, level="session")
            
            # 创建会话
            session = Session(
                id=session_id,
                app_name=app_name,
                user_id=user_id,
                state=session_state,
                metadata=metadata or {}
            )
            
            self._sessions[app_name][user_id][session_id] = session
            
            return session
    
    async def update_session(
        self,
        session: Session
    ) -> Session:
        """更新会话"""
        async with self._lock:
            if session.id not in self._sessions[session.app_name][session.user_id]:
                raise SessionNotFoundError(session.id, session.app_name, session.user_id)
            
            session.updated_at = datetime.now(timezone.utc)
            self._sessions[session.app_name][session.user_id][session.id] = session
            
            return session
    
    async def delete_session(
        self,
        app_name: str,
        user_id: str,
        session_id: str
    ) -> bool:
        """删除会话"""
        async with self._lock:
            if session_id in self._sessions[app_name][user_id]:
                del self._sessions[app_name][user_id][session_id]
                return True
            return False
    
    async def list_sessions(
        self,
        app_name: str,
        user_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Session]:
        """列出会话"""
        async with self._lock:
            sessions = []
            
            if user_id:
                # 列出特定用户的会话
                sessions = list(self._sessions[app_name][user_id].values())
            else:
                # 列出应用下所有会话
                for user_sessions in self._sessions[app_name].values():
                    sessions.extend(user_sessions.values())
            
            # 按更新时间排序
            sessions.sort(key=lambda s: s.updated_at, reverse=True)
            
            # 分页
            return sessions[offset:offset + limit]
    
    async def append_event(
        self,
        session: Session,
        event: SessionEvent
    ) -> SessionEvent:
        """追加事件到会话"""
        async with self._lock:
            if session.id not in self._sessions[session.app_name][session.user_id]:
                raise SessionNotFoundError(session.id, session.app_name, session.user_id)
            
            # 追加事件
            session.append_event(event)
            
            # 更新存储
            self._sessions[session.app_name][session.user_id][session.id] = session
            
            return event
    
    async def clear_all(self) -> None:
        """清空所有会话（仅用于测试）"""
        async with self._lock:
            self._sessions.clear()
    
    async def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        async with self._lock:
            total_sessions = 0
            total_events = 0
            apps = []
            
            for app_name, users in self._sessions.items():
                app_sessions = 0
                for user_id, sessions in users.items():
                    app_sessions += len(sessions)
                    for session in sessions.values():
                        total_events += len(session.events)
                
                total_sessions += app_sessions
                apps.append({
                    "name": app_name,
                    "users": len(users),
                    "sessions": app_sessions
                })
            
            return {
                "total_apps": len(self._sessions),
                "total_sessions": total_sessions,
                "total_events": total_events,
                "apps": apps
            }

