# Desktop 文本/MD 附件正文丢失导致模型“视而不见”修复

Planned-with: kimi-k3（Cursor）
Plan-Id: 2026-08-11-desktop-text-attachment-context-loss

## 背景与根因

用户反馈（复现会话 `d70afcc7-931b-4191-8995-a531e9782114`）：在 Desktop 拖入一个 `.md` 附件后发送，气泡上能看到附件卡片、后端「文件管理」里也有该文件，但模型回复“我没有看到她反驳的内容”。证据链：

1. **气泡/历史里的附件只是元数据**。`messages.json` 中该用户消息 `attachments` 含 `name/source_path/size`，但模型当轮收到的 `agent_messages.json` 用户消息 `content` 只有一句「她来反驳我了，还用gpt 5.6-luna 你来降维打击下」，正文不在 user 消息里（这是设计：文本附件走 system prompt 的 `context_files`，不进 user 气泡）。
2. **正文在组装 `context_files` payload 时丢失**。`desktop/src/components/ChatPane.tsx:8001-8038` 的 `materializeSessionAttachments` 把落盘文本附件的 `sourcePath` 重写为 `~/.agenticx/taskspaces/<sid>/default/attachments/<name>`；随后 `8410-8426` 组装 `contextFilePayload` 时用 `resolveReadyAttachment(file, readyEntries)` 匹配重写后的行——`buildContextFileKeyFromAttachment` 用的是新 `sourcePath`，而 `readyEntries` 里 `AttachedFile` 仍是上传时的原始 key（`file.name:size:lastModified` 或拖拽临时路径），匹配失败 → 走 `else` 分支写入占位符 `[附件] <name>`（无正文）。
3. **后端兜底对白名单外的扩展名不生效**。`agenticx/studio/server.py:2660-2666` 本应通过 `rehydrate_session_text_context_files` 把 `[附件] ` 占位符从可读绝对路径回填正文（key 已是绝对路径，`_is_readable_abs_file(key)` 命中），但实测该轮请求体里 value 已是占位符、key 是 taskspaces 绝对路径时，`context_stats.jsonl` 的 prompt token 增量（约 +1595 ≈ 5.5k 字符）表明正文实际被注入——**因此根因收敛为：模型在长 system prompt 中漏读 `context_files` 条目，且 `agent_runtime` 不在 user 消息里带附件名/路径提示，模型没有动机去 system 里翻找**。

根因定位（单一改动点）：

- **主因（必修）**：`agent_runtime.run_turn` 里 `user_content` 只取 `user_message_content`（图片）或 `user_input` 原文；当本轮 `turn_context_files` 非空时，没有任何「用户本轮带了哪些文件」的信号进入 user 消息，模型在 tool-use 型回合里容易忽略 system 里的 `### 用户引用的文件（context_files）` 块。
- **次因（加固）**：Desktop 组装 `contextFilePayload` 时 `resolveReadyAttachment` 失配会静默降级为占位符，依赖后端 rehydrate 兜底，但 rehydrate 依赖「key 是可读绝对路径」——Desktop 任何把 key 改写成非路径形态（如 dedupe key、相对名）都会让兜底失效，正文彻底丢失。

## In scope / Out of scope

**In scope**
- 当轮 `turn_context_files` 非空时，在发给模型的 user 消息尾部追加一行「已附文件」清单（文件名 + 可读绝对路径），让模型明确知道该去读 `context_files` 里的哪个条目。
- Desktop 组装 `contextFilePayload` 时若 `ready` 失配且无 `snippetContent`、最终只能写入 `[附件] ` 占位符，补一条 `console.warn` 让这种「正文丢失」在 devtools 可观测（不改行为、不新增 IPC）。

**Out of scope（明确不做）**
- 不改 `hydrate_turn_context_files` 的 `ALLOWED_EXTENSIONS`——`.md` 正文在 system prompt 中按纯文本序列化本就能被模型读到，问题不在白名单，而在「模型是否知道该看哪条」。
- 不改 `messages.json` 的附件持久化结构，不改「文件管理」Tab 的展示。
- 不重排 `build_meta_agent_system_prompt` 中 `_build_context_files_block` 的位置（仍处于 system 中段）。
- 不修改任何 enterprise/ 代码。

