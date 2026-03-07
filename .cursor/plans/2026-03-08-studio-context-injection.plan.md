---
name: ""
overview: ""
todos: []
isProject: false
---

# Studio 上下文注入能力

## 概述

为 `agx studio` 增加上下文注入能力，解决两个核心缺陷：

1. 生成的代码不在对话上下文中，LLM 无法对已生成代码进行分析/回答
2. 无法像 Cursor 的 `@` 那样引用外部文件，缺少代码上下文注入机制

## 成功标准

- CHAT/QUESTION 对话时，LLM 能看到 session 中所有已生成的 artifacts 代码
- 用户可通过 `@path/to/file` 语法在输入中内联引用外部文件
- 用户可通过 `/ctx add|list|remove|clear` 命令手动管理上下文文件
- 上下文文件同时对对话回复和代码生成生效
- 快照/撤销（/undo）正确包含 context_files 状态

## 改动范围

### agenticx/cli/studio.py

- StudioSession 增加 `context_files: Dict[str, str]` 字段
- StudioSnapshot 增加 `context_files` 字段，_take_snapshot/_restore_last_snapshot 同步保存/恢复
- 新增 `_build_context_block()` — 将 artifacts + context_files 拼接为 LLM 可读的上下文块
- 新增 `_resolve_at_references()` — 解析 `@path` 和 `@path:行号-行号` 引用，自动读取文件内容
- `_chat_reply()` 注入 context_block 到 system prompt
- 主循环中代码生成 context 注入 `reference_files`
- 新增 `/ctx add|list|remove|clear` 命令处理
- 主循环中意图分类前调用 `_resolve_at_references()`
- `_print_header()` 命令表和欢迎语更新

### agenticx/cli/codegen_engine.py

- `_build_user_prompt()` 处理 `reference_files` 上下文，排除 key 列表更新

### docs/cli.md

- 新增「上下文注入」章节

## 非目标

- 不做目录递归扫描（`@dir/` 不展开）
- 不做 glob 匹配（`@**/*.py` 不支持）
- 大文件截断阈值暂定 10000 字符，后续可配置化

