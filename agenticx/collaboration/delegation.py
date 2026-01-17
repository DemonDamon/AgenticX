"""
Agent 委派系统

提供 Agent 之间的任务委派和问答机制。
参考自 crewAI tools/agent_tools

主要组件：
- DelegateWorkTool: 允许 Agent 将任务委派给其他 Agent
- AskQuestionTool: 允许 Agent 向其他 Agent 提问
- DelegationContext: 委派执行的上下文信息

Usage:
    from agenticx.collaboration.delegation import (
        DelegateWorkTool,
        AskQuestionTool,
        DelegationContext,
    )
    
    # 创建委派工具
    agents = [agent1, agent2, agent3]
    delegate_tool = DelegateWorkTool(agents=agents)
    
    # 委派任务
    result = delegate_tool.run(
        task="分析这份报告的关键数据",
        context="需要特别关注 Q3 的销售数据",
        coworker="Data Analyst"
    )
    
    # 向同事提问
    ask_tool = AskQuestionTool(agents=agents)
    answer = ask_tool.run(
        question="这个项目的预算上限是多少？",
        context="我正在准备采购计划",
        coworker="Project Manager"
    )
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Type

from pydantic import BaseModel, Field  # type: ignore

from ..tools.base import BaseTool, ToolError

if TYPE_CHECKING:
    from ..core.agent import Agent


logger = logging.getLogger(__name__)


# ============================================================================
# Pydantic Schemas for Tool Arguments
# ============================================================================


class DelegateWorkSchema(BaseModel):
    """DelegateWorkTool 的参数模式"""
    
    task: str = Field(
        description="要委派给同事的具体任务描述"
    )
    context: str = Field(
        description="执行任务所需的完整上下文信息"
    )
    coworker: str = Field(
        description="负责执行此任务的同事角色名称（如 'Data Analyst', 'Engineer'）"
    )


class AskQuestionSchema(BaseModel):
    """AskQuestionTool 的参数模式"""
    
    question: str = Field(
        description="要向同事提出的具体问题"
    )
    context: str = Field(
        description="提问的背景信息，帮助同事更好地理解问题"
    )
    coworker: str = Field(
        description="要询问的同事角色名称（如 'Data Analyst', 'Engineer'）"
    )


# ============================================================================
# Delegation Context
# ============================================================================


@dataclass
class DelegationContext:
    """委派执行上下文
    
    记录委派执行过程中的所有相关信息，用于追踪和调试。
    
    Attributes:
        delegating_agent_id: 发起委派的 Agent ID
        delegating_agent_name: 发起委派的 Agent 名称
        delegate_agent_id: 被委派的 Agent ID
        delegate_agent_name: 被委派的 Agent 名称
        task: 委派的任务描述
        context: 任务上下文
        result: 执行结果
        success: 是否成功
        error_message: 错误信息（如果失败）
        execution_time: 执行时间（秒）
        metadata: 额外元数据
    """
    
    delegating_agent_id: Optional[str] = None
    delegating_agent_name: Optional[str] = None
    delegate_agent_id: Optional[str] = None
    delegate_agent_name: Optional[str] = None
    task: str = ""
    context: str = ""
    result: Optional[str] = None
    success: bool = False
    error_message: Optional[str] = None
    execution_time: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


# ============================================================================
# Utility Functions
# ============================================================================


def sanitize_agent_name(name: str) -> str:
    """标准化 Agent 名称用于匹配
    
    处理步骤：
    1. Unicode 规范化 (NFKD)
    2. 移除变音符号
    3. 转换为小写
    4. 移除非字母数字字符
    5. 移除多余空格
    
    Args:
        name: 原始 Agent 名称
        
    Returns:
        标准化后的名称
        
    Example:
        >>> sanitize_agent_name("Data Analyst")
        "data analyst"
        >>> sanitize_agent_name("José García")
        "jose garcia"
    """
    # Unicode 规范化
    normalized = unicodedata.normalize("NFKD", name)
    
    # 移除变音符号（保留基本字符）
    ascii_text = normalized.encode("ASCII", "ignore").decode("ASCII")
    
    # 转换为小写
    lower = ascii_text.lower()
    
    # 移除非字母数字和空格字符，保留单个空格
    cleaned = re.sub(r"[^a-z0-9\s]", "", lower)
    
    # 移除多余空格
    return " ".join(cleaned.split())


def find_agent_by_role(
    agents: List["Agent"],
    role_query: str,
    strict: bool = False
) -> Optional["Agent"]:
    """根据角色查找 Agent
    
    使用模糊匹配算法查找最匹配的 Agent。
    
    Args:
        agents: Agent 列表
        role_query: 要查找的角色名称
        strict: 是否严格匹配（默认 False，使用模糊匹配）
        
    Returns:
        匹配的 Agent，如果未找到返回 None
        
    Example:
        >>> agent = find_agent_by_role(agents, "data analyst")
        >>> agent.name
        "Data Analysis Expert"
    """
    if not agents:
        return None
    
    sanitized_query = sanitize_agent_name(role_query)
    
    # 首先尝试精确匹配
    for agent in agents:
        sanitized_role = sanitize_agent_name(agent.role)
        sanitized_name = sanitize_agent_name(agent.name)
        
        if sanitized_role == sanitized_query or sanitized_name == sanitized_query:
            return agent
    
    if strict:
        return None
    
    # 模糊匹配：检查包含关系
    for agent in agents:
        sanitized_role = sanitize_agent_name(agent.role)
        sanitized_name = sanitize_agent_name(agent.name)
        
        if (sanitized_query in sanitized_role or 
            sanitized_role in sanitized_query or
            sanitized_query in sanitized_name or
            sanitized_name in sanitized_query):
            return agent
    
    # 尝试词级别匹配
    query_words = set(sanitized_query.split())
    best_match = None
    best_score = 0
    
    for agent in agents:
        role_words = set(sanitize_agent_name(agent.role).split())
        name_words = set(sanitize_agent_name(agent.name).split())
        all_words = role_words | name_words
        
        # 计算匹配分数（交集大小）
        score = len(query_words & all_words)
        if score > best_score:
            best_score = score
            best_match = agent
    
    # 只有至少匹配一个词时才返回
    return best_match if best_score > 0 else None


# ============================================================================
# Delegation Tools
# ============================================================================


class DelegateWorkTool(BaseTool):
    """委派任务工具
    
    允许 Agent 将任务委派给其他 Agent 执行。
    参考自 crewAI DelegateWorkTool。
    
    特性：
    - 基于角色的模糊匹配查找目标 Agent
    - 支持自定义任务执行器
    - 提供详细的委派上下文追踪
    
    Attributes:
        agents: 可委派的 Agent 列表
        execute_task_func: 可选的自定义任务执行函数
        
    Example:
        >>> delegate_tool = DelegateWorkTool(agents=[analyst, engineer])
        >>> result = delegate_tool.run(
        ...     task="分析销售数据",
        ...     context="需要 Q3 报告",
        ...     coworker="Data Analyst"
        ... )
    """
    
    # 工具属性
    name: str = "delegate_work"
    description: str = """
