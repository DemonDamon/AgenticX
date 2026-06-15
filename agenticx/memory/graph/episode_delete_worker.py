#!/usr/bin/env python3
"""Subprocess CLI: delete one memory-graph episode (SIGSEGV containment).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import sys


async def _run(episode_uuid: str) -> int:
    try:
        from agenticx.memory.graph.episode_delete import remove_episode_in_fresh_store

        await remove_episode_in_fresh_store(episode_uuid)
        return 0
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    if len(args) != 1 or not str(args[0]).strip():
        print(
            "usage: python -m agenticx.memory.graph.episode_delete_worker <episode_uuid>",
            file=sys.stderr,
        )
        return 2
    return asyncio.run(_run(str(args[0]).strip()))


if __name__ == "__main__":
    raise SystemExit(main())
