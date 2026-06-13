# Plan: 聊天图片附件持久化 + 历史视觉内容重建（跨模型切换可见）

**Plan-Id:** 2026-06-12-chat-image-attachments-persistence-vision-history-reconstruction
**Date:** 2026-06-12
**Owner:** Damon Li
**Status:** Implemented (c69a53f8)

## 背景与问题

用户在对话中直接上传/拖拽/粘贴图片（非工作区 @file 引用）后：

- 若当时模型为非视觉模型，运行时可能走 `view_image` 兜底或直接报错（曾出现 `ERROR: file not found: /Users/damon/image.png`）。
- 切换到支持视觉（多模态）的模型后，**历史消息里的图片在新的 LLM 上下文中不可见**，模型回答“看不到”“无法解析”等。
- UI 侧有时能显示缩略图（依赖 `dataUrl`），但该图片数据未进入后续轮次的 prompt，导致“换模型也看不见”。

根因诊断（已通过代码走读确认）：

- 直接上传的图片在前端以 `FileReader` 转为 `dataUrl`，存在 `contextFiles`/`AttachedFile`，发送时仅在 `targetAgentId==="meta" && !isGroupPane` 时放入 `body.image_inputs`（含 `data_url`）。
- 后端 `studio/server.py`：
  - `_normalize_image_inputs` 接收并限额（≤4 张，data_url ≤8M chars）。
  - 当前轮通过 `user_message_content`（text + image_url 块）直接注入 LLM messages。
  - `history_user_attachments = _history_attachments_from_image_inputs(...)` 产生带 `data_url` 的记录，传给 `runtime.run_turn(..., history_user_attachments=...)`。
- `agent_runtime.py`：
  - `run_turn` 用 `history_user_attachments` 仅写到 `session.chat_history` 的 user 条目：`{"role":"user","content":纯文本,"attachments":[{name,mime_type,size,data_url}]}`
  - `session.agent_messages` 的对应 user 条目只写纯文本 `user_input`。
  - 构建 prompt `messages` 主要来自 `session.agent_messages`（经 sanitize + compactor）：`messages.extend(compacted_history)` + 当前轮 rich content。
  - 历史 user 条目里的 `attachments` 里的图片**从未被提升为 vision content blocks** 进入 LLM 上下文。
- `llms/vision.py` 的 `strip_nonvision_multimodal_messages` 只做“有图就压平+加省略说明”，不负责“从 attachments 反向提升”。
- `view_image` 工具支持 `data:image/*` / http / 本地路径，但历史上传的图片若只以 transient `sourcePath`（客户端原路径）形式泄漏到 tool 调用，就会出现 file not found；且历史图片本身未被自动暴露为可 `view_image` 的稳定目标。
- 持久化：图片以 base64 data_url 形式**嵌入** `~/.agenticx/sessions/<sid>/messages.json`（chat_history 部分）的 attachments 里，属于“该 section 里保存了图片”，但 UI 渲染（AttachmentCard）依赖 `dataUrl`，LLM 上下文构建未消费。
- 其他 pane（sub-agent、群聊）因为 `canSendImageInputs` 守卫，图片数据甚至不会到达后端持久化逻辑。

结果：图片只在“发送那一刻”对当时模型可见；换模型、跨轮次、子代理、历史回放时丢失视觉信息。

## 目标

让用户上传到任意聊天会话（section）的图片：

1. **总是被持久化** 到该 session 的 messages.json（chat_history 的 attachments 带 data_url），供 UI 预览、历史重放、未来模型切换使用。
2. **当目标模型支持视觉时**，历史用户消息中的图片自动作为 vision content 进入 LLM prompt（整个对话历史对模型可见，无需用户重传或 agent 手动 view_image 自己的历史用户图）。
3. **非视觉模型** 仍走现有 strip 逻辑，优雅降级为文本 + 省略说明。
4. 避免把客户端原始本地路径（`/Users/...`）作为历史图片的稳定引用；规范使用 data_url（或后续可扩展的 session 内存储引用）。
5. 兼容现有 view_image（data_url 已是合法 target）、compaction、mid-turn persist、子代理委派等路径。
6. UI 侧 AttachmentCard / 重试 / 复制消息 继续正常工作（已有 dataUrl 即支持）。

