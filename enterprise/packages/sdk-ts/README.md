# @agenticx/sdk-ts

TypeScript 客户端 SDK（给 Machi 接）

## Managed Agents

`ManagedAgentsClient` 覆盖 agents、versions、environments、sessions、events。生产环境只配 `baseUrl`（nginx 上的 `/ma/v1`）。本地开发把控制面和会话面分开，控制面地址要带 `/api`：

```ts
import { ManagedAgentsClient } from "@agenticx/sdk-ts";

const client = new ManagedAgentsClient({
  baseUrl: "http://127.0.0.1",
  controlBaseUrl: "http://127.0.0.1:3001/api",
  runtimeBaseUrl: "http://127.0.0.1:8092",
  token: "agx-pat-...", gitleaks:allow
});

const agents = await client.agents.list();
const session = await client.sessions.create({ agent_id: agents[0].agent.id });
for await (const item of client.events.stream(session.id, { untilIdle: true })) {
  if (item.kind === "event") console.log(item.event.seq, item.event.type);
}
```

令牌必须是 `agx-pat-` 个人访问令牌。`events.stream()` 断线后用 `Last-Event-ID` 续流，并丢掉已经产出过的 `seq`。
