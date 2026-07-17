# Near 分身首条引用消息去重实施计划

Planned-with: GPT-5.6 Sol
Suggested-Impl-Model: GPT-5.6 Sol

> **实施要求：** 使用 TDD，先运行红测，再做最小修复；后端仅允许透传并持久化既有 `client_turn_id`，禁止改动无关聊天逻辑。

## 目标

修复数字分身/专家窗格首轮发送含 `@文件` 引用时，同一用户 query 在流式执行和读盘收口后出现两次的问题。修复后，乐观消息、磁盘消息、流结束合并、切换会话与重启恢复都必须呈现同一条用户消息，同时保留合法的“用户后续再次发送相同文本”。

## 事故证据与根因

事故会话：`41c9c063-bba2-4f2f-b3e8-0ce8c20527a1`。

### 已核验证据

1. `~/.agenticx/sessions/<session_id>/messages.json` 只有一条 `role=user`。
2. `messages_tail.json` 的 16 条记录中也只有一条 `role=user`。
3. 截图中两个用户气泡之间夹着助手状态消息，消息顺序与磁盘顺序不同。

因此，后端没有重复写入；重复发生在 Desktop 内存消息与磁盘快照的前端收口阶段。

### 精确故障链

1. `desktop/src/components/ChatPane.tsx::extractComposerText()` 将输入框文件 token 序列化为短标签，例如 `@aibuilder-JD.md`。
2. `ChatPane.tsx::sendChat()` 以 `messageText` 创建乐观用户气泡。
3. 同一函数通过 `rewriteUserReferenceMentions()` 将短标签改为规范路径，例如 `@/Users/.../aibuilder-JD.md`，并作为 `user_input` 发给后端。
4. 后端只持久化规范路径版本；这是正确行为，事故 session 证明磁盘中仅有这一份。
5. 流结束时 `ChatPane.tsx::mergeTailFromDisk()` 调用 `desktop/src/utils/session-message-merge.ts::mergeSessionMessagesTail()`。
6. 当前 user 行只按 `trim(content)` 精确比较。短标签与绝对路径视觉等价但字符串不等，因此磁盘行与乐观行未被消费匹配，乐观行被追加到磁盘历史尾部，形成第二个用户气泡。
7. 既有 `store.ts::addPaneMessage()` 去重同样只比较原始 content；`message-ownership.ts` 仅折叠相邻重复，无法处理被助手状态隔开的重复。
8. 此问题此前已有两次基于“正文相同/相邻重复”的修复，但内容启发式无法可靠区分同文不同轮次、同名附件和跨层 MIME/size 差异；终局方案必须使用稳定的 per-turn identity，而非继续堆叠全局文本 Set。

## In scope

- `desktop/src/utils/reference-attachment.ts`
  - 导出当前 `ChatPane` 私有的规范引用 key/重写能力，作为单一实现。
- `desktop/src/components/ChatPane.tsx`
  - 每轮生成一次 `client_turn_id`，同值写入乐观 user metadata 与 `/api/chat` body。
- `desktop/src/components/ChatView.tsx`
  - Lite 路径使用相同的单轮 ID 规则。
- `desktop/src/utils/session-message-merge.ts`
  - user 行优先按 `client_turn_id` 匹配；旧数据才回退到“规范化正文 + 稳定附件身份”。
- `desktop/src/store.ts`
  - `addPaneMessage()` / `addMessage()` 只检查最后一个 pending user；不同 turn ID 绝不吞掉。
- `desktop/src/utils/send-dedupe.ts`
  - pending 去重同时比较正文、强附件身份和 turn ID。
- `agenticx/studio/server.py`
  - 在既有 `/api/chat` `client_turn_id` 幂等入口处，仅新增一行 `history_user_metadata` 透传。
- `agenticx/runtime/agent_runtime.py`
  - 将 turn ID 同步持久化到 `agent_messages` 与 `chat_history/messages.json`。
- `desktop/src/utils/session-message-merge.test.ts`
  - 用事故等价数据锁定回归。
- `tests/test_agent_runtime.py`、`tests/test_studio_server.py`
  - 锁定 metadata 双历史持久化与 Server 接线。
- 扩展 `reference-attachment` / `send-dedupe` 测试验证 legacy fallback 边界。

## Out of scope

