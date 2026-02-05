"""
TaskLock - 项目级别状态管理器

参考 Eigent TaskLock 设计，实现项目级别的状态容器，维护 Action Queue、
对话历史、最后任务结果等。

参考：backend/app/service/task.py:260-489
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Set, Union
from pydantic import BaseModel, Field  # type: ignore
from datetime import datetime
import asyncio
import logging

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    """任务状态枚举"""
    CONFIRMING = "confirming"  # 等待用户确认
    CONFIRMED = "confirmed"    # 已确认，准备执行
    PROCESSING = "processing"  # 执行中
    DONE = "done"             # 完成
    PAUSED = "paused"         # 暂停
    FAILED = "failed"         # 失败


class Action(str, Enum):
    """Action 枚举（参考 Eigent backend/app/service/task.py:18-47）
    
    定义了后端到前端和前端到后端的动作类型。
    """
    # User -> Backend
    IMPROVE = "improve"
    UPDATE_TASK = "update_task"
    START = "start"
    STOP = "stop"
    SUPPLEMENT = "supplement"
    PAUSE = "pause"
    RESUME = "resume"
    NEW_AGENT = "new_agent"
    ADD_TASK = "add_task"
    REMOVE_TASK = "remove_task"
    SKIP_TASK = "skip_task"
    
    # Backend -> User
    TASK_STATE = "task_state"
    NEW_TASK_STATE = "new_task_state"
    DECOMPOSE_PROGRESS = "decompose_progress"
    DECOMPOSE_TEXT = "decompose_text"
    CREATE_AGENT = "create_agent"
    ACTIVATE_AGENT = "activate_agent"
    DEACTIVATE_AGENT = "deactivate_agent"
    ASSIGN_TASK = "assign_task"
    ACTIVATE_TOOLKIT = "activate_toolkit"
    DEACTIVATE_TOOLKIT = "deactivate_toolkit"
    WRITE_FILE = "write_file"
    ASK = "ask"
    NOTICE = "notice"
    SEARCH_MCP = "search_mcp"
    INSTALL_MCP = "install_mcp"
    TERMINAL = "terminal"
    END = "end"
    BUDGET_NOT_ENOUGH = "budget_not_enough"


class ActionData(BaseModel):
    """Action 数据模型（基础类）
    
    所有具体的 ActionData 类型都应该继承此类。
    """
    action: Action
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=datetime.now)


class TaskLock:
    """TaskLock 状态管理器
    
    项目级别的状态容器，维护：
    - Action Queue（动作队列）
    - 对话历史（conversation_history）
    - 最后任务结果（last_task_result）
    - 后台任务管理（background_tasks）
    
    参考：backend/app/service/task.py:260-489
    """
    
    def __init__(
        self,
        project_id: str,
        max_queue_size: int = 1000,
        max_history_length: int = 10000,
    ):
        """
        Args:
            project_id: 项目 ID
            max_queue_size: 队列最大大小
            max_history_length: 对话历史最大长度（字符数）
        """
        self.id = project_id
        self.status = TaskStatus.CONFIRMING
        self.active_agent: Optional[str] = None
        self.mcp: List[str] = []
        
        # Action Queue
        self.queue: asyncio.Queue[ActionData] = asyncio.Queue(maxsize=max_queue_size)
        
        # Human input queues (agent name -> queue)
        self.human_input: Dict[str, asyncio.Queue[str]] = {}
        
        # Timestamps
        self.created_at = datetime.now()
        self.last_accessed = datetime.now()
        
        # Background tasks
        self.background_tasks: Set[asyncio.Task] = set()
        
        # Context management
        self.conversation_history: List[Dict[str, Any]] = []
        self.last_task_result: str = ""
        self.last_task_summary: str = ""
        self.question_agent: Optional[Any] = None
        self.summary_generated: bool = False
        self.current_task_id: Optional[str] = None
        
        # History management
        self.max_history_length = max_history_length
        
        logger.info(f"[TaskLock] Created for project_id={project_id}")
    
    async def put_queue(self, action_data: ActionData) -> None:
        """将动作放入队列
        
        Args:
            action_data: Action 数据
        """
        try:
            await self.queue.put(action_data)
            self.last_accessed = datetime.now()
            logger.debug(
                f"[TaskLock] Put action to queue: action={action_data.action.value}, "
                f"project_id={self.id}"
            )
        except asyncio.QueueFull:
            logger.warning(
                f"[TaskLock] Queue is full, dropping action: action={action_data.action.value}, "
                f"project_id={self.id}"
            )
            raise
    
    async def get_queue(self, timeout: Optional[float] = None) -> Optional[ActionData]:
        """从队列获取动作
        
        Args:
            timeout: 超时时间（秒），None 表示无限等待
            
        Returns:
            ActionData 或 None（超时）
        """
        try:
            if timeout:
                action_data = await asyncio.wait_for(self.queue.get(), timeout=timeout)
            else:
                action_data = await self.queue.get()
            
            self.last_accessed = datetime.now()
            logger.debug(
                f"[TaskLock] Got action from queue: action={action_data.action.value}, "
                f"project_id={self.id}"
            )
            return action_data
        except asyncio.TimeoutError:
            logger.debug(f"[TaskLock] Queue get timeout, project_id={self.id}")
            return None
    
    def add_conversation(self, role: str, content: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """添加对话历史
        
        Args:
            role: 角色（user, assistant, system）
            content: 内容
            metadata: 额外元数据
        """
        entry = {
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
            **(metadata or {}),
        }
        self.conversation_history.append(entry)
        self.last_accessed = datetime.now()
        
        # Cleanup if history is too long
        total_length = sum(len(str(e.get("content", ""))) for e in self.conversation_history)
        if total_length > self.max_history_length:
            # Remove oldest entries until under limit
            while total_length > self.max_history_length and self.conversation_history:
                removed = self.conversation_history.pop(0)
                total_length -= len(str(removed.get("content", "")))
        
        logger.debug(
            f"[TaskLock] Added conversation: role={role}, content_len={len(content)}, "
            f"project_id={self.id}"
        )
    
    def get_conversation_history(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """获取对话历史
        
        Args:
            limit: 限制返回数量（None 表示返回全部）
            
        Returns:
            对话历史列表
        """
        history = self.conversation_history
        if limit:
            history = history[-limit:]
        return history.copy()
    
    def add_background_task(self, task: asyncio.Task) -> None:
        """添加后台任务
        
        Args:
            task: 后台任务
        """
        self.background_tasks.add(task)
        logger.debug(f"[TaskLock] Added background task, project_id={self.id}")
    
    def remove_background_task(self, task: asyncio.Task) -> None:
        """移除后台任务
        
        Args:
            task: 后台任务
        """
        self.background_tasks.discard(task)
        logger.debug(f"[TaskLock] Removed background task, project_id={self.id}")
    
    async def cleanup(self) -> None:
        """清理后台任务和资源"""
        # Cancel all background tasks
        for task in self.background_tasks:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        
        self.background_tasks.clear()
        
        # Clear queues
        while not self.queue.empty():
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        
        logger.info(f"[TaskLock] Cleaned up, project_id={self.id}")
    
    def get_human_input_queue(self, agent_name: str) -> asyncio.Queue[str]:
        """获取或创建 Agent 的人类输入队列
        
        Args:
            agent_name: Agent 名称
            
        Returns:
            人类输入队列
        """
        if agent_name not in self.human_input:
            self.human_input[agent_name] = asyncio.Queue()
        return self.human_input[agent_name]
    
    def set_status(self, status: TaskStatus) -> None:
        """设置任务状态
        
        Args:
            status: 任务状态
        """
        old_status = self.status
        self.status = status
        self.last_accessed = datetime.now()
        logger.info(
            f"[TaskLock] Status changed: {old_status.value} -> {status.value}, "
            f"project_id={self.id}"
        )
    
    def update_last_task_result(self, result: str, summary: Optional[str] = None) -> None:
        """更新最后任务结果
        
        Args:
            result: 任务结果
            summary: 任务摘要（可选）
        """
        self.last_task_result = result
        if summary:
            self.last_task_summary = summary
        self.last_accessed = datetime.now()
        logger.debug(f"[TaskLock] Updated last task result, project_id={self.id}")


# Global TaskLock registry
_task_locks: Dict[str, TaskLock] = {}


def get_or_create_task_lock(
    project_id: str,
    max_queue_size: int = 1000,
    max_history_length: int = 10000,
) -> TaskLock:
    """获取或创建 TaskLock
    
    Args:
        project_id: 项目 ID
        max_queue_size: 队列最大大小
        max_history_length: 对话历史最大长度
        
    Returns:
        TaskLock 实例
    """
    if project_id not in _task_locks:
        _task_locks[project_id] = TaskLock(
            project_id=project_id,
            max_queue_size=max_queue_size,
            max_history_length=max_history_length,
        )
        logger.info(f"[TaskLock] Created new TaskLock for project_id={project_id}")
    else:
        logger.debug(f"[TaskLock] Reusing existing TaskLock for project_id={project_id}")
    
    return _task_locks[project_id]


def remove_task_lock(project_id: str) -> None:
    """移除 TaskLock（用于清理）
    
    Args:
        project_id: 项目 ID
    """
    if project_id in _task_locks:
        task_lock = _task_locks.pop(project_id)
        # Cleanup async resources
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Schedule cleanup
                asyncio.create_task(task_lock.cleanup())
            else:
                loop.run_until_complete(task_lock.cleanup())
        except RuntimeError:
            # No event loop, create new one
            asyncio.run(task_lock.cleanup())
        
        logger.info(f"[TaskLock] Removed TaskLock for project_id={project_id}")
