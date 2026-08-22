"""把取回来的技能包落到临时目录，供扫描器读取。

这一层是唯一接触外部不可信内容的地方，所以路径和体积都在这里挡住：注册表返回的
文件名来自公网，直接 join 就能用 `../` 写到目录外面去。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


class UnsafeBundleError(Exception):
    """技能包本身有问题，还没轮到扫描规则就该拒绝。"""


@dataclass(frozen=True)
class MaterializedBundle:
    root: Path
    file_count: int
    total_bytes: int


def _safe_target(root: Path, name: str) -> Path:
    """解析包内文件名，确保落点仍在 root 之内。"""
    cleaned = name.replace("\\", "/").strip()
    if not cleaned or cleaned.startswith("/"):
        raise UnsafeBundleError(f"unsafe entry name: {name!r}")
    target = (root / cleaned).resolve()
    root_resolved = root.resolve()
    # 用 resolve 之后比较前缀，能同时挡住 ../ 和符号链接指出去。
    if target != root_resolved and root_resolved not in target.parents:
        raise UnsafeBundleError(f"entry escapes the bundle root: {name!r}")
    return target


def materialize(files: Mapping[str, bytes], root: Path, *, max_total_bytes: int) -> MaterializedBundle:
    """写出包内容，超限就中止。

    体积上限是防 zip bomb 的那一半——注册表给的是已解出的字节，所以这里按累计总量
    截断即可，不需要再判压缩比。
    """
    total = 0
    count = 0
    for name, payload in files.items():
        total += len(payload)
        if total > max_total_bytes:
            raise UnsafeBundleError(
                f"bundle exceeds {max_total_bytes} bytes; refusing to materialize"
            )
        target = _safe_target(root, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as handle:
            handle.write(payload)
        os.chmod(target, 0o600)
        count += 1
    return MaterializedBundle(root=root, file_count=count, total_bytes=total)
