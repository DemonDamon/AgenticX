# acp-15 智能体可绑定知识库检索

Planned-with: Grok 4.7
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`

## 目标

管理员在智能体上填写一个 http(s) 检索地址。房间里点名这个云端智能体时，模型可以调用 `knowledge_search`，门户把问题交给该地址并带回摘录。不新建向量库。

## 落点

- 地址存在智能体 `metadata.knowledgeSearchUrl`。`validateAgentInput` 只接受 http 或 https。
- `agent-knowledge.ts` 发 `POST {query}`，读取 `results[].text`。
- `agent-executor.ts` 在没有 MCP 时也会因为这个地址进入工具循环。
- 管理台表单增加「知识库地址」。

## AC

- `cd enterprise/apps/web-portal && npx vitest run src/lib/collab-room/__tests__/agent-knowledge.test.ts src/lib/collab-room/__tests__/agent-loop.test.ts` 通过。
- `cd enterprise/packages/iam-core && npx vitest run src/repos/__tests__/agents-validate.test.ts` 通过。
- 非法地址不能保存；模型调用检索工具后，回复包含检索摘录。
