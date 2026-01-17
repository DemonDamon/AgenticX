"""
OWL 角色扮演模式实现

参考：OWL (Optimized Workforce Learning) 的增强角色扮演机制
来源：owl/utils/enhanced_role_playing.py

核心思想：
- User Agent: 负责任务分解，生成指令（格式：Instruction: ...）
- Assistant Agent: 负责工具调用和执行
- 每轮对话注入任务上下文，防止偏离目标
- 显式终止标记：TASK_DONE
"""

import time
import logging
from typing import List, Tuple, Optional, Dict, Any
from copy import deepcopy

from ..core.agent import Agent
from ..core.agent_executor import AgentExecutor
from ..core.task import Task
from ..core.message import Message
from .base import BaseCollaborationPattern, CollaborationResult
from .config import RolePlayingConfig
from .enums import CollaborationStatus
from .prompts.role_playing_prompts import RolePlayingPrompts

logger = logging.getLogger(__name__)


class RolePlayingPattern(BaseCollaborationPattern):
    """角色扮演模式（OWL 增强机制）
    
    支持 User Agent 和 Assistant Agent 的双向对话，显式任务分解。
    User Agent 负责任务分解，Assistant Agent 负责工具调用和执行。
    """
    
    def __init__(
        self,
        agents: List[Agent],
        config: RolePlayingConfig,
        llm_provider=None,
        **kwargs
    ):
        """
        初始化角色扮演模式
        
        Args:
            agents: 智能体列表（必须包含 2 个：user_agent 和 assistant_agent）
            config: 角色扮演配置
            llm_provider: LLM 提供者
            **kwargs: 额外参数
        """
        # 验证 agents 数量
        if len(agents) != 2:
            raise ValueError(
                f"RolePlayingPattern requires exactly 2 agents (user and assistant), "
                f"got {len(agents)}"
            )
        
        super().__init__(agents, config)
        
        # 验证配置
        if not isinstance(config, RolePlayingConfig):
            raise ValueError("config must be an instance of RolePlayingConfig")
        
        # 查找 User Agent 和 Assistant Agent
        self.user_agent = None
        self.assistant_agent = None
        
        for agent in agents:
            if agent.id == config.user_agent_id:
                self.user_agent = agent
            elif agent.id == config.assistant_agent_id:
                self.assistant_agent = agent
        
        if self.user_agent is None:
            raise ValueError(f"User agent with ID '{config.user_agent_id}' not found in agents list")
        if self.assistant_agent is None:
            raise ValueError(f"Assistant agent with ID '{config.assistant_agent_id}' not found in agents list")
        
        # 保存任务描述（在执行时设置）
        self.task_prompt: Optional[str] = None
        
        # 创建 AgentExecutor
        self.user_executor = AgentExecutor(llm_provider=llm_provider)
        self.assistant_executor = AgentExecutor(llm_provider=llm_provider)
        
        # 保存 LLM provider
        self.llm_provider = llm_provider
        
        logger.info(
            f"[初始化] RolePlayingPattern, user: {self.user_agent.name}, "
            f"assistant: {self.assistant_agent.name}"
        )
    
    def execute(self, task: str, **kwargs) -> CollaborationResult:
        """
        执行角色扮演协作任务
        
        Args:
            task: 任务描述
            **kwargs: 额外参数
            
        Returns:
            CollaborationResult: 协作结果
        """
        logger.info(f"[执行] RolePlayingPattern, 任务: {task}")
        start_time = time.time()
        self.update_state(status=CollaborationStatus.RUNNING)
        
        # 保存任务描述
        self.task_prompt = task
        
        try:
            # 初始化对话历史
            chat_history = []
            current_round = 0
            round_limit = self.config.round_limit
            
            # 初始化 User Agent 和 Assistant Agent 的系统 Prompt
            user_system_prompt = RolePlayingPrompts.get_user_system_prompt(task)
            assistant_system_prompt = RolePlayingPrompts.get_assistant_system_prompt(task)
            
            # 设置系统 Prompt（通过修改 Agent 的 goal/backstory）
            # 注意：AgenticX 的 Agent 模型可能不支持直接设置系统 Prompt
            # 这里我们通过修改 Agent 的 goal 来传递系统 Prompt
            original_user_goal = self.user_agent.goal
            original_assistant_goal = self.assistant_agent.goal
            
            # 临时修改 goal 以传递系统 Prompt
            # 在实际实现中，可能需要通过其他方式传递系统 Prompt
            # 这里假设 AgentExecutor 会使用 Agent 的 goal 作为系统 Prompt 的一部分
            
            # 创建初始任务
            init_prompt = """
Now please give me instructions to solve over overall task step by step. If the task requires some specific knowledge, please instruct me to use tools to complete the task.
"""
            
            # 创建初始任务对象
            init_task = Task(
                description=init_prompt,
                expected_output="User instruction",
                context={"task": task, "system_prompt": user_system_prompt}
            )
            
            # 第一轮：User Agent 生成初始指令
            user_result = self.user_executor.run(self.user_agent, init_task)
            user_response_content = self._extract_result_content(user_result)
            
            if not user_result.get("success", False):
                raise RuntimeError(f"User agent failed: {user_result.get('error', 'Unknown error')}")
            
            # 主循环：User 和 Assistant 交替对话
            assistant_msg_content = user_response_content
            
            while current_round < round_limit:
                current_round += 1
                self.state.current_iteration = current_round
                
                logger.info(f"[角色扮演] 第 {current_round} 轮对话")
                
                # Assistant Agent 执行指令
                assistant_task = Task(
                    description=assistant_msg_content,
                    expected_output="Assistant response with tool calls",
                    context={
                        "task": task,
                        "system_prompt": assistant_system_prompt,
                        "round": current_round
                    }
                )
                
                # 注入任务上下文
                if self.config.enable_context_injection:
                    assistant_task.description = self._inject_task_context(
                        assistant_task.description,
                        is_task_done=False
                    )
                
                assistant_result = self.assistant_executor.run(self.assistant_agent, assistant_task)
                assistant_response_content = self._extract_result_content(assistant_result)
                
                if not assistant_result.get("success", False):
                    logger.warning(f"Assistant agent failed: {assistant_result.get('error', 'Unknown error')}")
                    # 继续执行，让 User Agent 处理错误
                
                # 记录对话历史
                chat_history.append({
                    "round": current_round,
                    "user": assistant_msg_content,
                    "assistant": assistant_response_content,
                    "tool_calls": self._extract_tool_calls(assistant_result)
                })
                
                # User Agent 生成下一步指令
                user_task = Task(
                    description=assistant_response_content,
                    expected_output="User instruction or TASK_DONE",
                    context={
                        "task": task,
                        "system_prompt": user_system_prompt,
                        "round": current_round,
                        "conversation_history": chat_history
                    }
                )
                
                # 注入 User Agent 的后续指令提示
                user_task.description = RolePlayingPrompts.inject_user_followup(
                    user_task.description,
                    task
                )
                
                user_result = self.user_executor.run(self.user_agent, user_task)
                user_response_content = self._extract_result_content(user_result)
                
                if not user_result.get("success", False):
                    logger.warning(f"User agent failed: {user_result.get('error', 'Unknown error')}")
                    break
                
                # 检查终止条件
                if self._check_termination(user_response_content):
                    logger.info(f"[角色扮演] 任务完成（第 {current_round} 轮）")
                    break
                
                # 更新 assistant_msg_content 为下一轮准备
                assistant_msg_content = user_response_content
            
            # 如果达到最大轮数，提取最终答案
            if current_round >= round_limit:
                logger.warning(f"[角色扮演] 达到最大轮数 {round_limit}，强制终止")
            
            # 提取最终答案（最后一轮 Assistant 的响应）
            final_answer = assistant_response_content if chat_history else "No response generated"
            
            # 如果任务完成，要求 Assistant 给出最终答案
            if self._check_termination(user_response_content):
                final_task = Task(
                    description=RolePlayingPrompts.inject_task_context(
                        "Please provide the final answer.",
                        task,
                        is_task_done=True
                    ),
                    expected_output="Final answer",
                    context={"task": task}
                )
                final_result = self.assistant_executor.run(self.assistant_agent, final_task)
                if final_result.get("success", False):
                    final_answer = self._extract_result_content(final_result)
            
            execution_time = time.time() - start_time
            
            # 恢复原始 goal
            self.user_agent.goal = original_user_goal
            self.assistant_agent.goal = original_assistant_goal
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=True,
                result=final_answer,
                execution_time=execution_time,
                iteration_count=current_round,
                agent_contributions={
                    "user_agent": {
                        "rounds": current_round,
                        "instructions": [h["user"] for h in chat_history]
                    },
                    "assistant_agent": {
                        "rounds": current_round,
                        "responses": [h["assistant"] for h in chat_history],
                        "tool_calls": [h["tool_calls"] for h in chat_history]
                    }
                },
                metadata={
                    "chat_history": chat_history,
                    "task": task,
                    "round_limit": round_limit
                }
            )
            
        except Exception as e:
            execution_time = time.time() - start_time
            self.update_state(status=CollaborationStatus.FAILED)
            logger.error(f"[异常] RolePlayingPattern 执行失败: {e}", exc_info=True)
            
            return CollaborationResult(
                collaboration_id=self.collaboration_id,
                success=False,
                error=str(e),
                execution_time=execution_time,
                iteration_count=self.state.current_iteration
            )
    
    def _inject_task_context(self, message_content: str, is_task_done: bool = False) -> str:
        """
        注入任务上下文到消息内容
        
        Args:
            message_content: 原始消息内容
            is_task_done: 是否任务已完成
            
        Returns:
            注入上下文后的消息内容
        """
        if not self.task_prompt:
            return message_content
        
        return RolePlayingPrompts.inject_task_context(
            message_content,
            self.task_prompt,
            is_task_done=is_task_done
        )
    
    def _check_termination(self, user_response: str) -> bool:
        """
        检查是否应该终止
        
        Args:
            user_response: User Agent 的响应
            
        Returns:
            是否应该终止
        """
        if not self.config.enable_task_done_detection:
            return False
        
        # 检查 TASK_DONE 标记
        if "TASK_DONE" in user_response.upper():
            return True
        
        # 检查最大轮数（在 execute 方法中处理）
        return False
    
    def _extract_result_content(self, result: Dict[str, Any]) -> str:
        """
        从 AgentExecutor 结果中提取内容
        
        Args:
            result: AgentExecutor.run() 返回的结果字典
            
        Returns:
            提取的内容字符串
        """
        if not result.get("success", False):
            return result.get("error", "Execution failed")
        
        # 尝试从不同位置提取内容
        content = result.get("result", "")
        if isinstance(content, str):
            return content
        
        # 如果 result 是字典，尝试提取文本
        if isinstance(content, dict):
            return str(content.get("output", content))
        
        return str(content)
    
    def _extract_tool_calls(self, result: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        从 AgentExecutor 结果中提取工具调用
        
        Args:
            result: AgentExecutor.run() 返回的结果字典
            
        Returns:
            工具调用列表
        """
        tool_calls = []
        
        # 从 event_log 中提取工具调用
        event_log = result.get("event_log")
        if event_log:
            # 假设 event_log 有 get_events_by_type 方法
            if hasattr(event_log, "get_events_by_type"):
                tool_events = event_log.get_events_by_type("tool_call")
                for event in tool_events:
                    if hasattr(event, "tool_name") and hasattr(event, "parameters"):
                        tool_calls.append({
                            "tool_name": event.tool_name,
                            "parameters": event.parameters
                        })
        
        return tool_calls