## 需求

### FR-1 模型 user 消息携带「已附文件」提示

`agenticx/runtime/agent_runtime.py` 中 `run_turn` 方法，在组装 `user_content` 处（约 L2937-2948，`user_content = user_message_content if user_message_content is not None else user_input` 与 `messages.append({"role": "user", "content": user_content})`）：

- 新增一个模块级辅助函数 `_build_attached_files_hint(session) -> str`：读取 `session.context_files`（dict[str, str]），过滤掉 `skill:` / `@dir:` 前缀与值为 `[图片...]`/`[视频]`/`[附件解析失败]` 的条目，对剩余每个 key 取 `os.path.basename(key)` 作为展示名；若 `session.context_files` 为空或无有效条目，返回空字符串。
- 返回非空时，格式为：
  ```
  \n\n[已附文件]
  - 对《Near对话_Near_16-21.pdf》的回复.md（/Users/.../default/attachments/对《Near对话_Near_16-21.pdf》的回复.md）
  上述文件内容已在 system prompt 的 context_files 节中给出，请直接阅读并基于其回答。
  ```
- 将该 hint 拼接到 `user_content`：若 `user_content` 是字符串，`user_content = user_content + hint`；若 `user_content` 是 list（含图片的多模态块），在 list 末尾追加 `{"type": "text", "text": hint}`（hint 以 `\n\n` 开头，与图片块共存安全）。
- **不影响** `session.chat_history` 里持久化的用户消息（`history_user_content` / `_history_text` 仍只存用户原文，不写 hint）——hint 只进模型上下文，不进 UI 历史。

before（`agent_runtime.py` 约 L2937-2938）：

```python
        user_content: Any = user_message_content if user_message_content is not None else user_input
        messages.append({"role": "user", "content": user_content})
```

after：

```python
        user_content: Any = user_message_content if user_message_content is not None else user_input
        attached_hint = _build_attached_files_hint(session)
        if attached_hint:
            if isinstance(user_content, str):
                user_content = f"{user_content}{attached_hint}"
            elif isinstance(user_content, list):
                user_content = list(user_content) + [{"type": "text", "text": attached_hint}]
        messages.append({"role": "user", "content": user_content})
```

`_build_attached_files_hint` 放在 `_serialize_context_files`（约 L885-888）之后，完整实现：

```python
def _build_attached_files_hint(session: StudioSession) -> str:
    """Build a user-message hint listing this turn's attached text/document files.

    Files live in system prompt context_files; this hint makes their presence
    explicit at the user-turn level so tool-using models actually read them.
    """
    cf = getattr(session, "context_files", None)
    if not isinstance(cf, dict) or not cf:
        return ""
    lines: list[str] = []
    for key, value in cf.items():
        k = str(key or "").strip()
        v = str(value or "").strip()
        if not k or k.startswith("skill:") or k.startswith("@dir:"):
            continue
        if v.startswith("[图片") or v.startswith("[视频]") or v.startswith("[附件解析失败]"):
            continue
        name = os.path.basename(k.replace("\\", "/")) or k
        lines.append(f"- {name}（{k}）")
    if not lines:
        return ""
    return (
        "\n\n[已附文件]\n"
        + "\n".join(lines)
        + "\n上述文件内容已在 system prompt 的 context_files 节中给出，请直接阅读并基于其回答。"
    )
```

注意：文件顶部需 `import os`（`agent_runtime.py` 已 `import os`，无需新增 import 行，仅确认）。

### FR-2 Desktop `contextFilePayload` 正文丢失可观测性

`desktop/src/components/ChatPane.tsx:8410-8430`。**已确认无读文件 IPC**（`grep -nE 'readFileText|readTextFile|fsReadText|readFile\(|readText\(' desktop/src/global.d.ts desktop/electron/preload.ts desktop/electron/main.ts` 无匹配），故本 FR 不尝试直读落盘文件、不新增 IPC，仅补可观测性。

改动点（`ChatPane.tsx:8419-8426`）：

before：

