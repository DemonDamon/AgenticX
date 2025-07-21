"""
AgenticX M8.5: 协作模式实现

实现8种核心协作模式的具体逻辑。
"""

import time
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime

from ..core.agent import Agent
from ..core.agent_executor import AgentExecutor
from ..core.task import Task
from .base import (
    BaseCollaborationPattern, CollaborationResult, CollaborationState,
    SubTask, TaskResult, Feedback, Argument, DebateRound, FinalDecision,
    Message, ChatContext, DiscussionSummary, AgentRequirement, AsyncEvent,
    SharedState, Conflict, Resolution, DependencyGraph
)
from .config import (
    CollaborationConfig, MasterSlaveConfig, ReflectionConfig,
    DebateConfig, GroupChatConfig, ParallelConfig, NestedConfig,
    DynamicConfig, AsyncConfig
)
from .enums import CollaborationStatus, MessageType, AgentRole, CollaborationMode
from agenticx.observability.logging import get_logger

# 设置日志
logger = get_logger(__name__)

# 工具函数：递归提取字符串
def extract_str(val):
    if isinstance(val, str):
        return val
    elif isinstance(val, dict):
        # 尝试递归提取 'result' 字段
        if 'result' in val:
            return extract_str(val['result'])
        else:
            return str(val)
    else:
        return str(val)


