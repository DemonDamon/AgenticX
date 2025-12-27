"""
ToolContext: 工具执行上下文

提供工具执行时访问会话、记忆、状态等服务的能力。
借鉴 ADK 的 ToolContext 设计。
"""

from dataclasses import dataclass, field
from typing import Any, Dict, Optional, TYPE_CHECKING
from datetime import datetime, timezone
import uuid

if TYPE_CHECKING:
    from ..core.agent import AgentContext
    from ..memory.base import BaseMemory


@dataclass
class ToolContext:
    """
    工具执行上下文
    
    提供工具执行时访问各种服务和状态的能力：
    - 访问当前会话状态
    - 访问记忆服务
    - 访问 Agent 上下文
    - 工件存储（artifacts）
    
    设计参考 ADK 的 ToolContext，但适配 AgenticX 架构。
    """
    
    # 必需字段
    function_call_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    tool_name: str = ""
    
    # 可选的 Agent 上下文
    agent_context: Optional["AgentContext"] = None
    
    # 会话状态（可直接访问或通过 agent_context 访问）
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    app_name: Optional[str] = None
    
    # 状态存储
    _state: Dict[str, Any] = field(default_factory=dict)
    _artifacts: Dict[str, Any] = field(default_factory=dict)
    
    # 记忆服务引用
    _memory: Optional["BaseMemory"] = None
    
    # 元数据
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    @property
    def state(self) -> Dict[str, Any]:
        """
        访问会话状态
        
        优先从 agent_context 获取，否则使用本地 _state
        """
        if self.agent_context and hasattr(self.agent_context, 'variables'):
            return self.agent_context.variables
        return self._state
    
    @property
    def memory(self) -> Optional["BaseMemory"]:
        """访问记忆服务"""
        return self._memory
    
    @memory.setter
    def memory(self, value: "BaseMemory"):
        """设置记忆服务"""
        self._memory = value
    
    def get_state(self, key: str, default: Any = None) -> Any:
        """获取状态值"""
        return self.state.get(key, default)
    
    def set_state(self, key: str, value: Any) -> None:
        """设置状态值"""
        self.state[key] = value
    
    def update_state(self, updates: Dict[str, Any]) -> None:
        """批量更新状态"""
        self.state.update(updates)
    
    # Artifact 管理
    def save_artifact(self, name: str, data: Any, content_type: str = "application/octet-stream") -> str:
        """
        保存工件
        
        Args:
            name: 工件名称
            data: 工件数据
            content_type: 内容类型
            
        Returns:
            工件 ID
        """
        artifact_id = f"{self.function_call_id}:{name}"
        self._artifacts[artifact_id] = {
            "name": name,
            "data": data,
            "content_type": content_type,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        return artifact_id
    
    def load_artifact(self, artifact_id: str) -> Optional[Any]:
        """
        加载工件
        
        Args:
            artifact_id: 工件 ID
            
        Returns:
            工件数据，如果不存在返回 None
        """
        artifact = self._artifacts.get(artifact_id)
        return artifact.get("data") if artifact else None
    
    def list_artifacts(self) -> Dict[str, Dict[str, Any]]:
        """列出所有工件"""
        return {
            k: {"name": v["name"], "content_type": v["content_type"], "created_at": v["created_at"]}
            for k, v in self._artifacts.items()
        }
    
    # 便捷方法
    @classmethod
    def create(
        cls,
        tool_name: str,
        agent_context: Optional["AgentContext"] = None,
        session_id: Optional[str] = None,
        user_id: Optional[str] = None,
        **kwargs
    ) -> "ToolContext":
        """
        工厂方法创建 ToolContext
        
        Args:
            tool_name: 工具名称
            agent_context: Agent 上下文
            session_id: 会话 ID
            user_id: 用户 ID
            **kwargs: 其他参数
            
        Returns:
            ToolContext 实例
        """
        return cls(
            tool_name=tool_name,
            agent_context=agent_context,
            session_id=session_id or (agent_context.session_id if agent_context else None),
            user_id=user_id,
            **kwargs
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "function_call_id": self.function_call_id,
            "tool_name": self.tool_name,
            "session_id": self.session_id,
            "user_id": self.user_id,
            "app_name": self.app_name,
            "state": dict(self.state),
            "artifacts": list(self._artifacts.keys()),
            "created_at": self.created_at.isoformat(),
            "metadata": self.metadata
        }


@dataclass
class LlmRequest:
    """
    LLM 请求对象
    
    工具可以通过 process_llm_request 方法修改此对象，
    从而影响发送给 LLM 的请求内容。
    """
    
    # 消息列表
    messages: list = field(default_factory=list)
    
    # 工具声明列表
    tools: list = field(default_factory=list)
    
    # 系统提示
    system_prompt: Optional[str] = None
    
    # 生成参数
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    top_p: Optional[float] = None
    
    # 模型配置
    model: Optional[str] = None
    
    # 其他参数
    extra_params: Dict[str, Any] = field(default_factory=dict)
    
    def append_tools(self, tools: list) -> None:
        """添加工具声明"""
        self.tools.extend(tools)
    
    def append_message(self, role: str, content: str) -> None:
        """添加消息"""
        self.messages.append({"role": role, "content": content})
    
    def set_system_prompt(self, prompt: str) -> None:
        """设置系统提示"""
        self.system_prompt = prompt
    
    def append_system_prompt(self, additional: str) -> None:
        """追加系统提示"""
        if self.system_prompt:
            self.system_prompt = f"{self.system_prompt}\n\n{additional}"
        else:
            self.system_prompt = additional
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式（用于 LLM 调用）"""
        result = {
            "messages": self.messages.copy(),
            "temperature": self.temperature,
        }
        
        if self.system_prompt:
            # 插入系统消息
            result["messages"].insert(0, {"role": "system", "content": self.system_prompt})
        
        if self.tools:
            result["tools"] = self.tools
        
        if self.max_tokens:
            result["max_tokens"] = self.max_tokens
        
        if self.top_p:
            result["top_p"] = self.top_p
        
        if self.model:
            result["model"] = self.model
        
        result.update(self.extra_params)
        
        return result

