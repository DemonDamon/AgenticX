"""``~/.agenticx`` 下各类路径的**惰性**解析。

为什么需要这个模块：仓库里有二十多处写成模块级常量

    AVATARS_ROOT = Path.home() / ".agenticx" / "avatars"

``Path.home()`` 在 import 那一刻就被求值定死。tests/conftest.py 把 ``$HOME`` 指到沙箱是
**用例开始时**才生效的，而这些模块在收集阶段早就 import 完了——于是测试数据直接写进开发
者真实的 ``~/.agenticx``。实测一轮全量测试会在真实目录里新增 171 个条目：133 个 avatar、
65 个 group，其中一个目录名就叫
``<MagicMock name='mock.bound_avatar_id' id='5080543248'>``。这些还会出现在桌面端的
数字专家 / 项目群列表里。

用法（每个模块三行）：

    from agenticx.utils.agx_home import agx_home, lazy_home_path

    def _avatars_root() -> Path:
        return lazy_home_path(__name__, "AVATARS_ROOT", "avatars")

    def __getattr__(name):                      # PEP 562，给外部读取用
        if name == "AVATARS_ROOT":
            return agx_home() / "avatars"
        raise AttributeError(name)

模块内部一律改调 ``_avatars_root()``：PEP 562 的 ``__getattr__`` 只拦「对模块对象取属性」，
拦不住模块自己函数里的全局名查找。

Author: Damon Li
"""

from __future__ import annotations

import sys
from pathlib import Path


def agx_home() -> Path:
    """``~/.agenticx``，按调用时的 HOME 解析。"""
    return Path.home() / ".agenticx"


def lazy_home_path(module_name: str, attr: str, *parts: str) -> Path:
    """解析 ``~/.agenticx/<parts>``，但允许模块属性覆盖。

    覆盖那一档是给既有测试留的：``monkeypatch.setattr("...registry.AVATARS_ROOT", tmp)``
    会往模块 ``__dict__`` 里塞值，这里优先读它；撤销后自动回到按 HOME 解析。
    """
    override = sys.modules[module_name].__dict__.get(attr)
    if override is not None:
        return Path(override)
    return agx_home().joinpath(*parts)
