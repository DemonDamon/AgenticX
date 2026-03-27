# Fix: @ 引用文件路径解析 Bug

**Plan-Id:** 2026-03-27-fix-at-reference-file-path-resolution  
**Date:** 2026-03-27  
**Status:** Completed

---

## Problem Statement

用户在 Desktop 聊天输入框中通过 `@` 引用工作区文件时，传给模型的只有文件名（basename），
而非完整绝对路径。导致模型调用 `file_read` 时用 basename 在分身默认 workspace 下查找，
找不到文件，随后发起全盘 `find` 搜索（超时），再用 `mdfind` 才定位到文件。

### 复现日志摘要

```
用户: 解析下 @RAG-MCP：通过RAG缓解大模型工具选择中的提示膨胀问题_2025.05_北邮.pdf
模型: file_read("/Users/.../avatars/a808d6da18d1/workspace/RAG-MCP...pdf") → file not found
模型: find /Users/damon -name "RAG-MCP*" → timeout after 30s
模型: mdfind -name "RAG-MCP" → 找到 /Users/damon/myWork/myBlog/RAG-MCP...pdf
```

---

## Root Cause Analysis

### 根因一：Desktop `sendChat` 丢失绝对路径

`ChatPane.tsx` 中 `addContextFile` 函数将文件按绝对路径 key 存入 `contextFiles` state，
但 `sendChat` 构造 `context_files` payload 时，遍历 `userAttachments`（`MessageAttachment[]`），
该类型只有 `name` 字段（已被 `key.split("/").pop()` 截断为 basename），导致发给后端的
`context_files` 的 key 只有文件名，内容也是占位符 `[附件] filename` 而非真实内容。

**路径丢失位置：**
- `addContextFile`（1492 行）：`name: key.split("/").pop() || key` — name 被截为 basename
- `sendChat`（2190-2196 行）：`contextFilePayload[file.name]` — 用 name（basename）作 key
- 同时 value 写的是 `[附件] filename` 占位符，不是文件内容

### 根因二：Meta Agent 系统提示不注入 `context_files` 内容

`meta_agent.py` 的 `build_meta_agent_system_prompt` 只写了
`已注入 context_files 数量: N`，没有将文件路径和内容注入系统提示。
模型无法感知用户引用了哪些文件及其完整路径，只能尝试 `file_read(basename)`。

（对比：CLI 默认模式的 `_build_agent_system_prompt` 会调用 `_serialize_context_files`
展开全文，Studio Meta Agent 路径漏掉了这一逻辑。）

---

## Functional Requirements

- FR-1：用户 `@` 引用工作区文件时，`context_files` 必须以**绝对路径**为 key，以**文件真实内容**为 value 发给后端
- FR-2：Meta Agent 系统提示必须展示 `context_files` 的完整路径和内容摘要，让模型无需调用 `file_read` 即可直接处理文件
- FR-3：Retry 场景（`retryAttachments` 非空时 `contextFiles` 已清空）需 fallback 到 `MessageAttachment.name`，不能报错

## Non-Functional Requirements

- NFR-1：`AttachedFile.name` 保持 basename，不改 UI 展示逻辑（chip 显示文件名不变）
- NFR-2：每个 context_file 内容截断在 4000 字符以内，避免超出 context 窗口
- NFR-3：改动最小化，不影响图片附件、重试逻辑、分身委派等已有功能

## Acceptance Criteria

- AC-1：`@ 引用工作区文件 → context_files key = 绝对路径` 可验证
- AC-2：Meta Agent 系统提示包含 `--- /绝对路径 ---\n内容` 格式
- AC-3：模型不再去分身 workspace 找文件，不再发起全盘 `find`
- AC-4：图片附件、文件 chip UI 展示、retry 功能不受影响

---

## Implementation

### 改动文件

| 文件 | 改动说明 |
|------|---------|
| `desktop/src/components/ChatPane.tsx` | 修复 `sendChat` 中 `context_files` 构造逻辑 |
| `agenticx/runtime/prompts/meta_agent.py` | 注入 context_files 内容到 Meta Agent 系统提示 |

### 详细改动

#### ChatPane.tsx（Fix 1）

在 `sendChat` 函数顶部，从 `attachmentEntries`（包含 `[absolutePath, AttachedFile]`）
过滤 ready 条目为 `readyEntries`，在构造 `context_files` 时：

- key 用绝对路径（`filePath`）
- value 用 `file.content`（文件真实内容），图片用 `[图片文件]`
- Retry fallback：`readyEntries` 为空时退化为旧逻辑（用 `file.name`）

#### meta_agent.py（Fix 2）

新增 `_build_context_files_block(session)` 函数：
- `context_files` 为空时返回 `(none)` 占位
- 非空时逐个展开 `--- path ---\n内容（截断 4000 字符）`
- 末尾附提示文案："上述文件路径为绝对路径，可直接用于 file_read"

替换原有 `已注入 context_files 数量: N` 为 `_build_context_files_block(session)` 调用。

---

## Conclusion

两处根因分别在前端（路径被截断 + 传占位符而非内容）和后端（系统提示不展开 context_files），
联合修复后，`@ 引用文件 → 绝对路径 + 内容 → 模型系统提示可见` 的链路完整打通。
