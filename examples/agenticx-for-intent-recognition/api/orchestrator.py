"""M8 API Service Layer Orchestrator

服务编排器，基于AgenticX ServiceOrchestrator架构。
"""

import asyncio
import time
import logging
from typing import Dict, Any, Optional, List, Callable, Union
from datetime import datetime
from enum import Enum
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, Future

from agenticx.core.platform import User, Organization
from agenticx.core.message import Message

from models.api_models import (
    IntentRequest, IntentResponse, RequestStatus, ServiceInfo
)
from models.data_models import IntentType


class ServiceStatus(Enum):
    """服务状态枚举"""
    INITIALIZING = "initializing"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"
    STOPPED = "stopped"
    ERROR = "error"


class TaskPriority(Enum):
    """任务优先级枚举"""
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    CRITICAL = 4


@dataclass
class ServiceTask:
    """服务任务数据类"""
    task_id: str
    task_type: str
    payload: Dict[str, Any]
    priority: TaskPriority = TaskPriority.MEDIUM
    created_at: datetime = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: str = "pending"
    result: Optional[Any] = None
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3
    timeout: float = 30.0
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()


class ServiceOrchestrator:
    """服务编排器基类
    
    基于AgenticX平台架构，提供服务协调和任务管理功能。
    """
    
    def __init__(self, service_info: ServiceInfo, max_workers: int = 10):
        self.service_info = service_info
        self.logger = logging.getLogger(self.__class__.__name__)
        self.status = ServiceStatus.INITIALIZING
        self.start_time = time.time()
        
        # 任务管理
        self.task_queue: asyncio.Queue = asyncio.Queue()
        self.active_tasks: Dict[str, ServiceTask] = {}
        self.completed_tasks: Dict[str, ServiceTask] = {}
        self.failed_tasks: Dict[str, ServiceTask] = {}
        
        # 线程池
        self.executor = ThreadPoolExecutor(max_workers=max_workers)
        self.max_workers = max_workers
        
        # 服务注册表
        self.services: Dict[str, Any] = {}
        self.service_handlers: Dict[str, Callable] = {}
        
        # 监控指标
        self.metrics = {
            "total_tasks": 0,
            "completed_tasks": 0,
            "failed_tasks": 0,
            "active_tasks": 0,
            "average_processing_time": 0.0,
            "throughput": 0.0
        }
        
        # 工作任务
        self._worker_tasks: List[asyncio.Task] = []
        self._shutdown_event = asyncio.Event()
        
        self.logger.info(f"ServiceOrchestrator initialized: {service_info.name}")
    
    async def start(self):
        """启动服务编排器"""
        if self.status != ServiceStatus.INITIALIZING:
            raise RuntimeError(f"Cannot start orchestrator in {self.status.value} state")
        
        self.logger.info("Starting service orchestrator...")
        self.status = ServiceStatus.RUNNING
        
        # 启动工作线程
        for i in range(self.max_workers):
            worker_task = asyncio.create_task(
                self._worker_loop(f"worker-{i}"),
                name=f"orchestrator-worker-{i}"
            )
            self._worker_tasks.append(worker_task)
        
        # 启动监控任务
        monitor_task = asyncio.create_task(
            self._monitor_loop(),
            name="orchestrator-monitor"
        )
        self._worker_tasks.append(monitor_task)
        
        self.logger.info(f"Service orchestrator started with {self.max_workers} workers")
    
    async def stop(self):
        """停止服务编排器"""
        if self.status == ServiceStatus.STOPPED:
            return
        
        self.logger.info("Stopping service orchestrator...")
        self.status = ServiceStatus.STOPPING
        
        # 设置关闭事件
        self._shutdown_event.set()
        
        # 等待所有工作任务完成
        if self._worker_tasks:
            await asyncio.gather(*self._worker_tasks, return_exceptions=True)
        
        # 关闭线程池
        self.executor.shutdown(wait=True)
        
        self.status = ServiceStatus.STOPPED
        self.logger.info("Service orchestrator stopped")
    
    def register_service(self, service_name: str, service_instance: Any, handler: Callable):
        """注册服务
        
        Args:
            service_name: 服务名称
            service_instance: 服务实例
            handler: 服务处理函数
        """
        self.services[service_name] = service_instance
        self.service_handlers[service_name] = handler
        self.logger.info(f"Service registered: {service_name}")
    
    def unregister_service(self, service_name: str):
        """注销服务
        
        Args:
            service_name: 服务名称
        """
        if service_name in self.services:
            del self.services[service_name]
            del self.service_handlers[service_name]
            self.logger.info(f"Service unregistered: {service_name}")
    
    async def submit_task(self, task: ServiceTask) -> str:
        """提交任务
        
        Args:
            task: 服务任务
            
        Returns:
            任务ID
        """
        if self.status != ServiceStatus.RUNNING:
            raise RuntimeError(f"Cannot submit task when orchestrator is {self.status.value}")
        
        await self.task_queue.put(task)
        self.metrics["total_tasks"] += 1
        
        self.logger.debug(f"Task submitted: {task.task_id} (type: {task.task_type})")
        return task.task_id
    
    async def get_task_status(self, task_id: str) -> Optional[ServiceTask]:
        """获取任务状态
        
        Args:
            task_id: 任务ID
            
        Returns:
            任务对象或None
        """
        # 检查活跃任务
        if task_id in self.active_tasks:
            return self.active_tasks[task_id]
        
        # 检查已完成任务
        if task_id in self.completed_tasks:
            return self.completed_tasks[task_id]
        
        # 检查失败任务
        if task_id in self.failed_tasks:
            return self.failed_tasks[task_id]
        
        return None
    
    async def cancel_task(self, task_id: str) -> bool:
        """取消任务
        
        Args:
            task_id: 任务ID
            
        Returns:
            是否成功取消
        """
        if task_id in self.active_tasks:
            task = self.active_tasks[task_id]
            task.status = "cancelled"
            task.completed_at = datetime.now()
            
            # 移动到失败任务列表
            self.failed_tasks[task_id] = self.active_tasks.pop(task_id)
            self.metrics["active_tasks"] -= 1
            self.metrics["failed_tasks"] += 1
            
            self.logger.info(f"Task cancelled: {task_id}")
            return True
        
        return False
    
    async def _worker_loop(self, worker_name: str):
        """工作线程循环
        
        Args:
            worker_name: 工作线程名称
        """
        self.logger.debug(f"Worker started: {worker_name}")
        
        while not self._shutdown_event.is_set():
            try:
                # 等待任务，设置超时避免阻塞
                task = await asyncio.wait_for(
                    self.task_queue.get(),
                    timeout=1.0
                )
                
                # 处理任务
                await self._process_task(task, worker_name)
                
            except asyncio.TimeoutError:
                # 超时是正常的，继续循环
                continue
            except Exception as e:
                self.logger.error(f"Error in worker {worker_name}: {str(e)}")
                await asyncio.sleep(1.0)
        
        self.logger.debug(f"Worker stopped: {worker_name}")
    
    async def _process_task(self, task: ServiceTask, worker_name: str):
        """处理任务
        
        Args:
            task: 服务任务
            worker_name: 工作线程名称
        """
        task.started_at = datetime.now()
        task.status = "running"
        
        # 添加到活跃任务
        self.active_tasks[task.task_id] = task
        self.metrics["active_tasks"] += 1
        
        self.logger.debug(f"Processing task {task.task_id} on {worker_name}")
        
        try:
            # 查找处理器
            handler = self.service_handlers.get(task.task_type)
            if not handler:
                raise ValueError(f"No handler found for task type: {task.task_type}")
            
            # 执行任务（带超时）
            result = await asyncio.wait_for(
                self._execute_task(handler, task),
                timeout=task.timeout
            )
            
            # 任务成功完成
            task.result = result
            task.status = "completed"
            task.completed_at = datetime.now()
            
            # 移动到已完成任务
            self.completed_tasks[task.task_id] = self.active_tasks.pop(task.task_id)
            self.metrics["active_tasks"] -= 1
            self.metrics["completed_tasks"] += 1
            
            # 更新平均处理时间
            processing_time = (task.completed_at - task.started_at).total_seconds()
            self._update_average_processing_time(processing_time)
            
            self.logger.debug(f"Task completed: {task.task_id} in {processing_time:.2f}s")
            
        except asyncio.TimeoutError:
            # 任务超时
            task.error = f"Task timeout after {task.timeout}s"
            task.status = "timeout"
            await self._handle_task_failure(task)
            
        except Exception as e:
            # 任务执行失败
            task.error = str(e)
            task.status = "error"
            await self._handle_task_failure(task)
    
    async def _execute_task(self, handler: Callable, task: ServiceTask) -> Any:
        """执行任务
        
        Args:
            handler: 任务处理器
            task: 服务任务
            
        Returns:
            任务结果
        """
        # 如果处理器是协程函数
        if asyncio.iscoroutinefunction(handler):
            return await handler(task.payload)
        else:
            # 在线程池中执行同步函数
            loop = asyncio.get_event_loop()
            return await loop.run_in_executor(
                self.executor,
                handler,
                task.payload
            )
    
    async def _handle_task_failure(self, task: ServiceTask):
        """处理任务失败
        
        Args:
            task: 失败的任务
        """
        task.completed_at = datetime.now()
        task.retry_count += 1
        
        # 检查是否需要重试
        if task.retry_count <= task.max_retries and task.status != "timeout":
            # 重新提交任务
            task.status = "retrying"
            await asyncio.sleep(min(2 ** task.retry_count, 10))  # 指数退避
            await self.task_queue.put(task)
            
            self.logger.warning(
                f"Retrying task {task.task_id} (attempt {task.retry_count}/{task.max_retries})"
            )
        else:
            # 移动到失败任务
            self.failed_tasks[task.task_id] = self.active_tasks.pop(task.task_id)
            self.metrics["active_tasks"] -= 1
            self.metrics["failed_tasks"] += 1
            
            self.logger.error(
                f"Task failed permanently: {task.task_id}, error: {task.error}"
            )
    
    async def _monitor_loop(self):
        """监控循环"""
        self.logger.debug("Monitor started")
        
        while not self._shutdown_event.is_set():
            try:
                # 更新吞吐量指标
                self._update_throughput()
                
                # 清理旧的已完成任务（保留最近1000个）
                await self._cleanup_completed_tasks()
                
                # 等待下一次监控
                await asyncio.sleep(60.0)  # 每分钟监控一次
                
            except Exception as e:
                self.logger.error(f"Error in monitor loop: {str(e)}")
                await asyncio.sleep(10.0)
        
        self.logger.debug("Monitor stopped")
    
    def _update_average_processing_time(self, processing_time: float):
        """更新平均处理时间
        
        Args:
            processing_time: 处理时间（秒）
        """
        current_avg = self.metrics["average_processing_time"]
        completed_count = self.metrics["completed_tasks"]
        
        if completed_count == 1:
            self.metrics["average_processing_time"] = processing_time
        else:
            # 计算移动平均
            self.metrics["average_processing_time"] = (
                (current_avg * (completed_count - 1) + processing_time) / completed_count
            )
    
    def _update_throughput(self):
        """更新吞吐量指标"""
        uptime = time.time() - self.start_time
        if uptime > 0:
            self.metrics["throughput"] = self.metrics["completed_tasks"] / uptime
    
    async def _cleanup_completed_tasks(self, max_keep: int = 1000):
        """清理已完成的任务
        
        Args:
            max_keep: 最大保留数量
        """
        if len(self.completed_tasks) > max_keep:
            # 按完成时间排序，保留最新的
            sorted_tasks = sorted(
                self.completed_tasks.items(),
                key=lambda x: x[1].completed_at or datetime.min,
                reverse=True
            )
            
            # 保留最新的任务
            self.completed_tasks = dict(sorted_tasks[:max_keep])
            
            self.logger.debug(f"Cleaned up old completed tasks, kept {max_keep}")
    
    def get_metrics(self) -> Dict[str, Any]:
        """获取编排器指标
        
        Returns:
            指标字典
        """
        uptime = time.time() - self.start_time
        
        return {
            **self.metrics,
            "uptime": uptime,
            "status": self.status.value,
            "queue_size": self.task_queue.qsize(),
            "services_count": len(self.services),
            "workers_count": self.max_workers
        }
    
    def get_service_info(self) -> ServiceInfo:
        """获取服务信息
        
        Returns:
            服务信息
        """
        return self.service_info


