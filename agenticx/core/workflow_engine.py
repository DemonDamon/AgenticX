"""
AgenticX M7: 编排与路由引擎模块

本模块实现了工作流编排和智能路由功能，支持事件驱动的工作流执行。
核心理念：基于事件溯源思想，实现健壮、可恢复的工作流执行。

主要组件：
- WorkflowEngine: 编排引擎主入口
- WorkflowGraph: 工作流图定义
- TriggerService: 事件触发器服务
- SchedulerAgent: 智能任务调度器（未来实现）
"""

import asyncio
import json
from abc import ABC, abstractmethod
from typing import Dict, List, Any, Optional, Union, Callable, Type, Set
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime, timedelta, UTC
import uuid
import logging

from .task import Task
from .agent import Agent
from .workflow import Workflow, WorkflowNode, WorkflowEdge
from .event import Event, EventLog, TaskStartEvent, TaskEndEvent, ErrorEvent, HumanRequestEvent
from .agent_executor import AgentExecutor
from .tool import FunctionTool
from ..tools.base import BaseTool


logger = logging.getLogger(__name__)


class WorkflowStatus(Enum):
    """工作流状态"""
    PENDING = "pending"        # 等待开始
    RUNNING = "running"        # 运行中
    PAUSED = "paused"         # 暂停
    COMPLETED = "completed"    # 完成
    FAILED = "failed"         # 失败
    CANCELLED = "cancelled"    # 取消


class NodeStatus(Enum):
    """节点状态"""
    PENDING = "pending"        # 等待执行
    RUNNING = "running"        # 执行中
    COMPLETED = "completed"    # 完成
    FAILED = "failed"         # 失败
    SKIPPED = "skipped"       # 跳过


@dataclass
class ExecutionContext:
    """执行上下文"""
    workflow_id: str
    execution_id: str
    start_time: datetime
    current_node: Optional[str] = None
    variables: Dict[str, Any] = field(default_factory=dict)
    node_results: Dict[str, Any] = field(default_factory=dict)
    event_log: EventLog = field(default_factory=lambda: EventLog())
    status: WorkflowStatus = WorkflowStatus.PENDING


@dataclass
class NodeExecution:
    """节点执行信息"""
    node_id: str
    status: NodeStatus
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    result: Any = None
    error: Optional[str] = None
    retry_count: int = 0


@dataclass
class WorkflowResult:
    """工作流执行结果"""
    execution_id: str
    workflow_id: str
    status: WorkflowStatus
    start_time: datetime
    end_time: Optional[datetime] = None
    result: Any = None
    error: Optional[str] = None
    node_results: Dict[str, Any] = field(default_factory=dict)
    variables: Dict[str, Any] = field(default_factory=dict)
    event_log: Optional[EventLog] = None
    execution_time: Optional[float] = None