## 非目标（本次严格限定范围）

- 不改变工作区 `@file` 引用文件的处理逻辑（sourcePath + referenceToken + taskspace 那一套继续走）。
- 不引入新的磁盘 attachments/ 目录 + 外置文件存储（当前 data_url 嵌入 json 已满足“section 内保存”，后续可作为 perf 优化单独 plan）。
- 不修改 view_image 工具签名或上限（保持兼容）。
- 不重构整个 chat_history / agent_messages 双轨（最小改动，在关键 append 点对齐 attachments，并在 prompt 构建处加 promote 步骤）。
- 不处理超大图片的自动缩略/分片（已有 8M chars 上限，继续沿用）。

## 需求

### FR（功能）

- **FR-1 持久化无条件化**：无论当前 pane 是否 meta、是否群聊、当前模型是否视觉，只要用户消息携带带 dataUrl 的图片附件，server 侧就生成 `history_user_attachments` 并透传给 runtime 持久化到 chat_history。Desktop 侧放宽 image_inputs 发送条件（至少把数据发上去让 server 决定是否当轮注入 + 总是记录历史附件）。
- **FR-2 历史视觉重建**：在 `agent_runtime.run_turn` 构建 prompt `messages` 的关键路径（sanitize/compaction 之后、strip 之前、最终 messages_for_llm 之前），若当前 provider/model `is_vision_capable`，则把历史 user 条目上携带的 `attachments` 里符合 `data:image/*` 的项，提升为 content 列表里的 `image_url` 块（保留原有文本为第一个 text block）。当前轮已通过 `user_message_content` 处理的保持不变。
- **FR-3 agent_messages 也带附件**：在 runtime 里把 user 轮写入 `session.agent_messages` 时，若有 `history_user_attachments`，同步写入 `attachments` 字段（与 chat_history 对齐）。这样：
  - compaction / sanitize 能看到它。
  - resume 时从 agent_messages snapshot 恢复后仍有 attachments 信息。
  - promote 逻辑可在 agent_messages 来源的列表上工作。
- **FR-4 降级与一致性**：非视觉模型下，`strip_nonvision_multimodal_messages` 继续把 list content 里的 image_url 压成文本 + 省略说明（对历史提升后的块也生效）。
- **FR-5 避免 transient 路径**：确保上传的聊天图片在 history / tool 调用上下文中只以 data_url（或未来稳定 ref）形式出现，不再把客户端 `sourcePath`（如 `/Users/damon/image.png`）当作历史图片的 `target` 泄漏给 view_image 或 model。
- **FR-6 UI 连续性**：重试、复制、转发包含图片的消息时，dataUrl / attachments 继续被保留（现有逻辑已部分覆盖，需确认 send/retry 路径不丢）。

### NFR（非功能）

- **NFR-1 性能/体积**：单条 user 消息图片仍受现有 4 张 + data_url 长度上限约束；不因历史重建导致每轮都重复 base64 传输（LLM provider 侧会按实际 content 计费）。
- **NFR-2 向后兼容**：旧的 messages.json（无 attachments 或只有 sourcePath 的图片记录）加载后不 crash，promote 时安全跳过。
- **NFR-3 观测性**：视觉注入的历史图片在 context stats / debug 事件中可区分（可选，不强求本次必须有新事件）。
- **NFR-4 安全**：data_url 只在受信的 session 内部流转；后端已有大小/MIME 校验，继续沿用。

### AC（验收标准）

