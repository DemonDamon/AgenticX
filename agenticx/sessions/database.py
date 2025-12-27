"""
DatabaseSessionService: 数据库存储的会话服务实现

使用 SQLAlchemy 支持多种数据库后端（SQLite、PostgreSQL、MySQL 等）。
"""

from typing import Dict, List, Optional, Any
from datetime import datetime, timezone
import uuid
import json
import logging

from .base import (
    BaseSessionService,
    Session,
    SessionState,
    SessionEvent,
    SessionNotFoundError,
    SessionAlreadyExistsError,
)

logger = logging.getLogger(__name__)

# 延迟导入 SQLAlchemy（可选依赖）
try:
    from sqlalchemy import (
        Column, String, Text, DateTime, JSON, Integer,
        create_engine, Index, ForeignKey, select, delete, update
    )
    from sqlalchemy.orm import declarative_base, sessionmaker, relationship
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
    SQLALCHEMY_AVAILABLE = True
except ImportError:
    SQLALCHEMY_AVAILABLE = False
    logger.warning("SQLAlchemy not available. DatabaseSessionService will not work.")

if SQLALCHEMY_AVAILABLE:
    Base = declarative_base()
    
    class SessionModel(Base):
        """会话表模型"""
        __tablename__ = "agenticx_sessions"
        
        id = Column(String(64), primary_key=True)
        app_name = Column(String(128), nullable=False, index=True)
        user_id = Column(String(128), nullable=False, index=True)
        
        # 状态（JSON 存储）
        app_state = Column(JSON, default=dict)
        user_state = Column(JSON, default=dict)
        session_state = Column(JSON, default=dict)
        
        # 元数据
        metadata_json = Column(JSON, default=dict)
        current_invocation_id = Column(String(64), nullable=True)
        
        # 时间戳
        created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
        updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), 
                          onupdate=lambda: datetime.now(timezone.utc))
        
        # 关联事件
        events = relationship("SessionEventModel", back_populates="session", 
                            cascade="all, delete-orphan")
        
        # 复合索引
        __table_args__ = (
            Index('ix_session_app_user', 'app_name', 'user_id'),
        )
    
    class SessionEventModel(Base):
        """会话事件表模型"""
        __tablename__ = "agenticx_session_events"
        
        id = Column(String(64), primary_key=True)
        session_id = Column(String(64), ForeignKey("agenticx_sessions.id"), nullable=False, index=True)
        
        type = Column(String(64), nullable=False, index=True)
        data = Column(JSON, default=dict)
        
        agent_id = Column(String(64), nullable=True)
        invocation_id = Column(String(64), nullable=True, index=True)
        
        timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))
        
        # 关联会话
        session = relationship("SessionModel", back_populates="events")


