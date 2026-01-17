"""
ExecutionPlan 管理器

提供 ExecutionPlan 的生命周期管理、持久化和事件通知能力。
借鉴自 Refly 的 PilotEngineService。

Usage:
    from agenticx.flow import ExecutionPlanManager, ExecutionPlan
    
    # 创建管理器（使用内存存储）
    manager = ExecutionPlanManager()
    
    # 创建并注册计划
    plan = ExecutionPlan(goal="研究任务")
    manager.register(plan)
    
    # 获取计划
    plan = manager.get(session_id)
    
    # 持久化计划
    manager.persist(session_id)
    
    # 监听事件
    @manager.on_plan_updated
    def handle_update(plan: ExecutionPlan):
        print(f"Plan updated: {plan.session_id}")

References:
    - Refly: apps/api/src/modules/pilot/pilot-engine.service.ts
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Protocol

from pydantic import BaseModel  # type: ignore

from .execution_plan import (
    ExecutionPlan,
    ExecutionStage,
    InterventionState,
    Subtask,
    SubtaskStatus,
)

logger = logging.getLogger(__name__)


# ============================================================================
# Storage Protocol
# ============================================================================


class PlanStorageProtocol(Protocol):
    """ExecutionPlan 存储协议
    
    定义持久化 ExecutionPlan 的接口，可以适配不同的存储后端。
    """
    
    def save_plan(self, session_id: str, plan_data: Dict[str, Any]) -> None:
        """保存计划"""
        ...
    
    def load_plan(self, session_id: str) -> Optional[Dict[str, Any]]:
        """加载计划"""
        ...
    
    def delete_plan(self, session_id: str) -> bool:
        """删除计划"""
        ...
    
    def list_plans(self) -> List[str]:
        """列出所有计划的 session_id"""
        ...


class InMemoryPlanStorage:
    """内存存储实现
    
    用于测试和开发环境，不持久化到磁盘。
    """
    
    def __init__(self):
        self._plans: Dict[str, Dict[str, Any]] = {}
    
    def save_plan(self, session_id: str, plan_data: Dict[str, Any]) -> None:
        self._plans[session_id] = plan_data
    
    def load_plan(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self._plans.get(session_id)
    
    def delete_plan(self, session_id: str) -> bool:
        if session_id in self._plans:
            del self._plans[session_id]
            return True
        return False
    
    def list_plans(self) -> List[str]:
        return list(self._plans.keys())


class FilePlanStorage:
    """文件存储实现
    
    将计划持久化到 JSON 文件。
    """
    
    def __init__(self, storage_dir: str = ".agenticx/plans"):
        import os
        self._storage_dir = storage_dir
        os.makedirs(storage_dir, exist_ok=True)
    
    def _get_path(self, session_id: str) -> str:
        import os
        return os.path.join(self._storage_dir, f"{session_id}.json")
    
    def save_plan(self, session_id: str, plan_data: Dict[str, Any]) -> None:
        import json
        with open(self._get_path(session_id), "w", encoding="utf-8") as f:
            json.dump(plan_data, f, ensure_ascii=False, indent=2, default=str)
    
    def load_plan(self, session_id: str) -> Optional[Dict[str, Any]]:
        import json
        import os
        path = self._get_path(session_id)
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None
    
    def delete_plan(self, session_id: str) -> bool:
        import os
        path = self._get_path(session_id)
        if os.path.exists(path):
            os.remove(path)
            return True
        return False
    
    def list_plans(self) -> List[str]:
        import os
        plans = []
        for filename in os.listdir(self._storage_dir):
            if filename.endswith(".json"):
                plans.append(filename[:-5])
        return plans


# ============================================================================
# Event Types
# ============================================================================


class PlanEvent(BaseModel):
    """计划事件"""
    event_type: str
    session_id: str
    timestamp: datetime
    data: Optional[Dict[str, Any]] = None


EventCallback = Callable[[PlanEvent], None]


# ============================================================================
# ExecutionPlanManager
# ============================================================================


class ExecutionPlanManager:
    """ExecutionPlan 管理器
    
    提供 ExecutionPlan 的：
    - 生命周期管理（创建、获取、更新、删除）
    - 持久化支持
    - 事件通知机制
    - 状态同步
    
    Attributes:
        storage: 存储后端
        plans: 活跃的计划缓存
        
    Example:
        >>> manager = ExecutionPlanManager()
        >>> plan = ExecutionPlan(goal="研究任务")
        >>> manager.register(plan)
        >>> manager.get(plan.session_id)
        ExecutionPlan(session_id='...', goal='研究任务', ...)
    """
    
    def __init__(
        self,
        storage: Optional[PlanStorageProtocol] = None,
        auto_persist: bool = False,
    ):
        """初始化管理器
        
        Args:
            storage: 存储后端，默认使用内存存储
            auto_persist: 是否在每次更新后自动持久化
        """
        self._storage = storage or InMemoryPlanStorage()
        self._auto_persist = auto_persist
        self._plans: Dict[str, ExecutionPlan] = {}
        self._event_callbacks: Dict[str, List[EventCallback]] = {}
    
    # ========================================================================
    # CRUD Operations
    # ========================================================================
    
    def register(self, plan: ExecutionPlan) -> None:
        """注册一个新的执行计划
        
        Args:
            plan: 要注册的执行计划
        """
        self._plans[plan.session_id] = plan
        self._emit_event("plan_registered", plan.session_id)
        
        if self._auto_persist:
            self.persist(plan.session_id)
        
        logger.info(f"Registered plan: {plan.session_id}")
    
    def get(self, session_id: str) -> Optional[ExecutionPlan]:
        """获取执行计划
        
        优先从缓存获取，如果不存在则尝试从存储加载。
        
        Args:
            session_id: 会话 ID
            
        Returns:
            ExecutionPlan 或 None
        """
        # 先从缓存获取
        if session_id in self._plans:
            return self._plans[session_id]
        
        # 尝试从存储加载
        plan_data = self._storage.load_plan(session_id)
        if plan_data:
            plan = ExecutionPlan.from_dict(plan_data)
            self._plans[session_id] = plan
            return plan
        
        return None
    
    def get_or_create(
        self,
        session_id: str,
        goal: str,
        **kwargs: Any,
    ) -> ExecutionPlan:
        """获取或创建执行计划
        
        Args:
            session_id: 会话 ID
            goal: 任务目标
            **kwargs: 其他 ExecutionPlan 参数
            
        Returns:
            ExecutionPlan
        """
        plan = self.get(session_id)
        if plan:
            return plan
        
        plan = ExecutionPlan(session_id=session_id, goal=goal, **kwargs)
        self.register(plan)
        return plan
    
    def update(self, plan: ExecutionPlan) -> None:
        """更新执行计划
        
        Args:
            plan: 更新后的执行计划
        """
        self._plans[plan.session_id] = plan
        self._emit_event("plan_updated", plan.session_id)
        
        if self._auto_persist:
            self.persist(plan.session_id)
        
        logger.debug(f"Updated plan: {plan.session_id}")
    
    def delete(self, session_id: str) -> bool:
        """删除执行计划
        
        Args:
            session_id: 会话 ID
            
        Returns:
            是否成功删除
        """
        deleted_from_cache = False
        
        # 从缓存删除
        if session_id in self._plans:
            del self._plans[session_id]
            deleted_from_cache = True
        
        # 从存储删除
        deleted_from_storage = self._storage.delete_plan(session_id)
        
        result = deleted_from_cache or deleted_from_storage
        
        if result:
            self._emit_event("plan_deleted", session_id)
            logger.info(f"Deleted plan: {session_id}")
        
        return result
    
    def list_sessions(self) -> List[str]:
        """列出所有会话 ID
        
        Returns:
            会话 ID 列表
        """
        # 合并缓存和存储中的 ID
        cached_ids = set(self._plans.keys())
        stored_ids = set(self._storage.list_plans())
        return list(cached_ids | stored_ids)
    
    # ========================================================================
    # Persistence
    # ========================================================================
    
    def persist(self, session_id: str) -> None:
        """持久化指定计划
        
        Args:
            session_id: 会话 ID
        """
        plan = self._plans.get(session_id)
        if plan:
            self._storage.save_plan(session_id, plan.to_dict())
            self._emit_event("plan_persisted", session_id)
            logger.debug(f"Persisted plan: {session_id}")
    
    def persist_all(self) -> None:
        """持久化所有活跃计划"""
        for session_id in self._plans:
            self.persist(session_id)
    
    def load(self, session_id: str) -> Optional[ExecutionPlan]:
        """从存储加载计划
        
        Args:
            session_id: 会话 ID
            
        Returns:
            ExecutionPlan 或 None
        """
        plan_data = self._storage.load_plan(session_id)
        if plan_data:
            plan = ExecutionPlan.from_dict(plan_data)
            self._plans[session_id] = plan
            self._emit_event("plan_loaded", session_id)
            return plan
        return None
    
    # ========================================================================
    # Plan Modification Helpers
    # ========================================================================
    
    def add_subtask_to_plan(
        self,
        session_id: str,
        name: str,
        query: str,
        stage_index: Optional[int] = None,
        **kwargs: Any,
    ) -> Optional[Subtask]:
        """向计划添加子任务
        
        Args:
            session_id: 会话 ID
            name: 子任务名称
            query: 子任务查询
            stage_index: 目标阶段索引
            **kwargs: 其他 Subtask 参数
            
        Returns:
            新创建的 Subtask 或 None
        """
        plan = self.get(session_id)
        if not plan:
            logger.warning(f"Plan not found: {session_id}")
            return None
        
        try:
            subtask = plan.add_subtask(name, query, stage_index, **kwargs)
            self.update(plan)
            self._emit_event("subtask_added", session_id, {"subtask_id": subtask.id})
            return subtask
        except Exception as e:
            logger.error(f"Failed to add subtask: {e}")
            return None
    
    def delete_subtask_from_plan(
        self,
        session_id: str,
        subtask_id: str,
    ) -> bool:
        """从计划删除子任务
        
        Args:
            session_id: 会话 ID
            subtask_id: 子任务 ID
            
        Returns:
            是否成功删除
        """
        plan = self.get(session_id)
        if not plan:
            return False
        
        if plan.delete_subtask(subtask_id):
            self.update(plan)
            self._emit_event("subtask_deleted", session_id, {"subtask_id": subtask_id})
            return True
        return False
    
    def update_subtask_status(
        self,
        session_id: str,
        subtask_id: str,
        status: SubtaskStatus,
        result: Optional[Any] = None,
        error: Optional[str] = None,
    ) -> bool:
        """更新子任务状态
        
        Args:
            session_id: 会话 ID
            subtask_id: 子任务 ID
            status: 新状态
            result: 执行结果（可选）
            error: 错误信息（可选）
            
        Returns:
            是否成功更新
        """
        plan = self.get(session_id)
        if not plan:
            return False
        
        subtask = plan.get_subtask(subtask_id)
        if not subtask:
            return False
        
        if status == SubtaskStatus.EXECUTING:
            subtask.mark_executing()
        elif status == SubtaskStatus.COMPLETED:
            subtask.mark_completed(result)
        elif status == SubtaskStatus.FAILED:
            subtask.mark_failed(error or "Unknown error")
        elif status == SubtaskStatus.PENDING:
            subtask.reset()
        
        self.update(plan)
        self._emit_event(
            "subtask_status_changed",
            session_id,
            {"subtask_id": subtask_id, "status": status.value},
        )
        return True
    
    # ========================================================================
    # Intervention Operations
    # ========================================================================
    
    def pause_plan(self, session_id: str) -> bool:
        """暂停计划执行
        
        Args:
            session_id: 会话 ID
            
        Returns:
            是否成功暂停
        """
        plan = self.get(session_id)
        if not plan:
            return False
        
        plan.pause()
        self.update(plan)
        self._emit_event("plan_paused", session_id)
        return True
    
    def resume_plan(self, session_id: str) -> bool:
        """恢复计划执行
        
        Args:
            session_id: 会话 ID
            
        Returns:
            是否成功恢复
        """
        plan = self.get(session_id)
        if not plan:
            return False
        
        plan.resume()
        self.update(plan)
        self._emit_event("plan_resumed", session_id)
        return True
    
    def reset_subtask(self, session_id: str, subtask_id: str) -> bool:
        """重置子任务
        
        Args:
            session_id: 会话 ID
            subtask_id: 子任务 ID
            
        Returns:
            是否成功重置
        """
        plan = self.get(session_id)
        if not plan:
            return False
        
        if plan.reset_node(subtask_id):
            self.update(plan)
            self._emit_event("subtask_reset", session_id, {"subtask_id": subtask_id})
            return True
        return False
    
    # ========================================================================
    # Event System
    # ========================================================================
    
    def on(self, event_type: str, callback: EventCallback) -> None:
        """注册事件回调
        
        Args:
            event_type: 事件类型
            callback: 回调函数
        """
        if event_type not in self._event_callbacks:
            self._event_callbacks[event_type] = []
        self._event_callbacks[event_type].append(callback)
    
    def off(self, event_type: str, callback: EventCallback) -> None:
        """取消事件回调
        
        Args:
            event_type: 事件类型
            callback: 回调函数
        """
        if event_type in self._event_callbacks:
            self._event_callbacks[event_type] = [
                cb for cb in self._event_callbacks[event_type]
                if cb != callback
            ]
    
    def on_plan_updated(self, callback: EventCallback) -> EventCallback:
        """装饰器：注册 plan_updated 事件回调
        
        Example:
            @manager.on_plan_updated
            def handle_update(event):
                print(f"Plan updated: {event.session_id}")
        """
        self.on("plan_updated", callback)
        return callback
    
    def on_plan_paused(self, callback: EventCallback) -> EventCallback:
        """装饰器：注册 plan_paused 事件回调"""
        self.on("plan_paused", callback)
        return callback
    
    def on_plan_resumed(self, callback: EventCallback) -> EventCallback:
        """装饰器：注册 plan_resumed 事件回调"""
        self.on("plan_resumed", callback)
        return callback
    
    def _emit_event(
        self,
        event_type: str,
        session_id: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> None:
        """触发事件
        
        Args:
            event_type: 事件类型
            session_id: 会话 ID
            data: 事件数据
        """
        event = PlanEvent(
            event_type=event_type,
            session_id=session_id,
            timestamp=datetime.now(),
            data=data,
        )
        
        callbacks = self._event_callbacks.get(event_type, [])
        for callback in callbacks:
            try:
                callback(event)
            except Exception as e:
                logger.error(f"Event callback error: {e}")
    
    # ========================================================================
    # Context Manager
    # ========================================================================
    
    def __enter__(self) -> "ExecutionPlanManager":
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        if self._auto_persist:
            self.persist_all()


# ============================================================================
# Exports
# ============================================================================


__all__ = [
    "PlanStorageProtocol",
    "InMemoryPlanStorage",
    "FilePlanStorage",
    "PlanEvent",
    "EventCallback",
    "ExecutionPlanManager",
]