- 不修改 SessionManager、SSE event hub、ChatRequest 字段定义或既有历史 session 文件。
- 不回填旧 `messages.json`；无 turn ID 的事故数据由 Desktop legacy fallback 防御。
- 不按纯文本全局删除非相邻 user 行；用户在不同轮次再次发送相同问题必须保留。
- 不重构 `ChatPane`、SSE、session tail cache 或消息分页。
- 不修改附件视觉、token 样式或文件引用协议。

## 终态不变量

### INV-1：同一用户轮次只有一个可见气泡

一个 `client_turn_id` 最多消费一个内存 user occurrence；位置 ID、正文或附件字段不能覆盖冲突的非空 turn ID。旧数据无 ID 时，一个磁盘 user occurrence 最多消费一个语义等价内存 occurrence。

### INV-2：合法重复轮次必须保留

如果磁盘中真实存在两条同内容 user 行，合并结果必须保留两条，不能用全局 content Set 粗暴删除。

### INV-3：附件与乐观元数据不丢失

磁盘行确定顺序；匹配到的内存行继续通过 `overlayMemoryEnrichment()` 保留乐观 ID、附件及其他即时字段。

### INV-4：弱附件身份宁可不去重

跨层 MIME/size、upload/reference 分类不参与身份；绝对路径、目录真实路径或 data URL 才是强身份。只有文件名的弱上传不得触发 `skip_user_history`。

## TDD 实施步骤

### Task 1：锁定事故红测

**文件：**

- Modify: `desktop/src/utils/session-message-merge.test.ts`

**测试数据：**

- 内存 user：
  - content 含 `@aibuilder-JD.md` 与 `@2026各部门JD提报-已填写.md`
  - attachments 含对应 `sourcePath`、`composerRefLabel`、`referenceToken=true`
- 内存 assistant：冷却状态正文
- 磁盘 user：
  - content 含两个 `@/Users/...` 规范路径
  - snake_case attachments 与事故 `messages.json` 一致
- 磁盘 assistant：同一冷却状态正文

**关键断言：**

- 合并后 `role=user` 数量为 1；
- 结果顺序为 user → assistant；
- user 仍保留附件；
- 现有“两条真实磁盘同内容 user 行保留两条”测试继续通过。

**RED 命令：**

```bash
cd desktop
npx vitest run src/utils/session-message-merge.test.ts
```

预期：新增用例失败，实际 user 数量为 2。

### Task 2：提取共享规范化函数

**文件：**

- Modify: `desktop/src/utils/reference-attachment.ts`
- Modify: `desktop/src/components/ChatPane.tsx`

**实现意图：**

1. 将 `buildContextFileKeyFromAttachment()`、canonical mention 构造和 `rewriteUserReferenceMentions()` 提取为导出函数。
2. canonicalization 仍使用：
   - `sourcePath || name`
   - `stripComposerUploadDedupeKey()`
   - `lineRange` → `:start-end`
   - `spreadsheetRef` → `#sheet!a1`
   - `snippetRef` → `:snippet-id`
3. `ChatPane` 请求正文与复制逻辑改为调用共享函数，行为不得变化。

### Task 3：修复 user occurrence 匹配与 pending 去重

**文件：**

- Modify: `desktop/src/utils/session-message-merge.ts`
- Modify: `desktop/src/store.ts`
- Modify: `desktop/src/utils/send-dedupe.ts`

**实现意图：**

```ts
const userMessageKey = (message) =>
  canonicalizeUserReferenceMentions(message.content, message.attachments).trim();
```

- `mergeSessionMessagesTail()` 先匹配非空 `client_turn_id`；disk 有 ID 时禁止位置 ID 抢先匹配。
- 无 ID 旧数据才比较 canonical body；强附件 identity 不同则不得 overlay。
- `addPaneMessage()` / `addMessage()` 只检查最后一个非 tool pending user。
- 两边非空 turn ID 不同、附件 identity 不同或附件 identity 为弱时，均不得抑制新轮次。

### Task 4：持久化稳定 turn identity

**文件：**

- Modify: `desktop/src/components/ChatPane.tsx`
- Modify: `desktop/src/components/ChatView.tsx`
- Modify: `agenticx/studio/server.py`
- Modify: `agenticx/runtime/agent_runtime.py`
- Modify: `tests/test_agent_runtime.py`
- Modify: `tests/test_studio_server.py`