将任务委派给特定的同事执行。当你需要其他专家的帮助来完成某项任务时使用此工具。

参数说明：
- task: 要委派的具体任务描述
- context: 执行任务所需的完整上下文信息（非常重要！）
- coworker: 负责执行任务的同事角色名称

注意事项：
- 提供尽可能详细的上下文，因为被委派的同事只能看到你提供的信息
- 使用正确的同事角色名称进行匹配
""".strip()
    
    def __init__(
        self,
        agents: Optional[List["Agent"]] = None,
        execute_task_func: Optional[Callable] = None,
        **kwargs
    ):
        """初始化委派工具
        
        Args:
            agents: 可委派的 Agent 列表
            execute_task_func: 自定义任务执行函数，签名应为：
                (agent, task, context) -> str
            **kwargs: 传递给 BaseTool 的其他参数
        """
        super().__init__(
            name="delegate_work",
            args_schema=DelegateWorkSchema,
            **kwargs
        )
        self._agents = agents or []
        self._execute_task_func = execute_task_func
        self._last_delegation_context: Optional[DelegationContext] = None
    
    @property
    def agents(self) -> List["Agent"]:
        """获取可委派的 Agent 列表"""
        return self._agents
    
    @agents.setter
    def agents(self, value: List["Agent"]):
        """设置可委派的 Agent 列表"""
        self._agents = value or []
    
    @property
    def last_delegation_context(self) -> Optional[DelegationContext]:
        """获取最后一次委派的上下文"""
        return self._last_delegation_context
    
    def _run(
        self,
        task: str = "",
        context: str = "",
        coworker: str = "",
        **kwargs
    ) -> str:
        """执行委派任务
        
        Args:
            task: 要委派的任务描述
            context: 任务上下文
            coworker: 目标同事的角色名称
            
        Returns:
            委派执行的结果
            
        Raises:
            ToolError: 当找不到目标 Agent 或执行失败时
        """
        import time
        start_time = time.time()
        
        # 初始化委派上下文
        delegation_ctx = DelegationContext(
            task=task,
            context=context,
        )
        
        try:
            # 查找目标 Agent
            target_agent = find_agent_by_role(self._agents, coworker)
            
            if target_agent is None:
                available_roles = [a.role for a in self._agents]
                error_msg = (
                    f"无法找到角色为 '{coworker}' 的同事。\n"
                    f"可用的同事角色: {', '.join(available_roles)}\n"
                    f"请使用正确的角色名称重试。"
                )
                delegation_ctx.success = False
                delegation_ctx.error_message = error_msg
                self._last_delegation_context = delegation_ctx
                
                raise ToolError(
                    message=error_msg,
                    tool_name=self.name,
                    details={"available_roles": available_roles, "requested": coworker}
                )
            
            delegation_ctx.delegate_agent_id = target_agent.id
            delegation_ctx.delegate_agent_name = target_agent.name
            
            logger.info(
                f"委派任务给 {target_agent.name} ({target_agent.role}): {task[:50]}..."
            )
            
            # 执行任务
            if self._execute_task_func:
                # 使用自定义执行函数
                result = self._execute_task_func(target_agent, task, context)
            else:
                # 默认执行：构造任务描述并调用 Agent
                result = self._default_execute(target_agent, task, context)
            
            delegation_ctx.result = str(result)
            delegation_ctx.success = True
            delegation_ctx.execution_time = time.time() - start_time
            self._last_delegation_context = delegation_ctx
            
            return str(result)
            
        except ToolError:
            raise
        except Exception as e:
            delegation_ctx.success = False
            delegation_ctx.error_message = str(e)
            delegation_ctx.execution_time = time.time() - start_time
            self._last_delegation_context = delegation_ctx
            
            raise ToolError(
                message=f"委派任务执行失败: {e}",
                tool_name=self.name,
                details={"task": task, "coworker": coworker, "error": str(e)}
            )
    
    def _default_execute(
        self,
        agent: "Agent",
        task: str,
        context: str
    ) -> str:
        """默认的任务执行实现
        
        这是一个简化实现。在实际使用中，应该通过
        execute_task_func 提供完整的 AgentExecutor 调用。
        
        Args:
            agent: 目标 Agent
            task: 任务描述
            context: 上下文信息
            
        Returns:
            执行结果字符串
        """
        # 构造任务提示
        prompt = f"""
