"""Runtime core exports."""

from agenticx.runtime.confirm import AsyncConfirmGate, ConfirmGate, SyncConfirmGate
from agenticx.runtime.events import EventType, RuntimeEvent


def __getattr__(name: str):
    if name == "AgentRuntime":
        from agenticx.runtime.agent_runtime import AgentRuntime

        return AgentRuntime
    raise AttributeError(name)

__all__ = [
    "AgentRuntime",
    "ConfirmGate",
    "SyncConfirmGate",
    "AsyncConfirmGate",
    "EventType",
    "RuntimeEvent",
]
