"""所有 provider 的 astream 都必须能直接 `async for`。

仓库里几乎所有调用点都是这么写的：

    async for token in self.llm_provider.astream(messages):   # agent_executor.py
    async for chunk in self._primary.astream(prompt, **kwargs):  # failover.py

但有一半实现写成了 `async def astream(...): return async_gen` —— 调用方拿到的是**协程**，
`async for` 直接 TypeError: 'async for' requires an object with __aiter__。Ark / Bailian /
Failover 是真异步生成器（内部 yield）所以没事，LiteLLM / Zhipu / Kimi 和基类抽象签名不是。
也就是说走 LiteLLM 这条线的异步流式在 agent_executor 里是断的。

这条用例把契约钉死：不看实现怎么写，只看「调用之后能不能 async for」。

Author: Damon Li
"""

from __future__ import annotations

import inspect

import pytest


def _astream_of(cls):
    for klass in cls.__mro__:
        if "astream" in klass.__dict__:
            return klass.__dict__["astream"]
    raise AssertionError(f"{cls.__name__} 没有 astream")


def _provider_classes():
    import importlib

    out = []
    for mod, name in [
        ("agenticx.llms.litellm_provider", "LiteLLMProvider"),
        ("agenticx.llms.zhipu_provider", "ZhipuProvider"),
        ("agenticx.llms.kimi_provider", "KimiProvider"),
        ("agenticx.llms.ark_provider", "ArkLLMProvider"),
        ("agenticx.llms.bailian_provider", "BailianProvider"),
        ("agenticx.llms.failover", "FailoverProvider"),
    ]:
        try:
            out.append((name, getattr(importlib.import_module(mod), name)))
        except Exception as exc:  # 可选依赖缺失时跳过该 provider，而不是整份用例挂掉
            out.append((name, exc))
    return out


@pytest.mark.parametrize("name,cls", _provider_classes(), ids=lambda v: v if isinstance(v, str) else "")
def test_astream_is_not_a_coroutine_function(name, cls) -> None:
    if isinstance(cls, Exception):
        pytest.skip(f"{name} 不可导入：{cls}")
    fn = _astream_of(cls)
    assert not inspect.iscoroutinefunction(fn), (
        f"{name}.astream 是 async def 且 return 了生成器 —— 调用方拿到协程，"
        "`async for` 会 TypeError。要么内部 yield（真异步生成器），"
        "要么写成普通 def 直接返回生成器。"
    )


def test_base_contract_is_not_async_def() -> None:
    """基类的抽象签名也得是普通 def，否则子类会照着写成 async def。"""
    from agenticx.llms.base import BaseLLMProvider

    assert not inspect.iscoroutinefunction(BaseLLMProvider.__dict__["astream"])


@pytest.mark.asyncio
async def test_async_for_works_end_to_end() -> None:
    """真正 async for 一遍，不只是看签名。"""
    from agenticx.llms.litellm_provider import LiteLLMProvider

    provider = LiteLLMProvider(model="gpt-4o-mini")

    async def _fake_gen(*_a, **_k):
        for chunk in ("a", "b", "c"):
            yield chunk

    provider._astream_generator = _fake_gen  # type: ignore[method-assign]
    out = "".join([chunk async for chunk in provider.astream("hi")])
    assert out == "abc"