你被委派执行以下任务：

## 任务
{task}

## 上下文
{context}

请根据你的专业知识（角色: {agent.role}）完成此任务，并提供详细的结果。
""".strip()
        
        # 检查 Agent 是否有 LLM
        if agent.llm is not None:
            # 使用 Agent 的 LLM 执行
            if hasattr(agent.llm, 'invoke'):
                response = agent.llm.invoke(prompt)
                if hasattr(response, 'content'):
                    return response.content
                return str(response)
            elif hasattr(agent.llm, 'generate'):
                response = agent.llm.generate([prompt])
                return str(response)
        
        # 无 LLM 时返回模拟结果
        return f"[{agent.name}] 已收到任务: {task[:50]}... (需要配置 LLM 或 execute_task_func)"


class AskQuestionTool(BaseTool):
    """向同事提问工具
    
    允许 Agent 向其他 Agent 提问并获取答案。
    参考自 crewAI AskQuestionTool。
    
    与 DelegateWorkTool 的区别：
    - DelegateWorkTool: 委派完整任务，期望得到任务执行结果
    - AskQuestionTool: 提出问题，期望得到信息或建议
    
    Attributes:
        agents: 可提问的 Agent 列表
        ask_func: 可选的自定义提问函数
        
    Example:
        >>> ask_tool = AskQuestionTool(agents=[analyst, manager])
        >>> answer = ask_tool.run(
        ...     question="这个季度的预算上限是多少？",
        ...     context="我在准备采购计划",
        ...     coworker="Project Manager"
        ... )
    """
    
    # 工具属性
    name: str = "ask_question"
    description: str = """
向特定的同事提出问题。当你需要获取信息、建议或澄清时使用此工具。

参数说明：
- question: 要提出的具体问题
- context: 提问的背景信息（帮助同事更好地理解问题）
- coworker: 要询问的同事角色名称

