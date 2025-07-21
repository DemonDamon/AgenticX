"""
AgenticX M8.5: 协作模式实现

实现8种核心协作模式的具体逻辑。
"""

import time
from typing import List, Dict, Any, Optional
from datetime import datetime

from ..core.agent import Agent
from ..core.agent_executor import AgentExecutor
from .base import (
    BaseCollaborationPattern, CollaborationResult, CollaborationState,
    SubTask, TaskResult, Feedback, Argument, DebateRound, FinalDecision,
    Message, ChatContext, DiscussionSummary
)
from .config import (
    CollaborationConfig, MasterSlaveConfig, ReflectionConfig,
    DebateConfig, GroupChatConfig, ParallelConfig, NestedConfig,
    DynamicConfig, AsyncConfig
)
from .enums import CollaborationStatus, MessageType, AgentRole


class MasterSlavePattern(BaseCollaborationPattern):
    """主从层次协作模式"""
    
    def __init__(self, master_agent: Agent, slave_agents: List[Agent], **kwargs):
        """
        初始化主从模式
        
        Args:
            master_agent: 主控智能体
            slave_agents: 从属智能体列表
            **kwargs: 额外参数
        """
        agents = [master_agent] + slave_agents
        config = kwargs.get('config', MasterSlaveConfig(
            mode=kwargs.get('mode', 'master_slave'),
            master_agent_id=master_agent.id,
            slave_agent_ids=[agent.id for agent in slave_agents]
        ))
        super().__init__(agents, config)
        self.master_agent = master_agent
        self.slave_agents = slave_agents
        self.master_executor = AgentExecutor(master_agent)
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行主从协作任务
        
        Args:
            task: 任务描述
            **kwargs: 额外参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        self.update_state(status=CollaborationStatus.RUNNING)
        
        try:
            # 1. 制定计划和任务分解
            subtasks = self._plan_and_delegate(task)
            
            # 2. 协调执行过程
            results = self._coordinate_execution(subtasks)
            
            # 3. 聚合执行结果
            final_result = self._aggregate_results(results)
            
            execution_time = time.time() - start_time
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=True,
                result=final_result,
                execution_time=execution_time,
                iteration_count=self.state.current_iteration,
                agent_contributions=self._get_agent_contributions(results)
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            self.update_state(status=CollaborationStatus.FAILED)
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=False,
                error=str(e),
                execution_time=execution_time,
                iteration_count=self.state.current_iteration
            )
    
    def _plan_and_delegate(self, task: str) -> List[SubTask]:
        """制定计划和任务分解"""
        # 主控智能体制定计划
        planning_prompt = f"""
        作为主控智能体，请分析以下任务并制定详细的执行计划：
        
        任务：{task}
        
        请将任务分解为多个子任务，并为每个子任务分配合适的从属智能体。
        考虑任务的依赖关系、优先级和智能体的专长。
        
        输出格式：
        1. 子任务1描述 - 分配给智能体A - 优先级1
        2. 子任务2描述 - 分配给智能体B - 优先级2
        ...
        """
        
        planning_result = self.master_executor.execute(planning_prompt)
        
        # 解析计划并创建子任务
        subtasks = []
        lines = planning_result.split('\n')
        
        for line in lines:
            if line.strip() and any(char.isdigit() for char in line):
                # 简单解析，实际应用中可以使用更复杂的解析逻辑
                parts = line.split(' - ')
                if len(parts) >= 3:
                    description = parts[0].strip()
                    agent_name = parts[1].strip()
                    priority = int(parts[2].strip().split()[-1])
                    
                    # 找到对应的从属智能体
                    assigned_agent = None
                    for agent in self.slave_agents:
                        if agent.name in agent_name or agent.role in agent_name:
                            assigned_agent = agent
                            break
                    
                    if assigned_agent:
                        subtask = SubTask(
                            description=description,
                            agent_id=assigned_agent.id,
                            priority=priority
                        )
                        subtasks.append(subtask)
        
        return subtasks
    
    def _coordinate_execution(self, subtasks: List[SubTask]) -> List[TaskResult]:
        """协调执行过程"""
        results = []
        
        # 按优先级排序
        subtasks.sort(key=lambda x: x.priority)
        
        for subtask in subtasks:
            agent = self.get_agent_by_id(subtask.agent_id)
            if not agent:
                continue
            
            # 创建执行器
            executor = AgentExecutor(agent)
            
            # 执行子任务
            execution_prompt = f"""
            请执行以下子任务：
            
            任务描述：{subtask.description}
            优先级：{subtask.priority}
            
            请提供详细、准确的执行结果。
            """
            
            start_time = time.time()
            try:
                result = executor.execute(execution_prompt)
                execution_time = time.time() - start_time
                
                task_result = TaskResult(
                    task_id=subtask.id,
                    agent_id=agent.id,
                    success=True,
                    result=result,
                    execution_time=execution_time
                )
                results.append(task_result)
                
                # 更新状态
                self.state.agent_states[agent.id]["status"] = "completed"
                self.state.agent_states[agent.id]["last_activity"] = datetime.now()
                
            except Exception as e:
                execution_time = time.time() - start_time
                task_result = TaskResult(
                    task_id=subtask.id,
                    agent_id=agent.id,
                    success=False,
                    error=str(e),
                    execution_time=execution_time
                )
                results.append(task_result)
                
                # 更新状态
                self.state.agent_states[agent.id]["status"] = "failed"
        
        return results
    
    def _aggregate_results(self, results: List[TaskResult]) -> str:
        """聚合执行结果"""
        # 主控智能体聚合结果
        aggregation_prompt = f"""
        作为主控智能体，请聚合以下子任务的执行结果：
        
        {chr(10).join([f"子任务{i+1}（{result.agent_id}）：{result.result if result.success else f'失败：{result.error}'}" for i, result in enumerate(results)])}
        
        请提供一个综合的、结构化的最终结果。
        """
        
        final_result = self.master_executor.execute(aggregation_prompt)
        return final_result
    
    def _get_agent_contributions(self, results: List[TaskResult]) -> Dict[str, Any]:
        """获取智能体贡献"""
        contributions = {}
        
        for result in results:
            agent_id = result.agent_id
            if agent_id not in contributions:
                contributions[agent_id] = {
                    "tasks_completed": 0,
                    "tasks_failed": 0,
                    "total_execution_time": 0,
                    "success_rate": 0
                }
            
            if result.success:
                contributions[agent_id]["tasks_completed"] += 1
            else:
                contributions[agent_id]["tasks_failed"] += 1
            
            contributions[agent_id]["total_execution_time"] += result.execution_time
        
        # 计算成功率
        for agent_id, stats in contributions.items():
            total_tasks = stats["tasks_completed"] + stats["tasks_failed"]
            if total_tasks > 0:
                stats["success_rate"] = stats["tasks_completed"] / total_tasks
        
        return contributions


