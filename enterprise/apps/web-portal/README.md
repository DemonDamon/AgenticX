# @agenticx/app-web-portal

企业员工前台 Web App。剥离自 AgenticX-Website 的 `app/agents/*`。

## 启动

```bash
pnpm dev
# http://localhost:3000
```

## 聊天历史持久化

会话与消息写入 PostgreSQL（`chat_sessions` / `chat_messages`）。本地开发需 PostgreSQL 已迁移并（建议）执行 `pnpm --filter @agenticx/db-schema db:seed`，使 JWT 中的 `tenantId` / `userId` 与 `users` 表外键一致。

- `GET/POST /api/chat/sessions`、`PATCH/DELETE /api/chat/sessions/:sessionId`
- `GET/POST /api/chat/sessions/:sessionId/messages`（`POST` 支持 `replace_all: true` 覆盖同步）
- `POST /api/chat/completions` 需请求头 `x-chat-session-id`，且会话须属于当前登录用户

## 组装来源

- `@agenticx/feature-chat` — 对话工作区
- `@agenticx/feature-model-service` — 模型服务面板
- `@agenticx/feature-knowledge-base` — 知识库
- `@agenticx/feature-settings` — 设置面板
- `@agenticx/auth` — 登录 / SSO
- `@agenticx/branding` — 白标