class WorkflowGraph:
    """
    工作流图定义
    
    支持静态和动态工作流定义，提供节点和边的管理功能。
    """
    
    def __init__(self, workflow: Optional[Workflow] = None):
        """
        初始化工作流图
        
        Args:
            workflow: 工作流定义
        """
        self.workflow = workflow
        self.nodes: Dict[str, WorkflowNode] = {}
        self.edges: List[WorkflowEdge] = []
        self.components: Dict[str, Union[AgentExecutor, BaseTool, FunctionTool, Callable, str]] = {}
        
        if workflow:
            self._load_from_workflow(workflow)
    
    def add_node(self, 
                 name: str, 
                 component: Union[AgentExecutor, BaseTool, FunctionTool, Callable, str],
                 node_type: str = "task",
                 config: Optional[Dict[str, Any]] = None) -> 'WorkflowGraph':
        """
        添加执行节点
        
        Args:
            name: 节点名称
            component: 执行组件（AgentExecutor, BaseTool, 或自定义函数）
            node_type: 节点类型
            config: 节点配置
            
        Returns:
            self: 支持链式调用
        """
        if node_type == "human_approval":
            component = "human_approval_placeholder"
        
        node = WorkflowNode(
            id=name,
            name=name,
            type=node_type,
            config=config or {}
        )
        
        self.nodes[name] = node
        self.components[name] = component
        
        return self
    
    def add_edge(self, 
                 from_node: str, 
                 to_node: str, 
                 condition: Optional[Callable[[Any], bool]] = None,
                 condition_config: Optional[Dict[str, Any]] = None) -> 'WorkflowGraph':
        """
        添加条件路由边
        
        Args:
            from_node: 源节点
            to_node: 目标节点
            condition: 条件函数
            condition_config: 条件配置
            
        Returns:
            self: 支持链式调用
        """
        edge = WorkflowEdge(
            source=from_node,
            target=to_node,
            condition=json.dumps(condition_config) if condition_config else None
        )
        
        # 如果提供了条件函数，存储在内部
        if condition:
            edge_id = f"{from_node}->{to_node}"
            if not hasattr(self, '_edge_conditions'):
                self._edge_conditions = {}
            self._edge_conditions[edge_id] = condition
        
        self.edges.append(edge)
        return self
    
    def get_next_nodes(self, current_node: str, execution_result: Any = None) -> List[str]:
        """
        获取下一个可执行的节点
        
        Args:
            current_node: 当前节点
            execution_result: 当前节点的执行结果
            
        Returns:
            下一个节点列表
        """
        next_nodes = []
        
        for edge in self.edges:
            if edge.source == current_node:
                # 检查条件
                if self._check_edge_condition(edge, execution_result):
                    next_nodes.append(edge.target)
        
        return next_nodes
    
    def get_entry_nodes(self) -> List[str]:
        """获取入口节点（没有前驱的节点）"""
        all_targets = {edge.target for edge in self.edges}
        all_nodes = set(self.nodes.keys())
        return list(all_nodes - all_targets)
    
    def validate(self) -> List[str]:
        """
        验证工作流图的有效性
        
        Returns:
            错误信息列表
        """
        errors = []
        
        # 检查节点是否都有对应的组件
        for node_id in self.nodes:
            if node_id not in self.components:
                errors.append(f"节点 {node_id} 没有对应的执行组件")
        
        # 检查边的有效性
        for edge in self.edges:
            edge_id = f"{edge.source}->{edge.target}"
            if edge.source not in self.nodes:
                errors.append(f"边 {edge_id} 的源节点 {edge.source} 不存在")
            if edge.target not in self.nodes:
                errors.append(f"边 {edge_id} 的目标节点 {edge.target} 不存在")
        
        # 检查是否有环路（简单检查）
        if self._has_cycles():
            errors.append("工作流图包含环路")
        
        # 检查是否有入口节点
        entry_nodes = self.get_entry_nodes()
        if not entry_nodes:
            errors.append("工作流图没有入口节点")
        
        return errors
    
    def _load_from_workflow(self, workflow: Workflow):
        """从工作流定义加载图结构"""
        # 加载节点
        for node in workflow.nodes:
            self.nodes[node.id] = node
            # 组件将在执行时动态解析
        
        # 加载边
        self.edges = workflow.edges.copy()
    
    def _check_edge_condition(self, edge: WorkflowEdge, execution_result: Any) -> bool:
        """检查边的条件是否满足"""
        # 如果没有条件，默认通过
        if not edge.condition and not hasattr(self, '_edge_conditions'):
            return True
        
        # 检查自定义条件函数
        if hasattr(self, '_edge_conditions'):
            edge_id = f"{edge.source}->{edge.target}"
            condition_func = self._edge_conditions.get(edge_id)
            if condition_func:
                try:
                    return condition_func(execution_result)
                except Exception as e:
                    logger.warning(f"边条件检查失败: {e}")
                    return False
        
        # 检查配置中的条件
        if edge.condition:
            try:
                # 解析JSON条件配置
                condition_config = json.loads(edge.condition)
                # 这里可以实现基于配置的条件检查逻辑
                # 例如：{"type": "result_equals", "value": "success"}
                condition_type = condition_config.get("type")
                if condition_type == "result_equals":
                    expected_value = condition_config.get("value")
                    return execution_result == expected_value
                elif condition_type == "result_contains":
                    expected_value = condition_config.get("value")
                    return expected_value in str(execution_result)
            except (json.JSONDecodeError, AttributeError):
                logger.warning(f"无效的条件配置: {edge.condition}")
                return True
        
        return True
    
    def _has_cycles(self) -> bool:
        """检查是否有环路（使用DFS）"""
        visited = set()
        rec_stack = set()
        
        def dfs(node):
            visited.add(node)
            rec_stack.add(node)
            
            for edge in self.edges:
                if edge.source == node:
                    neighbor = edge.target
                    if neighbor not in visited:
                        if dfs(neighbor):
                            return True
                    elif neighbor in rec_stack:
                        return True
            
            rec_stack.remove(node)
            return False
        
        for node in self.nodes:
            if node not in visited:
                if dfs(node):
                    return True
        
        return False


