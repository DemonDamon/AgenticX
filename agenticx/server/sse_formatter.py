"""
SSE 事件格式化器

将 AgenticX 内部事件转换为 SSE 事件格式（24 种事件类型）。

参考：
- backend/app/model/chat.py:145-147 (SSE 格式化函数)
- Eigent 前端架构设计
"""

import json
from typing import Any, Dict, Optional
from enum import Enum
import logging

from ..collaboration.workforce.events import WorkforceEvent, WorkforceAction

logger = logging.getLogger(__name__)


class SSEEvent(str, Enum):
    """SSE 事件类型（24 种）"""
    # 任务生命周期
    CONFIRMED = "confirmed"
    DECOMPOSE_TEXT = "decompose_text"
    TO_SUB_TASKS = "to_sub_tasks"
    END = "end"
    ERROR = "error"
    
    # Agent 生命周期
    CREATE_AGENT = "create_agent"
    ACTIVATE_AGENT = "activate_agent"
    DEACTIVATE_AGENT = "deactivate_agent"
    
    # 任务状态
    TASK_STATE = "task_state"
    ASSIGN_TASK = "assign_task"
    NEW_TASK_STATE = "new_task_state"
    
    # 工具调用
    ACTIVATE_TOOLKIT = "activate_toolkit"
    DEACTIVATE_TOOLKIT = "deactivate_toolkit"
    
    # 交互
    WAIT_CONFIRM = "wait_confirm"
    ASK = "ask"
    NOTICE = "notice"
    
    # 文件操作
    WRITE_FILE = "write_file"
    TERMINAL = "terminal"
    
    # 错误和限制
    BUDGET_NOT_ENOUGH = "budget_not_enough"
    CONTEXT_TOO_LONG = "context_too_long"
    
    # 队列管理
    ADD_TASK = "add_task"
    REMOVE_TASK = "remove_task"
    
    # 其他
    SYNC = "sync"


def format_sse_event(step: str, data: Any) -> str:
    """格式化 SSE 事件
    
    参考：backend/app/model/chat.py:145-147
    
    Args:
        step: 事件步骤
        data: 事件数据（dict 或 str）
        
    Returns:
        SSE 格式字符串：`data: {json}\n\n`
    """
    if isinstance(data, str):
        # end 事件可能是字符串
        res_format = {"step": step, "data": data}
    else:
        res_format = {"step": step, "data": data}
    
    return f"data: {json.dumps(res_format, ensure_ascii=False)}\n\n"


