"""反馈收集器实现"""

import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime
import logging

from agenticx.core.component import Component
from agenticx.core.event_bus import EventBus
from agenticx.core.event import listens_to
from agenticx.memory import BaseMemory as Memory

from .models import HumanFeedback, TrajectoryData
from .events import (
    HumanFeedbackReceivedEvent, 
    LearningDataGeneratedEvent,
    InterventionStatusChangedEvent
)

logger = logging.getLogger(__name__)


class FeedbackCollector(Component):
    """反馈收集器
    
    监听人工反馈事件，将原始反馈转化为可供学习的轨迹数据，
    并存储到内存系统中供学习引擎使用。
    """
    
    def __init__(self, event_bus: EventBus, memory: Memory, config: Optional[Dict[str, Any]] = None):
        super().__init__()
        self.event_bus = event_bus
        self.memory = memory
        self.config = config or {}
        
        # 配置参数
        self.quality_threshold = self.config.get("quality_threshold", 0.7)
        self.batch_size = self.config.get("batch_size", 10)
        self.storage_namespace = self.config.get("storage_namespace", "human_feedback")
        
        # 内部状态
        self.feedback_buffer: List[HumanFeedback] = []
        self.processing_queue = asyncio.Queue()
        self.stats = {
            "total_feedback": 0,
            "processed_feedback": 0,
            "high_quality_feedback": 0,
            "trajectories_generated": 0
        }
        
        # 注册事件监听器
        self.event_bus.subscribe("human_feedback_received", self.on_feedback_received, async_handler=True)
        
        # 处理任务（延迟启动）
        self._processing_task = None
        
        logger.info("FeedbackCollector initialized")
    
    @listens_to("human_feedback_received")
    async def on_feedback_received(self, event: HumanFeedbackReceivedEvent) -> None:
        """处理接收到的人工反馈事件
        
        Args:
            event: 人工反馈事件
        """
        feedback = event.feedback
        processing_time = event.processing_time
        expert_confidence = event.expert_confidence
        
        logger.info(f"Received feedback: {feedback.feedback_id} (type: {feedback.feedback_type})")
        
        # 更新统计
        self.stats["total_feedback"] += 1
        
        # 评估反馈质量
        quality_score = self._evaluate_feedback_quality(feedback, expert_confidence, processing_time)
        
        # 添加到处理队列
        await self.processing_queue.put({
            "feedback": feedback,
            "quality_score": quality_score,
            "processing_time": processing_time,
            "expert_confidence": expert_confidence
        })
    
    async def _process_feedback_queue(self):
        """处理反馈队列"""
        while True:
            try:
                # 获取反馈数据
                feedback_data = await self.processing_queue.get()
                
                # 处理反馈
                await self._process_single_feedback(feedback_data)
                
                # 标记任务完成
                self.processing_queue.task_done()
                
            except asyncio.CancelledError:
                logger.info("Feedback processing task cancelled")
                break
            except Exception as e:
                logger.error(f"Error processing feedback: {e}")
                await asyncio.sleep(1)  # 避免快速重试
    
    async def _process_single_feedback(self, feedback_data: Dict[str, Any]):
        """处理单个反馈
        
        Args:
            feedback_data: 反馈数据字典
        """
        feedback = feedback_data["feedback"]
        quality_score = feedback_data["quality_score"]
        
        try:
            # 转换为轨迹数据
            trajectory = await self._package_feedback_as_trajectory(feedback, quality_score)
            
            if trajectory:
                # 存储到内存系统
                await self._store_trajectory(trajectory)
                
                # 发布学习数据生成事件
                learning_event = LearningDataGeneratedEvent.create(
                    trajectory_id=trajectory.trajectory_id,
                    feedback_id=feedback.feedback_id,
                    agent_id=trajectory.agent_id,
                    data_quality_score=quality_score
                )
                await self.event_bus.publish_async(learning_event)
                
                # 更新统计
                self.stats["trajectories_generated"] += 1
                if quality_score >= self.quality_threshold:
                    self.stats["high_quality_feedback"] += 1
                
                logger.info(f"Trajectory generated: {trajectory.trajectory_id} (quality: {quality_score:.2f})")
            
            self.stats["processed_feedback"] += 1
            
        except Exception as e:
            logger.error(f"Error processing feedback {feedback.feedback_id}: {e}")
    
    async def _package_feedback_as_trajectory(self, feedback: HumanFeedback, quality_score: float) -> Optional[TrajectoryData]:
        """将人工反馈转换为轨迹数据
        
        Args:
            feedback: 人工反馈
            quality_score: 质量分数
            
        Returns:
            Optional[TrajectoryData]: 轨迹数据，转换失败返回None
        """
        try:
            # 根据反馈类型处理
            if feedback.feedback_type == "validation":
                return await self._process_validation_feedback(feedback, quality_score)
            elif feedback.feedback_type == "correction":
                return await self._process_correction_feedback(feedback, quality_score)
            elif feedback.feedback_type == "demonstration":
                return await self._process_demonstration_feedback(feedback, quality_score)
            else:
                logger.warning(f"Unknown feedback type: {feedback.feedback_type}")
                return None
                
        except Exception as e:
            logger.error(f"Error packaging feedback as trajectory: {e}")
            return None
    
    async def _process_validation_feedback(self, feedback: HumanFeedback, quality_score: float) -> Optional[TrajectoryData]:
        """处理验证类型反馈
        
        Args:
            feedback: 验证反馈
            quality_score: 质量分数
            
        Returns:
            Optional[TrajectoryData]: 轨迹数据
        """
        if feedback.approved is None:
            logger.warning(f"Validation feedback missing approval status: {feedback.feedback_id}")
            return None
        
        # 构造轨迹数据
        reward = 1.0 if feedback.approved else -1.0
        reward *= quality_score  # 根据质量调整奖励
        
        # 从反馈中提取状态信息（这里需要根据实际的上下文结构调整）
        state_before = {"context": "validation_requested", "confidence": 0.5}
        action_taken = {"type": "request_validation", "approved": feedback.approved}
        state_after = {"context": "validation_completed", "approved": feedback.approved}
        
        trajectory = TrajectoryData(
            feedback_id=feedback.feedback_id,
            agent_id="unknown",  # 需要从上下文中获取
            state_before=state_before,
            action_taken=action_taken,
            state_after=state_after,
            reward=reward
        )
        
        return trajectory
    
    async def _process_correction_feedback(self, feedback: HumanFeedback, quality_score: float) -> Optional[TrajectoryData]:
        """处理修正类型反馈
        
        Args:
            feedback: 修正反馈
            quality_score: 质量分数
            
        Returns:
            Optional[TrajectoryData]: 轨迹数据
        """
        if not feedback.corrected_actions:
            logger.warning(f"Correction feedback missing corrected actions: {feedback.feedback_id}")
            return None
        
        # 修正反馈通常有较高的学习价值
        reward = 2.0 * quality_score
        
        # 构造轨迹数据
        state_before = {"context": "correction_requested", "original_actions": "unknown"}
        action_taken = {
            "type": "apply_correction",
            "corrected_actions": [action.dict() for action in feedback.corrected_actions]
        }
        state_after = {"context": "correction_applied", "success": True}
        
        trajectory = TrajectoryData(
            feedback_id=feedback.feedback_id,
            agent_id="unknown",  # 需要从上下文中获取
            state_before=state_before,
            action_taken=action_taken,
            state_after=state_after,
            reward=reward
        )
        
        return trajectory
    
    async def _process_demonstration_feedback(self, feedback: HumanFeedback, quality_score: float) -> Optional[TrajectoryData]:
        """处理演示类型反馈
        
        Args:
            feedback: 演示反馈
            quality_score: 质量分数
            
        Returns:
            Optional[TrajectoryData]: 轨迹数据
        """
        if not feedback.demonstration_steps:
            logger.warning(f"Demonstration feedback missing steps: {feedback.feedback_id}")
            return None
        
        # 演示反馈具有最高的学习价值
        reward = 3.0 * quality_score
        
        # 构造轨迹数据
        state_before = {"context": "demonstration_requested", "task": "unknown"}
        action_taken = {
            "type": "follow_demonstration",
            "steps": feedback.demonstration_steps
        }
        state_after = {"context": "demonstration_completed", "learned": True}
        
        trajectory = TrajectoryData(
            feedback_id=feedback.feedback_id,
            agent_id="unknown",  # 需要从上下文中获取
            state_before=state_before,
            action_taken=action_taken,
            state_after=state_after,
            reward=reward
        )
        
        return trajectory
    
    async def _store_trajectory(self, trajectory: TrajectoryData):
        """存储轨迹数据到内存系统
        
        Args:
            trajectory: 轨迹数据
        """
        try:
            # 构造存储键
            key = f"{self.storage_namespace}:trajectory:{trajectory.trajectory_id}"
            
            # 存储数据
            await self.memory.add(
                content=str(trajectory.dict()),
                metadata={
                    "type": "trajectory",
                    "feedback_id": trajectory.feedback_id,
                    "agent_id": trajectory.agent_id,
                    "reward": trajectory.reward,
                    "created_at": trajectory.created_at.isoformat()
                },
                record_id=key
            )
            
            logger.debug(f"Trajectory stored: {key}")
            
        except Exception as e:
            logger.error(f"Error storing trajectory {trajectory.trajectory_id}: {e}")
            raise
    
    def _evaluate_feedback_quality(self, feedback: HumanFeedback, expert_confidence: float, processing_time: float) -> float:
        """评估反馈质量
        
        Args:
            feedback: 反馈数据
            expert_confidence: 专家置信度
            processing_time: 处理时间
            
        Returns:
            float: 质量分数 (0-1)
        """
        # 基础质量分数基于专家置信度
        quality_score = expert_confidence
        
        # 根据反馈类型调整
        type_weights = {
            "validation": 0.8,
            "correction": 1.0,
            "demonstration": 1.2
        }
        quality_score *= type_weights.get(feedback.feedback_type, 1.0)
        
        # 根据处理时间调整（适中的处理时间通常意味着更好的质量）
        if 30 <= processing_time <= 300:  # 30秒到5分钟
            time_factor = 1.0
        elif processing_time < 30:  # 太快可能不够仔细
            time_factor = 0.8
        else:  # 太慢可能有问题
            time_factor = 0.9
        
        quality_score *= time_factor
        
        # 根据反馈完整性调整
        completeness_factor = self._calculate_completeness_factor(feedback)
        quality_score *= completeness_factor
        
        # 确保在0-1范围内
        return min(1.0, max(0.0, quality_score))
    
    def _calculate_completeness_factor(self, feedback: HumanFeedback) -> float:
        """计算反馈完整性因子
        
        Args:
            feedback: 反馈数据
            
        Returns:
            float: 完整性因子
        """
        factor = 1.0
        
        # 检查必要字段
        if feedback.feedback_type == "validation" and feedback.approved is None:
            factor *= 0.5
        elif feedback.feedback_type == "correction" and not feedback.corrected_actions:
            factor *= 0.5
        elif feedback.feedback_type == "demonstration" and not feedback.demonstration_steps:
            factor *= 0.5
        
        # 有备注说明加分
        if feedback.notes and len(feedback.notes.strip()) > 10:
            factor *= 1.1
        
        return factor
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息
        
        Returns:
            Dict[str, Any]: 统计数据
        """
        stats = self.stats.copy()
        stats["queue_size"] = self.processing_queue.qsize()
        stats["buffer_size"] = len(self.feedback_buffer)
        return stats
    
    async def flush_buffer(self):
        """刷新缓冲区"""
        if self.feedback_buffer:
            logger.info(f"Flushing {len(self.feedback_buffer)} feedback items")
            # 这里可以实现批量处理逻辑
            self.feedback_buffer.clear()
    
    def start(self):
        """启动收集器"""
        if self._processing_task is None:
            self._processing_task = asyncio.create_task(self._process_feedback_queue())
            logger.info("FeedbackCollector started")
    
    async def shutdown(self):
        """关闭收集器"""
        # 取消处理任务
        if self._processing_task and not self._processing_task.done():
            self._processing_task.cancel()
            try:
                await self._processing_task
            except asyncio.CancelledError:
                pass
        
        # 等待队列处理完成
        await self.processing_queue.join()
        
        # 刷新缓冲区
        await self.flush_buffer()
        
        logger.info("FeedbackCollector shutdown completed")