class TriggerService:
    """
    事件触发器服务
    
    支持定时触发和事件驱动触发。
    """
    
    def __init__(self):
        self.triggers: Dict[str, 'BaseTrigger'] = {}
        self.running = False
    
    def register_trigger(self, trigger_id: str, trigger: 'BaseTrigger'):
        """注册触发器"""
        self.triggers[trigger_id] = trigger
        trigger.set_service(self)
    
    def start(self):
        """启动触发器服务"""
        self.running = True
        for trigger in self.triggers.values():
            trigger.start()
    
    def stop(self):
        """停止触发器服务"""
        self.running = False
        for trigger in self.triggers.values():
            trigger.stop()
    
    async def trigger_workflow(self, workflow_name: str, initial_data: Optional[Dict[str, Any]] = None):
        """触发工作流执行"""
        # 这里应该调用 WorkflowEngine 来执行工作流
        logger.info(f"触发工作流: {workflow_name}, 数据: {initial_data}")


class BaseTrigger(ABC):
    """触发器基类"""
    
    def __init__(self, workflow_name: str):
        self.workflow_name = workflow_name
        self.service: Optional[TriggerService] = None
    
    def set_service(self, service: TriggerService):
        """设置触发器服务"""
        self.service = service
    
    @abstractmethod
    def start(self):
        """启动触发器"""
        pass
    
    @abstractmethod
    def stop(self):
        """停止触发器"""
        pass


class ScheduledTrigger(BaseTrigger):
    """定时触发器"""
    
    def __init__(self, 
                 workflow_name: str,
                 schedule: str,
                 initial_state: Optional[Dict[str, Any]] = None):
        """
        初始化定时触发器
        
        Args:
            workflow_name: 工作流名称
            schedule: 调度表达式（简化版，支持 "every_5s", "daily", "hourly" 等）
            initial_state: 初始状态数据
        """
        super().__init__(workflow_name)
        self.schedule = schedule
        self.initial_state = initial_state or {}
        self.task: Optional[asyncio.Task] = None
    
    def start(self):
        """启动定时触发器"""
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run_schedule())
    
    def stop(self):
        """停止定时触发器"""
        if self.task and not self.task.done():
            self.task.cancel()
    
    async def _run_schedule(self):
        """运行调度"""
        interval = self._parse_schedule(self.schedule)
        
        while True:
            try:
                await asyncio.sleep(interval)
                if self.service:
                    await self.service.trigger_workflow(
                        self.workflow_name, 
                        self.initial_state
                    )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"定时触发器执行失败: {e}")
    
    def _parse_schedule(self, schedule: str) -> float:
        """解析调度表达式为秒数"""
        if schedule.startswith("every_"):
            # every_5s, every_10m, every_1h
            parts = schedule.split("_")
            if len(parts) == 2:
                time_str = parts[1]
                if time_str.endswith("s"):
                    return float(time_str[:-1])
                elif time_str.endswith("m"):
                    return float(time_str[:-1]) * 60
                elif time_str.endswith("h"):
                    return float(time_str[:-1]) * 3600
        elif schedule == "daily":
            return 24 * 3600
        elif schedule == "hourly":
            return 3600
        
        # 默认5分钟
        return 300