class DatabaseSessionService(BaseSessionService):
    """
    数据库存储的会话服务
    
    特点：
    - 持久化存储
    - 支持多种数据库（SQLite、PostgreSQL、MySQL）
    - 适用于生产环境
    - 支持异步操作
    
    使用示例:
        # SQLite
        service = DatabaseSessionService("sqlite+aiosqlite:///sessions.db")
        
        # PostgreSQL
        service = DatabaseSessionService("postgresql+asyncpg://user:pass@localhost/db")
    """
    
    def __init__(
        self,
        database_url: str,
        echo: bool = False,
        pool_size: int = 5,
        max_overflow: int = 10
    ):
        """
        初始化数据库会话服务
        
        Args:
            database_url: 数据库连接 URL（需要异步驱动）
            echo: 是否打印 SQL 语句
            pool_size: 连接池大小
            max_overflow: 最大溢出连接数
        """
        if not SQLALCHEMY_AVAILABLE:
            raise ImportError(
                "SQLAlchemy is required for DatabaseSessionService. "
                "Install it with: pip install sqlalchemy[asyncio] aiosqlite"
            )
        
        self.database_url = database_url
        
        # 创建异步引擎
        self.engine = create_async_engine(
            database_url,
            echo=echo,
            pool_size=pool_size,
            max_overflow=max_overflow
        )
        
        # 创建异步会话工厂
        self.async_session = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False
        )
        
        self._initialized = False
    
    async def initialize(self) -> None:
        """初始化数据库（创建表）"""
        if self._initialized:
            return
        
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        
        self._initialized = True
        logger.info(f"Database initialized: {self.database_url}")
    
    async def close(self) -> None:
        """关闭数据库连接"""
        await self.engine.dispose()
    
    def _model_to_session(self, model: "SessionModel") -> Session:
        """将数据库模型转换为 Session 对象"""
        state = SessionState(
            app_state=model.app_state or {},
            user_state=model.user_state or {},
            session_state=model.session_state or {}
        )
        
        events = [
            SessionEvent(
                id=e.id,
                type=e.type,
                data=e.data or {},
                timestamp=e.timestamp,
                agent_id=e.agent_id,
                invocation_id=e.invocation_id
            )
            for e in model.events
        ]
        
        return Session(
            id=model.id,
            app_name=model.app_name,
            user_id=model.user_id,
            state=state,
            events=events,
            created_at=model.created_at,
            updated_at=model.updated_at,
            metadata=model.metadata_json or {},
            current_invocation_id=model.current_invocation_id
        )
    
    async def get_session(
        self,
        app_name: str,
        user_id: str,
        session_id: str
    ) -> Optional[Session]:
        """获取会话"""
        await self.initialize()
        
        async with self.async_session() as db:
            stmt = select(SessionModel).where(
                SessionModel.id == session_id,
                SessionModel.app_name == app_name,
                SessionModel.user_id == user_id
            )
            result = await db.execute(stmt)
            model = result.scalar_one_or_none()
            
            if model is None:
                return None
            
            return self._model_to_session(model)
    
    async def create_session(
        self,
        app_name: str,
        user_id: str,
        session_id: Optional[str] = None,
        state: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Session:
        """创建会话"""
        await self.initialize()
        
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        async with self.async_session() as db:
            # 检查是否已存在
            stmt = select(SessionModel).where(SessionModel.id == session_id)
            result = await db.execute(stmt)
            if result.scalar_one_or_none():
                raise SessionAlreadyExistsError(session_id)
            
            # 创建模型
            model = SessionModel(
                id=session_id,
                app_name=app_name,
                user_id=user_id,
                app_state={},
                user_state={},
                session_state=state or {},
                metadata_json=metadata or {}
            )
            
            db.add(model)
            await db.commit()
            await db.refresh(model)
            
            return self._model_to_session(model)
    
    async def update_session(
        self,
        session: Session
    ) -> Session:
        """更新会话"""
        await self.initialize()
        
        async with self.async_session() as db:
            stmt = select(SessionModel).where(SessionModel.id == session.id)
            result = await db.execute(stmt)
            model = result.scalar_one_or_none()
            
            if model is None:
                raise SessionNotFoundError(session.id, session.app_name, session.user_id)
            
            # 更新字段
            model.app_state = session.state.app_state
            model.user_state = session.state.user_state
            model.session_state = session.state.session_state
            model.metadata_json = session.metadata
            model.current_invocation_id = session.current_invocation_id
            model.updated_at = datetime.now(timezone.utc)
            
            await db.commit()
            await db.refresh(model)
            
            return self._model_to_session(model)
    
    async def delete_session(
        self,
        app_name: str,
        user_id: str,
        session_id: str
    ) -> bool:
        """删除会话"""
        await self.initialize()
        
        async with self.async_session() as db:
            stmt = delete(SessionModel).where(
                SessionModel.id == session_id,
                SessionModel.app_name == app_name,
                SessionModel.user_id == user_id
            )
            result = await db.execute(stmt)
            await db.commit()
            
            return result.rowcount > 0
    
    async def list_sessions(
        self,
        app_name: str,
        user_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Session]:
        """列出会话"""
        await self.initialize()
        
        async with self.async_session() as db:
            stmt = select(SessionModel).where(SessionModel.app_name == app_name)
            
            if user_id:
                stmt = stmt.where(SessionModel.user_id == user_id)
            
            stmt = stmt.order_by(SessionModel.updated_at.desc())
            stmt = stmt.offset(offset).limit(limit)
            
            result = await db.execute(stmt)
            models = result.scalars().all()
            
            return [self._model_to_session(m) for m in models]
    
    async def append_event(
        self,
        session: Session,
        event: SessionEvent
    ) -> SessionEvent:
        """追加事件到会话"""
        await self.initialize()
        
        async with self.async_session() as db:
            # 检查会话是否存在
            stmt = select(SessionModel).where(SessionModel.id == session.id)
            result = await db.execute(stmt)
            model = result.scalar_one_or_none()
            
            if model is None:
                raise SessionNotFoundError(session.id, session.app_name, session.user_id)
            
            # 创建事件模型
            event_model = SessionEventModel(
                id=event.id,
                session_id=session.id,
                type=event.type,
                data=event.data,
                agent_id=event.agent_id,
                invocation_id=event.invocation_id,
                timestamp=event.timestamp
            )
            
            db.add(event_model)
            
            # 更新会话时间
            model.updated_at = datetime.now(timezone.utc)
            
            await db.commit()
            
            return event