class SSEFormatter:
    """SSE 事件格式化器
    
    将 WorkforceEvent 转换为 SSE 格式。
    
    参考：Eigent 前端架构设计
    """
    
    # WorkforceAction -> SSEEvent 映射表
    ACTION_MAPPING: Dict[WorkforceAction, SSEEvent] = {
        WorkforceAction.DECOMPOSE_START: SSEEvent.DECOMPOSE_TEXT,
        WorkforceAction.DECOMPOSE_PROGRESS: SSEEvent.DECOMPOSE_TEXT,
        WorkforceAction.DECOMPOSE_COMPLETE: SSEEvent.TO_SUB_TASKS,
        WorkforceAction.AGENT_ACTIVATED: SSEEvent.ACTIVATE_AGENT,
        WorkforceAction.AGENT_DEACTIVATED: SSEEvent.DEACTIVATE_AGENT,
        WorkforceAction.TASK_ASSIGNED: SSEEvent.ASSIGN_TASK,
        WorkforceAction.TOOLKIT_ACTIVATED: SSEEvent.ACTIVATE_TOOLKIT,
        WorkforceAction.TOOLKIT_DEACTIVATED: SSEEvent.DEACTIVATE_TOOLKIT,
        WorkforceAction.TASK_COMPLETED: SSEEvent.TASK_STATE,
        WorkforceAction.TASK_FAILED: SSEEvent.TASK_STATE,
        WorkforceAction.WORKFORCE_STOPPED: SSEEvent.END,
    }
    
    def format_event(self, workforce_event: WorkforceEvent) -> Optional[str]:
        """将 WorkforceEvent 转换为 SSE 格式
        
        Args:
            workforce_event: Workforce 事件
            
        Returns:
            SSE 格式字符串，如果不支持则返回 None
        """
        # 查找映射
        sse_step = self.ACTION_MAPPING.get(workforce_event.action)
        if not sse_step:
            logger.debug(
                f"[SSEFormatter] No mapping for action={workforce_event.action.value}, "
                f"skipping event"
            )
            return None
        
        # 转换数据
        sse_data = self._convert_data(workforce_event, sse_step)
        
        # 格式化
        return format_sse_event(sse_step.value, sse_data)
    
    def _convert_data(
        self,
        workforce_event: WorkforceEvent,
        sse_step: SSEEvent
    ) -> Dict[str, Any]:
        """转换事件数据
        
        Args:
            workforce_event: Workforce 事件
            sse_step: SSE 事件类型
            
        Returns:
            转换后的数据字典
        """
        data = workforce_event.data.copy()
        
        # 根据事件类型进行特定转换
        if sse_step == SSEEvent.DECOMPOSE_TEXT:
            # decompose_text: {content: string}
            return {
                "content": data.get("content", data.get("text", "")),
            }
        
        elif sse_step == SSEEvent.TO_SUB_TASKS:
            # to_sub_tasks: {sub_tasks: TaskInfo[], summary_task: string}
            return {
                "sub_tasks": data.get("sub_tasks", []),
                "summary_task": data.get("summary_task", data.get("summary", "")),
            }
        
        elif sse_step == SSEEvent.ACTIVATE_AGENT:
            # activate_agent: {state, agent_id, process_task_id, tokens, agent_name, message}
            return {
                "state": "running",
                "agent_id": workforce_event.agent_id or data.get("agent_id", ""),
                "process_task_id": workforce_event.task_id or data.get("task_id", ""),
                "tokens": data.get("tokens", 0),
                "agent_name": data.get("agent_name", ""),
                "message": data.get("message", ""),
            }
        
        elif sse_step == SSEEvent.DEACTIVATE_AGENT:
            # deactivate_agent: {state, agent_id, process_task_id, tokens, agent_name, message}
            return {
                "state": "completed",
                "agent_id": workforce_event.agent_id or data.get("agent_id", ""),
                "process_task_id": workforce_event.task_id or data.get("task_id", ""),
                "tokens": data.get("tokens", 0),
                "agent_name": data.get("agent_name", ""),
                "message": data.get("message", ""),
            }
        
        elif sse_step == SSEEvent.ASSIGN_TASK:
            # assign_task: {assignee_id, task_id, content, state, failure_count}
            return {
                "assignee_id": workforce_event.agent_id or data.get("assignee_id", ""),
                "task_id": workforce_event.task_id or data.get("task_id", ""),
                "content": data.get("content", data.get("description", "")),
                "state": data.get("state", "waiting"),
                "failure_count": data.get("failure_count", 0),
            }
        
        elif sse_step == SSEEvent.ACTIVATE_TOOLKIT:
            # activate_toolkit: {agent_name, toolkit_name, method_name, message, process_task_id}
            return {
                "agent_name": data.get("agent_name", ""),
                "toolkit_name": data.get("toolkit_name", data.get("tool_name", "")),
                "method_name": data.get("method_name", data.get("method", "")),
                "message": data.get("message", ""),
                "process_task_id": workforce_event.task_id or data.get("task_id", ""),
            }
        
        elif sse_step == SSEEvent.DEACTIVATE_TOOLKIT:
            # deactivate_toolkit: {agent_name, toolkit_name, method_name, message, process_task_id}
            return {
                "agent_name": data.get("agent_name", ""),
                "toolkit_name": data.get("toolkit_name", data.get("tool_name", "")),
                "method_name": data.get("method_name", data.get("method", "")),
                "message": data.get("message", ""),
                "process_task_id": workforce_event.task_id or data.get("task_id", ""),
            }
        
        elif sse_step == SSEEvent.TASK_STATE:
            # task_state: {state, task_id, result, failure_count}
            state = "DONE" if workforce_event.action == WorkforceAction.TASK_COMPLETED else "FAILED"
            return {
                "state": state,
                "task_id": workforce_event.task_id or data.get("task_id", ""),
                "result": data.get("result", data.get("content", "")),
                "failure_count": data.get("failure_count", 0),
            }
        
        elif sse_step == SSEEvent.END:
            # end: {summary: string} or just string
            summary = data.get("summary", data.get("result", ""))
            return {"summary": summary}
        
        else:
            # 其他事件类型，直接使用原始数据
            return data
    
    def format_custom_event(self, step: SSEEvent, data: Dict[str, Any]) -> str:
        """格式化自定义事件（不来自 WorkforceEvent）
        
        Args:
            step: SSE 事件类型
            data: 事件数据
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(step.value, data)
    
    def format_error(self, message: str) -> str:
        """格式化错误事件
        
        Args:
            message: 错误消息
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.ERROR.value,
            {"message": message}
        )
    
    def format_confirmed(self, question: str) -> str:
        """格式化 confirmed 事件
        
        Args:
            question: 用户问题
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.CONFIRMED.value,
            {"question": question}
        )
    
    def format_wait_confirm(self, content: str, question: str) -> str:
        """格式化 wait_confirm 事件（简单问题直接回答）
        
        Args:
            content: 回答内容
            question: 用户问题
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.WAIT_CONFIRM.value,
            {
                "content": content,
                "question": question,
            }
        )
    
    def format_create_agent(
        self,
        agent_name: str,
        agent_id: str,
        tools: list
    ) -> str:
        """格式化 create_agent 事件
        
        Args:
            agent_name: Agent 名称
            agent_id: Agent ID
            tools: 工具列表
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.CREATE_AGENT.value,
            {
                "agent_name": agent_name,
                "agent_id": agent_id,
                "tools": tools,
            }
        )
    
    def format_write_file(self, file_path: str) -> str:
        """格式化 write_file 事件
        
        Args:
            file_path: 文件路径
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.WRITE_FILE.value,
            {"file_path": file_path}
        )
    
    def format_terminal(self, process_task_id: str, output: str) -> str:
        """格式化 terminal 事件
        
        Args:
            process_task_id: 处理任务 ID
            output: 终端输出
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.TERMINAL.value,
            {
                "process_task_id": process_task_id,
                "output": output,
            }
        )
    
    def format_notice(self, notice: str, process_task_id: str = "") -> str:
        """格式化 notice 事件
        
        Args:
            notice: 通知内容
            process_task_id: 处理任务 ID
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.NOTICE.value,
            {
                "notice": notice,
                "process_task_id": process_task_id,
            }
        )
    
    def format_ask(
        self,
        agent: str,
        content: str,
        question: str,
        answer: str = ""
    ) -> str:
        """格式化 ask 事件
        
        Args:
            agent: Agent 名称
            content: 内容
            question: 问题
            answer: 答案（可选）
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.ASK.value,
            {
                "agent": agent,
                "content": content,
                "question": question,
                "answer": answer,
            }
        )
    
    def format_budget_not_enough(self) -> str:
        """格式化 budget_not_enough 事件
        
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.BUDGET_NOT_ENOUGH.value,
            {}
        )
    
    def format_context_too_long(self, current_length: int, max_length: int) -> str:
        """格式化 context_too_long 事件
        
        Args:
            current_length: 当前长度
            max_length: 最大长度
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.CONTEXT_TOO_LONG.value,
            {
                "current_length": current_length,
                "max_length": max_length,
            }
        )
    
    def format_add_task(self, project_id: str, task_id: str, content: str) -> str:
        """格式化 add_task 事件
        
        Args:
            project_id: 项目 ID
            task_id: 任务 ID
            content: 任务内容
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.ADD_TASK.value,
            {
                "project_id": project_id,
                "task_id": task_id,
                "content": content,
            }
        )
    
    def format_remove_task(self, project_id: str, task_id: str) -> str:
        """格式化 remove_task 事件
        
        Args:
            project_id: 项目 ID
            task_id: 任务 ID
            
        Returns:
            SSE 格式字符串
        """
        return format_sse_event(
            SSEEvent.REMOVE_TASK.value,
            {
                "project_id": project_id,
                "task_id": task_id,
            }
        )