class IntentServiceOrchestrator(ServiceOrchestrator):
    """意图识别服务编排器
    
    专门用于意图识别服务的编排器实现。
    """
    
    def __init__(self, service_info: ServiceInfo, max_workers: int = 10):
        super().__init__(service_info, max_workers)
        
        # 注册默认任务处理器
        self._register_default_handlers()
        
        self.logger.info("IntentServiceOrchestrator initialized")
    
    def _register_default_handlers(self):
        """注册默认任务处理器"""
        # 注册意图识别处理器
        self.service_handlers["intent_recognition"] = self._handle_intent_recognition
        self.service_handlers["entity_extraction"] = self._handle_entity_extraction
        self.service_handlers["rule_matching"] = self._handle_rule_matching
        self.service_handlers["health_check"] = self._handle_health_check
    
    async def _handle_intent_recognition(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """处理意图识别任务
        
        Args:
            payload: 任务载荷
            
        Returns:
            处理结果
        """
        # 模拟意图识别处理
        text = payload.get("text", "")
        
        # 简单的意图分类逻辑
        if any(word in text.lower() for word in ["搜索", "查找", "找"]):
            intent_type = "search"
            confidence = 0.85
        elif any(word in text.lower() for word in ["打开", "关闭", "执行"]):
            intent_type = "function"
            confidence = 0.80
        else:
            intent_type = "general"
            confidence = 0.75
        
        # 模拟处理时间
        await asyncio.sleep(0.1)
        
        return {
            "intent_type": intent_type,
            "confidence": confidence,
            "processing_time": 100.0
        }
    
    async def _handle_entity_extraction(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """处理实体抽取任务
        
        Args:
            payload: 任务载荷
            
        Returns:
            处理结果
        """
        text = payload.get("text", "")
        entities = []
        
        # 简单的实体识别
        locations = ["北京", "上海", "广州", "深圳"]
        for location in locations:
            if location in text:
                entities.append({
                    "text": location,
                    "label": "LOCATION",
                    "start": text.find(location),
                    "end": text.find(location) + len(location),
                    "confidence": 0.9
                })
        
        await asyncio.sleep(0.05)
        
        return {
            "entities": entities,
            "extraction_method": "hybrid",
            "confidence": 0.8
        }
    
    async def _handle_rule_matching(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """处理规则匹配任务
        
        Args:
            payload: 任务载荷
            
        Returns:
            处理结果
        """
        text = payload.get("text", "").lower()
        matched_rules = []
        
        # 定义规则
        rules = {
            "weather_rule": ["天气", "气温", "下雨"],
            "time_rule": ["时间", "几点", "现在"],
            "greeting_rule": ["你好", "hello", "hi"]
        }
        
        for rule_name, keywords in rules.items():
            if any(keyword in text for keyword in keywords):
                matched_rules.append(rule_name)
        
        await asyncio.sleep(0.03)
        
        return {
            "matched_rules": matched_rules,
            "match_type": "keyword",
            "confidence": 0.7
        }
    
    async def _handle_health_check(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """处理健康检查任务
        
        Args:
            payload: 任务载荷
            
        Returns:
            处理结果
        """
        # 检查各组件状态
        components = {
            "database": "ok",
            "llm_service": "ok",
            "cache": "ok"
        }
        
        status = "healthy" if all(s == "ok" for s in components.values()) else "degraded"
        
        return {
            "status": status,
            "components": components,
            "uptime": time.time() - self.start_time
        }