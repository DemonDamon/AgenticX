from pydantic import BaseModel, Field, ConfigDict  # type: ignore
from typing import Optional, Dict, Any, List, TypeVar, Type, Callable, TYPE_CHECKING
import uuid
from datetime import datetime, timezone
import time

if TYPE_CHECKING:
    from ..hooks.llm_hooks import LLMCallHookContext
    from ..hooks.tool_hooks import ToolCallHookContext
    from .guiderails import GuideRails, GuideRailsConfig

# 类型变量，用于 fast_construct 返回正确的类型
_T = TypeVar("_T", bound="Agent")


class Agent(BaseModel):
    """
    Represents an agent in the AgenticX framework.
    
    Agent的扩展字段：
    - allow_delegation: 允许委派任务给其他 Agent
    - llm_hooks: LLM 调用钩子列表（Agent 级别）
    - tool_hooks: 工具调用钩子列表（Agent 级别）
    """
    id: str = Field(default_factory=lambda: str(uuid.uuid4()), description="Unique identifier for the agent.")
    name: str = Field(description="The name of the agent.")
    version: str = Field(default="1.0.0", description="Version of the agent.")
    role: str = Field(description="The role of the agent.")
    goal: str = Field(description="The primary goal of the agent.")
    backstory: Optional[str] = Field(description="A backstory for the agent, providing context.", default=None)
    
    llm_config_name: Optional[str] = Field(description="Name of the LLM configuration to use (reference to M13 ModelHub).", default=None)
    memory_config: Optional[Dict[str, Any]] = Field(description="Configuration for the memory system.", default_factory=dict)
    tool_names: List[str] = Field(description="List of tool names available to the agent (reference to M13 Hub).", default_factory=list)
    organization_id: str = Field(description="Organization ID for multi-tenant isolation.")
    llm: Optional[Any] = Field(description="LLM instance for the agent.", default=None)
    retrievers: Optional[Dict[str, Any]] = Field(description="Retrievers available to the agent.", default=None)
    query_patterns: Optional[Dict[str, Any]] = Field(description="Query patterns for the agent.", default=None)
    retrieval_history: Optional[List[Dict[str, Any]]] = Field(description="Retrieval history for the agent.", default_factory=list)
    query_analyzer: Optional[Any] = Field(description="Query analyzer for the agent.", default=None)
    
    # =========================================================================
    # 字段
    # =========================================================================
    
    allow_delegation: bool = Field(
        default=False,
        description="Whether this agent can delegate tasks to other agents. "
                    "When True, DelegateWorkTool and AskQuestionTool will be added."
    )
    
    llm_hooks: Optional[Dict[str, List[Callable]]] = Field(
        default=None,
        description="Agent-level LLM hooks. Keys: 'before', 'after'. "
                    "Values: List of hook functions. These are in addition to global hooks."
    )
    
    tool_hooks: Optional[Dict[str, List[Callable]]] = Field(
        default=None,
        description="Agent-level Tool hooks. Keys: 'before', 'after'. "
                    "Values: List of hook functions. These are in addition to global hooks."
    )

    guiderails: Optional["GuideRails"] = Field(
        default=None,
        description="GuideRails chain for validating or modifying agent output."
    )

    guiderails_config: Optional["GuideRailsConfig"] = Field(
        default=None,
        description="GuideRails configuration for the agent."
    )
    
    max_iterations: int = Field(
        default=25,
        description="Maximum number of iterations for agent execution loop."
    )
    
    max_retry_limit: int = Field(
        default=2,
        description="Maximum number of retries on tool/LLM errors."
    )
    
    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    # =========================================================================
    # 极速实例化方法
    # =========================================================================
    
    @classmethod
    def fast_construct(
        cls: Type[_T],
        name: str,
        role: str,
        goal: str,
        organization_id: str,
        *,
        id: Optional[str] = None,
        version: str = "1.0.0",
        backstory: Optional[str] = None,
        llm_config_name: Optional[str] = None,
        memory_config: Optional[Dict[str, Any]] = None,
        tool_names: Optional[List[str]] = None,
        llm: Optional[Any] = None,
        retrievers: Optional[Dict[str, Any]] = None,
        query_patterns: Optional[Dict[str, Any]] = None,
        retrieval_history: Optional[List[Dict[str, Any]]] = None,
        query_analyzer: Optional[Any] = None,
        # 字段
        allow_delegation: bool = False,
        llm_hooks: Optional[Dict[str, List[Callable]]] = None,
        tool_hooks: Optional[Dict[str, List[Callable]]] = None,
        guiderails: Optional["GuideRails"] = None,
        guiderails_config: Optional["GuideRailsConfig"] = None,
        max_iterations: int = 25,
        max_retry_limit: int = 2,
        _validate: bool = False,
    ) -> _T:
        """
        极速实例化方法，绕过 Pydantic 的完整校验流程。
        
        设计原理：
        - Agno 使用 `@dataclass(init=False)` 实现 3μs 的实例化速度
        - Pydantic 的 `model_construct` 可以绕过校验，直接赋值
        - 本方法在需要高性能场景时使用，默认不进行校验
        
        使用场景：
        - 大规模并行 Agent 创建（如批量任务分发）
        - 已知输入数据有效时的性能优化路径
        - 测试和基准测试
        
        Args:
            name: Agent 名称（必填）
            role: Agent 角色（必填）
            goal: Agent 目标（必填）
            organization_id: 组织 ID（必填）
            _validate: 是否进行校验（默认 False，开启后走标准 Pydantic 路径）
            其他参数: 可选配置
            
        Returns:
            Agent 实例
            
        Example:
            >>> agent = Agent.fast_construct(
            ...     name="FastMiner",
            ...     role="Research Assistant",
            ...     goal="Mine insights from data",
            ...     organization_id="org-123"
            ... )
            
        Performance:
            - fast_construct (无校验): ~1-5 μs
            - 标准构造 (有校验): ~50-200 μs
            
        Warning:
            使用此方法时，调用方需自行确保数据有效性。
            如果 _validate=False，类型错误将在运行时而非构造时暴露。
        """
        if _validate:
            # 走标准 Pydantic 构造路径（带完整校验）
            return cls(
                id=id or str(uuid.uuid4()),
                name=name,
                version=version,
                role=role,
                goal=goal,
                backstory=backstory,
                llm_config_name=llm_config_name,
                memory_config=memory_config or {},
                tool_names=tool_names or [],
                organization_id=organization_id,
                llm=llm,
                retrievers=retrievers,
                query_patterns=query_patterns,
                retrieval_history=retrieval_history or [],
                query_analyzer=query_analyzer,
                # 字段
                allow_delegation=allow_delegation,
                llm_hooks=llm_hooks,
                tool_hooks=tool_hooks,
                guiderails=guiderails,
                guiderails_config=guiderails_config,
                max_iterations=max_iterations,
                max_retry_limit=max_retry_limit,
            )
        
        # 极速路径：使用 model_construct 绕过校验
        # 这是 Pydantic V2 提供的官方快速构造方法
        return cls.model_construct(
            id=id or str(uuid.uuid4()),
            name=name,
            version=version,
            role=role,
            goal=goal,
            backstory=backstory,
            llm_config_name=llm_config_name,
            memory_config=memory_config or {},
            tool_names=tool_names or [],
            organization_id=organization_id,
            llm=llm,
            retrievers=retrievers,
            query_patterns=query_patterns,
            retrieval_history=retrieval_history or [],
            query_analyzer=query_analyzer,
            # 字段
            allow_delegation=allow_delegation,
            llm_hooks=llm_hooks,
            tool_hooks=tool_hooks,
            guiderails=guiderails,
            guiderails_config=guiderails_config,
            max_iterations=max_iterations,
            max_retry_limit=max_retry_limit,
        )
    
    @classmethod
    def measure_instantiation_time(cls, iterations: int = 1000) -> Dict[str, float]:
        """
        测量实例化耗时的辅助方法。
        
        Args:
            iterations: 测试迭代次数
            
        Returns:
            包含 fast_construct 和标准构造耗时的字典（单位：微秒）
        """
        # 测量 fast_construct
        start = time.perf_counter_ns()
        for _ in range(iterations):
            cls.fast_construct(
                name="BenchmarkAgent",
                role="Tester",
                goal="Measure performance",
                organization_id="org-bench",
            )
        fast_ns = time.perf_counter_ns() - start
        
        # 测量标准构造
        start = time.perf_counter_ns()
        for _ in range(iterations):
            cls(
                name="BenchmarkAgent",
                role="Tester",
                goal="Measure performance",
                organization_id="org-bench",
            )
        standard_ns = time.perf_counter_ns() - start
        
        return {
            "fast_construct_us": fast_ns / iterations / 1000,
            "standard_construct_us": standard_ns / iterations / 1000,
            "speedup_ratio": standard_ns / fast_ns if fast_ns > 0 else float('inf'),
            "iterations": iterations,
        }
    
    async def execute_task(self, task, context=None):
        """Execute a task using the agent's capabilities."""
        # This is a simplified implementation
        # In practice, this would use the agent's LLM and tools
        
        # For now, return a mock result
        return {
            "output": {
                "intent": "general",
                "keywords": ["task", "execution"],
                "entities": [],
                "query_type": "vector",  # Use a valid RetrievalType value
                "suggested_filters": {},
                "confidence": 0.8
            }
        }


class AgentContext(BaseModel):
    """Agent execution context"""
    agent_id: str = Field(description="Agent identifier")
    task_id: Optional[str] = Field(default=None, description="Current task identifier")
    session_id: Optional[str] = Field(default=None, description="Session identifier")
    variables: Dict[str, Any] = Field(default_factory=dict, description="Context variables")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Context creation time")
    
    model_config = ConfigDict(arbitrary_types_allowed=True)


class AgentResult(BaseModel):
    """Agent execution result"""
    agent_id: str = Field(description="Agent identifier")
    task_id: Optional[str] = Field(default=None, description="Task identifier")
    success: bool = Field(description="Whether the execution was successful")
    output: Any = Field(default=None, description="Execution output")
    error: Optional[str] = Field(default=None, description="Error message if failed")
    execution_time: Optional[float] = Field(default=None, description="Execution time in seconds")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Additional metadata")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), description="Result creation time")
    
    model_config = ConfigDict(arbitrary_types_allowed=True)
