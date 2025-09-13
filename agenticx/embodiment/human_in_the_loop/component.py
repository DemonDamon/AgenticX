"""人机协作组件实现"""

import asyncio
from typing import Dict, Any, Optional, Literal
from datetime import datetime, timedelta, UTC
import logging

from agenticx.core.component import Component
from agenticx.core.event_bus import EventBus
from agenticx.embodiment.core.context import GUIAgentContext

from .models import HumanInterventionRequest, InterventionMetrics
from .events import HumanInterventionRequestedEvent, InterventionStatusChangedEvent

logger = logging.getLogger(__name__)


class HumanInTheLoopComponent(Component):
    """人机协作组件
    
    负责在需要时暂停智能体执行，向外部请求人工输入。
    提供干预请求管理、状态跟踪和超时处理功能。
    """
    
    def __init__(self, event_bus: EventBus, config: Optional[Dict[str, Any]] = None):
        super().__init__()
        self.event_bus = event_bus
        self.config = config or {}
        
        # 配置参数
        self.default_timeout = self.config.get("default_timeout", 300)  # 5分钟
        self.max_retries = self.config.get("max_retries", 3)
        self.priority_weights = self.config.get("priority_weights", {
            "low": 1.0,
            "medium": 2.0,
            "high": 3.0
        })
        
        # 内部状态
        self.pending_requests: Dict[str, HumanInterventionRequest] = {}
        self.request_futures: Dict[str, asyncio.Future] = {}
        self.request_retry_counts: Dict[str, int] = {}  # 用于存储请求的重试次数
        self.metrics = InterventionMetrics(
            total_requests=0,
            pending_requests=0,
            completed_requests=0,
            average_response_time=0.0,
            success_rate=0.0
        )
        
        logger.info("HumanInTheLoopComponent initialized")
    
    async def request_intervention(
        self,
        context: GUIAgentContext,
        intervention_type: Literal["validation", "correction", "demonstration"],
        description: str,
        confidence_score: float,
        screenshot_data: Optional[str] = None,
        priority: Literal["low", "medium", "high"] = "medium",
        timeout: Optional[float] = None
    ) -> HumanInterventionRequest:
        """请求人工干预
        
        Args:
            context: 智能体当前上下文
            intervention_type: 干预类型
            description: 问题描述
            confidence_score: 置信度分数
            screenshot_data: 屏幕截图数据
            priority: 优先级
            timeout: 超时时间(秒)
            
        Returns:
            HumanInterventionRequest: 干预请求对象
        """
        # 创建干预请求
        request = HumanInterventionRequest(
            agent_id=context.agent_id,
            task_id=getattr(context, 'task_id', None),
            intervention_type=intervention_type,
            context=context.dict(),
            screenshot=screenshot_data,
            description=description,
            confidence_score=confidence_score,
            priority=priority,
            status="pending"
        )
        
        # 存储请求
        self.pending_requests[request.request_id] = request
        
        # 创建Future用于等待响应
        future = asyncio.Future()
        self.request_futures[request.request_id] = future
        
        # 发布干预请求事件
        event = HumanInterventionRequestedEvent.create(
            request=request,
            context=context.dict(),
            screenshot_data=screenshot_data,
            urgency_level=self._calculate_urgency(confidence_score, priority),
            agent_id=context.agent_id,
            task_id=getattr(context, 'task_id', None)
        )
        
        await self.event_bus.publish_async(event)
        
        # 更新指标
        self.metrics.total_requests += 1
        self.metrics.pending_requests += 1
        
        logger.info(f"Intervention requested: {request.request_id} (type: {intervention_type}, priority: {priority})")
        
        # 设置超时处理
        timeout_seconds = timeout or self.default_timeout
        asyncio.create_task(self._handle_timeout(request.request_id, timeout_seconds))
        
        return request
    
    async def wait_for_response(self, request_id: str) -> Optional[Dict[str, Any]]:
        """等待人工响应
        
        Args:
            request_id: 请求ID
            
        Returns:
            Optional[Dict[str, Any]]: 响应数据，超时返回None
        """
        if request_id not in self.request_futures:
            logger.warning(f"No future found for request: {request_id}")
            return None
        
        try:
            response = await self.request_futures[request_id]
            return response
        except asyncio.TimeoutError:
            logger.warning(f"Request timeout: {request_id}")
            await self._handle_request_timeout(request_id)
            return None
        except Exception as e:
            logger.error(f"Error waiting for response {request_id}: {e}")
            return None
    
    async def handle_feedback_received(self, feedback_data: Dict[str, Any]):
        """处理接收到的人工反馈
        
        Args:
            feedback_data: 反馈数据
        """
        request_id = feedback_data.get("request_id")
        if not request_id:
            logger.error("Feedback missing request_id")
            return
        
        if request_id not in self.pending_requests:
            logger.warning(f"Received feedback for unknown request: {request_id}")
            return
        
        # 更新请求状态
        request = self.pending_requests[request_id]
        old_status = request.status
        request.status = "completed"
        request.updated_at = datetime.now()
        
        # 发布状态变更事件
        status_event = InterventionStatusChangedEvent.create(
            request_id=request_id,
            old_status=old_status,
            new_status="completed",
            changed_by="human_expert",
            reason="feedback_received",
            agent_id=request.agent_id,
            task_id=request.task_id
        )
        await self.event_bus.publish_async(status_event)
        
        # 完成Future
        if request_id in self.request_futures:
            future = self.request_futures[request_id]
            if not future.done():
                future.set_result(feedback_data)
        
        # 清理
        self._cleanup_request(request_id)
        
        # 更新指标
        self.metrics.pending_requests = max(0, self.metrics.pending_requests - 1)
        self.metrics.completed_requests += 1
        
        logger.info(f"Feedback processed for request: {request_id}")
    
    async def cancel_request(self, request_id: str, reason: str = "cancelled"):
        """取消干预请求
        
        Args:
            request_id: 请求ID
            reason: 取消原因
        """
        if request_id not in self.pending_requests:
            logger.warning(f"Cannot cancel unknown request: {request_id}")
            return
        
        request = self.pending_requests[request_id]
        old_status = request.status
        request.status = "cancelled"
        request.updated_at = datetime.now()
        
        # 发布状态变更事件
        status_event = InterventionStatusChangedEvent.create(
            request_id=request_id,
            old_status=old_status,
            new_status="cancelled",
            changed_by="system",
            reason=reason,
            agent_id=request.agent_id,
            task_id=request.task_id
        )
        await self.event_bus.publish_async(status_event)
        
        # 取消Future
        if request_id in self.request_futures:
            future = self.request_futures[request_id]
            if not future.done():
                future.cancel()
        
        # 清理
        self._cleanup_request(request_id)
        
        # 更新指标
        self.metrics.pending_requests = max(0, self.metrics.pending_requests - 1)
        
        logger.info(f"Request cancelled: {request_id} (reason: {reason})")
    
    def get_metrics(self) -> InterventionMetrics:
        """获取干预指标
        
        Returns:
            InterventionMetrics: 当前指标数据
        """
        self.metrics.updated_at = datetime.now()
        return self.metrics
    
    def get_pending_requests(self) -> Dict[str, HumanInterventionRequest]:
        """获取待处理请求
        
        Returns:
            Dict[str, HumanInterventionRequest]: 待处理请求字典
        """
        return self.pending_requests.copy()
    
    def _calculate_urgency(self, confidence_score: float, priority: str) -> str:
        """计算紧急程度
        
        Args:
            confidence_score: 置信度分数
            priority: 优先级
            
        Returns:
            str: 紧急程度
        """
        urgency_score = (1 - confidence_score) * self.priority_weights.get(priority, 1.0)
        
        if urgency_score >= 2.5:
            return "critical"
        elif urgency_score >= 1.5:
            return "high"
        elif urgency_score >= 0.5:
            return "normal"
        else:
            return "low"
    
    async def _handle_timeout(self, request_id: str, timeout_seconds: float):
        """处理请求超时
        
        Args:
            request_id: 请求ID
            timeout_seconds: 超时时间
        """
        await asyncio.sleep(timeout_seconds)
        
        if request_id in self.pending_requests:
            await self._handle_request_timeout(request_id)
    
    async def _handle_request_timeout(self, request_id: str):
        """处理请求超时逻辑
        
        Args:
            request_id: 请求ID
        """
        if request_id not in self.pending_requests:
            return
        
        request = self.pending_requests[request_id]
        
        # 检查是否可以重试
        retry_count = self.request_retry_counts.get(request_id, 0)
        if retry_count < self.max_retries:
            # 重试
            self.request_retry_counts[request_id] = retry_count + 1
            logger.info(f"Retrying request {request_id} (attempt {retry_count + 1})")
            
            # 重新发布事件
            event = HumanInterventionRequestedEvent.create(
                request=request,
                context=request.context,
                screenshot_data=request.screenshot,
                urgency_level="high",  # 重试时提高紧急程度
                agent_id=request.agent_id,
                task_id=request.task_id
            )
            await self.event_bus.publish_async(event)
        else:
            # 超时取消
            await self.cancel_request(request_id, "timeout")
    
    def _cleanup_request(self, request_id: str):
        """清理请求相关资源
        
        Args:
            request_id: 请求ID
        """
        self.pending_requests.pop(request_id, None)
        self.request_futures.pop(request_id, None)
        self.request_retry_counts.pop(request_id, None)  # 清理重试计数
    
    async def shutdown(self):
        """关闭组件"""
        # 取消所有待处理请求
        for request_id in list(self.pending_requests.keys()):
            await self.cancel_request(request_id, "shutdown")
        
        logger.info("HumanInTheLoopComponent shutdown completed")