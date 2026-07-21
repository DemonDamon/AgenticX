# agenticx-sdk (Python) 模块总结

> 结论生成时间：2026-07-21（基于源码核验重写）

## 模块概述

`agenticx-sdk`（Python 包）当前仍是**纯脚手架 stub**——`pyproject.toml` 声明了依赖与构建配置，但 `src/agenticx_sdk/__init__.py` 只导出 `__version__ = "0.1.0"`，**无任何运行时代码**（无 client、无类型、无测试）。README 仅说明安装方式。

## 目录结构

```
packages/sdk-py/
├── pyproject.toml            # agenticx-sdk 0.1.0，requires-python>=3.10
├── README.md                 # 安装命令（pip install -e packages/sdk-py）
└── src/agenticx_sdk/
    └── __init__.py           # 仅 __version__ = "0.1.0"
```

## 关键导出

只有：`__version__ = "0.1.0"`

## 显著模式

- `requires-python = ">=3.10"`
- 依赖：`httpx>=0.27`（异步 HTTP）+ `pydantic>=2.0`（类型化 model）—— **暗示规划方向是 async HTTP + 类型化 model**，与 `sdk-ts` 的 `HttpChatClient` 思路对齐，但**尚未落地**
- 构建走 `setuptools.packages.find` + `src/` 布局
- 无 `tests/`、无 `client.py`、无 `types.py`——`sdk-ts` 已有的 `ChatClient`/`HttpChatClient`/SSE 解析在 Python 侧**一行对应实现都没有**

## 状态

**尚未实现** —— 仅占位 stub，等待后续按 `sdk-ts` 模式补 Python 实现（async httpx + pydantic models + SSE 流式 + cancel）。

## 与 Enterprise 其他模块的关系

| 关联 | 形态 | 说明 |
|---|---|---|
| `packages/sdk-ts` | 对应物 | 计划提供等价的 Python 实现（接口形态可参考） |
| Python 端业务集成 | 目标消费者 | 给 Python 应用 / 脚本 / Machi 桌面 Python 侧接 enterprise gateway 用 |
