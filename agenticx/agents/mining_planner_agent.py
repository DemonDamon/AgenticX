"""
Mining Planner Agent - 智能挖掘规划器

灵感来自 DeerFlow 的 Planner，实现：
1. 多轮澄清机制（避免在错误方向浪费 token）
2. LLM 驱动的任务分解为结构化计划
3. 人工审查和修改计划（human-in-the-loop）
4. [NEW] Plan-as-a-Tool 机制（参考自 AgentScope PlanNotebook）

设计原则：
- 结构化计划优于自由探索
- 强制外部信息获取（防止幻觉）
- 自动验证和修复约束
- [NEW] 计划即工具，LLM 可主动管理计划状态
"""

from typing import Optional, Dict, Any, List, Callable, Coroutine
import logging
import json
from datetime import datetime, timezone

from agenticx.core.agent import Agent, AgentContext, AgentResult
from agenticx.core.plan_notebook import PlanNotebook, ToolResult as PlanToolResult
from agenticx.core.plan_storage import Plan, SubTask
from agenticx.protocols.mining_protocol import (
    MiningPlan,
    MiningStep,
    MiningStepType,
    MiningStepStatus,
    ExplorationStrategy,
    StopCondition,
    validate_mining_plan,
)
from agenticx.agents.spawn_worker import (
    WorkerSpawner, WorkerConfig, WorkerResult, WorkerContext
)
from agenticx.core.discovery import (
    Discovery, DiscoveryType, DiscoveryBus, DiscoveryStatus,
    get_discovery_bus
)

logger = logging.getLogger(__name__)


