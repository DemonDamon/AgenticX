#!/usr/bin/env python3
"""Command-line entry point: ``agx-robot-bridge serve``.

Author: Hongyi Zhao
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable
from pathlib import Path

import uvicorn

from .app import create_app
from .backend import RolloutBackend
from .security import DEFAULT_TOKEN_FILE, install_input_guard, load_or_create_token

_LOCAL_HOSTS = ("127.0.0.1", "localhost", "::1")
_DEFAULT_SNAPSHOT_DIR = "~/.agenticx/robot/snapshots"
_LOG_FILE = Path("~/.agenticx/logs/robot_bridge/bridge.log")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="agx-robot-bridge", description="Local robot policy bridge for AgenticX")
    sub = parser.add_subparsers(dest="command", required=True)
    serve = sub.add_parser("serve", help="run the bridge HTTP server on localhost")
    serve.add_argument("--host", default="127.0.0.1", help="bind address; localhost only")
    serve.add_argument("--port", type=int, default=8766)
    serve.add_argument("--backend", choices=("lerobot", "fake"), default="lerobot")
    serve.add_argument("--token-file", default=str(DEFAULT_TOKEN_FILE))
    serve.add_argument("--snapshot-dir", default=_DEFAULT_SNAPSHOT_DIR)
    return parser


def _backend_factory(name: str) -> tuple[Callable[[], RolloutBackend], str]:
    """Return ``(factory, label)``; exits with code 2 when the lerobot runtime is unusable."""
    if name == "fake":
        from .fake_backend import FakeBackend

        return FakeBackend, "fake"
    try:
        from .lerobot_backend import LeRobotBackend, check_runtime

        version = check_runtime()
    except ImportError as exc:
        print(f"未安装 lerobot extra：pip install 'agx-robot-bridge[lerobot]'（{exc}）", file=sys.stderr)
        sys.exit(2)
    return LeRobotBackend, f"lerobot {version}"


def _configure_logging(log_path: Path) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    # force=True: importing the lerobot runtime already installs a WARNING-level root handler,
    # which would otherwise turn this call into a no-op and leave bridge.log empty.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[logging.FileHandler(log_path, encoding="utf-8"), logging.StreamHandler(sys.stderr)],
        force=True,
    )


def main(argv: list[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.host not in _LOCAL_HOSTS:
        print(f"错误：--host 只允许本机地址 {', '.join(_LOCAL_HOSTS)}，收到 {args.host!r}", file=sys.stderr)
        sys.exit(2)

    install_input_guard()
    token_file = Path(args.token_file).expanduser()
    token = load_or_create_token(token_file)
    factory, backend_label = _backend_factory(args.backend)
    _configure_logging(_LOG_FILE.expanduser())

    app = create_app(
        token=token,
        backend_factory=factory,
        snapshot_dir=Path(args.snapshot_dir).expanduser(),
        backend_name=args.backend,
    )
    display_host = f"[{args.host}]" if ":" in args.host else args.host
    print(
        f"robot bridge listening on http://{display_host}:{args.port} "
        f"(backend={backend_label}, token_file={token_file})",
        file=sys.stderr,
    )
    # log_config=None keeps uvicorn's startup errors and access lines in bridge.log as well.
    uvicorn.run(
        app, host=args.host, port=args.port, log_level="info", log_config=None, timeout_graceful_shutdown=20
    )


if __name__ == "__main__":
    main()
