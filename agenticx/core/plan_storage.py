"""
Plan Storage - 计划存储抽象层

参考自 AgentScope 的 plan/_storage_base.py 和 plan/_in_memory_storage.py

提供计划的持久化存储能力，支持内存存储和 SQLite 存储。
"""

from abc import ABC, abstractmethod
from collections import OrderedDict
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
import json
import logging

from pydantic import BaseModel, Field  # type: ignore

logger = logging.getLogger(__name__)


# =============================================================================
# 数据模型（适配自 AgentScope 的 SubTask 和 Plan）
# =============================================================================

class SubTask(BaseModel):
    """
    计划中的子任务模型。
    
    参考自 AgentScope 的 plan/_plan_model.py::SubTask
    """
    name: str = Field(
        description="子任务名称，应简洁、描述性强，不超过10个词"
    )
    description: str = Field(
        description="子任务描述，包含约束、目标和预期成果"
    )
    expected_outcome: str = Field(
        description="预期成果，应具体、可衡量"
    )
    outcome: Optional[str] = Field(
        default=None,
        description="实际成果"
    )
    state: str = Field(
        default="todo",
        description="子任务状态: todo, in_progress, done, abandoned"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="创建时间"
    )
    finished_at: Optional[str] = Field(
        default=None,
        description="完成时间"
    )
    
    def finish(self, outcome: str) -> None:
        """标记子任务完成"""
        self.state = "done"
        self.outcome = outcome
        self.finished_at = datetime.now(timezone.utc).isoformat()
    
    def to_oneline_markdown(self) -> str:
        """转换为单行 Markdown 格式"""
        status_map = {
            "todo": "- [ ]",
            "in_progress": "- [ ][WIP]",
            "done": "- [x]",
            "abandoned": "- [ ][Abandoned]",
        }
        return f"{status_map.get(self.state, '- [ ]')} {self.name}"
    
    def to_markdown(self, detailed: bool = False) -> str:
        """转换为 Markdown 格式"""
        status_map = {
            "todo": "- [ ] ",
            "in_progress": "- [ ] [WIP]",
            "done": "- [x] ",
            "abandoned": "- [ ] [Abandoned]",
        }
        
        if detailed:
            markdown_strs = [
                f"{status_map.get(self.state, '- [ ] ')}{self.name}",
                f"\t- Created At: {self.created_at}",
                f"\t- Description: {self.description}",
                f"\t- Expected Outcome: {self.expected_outcome}",
                f"\t- State: {self.state}",
            ]
            
            if self.state == "done":
                markdown_strs.extend([
                    f"\t- Finished At: {self.finished_at}",
                    f"\t- Actual Outcome: {self.outcome}",
                ])
            
            return "\n".join(markdown_strs)
        
        return f"{status_map.get(self.state, '- [ ] ')}{self.name}"


class Plan(BaseModel):
    """
    计划模型，包含子任务列表。
    
    参考自 AgentScope 的 plan/_plan_model.py::Plan
    """
    id: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    )
    name: str = Field(
        description="计划名称，应简洁、描述性强"
    )
    description: str = Field(
        description="计划描述，包含约束、目标和预期成果"
    )
    expected_outcome: str = Field(
        description="预期成果，应具体、可衡量"
    )
    subtasks: List[SubTask] = Field(
        description="子任务列表"
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="创建时间"
    )
    state: str = Field(
        default="todo",
        description="计划状态: todo, in_progress, done, abandoned"
    )
    finished_at: Optional[str] = Field(
        default=None,
        description="完成时间"
    )
    outcome: Optional[str] = Field(
        default=None,
        description="实际成果"
    )
    
    def refresh_plan_state(self) -> str:
        """根据子任务状态刷新计划状态"""
        if self.state in ["done", "abandoned"]:
            return ""
        
        any_in_progress = any(s.state == "in_progress" for s in self.subtasks)
        
        if any_in_progress and self.state == "todo":
            self.state = "in_progress"
            return "计划状态已更新为 'in_progress'。"
        elif not any_in_progress and self.state == "in_progress":
            self.state = "todo"
            return "计划状态已更新为 'todo'。"
        
        return ""
    
    def finish(self, state: str, outcome: str) -> None:
        """完成计划"""
        self.state = state
        self.outcome = outcome
        self.finished_at = datetime.now(timezone.utc).isoformat()
    
    def to_markdown(self, detailed: bool = False) -> str:
        """转换为 Markdown 格式"""
        subtasks_markdown = "\n".join([
            subtask.to_markdown(detailed=detailed)
            for subtask in self.subtasks
        ])
        
        return "\n".join([
            f"# {self.name}",
            f"**Description**: {self.description}",
            f"**Expected Outcome**: {self.expected_outcome}",
            f"**State**: {self.state}",
            f"**Created At**: {self.created_at}",
            "## Subtasks",
            subtasks_markdown,
        ])