注意事项：
- 问题要清晰具体
- 提供足够的背景信息
- 使用正确的同事角色名称
""".strip()
    
    def __init__(
        self,
        agents: Optional[List["Agent"]] = None,
        ask_func: Optional[Callable] = None,
        **kwargs
    ):
        """初始化提问工具
        
        Args:
            agents: 可提问的 Agent 列表
            ask_func: 自定义提问函数，签名应为：
                (agent, question, context) -> str
            **kwargs: 传递给 BaseTool 的其他参数
        """
        super().__init__(
            name="ask_question",
            args_schema=AskQuestionSchema,
            **kwargs
        )
        self._agents = agents or []
        self._ask_func = ask_func
        self._last_delegation_context: Optional[DelegationContext] = None
    
    @property
    def agents(self) -> List["Agent"]:
        """获取可提问的 Agent 列表"""
        return self._agents
    
    @agents.setter
    def agents(self, value: List["Agent"]):
        """设置可提问的 Agent 列表"""
        self._agents = value or []
    
    @property
    def last_delegation_context(self) -> Optional[DelegationContext]:
        """获取最后一次提问的上下文"""
        return self._last_delegation_context
    
    def _run(
        self,
        question: str = "",
        context: str = "",
        coworker: str = "",
        **kwargs
    ) -> str:
        """执行提问
        
        Args:
            question: 要提出的问题
            context: 问题背景
            coworker: 目标同事的角色名称
            
        Returns:
            同事的回答
            
        Raises:
            ToolError: 当找不到目标 Agent 或执行失败时
        """
        import time
        start_time = time.time()
        
        # 初始化上下文
        delegation_ctx = DelegationContext(
            task=question,  # 复用 task 字段存储问题
            context=context,
        )
        
        try:
            # 查找目标 Agent
            target_agent = find_agent_by_role(self._agents, coworker)
            
            if target_agent is None:
                available_roles = [a.role for a in self._agents]
                error_msg = (
                    f"无法找到角色为 '{coworker}' 的同事。\n"
                    f"可用的同事角色: {', '.join(available_roles)}\n"
                    f"请使用正确的角色名称重试。"
                )
                delegation_ctx.success = False
                delegation_ctx.error_message = error_msg
                self._last_delegation_context = delegation_ctx
                
                raise ToolError(
                    message=error_msg,
                    tool_name=self.name,
                    details={"available_roles": available_roles, "requested": coworker}
                )
            
            delegation_ctx.delegate_agent_id = target_agent.id
            delegation_ctx.delegate_agent_name = target_agent.name
            
            logger.info(
                f"向 {target_agent.name} ({target_agent.role}) 提问: {question[:50]}..."
            )
            
            # 执行提问
            if self._ask_func:
                # 使用自定义提问函数
                answer = self._ask_func(target_agent, question, context)
            else:
                # 默认执行
                answer = self._default_ask(target_agent, question, context)
            
            delegation_ctx.result = str(answer)
            delegation_ctx.success = True
            delegation_ctx.execution_time = time.time() - start_time
            self._last_delegation_context = delegation_ctx
            
            return str(answer)
            
        except ToolError:
            raise
        except Exception as e:
            delegation_ctx.success = False
            delegation_ctx.error_message = str(e)
            delegation_ctx.execution_time = time.time() - start_time
            self._last_delegation_context = delegation_ctx
            
            raise ToolError(
                message=f"提问失败: {e}",
                tool_name=self.name,
                details={"question": question, "coworker": coworker, "error": str(e)}
            )
    
    def _default_ask(
        self,
        agent: "Agent",
        question: str,
        context: str
    ) -> str:
        """默认的提问实现
        
        Args:
            agent: 目标 Agent
            question: 问题
            context: 上下文信息
            
        Returns:
            回答字符串
        """
        # 构造提问提示
        prompt = f"""
有人向你提出了以下问题：

## 问题
{question}

## 背景信息
{context}

请根据你的专业知识（角色: {agent.role}）回答这个问题。
""".strip()
        
        # 检查 Agent 是否有 LLM
        if agent.llm is not None:
            if hasattr(agent.llm, 'invoke'):
                response = agent.llm.invoke(prompt)
                if hasattr(response, 'content'):
                    return response.content
                return str(response)
            elif hasattr(agent.llm, 'generate'):
                response = agent.llm.generate([prompt])
                return str(response)
        
        # 无 LLM 时返回模拟结果
        return f"[{agent.name}] 已收到问题: {question[:50]}... (需要配置 LLM 或 ask_func)"


# ============================================================================
# Delegation Tools Factory
# ============================================================================


def create_delegation_tools(
    agents: List["Agent"],
    execute_task_func: Optional[Callable] = None,
    ask_func: Optional[Callable] = None,
) -> Dict[str, BaseTool]:
    """创建委派工具集
    
    便捷函数，一次性创建 DelegateWorkTool 和 AskQuestionTool。
    
    Args:
        agents: Agent 列表
        execute_task_func: 自定义任务执行函数
        ask_func: 自定义提问函数
        
    Returns:
        包含两个工具的字典: {"delegate_work": ..., "ask_question": ...}
        
    Example:
        >>> tools = create_delegation_tools(agents=[agent1, agent2])
        >>> delegate = tools["delegate_work"]
        >>> ask = tools["ask_question"]
    """
    return {
        "delegate_work": DelegateWorkTool(
            agents=agents,
            execute_task_func=execute_task_func,
        ),
        "ask_question": AskQuestionTool(
            agents=agents,
            ask_func=ask_func,
        ),
    }


__all__ = [
    # Schemas
    "DelegateWorkSchema",
    "AskQuestionSchema",
    # Context
    "DelegationContext",
    # Utilities
    "sanitize_agent_name",
    "find_agent_by_role",
    # Tools
    "DelegateWorkTool",
    "AskQuestionTool",
    # Factory
    "create_delegation_tools",
]