class MasterSlavePattern(BaseCollaborationPattern):
    """主从层次协作模式"""
    
    def __init__(self, master_agent: Agent, slave_agents: List[Agent], llm_provider=None, **kwargs):
        """
        初始化主从模式
        
        Args:
            master_agent: 主控智能体
            slave_agents: 从属智能体列表
            llm_provider: LLM提供者
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
        self.master_executor = AgentExecutor(llm_provider=llm_provider)
        self.llm_provider = llm_provider
        logger.info(f"[初始化] MasterSlavePattern, master: {master_agent.name}, slaves: {[a.name for a in slave_agents]}")
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行主从协作任务
        
        Args:
            task: 任务描述
            **kwargs: 额外参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        logger.info(f"[执行] MasterSlavePattern, 任务: {task}")
        start_time = time.time()
        self.update_state(status=CollaborationStatus.RUNNING)
        
        try:
            # 1. 制定计划和任务分解
            logger.info(f"[计划分解] 开始调用主控智能体进行任务分解: {task}")
            subtasks = self._plan_and_delegate(task)
            logger.info(f"[计划分解] 子任务分解结果: {subtasks}")
            
            # 2. 协调执行过程
            logger.info(f"[协调执行] 开始执行所有子任务")
            results = self._coordinate_execution(subtasks, task)
            logger.info(f"[协调执行] 子任务执行结果: {results}")
            
            # 3. 聚合执行结果
            logger.info(f"[聚合结果] 开始聚合所有子任务结果")
            final_result = self._aggregate_results(results)
            logger.info(f"[聚合结果] 聚合后最终结果: {final_result}")
            
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
            logger.error(f"[异常] MasterSlavePattern 执行失败: {e}")
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=False,
                error=str(e),
                execution_time=execution_time,
                iteration_count=self.state.current_iteration
            )
    
    def _plan_and_delegate(self, task: str) -> List[SubTask]:
        """制定计划和任务分解"""
        logger.info(f"[计划分解] 任务分解 prompt 构建完成，准备调用 LLM")
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

        # 创建任务对象
        planning_task = Task(
            id=f"planning_task_{self.collaboration_id}",
            description=planning_prompt,
            input_data={"task": task},
            expected_output="任务分解计划"
        )
        
        planning_result = self.master_executor.run(self.master_agent, planning_task)
        logger.info(f"[计划分解] LLM 返回: {planning_result}")
        
        # 解析计划并创建子任务
        subtasks = []
        result_text = extract_str(planning_result)
        lines = result_text.split('\n')
        logger.info(f"[计划分解] 解析后行数: {len(lines)}")
        
        for line in lines:
            if line.strip() and any(char.isdigit() for char in line):
                logger.debug(f"[计划分解] 解析子任务行: {line}")
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
        
        logger.info(f"[计划分解] 最终子任务列表: {subtasks}")
        return subtasks
    
    def _coordinate_execution(self, subtasks: List[SubTask], task: str) -> List[TaskResult]:
        """协调执行过程"""
        logger.info(f"[协调执行] 子任务数量: {len(subtasks)}")
        results = []
        
        # 按优先级排序
        subtasks.sort(key=lambda x: x.priority)
        
        for subtask in subtasks:
            agent = self.get_agent_by_id(subtask.agent_id)
            if not agent:
                logger.warning(f"[协调执行] 未找到 agent: {subtask.agent_id}")
                continue
            
            # 创建执行器
            executor = AgentExecutor(llm_provider=self.llm_provider)
            
            # 执行子任务
            execution_prompt = f"""
            请执行以下子任务：
            
            任务描述：{subtask.description}
            优先级：{subtask.priority}
            
            请提供详细、准确的执行结果。
            """
            
            # 创建任务对象
            execution_task = Task(
                id=f"execution_task_{self.collaboration_id}",
                description=execution_prompt,
                input_data={"task": task},
                expected_output="初始解决方案"
            )
            
            start_time = time.time()
            try:
                result = executor.run(agent, execution_task)
                execution_time = time.time() - start_time
                
                # 提取结果
                result_text = extract_str(result)
                
                task_result = TaskResult(
                    task_id=subtask.id,
                    agent_id=agent.id,
                    success=True,
                    result=result_text,
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
        
        logger.info(f"[协调执行] 所有子任务执行完毕，总数: {len(results)}")
        return results
    
    def _aggregate_results(self, results: List[TaskResult]) -> str:
        """聚合执行结果"""
        logger.info(f"[聚合结果] 开始聚合 {len(results)} 个子任务结果")
        # 主控智能体聚合结果
        aggregation_prompt = f"""
        作为主控智能体，请聚合以下子任务的执行结果：
        
        {chr(10).join([f"子任务{i+1}（{result.agent_id}）：{result.result if result.success else f'失败：{result.error}'}" for i, result in enumerate(results)])}
        
        请提供一个综合的、结构化的最终结果。
        """
        
        # 创建任务对象
        aggregation_task = Task(
            id=f"aggregation_task_{self.collaboration_id}",
            description=aggregation_prompt,
            input_data={"results": [r.model_dump() for r in results]},
            expected_output="聚合后的最终结果"
        )
        
        final_result = self.master_executor.run(self.master_agent, aggregation_task)
        logger.info(f"[聚合结果] LLM 返回: {final_result}")
        
        # 提取结果
        return extract_str(final_result)
    
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
    
    def __init__(self, executor_agent: Agent, reviewer_agent: Agent, llm_provider=None, **kwargs):
        """
        初始化反思模式
        
        Args:
            executor_agent: 执行智能体
            reviewer_agent: 审查智能体
            llm_provider: LLM提供者
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
        self.executor = AgentExecutor(llm_provider=llm_provider)
        self.reviewer = AgentExecutor(llm_provider=llm_provider)
        self.llm_provider = llm_provider
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行反思协作任务
        
        Args:
            task: 任务描述
            **kwargs: 额外参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        logger.info(f"[执行] ReflectionPattern, 任务: {task}")
        start_time = time.time()
        self.update_state(status=CollaborationStatus.RUNNING)
        
        try:
            current_result = None
            feedback = None
            iteration = 0
            max_iterations = getattr(self.config, 'max_iterations', 5)
            
            while iteration < max_iterations:
                iteration += 1
                self.state.current_iteration = iteration
                logger.info(f"[反思] 第{iteration}轮，开始执行解决方案")
                # 1. 执行初始解决方案
                if iteration == 1:
                    current_result = self._execute_initial_solution(task)
                else:
                    logger.info(f"[反思] 基于反馈改进解决方案: {feedback}")
                    current_result = self._improve_solution(current_result, feedback)
                logger.info(f"[反思] 当前解决方案: {current_result}")
                # 2. 反思和反馈
                feedback = self._review_and_feedback(current_result)
                logger.info(f"[反思] 审查反馈: {feedback}")
                # 3. 判断是否收敛
                if self._converge_or_continue(current_result, iteration):
                    logger.info(f"[反思] 满足收敛条件，提前结束")
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
            logger.error(f"[异常] ReflectionPattern 执行失败: {e}")
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=False,
                error=str(e),
                execution_time=execution_time,
                iteration_count=self.state.current_iteration
            )
    
    def _execute_initial_solution(self, task: str) -> TaskResult:
        """执行初始解决方案"""
        logger.info(f"[反思] 执行初始解决方案, 任务: {task}")
        execution_prompt = f"""
        请执行以下任务：
        
        任务：{task}
        
        请提供详细、准确的解决方案。确保解决方案完整、准确且实用。
        """
        
        # 创建任务对象
        execution_task = Task(
            id=f"execution_task_{self.collaboration_id}",
            description=execution_prompt,
            input_data={"task": task},
            expected_output="初始解决方案"
        )
        
        start_time = time.time()
        try:
            result = self.executor.run(self.executor_agent, execution_task)
            execution_time = time.time() - start_time
            logger.info(f"[反思] LLM 返回: {result}")
            # 提取结果
            result_text = extract_str(result)
            
            return TaskResult(
                task_id=f"task_{self.collaboration_id}",
                agent_id=self.executor_agent.id,
                success=True,
                result=result_text,
                execution_time=execution_time
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(f"[反思] 执行初始解决方案异常: {e}")
            return TaskResult(
                task_id=f"task_{self.collaboration_id}",
                agent_id=self.executor_agent.id,
                success=False,
                error=str(e),
                execution_time=execution_time
            )
    
    def _review_and_feedback(self, result: TaskResult) -> Feedback:
        """反思和反馈"""
        logger.info(f"[反思] 开始审查解决方案: {result}")
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
        
        # 创建任务对象
        review_task = Task(
            id=f"review_task_{self.collaboration_id}",
            description=review_prompt,
            input_data={"solution": result.result if result.success else result.error},
            expected_output="审查反馈"
        )
        
        try:
            review_result = self.reviewer.run(self.reviewer_agent, review_task)
            logger.info(f"[反思] 审查 LLM 返回: {review_result}")
            # 提取结果
            review_text = extract_str(review_result)
            
            # 简单解析反馈（实际应用中可以使用更复杂的解析）
            lines = review_text.split('\n')
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
            
            feedback = Feedback(
                reviewer_id=self.reviewer_agent.id,
                target_result=result.task_id,
                score=score,
                comments=comments.strip(),
                suggestions=suggestions,
                confidence=confidence
            )
            
            # 保存最后一次反馈
            self._last_feedback = feedback
            logger.info(f"[反思] 解析后反馈: {feedback}")
            
            return feedback
            
        except Exception as e:
            logger.error(f"[反思] 审查反馈异常: {e}")
            feedback = Feedback(
                reviewer_id=self.reviewer_agent.id,
                target_result=result.task_id,
                score=5.0,
                comments=f"审查过程中发生错误：{str(e)}",
                suggestions=["请重新执行任务"],
                confidence=0.5
            )
            
            # 保存最后一次反馈
            self._last_feedback = feedback
            
            return feedback
    
    def _improve_solution(self, result: TaskResult, feedback: Feedback) -> TaskResult:
        """改进解决方案"""
        logger.info(f"[反思] 开始改进解决方案, 上一结果: {result}, 反馈: {feedback}")
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
        
        # 创建任务对象
        improvement_task = Task(
            id=f"improvement_task_{self.collaboration_id}",
            description=improvement_prompt,
            input_data={
                "original_solution": result.result if result.success else result.error,
                "feedback": feedback.model_dump()
            },
            expected_output="改进后的解决方案"
        )
        
        start_time = time.time()
        try:
            improved_result = self.executor.run(self.executor_agent, improvement_task)
            execution_time = time.time() - start_time
            logger.info(f"[反思] LLM 返回: {improved_result}")
            # 提取结果
            result_text = extract_str(improved_result)
            
            return TaskResult(
                task_id=result.task_id,
                agent_id=self.executor_agent.id,
                success=True,
                result=result_text,
                execution_time=execution_time
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            logger.error(f"[反思] 改进解决方案异常: {e}")
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
        max_iterations = getattr(self.config, 'max_iterations', 5)
        if iteration >= max_iterations:
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


class DebatePattern(BaseCollaborationPattern):
    """
    AgenticX M8.5: 辩论协作模式
    
    辩论模式允许多个智能体从不同角度分析问题，通过结构化辩论流程，
    最终由聚合者综合各方观点并做出决策。
    
    适用场景：
    - 复杂决策场景
    - 多角度分析问题
    - 避免单点偏差
    - 增强决策鲁棒性
    """
    
    def __init__(self, debaters: List[Agent], aggregator: Agent, **kwargs):
        """
        初始化辩论协作模式
        
        Args:
            debaters: 辩论者智能体列表
            aggregator: 聚合者智能体
            **kwargs: 其他参数
        """
        self.debaters = debaters
        self.aggregator = aggregator
        self.debate_rounds = []
        self.final_decision = None
        
        # 合并所有智能体
        all_agents = debaters + [aggregator]
        super().__init__(all_agents, **kwargs)
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行辩论协作任务
        
        Args:
            task: 辩论任务
            **kwargs: 其他参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        
        try:
            # 1. 生成辩论论点
            arguments = self._generate_arguments(task)
            
            # 2. 进行辩论
            debate_rounds = self._conduct_debate(arguments)
            
            # 3. 聚合决策
            final_decision = self._aggregate_decisions(debate_rounds)
            
            # 4. 生成最终结果
            result = CollaborationResult(
                success=True,
                result=final_decision.decision,
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id,
                metadata={
                    "debate_rounds": len(debate_rounds),
                    "debaters_count": len(self.debaters),
                    "final_confidence": final_decision.confidence,
                    "decision_reasoning": final_decision.reasoning
                }
            )
            
            self.final_decision = final_decision
            return result
            
        except Exception as e:
            return CollaborationResult(
                success=False,
                error=str(e),
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id
            )
    
    def _generate_arguments(self, task: str) -> List[Argument]:
        """
        生成辩论论点
        
        Args:
            task: 辩论任务
            
        Returns:
            List[Argument]: 论点列表
        """
        arguments = []
        
        for i, debater in enumerate(self.debaters):
            try:
                # 模拟辩论者生成论点
                argument_text = f"辩论者{debater.name}的观点：{task}的分析角度{i+1}"
                reasoning = f"基于{debater.role}的专业知识，从{debater.goal}的角度分析"
                
                argument = Argument(
                    debater_id=debater.id,
                    argument_text=argument_text,
                    reasoning=reasoning,
                    confidence=0.8 - i * 0.1,  # 模拟不同置信度
                    timestamp=time.time(),
                    topic=task,
                    position=f"角度{i+1}"
                )
                arguments.append(argument)
                
            except Exception as e:
                logger.error(f"辩论者{debater.name}生成论点失败: {e}")
                continue
        
        return arguments
    
    def _conduct_debate(self, arguments: List[Argument]) -> List[DebateRound]:
        """
        进行辩论
        
        Args:
            arguments: 初始论点列表
            
        Returns:
            List[DebateRound]: 辩论轮次列表
        """
        debate_rounds = []
        current_arguments = arguments.copy()
        
        max_rounds = getattr(self.config, 'max_rounds', 3)
        
        for round_num in range(max_rounds):
            round_arguments = []
            
            for debater in self.debaters:
                try:
                    # 模拟辩论者对其他论点的回应
                    responses = []
                    for arg in current_arguments:
                        if arg.debater_id != debater.id:
                            # 通过debater_id查找智能体名称
                            other_debater = next((d for d in self.debaters if d.id == arg.debater_id), None)
                            other_name = other_debater.name if other_debater else f"辩论者{arg.debater_id}"
                            response = f"{debater.name}对{other_name}观点的回应：基于不同视角的分析"
                            responses.append(response)
                    
                    # 生成新的论点
                    new_argument = Argument(
                        debater_id=debater.id,
                        argument_text=f"第{round_num+1}轮辩论中{debater.name}的论点",
                        reasoning=f"基于前{round_num+1}轮辩论的综合分析",
                        confidence=0.7 + round_num * 0.05,
                        timestamp=time.time(),
                        responses=responses,
                        topic=arguments[0].topic if arguments else "辩论话题",
                        position=f"第{round_num+1}轮观点"
                    )
                    round_arguments.append(new_argument)
                    
                except Exception as e:
                    logger.error(f"辩论者{debater.name}第{round_num+1}轮辩论失败: {e}")
                    continue
            
            if round_arguments:
                debate_round = DebateRound(
                    round_number=round_num + 1,
                    arguments=round_arguments,
                    timestamp=time.time()
                )
                debate_rounds.append(debate_round)
                current_arguments = round_arguments
            
            # 检查是否达到共识
            if self._check_consensus(current_arguments):
                break
        
        self.debate_rounds = debate_rounds
        return debate_rounds
    
    def _check_consensus(self, arguments: List[Argument]) -> bool:
        """
        检查是否达到共识
        
        Args:
            arguments: 当前论点列表
            
        Returns:
            bool: 是否达到共识
        """
        if len(arguments) < 2:
            return False
        
        # 简单的共识检查：如果所有论点置信度差异小于阈值
        confidences = [arg.confidence for arg in arguments]
        max_conf = max(confidences)
        min_conf = min(confidences)
        
        consensus_threshold = getattr(self.config, 'consensus_threshold', 0.2)
        return (max_conf - min_conf) < consensus_threshold
    
    def _aggregate_decisions(self, debate_rounds: List[DebateRound]) -> FinalDecision:
        """
        聚合决策
        
        Args:
            debate_rounds: 辩论轮次列表
            
        Returns:
            FinalDecision: 最终决策
        """
        try:
            # 收集所有论点
            all_arguments = []
            for round_data in debate_rounds:
                all_arguments.extend(round_data.arguments)
            
            # 检查是否有论点
            if not all_arguments:
                return FinalDecision(
                    decision="没有有效的辩论论点",
                    reasoning="辩论过程中没有生成有效论点",
                    confidence=0.0,
                    aggregator_id=self.aggregator.id,
                    aggregator_name=self.aggregator.name,
                    debate_rounds=len(debate_rounds),
                    total_arguments=0,
                    timestamp=time.time()
                )
            
            # 使用聚合者智能体进行决策
            decision_text = f"基于{len(debate_rounds)}轮辩论，{len(all_arguments)}个论点的综合分析"
            reasoning = f"聚合者{self.aggregator.name}综合各方观点后的决策理由"
            
            # 计算综合置信度
            avg_confidence = sum(arg.confidence for arg in all_arguments) / len(all_arguments)
            
            # 加权投票
            weighted_decision = self._weighted_voting(all_arguments)
            
            final_decision = FinalDecision(
                decision=weighted_decision,
                reasoning=reasoning,
                confidence=avg_confidence,
                aggregator_id=self.aggregator.id,
                aggregator_name=self.aggregator.name,
                debate_rounds=len(debate_rounds),
                total_arguments=len(all_arguments),
                timestamp=time.time()
            )
            
            return final_decision
            
        except Exception as e:
            logger.error(f"聚合决策失败: {e}")
            return FinalDecision(
                decision="决策聚合失败",
                reasoning=f"聚合过程中发生错误: {e}",
                confidence=0.0,
                aggregator_id=self.aggregator.id,
                aggregator_name=self.aggregator.name,
                debate_rounds=len(debate_rounds),
                total_arguments=0,
                timestamp=time.time()
            )
    
    def _weighted_voting(self, arguments: List[Argument]) -> str:
        """
        加权投票机制
        
        Args:
            arguments: 论点列表
            
        Returns:
            str: 投票结果
        """
        try:
            # 按辩论者分组
            debater_votes = {}
            for arg in arguments:
                debater_id = arg.debater_id
                if debater_id not in debater_votes:
                    # 通过debater_id查找智能体名称
                    debater = next((d for d in self.debaters if d.id == debater_id), None)
                    debater_name = debater.name if debater else f"辩论者{debater_id}"
                    debater_votes[debater_id] = {
                        'total_confidence': 0,
                        'argument_count': 0,
                        'name': debater_name
                    }
                
                debater_votes[debater_id]['total_confidence'] += arg.confidence
                debater_votes[debater_id]['argument_count'] += 1
            
            # 计算每个辩论者的平均置信度
            for debater_id, votes in debater_votes.items():
                votes['avg_confidence'] = votes['total_confidence'] / votes['argument_count']
            
            # 选择平均置信度最高的辩论者观点
            best_debater = max(debater_votes.items(), key=lambda x: x[1]['avg_confidence'])
            
            return f"基于加权投票，{best_debater[1]['name']}的观点获得最高支持"
            
        except Exception as e:
            logger.error(f"加权投票失败: {e}")
            return "投票机制执行失败"
    
    def get_collaboration_state(self) -> CollaborationState:
        """获取协作状态"""
        return CollaborationState(
            collaboration_id=self.collaboration_id,
            mode=CollaborationMode.DEBATE,
            status=CollaborationStatus.COMPLETED if self.final_decision else CollaborationStatus.IN_PROGRESS,
            current_iteration=len(self.debate_rounds),
            total_iterations=getattr(self.config, 'max_rounds', 3),
            participants=[agent.id for agent in self.agents],
            metadata={
                "debaters_count": len(self.debaters),
                "aggregator_id": self.aggregator.id,
                "final_decision": self.final_decision.decision if self.final_decision else None,
                "debate_rounds": len(self.debate_rounds)
            }
        ) 


class GroupChatPattern(BaseCollaborationPattern):
    """
    AgenticX M8.5: 群聊协作模式
    
    群聊模式允许多个智能体自由交流，通过动态路由和话题控制，
    实现集体智慧的汇聚和开放式讨论。
    
    适用场景：
    - 模拟人类协作
    - 开放式讨论
    - 创意生成
    - 集体智慧汇聚
    """
    
    def __init__(self, participants: List[Agent], **kwargs):
        """
        初始化群聊协作模式
        
        Args:
            participants: 参与者智能体列表
            **kwargs: 其他参数
        """
        self.participants = participants
        self.messages = []
        self.chat_context = ChatContext(
            topic="",
            participants=[agent.id for agent in participants],
            message_count=0,
            start_time=time.time()
        )
        
        super().__init__(participants, **kwargs)
    
    def execute(self, topic: str, **kwargs) -> CollaborationResult:
        """
        执行群聊协作任务
        
        Args:
            topic: 讨论话题
            **kwargs: 其他参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        
        try:
            # 1. 设置聊天上下文
            self.chat_context.topic = topic
            self.chat_context.start_time = time.time()
            
            # 2. 确定发言顺序
            speaking_order = self._determine_speaking_order()
            
            # 3. 开始群聊讨论
            discussion_messages = self._conduct_group_chat(speaking_order, topic)
            
            # 4. 总结讨论
            summary = self._summarize_discussion(discussion_messages)
            
            # 5. 生成最终结果
            result = CollaborationResult(
                success=True,
                result=summary.summary,
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id,
                metadata={
                    "message_count": len(discussion_messages),
                    "participants_count": len(self.participants),
                    "topic": topic,
                    "key_points": summary.key_points,
                    "consensus": summary.consensus
                }
            )
            
            return result
            
        except Exception as e:
            return CollaborationResult(
                success=False,
                error=str(e),
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id
            )
    
    def _determine_speaking_order(self) -> List[str]:
        """
        确定发言顺序
        
        Returns:
            List[str]: 发言顺序的智能体ID列表
        """
        # 简单的轮询顺序
        return [agent.id for agent in self.participants]
    
    def _conduct_group_chat(self, speaking_order: List[str], topic: str) -> List[Message]:
        """
        进行群聊讨论
        
        Args:
            speaking_order: 发言顺序
            topic: 讨论话题
            
        Returns:
            List[Message]: 消息列表
        """
        messages = []
        max_messages = getattr(self.config, 'max_messages', 50)
        
        # 每个参与者轮流发言
        for round_num in range(max_messages // len(self.participants)):
            for agent_id in speaking_order:
                if len(messages) >= max_messages:
                    break
                
                try:
                    # 找到对应的智能体
                    agent = next((a for a in self.participants if a.id == agent_id), None)
                    if not agent:
                        continue
                    
                    # 生成消息
                    message_content = self._generate_message(agent, topic, round_num, messages)
                    
                    message = Message(
                        sender_id=agent.id,
                        sender_name=agent.name,
                        content=message_content,
                        message_type=MessageType.TEXT,
                        timestamp=time.time(),
                        round_number=round_num + 1
                    )
                    
                    messages.append(message)
                    
                    # 更新聊天上下文
                    self.chat_context.message_count = len(messages)
                    
                except Exception as e:
                    logger.error(f"智能体{agent_id}生成消息失败: {e}")
                    continue
            
            if len(messages) >= max_messages:
                break
        
        self.messages = messages
        return messages
    
    def _generate_message(self, agent: Agent, topic: str, round_num: int, previous_messages: List[Message]) -> str:
        """
        生成消息内容
        
        Args:
            agent: 发言智能体
            topic: 讨论话题
            round_num: 轮次编号
            previous_messages: 之前的消息列表
            
        Returns:
            str: 消息内容
        """
        # 模拟智能体生成消息
        if round_num == 0:
            # 第一轮：自我介绍和初始观点
            return f"大家好，我是{agent.name}，我的专业领域是{agent.role}。关于{topic}，我认为..."
        else:
            # 后续轮次：基于之前讨论的回应
            recent_messages = previous_messages[-3:] if len(previous_messages) >= 3 else previous_messages
            context = "，".join([msg.content[:50] + "..." for msg in recent_messages])
            
            return f"基于之前的讨论{context}，我{agent.name}想补充一点..."
    
    def _route_message(self, message: Message, context: ChatContext) -> List[str]:
        """
        消息路由
        
        Args:
            message: 消息
            context: 聊天上下文
            
        Returns:
            List[str]: 接收者ID列表
        """
        # 简单的广播路由：所有参与者都接收消息
        return [agent.id for agent in self.participants if agent.id != message.sender_id]
    
    def _handle_async_messages(self) -> List[Message]:
        """
        处理异步消息
        
        Returns:
            List[Message]: 异步消息列表
        """
        # 当前实现中，所有消息都是同步的
        # 未来可以扩展为支持异步消息处理
        return []
    
    def _summarize_discussion(self, messages: List[Message]) -> DiscussionSummary:
        """
        总结讨论
        
        Args:
            messages: 消息列表
            
        Returns:
            DiscussionSummary: 讨论摘要
        """
        try:
            # 提取关键信息
            participants = list(set(msg.sender_id for msg in messages))
            total_messages = len(messages)
            
            # 生成摘要
            summary_text = f"关于{self.chat_context.topic}的讨论总结："
            summary_text += f"共有{len(participants)}位参与者，发表了{total_messages}条消息。"
            
            # 提取关键观点
            key_points = []
            for msg in messages[-5:]:  # 取最后5条消息作为关键观点
                key_points.append(f"{msg.sender_name}: {msg.content[:100]}...")
            
            # 生成共识
            consensus = f"参与者们在{self.chat_context.topic}方面达成了基本共识。"
            
            summary = DiscussionSummary(
                summary=summary_text,
                key_points=key_points,
                consensus=consensus,
                participant_count=len(participants),
                message_count=total_messages,
                duration=time.time() - self.chat_context.start_time,
                timestamp=time.time()
            )
            
            return summary
            
        except Exception as e:
            logger.error(f"总结讨论失败: {e}")
            return DiscussionSummary(
                summary=f"讨论总结失败: {e}",
                key_points=[],
                consensus="无法达成共识",
                participant_count=0,
                message_count=len(messages),
                duration=time.time() - self.chat_context.start_time,
                timestamp=time.time()
            )
    
    def get_collaboration_state(self) -> CollaborationState:
        """获取协作状态"""
        return CollaborationState(
            collaboration_id=self.collaboration_id,
            mode=CollaborationMode.GROUP_CHAT,
            status=CollaborationStatus.COMPLETED if self.messages else CollaborationStatus.IN_PROGRESS,
            current_iteration=len(self.messages),
            total_iterations=getattr(self.config, 'max_messages', 50),
            participants=[agent.id for agent in self.agents],
            metadata={
                "participants_count": len(self.participants),
                "topic": self.chat_context.topic,
                "message_count": len(self.messages),
                "duration": time.time() - self.chat_context.start_time if self.chat_context.start_time else 0
            }
        ) 


class ParallelPattern(BaseCollaborationPattern):
    """
    AgenticX M8.5: 并行化协作模式
    
    并行模式允许多个智能体同时处理不同的子任务，通过任务分解和结果聚合，
    实现高效的计算密集型任务处理。
    
    适用场景：
    - 提升处理效率
    - 计算密集型任务
    - 独立子任务处理
    - 负载均衡
    """
    
    def __init__(self, workers: List[Agent], **kwargs):
        """
        初始化并行协作模式
        
        Args:
            workers: 工作智能体列表
            **kwargs: 其他参数
        """
        self.workers = workers
        self.subtasks = []
        self.parallel_results = []
        
        super().__init__(workers, **kwargs)
    
    def execute(self, subtasks: List[str], **kwargs) -> CollaborationResult:
        """
        执行并行协作任务
        
        Args:
            subtasks: 子任务列表
            **kwargs: 其他参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        
        try:
            # 1. 任务分解
            decomposed_subtasks = self._decompose_task(subtasks)
            
            # 2. 分配子任务
            task_distribution = self._distribute_subtasks(decomposed_subtasks)
            
            # 3. 并行执行
            parallel_results = self._execute_parallel(task_distribution)
            
            # 4. 聚合结果
            aggregated_result = self._aggregate_parallel_results(parallel_results)
            
            # 5. 生成最终结果
            result = CollaborationResult(
                success=True,
                result=aggregated_result,
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id,
                metadata={
                    "subtasks_count": len(decomposed_subtasks),
                    "workers_count": len(self.workers),
                    "completed_tasks": len(parallel_results),
                    "parallel_results": [r.result for r in parallel_results if r.success]
                }
            )
            
            return result
            
        except Exception as e:
            return CollaborationResult(
                success=False,
                error=str(e),
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id
            )
    
    def _decompose_task(self, tasks: List[str]) -> List[SubTask]:
        """
        任务分解
        
        Args:
            tasks: 任务列表
            
        Returns:
            List[SubTask]: 分解后的子任务列表
        """
        subtasks = []
        
        for i, task in enumerate(tasks):
            try:
                # 创建子任务
                subtask = SubTask(
                    task_id=f"subtask_{i+1}",
                    description=task,
                    agent_id="",  # 初始为空，稍后分配
                    priority=int(1.0 - i * 0.1),  # 转换为整数
                    estimated_duration=10.0 + i * 2.0,  # 模拟不同执行时间
                    dependencies=[],
                    assigned_worker=None,
                    status="pending",
                    created_at=time.time()
                )
                subtasks.append(subtask)
                
            except Exception as e:
                logger.error(f"任务分解失败: {e}")
                continue
        
        self.subtasks = subtasks
        return subtasks
    
    def _distribute_subtasks(self, subtasks: List[SubTask]) -> Dict[str, SubTask]:
        """
        分配子任务
        
        Args:
            subtasks: 子任务列表
            
        Returns:
            Dict[str, SubTask]: 任务分配映射
        """
        task_distribution = {}
        
        # 简单的轮询分配策略
        for i, subtask in enumerate(subtasks):
            worker_index = i % len(self.workers)
            worker = self.workers[worker_index]
            
            # 分配任务给工作智能体
            subtask.assigned_worker = worker.id
            subtask.status = "assigned"
            
            task_distribution[subtask.task_id] = subtask
        
        return task_distribution
    
    def _execute_parallel(self, task_distribution: Dict[str, SubTask]) -> List[TaskResult]:
        """
        并行执行
        
        Args:
            task_distribution: 任务分配映射
            
        Returns:
            List[TaskResult]: 执行结果列表
        """
        results = []
        
        # 模拟并行执行
        for task_id, subtask in task_distribution.items():
            try:
                # 找到对应的工作智能体
                worker = next((w for w in self.workers if w.id == subtask.assigned_worker), None)
                if not worker:
                    continue
                
                # 模拟任务执行
                execution_result = self._execute_single_task(worker, subtask)
                results.append(execution_result)
                
                # 更新任务状态
                subtask.status = "completed" if execution_result.success else "failed"
                
            except Exception as e:
                logger.error(f"任务{task_id}执行失败: {e}")
                # 创建失败结果
                failed_result = TaskResult(
                    task_id=task_id,
                    worker_id=subtask.assigned_worker,
                    result=f"任务执行失败: {e}",
                    success=False,
                    execution_time=0.0,
                    metadata={"error": str(e)}
                )
                results.append(failed_result)
                subtask.status = "failed"
        
        self.parallel_results = results
        return results
    
    def _execute_single_task(self, worker: Agent, subtask: SubTask) -> TaskResult:
        """
        执行单个任务
        
        Args:
            worker: 工作智能体
            subtask: 子任务
            
        Returns:
            TaskResult: 任务结果
        """
        start_time = time.time()
        
        try:
            # 模拟任务执行
            execution_time = subtask.estimated_duration * 0.1  # 加速执行用于演示
            time.sleep(execution_time)
            
            # 生成任务结果
            result_text = f"工作智能体{worker.name}完成了任务：{subtask.description}"
            
            result = TaskResult(
                task_id=subtask.task_id,
                worker_id=worker.id,
                result=result_text,
                success=True,
                execution_time=time.time() - start_time,
                metadata={
                    "worker_name": worker.name,
                    "task_description": subtask.description,
                    "priority": subtask.priority
                }
            )
            
            return result
            
        except Exception as e:
            return TaskResult(
                task_id=subtask.task_id,
                worker_id=worker.id,
                result=f"任务执行失败: {e}",
                success=False,
                execution_time=time.time() - start_time,
                metadata={"error": str(e)}
            )
    
    def _aggregate_parallel_results(self, results: List[TaskResult]) -> str:
        """
        聚合并行结果
        
        Args:
            results: 结果列表
            
        Returns:
            str: 聚合结果
        """
        try:
            successful_results = [r for r in results if r.success]
            failed_results = [r for r in results if not r.success]
            
            # 生成聚合报告
            aggregation_text = f"并行执行完成：\n"
            aggregation_text += f"- 总任务数：{len(results)}\n"
            aggregation_text += f"- 成功任务数：{len(successful_results)}\n"
            aggregation_text += f"- 失败任务数：{len(failed_results)}\n"
            
            if successful_results:
                aggregation_text += f"- 成功结果：\n"
                for result in successful_results:
                    aggregation_text += f"  * {result.result}\n"
            
            if failed_results:
                aggregation_text += f"- 失败结果：\n"
                for result in failed_results:
                    aggregation_text += f"  * {result.result}\n"
            
            return aggregation_text
            
        except Exception as e:
            logger.error(f"聚合并行结果失败: {e}")
            return f"结果聚合失败: {e}"
    
    def get_collaboration_state(self) -> CollaborationState:
        """获取协作状态"""
        completed_tasks = len([r for r in self.parallel_results if r.success])
        total_tasks = len(self.parallel_results)
        
        return CollaborationState(
            collaboration_id=self.collaboration_id,
            mode=CollaborationMode.PARALLEL,
            status=CollaborationStatus.COMPLETED if total_tasks > 0 else CollaborationStatus.IN_PROGRESS,
            current_iteration=completed_tasks,
            total_iterations=total_tasks,
            participants=[agent.id for agent in self.agents],
            metadata={
                "workers_count": len(self.workers),
                "subtasks_count": len(self.subtasks),
                "completed_tasks": completed_tasks,
                "success_rate": completed_tasks / total_tasks if total_tasks > 0 else 0
            }
        ) 


class NestedPattern(BaseCollaborationPattern):
    """
    AgenticX M8.5: 嵌套协作模式
    
    嵌套模式允许多种协作模式组合使用，通过复杂任务分解和子协作管理，
    实现灵活的复杂任务处理和动态架构。
    
    适用场景：
    - 灵活适应复杂任务
    - 多种模式组合
    - 动态架构
    - 复杂项目管理和执行
    """
    
    def __init__(self, patterns: List[BaseCollaborationPattern], **kwargs):
        """
        初始化嵌套协作模式
        
        Args:
            patterns: 协作模式列表
            **kwargs: 其他参数
        """
        self.patterns = patterns
        self.sub_results = []
        self.nesting_level = 1
        
        # 收集所有智能体
        all_agents = []
        for pattern in patterns:
            all_agents.extend(pattern.agents)
        
        # 获取配置
        config = kwargs.get('config', NestedConfig(
            mode=CollaborationMode.NESTED,
            sub_patterns=[],  # 空的子模式配置，实际使用时需要填充
            enable_workflow_composition=True,
            enable_optimization=True,
            composition_strategy="sequential"
        ))
        
        super().__init__(all_agents, config)
    
    def execute(self, task: str, workflow: str = None, **kwargs) -> CollaborationResult:
        """
        执行嵌套协作任务
        
        Args:
            task: 任务描述
            workflow: 工作流描述
            **kwargs: 其他参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        
        try:
            # 1. 组合工作流
            composed_workflow = self._compose_workflow(workflow)
            
            # 2. 执行嵌套模式
            nested_results = self._execute_nested_patterns(composed_workflow, task)
            
            # 3. 优化组合结构
            optimized_workflow = self._optimize_composition(composed_workflow)
            
            # 4. 聚合所有结果
            final_result = self._aggregate_nested_results(nested_results)
            
            # 5. 生成最终结果
            result = CollaborationResult(
                success=True,
                result=final_result,
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id,
                metadata={
                    "patterns_count": len(self.patterns),
                    "nesting_level": self.nesting_level,
                    "sub_results_count": len(nested_results),
                    "optimized_workflow": str(optimized_workflow)
                }
            )
            
            return result
            
        except Exception as e:
            return CollaborationResult(
                success=False,
                error=str(e),
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id
            )
    
    def _compose_workflow(self, workflow: str = None) -> Dict:
        """
        组合工作流
        
        Args:
            workflow: 工作流描述
            
        Returns:
            Dict: 组合后的工作流
        """
        composed_workflow = {
            "patterns": self.patterns,
            "nesting_level": self.nesting_level,
            "workflow_description": workflow or "默认嵌套工作流",
            "created_at": time.time()
        }
        
        return composed_workflow
    
    def _execute_nested_patterns(self, workflow: Dict, task: str) -> List[CollaborationResult]:
        """
        执行嵌套模式
        
        Args:
            workflow: 工作流
            task: 任务描述
            
        Returns:
            List[CollaborationResult]: 嵌套执行结果列表
        """
        nested_results = []
        
        # 将任务分解为子任务
        subtasks = self._decompose_nested_task(task)
        
        for i, pattern in enumerate(self.patterns):
            try:
                # 为每个模式分配子任务
                subtask = subtasks[i] if i < len(subtasks) else f"子任务{i+1}"
                
                # 执行子模式
                if hasattr(pattern, 'execute'):
                    sub_result = pattern.execute(subtask)
                    nested_results.append(sub_result)
                else:
                    # 如果模式没有execute方法，创建模拟结果
                    mock_result = CollaborationResult(
                        success=True,
                        result=f"模式{pattern.__class__.__name__}的模拟结果",
                        execution_time=0.1,
                        collaboration_id=f"{self.collaboration_id}_sub_{i}",
                        metadata={"pattern_type": pattern.__class__.__name__}
                    )
                    nested_results.append(mock_result)
                
            except Exception as e:
                logger.error(f"嵌套模式{pattern.__class__.__name__}执行失败: {e}")
                # 创建失败结果
                failed_result = CollaborationResult(
                    success=False,
                    error=str(e),
                    execution_time=0.0,
                    collaboration_id=f"{self.collaboration_id}_sub_{i}",
                    metadata={"pattern_type": pattern.__class__.__name__}
                )
                nested_results.append(failed_result)
        
        self.sub_results = nested_results
        return nested_results
    
    def _decompose_nested_task(self, task: str) -> List[str]:
        """
        分解嵌套任务
        
        Args:
            task: 任务描述
            
        Returns:
            List[str]: 子任务列表
        """
        # 简单的任务分解策略
        subtasks = []
        
        for i, pattern in enumerate(self.patterns):
            pattern_type = pattern.__class__.__name__
            
            if "MasterSlave" in pattern_type:
                subtasks.append(f"主从模式子任务：{task}的规划部分")
            elif "Reflection" in pattern_type:
                subtasks.append(f"反思模式子任务：{task}的质量优化")
            elif "Debate" in pattern_type:
                subtasks.append(f"辩论模式子任务：{task}的多角度分析")
            elif "GroupChat" in pattern_type:
                subtasks.append(f"群聊模式子任务：{task}的集体讨论")
            elif "Parallel" in pattern_type:
                subtasks.append(f"并行模式子任务：{task}的并行处理")
            else:
                subtasks.append(f"通用子任务{i+1}：{task}的处理")
        
        return subtasks
    
    def _optimize_composition(self, workflow: Dict) -> Dict:
        """
        优化组合结构
        
        Args:
            workflow: 工作流
            
        Returns:
            Dict: 优化后的工作流
        """
        optimized_workflow = workflow.copy()
        
        # 添加优化信息
        optimized_workflow["optimization"] = {
            "optimized_at": time.time(),
            "patterns_count": len(self.patterns),
            "success_rate": len([r for r in self.sub_results if r.success]) / len(self.sub_results) if self.sub_results else 0,
            "total_execution_time": sum(r.execution_time for r in self.sub_results) if self.sub_results else 0
        }
        
        return optimized_workflow
    
    def _aggregate_nested_results(self, nested_results: List[CollaborationResult]) -> str:
        """
        聚合嵌套结果
        
        Args:
            nested_results: 嵌套结果列表
            
        Returns:
            str: 聚合结果
        """
        try:
            successful_results = [r for r in nested_results if r.success]
            failed_results = [r for r in nested_results if not r.success]
            
            # 生成聚合报告
            aggregation_text = f"嵌套协作完成：\n"
            aggregation_text += f"- 总模式数：{len(self.patterns)}\n"
            aggregation_text += f"- 成功模式数：{len(successful_results)}\n"
            aggregation_text += f"- 失败模式数：{len(failed_results)}\n"
            aggregation_text += f"- 嵌套层级：{self.nesting_level}\n"
            
            if successful_results:
                aggregation_text += f"- 成功结果：\n"
                for i, result in enumerate(successful_results):
                    pattern_name = self.patterns[i].__class__.__name__ if i < len(self.patterns) else "未知模式"
                    aggregation_text += f"  * {pattern_name}: {result.result[:100]}...\n"
            
            if failed_results:
                aggregation_text += f"- 失败结果：\n"
                for i, result in enumerate(failed_results):
                    pattern_name = self.patterns[i].__class__.__name__ if i < len(self.patterns) else "未知模式"
                    aggregation_text += f"  * {pattern_name}: {result.error}\n"
            
            return aggregation_text
            
        except Exception as e:
            logger.error(f"聚合嵌套结果失败: {e}")
            return f"嵌套结果聚合失败: {e}"
    
    def get_collaboration_state(self) -> CollaborationState:
        """获取协作状态"""
        successful_results = len([r for r in self.sub_results if r.success])
        total_results = len(self.sub_results)
        
        return CollaborationState(
            collaboration_id=self.collaboration_id,
            mode=CollaborationMode.NESTED,
            status=CollaborationStatus.COMPLETED if total_results > 0 else CollaborationStatus.IN_PROGRESS,
            current_iteration=successful_results,
            total_iterations=total_results,
            participants=[agent.id for agent in self.agents],
            metadata={
                "patterns_count": len(self.patterns),
                "nesting_level": self.nesting_level,
                "successful_results": successful_results,
                "success_rate": successful_results / total_results if total_results > 0 else 0
            }
        ) 


class DynamicPattern(BaseCollaborationPattern):
    """
    AgenticX M8.5: 动态添加协作模式
    
    动态模式允许运行时动态创建或引入新智能体，通过智能体需求评估和生命周期管理，
    实现运行时扩展能力和按需创建智能体。
    
    适用场景：
    - 运行时扩展能力
    - 按需创建智能体
    - 动态系统
    - 自适应协作
    """
    
    def __init__(self, base_agents: List[Agent], **kwargs):
        """
        初始化动态协作模式
        
        Args:
            base_agents: 基础智能体列表
            **kwargs: 其他参数
        """
        self.base_agents = base_agents
        self.dynamic_agents = []
        self.agent_requirements = []
        self.dependency_graph = None
        self.adjustment_count = 0
        
        super().__init__(base_agents, **kwargs)
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行动态协作任务
        
        Args:
            task: 任务描述
            **kwargs: 其他参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        
        try:
            # 1. 评估智能体需求
            requirements = self._evaluate_agent_needs(task)
            
            # 2. 创建动态智能体
            created_agents = []
            for requirement in requirements:
                dynamic_agent = self._create_dynamic_agent(requirement)
                if dynamic_agent:
                    created_agents.append(dynamic_agent)
            
            # 3. 集成新智能体
            integrated_agents = []
            for agent in created_agents:
                if self._integrate_new_agent(agent):
                    integrated_agents.append(agent)
            
            # 4. 管理依赖关系
            dependency_graph = self._manage_dependencies(self.agents)
            
            # 5. 执行协作任务
            collaboration_result = self._execute_dynamic_collaboration(task)
            
            # 6. 生成最终结果
            result = CollaborationResult(
                success=True,
                result=collaboration_result,
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id,
                metadata={
                    "base_agents_count": len(self.base_agents),
                    "dynamic_agents_count": len(created_agents),
                    "integrated_agents_count": len(integrated_agents),
                    "adjustment_count": self.adjustment_count,
                    "final_agent_count": len(self.agents)
                }
            )
            
            return result
            
        except Exception as e:
            return CollaborationResult(
                success=False,
                error=str(e),
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id
            )
    
    def _evaluate_agent_needs(self, task: str) -> List[AgentRequirement]:
        """
        评估智能体需求
        
        Args:
            task: 任务描述
            
        Returns:
            List[AgentRequirement]: 智能体需求列表
        """
        requirements = []
        
        # 基于任务类型评估需要的智能体
        task_keywords = task.lower().split()
        
        # 简单的需求评估逻辑
        if any(keyword in task_keywords for keyword in ['分析', '研究', '调查']):
            requirements.append(AgentRequirement(
                role="analyst",
                skills=["数据分析", "研究能力"],
                priority=0.8,
                estimated_duration=30.0,
                dependencies=[]
            ))
        
        if any(keyword in task_keywords for keyword in ['设计', '规划', '架构']):
            requirements.append(AgentRequirement(
                role="designer",
                skills=["系统设计", "架构规划"],
                priority=0.9,
                estimated_duration=45.0,
                dependencies=[]
            ))
        
        if any(keyword in task_keywords for keyword in ['测试', '验证', '检查']):
            requirements.append(AgentRequirement(
                role="tester",
                skills=["质量测试", "验证能力"],
                priority=0.7,
                estimated_duration=20.0,
                dependencies=[]
            ))
        
        # 如果没有匹配到特定需求，创建通用智能体
        if not requirements:
            requirements.append(AgentRequirement(
                role="general_worker",
                skills=["通用处理", "任务执行"],
                priority=0.6,
                estimated_duration=25.0,
                dependencies=[]
            ))
        
        self.agent_requirements = requirements
        return requirements
    
    def _create_dynamic_agent(self, requirement: AgentRequirement) -> Agent:
        """
        创建动态智能体
        
        Args:
            requirement: 智能体需求
            
        Returns:
            Agent: 创建的智能体
        """
        try:
            # 生成唯一ID
            agent_id = f"dynamic_agent_{len(self.dynamic_agents) + 1}_{int(time.time())}"
            
            # 创建智能体
            dynamic_agent = Agent(
                id=agent_id,
                name=f"动态{requirement.role.title()}",
                role=requirement.role,
                goal=f"执行{requirement.role}相关任务",
                organization_id="dynamic_org",
                skills=requirement.skills,
                metadata={
                    "created_at": time.time(),
                    "requirement": requirement.dict(),
                    "is_dynamic": True
                }
            )
            
            self.dynamic_agents.append(dynamic_agent)
            return dynamic_agent
            
        except Exception as e:
            logger.error(f"创建动态智能体失败: {e}")
            return None
    
    def _integrate_new_agent(self, agent: Agent) -> bool:
        """
        集成新智能体
        
        Args:
            agent: 新智能体
            
        Returns:
            bool: 集成是否成功
        """
        try:
            # 检查智能体是否已存在
            if agent.id in [a.id for a in self.agents]:
                return False
            
            # 添加到智能体列表
            self.agents.append(agent)
            
            # 更新协作状态
            self.adjustment_count += 1
            
            logger.info(f"成功集成动态智能体: {agent.name} ({agent.id})")
            return True
            
        except Exception as e:
            logger.error(f"集成新智能体失败: {e}")
            return False
    
    def _manage_dependencies(self, agents: List[Agent]) -> DependencyGraph:
        """
        管理依赖关系
        
        Args:
            agents: 智能体列表
            
        Returns:
            DependencyGraph: 依赖关系图
        """
        try:
            # 创建依赖关系图
            dependencies = {}
            
            for agent in agents:
                agent_deps = []
                
                # 基于智能体角色确定依赖关系
                if agent.role == "designer":
                    # 设计者依赖分析者
                    analyst_agents = [a for a in agents if a.role == "analyst"]
                    agent_deps.extend([a.id for a in analyst_agents])
                
                elif agent.role == "tester":
                    # 测试者依赖设计者和分析者
                    designer_agents = [a for a in agents if a.role == "designer"]
                    analyst_agents = [a for a in agents if a.role == "analyst"]
                    agent_deps.extend([a.id for a in designer_agents + analyst_agents])
                
                dependencies[agent.id] = agent_deps
            
            dependency_graph = DependencyGraph(
                agents=[agent.id for agent in agents],
                dependencies=dependencies,
                created_at=time.time()
            )
            
            self.dependency_graph = dependency_graph
            return dependency_graph
            
        except Exception as e:
            logger.error(f"管理依赖关系失败: {e}")
            return DependencyGraph(
                agents=[agent.id for agent in agents],
                dependencies={},
                created_at=time.time()
            )
    
    def _execute_dynamic_collaboration(self, task: str) -> str:
        """
        执行动态协作
        
        Args:
            task: 任务描述
            
        Returns:
            str: 协作结果
        """
        try:
            # 模拟动态协作执行
            collaboration_text = f"动态协作执行完成：\n"
            collaboration_text += f"- 任务：{task}\n"
            collaboration_text += f"- 基础智能体数：{len(self.base_agents)}\n"
            collaboration_text += f"- 动态智能体数：{len(self.dynamic_agents)}\n"
            collaboration_text += f"- 总智能体数：{len(self.agents)}\n"
            collaboration_text += f"- 调整次数：{self.adjustment_count}\n"
            
            # 模拟各智能体的贡献
            for agent in self.agents:
                if agent.metadata.get('is_dynamic', False):
                    collaboration_text += f"- 动态智能体{agent.name}贡献：{agent.role}相关处理\n"
                else:
                    collaboration_text += f"- 基础智能体{agent.name}贡献：{agent.role}相关处理\n"
            
            return collaboration_text
            
        except Exception as e:
            logger.error(f"执行动态协作失败: {e}")
            return f"动态协作执行失败: {e}"
    
    def get_collaboration_state(self) -> CollaborationState:
        """获取协作状态"""
        return CollaborationState(
            collaboration_id=self.collaboration_id,
            mode=CollaborationMode.DYNAMIC,
            status=CollaborationStatus.COMPLETED if self.adjustment_count > 0 else CollaborationStatus.IN_PROGRESS,
            current_iteration=self.adjustment_count,
            total_iterations=len(self.agent_requirements),
            participants=[agent.id for agent in self.agents],
            metadata={
                "base_agents_count": len(self.base_agents),
                "dynamic_agents_count": len(self.dynamic_agents),
                "adjustment_count": self.adjustment_count,
                "final_agent_count": len(self.agents),
                "dependency_graph": self.dependency_graph.dict() if self.dependency_graph else None
            }
        ) 


class AsyncPattern(BaseCollaborationPattern):
    """
    AgenticX M8.5: 异步协作模式
    
    异步模式支持长时间运行和异步处理，通过状态持久化和进度监控，
    实现高实时性、动态环境和分布式协作。
    
    适用场景：
    - 高实时性需求
    - 动态环境
    - 分布式协作
    - 长时间运行任务
    """
    
    def __init__(self, agents: List[Agent], shared_memory: Dict = None, **kwargs):
        """
        初始化异步协作模式
        
        Args:
            agents: 智能体列表
            shared_memory: 共享内存
            **kwargs: 其他参数
        """
        self.async_agents = agents
        self.shared_memory = shared_memory or {}
        self.async_events = []
        self.shared_state = None
        self.execution_status = "pending"
        self.progress = 0.0
        
        super().__init__(agents, **kwargs)
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行异步协作任务
        
        Args:
            task: 任务描述
            **kwargs: 其他参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        start_time = time.time()
        
        try:
            # 1. 设置异步环境
            async_environment = self._setup_async_environment()
            
            # 2. 处理异步事件
            async_events = self._handle_async_events()
            
            # 3. 同步共享状态
            shared_state = self._sync_shared_state()
            
            # 4. 解决异步冲突
            conflicts = self._detect_async_conflicts()
            resolutions = self._resolve_async_conflicts(conflicts)
            
            # 5. 执行异步协作
            async_result = self._execute_async_collaboration(task)
            
            # 6. 生成最终结果
            result = CollaborationResult(
                success=True,
                result=async_result,
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id,
                metadata={
                    "async_agents_count": len(self.async_agents),
                    "async_events_count": len(async_events),
                    "conflicts_resolved": len(resolutions),
                    "progress": self.progress,
                    "status": self.execution_status
                }
            )
            
            return result
            
        except Exception as e:
            return CollaborationResult(
                success=False,
                error=str(e),
                execution_time=time.time() - start_time,
                collaboration_id=self.collaboration_id
            )
    
    def _setup_async_environment(self) -> Dict:
        """
        设置异步环境
        
        Returns:
            Dict: 异步环境配置
        """
        async_environment = {
            "agents": [agent.id for agent in self.async_agents],
            "shared_memory": self.shared_memory,
            "start_time": time.time(),
            "status": "initialized",
            "max_execution_time": getattr(self.config, 'max_execution_time', 3600)
        }
        
        self.execution_status = "running"
        return async_environment
    
    def _handle_async_events(self) -> List[AsyncEvent]:
        """
        处理异步事件
        
        Returns:
            List[AsyncEvent]: 异步事件列表
        """
        events = []
        
        # 模拟异步事件处理
        for i, agent in enumerate(self.async_agents):
            try:
                # 创建异步事件
                event = AsyncEvent(
                    event_id=f"async_event_{i+1}_{int(time.time())}",
                    event_type="task_progress",
                    agent_id=agent.id,
                    source_agent_id=agent.id,  # 添加源智能体ID
                    data={
                        "progress": (i + 1) * 20,  # 模拟进度
                        "status": "processing",
                        "timestamp": time.time()
                    },
                    timestamp=time.time()
                )
                events.append(event)
                
                # 更新进度
                self.progress = min(100.0, (i + 1) * 20)
                
            except Exception as e:
                logger.error(f"处理异步事件失败: {e}")
                continue
        
        self.async_events = events
        return events
    
    def _sync_shared_state(self) -> SharedState:
        """
        同步共享状态
        
        Returns:
            SharedState: 共享状态
        """
        try:
            # 收集所有智能体的状态
            agent_states = {}
            for agent in self.async_agents:
                agent_states[agent.id] = {
                    "name": agent.name,
                    "role": agent.role,
                    "status": "active",
                    "last_update": time.time()
                }
            
            # 创建共享状态
            shared_state = SharedState(
                agents=agent_states,
                shared_memory=self.shared_memory,
                last_sync=time.time(),
                sync_count=len(self.async_events),
                updated_by="system"  # 添加更新者字段
            )
            
            self.shared_state = shared_state
            return shared_state
            
        except Exception as e:
            logger.error(f"同步共享状态失败: {e}")
            return SharedState(
                agents={},
                shared_memory=self.shared_memory,
                last_sync=time.time(),
                sync_count=0,
                updated_by="system"  # 添加更新者字段
            )
    
    def _detect_async_conflicts(self) -> List[Conflict]:
        """
        检测异步冲突
        
        Returns:
            List[Conflict]: 冲突列表
        """
        conflicts = []
        
        # 模拟冲突检测
        if len(self.async_agents) > 1:
            # 检测资源冲突
            resource_conflict = Conflict(
                conflict_id=f"resource_conflict_{int(time.time())}",
                conflict_type="resource_conflict",
                agents=[agent.id for agent in self.async_agents[:2]],
                description="多个智能体同时访问共享资源",
                severity="medium",
                timestamp=time.time()
            )
            conflicts.append(resource_conflict)
        
        return conflicts
    
    def _resolve_async_conflicts(self, conflicts: List[Conflict]) -> List[Resolution]:
        """
        解决异步冲突
        
        Args:
            conflicts: 冲突列表
            
        Returns:
            List[Resolution]: 解决方案列表
        """
        resolutions = []
        
        for conflict in conflicts:
            try:
                # 根据冲突类型生成解决方案
                if conflict.conflict_type == "resource_conflict":
                    resolution = Resolution(
                        resolution_id=f"resolution_{conflict.conflict_id}",
                        conflict_id=conflict.conflict_id,
                        resolution_type="resource_allocation",
                        description="采用轮询方式分配资源访问权限",
                        status="applied",
                        timestamp=time.time()
                    )
                else:
                    resolution = Resolution(
                        resolution_id=f"resolution_{conflict.conflict_id}",
                        conflict_id=conflict.conflict_id,
                        resolution_type="default",
                        description="采用默认冲突解决策略",
                        status="applied",
                        timestamp=time.time()
                    )
                
                resolutions.append(resolution)
                
            except Exception as e:
                logger.error(f"解决冲突失败: {e}")
                continue
        
        return resolutions
    
    def _execute_async_collaboration(self, task: str) -> str:
        """
        执行异步协作
        
        Args:
            task: 任务描述
            
        Returns:
            str: 协作结果
        """
        try:
            # 模拟异步协作执行
            collaboration_text = f"异步协作执行完成：\n"
            collaboration_text += f"- 任务：{task}\n"
            collaboration_text += f"- 异步智能体数：{len(self.async_agents)}\n"
            collaboration_text += f"- 异步事件数：{len(self.async_events)}\n"
            collaboration_text += f"- 执行状态：{self.execution_status}\n"
            collaboration_text += f"- 执行进度：{self.progress}%\n"
            
            # 模拟各智能体的异步贡献
            for agent in self.async_agents:
                collaboration_text += f"- 异步智能体{agent.name}贡献：{agent.role}相关异步处理\n"
            
            # 添加共享状态信息
            if self.shared_state:
                collaboration_text += f"- 共享状态同步次数：{self.shared_state.sync_count}\n"
                collaboration_text += f"- 最后同步时间：{self.shared_state.last_sync}\n"
            
            self.execution_status = "completed"
            return collaboration_text
            
        except Exception as e:
            logger.error(f"执行异步协作失败: {e}")
            self.execution_status = "failed"
            return f"异步协作执行失败: {e}"
    
    def get_collaboration_state(self) -> CollaborationState:
        """获取协作状态"""
        return CollaborationState(
            collaboration_id=self.collaboration_id,
            mode=CollaborationMode.ASYNC,
            status=CollaborationStatus.COMPLETED if self.execution_status == "completed" else CollaborationStatus.IN_PROGRESS,
            current_iteration=int(self.progress),
            total_iterations=100,
            participants=[agent.id for agent in self.agents],
            metadata={
                "async_agents_count": len(self.async_agents),
                "async_events_count": len(self.async_events),
                "progress": self.progress,
                "status": self.execution_status,
                "shared_state": self.shared_state.dict() if self.shared_state else None
            }
        ) 