**实现意图：**

1. Frontend 在单轮开始时生成一次 UUID，乐观 row 与 POST body 复用同值。
2. Server 将该值作为 `history_user_metadata.client_turn_id` 传入 Runtime。
3. Runtime 对 `agent_messages` 与 `chat_history` user row 同步写 metadata。
4. `_chat_history_append_deduped()` 遇到同文 user 时，非空且不同的 turn ID 必须视为两轮。

### Task 5：GREEN 与回归

```bash
cd desktop
npx vitest run \
  src/utils/session-message-merge.test.ts \
  src/utils/send-dedupe.test.ts
npx tsx --test \
  src/utils/reference-attachment.test.ts \
  src/utils/composer-upload-key.test.ts
npm run build
```

```bash
cd ..
python -m pytest \
  tests/test_agent_runtime.py::test_user_history_persists_client_turn_metadata \
  tests/test_agent_runtime.py::test_chat_history_dedupe_keeps_distinct_client_turn_ids \
  tests/test_studio_server.py::test_server_chat_passes_should_stop_and_client_turn_metadata \
  -q
```

验收：

- 新增事故用例由红转绿；
- 既有真实重复轮次测试通过；
- Vite/Electron 构建通过；
- IDE lints 对改动文件无新增问题。

`npx tsc --noEmit` 作为诊断命令运行，但当前仓库基线存在与本需求无关的
`App.tsx`、`SettingsPanel.tsx`、测试 `.ts` 扩展名等历史错误；本任务的门禁是
“改动文件无新增 TypeScript/IDE diagnostics + `npm run build` 通过”，禁止顺手修复
这些无关基线问题。

### Task 6：真实 session 验收

1. 用事故 session 的消息/附件形态运行纯函数回归，确认只有一个 user occurrence。
2. 在新建分身会话发送：
   - 普通纯文本首条消息；
   - 含两个 `@文件` + 一个 `@skill://` 的首条消息。
3. 分别观察：
   - 流式中；
   - 工具状态/终止状态出现后；
   - 子智能体完成事件到达后；
   - 切走再切回；
   - 完全重启后。
4. 每个阶段用户 query 均只能显示一次。

## AC

- AC-1：事故等价红测修复前稳定失败，修复后通过。
- AC-2：含文件引用首条消息在 live/disk merge 后只有一条 user 行。
- AC-3：两次真实相同 user 轮次仍保留两条。
- AC-4：普通文本、附件展示、复制、重试和后端 `user_input` 行为不变。
- AC-5：新轮次 turn ID 在乐观 UI → request → Runtime 双历史 → disk reload 全链路一致。
- AC-6：专项 Vitest/Node/Python tests 与 Desktop build 通过；改动文件无新增 lint/type diagnostics。

## 验证记录

- RED：新增事故等价测试稳定得到 `["user", "assistant", "user"]`，证明旧实现确实追加了第二条用户消息。
- 后续审查红测：依次锁定同文不同附件、跨层 MIME/size、`@skill://` 前缀、
  同名引用、弱上传、不同 turn ID、stale positional ID 等边界；每个用例均先红后绿。
- GREEN：Vitest 26/26 通过；Node/tsx 引用测试 13/13 通过；Python 专项 5/5 通过。
- Browser/Vite runtime：动态加载实际 `session-message-merge.ts` 后验证：
  - legacy 事故路径 `roles=["user","assistant"]`、`userCount=1`；
  - 同 `client_turn_id` 的不同文本表示合并为一条并保留乐观 ID；
  - stale positional ID 与 client turn 冲突时，优先选择正确 turn。
- Build：`npm run build` exit 0。
- Python：四个改动文件 `py_compile` 通过；本机未安装 `ruff`，以 IDE diagnostics 与 pytest 作为门禁。
- `server.py` 冷启动：隔离 HOME/临时端口启动成功，`/api/session`、`/api/avatars`、
  `/api/sessions` 均返回 200；正式 Near dev 进程已重启并再次获得三项 200。
- 事故 session 经重启后端 API 返回 `messages=19, user_rows=1`。
- `ReadLints`：全部 13 个代码/测试改动文件无新增诊断。
- 全量 `npx tsc --noEmit`：仍被仓库既有无关错误阻断，改动文件未出现在最终错误列表。
- 独立只读终审：无 Critical / Important。

