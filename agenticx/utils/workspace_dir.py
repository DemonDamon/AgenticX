"""工作区目录的统一解析。

历史写法是 ``Path.cwd()``：进程从哪个目录启动，产物就落到哪儿。表现出来是两件事——
跑测试会在仓库根目录留下 ``memory/``；把服务从别的目录拉起来，上一份工作区记忆就
"不见了"（其实是又建了一份空的）。

这里不改默认语义（仍然是 cwd，CLI 场景下用户确实就在自己的项目里），只是把它收成
一个可覆盖的入口：测试和容器部署可以用 ``AGENTICX_WORKSPACE_DIR`` 指到别处，而不必
去 chdir 整个进程。

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path

WORKSPACE_DIR_ENV = "AGENTICX_WORKSPACE_DIR"


def resolve_workspace_dir(explicit: str | os.PathLike[str] | None = None) -> Path:
    """Resolve the workspace root: explicit > ``$AGENTICX_WORKSPACE_DIR`` > cwd."""
    if explicit:
        return Path(explicit).expanduser().resolve(strict=False)
    override = str(os.environ.get(WORKSPACE_DIR_ENV, "") or "").strip()
    if override:
        return Path(override).expanduser().resolve(strict=False)
    return Path.cwd()