class MiningPlannerAgent(Agent):
    """
    智能挖掘规划器（灵感来自 DeerFlow Planner + AgentScope PlanNotebook）
    
    核心功能：
    1. 澄清模糊目标（多轮对话）
    2. 生成结构化挖掘计划（LLM 驱动）
    3. 人工审查计划（可选）
    4. 自动验证和修复约束
    5. [NEW] Plan-as-a-Tool: 计划状态管理工具（参考自 AgentScope）
    
    Attributes:
        enable_clarification: 是否启用澄清机制
        max_clarification_rounds: 最大澄清轮数
        auto_accept: 是否自动接受计划（跳过人工审查）
        llm_provider: LLM 提供者（用于生成计划）
        plan_notebook: [NEW] 计划笔记本（参考自 AgentScope）
    """
    
    def __init__(
        self,
        name: str = "MiningPlanner",
        role: str = "Mining Task Planner",
        goal: str = "Generate structured mining plans for intelligent exploration",
        backstory: Optional[str] = None,
        llm_provider: Optional[Any] = None,
        enable_clarification: bool = True,
        max_clarification_rounds: int = 2,
        auto_accept: bool = False,
        organization_id: str = "default",
        plan_notebook: Optional[PlanNotebook] = None,
        **kwargs
    ):
        """
        Args:
            name: Agent 名称
            role: Agent 角色
            goal: Agent 目标
            backstory: Agent 背景故事
            llm_provider: LLM 提供者实例
            enable_clarification: 是否启用澄清机制
            max_clarification_rounds: 最大澄清轮数
            auto_accept: 是否自动接受计划
            organization_id: 组织 ID
            plan_notebook: [NEW] 计划笔记本实例（可选，启用 Plan-as-a-Tool）
        """
        # 初始化扩展属性（在 super().__init__ 之前）
        extra_kwargs = kwargs.copy()
        extra_kwargs.update({
            '_llm_provider': llm_provider,
            '_enable_clarification': enable_clarification,
            '_max_clarification_rounds': max_clarification_rounds,
            '_auto_accept': auto_accept,
            '_plans_generated': 0,
            '_clarifications_performed': 0,
            '_auto_repairs_applied': 0,
        })
        
        super().__init__(
            name=name,
            role=role,
            goal=goal,
            backstory=backstory or "I am a specialized agent for creating structured mining plans.",
            organization_id=organization_id,
            **kwargs
        )
        
        # 使用 object.__setattr__ 绕过 Pydantic 验证
        object.__setattr__(self, 'llm_provider', llm_provider)
        object.__setattr__(self, 'enable_clarification', enable_clarification)
        object.__setattr__(self, 'max_clarification_rounds', max_clarification_rounds)
        object.__setattr__(self, 'auto_accept', auto_accept)
        object.__setattr__(self, 'plans_generated', 0)
        object.__setattr__(self, 'clarifications_performed', 0)
        object.__setattr__(self, 'auto_repairs_applied', 0)
        
        # [NEW] Plan-as-a-Tool: 计划笔记本（参考自 AgentScope）
        object.__setattr__(self, 'plan_notebook', plan_notebook)
        
        # 如果提供了 plan_notebook，注册计划变更钩子
        if plan_notebook:
            plan_notebook.register_plan_change_hook(
                f"{name}_sync_hook",
                self._on_plan_change
            )
        
        # [NEW] Discovery Loop: 发现总线（参考自 AgentScope）
        discovery_bus = get_discovery_bus()
        object.__setattr__(self, 'discovery_bus', discovery_bus)
        object.__setattr__(self, '_pending_discoveries', [])
        
        # 订阅发现通知
        discovery_bus.subscribe(
            handler=self._on_discovery,
            subscriber_id=f"{name}_discovery_handler",
            discovery_types=[DiscoveryType.TOOL, DiscoveryType.API, DiscoveryType.INSIGHT],
        )
        
        # [NEW] Recursive Worker: Worker 生成器（参考自 AgentScope）
        worker_spawner = WorkerSpawner(
            llm_provider=llm_provider,
            discovery_bus=discovery_bus,
        )
        object.__setattr__(self, 'worker_spawner', worker_spawner)
    
    async def plan(
        self,
        goal: str,
        context: Optional[AgentContext] = None,
        background_context: Optional[str] = None,
        auto_accept: Optional[bool] = None,
        sync_to_notebook: bool = True
    ) -> MiningPlan:
        """
        生成挖掘计划。
        
        流程：
        1. [NEW] 获取 PlanNotebook 状态提示（如果已配置）
        2. 可选澄清阶段（如果 enable_clarification）
        3. LLM 生成初始计划
        4. 自动验证和修复
        5. 可选人工审查（如果 not auto_accept）
        6. [NEW] 同步到 PlanNotebook（如果已配置且 sync_to_notebook=True）
        
        Args:
            goal: 挖掘目标
            context: Agent 上下文
            background_context: 背景信息
            auto_accept: 是否自动接受（覆盖实例设置）
            sync_to_notebook: [NEW] 是否同步到 PlanNotebook
            
        Returns:
            验证后的 MiningPlan
        """
        context = context or AgentContext(agent_id=self.id)
        accept = auto_accept if auto_accept is not None else self.auto_accept
        
        # [NEW] 1. 获取 PlanNotebook 状态提示
        plan_hint = None
        if self.plan_notebook:
            hint_msg = await self.plan_notebook.get_current_hint()
            if hint_msg:
                plan_hint = hint_msg.content
                logger.debug(f"Plan hint: {plan_hint[:100]}...")
        
        # 2. 可选澄清阶段
        clarified_goal = goal
        if self.enable_clarification and not accept:
            clarified_goal = await self._clarify_goal(goal, context)
        
        # 3. 生成初始计划（传入 plan_hint 作为额外上下文）
        logger.info(f"Generating mining plan for goal: {clarified_goal}")
        combined_context = background_context or ""
        if plan_hint:
            combined_context = f"{combined_context}\n\n[Plan Notebook Hint]:\n{plan_hint}"
        
        raw_plan = await self._generate_plan_with_llm(
            clarified_goal,
            context,
            combined_context if combined_context.strip() else None
        )
        
        # 4. 验证和自动修复
        validation_result = validate_mining_plan(raw_plan)
        if validation_result.auto_repaired:
            object.__setattr__(self, 'auto_repairs_applied', self.auto_repairs_applied + 1)
            logger.info(f"Applied {len(validation_result.repairs)} auto-repairs to plan")
        
        # 5. 可选人工审查
        final_plan = raw_plan
        if not accept:
            final_plan = await self._request_human_review(raw_plan, context)
        
        # [NEW] 6. 同步到 PlanNotebook
        if self.plan_notebook and sync_to_notebook:
            await self._sync_plan_to_notebook(final_plan)
        
        object.__setattr__(self, 'plans_generated', self.plans_generated + 1)
        logger.info(f"Plan generated successfully: {len(final_plan.steps)} steps")
        
        return final_plan
    
    async def _clarify_goal(
        self,
        goal: str,
        context: AgentContext
    ) -> str:
        """
        多轮澄清目标（类似 DeerFlow 澄清机制）。
        
        通过 LLM 生成澄清问题，与用户交互明确模糊目标。
        
        Args:
            goal: 原始目标
            context: Agent 上下文
            
        Returns:
            澄清后的目标
        """
        clarification_history = []
        clarified_goal = goal
        
        for round_num in range(self.max_clarification_rounds):
            # 生成澄清问题
            clarify_prompt = self._build_clarify_prompt(
                goal,
                clarification_history,
                context
            )
            
            # 调用 LLM
            if self.llm_provider:
                try:
                    response = await self._invoke_llm(clarify_prompt)
                    
                    # 检查是否完成澄清
                    if "[CLARIFICATION_COMPLETE]" in response:
                        logger.info(f"Clarification complete after {round_num + 1} rounds")
                        break
                    
                    # 模拟用户输入（实际应该通过 UI/CLI 获取）
                    # 这里返回一个默认响应以完成流程
                    user_answer = f"[Auto-response for round {round_num + 1}]"
                    
                    clarification_history.append({
                        "question": response,
                        "answer": user_answer
                    })
                    
                    clarified_goal = self._merge_clarifications(goal, clarification_history)
                    
                except Exception as e:
                        logger.warning(f"Clarification round {round_num + 1} failed: {e}")
                        break
            else:
                logger.warning("No LLM provider, skipping clarification")
                break
        
        object.__setattr__(self, 'clarifications_performed', self.clarifications_performed + 1)
        return clarified_goal
    
    def _build_clarify_prompt(
        self,
        goal: str,
        history: List[Dict[str, str]],
        context: AgentContext
    ) -> str:
        """构建澄清 Prompt"""
        prompt = f"""You are helping clarify a mining/exploration goal.

Original Goal: {goal}

Previous clarifications:
{json.dumps(history, indent=2) if history else "None"}

Your task:
1. If the goal is clear and specific, respond with [CLARIFICATION_COMPLETE]
2. Otherwise, ask ONE specific clarification question to understand:
   - The scope of exploration
   - Desired depth vs breadth
   - Success criteria
   - Time/cost constraints

Question:"""
        return prompt
    
    def _merge_clarifications(
        self,
        original_goal: str,
        history: List[Dict[str, str]]
    ) -> str:
        """合并澄清历史到目标"""
        if not history:
            return original_goal
        
        # 简单合并策略：附加澄清信息
        clarifications = "\n".join([
            f"- {item['question']}: {item['answer']}"
            for item in history
        ])
        
        return f"{original_goal}\n\nClarifications:\n{clarifications}"
    
    async def _generate_plan_with_llm(
        self,
        goal: str,
        context: AgentContext,
        background_context: Optional[str] = None
    ) -> MiningPlan:
        """
        使用 LLM 生成挖掘计划。
        
        Args:
            goal: 目标
            context: 上下文
            background_context: 背景信息
            
        Returns:
            生成的 MiningPlan
        """
        prompt = self._build_plan_prompt(goal, background_context)
        
        if self.llm_provider:
            try:
                response = await self._invoke_llm(prompt)
                plan_data = self._parse_plan_response(response)
                plan = MiningPlan(**plan_data)
                return plan
            except Exception as e:
                logger.error(f"LLM plan generation failed: {e}, using fallback")
                return self._create_fallback_plan(goal)
        else:
            logger.warning("No LLM provider, using fallback plan")
            return self._create_fallback_plan(goal)
    
    def _build_plan_prompt(
        self,
        goal: str,
        background_context: Optional[str] = None
    ) -> str:
        """构建计划生成 Prompt（参考 DeerFlow planner.md）"""
        return f"""You are an intelligent mining planner. Create a structured plan for discovering and validating new knowledge, tools, or strategies.

**Goal**: {goal}

**Context**: {background_context or 'None'}

**Requirements**:
1. Break down the goal into 3-7 concrete steps
2. Each step MUST have a type: search | analyze | execute | explore
3. At least ONE step must have `need_external_info: true` (to prevent hallucination)
4. For explore steps, specify `exploration_budget` (number of allowed failures)
5. Prioritize steps that balance exploration (discovering new) and exploitation (using known)

**Output Format** (JSON):
{{
    "goal": "{goal}",
    "steps": [
        {{
            "step_type": "search",
            "title": "Initial Research",
            "description": "Search for relevant information",
            "need_external_info": true,
            "exploration_budget": 1
        }},
        {{
            "step_type": "analyze",
            "title": "Analyze Findings",
            "description": "Analyze the search results",
            "need_external_info": false
        }}
    ],
    "exploration_strategy": "breadth_first",
    "stop_condition": "max_steps",
    "max_total_cost": 5.0
}}

Generate the plan (JSON only, no explanation):"""
    
    def _parse_plan_response(self, response: str) -> Dict[str, Any]:
        """解析 LLM 响应为计划数据"""
        try:
            # 尝试提取 JSON
            json_start = response.find('{')
            json_end = response.rfind('}') + 1
            
            if json_start >= 0 and json_end > json_start:
                json_str = response[json_start:json_end]
                return json.loads(json_str)
            else:
                raise ValueError("No JSON found in response")
        except Exception as e:
            logger.error(f"Failed to parse plan response: {e}")
            raise
    
    def _create_fallback_plan(self, goal: str) -> MiningPlan:
        """创建降级计划（当 LLM 不可用时）"""
        steps = [
            MiningStep(
                step_type=MiningStepType.SEARCH,
                title="Initial Search",
                description=f"Search for information related to: {goal}",
                need_external_info=True,
                exploration_budget=2
            ),
            MiningStep(
                step_type=MiningStepType.ANALYZE,
                title="Analyze Results",
                description="Analyze the search results and extract key insights",
                need_external_info=False
            ),
            MiningStep(
                step_type=MiningStepType.EXPLORE,
                title="Deep Exploration",
                description="Explore promising directions discovered in the analysis",
                need_external_info=True,
                exploration_budget=3
            )
        ]
        
        return MiningPlan(
            goal=goal,
            steps=steps,
            exploration_strategy=ExplorationStrategy.BREADTH_FIRST,
            stop_condition=StopCondition.MAX_STEPS,
            max_total_cost=10.0
        )
    
    async def _request_human_review(
        self,
        plan: MiningPlan,
        context: AgentContext
    ) -> MiningPlan:
        """
        请求人工审查计划（类似 DeerFlow human_feedback_node）。
        
        在实际应用中，这应该通过 UI/CLI 与用户交互。
        这里提供一个简化实现。
        
        Args:
            plan: 待审查的计划
            context: 上下文
            
        Returns:
            审查后的计划（可能被修改）
        """
        # 格式化计划为可读形式
        plan_text = plan.to_summary()
        
        logger.info("Plan ready for human review:")
        logger.info(plan_text)
        
        # 在实际应用中，这里应该等待用户输入
        # 可选项: [ACCEPTED] 或 [EDIT_PLAN] <instructions>
        # 简化实现：自动接受
        feedback = "[ACCEPTED]"
        
        if feedback.startswith("[EDIT_PLAN]"):
            # 提取编辑指令
            edit_instructions = feedback.replace("[EDIT_PLAN]", "").strip()
            return await self._revise_plan(plan, edit_instructions, context)
        
        return plan  # [ACCEPTED]
    
    async def _revise_plan(
        self,
        plan: MiningPlan,
        instructions: str,
        context: AgentContext
    ) -> MiningPlan:
        """根据人工反馈修订计划"""
        # 构建修订 Prompt
        revision_prompt = f"""Revise the following mining plan based on user feedback.

Original Plan:
{plan.to_summary()}

User Feedback:
{instructions}

Generate a revised plan (JSON format):"""
        
        if self.llm_provider:
            try:
                response = await self._invoke_llm(revision_prompt)
                plan_data = self._parse_plan_response(response)
                revised_plan = MiningPlan(**plan_data)
                return revised_plan
            except Exception as e:
                logger.error(f"Plan revision failed: {e}, returning original")
                return plan
        else:
            return plan
    
    async def _invoke_llm(self, prompt: str) -> str:
        """调用 LLM（异步）"""
        if hasattr(self.llm_provider, 'ainvoke'):
            response = await self.llm_provider.ainvoke([{"role": "user", "content": prompt}])
        elif hasattr(self.llm_provider, 'invoke'):
            # 同步调用
            response = self.llm_provider.invoke([{"role": "user", "content": prompt}])
        else:
            raise ValueError("LLM provider must have ainvoke or invoke method")
        
        # 提取文本内容
        if hasattr(response, 'content'):
            return response.content
        elif isinstance(response, str):
            return response
        else:
            return str(response)
    
    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        stats = {
            "plans_generated": self.plans_generated,
            "clarifications_performed": self.clarifications_performed,
            "auto_repairs_applied": self.auto_repairs_applied
        }
        
        # [NEW] 添加 PlanNotebook 统计
        if self.plan_notebook:
            stats["plan_notebook_enabled"] = True
            stats["has_current_plan"] = self.plan_notebook.current_plan is not None
        else:
            stats["plan_notebook_enabled"] = False
        
        return stats
    
    # =========================================================================
    # [NEW] Plan-as-a-Tool 方法（参考自 AgentScope）
    # =========================================================================
    
    async def _sync_plan_to_notebook(self, plan: MiningPlan) -> None:
        """
        将 MiningPlan 同步到 PlanNotebook。
        
        参考自 AgentScope 的"计划即工具"理念：
        - MiningPlan 的 steps 转换为 SubTask
        - 自动在 PlanNotebook 中创建对应的计划
        
        Args:
            plan: 要同步的挖掘计划
        """
        if not self.plan_notebook:
            return
        
        # 将 MiningStep 转换为 SubTask 格式
        subtasks = [step.to_subtask_dict() for step in plan.steps]
        
        # 在 PlanNotebook 中创建计划
        await self.plan_notebook.create_plan(
            name=f"Mining: {plan.goal[:50]}...",
            description=plan.goal,
            expected_outcome=f"Complete all {len(plan.steps)} mining steps",
            subtasks=subtasks
        )
        
        logger.info(f"Synced MiningPlan to PlanNotebook: {len(subtasks)} subtasks")
    
    def _on_plan_change(self, notebook: PlanNotebook, plan: Optional[Plan]) -> None:
        """
        PlanNotebook 计划变更时的钩子回调。
        
        可以在这里同步 PlanNotebook 的变更回 MiningPlan，
        或触发其他业务逻辑。
        
        Args:
            notebook: PlanNotebook 实例
            plan: 当前计划（可能为 None）
        """
        if plan:
            logger.debug(f"Plan changed: {plan.name}, state={plan.state}")
        else:
            logger.debug("Plan cleared")
    
    def get_plan_tools(self) -> List[Callable[..., Coroutine[Any, Any, PlanToolResult]]]:
        """
        获取计划管理工具列表（参考自 AgentScope）。
        
        这些工具可以被 LLM 调用来管理计划状态。
        
        Returns:
            计划管理工具列表，如果未配置 PlanNotebook 则返回空列表
        """
        if not self.plan_notebook:
            return []
        return self.plan_notebook.list_tools()
    
    def get_plan_tool_schemas(self) -> List[Dict[str, Any]]:
        """
        获取计划管理工具的 JSON Schema（用于 LLM function calling）。
        
        Returns:
            工具 Schema 列表，如果未配置 PlanNotebook 则返回空列表
        """
        if not self.plan_notebook:
            return []
        return self.plan_notebook.get_tool_schemas()
    
    async def get_current_plan_hint(self) -> Optional[str]:
        """
        获取当前计划的状态提示（参考自 AgentScope）。
        
        提示会根据计划状态自动生成，引导 LLM 下一步应该做什么。
        
        Returns:
            状态提示字符串，如果没有计划或未配置 PlanNotebook 则返回 None
        """
        if not self.plan_notebook:
            return None
        
        hint_msg = await self.plan_notebook.get_current_hint()
        return hint_msg.content if hint_msg else None
    
    async def update_step_status(
        self,
        step_index: int,
        status: MiningStepStatus,
        outcome: Optional[str] = None
    ) -> bool:
        """
        更新步骤状态并同步到 PlanNotebook。
        
        Args:
            step_index: 步骤索引
            status: 新状态
            outcome: 成果（完成时提供）
            
        Returns:
            是否更新成功
        """
        if not self.plan_notebook or not self.plan_notebook.current_plan:
            return False
        
        # 转换状态为 AgentScope 格式
        agentscope_state = status.to_agentscope() if isinstance(status, MiningStepStatus) else MiningStepStatus(status).to_agentscope()
        
        if status == MiningStepStatus.COMPLETED and outcome:
            result = await self.plan_notebook.finish_subtask(step_index, outcome)
        else:
            result = await self.plan_notebook.update_subtask_state(step_index, agentscope_state)
        
        return result.success
    
    # =========================================================================
    # [NEW] Recursive Worker 方法（参考自 AgentScope create_worker）
    # =========================================================================
    
    async def spawn_worker(
        self,
        task_description: str,
        worker_name: Optional[str] = None,
        max_iterations: int = 10,
        tools: Optional[List[str]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> WorkerResult:
        """
        创建子 Worker 执行特定任务（参考自 AgentScope create_worker）。
        
        这是"递归 Worker"机制的核心方法，允许 Planner 动态创建
        专门的 Worker 来执行具体任务。
        
        Args:
            task_description: 任务描述，应包含所有必要信息
            worker_name: Worker 名称（可选）
            max_iterations: 最大迭代次数
            tools: 可用工具列表
            context: 额外上下文信息
            
        Returns:
            WorkerResult 执行结果
            
        示例:
        ```python
        result = await planner.spawn_worker(
            task_description="搜索 AgentScope 的 PlanNotebook 实现细节",
            worker_name="ResearchWorker",
            max_iterations=5
        )
        
        if result.success:
            print(f"任务完成: {result.message}")
            for insight in result.insights:
                print(f"  - {insight}")
        ```
        """
        config = WorkerConfig(
            name=worker_name or "Worker",
            max_iterations=max_iterations,
            tools=tools or [],
        )
        
        # 构建上下文
        worker_context = context or {}
        worker_context["parent_agent_id"] = self.id
        
        if self.plan_notebook and self.plan_notebook.current_plan:
            worker_context["parent_plan_id"] = self.plan_notebook.current_plan.id
        
        return await self.worker_spawner.spawn_worker(
            task_description=task_description,
            config=config,
            context=worker_context,
        )
    
    async def spawn_worker_for_step(
        self,
        step_index: int,
        additional_context: Optional[str] = None
    ) -> WorkerResult:
        """
        为指定步骤创建专门的 Worker。
        
        便捷方法，自动从当前计划中提取步骤信息作为任务描述。
        
        Args:
            step_index: 步骤索引
            additional_context: 额外上下文
            
        Returns:
            WorkerResult 执行结果
        """
        if not self.plan_notebook or not self.plan_notebook.current_plan:
            return WorkerResult(
                success=False,
                message="No active plan found"
            )
        
        plan = self.plan_notebook.current_plan
        if step_index < 0 or step_index >= len(plan.subtasks):
            return WorkerResult(
                success=False,
                message=f"Invalid step index: {step_index}"
            )
        
        subtask = plan.subtasks[step_index]
        
        # 构建任务描述
        task_description = f"""Execute the following subtask:

**Task**: {subtask.name}
**Description**: {subtask.description}
**Expected Outcome**: {subtask.expected_outcome}

{f"**Additional Context**: {additional_context}" if additional_context else ""}

Please complete this task and report your findings."""
        
        return await self.spawn_worker(
            task_description=task_description,
            worker_name=f"Worker-{subtask.name[:20]}",
            context={"subtask_index": step_index}
        )
    
    def get_spawn_worker_tool_schema(self) -> Dict[str, Any]:
        """
        获取 spawn_worker 工具的 JSON Schema。
        
        Returns:
            用于 LLM function calling 的 Schema
        """
        return self.worker_spawner.get_tool_schema()
    
    def get_worker_stats(self) -> Dict[str, Any]:
        """获取 Worker 统计信息"""
        return self.worker_spawner.get_stats()
    
    # =========================================================================
    # [NEW] Discovery Loop 方法（参考自 AgentScope 动态能力扩展）
    # =========================================================================
    
    def _on_discovery(self, discovery: Discovery) -> None:
        """
        处理来自 Worker 的发现通知。
        
        这是 Discovery Loop 的核心回调，当 Worker 发现新能力时触发。
        
        Args:
            discovery: 发现对象
        """
        logger.info(f"[Discovery Loop] Received: [{discovery.type}] {discovery.name}")
        
        # 添加到待处理队列
        self._pending_discoveries.append(discovery)
        
        # 高优先级发现自动标记为已确认
        if discovery.priority.value in ["high", "critical"]:
            discovery.acknowledge()
    
    def get_pending_discoveries(self) -> List[Discovery]:
        """
        获取待处理的发现列表。
        
        Returns:
            待处理的发现列表
        """
        return [d for d in self._pending_discoveries if d.status == DiscoveryStatus.PENDING]
    
    def get_all_discoveries(self) -> List[Discovery]:
        """获取所有发现"""
        return self._pending_discoveries.copy()
    
    async def process_discoveries(self) -> List[Dict[str, Any]]:
        """
        处理待处理的发现，生成计划调整建议。
        
        这是 Discovery Loop 的关键方法：
        1. 收集所有待处理发现
        2. 为每个发现生成计划调整建议
        3. 可选地自动应用建议到当前计划
        
        Returns:
            计划调整建议列表
        """
        suggestions = []
        
        for discovery in self.get_pending_discoveries():
            suggestion = discovery.to_plan_suggestion()
            suggestions.append(suggestion)
            
            # 标记为已确认
            discovery.acknowledge()
            
            logger.info(f"[Discovery Loop] Processed: {discovery.name} -> {suggestion['suggested_action']}")
        
        return suggestions
    
    async def auto_integrate_discoveries(self) -> int:
        """
        自动将高优先级发现集成到当前计划。
        
        只处理 TOOL 和 API 类型的发现，为它们添加新的子任务。
        
        Returns:
            集成的发现数量
        """
        if not self.plan_notebook or not self.plan_notebook.current_plan:
            logger.warning("No active plan to integrate discoveries")
            return 0
        
        integrated = 0
        
        # 获取未集成的发现（PENDING 或 ACKNOWLEDGED 状态）
        candidates = [
            d for d in self._pending_discoveries 
            if d.status in [DiscoveryStatus.PENDING, DiscoveryStatus.ACKNOWLEDGED]
        ]
        
        for discovery in candidates:
            if discovery.type not in [DiscoveryType.TOOL, DiscoveryType.API]:
                continue
            
            if discovery.priority.value not in ["high", "critical"]:
                continue
            
            # 生成建议
            suggestion = discovery.to_plan_suggestion()
            
            # 添加到计划
            try:
                result = await self.plan_notebook.revise_current_plan(
                    subtask_idx=len(self.plan_notebook.current_plan.subtasks),
                    action="add",
                    subtask=suggestion["subtask"]
                )
                
                if result.success:
                    discovery.integrate()
                    integrated += 1
                    logger.info(f"[Discovery Loop] Auto-integrated: {discovery.name}")
                    
            except Exception as e:
                logger.error(f"Failed to integrate discovery {discovery.name}: {e}")
        
        return integrated
    
    def get_discovery_stats(self) -> Dict[str, Any]:
        """获取发现相关统计"""
        discoveries = self._pending_discoveries
        
        by_type = {}
        by_status = {}
        
        for d in discoveries:
            by_type[d.type.value] = by_type.get(d.type.value, 0) + 1
            by_status[d.status.value] = by_status.get(d.status.value, 0) + 1
        
        return {
            "total_discoveries": len(discoveries),
            "pending": len(self.get_pending_discoveries()),
            "by_type": by_type,
            "by_status": by_status,
            "bus_stats": self.discovery_bus.get_stats(),
        }