# =============================================================================
# 存储抽象基类
# =============================================================================

class PlanStorageBase(ABC):
    """
    计划存储抽象基类。
    
    参考自 AgentScope 的 plan/_storage_base.py::PlanStorageBase
    """
    
    @abstractmethod
    async def add_plan(self, plan: Plan) -> None:
        """添加计划到存储"""
        pass
    
    @abstractmethod
    async def delete_plan(self, plan_id: str) -> None:
        """从存储中删除计划"""
        pass
    
    @abstractmethod
    async def get_plans(self) -> List[Plan]:
        """获取所有计划"""
        pass
    
    @abstractmethod
    async def get_plan(self, plan_id: str) -> Optional[Plan]:
        """根据 ID 获取计划"""
        pass


# =============================================================================
# 内存存储实现
# =============================================================================

class InMemoryPlanStorage(PlanStorageBase):
    """
    内存计划存储。
    
    参考自 AgentScope 的 plan/_in_memory_storage.py::InMemoryPlanStorage
    """
    
    def __init__(self) -> None:
        """初始化内存存储"""
        self.plans: OrderedDict[str, Plan] = OrderedDict()
    
    async def add_plan(self, plan: Plan, override: bool = True) -> None:
        """
        添加计划到存储。
        
        Args:
            plan: 要添加的计划
            override: 是否覆盖同 ID 的现有计划
        """
        if plan.id in self.plans and not override:
            raise ValueError(f"计划 ID {plan.id} 已存在。")
        self.plans[plan.id] = plan
    
    async def delete_plan(self, plan_id: str) -> None:
        """从存储中删除计划"""
        self.plans.pop(plan_id, None)
    
    async def get_plans(self) -> List[Plan]:
        """获取所有计划"""
        return list(self.plans.values())
    
    async def get_plan(self, plan_id: str) -> Optional[Plan]:
        """根据 ID 获取计划"""
        return self.plans.get(plan_id, None)
    
    def state_dict(self) -> Dict[str, Any]:
        """获取状态字典（用于序列化）"""
        return {
            "plans": {k: v.model_dump() for k, v in self.plans.items()}
        }
    
    def load_state_dict(self, state_dict: Dict[str, Any]) -> None:
        """从状态字典加载（用于反序列化）"""
        self.plans = OrderedDict(
            (k, Plan.model_validate(v)) 
            for k, v in state_dict.get("plans", {}).items()
        )


# =============================================================================
# SQLite 存储实现（可选）
# =============================================================================

class SQLitePlanStorage(PlanStorageBase):
    """
    SQLite 计划存储。
    
    提供持久化存储能力。
    """
    
    def __init__(self, db_path: str = "plans.db") -> None:
        """
        初始化 SQLite 存储。
        
        Args:
            db_path: 数据库文件路径
        """
        self.db_path = db_path
        self._initialized = False
    
    async def _ensure_initialized(self) -> None:
        """确保数据库已初始化"""
        if self._initialized:
            return
        
        import aiosqlite  # type: ignore
        
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS plans (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            await db.commit()
        
        self._initialized = True
    
    async def add_plan(self, plan: Plan, override: bool = True) -> None:
        """添加计划到存储"""
        import aiosqlite  # type: ignore
        
        await self._ensure_initialized()
        
        now = datetime.now(timezone.utc).isoformat()
        data = json.dumps(plan.model_dump())
        
        async with aiosqlite.connect(self.db_path) as db:
            if override:
                await db.execute(
                    """
                    INSERT OR REPLACE INTO plans (id, data, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (plan.id, data, plan.created_at, now)
                )
            else:
                await db.execute(
                    """
                    INSERT INTO plans (id, data, created_at, updated_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (plan.id, data, plan.created_at, now)
                )
            await db.commit()
    
    async def delete_plan(self, plan_id: str) -> None:
        """从存储中删除计划"""
        import aiosqlite  # type: ignore
        
        await self._ensure_initialized()
        
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
            await db.commit()
    
    async def get_plans(self) -> List[Plan]:
        """获取所有计划"""
        import aiosqlite  # type: ignore
        
        await self._ensure_initialized()
        
        plans = []
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute("SELECT data FROM plans ORDER BY created_at") as cursor:
                async for row in cursor:
                    plan_data = json.loads(row[0])
                    plans.append(Plan.model_validate(plan_data))
        
        return plans
    
    async def get_plan(self, plan_id: str) -> Optional[Plan]:
        """根据 ID 获取计划"""
        import aiosqlite  # type: ignore
        
        await self._ensure_initialized()
        
        async with aiosqlite.connect(self.db_path) as db:
            async with db.execute(
                "SELECT data FROM plans WHERE id = ?", 
                (plan_id,)
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    plan_data = json.loads(row[0])
                    return Plan.model_validate(plan_data)
        
        return None

