# 重试/编辑用户消息时按索引截断上下文(修复旧上下文泄漏)

Plan-Id: 2026-06-01-retry-context-truncation-fix
Plan-File: .cursor/plans/2026-06-01-retry-context-truncation-fix.plan.md

## 背景 / 问题

用户重新执行(retry)某条 user 消息后,模型在 Thought 里仍引用"我刚才已经写好了 …"
这类**上一轮**才产生的结论,即使用户已删除对应产物文件、且是在重新执行同一条 query。

### 已核实根因(非猜测)

会话有两套消息:
- `chat_history` / `messages.json`:UI 展示与持久化的单一来源
- `agent_messages`:**真正发给 LLM 的上下文**(含 `tool_calls` / tool 结果 / `[compacted]` 摘要块)

当前 retry/edit(`desktop/src/components/ChatPane.tsx` 的 `retryUserMessage` / `editUserMessage`)
靠"逐条签名删除"清理:把 UI 中该 user 之后的消息收集为 `toRemove`,经
`filterPersistedMessagesForDeletion` 与磁盘 `messages.json` 按 `(role, agentId, timestamp, content)`
精确匹配后,只对命中条目调 `/api/session/messages/delete`。两个致命点:

1. **timestamp 必然对不上 → 后端基本删不掉。**
   - UI assistant 时间戳是流式结束的 `Date.now()`(`completedAt`);
   - 后端 `run_turn` 里 `chat_history.append(_hist_assistant)` **不带 timestamp**,
     持久化时 `_save_messages_snapshot` 才补 `now_ms`。
   - 两者来源不同 → 签名不匹配 → `deletable = []` → `if (deletable.length > 0)` 为假 →
     **跳过 delete API**,但随后仍 `setPaneMessages(msgs.slice(0, idx+1))` 裁掉 UI。
   - 结果:UI 像重置了,后端 `chat_history` / `agent_messages` 一条没动,模型照旧看到旧上下文。
2. **`agent_messages` 形态不同 + `[compacted]` 块从不在删除目标里。**
   - tool 行 / 带 `tool_calls` 的 assistant 行形态与 UI 不一致;
   - `[compacted]` system 摘要块只存在于 `agent_messages`,UI `toRemove` 里没有 → 签名永远命中不到。

## 目标行为

重试/编辑某条 user 消息时,**按位置截断**两套历史,而非逐条签名删除:
- retry:在 `chat_history` 与 `agent_messages` 中各定位**最后一条**匹配该 `user_content` 的 user 行,
  保留到该 user 行(含),**删除其后全部**(assistant / tool / `[compacted]` 一并切掉)。
- edit:同上,但**从该 user 行起(含)一并删除**,随后用新内容重新发送。
- 截断失败时不静默继续:回滚到磁盘快照,不发起重试。

> 该 user 行在 `agent_messages` 里以 `{"role":"user","content":user_input}` 原样 append,
> 内容与 UI 一致,按 role+content 定位稳定,不依赖 timestamp。

## 范围(严格限定)

- 后端:新增 `POST /api/session/messages/truncate`(仅截断,不改既有 delete 接口语义)。
- 前端:`retryUserMessage` / `editUserMessage` 改调用 truncate;移除其对
  `filterPersistedMessagesForDeletion` + delete 的依赖。多选删除仍走原 delete 接口,不动。
- 不改压缩算法、正常对话路径、`messages.json` 结构。

## 需求

### FR-1 后端截断接口
`POST /api/session/messages/truncate`,入参 `{ session_id, user_content, mode }`,`mode ∈ {after, including}`:
- 在 `session.chat_history` 中定位**最后一条** `role=="user"` 且 `content==user_content` 的行 `i_hist`;
  在 `session.agent_messages` 中定位最后一条同条件行 `i_agent`。
