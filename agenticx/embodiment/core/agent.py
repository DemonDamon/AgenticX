"""AgenticX M16.1: GUI智能体核心类

本模块定义GUI智能体的核心类，包括：
- GUITask: GUI任务定义
- ActionResult: 动作执行结果
- GUIAgentContext: GUI智能体上下文
- GUIAgentResult: GUI智能体执行结果
- GUIAgent: GUI智能体抽象基类
"""

from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any, Union, Callable, Tuple
from dataclasses import dataclass, field
from enum import Enum
import time
import uuid
import logging
import json
from pathlib import Path

from .models import (
    ScreenState,
    GUIAction,
    ActionSpace,
    ActionType,
    InteractionElement
)
from .environment import GUIEnvironment


class TaskStatus(Enum):
    """任务状态枚举"""
    PENDING = "pending"  # 待执行
    RUNNING = "running"  # 执行中
    COMPLETED = "completed"  # 已完成
    FAILED = "failed"  # 失败
    CANCELLED = "cancelled"  # 已取消
    PAUSED = "paused"  # 暂停


class TaskPriority(Enum):
    """任务优先级枚举"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    URGENT = "urgent"


@dataclass
class GUITask:
    """GUI任务数据类
    
    表示一个GUI自动化任务
    """
    task_id: str  # 任务唯一标识符
    description: str  # 任务描述
    goal: str  # 任务目标
    priority: TaskPriority = TaskPriority.MEDIUM  # 任务优先级
    status: TaskStatus = TaskStatus.PENDING  # 任务状态
    max_steps: int = 100  # 最大步数
    timeout: float = 300.0  # 超时时间（秒）
    target_app: Optional[str] = None  # 目标应用
    initial_state: Optional[ScreenState] = None  # 初始状态
    success_criteria: List[str] = field(default_factory=list)  # 成功标准
    constraints: List[str] = field(default_factory=list)  # 约束条件
    context: Dict[str, Any] = field(default_factory=dict)  # 任务上下文
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    created_at: float = field(default_factory=time.time)  # 创建时间
    started_at: Optional[float] = None  # 开始时间
    completed_at: Optional[float] = None  # 完成时间
    current_step: int = 0  # 当前步数
    success: bool = False  # 是否成功
    error: Optional[str] = None  # 错误信息
    
    def __post_init__(self):
        """初始化后处理"""
        if not self.task_id:
            self.task_id = str(uuid.uuid4())
    
    @property
    def duration(self) -> Optional[float]:
        """获取任务持续时间"""
        if self.started_at is None:
            return None
        end_time = self.completed_at or time.time()
        return end_time - self.started_at
    
    @property
    def is_active(self) -> bool:
        """判断任务是否处于活跃状态"""
        return self.status in [TaskStatus.PENDING, TaskStatus.RUNNING, TaskStatus.PAUSED]
    
    @property
    def is_finished(self) -> bool:
        """判断任务是否已结束"""
        return self.status in [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED]
    
    def start(self):
        """开始任务"""
        self.status = TaskStatus.RUNNING
        self.started_at = time.time()
    
    def complete(self, success: bool = True, error: Optional[str] = None):
        """完成任务"""
        self.success = success
        if success:
            self.status = TaskStatus.COMPLETED
        else:
            self.status = TaskStatus.FAILED
            self.error = error
        self.completed_at = time.time()
    
    def fail(self, reason: Optional[str] = None):
        """任务失败"""
        self.status = TaskStatus.FAILED
        self.completed_at = time.time()
        if reason:
            self.metadata["failure_reason"] = reason
    
    def cancel(self, reason: Optional[str] = None):
        """取消任务"""
        self.status = TaskStatus.CANCELLED
        self.completed_at = time.time()
        if reason:
            self.metadata["cancellation_reason"] = reason
    
    def pause(self):
        """暂停任务"""
        if self.status == TaskStatus.RUNNING:
            self.status = TaskStatus.PAUSED
    
    def resume(self):
        """恢复任务"""
        if self.status == TaskStatus.PAUSED:
            self.status = TaskStatus.RUNNING
    
    def is_timeout(self) -> bool:
        """判断任务是否超时"""
        if not self.started_at:
            return False
        return time.time() - self.started_at > self.timeout
    
    def is_max_steps_reached(self) -> bool:
        """判断是否达到最大步数"""
        return self.current_step >= self.max_steps
    
    def increment_step(self):
        """增加步数"""
        self.current_step += 1
    
    def get_duration(self) -> Optional[float]:
        """获取任务持续时间"""
        return self.duration
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "task_id": self.task_id,
            "description": self.description,
            "goal": self.goal,
            "priority": self.priority.value,
            "status": self.status.value,
            "max_steps": self.max_steps,
            "timeout": self.timeout,
            "target_app": self.target_app,
            "success_criteria": self.success_criteria,
            "constraints": self.constraints,
            "context": self.context,
            "metadata": self.metadata,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "current_step": self.current_step,
            "success": self.success,
            "error": self.error,
            "duration": self.duration
        }


@dataclass
class ActionResult:
    """动作执行结果数据类"""
    action: GUIAction  # 执行的动作
    success: bool  # 是否成功
    timestamp: float = field(default_factory=time.time)  # 时间戳
    execution_time: Optional[float] = None  # 执行时间
    error_message: Optional[str] = None  # 错误信息
    before_state: Optional[ScreenState] = None  # 执行前状态
    after_state: Optional[ScreenState] = None  # 执行后状态
    platform_result: Optional[Dict[str, Any]] = None  # 平台特定结果
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    
    @property
    def state_changed(self) -> bool:
        """判断状态是否发生变化"""
        if not self.before_state or not self.after_state:
            return False
        # 简单比较：比较元素数量和应用包名
        before_elements = len(self.before_state.element_tree.elements)
        after_elements = len(self.after_state.element_tree.elements)
        before_app = self.before_state.app_package
        after_app = self.after_state.app_package
        return before_elements != after_elements or before_app != after_app
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "action": self.action.to_dict(),
            "success": self.success,
            "timestamp": self.timestamp,
            "execution_time": self.execution_time,
            "error_message": self.error_message,
            "state_changed": self.state_changed,
            "platform_result": self.platform_result,
            "metadata": self.metadata
        }


@dataclass
class GUIAgentContext:
    """GUI智能体上下文数据类
    
    包含智能体执行任务时的上下文信息
    """
    task: GUITask  # 当前任务
    environment: GUIEnvironment  # GUI环境
    current_state: Optional[ScreenState] = None  # 当前屏幕状态
    action_history: List[ActionResult] = field(default_factory=list)  # 动作历史
    state_history: List[ScreenState] = field(default_factory=list)  # 状态历史
    step_count: int = 0  # 步数计数
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))  # 会话ID
    working_memory: Dict[str, Any] = field(default_factory=dict)  # 工作记忆
    long_term_memory: Dict[str, Any] = field(default_factory=dict)  # 长期记忆
    user_preferences: Dict[str, Any] = field(default_factory=dict)  # 用户偏好
    error_recovery_attempts: int = 0  # 错误恢复尝试次数
    last_error: Optional[str] = None  # 最后的错误
    debug_info: Dict[str, Any] = field(default_factory=dict)  # 调试信息
    
    @property
    def last_action_result(self) -> Optional[ActionResult]:
        """获取最后一个动作结果"""
        return self.action_history[-1] if self.action_history else None
    
    @property
    def is_task_timeout(self) -> bool:
        """判断任务是否超时"""
        if not self.task.started_at:
            return False
        return time.time() - self.task.started_at > self.task.timeout
    
    @property
    def is_max_steps_reached(self) -> bool:
        """判断是否达到最大步数"""
        return self.step_count >= self.task.max_steps
    
    @property
    def should_stop(self) -> bool:
        """判断是否应该停止执行"""
        return (self.is_task_timeout or 
                self.is_max_steps_reached or 
                self.task.is_finished)
    
    def add_action_result(self, result: ActionResult):
        """添加动作结果"""
        self.action_history.append(result)
        self.step_count += 1
        if result.after_state:
            self.current_state = result.after_state
    
    def update_state(self, state: ScreenState):
        """更新当前状态"""
        self.current_state = state
        self.state_history.append(state)
    
    def get_statistics(self) -> Dict[str, Any]:
        """获取统计信息"""
        successful_actions = self.get_successful_actions()
        failed_actions = self.get_failed_actions()
        total_actions = len(self.action_history)
        
        success_rate = len(successful_actions) / total_actions if total_actions > 0 else 0.0
        
        execution_times = [result.execution_time for result in self.action_history 
                          if result.execution_time is not None]
        avg_execution_time = sum(execution_times) / len(execution_times) if execution_times else 0.0
        
        return {
            "total_actions": total_actions,
            "successful_actions": len(successful_actions),
            "failed_actions": len(failed_actions),
            "success_rate": success_rate,
            "average_execution_time": avg_execution_time
        }
    
    def get_recent_actions(self, count: int = 5) -> List[ActionResult]:
        """获取最近的动作"""
        return self.action_history[-count:] if self.action_history else []
    
    def get_successful_actions(self) -> List[ActionResult]:
        """获取成功的动作"""
        return [result for result in self.action_history if result.success]
    
    def get_failed_actions(self) -> List[ActionResult]:
        """获取失败的动作"""
        return [result for result in self.action_history if not result.success]
    
    def update_working_memory(self, key: str, value: Any):
        """更新工作记忆"""
        self.working_memory[key] = value
    
    def get_from_working_memory(self, key: str, default: Any = None) -> Any:
        """从工作记忆获取值"""
        return self.working_memory.get(key, default)
    
    def clear_working_memory(self):
        """清空工作记忆"""
        self.working_memory.clear()
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "task": self.task.to_dict(),
            "step_count": self.step_count,
            "session_id": self.session_id,
            "action_history": [result.to_dict() for result in self.action_history],
            "state_history": [state.to_dict() for state in self.state_history],
            "action_count": len(self.action_history),
            "successful_actions": len(self.get_successful_actions()),
            "failed_actions": len(self.get_failed_actions()),
            "error_recovery_attempts": self.error_recovery_attempts,
            "last_error": self.last_error,
            "is_task_timeout": self.is_task_timeout,
            "is_max_steps_reached": self.is_max_steps_reached,
            "should_stop": self.should_stop,
            "working_memory_keys": list(self.working_memory.keys()),
            "debug_info": self.debug_info,
            "statistics": self.get_statistics()
        }


@dataclass
class GUIAgentResult:
    """GUI智能体执行结果数据类"""
    task_id: str  # 任务ID
    success: bool  # 是否成功
    total_steps: int = 0  # 总步数
    execution_time: Optional[float] = None  # 总执行时间
    final_state: Optional[ScreenState] = None  # 最终状态
    action_sequence: List[ActionResult] = field(default_factory=list)  # 动作序列
    error_message: Optional[str] = None  # 错误信息
    completion_reason: Optional[str] = None  # 完成原因
    performance_metrics: Dict[str, Any] = field(default_factory=dict)  # 性能指标
    metrics: Dict[str, Any] = field(default_factory=dict)  # 指标
    learned_patterns: List[Dict[str, Any]] = field(default_factory=list)  # 学习到的模式
    recommendations: List[str] = field(default_factory=list)  # 建议
    metadata: Dict[str, Any] = field(default_factory=dict)  # 元数据
    timestamp: float = field(default_factory=time.time)  # 时间戳
    
    @property
    def success_rate(self) -> float:
        """获取成功率"""
        if not self.action_sequence:
            return 0.0
        successful = sum(1 for result in self.action_sequence if result.success)
        return successful / len(self.action_sequence)
    
    @property
    def average_action_time(self) -> float:
        """获取平均动作执行时间"""
        if not self.action_sequence:
            return 0.0
        times = [result.execution_time for result in self.action_sequence 
                if result.execution_time is not None]
        return sum(times) / len(times) if times else 0.0
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "task_id": self.task_id,
            "success": self.success,
            "total_steps": self.total_steps,
            "execution_time": self.execution_time,
            "success_rate": self.success_rate,
            "average_action_time": self.average_action_time,
            "error_message": self.error_message,
            "completion_reason": self.completion_reason,
            "performance_metrics": self.performance_metrics,
            "metrics": self.metrics,
            "learned_patterns": self.learned_patterns,
            "recommendations": self.recommendations,
            "metadata": self.metadata,
            "timestamp": self.timestamp
        }
    
    def save_to_file(self, file_path: Union[str, Path]):
        """保存结果到文件"""
        file_path = Path(file_path)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)


class GUIAgent(ABC):
    """GUI智能体抽象基类
    
    定义GUI智能体的统一接口，包括：
    - 任务执行
    - 决策制定
    - 学习和适应
    - 错误恢复
    """
    
    def __init__(self, agent_id: Optional[str] = None, config: Optional[Dict[str, Any]] = None):
        """初始化GUI智能体
        
        Args:
            agent_id: 智能体ID
            config: 配置参数
        """
        self.agent_id = agent_id or str(uuid.uuid4())
        self.config = config or {}
        self.logger = logging.getLogger(f"{self.__class__.__name__}_{self.agent_id[:8]}")
        self.is_running = False
        self.current_context: Optional[GUIAgentContext] = None
        self.created_at = time.time()
        
        # 性能统计
        self.total_tasks = 0
        self.successful_tasks = 0
        self.total_actions = 0
        self.successful_actions = 0
    
    @abstractmethod
    async def plan_actions(self, context: GUIAgentContext) -> List[GUIAction]:
        """规划动作序列
        
        Args:
            context: 智能体上下文
            
        Returns:
            List[GUIAction]: 规划的动作序列
        """
        pass
    
    @abstractmethod
    async def select_next_action(self, context: GUIAgentContext) -> Optional[GUIAction]:
        """选择下一个动作
        
        Args:
            context: 智能体上下文
            
        Returns:
            Optional[GUIAction]: 选择的动作，None表示任务完成
        """
        pass
    
    @abstractmethod
    async def evaluate_state(self, context: GUIAgentContext) -> Dict[str, Any]:
        """评估当前状态
        
        Args:
            context: 智能体上下文
            
        Returns:
            Dict[str, Any]: 状态评估结果
        """
        pass
    
    @abstractmethod
    async def check_task_completion(self, context: GUIAgentContext) -> Tuple[bool, str]:
        """检查任务是否完成
        
        Args:
            context: 智能体上下文
            
        Returns:
            Tuple[bool, str]: (是否完成, 完成原因)
        """
        pass
    
    @abstractmethod
    async def handle_error(self, context: GUIAgentContext, error: Exception) -> bool:
        """处理错误
        
        Args:
            context: 智能体上下文
            error: 发生的错误
            
        Returns:
            bool: 是否成功恢复
        """
        pass
    
    @abstractmethod
    async def learn_from_experience(self, result: GUIAgentResult):
        """从经验中学习
        
        Args:
            result: 执行结果
        """
        pass
    
    # 通用方法实现
    
    async def execute_task(self, task: GUITask, environment: GUIEnvironment) -> GUIAgentResult:
        """执行GUI任务
        
        Args:
            task: 要执行的任务
            environment: GUI环境
            
        Returns:
            GUIAgentResult: 执行结果
        """
        start_time = time.time()
        self.is_running = True
        self.total_tasks += 1
        
        # 创建上下文
        context = GUIAgentContext(
            task=task,
            environment=environment
        )
        self.current_context = context
        
        try:
            # 开始任务
            task.start()
            self.logger.info(f"Starting task: {task.description}")
            
            # 获取初始状态
            context.current_state = await environment.get_screen_state()
            task.initial_state = context.current_state
            
            # 主执行循环
            while not context.should_stop:
                try:
                    # 检查任务完成
                    is_completed, reason = await self.check_task_completion(context)
                    if is_completed:
                        task.complete()
                        self.logger.info(f"Task completed: {reason}")
                        break
                    
                    # 选择下一个动作
                    action = await self.select_next_action(context)
                    if action is None:
                        task.complete()
                        self.logger.info("No more actions to execute")
                        break
                    
                    # 执行动作
                    before_state = context.current_state
                    action_start_time = time.time()
                    
                    execution_result = await environment.execute_action_safe(action)
                    
                    action_end_time = time.time()
                    execution_time = action_end_time - action_start_time
                    
                    # 获取执行后状态
                    after_state = await environment.get_screen_state()
                    
                    # 创建动作结果
                    action_result = ActionResult(
                        action=action,
                        success=execution_result.get("success", False),
                        execution_time=execution_time,
                        error_message=execution_result.get("error"),
                        before_state=before_state,
                        after_state=after_state,
                        platform_result=execution_result
                    )
                    
                    # 更新上下文
                    context.add_action_result(action_result)
                    self.total_actions += 1
                    if action_result.success:
                        self.successful_actions += 1
                    
                    self.logger.info(f"Action {context.step_count}: {action.action_type.value} - {'Success' if action_result.success else 'Failed'}")
                    
                except Exception as e:
                    self.logger.error(f"Error during action execution: {e}")
                    
                    # 尝试错误恢复
                    recovered = await self.handle_error(context, e)
                    if not recovered:
                        task.fail(str(e))
                        break
            
            # 检查任务状态
            if context.is_task_timeout:
                task.fail("Task timeout")
            elif context.is_max_steps_reached:
                task.fail("Maximum steps reached")
            
            # 创建结果
            end_time = time.time()
            execution_time = end_time - start_time
            
            result = GUIAgentResult(
                task_id=task.task_id,
                success=task.status == TaskStatus.COMPLETED,
                total_steps=context.step_count,
                execution_time=execution_time,
                final_state=context.current_state,
                action_sequence=context.action_history,
                error_message=context.last_error,
                completion_reason=task.metadata.get("failure_reason") or task.metadata.get("cancellation_reason")
            )
            
            # 更新统计
            if result.success:
                self.successful_tasks += 1
            
            # 学习
            await self.learn_from_experience(result)
            
            self.logger.info(f"Task finished: {task.status.value} in {execution_time:.2f}s with {context.step_count} steps")
            return result
            
        except Exception as e:
            self.logger.error(f"Fatal error during task execution: {e}")
            task.fail(str(e))
            
            return GUIAgentResult(
                task_id=task.task_id,
                success=False,
                execution_time=time.time() - start_time,
                error_message=str(e)
            )
        
        finally:
            self.is_running = False
            self.current_context = None
    
    def get_performance_stats(self) -> Dict[str, Any]:
        """获取性能统计
        
        Returns:
            Dict[str, Any]: 性能统计信息
        """
        return {
            "agent_id": self.agent_id,
            "total_tasks": self.total_tasks,
            "successful_tasks": self.successful_tasks,
            "task_success_rate": self.successful_tasks / self.total_tasks if self.total_tasks > 0 else 0.0,
            "total_actions": self.total_actions,
            "successful_actions": self.successful_actions,
            "action_success_rate": self.successful_actions / self.total_actions if self.total_actions > 0 else 0.0,
            "is_running": self.is_running
        }
    
    def reset_stats(self):
        """重置统计信息"""
        self.total_tasks = 0
        self.successful_tasks = 0
        self.total_actions = 0
        self.successful_actions = 0
        self.logger.info("Performance statistics reset")
    
    async def stop(self):
        """停止智能体"""
        if self.current_context and self.current_context.task.is_active:
            self.current_context.task.cancel("Agent stopped")
        self.is_running = False
        self.logger.info("Agent stopped")
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "agent_id": self.agent_id,
            "created_at": self.created_at,
            "is_running": self.is_running,
            "config": self.config,
            "performance_stats": self.get_performance_stats()
        }