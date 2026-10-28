"""Webhook notifier with an in-memory sink for tests."""

from __future__ import annotations

from typing import Callable, List, Union

from agenticx.managed.templates.data_suite.types import WebhookEvent

Sink = Union["FakeWebhookSink", Callable[[WebhookEvent], None]]


class FakeWebhookSink:
    def __init__(self) -> None:
        self.events: List[WebhookEvent] = []

    def post(self, event: WebhookEvent) -> None:
        self.events.append(event)


class WebhookNotifier:
    def __init__(self, sink: Sink) -> None:
        self._sink = sink

    def emit(self, kind: str, **payload) -> None:
        event = WebhookEvent(kind=kind, payload=dict(payload))
        if isinstance(self._sink, FakeWebhookSink):
            self._sink.post(event)
        else:
            self._sink(event)
