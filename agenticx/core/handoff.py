"""
Handoff 机制实现（参考自 AIGNE Framework）

提供 Agent 间切换的特殊返回类型和事件处理，支持：
- HandoffOutput: 触发 agent 切换的特殊返回类型
- AgentHandoffEvent: Handoff 事件（用于 EventBus 发布）
- AgentHandoffError: Handoff 相关异常
- Coordinator 集成辅助函数
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Literal
import logging
import uuid

from pydantic import BaseModel, ConfigDict, Field

from .event import Event


logger = logging.getLogger(__name__)


class HandoffOutput(BaseModel):
    """
    Special return type to trigger agent handoff.
    
    When an agent returns a HandoffOutput, the coordinator/executor
    should intercept it and transfer control to the target agent.
    
    Reference: AIGNE Framework isTransferAgentOutput
    
    Example:
        >>> def agent_action(context):
        ...     if needs_specialist:
        ...         return HandoffOutput(
        ...             target_agent_name="SpecialistAgent",
        ...             reason="Task requires domain expertise",
        ...             payload={"context": context}
        ...         )
        ...     return normal_result
    """

    target_agent_id: Optional[str] = Field(
        default=None,
        description="Target agent ID for the handoff.",
    )
    target_agent_name: Optional[str] = Field(
        default=None,
        description="Target agent name for the handoff.",
    )
    reason: Optional[str] = Field(
        default=None,
        description="Reason for the handoff decision.",
    )
    payload: Optional[Any] = Field(
        default=None,
        description="Optional payload to pass to the next agent.",
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata for handoff handling.",
    )

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def ensure_target(self) -> None:
        """Validate that a target agent is specified."""
        if not self.target_agent_id and not self.target_agent_name:
            raise ValueError("HandoffOutput requires target_agent_id or target_agent_name.")

    def get_target_identifier(self) -> str:
        """Get the best available target identifier."""
        return self.target_agent_id or self.target_agent_name or "unknown"


class AgentHandoffEvent(Event[Literal["agent_handoff"]]):
    """
    Event fired when an agent handoff occurs.
    
    This event is published to the EventBus when control is transferred
    from one agent to another. Subscribers can use this for:
    - Logging and observability
    - Workflow coordination
    - State synchronization
    """
    type: Literal["agent_handoff"] = "agent_handoff"
    
    source_agent_id: Optional[str] = Field(
        default=None,
        description="ID of the agent initiating the handoff."
    )
    source_agent_name: Optional[str] = Field(
        default=None,
        description="Name of the agent initiating the handoff."
    )
    target_agent_id: Optional[str] = Field(
        default=None,
        description="ID of the target agent."
    )
    target_agent_name: Optional[str] = Field(
        default=None,
        description="Name of the target agent."
    )
    reason: Optional[str] = Field(
        default=None,
        description="Reason for the handoff."
    )
    payload: Optional[Any] = Field(
        default=None,
        description="Payload passed to the target agent."
    )
    handoff_chain: List[str] = Field(
        default_factory=list,
        description="Chain of agent IDs in this handoff sequence (for cycle detection)."
    )


class AgentHandoffError(Exception):
    """Exception raised when handoff processing fails."""
    
    def __init__(
        self,
        message: str,
        source_agent_id: Optional[str] = None,
        target_agent_id: Optional[str] = None,
        reason: Optional[str] = None
    ):
        super().__init__(message)
        self.source_agent_id = source_agent_id
        self.target_agent_id = target_agent_id
        self.reason = reason


class HandoffCycleError(AgentHandoffError):
    """Exception raised when a handoff cycle is detected."""
    
    def __init__(self, cycle_chain: List[str]):
        self.cycle_chain = cycle_chain
        message = f"Handoff cycle detected: {' -> '.join(cycle_chain)}"
        super().__init__(message)


class HandoffTargetNotFoundError(AgentHandoffError):
    """Exception raised when the target agent cannot be found."""
    
    def __init__(self, target_identifier: str):
        self.target_identifier = target_identifier
        message = f"Handoff target agent not found: {target_identifier}"
        super().__init__(message, target_agent_id=target_identifier)


def is_handoff_output(value: Any) -> bool:
    """Check if a value is a HandoffOutput instance."""
    return isinstance(value, HandoffOutput)


def parse_handoff_output(value: Any) -> Optional[HandoffOutput]:
    """
    Parse a value into HandoffOutput if possible.
    
    Supports:
    - Direct HandoffOutput instances
    - Dict with "handoff" key containing handoff data
    - Dict with "target_agent_id" or "target_agent_name" keys
    
    Args:
        value: Value to parse
        
    Returns:
        HandoffOutput if parsing succeeds, None otherwise
    """
    if isinstance(value, HandoffOutput):
        return value
    if isinstance(value, dict):
        handoff_data = None
        if "handoff" in value and isinstance(value["handoff"], dict):
            handoff_data = value["handoff"]
        elif "target_agent_id" in value or "target_agent_name" in value:
            handoff_data = value
        if handoff_data is not None:
            try:
                return HandoffOutput(**handoff_data)
            except Exception as e:
                logger.warning(f"Failed to parse handoff data: {e}")
    return None


def create_handoff_event(
    handoff: HandoffOutput,
    source_agent_id: Optional[str] = None,
    source_agent_name: Optional[str] = None,
    task_id: Optional[str] = None,
    handoff_chain: Optional[List[str]] = None
) -> AgentHandoffEvent:
    """
    Create an AgentHandoffEvent from a HandoffOutput.
    
    Args:
        handoff: The HandoffOutput triggering this event
        source_agent_id: ID of the source agent
        source_agent_name: Name of the source agent
        task_id: Current task ID
        handoff_chain: Chain of agents in this handoff sequence
        
    Returns:
        AgentHandoffEvent ready for publishing
    """
    chain = list(handoff_chain) if handoff_chain else []
    if source_agent_id and source_agent_id not in chain:
        chain.append(source_agent_id)
    
    # Add target agent to chain for cycle detection
    target_id = handoff.target_agent_id or handoff.target_agent_name
    if target_id and target_id not in chain:
        chain.append(target_id)
    
    return AgentHandoffEvent(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc),
        agent_id=source_agent_id,
        task_id=task_id,
        source_agent_id=source_agent_id,
        source_agent_name=source_agent_name,
        target_agent_id=handoff.target_agent_id,
        target_agent_name=handoff.target_agent_name,
        reason=handoff.reason,
        payload=handoff.payload,
        handoff_chain=chain,
        data={
            "metadata": handoff.metadata,
        }
    )


def check_handoff_cycle(
    target_agent_id: str,
    handoff_chain: List[str],
    max_chain_length: int = 10
) -> None:
    """
    Check for handoff cycles and excessive chain length.
    
    Args:
        target_agent_id: The target agent being handed off to
        handoff_chain: Current chain of handoffs
        max_chain_length: Maximum allowed chain length
        
    Raises:
        HandoffCycleError: If a cycle is detected or chain is too long
    """
    if target_agent_id in handoff_chain:
        cycle_start = handoff_chain.index(target_agent_id)
        cycle = handoff_chain[cycle_start:] + [target_agent_id]
        raise HandoffCycleError(cycle)
    
    if len(handoff_chain) >= max_chain_length:
        raise HandoffCycleError(
            handoff_chain + [target_agent_id]
        )
