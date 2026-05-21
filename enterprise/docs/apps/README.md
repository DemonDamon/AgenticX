# Apps 可部署单元

目录：`enterprise/apps/`

---

## 总览

> 状态图例：✅ 已实现 · 🟡 部分 · ⚪ Stub · ⛔ Skeleton（详见 [docs/README.md](../README.md)）

| App | 技术 | 端口 | Workspace | 状态 |
|---|---|---|---|---|
| web-portal | Next.js 15 | 3000 | pnpm | ✅ |
| admin-console | Next.js 15 | 3001 | pnpm | ✅ |
| gateway | Go 1.25 | 8088 | go.mod 独立 | ✅ |
| edge-agent | Go | 7823（设计） | — | ⛔ |

---

## web-portal — `@agenticx/app-web-portal`

**用户**：企业员工

**能力**

- 登录 / 注册 / SSO
- 聊天工作区（`@agenticx/feature-chat`）
- 模型下拉（admin 分配可见模型）
- 会话历史 PG 持久化
- Token 用量 chip

**页面**：`/`, `/auth`, `/workspace`

**API**：见 [api/web-portal.md](../api/web-portal.md)

**启动**

```bash
pnpm --filter @agenticx/app-web-portal dev
# 或 bash scripts/start-dev.sh
```

---

## admin-console — `@agenticx/app-admin-console`

**用户**：租户管理员 / 安全管理员

**能力**

- IAM（用户/部门/角色/批量导入）
- 策略规则中心（draft/publish/rollback/test）
- 网关审计查询与链校验
- Token 计量与配额
- 模型服务（Provider/Key/模型列表/用户可见性）
- Gateway Channel 管理与健康
- SSO Provider CRUD

**页面**：见 [api/admin-console.md](../api/admin-console.md)

**Store 层**（尚未完全下沉到 features）

- `lib/model-providers-store.ts`
- `lib/gateway-channels-store.ts`
- `lib/gateway-internal-auth.ts`

**启动**

```bash
pnpm --filter @agenticx/app-admin-console dev
```

---

## gateway — Go AI 网关

**用户**：portal（服务端代理）、外部 OpenAI 兼容客户端

**能力**

- `/v1/chat/completions`, `/v1/embeddings`
- JWT 主体透传
- 策略三通道评估
- 审计 JSONL + PG 双写
- Token 计量
- 配额 tracker
- Channel 中继（可选）
- 远程拉取 admin internal 配置

**文档**

- [api/gateway.md](../api/gateway.md)
- [gateway/overview.md](../gateway/overview.md)
- [apps/gateway/README.md](../../apps/gateway/README.md)

**构建**

```bash
cd apps/gateway && go build -o bin/gateway ./cmd/gateway
```

`start-dev.sh` 会自动 `go run` gateway。

---

## edge-agent — 端侧 Sidecar

**设计目标**

- 本地 Ollama 路由
- Workspace 沙箱
- 脱敏审计上送

**现状**

- `cmd/edge-agent/main.go` ~33 行 skeleton
- 有 `README.md`、`docs/security-model.md`
- **不可演示**；Machi Desktop 实际走内嵌 `agx serve`，不经此组件

**文档缺口**：`docs/api.md`（README 引用但未创建）

---

## 进程依赖关系

```
start-dev.sh
  ├── gateway :8088
  ├── web-portal :3000  → 依赖 gateway + PG
  └── admin-console :3001 → 依赖 PG；gateway 拉 internal API
```

Postgres/Redis：`start-dev-with-infra.sh` 或外部 `DATABASE_URL`。

---

## Docker 部署

| 组件 | Dockerfile |
|---|---|
| gateway | `apps/gateway/Dockerfile` |
| portal/admin | 各 app 自建或使用 turbo build + Node 镜像 |

Compose 模板：`deploy/docker-compose/prod.yml`（nginx + 双 gateway 示例）

---

## 与客户 App 关系

`pnpm-workspace.yaml` 可选纳入 `../customers/*/apps/*`：

- 客户 portal 通常 `:3100`，admin `:3101`
- `start-dev.sh --all` 同时拉起

客户 app 是**组装壳**，引用 `@agenticx/feature-*` 与 `@agenticx/ui`。
