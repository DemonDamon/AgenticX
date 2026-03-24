#!/usr/bin/env python3
"""Standalone entry point for AgenticX Studio server (PyInstaller bundle).

Author: Damon Li
"""

from __future__ import annotations

import argparse
import ctypes
import os
import sys


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


def main() -> None:
    parser = argparse.ArgumentParser(description="AgenticX Studio Server (bundled)")
    parser.add_argument("--host", default="127.0.0.1", help="Listen host")
    parser.add_argument("--port", type=int, default=8000, help="Listen port")
    parser.add_argument(
        "--version",
        action="store_true",
        help="Print version and exit",
    )
    args = parser.parse_args()

    if args.version:
        try:
            from agenticx._version import __version__

            print(__version__)
        except Exception:
            print("0.0.0")
        raise SystemExit(0)

    _suppress_macos_dock_icon()

    from agenticx.studio.server import create_studio_app
    import uvicorn

    app = create_studio_app()
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
