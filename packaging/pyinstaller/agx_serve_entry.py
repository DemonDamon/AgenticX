#!/usr/bin/env python3
"""Standalone entry point for AgenticX Studio server (PyInstaller bundle).

Author: Damon Li
"""

from __future__ import annotations

import argparse
import ctypes
import importlib
import os
import sys
import time

# LiteLLM otherwise tries to refresh optional model-pricing metadata from
# GitHub during import. The bundled Desktop must boot from the packaged backup
# even when public-network access is slow, filtered, or completely unavailable.
os.environ["LITELLM_LOCAL_MODEL_COST_MAP"] = "true"


def _log_stage(msg: str) -> None:
    """Emit a startup timeline marker to stderr.

    The Electron launcher buffers stderr and prints the tail when the backend
    fails to become ready in time — stage markers pinpoint which step hung
    instead of showing only the last library warning.
    """
    elapsed = time.monotonic() - _START_T0
    print(f"[agx-server {elapsed:7.1f}s] {msg}", file=sys.stderr, flush=True)


_START_T0 = time.monotonic()
_log_stage(f"bootloader handoff complete (argv={' '.join(sys.argv[1:])})")


def _suppress_macos_dock_icon() -> None:
    """Prevent headless server process from showing a dock icon on macOS."""
    if sys.platform != "darwin":
        return
    try:
        objc = ctypes.cdll.LoadLibrary("/usr/lib/libobjc.A.dylib")
        objc.objc_getClass.restype = ctypes.c_void_p
        objc.sel_registerName.restype = ctypes.c_void_p
        objc.objc_msgSend.restype = ctypes.c_void_p
        objc.objc_msgSend.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        ns_app = objc.objc_msgSend(
            objc.objc_getClass(b"NSApplication"),
            objc.sel_registerName(b"sharedApplication"),
        )
        objc.objc_msgSend.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_int64,
        ]
        objc.objc_msgSend(
            ns_app,
            objc.sel_registerName(b"setActivationPolicy:"),
            2,
        )
    except Exception:
        pass


def _check_desktop_runtime() -> int:
    """Verify that bundled desktop runtime modules can be imported."""
    required = ("chromadb", "onnxruntime", "numpy")
    missing: list[str] = []
    for name in required:
        try:
            importlib.import_module(name)
        except Exception as exc:
            missing.append(f"{name}: {type(exc).__name__}: {exc}")

    pdf_ok = False
    for pdf_mod in ("fitz", "pypdf"):
        try:
            importlib.import_module(pdf_mod)
            pdf_ok = True
            break
        except Exception:
            pass
    if not pdf_ok:
        missing.append("pdf: no fitz (PyMuPDF) or pypdf importable")

    import os

    proxy_blob = "".join(
        str(os.environ.get(k, ""))
        for k in ("ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy")
    ).lower()
    if "socks" in proxy_blob:
        try:
            importlib.import_module("socksio")
        except Exception as exc:
            missing.append(f"socksio: {type(exc).__name__}: {exc}")

    if missing:
        print("Desktop runtime dependency check failed:", file=sys.stderr)
        for item in missing:
            print(f"- {item}", file=sys.stderr)
        return 1

    print("Desktop runtime dependency check passed")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="AgenticX Studio Server (bundled)")
    parser.add_argument("--host", default="127.0.0.1", help="Listen host")
    parser.add_argument("--port", type=int, default=8000, help="Listen port")
    parser.add_argument(
        "--check-desktop-runtime",
        action="store_true",
        help="Verify bundled desktop runtime dependencies and exit",
    )
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print version and exit",
    )
    args = parser.parse_args()

    if args.check_desktop_runtime:
        raise SystemExit(_check_desktop_runtime())

    if args.version:
        try:
            from agenticx._version import __version__

            print(__version__)
        except Exception:
            print("0.0.0")
        raise SystemExit(0)

    _suppress_macos_dock_icon()

    # `agx-server` is a CLI bootstrap name so agenticx/__init__ does not dump
    # GraphRAG / Neo4j / observability into every cold start. Core must be
    # imported first, otherwise studio → tools.base → core/__init__ hits a
    # circular import with agent_executor.
    _log_stage("importing agenticx.core")
    import agenticx.core  # noqa: F401
    _log_stage("importing agenticx.studio.server (heavy import chain)")
    from agenticx.studio.server import create_studio_app
    import uvicorn
    _log_stage("studio server module imported")

    app = create_studio_app()
    _log_stage("create_studio_app() done, starting uvicorn")

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
