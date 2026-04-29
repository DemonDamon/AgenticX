---
name: enterprise-admin-model-keys
overview: 在 admin-console 实现「模型服务（Key）管理」UI 与可下发到 gateway 的运行时配置；admin 给每个用户分配可见模型；前台 portal 从后端拉取动态模型列表；用户对话产生的 token 用量实时回显在主聊天区。
todos:
  - id: A1
    content: admin-console · 数据存储 model-providers-store.ts（providers + models 持久化 JSON）
    status: pending
  - id: A2
    content: admin-console · API CRUD + 测试连通性 + 模型增删
    status: pending
  - id: A3
    content: admin-console · 模型服务页面 /admin/models（参照 Machi 设置面板：左厂商列表 + 右详情）
    status: pending
  - id: A4
    content: admin-console · AppShell 导航增加「模型服务」入口
    status: pending
  - id: B1
    content: admin-console · 用户 ↔ 模型可见性分配（用户详情抽屉新增「可用模型」chip 选择）
    status: pending
  - id: B2
    content: web-portal · /api/me/models 返回当前用户可见模型（合并 admin 启用的 provider + 用户分配）
    status: pending
  - id: B3
    content: web-portal · MachiChatView 替换硬编码 MODELS，从 /api/me/models 拉取
    status: pending
  - id: C1
    content: gateway · 新增 internal/runtimeconfig 包：从 enterprise/.runtime/admin/providers.json 读取 admin 落盘配置（带 mtime watch）
    status: pending
  - id: C2
    content: gateway · Decider/Provider 链路：先查 admin 配置（model→provider/endpoint/api_key），再回退 YAML/env
    status: pending
  - id: C3
    content: gateway · 计量在 DATABASE_URL 缺失时降级写 .runtime/usage.jsonl，避免 dev 启动失败
    status: pending
  - id: D1
    content: gateway · SSE 流尾追加 token usage 帧（自定义 event: usage）；非流路径 resp.usage 直接透传
    status: pending
  - id: D2
    content: web-portal · /api/chat/completions 透传 usage 帧；chat-store 增加 sessionTokens 累加
    status: pending
  - id: D3
    content: web-portal · MachiChatView 顶部 chip 实时显示「↑ in / ↓ out · Σ total」
    status: pending
  - id: V1
    content: typecheck + go test + go build；UI 截图过一遍主路径
    status: pending
---

## 1. 范围（严格遵循 no-scope-creep）

**只做：**
- admin-console：模型服务（厂商+Key+模型）CRUD + 用户可见模型分配
- web-portal：动态读取自己可见模型 + 顶部 token 累计 chip
- gateway：消费 admin 落盘配置；token usage 真实回吐
- 持久化：admin JSON 文件（`enterprise/.runtime/admin/providers.json` 与 `user-models.json`）

**不做（推迟到下一阶段）：**
- 把 admin store 落到 PG（当前内存/JSON 与现有 users-store 一致）
- BYOK（用户自填 Key）—— 与规范书定位不符
- 多 tenant 复杂权限隔离（沿用 DEFAULT_TENANT_ID）

## 2. 数据形状

```ts
// providers.json
{
  "providers": [
    {
      "id": "openai",
      "displayName": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "enabled": true,
      "isDefault": false,
      "route": "third-party",
      "models": [
        { "name": "gpt-4o-mini", "label": "GPT-4o Mini", "capabilities": ["text"], "enabled": true }
      ],
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}

// user-models.json
{
  "userModels": {
    "u_001": ["openai/gpt-4o-mini", "deepseek/deepseek-chat"],
    "u_002": ["openai/gpt-4o-mini"]
  }
}
```

`/api/me/models` 返回结构：
```ts
{
  data: [
    { id: "openai/gpt-4o-mini", provider: "openai", providerLabel: "OpenAI",
      model: "gpt-4o-mini", label: "GPT-4o Mini", route: "third-party" }
  ]
}
```

## 3. SSE usage 协议

OpenAI 流末没有标准 usage 字段。我们沿 `data: {...}` 但加 `agenticx_usage` 名字，最后一帧前 push：

```
data: {"agenticx_usage":{"input_tokens":42,"output_tokens":156,"total_tokens":198}}
data: [DONE]
```

portal 收到后忽略 `agenticx_usage` 内容写入消息文本，只更新 store 的 `sessionTokens`。

## 4. 验收清单

- AC-1：admin 在「模型服务」页可加一个 OpenAI 厂商，填 Key，点「检测」返回成功
- AC-2：admin 在用户详情勾选 `openai/gpt-4o-mini` 保存
- AC-3：用 owner 登录 portal，模型下拉只看到刚才分配的模型
- AC-4：发送一条消息，回复结束后顶部 chip 数字立刻 +N tokens
- AC-5：未配置任何 Key 时，前台依然不报错（自动回退 mock，chip 显示估算 token）