class ReflectionPattern(BaseCollaborationPattern):
    """反思协作模式"""
    
    def __init__(self, executor_agent: Agent, reviewer_agent: Agent, **kwargs):
        """
        初始化反思模式
        
        Args:
            executor_agent: 执行智能体
            reviewer_agent: 审查智能体
            **kwargs: 额外参数
        """
        agents = [executor_agent, reviewer_agent]
        config = kwargs.get('config', ReflectionConfig(
            mode=kwargs.get('mode', 'reflection'),
            executor_agent_id=executor_agent.id,
            reviewer_agent_id=reviewer_agent.id
        ))
        super().__init__(agents, config)
        self.executor_agent = executor_agent
        self.reviewer_agent = reviewer_agent
        self.executor = AgentExecutor(executor_agent)
        self.reviewer = AgentExecutor(reviewer_agent)
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行反思协作任务
        
        Args:
            task: 任务描述
            **kwargs: 额外参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        self.update_state(status=CollaborationStatus.RUNNING)
        
        try:
            current_result = None
            iteration = 0
            max_iterations = self.config.max_iterations
            
            while iteration < max_iterations:
                iteration += 1
                self.state.current_iteration = iteration
                
                # 1. 执行初始解决方案
                if iteration == 1:
                    current_result = self._execute_initial_solution(task)
                else:
                    # 基于反馈改进解决方案
                    current_result = self._improve_solution(current_result, feedback)
                
                # 2. 反思和反馈
                feedback = self._review_and_feedback(current_result)
                
                # 3. 判断是否收敛
                if self._converge_or_continue(current_result, iteration):
                    break
            
            execution_time = time.time() - start_time
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=True,
                result=current_result.result if current_result else None,
                execution_time=execution_time,
                iteration_count=iteration,
                agent_contributions=self._get_agent_contributions(current_result, feedback)
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            self.update_state(status=CollaborationStatus.FAILED)
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=False,
                error=str(e),
                execution_time=execution_time,
                iteration_count=self.state.current_iteration
            )
    
    def _execute_initial_solution(self, task: str) -> TaskResult:
        """执行初始解决方案"""
        execution_prompt = f"""
        请执行以下任务：
        
        任务：{task}
        
        请提供详细、准确的解决方案。确保解决方案完整、准确且实用。
        """
        
        start_time = time.time()
        try:
            result = self.executor.execute(execution_prompt)
            execution_time = time.time() - start_time
            
            return TaskResult(
                task_id=f"task_{self.collaboration_id}",
                agent_id=self.executor_agent.id,
                success=True,
                result=result,
                execution_time=execution_time
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            return TaskResult(
                task_id=f"task_{self.collaboration_id}",
                agent_id=self.executor_agent.id,
                success=False,
                error=str(e),
                execution_time=execution_time
            )
    
    def _review_and_feedback(self, result: TaskResult) -> Feedback:
        """反思和反馈"""
        review_prompt = f"""
        作为审查智能体，请对以下解决方案进行评估：
        
        解决方案：
        {result.result if result.success else f"执行失败：{result.error}"}
        
        请从以下方面进行评估：
        1. 准确性：解决方案是否正确？
        2. 完整性：是否涵盖了所有要求？
        3. 实用性：是否具有实际应用价值？
        4. 创新性：是否有创新点？
        
        请提供：
        - 评分（0-10分）
        - 详细评论
        - 具体改进建议
        - 置信度（0-1）
        """
        
        try:
            review_result = self.reviewer.execute(review_prompt)
            
            # 简单解析反馈（实际应用中可以使用更复杂的解析）
            lines = review_result.split('\n')
            score = 7.0  # 默认分数
            comments = ""
            suggestions = []
            confidence = 0.8
            
            for line in lines:
                if "评分" in line or "分数" in line:
                    try:
                        score = float([s for s in line.split() if s.replace('.', '').isdigit()][0])
                    except:
                        pass
                elif "建议" in line or "改进" in line:
                    suggestions.append(line.strip())
                elif "置信度" in line:
                    try:
                        confidence = float([s for s in line.split() if s.replace('.', '').isdigit()][0])
                    except:
                        pass
                else:
                    comments += line + "\n"
            
            return Feedback(
                reviewer_id=self.reviewer_agent.id,
                target_result=result.task_id,
                score=score,
                comments=comments.strip(),
                suggestions=suggestions,
                confidence=confidence
            )
            
        except Exception as e:
            return Feedback(
                reviewer_id=self.reviewer_agent.id,
                target_result=result.task_id,
                score=5.0,
                comments=f"审查过程中发生错误：{str(e)}",
                suggestions=["请重新执行任务"],
                confidence=0.5
            )
    
    def _improve_solution(self, result: TaskResult, feedback: Feedback) -> TaskResult:
        """改进解决方案"""
        improvement_prompt = f"""
        基于以下反馈，请改进您的解决方案：
        
        原始解决方案：
        {result.result if result.success else f"执行失败：{result.error}"}
        
        审查反馈：
        - 评分：{feedback.score}/10
        - 评论：{feedback.comments}
        - 建议：{chr(10).join(feedback.suggestions)}
        - 置信度：{feedback.confidence}
        
        请根据反馈改进解决方案，确保：
        1. 解决审查中提到的所有问题
        2. 保持原有方案的优点
        3. 提供更详细、更准确的解决方案
        """
        
        start_time = time.time()
        try:
            improved_result = self.executor.execute(improvement_prompt)
            execution_time = time.time() - start_time
            
            return TaskResult(
                task_id=result.task_id,
                agent_id=self.executor_agent.id,
                success=True,
                result=improved_result,
                execution_time=execution_time
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            return TaskResult(
                task_id=result.task_id,
                agent_id=self.executor_agent.id,
                success=False,
                error=str(e),
                execution_time=execution_time
            )
    
    def _converge_or_continue(self, result: TaskResult, iteration: int) -> bool:
        """判断是否收敛"""
        # 简单的收敛判断逻辑
        if iteration >= self.config.max_iterations:
            return True
        
        # 如果评分很高，可以提前收敛
        if hasattr(self, '_last_feedback') and self._last_feedback.score >= 8.0:
            return True
        
        return False
    
    def _get_agent_contributions(self, result: TaskResult, feedback: Feedback) -> Dict[str, Any]:
        """获取智能体贡献"""
        contributions = {
            self.executor_agent.id: {
                "role": "executor",
                "tasks_completed": 1 if result.success else 0,
                "tasks_failed": 0 if result.success else 1,
                "execution_time": result.execution_time,
                "iterations": self.state.current_iteration
            },
            self.reviewer_agent.id: {
                "role": "reviewer",
                "reviews_completed": 1,
                "average_score": feedback.score,
                "confidence": feedback.confidence,
                "suggestions_count": len(feedback.suggestions)
            }
        }
        
        return contributions 