"""
Mining Planner Agent - 智能挖掘规划器

灵感来自 DeerFlow 的 Planner，实现：
1. 多轮澄清机制（避免在错误方向浪费 token）
2. LLM 驱动的任务分解为结构化计划
3. 人工审查和修改计划（human-in-the-loop）

设计原则：
- 结构化计划优于自由探索
- 强制外部信息获取（防止幻�ination）
- 自动验证和修复约束
"""

from typing import Optional, Dict, Any, List
import logging
import json
from datetime import datetime, timezone

from agenticx.core.agent import Agent, AgentContext, AgentResult
from agenticx.protocols.mining_protocol import (
    MiningPlan,
    MiningStep,
    MiningStepType,
    ExplorationStrategy,
    StopCondition,
    validate_mining_plan,
)

logger = logging.getLogger(__name__)


class MiningPlannerAgent(Agent):
    """
    智能挖掘规划器（灵感来自 DeerFlow Planner）
    
    核心功能：
    1. 澄清模糊目标（多轮对话）
    2. 生成结构化挖掘计划（LLM 驱动）
    3. 人工审查计划（可选）
    4. 自动验证和修复约束
    
    Attributes:
        enable_clarification: 是否启用澄清机制
        max_clarification_rounds: 最大澄清轮数
        auto_accept: 是否自动接受计划（跳过人工审查）
        llm_provider: LLM 提供者（用于生成计划）
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
    
    async def plan(
        self,
        goal: str,
        context: Optional[AgentContext] = None,
        background_context: Optional[str] = None,
        auto_accept: Optional[bool] = None
    ) -> MiningPlan:
        """
        生成挖掘计划。
        
        流程：
        1. 可选澄清阶段（如果 enable_clarification）
        2. LLM 生成初始计划
        3. 自动验证和修复
        4. 可选人工审查（如果 not auto_accept）
        
        Args:
            goal: 挖掘目标
            context: Agent 上下文
            background_context: 背景信息
            auto_accept: 是否自动接受（覆盖实例设置）
            
        Returns:
            验证后的 MiningPlan
        """
        context = context or AgentContext(agent_id=self.id)
        accept = auto_accept if auto_accept is not None else self.auto_accept
        
        # 1. 可选澄清阶段
        clarified_goal = goal
        if self.enable_clarification and not accept:
            clarified_goal = await self._clarify_goal(goal, context)
        
        # 2. 生成初始计划
        logger.info(f"Generating mining plan for goal: {clarified_goal}")
        raw_plan = await self._generate_plan_with_llm(
            clarified_goal,
            context,
            background_context
        )
        
        # 3. 验证和自动修复
        validation_result = validate_mining_plan(raw_plan)
        if validation_result.auto_repaired:
            object.__setattr__(self, 'auto_repairs_applied', self.auto_repairs_applied + 1)
            logger.info(f"Applied {len(validation_result.repairs)} auto-repairs to plan")
        
        # 4. 可选人工审查
        final_plan = raw_plan
        if not accept:
            final_plan = await self._request_human_review(raw_plan, context)
        
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
        return {
            "plans_generated": self.plans_generated,
            "clarifications_performed": self.clarifications_performed,
            "auto_repairs_applied": self.auto_repairs_applied
        }

