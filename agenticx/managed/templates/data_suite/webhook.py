"""Webhook notifier with in-memory and HTTP sinks."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Callable, List, Union

from agenticx.managed.templates.data_suite.types import WebhookEvent

Sink = Union["FakeWebhookSink", "HttpWebhookSink", Callable[[WebhookEvent], None]]


class FakeWebhookSink:
    def __init__(self) -> None:
        self.events: List[WebhookEvent] = []

    def post(self, event: WebhookEvent) -> None:
        self.events.append(event)


class HttpWebhookSink:
    """POST JSON ``{kind, payload}`` to an HTTP webhook URL (stdlib urllib)."""

    def __init__(self, url: str, *, timeout: float = 5.0) -> None:
        self.url = url
        self.timeout = timeout
        self.events: List[WebhookEvent] = []

    def post(self, event: WebhookEvent) -> None:
        body = json.dumps(
            {"kind": event.kind, "payload": dict(event.payload)},
            ensure_ascii=False,
        ).encode("utf-8")
        req = urllib.request.Request(
            self.url,
            data=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        # Keep a local copy for tests / run_patrol_tick evidence even if POST fails later.
        self.events.append(event)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            resp.read()


class WebhookNotifier:
    def __init__(self, sink: Sink) -> None:
        self._sink = sink

    def emit(self, kind: str, **payload) -> None:
        event = WebhookEvent(kind=kind, payload=dict(payload))
        if isinstance(self._sink, (FakeWebhookSink, HttpWebhookSink)):
            self._sink.post(event)
        else:
            self._sink(event)