class EventDrivenTrigger(BaseTrigger):
    """事件驱动触发器"""
    
    def __init__(self, 
                 workflow_name: str,
                 topic: str):
        """
        初始化事件驱动触发器
        
        Args:
            workflow_name: 工作流名称
            topic: 监听的事件主题
        """
        super().__init__(workflow_name)
        self.topic = topic
        self.listening = False
    
    def start(self):
        """启动事件监听"""
        self.listening = True
        # 这里应该连接到事件总线或消息队列
        logger.info(f"开始监听事件主题: {self.topic}")
    
    def stop(self):
        """停止事件监听"""
        self.listening = False
        logger.info(f"停止监听事件主题: {self.topic}")
    
    def handle_event(self, event_data: Dict[str, Any]):
        """处理接收到的事件"""
        if self.listening and self.service:
            asyncio.create_task(
                self.service.trigger_workflow(self.workflow_name, event_data)
            )


class WorkflowEngine:
    """
    编排引擎主入口
    
    基于事件溯源思想，实现健壮、可恢复的工作流执行。
    工作流的唯一状态源是其事件日志。
    """
    
    def __init__(self, 
                 enable_persistence: bool = False,
                 max_concurrent_nodes: int = 10):
        """
        初始化工作流引擎
        
        Args:
            enable_persistence: 是否启用持久化
            max_concurrent_nodes: 最大并发节点数
        """
        self.enable_persistence = enable_persistence
        self.max_concurrent_nodes = max_concurrent_nodes
        
        # 运行时状态
        self.active_executions: Dict[str, ExecutionContext] = {}
        self.node_executions: Dict[str, Dict[str, NodeExecution]] = {}
        
        # 服务组件
        self.trigger_service = TriggerService()
        
        # 执行器缓存
        self.executor_cache: Dict[str, AgentExecutor] = {}
    
    async def run(self, 
                  workflow: Union[Workflow, WorkflowGraph], 
                  initial_data: Optional[Dict[str, Any]] = None,
                  execution_id: Optional[str] = None) -> ExecutionContext:
        """
        执行工作流
        
        Args:
            workflow: 工作流定义或工作流图
            initial_data: 初始数据
            execution_id: 执行ID（用于恢复）
            
        Returns:
            ExecutionContext: 执行上下文
        """
        # 创建或恢复执行上下文
        if execution_id and execution_id in self.active_executions:
            context = self.active_executions[execution_id]
            logger.info(f"恢复工作流执行: {execution_id}")
        else:
            context = self._create_execution_context(workflow, initial_data)
            execution_id = context.execution_id
        
        try:
            # 将工作流转换为图
            if isinstance(workflow, Workflow):
                graph = WorkflowGraph(workflow)
            else:
                graph = workflow
            
            # 验证工作流图
            errors = graph.validate()
            if errors:
                raise ValueError(f"工作流图验证失败: {'; '.join(errors)}")
            
            # 开始执行
            context.status = WorkflowStatus.RUNNING
            self.active_executions[execution_id] = context
            
            # 记录开始事件
            start_event = TaskStartEvent(
                task_id=context.workflow_id,
                task_description=f"工作流执行: {context.workflow_id}",
                agent_id="workflow_engine"
            )
            context.event_log.add_event(start_event)
            
            # 获取入口节点
            entry_nodes = graph.get_entry_nodes()
            if not entry_nodes:
                raise ValueError("工作流没有入口节点")
            
            # 并发执行入口节点
            await self._execute_nodes(graph, entry_nodes, context)
            
            # 检查最终状态
            if context.status == WorkflowStatus.RUNNING:
                context.status = WorkflowStatus.COMPLETED
            
            # 只有在工作流未暂停时才记录结束事件
            if context.status != WorkflowStatus.PAUSED:
                # 记录结束事件
                end_event = TaskEndEvent(
                    task_id=context.workflow_id,
                    success=context.status == WorkflowStatus.COMPLETED,
                    result=f"工作流执行完成，状态: {context.status.value}",
                    agent_id="workflow_engine"
                )
                context.event_log.add_event(end_event)
            
        except Exception as e:
            logger.error(f"工作流执行失败: {e}")
            context.status = WorkflowStatus.FAILED
            
            # 记录错误事件
            error_event = ErrorEvent(
                error_type=type(e).__name__,
                error_message=str(e),
                agent_id="workflow_engine"
            )
            context.event_log.add_event(error_event)
            
        finally:
            # 如果工作流未暂停，则清理活跃执行
            if context.status != WorkflowStatus.PAUSED:
                if execution_id in self.active_executions:
                    del self.active_executions[execution_id]
        
        return context
    
    async def pause_execution(self, execution_id: str) -> bool:
        """暂停工作流执行"""
        if execution_id in self.active_executions:
            context = self.active_executions[execution_id]
            context.status = WorkflowStatus.PAUSED
            logger.info(f"工作流执行已暂停: {execution_id}")
            return True
        return False
    
    async def resume_execution(self, execution_id: str) -> bool:
        """恢复工作流执行"""
        if execution_id in self.active_executions:
            context = self.active_executions[execution_id]
            if context.status == WorkflowStatus.PAUSED:
                context.status = WorkflowStatus.RUNNING
                logger.info(f"工作流执行已恢复: {execution_id}")
                # 这里需要重新启动执行逻辑
                return True
        return False
    
    async def cancel_execution(self, execution_id: str) -> bool:
        """取消工作流执行"""
        if execution_id in self.active_executions:
            context = self.active_executions[execution_id]
            context.status = WorkflowStatus.CANCELLED
            logger.info(f"工作流执行已取消: {execution_id}")
            return True
        return False
    
    def get_execution_status(self, execution_id: str) -> Optional[ExecutionContext]:
        """获取执行状态"""
        return self.active_executions.get(execution_id)
    
    def _create_execution_context(self, 
                                  workflow: Union[Workflow, WorkflowGraph], 
                                  initial_data: Optional[Dict[str, Any]]) -> ExecutionContext:
        """创建执行上下文"""
        execution_id = str(uuid.uuid4())
        
        if isinstance(workflow, Workflow):
            workflow_id = workflow.id
        else:
            workflow_id = workflow.workflow.id if workflow.workflow else "dynamic_workflow"
        
        context = ExecutionContext(
            workflow_id=workflow_id,
            execution_id=execution_id,
            start_time=datetime.now(),
            variables=initial_data or {}
        )
        
        return context
    
    async def _execute_nodes(self, 
                             graph: WorkflowGraph, 
                             node_ids: List[str], 
                             context: ExecutionContext):
        """并发执行节点"""
        # 限制并发数
        semaphore = asyncio.Semaphore(self.max_concurrent_nodes)
        
        async def execute_single_node(node_id: str):
            async with semaphore:
                await self._execute_node(graph, node_id, context)
        
        # 创建执行任务
        tasks = [execute_single_node(node_id) for node_id in node_ids]
        
        # 等待所有节点完成
        await asyncio.gather(*tasks, return_exceptions=True)
    
    async def _execute_node(self, 
                            graph: WorkflowGraph, 
                            node_id: str, 
                            context: ExecutionContext):
        """执行单个节点"""
        try:
            # 检查是否暂停
            if context.status == WorkflowStatus.PAUSED:
                return
            
            # 获取节点
            node = graph.nodes[node_id]

            # 处理人工审批节点
            if node.type == "human_approval":
                return await self._execute_human_approval(node, context)

            # 获取组件
            component = graph.components[node_id]
            
            # 创建节点执行记录
            node_execution = NodeExecution(
                node_id=node_id,
                status=NodeStatus.RUNNING,
                start_time=datetime.now()
            )
            
            if context.execution_id not in self.node_executions:
                self.node_executions[context.execution_id] = {}
            self.node_executions[context.execution_id][node_id] = node_execution
            
            logger.info(f"开始执行节点: {node_id}")
            
            # 根据组件类型执行
            result = await self._execute_component(component, node, context)
            
            # 更新执行记录
            node_execution.status = NodeStatus.COMPLETED
            node_execution.end_time = datetime.now()
            node_execution.result = result
            
            # 保存结果到上下文
            context.node_results[node_id] = result
            
            logger.info(f"节点执行完成: {node_id}")
            
            # 获取下一个节点并继续执行
            next_nodes = graph.get_next_nodes(node_id, result)
            if next_nodes:
                await self._execute_nodes(graph, next_nodes, context)
            
        except Exception as e:
            logger.error(f"节点执行失败: {node_id}, 错误: {e}")
            
            # 更新执行记录
            if context.execution_id in self.node_executions:
                if node_id in self.node_executions[context.execution_id]:
                    node_execution = self.node_executions[context.execution_id][node_id]
                    node_execution.status = NodeStatus.FAILED
                    node_execution.end_time = datetime.now()
                    node_execution.error = str(e)
            
            # 记录错误事件
            error_event = ErrorEvent(
                error_type=type(e).__name__,
                error_message=f"节点 {node_id} 执行失败: {str(e)}",
                agent_id="workflow_engine"
            )
            context.event_log.add_event(error_event)
            
            # 设置工作流状态为失败
            context.status = WorkflowStatus.FAILED
    
    async def _execute_component(self, 
                                 component: Union[AgentExecutor, BaseTool, FunctionTool, Callable, str],
                                 node: WorkflowNode,
                                 context: ExecutionContext) -> Any:
        """执行组件"""
        if isinstance(component, AgentExecutor):
            # 执行 Agent
            return await self._execute_agent(component, node, context)
        
        elif isinstance(component, (BaseTool, FunctionTool)):
            # 执行工具（包括 FunctionTool）
            return await self._execute_tool(component, node, context)
        
        elif callable(component):
            # 执行自定义函数
            return await self._execute_function(component, node, context)
        
        elif isinstance(component, str):
            # 字符串类型，可能是组件名称或配置
            return await self._execute_by_name(component, node, context)
        
        else:
            raise ValueError(f"不支持的组件类型: {type(component)}")

    async def _execute_human_approval(self, 
                                    node: WorkflowNode,
                                    context: ExecutionContext):
        """执行人工审批节点，触发 HumanRequestEvent 并暂停工作流"""
        logger.info(f"节点 {node.id} 需要人工审批，正在暂停工作流...")

        # 从节点配置中获取问题和上下文
        question = node.config.get("question", f"请批准节点 '{node.name}' 的执行。")
        approval_context = node.config.get("context", "无")
        
        # 创建并记录人工请求事件
        human_request_event = HumanRequestEvent(
            question=question,
            context=f"工作流审批: {context.workflow_id}\n节点: {node.name}\n上下文: {approval_context}",
            urgency="high"
        )
        context.event_log.add_event(human_request_event)
        
        # 暂停工作流
        context.status = WorkflowStatus.PAUSED
        
        # 保存节点状态
        node_execution = NodeExecution(
            node_id=node.id,
            status=NodeStatus.RUNNING, # 标记为运行中，等待恢复
            start_time=datetime.now()
        )
        if context.execution_id not in self.node_executions:
            self.node_executions[context.execution_id] = {}
        self.node_executions[context.execution_id][node.id] = node_execution
    
    async def _execute_agent(self, 
                             agent_executor: AgentExecutor,
                             node: WorkflowNode,
                             context: ExecutionContext) -> Any:
        """执行 Agent"""
        # 从节点配置创建任务
        task_config = node.config.get('task', {})
        
        task = Task(
            description=task_config.get('description', f"执行节点: {node.name}"),
            expected_output=task_config.get('expected_output', "任务执行结果"),
            context=context.variables
        )
        
        # 创建一个临时的Agent实例
        temp_agent = Agent(
            name=f"workflow_agent_{node.name}",
            role="Workflow Executor",
            goal="Execute workflow tasks",
            organization_id="workflow_engine"
        )
        
        # 执行任务
        result = agent_executor.run(temp_agent, task)
        
        return result
    
    async def _execute_tool(self, 
                            tool: Union[BaseTool, FunctionTool],
                            node: WorkflowNode,
                            context: ExecutionContext) -> Any:
        """执行工具"""
        # 从节点配置获取工具参数
        tool_args = node.config.get('args', {})
        
        # 准备变量上下文（包括节点结果）
        variables_context = {
            **context.variables,
            'node_results': context.node_results
        }
        
        # 替换上下文变量
        resolved_args = self._resolve_variables(tool_args, variables_context)
        
        # 执行工具
        if isinstance(tool, FunctionTool):
            # FunctionTool 使用 execute/aexecute 方法
            if hasattr(tool, 'aexecute'):
                result = await tool.aexecute(**resolved_args)
            else:
                result = tool.execute(**resolved_args)
        else:
            # BaseTool 使用 run/arun 方法
            if hasattr(tool, 'arun'):
                result = await tool.arun(**resolved_args)
            else:
                result = tool.run(**resolved_args)
        
        return result
    
    async def _execute_function(self, 
                                func: Callable,
                                node: WorkflowNode,
                                context: ExecutionContext) -> Any:
        """执行自定义函数"""
        # 从节点配置获取函数参数
        func_args = node.config.get('args', {})
        
        # 准备变量上下文（包括节点结果）
        variables_context = {
            **context.variables,
            'node_results': context.node_results
        }
        
        # 替换上下文变量
        resolved_args = self._resolve_variables(func_args, variables_context)
        
        # 执行函数
        if asyncio.iscoroutinefunction(func):
            result = await func(**resolved_args)
        else:
            result = func(**resolved_args)
        
        return result
    
    async def _execute_by_name(self, 
                               component_name: str,
                               node: WorkflowNode,
                               context: ExecutionContext) -> Any:
        """根据名称执行组件"""
        # 这里可以实现组件注册表查找
        # 暂时返回配置信息
        return {
            'component_name': component_name,
            'node_config': node.config,
            'context_variables': context.variables
        }
    
    def _resolve_variables(self, 
                           obj: Any, 
                           variables: Dict[str, Any]) -> Any:
        """解析上下文变量"""
        if isinstance(obj, dict):
            return {k: self._resolve_variables(v, variables) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [self._resolve_variables(item, variables) for item in obj]
        elif isinstance(obj, str):
            # 简单的变量替换：${variable_name}
            import re
            pattern = r'\$\{([^}]+)\}'
            
            def replace_var(match):
                var_name = match.group(1)
                # 首先检查节点结果
                if var_name in variables.get('node_results', {}):
                    return str(variables['node_results'][var_name])
                # 然后检查普通变量
                return str(variables.get(var_name, match.group(0)))
            
            return re.sub(pattern, replace_var, obj)
        else:
            return obj


# 导出的主要接口
__all__ = [
    'WorkflowEngine',
    'WorkflowGraph', 
    'TriggerService',
    'ScheduledTrigger',
    'EventDrivenTrigger',
    'ExecutionContext',
    'NodeExecution',
    'WorkflowStatus',
    'NodeStatus'
]