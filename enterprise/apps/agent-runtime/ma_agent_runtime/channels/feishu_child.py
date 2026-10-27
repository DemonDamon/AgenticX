#!/usr/bin/env python3
"""Child process: hold one Feishu long connection and print events as JSON lines.

Protocol: one JSON line on stdin {"app_id","app_secret","domain"}; then stdout lines
{"kind":"event","body":<event dict>} for each im.message.receive_v1 event.
Logs go to stderr only.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import sys

import lark_oapi as lark


def main() -> int:
    """Read one config line and block on the Feishu websocket client."""
    logging.basicConfig(stream=sys.stderr, level=logging.INFO)
    cfg = json.loads(sys.stdin.readline())

    def on_message(data: object) -> None:
        body = json.loads(lark.JSON.marshal(data))
        sys.stdout.write(json.dumps({"kind": "event", "body": body}, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    handler = lark.EventDispatcherHandler.builder("", "").register_p2_im_message_receive_v1(on_message).build()
    lark.ws.Client(
        cfg["app_id"],
        cfg["app_secret"],
        event_handler=handler,
        domain=cfg["domain"],
        log_level=lark.LogLevel.INFO,
    ).start()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
