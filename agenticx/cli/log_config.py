"""CLI logging configuration helpers.

Author: Damon Li
"""
from __future__ import annotations

import logging
import sys


def configure_cli_logging(debug: bool = False) -> None:
    """Configure logging for CLI commands.

    In normal mode (debug=False): suppress INFO/DEBUG logs from agenticx internals.
    In debug mode: show all logs at DEBUG level.
    """
    level = logging.DEBUG if debug else logging.WARNING

    # Configure stdlib logging for agenticx.* namespace
    agenticx_logger = logging.getLogger("agenticx")
    agenticx_logger.setLevel(level)
    # Silence root logger propagation noise
    root_logger = logging.getLogger()
    if not root_logger.handlers:
        root_logger.addHandler(logging.NullHandler())

    # Configure loguru — used by ark_provider, bailian_provider, etc.
    try:
        from loguru import logger as loguru_logger  # type: ignore
        # Remove all existing loguru sinks
        loguru_logger.remove()
        if debug:
            # Re-add stderr sink at DEBUG level
            loguru_logger.add(
                sys.stderr,
                level="DEBUG",
                format="<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - <level>{message}</level>",
            )
        # If not debug: no sinks -> loguru is completely silent
    except ImportError:
        pass  # loguru not installed, nothing to do