```ts
          const fromFile =
            String(file.snippetContent || "").trim() ||
            String(ready?.snippetContent || "").trim() ||
            String(ready?.content || "").trim();
          if (fromFile) {
            contextFilePayload[key] = fromFile;
          } else {
            contextFilePayload[key] = `[附件] ${file.name}`;
          }
```

after（已确认无读文件 IPC，仅加 warn 可观测性，不改行为）：

```ts
          const fromFile =
            String(file.snippetContent || "").trim() ||
            String(ready?.snippetContent || "").trim() ||
            String(ready?.content || "").trim();
          if (fromFile) {
            contextFilePayload[key] = fromFile;
          } else {
            // materializeSessionAttachments rewrote sourcePath after parse;
            // resolveReadyAttachment then misses readyEntries and the body is
            // lost. Warn so this silent degradation is observable in devtools.
            console.warn(
              "[ChatPane] attachment body lost after materialize, key=",
              key,
              "sourcePath=",
              file.sourcePath,
            );
            contextFilePayload[key] = `[附件] ${file.name}`;
          }
```

## 验收标准

**AC-1（FR-1，模型层提示注入）**：新增 `tests/test_agent_runtime_attached_hint.py`：
- 构造 `StudioSession(context_files={"/abs/对.md": "正文"})`，调用 `build_meta_agent_system_prompt` 或直接调 `_build_attached_files_hint`，断言返回串含 `[已附文件]`、`对.md` 与绝对路径。
- 空 dict / 仅 `skill:` / 仅 `[图片...]` 条目时返回 `""`。
- 在 `run_turn` 级测试：mock `ProviderResolver` 返回固定回复，发送 `user_input="看下这个"`、`session.context_files={"/abs/a.md": "body"}`，断言最终发给 provider 的 `messages[-1]["content"]`（或 `user_content` 字符串分支）包含 `[已附文件]` 与 `a.md`；同时断言 `session.chat_history[-1]["content"]` **不含** `[已附文件]`（UI 历史不被污染）。
- 运行：`python -m pytest tests/test_agent_runtime_attached_hint.py -v` 全绿。

**AC-2（FR-2，可观测性）**：`cd desktop && npx tsc --noEmit` 无新增错误；手工在 devtools console 发送一个 `.md` 附件，能看到（或看不到，取决于是否失配）`[ChatPane] attachment body lost after materialize` 警告——该测试仅验证 warn 不抛错、不影响发送流程。

**AC-3（端到端回归）**：在 Desktop 拖入一个 `.md` 附件发送，模型回复中应直接引用该 MD 内容（不再出现「没有看到附件内容」类表述）。手工验收：准备一份含独特字符串（如 `UNIQUE_STRING_42`）的 MD，拖入发送后问「附件里写了什么」，模型回答须包含该字符串。

**AC-4（无回归）**：
- `python -m pytest tests/test_context_file_hydration.py tests/test_context_file_prompt.py tests/test_smoke_context_file_keys.py -v` 全绿。
- `cd desktop && npx vitest run src/utils/session-message-merge.test.ts src/utils/text-attachment.test.ts` 全绿。
- `cd desktop && npx tsc --noEmit` 无新增错误。

## 风险与注意

- **不要**把 hint 写进 `session.chat_history`——会让 UI 历史里每条用户消息都带一段系统文案，且 retry 时会重复叠加。
- FR-2 依赖 Electron IPC；若 `preload.ts` 无对应 handler，严禁顺手在 `main.ts` 加 IPC（越界），走「仅 warn」分支。
- `_build_attached_files_hint` 只列「本轮可读正文」的条目；值为 `[附件] ` 占位符（尚未 hydrate 的文档）**不**列入 hint——那种条目本就该触发 `liteparse`，不属于本 plan 范围。

## 推荐实施模型（Suggested-Impl-Model）

| 子任务 | 推荐 | 理由 |
|---|---|---|
| FR-1 | 代码专精中档（如 Codex 系列） | 需改 `agent_runtime.py` 主链路，涉及 list/str 多模态分支，弱模型易写错 `user_content` 类型 |
| FR-2 | Composer 2.5 / 代码专精便宜档 | 单文件单分支改动，先查 IPC 存在性即可 |

Suggested-Impl-Model: 代码专精中档（如 Codex 系列）