- **AC-1**：在 Meta 窗格，用非视觉模型发送带图片的用户消息 → 消息持久化到该 session 的 messages.json，attachments 里有 `data_url`（UI 切走再切回能看到图片卡片/缩略图）。
- **AC-2**：同一会话中切换到视觉模型，继续追问或新发消息（不重传图）→ 模型回复中能正确描述/引用该历史图片（可通过让模型回答“请详细描述你看到的上一张用户上传的图片内容”来验证）。
- **AC-3**：在非 Meta pane（或群聊）上传图片 → 至少确保该 session 的 chat_history 里记录了带 data_url 的附件（UI 可展示）；若 sub-agent 有独立 session，图片是否自动继承到子 session 由上层 delegate 逻辑决定（本次不强制改变 delegate 行为）。
- **AC-4**：切换回非视觉模型 → 历史图片在 prompt 中被 strip 成文本 + “N image attachment(s) omitted” 说明，不触发 provider 400。
- **AC-5**：使用 `view_image(target=历史消息里某 data_url)` 仍能正常工作（作为兜底或显式需求场景）。
- **AC-6**：重试/复制带图的用户消息 → 图片附件不丢失（dataUrl 保留）。
- **AC-7**：无新引入的 linter 错误；相关路径的现有冒烟测试（含 view_image 相关）保持通过；新增或调整的逻辑有可执行的简单验证步骤（可在 plan 末尾列出手动/脚本验证命令）。
- **AC-8**：Plan 文件 + 实现变更一起提交，commit message 包含 `Plan-Id` trailer 和 `Made-with: Damon Li`。

## 实现策略（最小侵入）

1. **Desktop（ChatPane.tsx + 可能 store/send 辅助）**：
   - 调整 `canSendImageInputs` 条件：只要有带 dataUrl 的图片附件，就准备 `imageInputs` 并放入 body（去掉或放宽仅 meta 的限制）。Server 端已有 `_normalize` + 模型守卫，会在不需要时不注入当轮视觉，但 `history_user_attachments` 仍可被生成用于持久化。
   - 确保 retry 路径（`retryUserMessage` 等）把原 `attachments`（含 dataUrl）重新带上发请求。
   - Attachment 构造处确认 `dataUrl` 优先于 `sourcePath` 作为图片的稳定载体（已有部分逻辑）。

2. **Studio server.py**：
   - 在 chat 处理主路径（meta）之外，检查是否还有其他入口需要把 image_inputs 规范化为 history_user_attachments 并传下去（子代理若走独立 chat 路径，也应支持）。
   - 保持 `_history_attachments_from_image_inputs` 不变（它已经是正确提取 data_url 的逻辑）。

3. **agent_runtime.py（核心）**：
   - 修改两处 `session.agent_messages.append({"role": "user", "content": user_input})`：若 `history_user_attachments` 存在，写入 `attachments` 字段（与 chat_history 一致）。
   - 新增辅助函数（例如 `_promote_user_image_attachments(messages: list[dict], provider: str, model: str) -> list[dict]`）：
     - 仅当 `is_vision_capable(provider, model)` 时生效。
     - 遍历 messages，对 role=="user" 且有 `attachments` 列表的条目：
       - 收集其中 `data_url` 以 `data:image/` 开头的项。
       - 若 `content` 为 str，转成 `[{"type":"text","text": content}, ...image blocks...]`；若已是 list，则 append 缺失的图片块（去重避免重复）。
     - 返回新列表（或原地修改后返回）。
   - 在 prompt 构建流程中合适位置调用（推荐在 compaction 之后、`_sanitize_context_messages` 之后、第一次 `strip_nonvision...` 之前；以及在最终 `messages_for_llm` 准备好后也可再保底调用一次）。
   - `_inject_pending_visual_attachments` 产生的 rich entry 已经是 list content，可保持不变（promote 对它也是幂等的）。
   - 确保 promote 不影响 tool call 配对等 sanitize 假设（只改 user 消息的 content 形状，role 顺序不变）。

4. **vision.py**：
   - 可保持 `strip_nonvision...` 不动（它已经能处理 list content 里的 image_url）。
   - 如有必要，可加一个显式的 `is_vision_capable` 导出或小重构，但当前已从 runtime 导入使用。