- `after`:`chat_history = chat_history[:i_hist+1]`,`agent_messages = agent_messages[:i_agent+1]`。
- `including`:`chat_history = chat_history[:i_hist]`,`agent_messages = agent_messages[:i_agent]`。
- 任一序列未定位到 user 行时,该序列不截断(返回各自 removed 计数);两者都未命中返回 `ok:true, removed:0`。
- 调 `manager.persist(session_id)` 落盘;返回 `{ ok, removed_chat, removed_agent }`。
- `_check_token` 鉴权;`session` 不存在返回 404。

### FR-2 前端改用截断
- `retryUserMessage`:用 truncate(`mode:"after"`)替代"收集 toRemove → 过滤 → delete"逻辑;
  成功后 `setPaneMessages(msgs.slice(0, idx+1))`;失败(非 ok)→ 从磁盘 reload 并 return,不重试。
- `editUserMessage`:用 truncate(`mode:"including"`)替代;成功后 `setPaneMessages(msgs.slice(0, idx))`;
  失败 → reload 并 return。
- 截断成功后再调用 `sendChatRef.current(...)`(retry 保持 `suppressUserEcho/skipUserHistory`)。

### FR-3 不破坏 tool-call 配对
截断以 user 行为边界,user 行之后是完整的一轮(assistant→tool…),整体切掉不会留下
"assistant(tool_calls) 无对应 tool 响应"的断链;保留段尾部恰为 user 行,合法。

## 验收标准

- AC-1:retry 同一条 user 消息后,`agent_messages` 中该 user 行之后(含上一轮 assistant/tool 与
  `[compacted]`)被清空;下一轮模型上下文不再含上轮结论。
- AC-2:timestamp 不一致也能正确截断(不依赖 timestamp 匹配)。
- AC-3:edit 后该 user 行及其后全部移除,新内容作为新一轮发送。
- AC-4:多选删除(原 delete 接口)行为不变;正常对话 / 压缩路径无回归。
- AC-5:截断接口失败时前端回滚到磁盘快照,不发起重试。

## 实施步骤

1. 后端:在 `agenticx/studio/server.py` `delete_session_messages` 之后新增 `truncate_session_messages`。
2. 前端:改写 `retryUserMessage` / `editUserMessage`(`desktop/src/components/ChatPane.tsx`)。
3. 测试:`tests/test_studio_server.py` 增 truncate 用例(after / including / timestamp 不一致 / 未命中)。
4. 验证:跑该测试文件 + `desktop` typecheck。

## 风险与决策

- 若同一 `user_content` 在历史中多次出现:取**最后一条**,符合 retry/edit 针对最近一轮的语义。
- `agent_messages` 磁盘仅存 tail 40,但截断在内存全量上进行后再 persist,tail 落盘正确。

## 跟进修复(2026-06-01 二轮)

重启后仍出现「上下文窥视」,进一步根因:

1. **`[compacted]` 摘要块**:上一轮若已压缩,摘要文本仍含「已创建 skill」;仅截断 user 之后 assistant/tool 不够,retry 时须清除 `[compacted]` system 行。
2. **`user_occurrence`**:同文案多条 user 时「取最后一条」会锚错;前端按 pane 序号传第 N 次出现。
3. **静默 noop**:truncate 未匹配时仍 `ok:true` 且前端继续重试;须校验 `matched_*` / `removed_*`。
4. **agent/chat 不同步**:content 带引用后缀时 agent 侧匹配失败;增加 prefix 匹配 + 按 chat user 计数回切 agent。

### 追加需求

- FR-4: retry(`after`) 成功锚定后 strip `[compacted]` from `agent_messages`
- FR-5: 支持 `user_occurrence`(1-based);前端从 pane 累计
- FR-6: `expectRemoved` 时 removed/matched 全 0 则 abort retry
- FR-7: 输入框再次发送与历史某条 user **同文案**且该 user 后已有 assistant/tool 回复时,按 implicit retry 走 truncate(`after`)+`skipUserHistory`,避免 proactive compaction 把旧结论写进 `[compacted]`
