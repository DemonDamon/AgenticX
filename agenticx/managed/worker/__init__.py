#!/usr/bin/env python3
"""Desktop worker SDK for Managed Agents.

Author: Damon Li
"""

from agenticx.managed.worker.broker import IngestSink, RemoteActionBroker
from agenticx.managed.worker.client import (
    MAWorkerClient,
    MAWorkerError,
    WorkAssignment,
    WorkLeaseLostError,
    WorkerAuthError,
)
from agenticx.managed.worker.runner import MAWorker, WorkItemRunner

__all__ = [
    "IngestSink",
    "MAWorker",
    "MAWorkerClient",
    "MAWorkerError",
    "RemoteActionBroker",
    "WorkAssignment",
    "WorkItemRunner",
    "WorkLeaseLostError",
    "WorkerAuthError",
]