5. **测试与文档**：
   - 现有 `tests/test_view_image_tool.py`、`tests/test_agent_runtime_visual_injection.py` 继续通过。
   - 可在 plan 末尾给出手动验证步骤（用视觉模型 + 非视觉模型来回切，观察模型是否能描述历史用户上传图）。
   - 若需要，可补充一个轻量集成测试断言：构造带 attachments 的 chat_history/agent_messages，vision 模型下最终 messages_for_llm 里对应 user 条目 content 是 list 且含 image_url。

6. **边缘情况处理**：
   - 历史记录里 attachments 只有 sourcePath、无 data_url 的图片（旧数据或 context_file 类的）：promote 时跳过（保持现有行为）。
   - 超限/非法 data_url：normalize 时已过滤，promote 也做防御性检查。
   - Compaction：若 compactor 丢弃了带图的旧 user 轮，图片自然从上下文中消失（与文本消息被压一致）；若保留该轮，attachments 应被 compactor 保留（当前实现若只是文本摘要，需观察；必要时在 compactor 相关处加 attachments 浅拷贝保护，但本次先实现 promote + append 对齐，观察是否够用）。
   - 群聊/多窗格：每个 pane/session 独立持久化，图片只进当前 pane 对应的 session。

## 变更文件清单（预估）

- `desktop/src/components/ChatPane.tsx`（发送条件、retry 附件保留）
- `agenticx/runtime/agent_runtime.py`（agent_messages append 带 attachments + promote 调用 + 辅助函数）
- `agenticx/llms/vision.py`（如需小增强 is_vision 辅助，可选）
- `agenticx/studio/server.py`（如需放宽子路径的 image_inputs 处理或注释更新）
- `.cursor/plans/2026-06-12-....plan.md`（本文档）
- 可能的测试微调或新验证脚本（可选）

## 回滚 / 风险

- promote 逻辑加在 prompt 构建处，失败时可 fallback 返回原 messages 列表（加 try/except + log）。
- attachments 写入 agent_messages 只是多带一个字段，对现有只读 content 的代码无害。
- Desktop 放宽发送条件后，server normalize 已有上限保护，不会爆炸。

## 后续演进（不属于本次范围）

- Session 目录下 `attachments/` 子目录 + 相对路径引用（大图不嵌入 json）。
- 图片去重（按 sha256）。
- Sub-agent / delegate 时自动把主会话的视觉附件按需快照/继承到子 session。
- 更丰富的视觉预算控制（当前轮 + 历史图片的总 token 估算）。

## 验证步骤（AC 对应）

1. 启动 Desktop + agx serve，本地用非视觉模型（如纯文本 Qwen）新建会话，拖拽/粘贴一张 <2MB 图片发送，确认：
   - 后端日志/消息里看到 image_inputs 被 normalize。
   - `~/.agenticx/sessions/<该sid>/messages.json` 里对应 user 行有 `attachments` 数组，含 `data_url`。
   - UI 历史里能点开 AttachmentCard 看到图片。
2. 切换该会话模型到支持视觉的模型（无需重传图），输入“请详细描述上一张我上传的图片的视觉内容、颜色、文字、布局”，模型应能给出合理描述（而非“我看不到”）。
3. 切回非视觉模型，继续对话，模型应在上下文中带“[1 image attachment(s) omitted ...]”或类似说明，不报错。
4. 用 view_image 工具显式传 data: URL（从 messages.json 拷贝一个）验证仍可用。
5. 重试刚才那条带图的用户消息，确认图片仍附带。
6. 运行相关 pytest（view_image + visual injection）确保绿。
7. `git commit` 时带 Plan-Id trailer + Made-with: Damon Li。

---

**实施顺序建议**：
1. 先改 runtime（append 对齐 + promote 辅助 + 调用点），本地验证 vision 模型下历史图进入 messages_for_llm。
2. 再调 Desktop 发送守卫 + retry 路径，确保数据能到 server。
3. 补充 plan 里列的 AC 手动验证。
4. 提交 plan + 代码 + 测试证据。

Made-with: Damon Li
Plan-File: .cursor/plans/2026-06-12-chat-image-attachments-persistence-vision-history-reconstruction.plan.md
