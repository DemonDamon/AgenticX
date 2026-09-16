"""Runtime core exports."""

from agenticx.runtime.clarify import AsyncClarifyGate, AutoSuspendClarifyGate, ClarifyGate
from agenticx.runtime.confirm import (
    CONFIRM_RISK_LOW,
    PROTECTED_CONFIRM_RISKS,
    AutoApproveConfirmGate,
    AsyncConfirmGate,
    ConfirmGate,
    RiskAwareAutoConfirmGate,
    SyncConfirmGate,
    confirm_denial_note,
    is_protected_confirm,
    normalize_confirm_risk,
    protected_confirm_reason,
)
from agenticx.runtime.events import EventType, RuntimeEvent
from agenticx.runtime.scratchpad import Scratchpad
from agenticx.runtime.todo_manager import TodoManager


def __getattr__(name: str):
    if name == "AgentRuntime":
        from agenticx.runtime.agent_runtime import AgentRuntime

        return AgentRuntime
    if name == "AgentTeamManager":
        from agenticx.runtime.team_manager import AgentTeamManager

        return AgentTeamManager
    if name == "SubAgentContext":
        from agenticx.runtime.team_manager import SubAgentContext

        return SubAgentContext
    if name == "SubAgentStatus":
        from agenticx.runtime.team_manager import SubAgentStatus

        return SubAgentStatus
    if name == "ResourceMonitor":
        from agenticx.runtime.resource_monitor import ResourceMonitor

        return ResourceMonitor
    if name == "META_AGENT_TOOLS":
        from agenticx.runtime.meta_tools import META_AGENT_TOOLS

        return META_AGENT_TOOLS
    if name == "dispatch_meta_tool_async":
        from agenticx.runtime.meta_tools import dispatch_meta_tool_async

        return dispatch_meta_tool_async
    if name == "LoopController":
        from agenticx.runtime.loop_controller import LoopController

        return LoopController
    if name == "AutoSolveMode":
        from agenticx.runtime.auto_solve import AutoSolveMode

        return AutoSolveMode
    if name == "SpawnConfig":
        from agenticx.runtime.team_manager import SpawnConfig

        return SpawnConfig
    raise AttributeError(name)

__all__ = [
    "AgentRuntime",
    "ConfirmGate",
    "SyncConfirmGate",
    "AsyncConfirmGate",
    "AutoApproveConfirmGate",
    "RiskAwareAutoConfirmGate",
    "CONFIRM_RISK_LOW",
    "PROTECTED_CONFIRM_RISKS",
    "normalize_confirm_risk",
    "is_protected_confirm",
    "protected_confirm_reason",
    "confirm_denial_note",
    "ClarifyGate",
    "AsyncClarifyGate",
    "AutoSuspendClarifyGate",
    "EventType",
    "RuntimeEvent",
    "TodoManager",
    "Scratchpad",
    "AgentTeamManager",
    "SubAgentContext",
    "SubAgentStatus",
    "ResourceMonitor",
    "META_AGENT_TOOLS",
    "dispatch_meta_tool_async",
    "LoopController",
    "AutoSolveMode",
    "SpawnConfig",
]
