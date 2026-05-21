# Internal API（Gateway ↔ Admin）

> Admin 源码：`apps/admin-console/src/app/api/internal/`  
> Gateway 客户端：`apps/gateway/internal/gatewayinternal/`

Admin Console 暴露一组 **仅 Gateway 调用** 的内部路由，用于 Vercel 分体部署或本地轮询配置。

---

## 认证

```
Authorization: Bearer <GATEWAY_INTERNAL_TOKEN>
```

- Admin 侧：`apps/admin-console/src/lib/gateway-internal-auth.ts` → `isGatewayInternalAuthorized()`
- Gateway 侧：`internal/gatewayinternal/` HTTP GET 附带相同 Bearer
- 两端环境变量 **必须一致**，否则 401

---

## 路由清单

| 方法 | 路径 | 响应 | Gateway 环境变量 |
|---|---|---|---|
| GET | `/api/internal/providers` | `{ providers: [...] }` | `GATEWAY_REMOTE_PROVIDERS_URL` |
| GET | `/api/internal/quotas` | 租户配额 JSON | `GATEWAY_REMOTE_QUOTA_CONFIG_URL` |
| GET | `/api/internal/policy-snapshot` | 已发布策略快照 | `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` |
| GET | `/api/internal/channels` | `{ channels: [...] }` | `GATEWAY_REMOTE_CHANNELS_URL` |

所有路由 `dynamic = "force-dynamic"`，`Cache-Control: no-store`。

---

## 轮询行为

| 配置 | 间隔 | 说明 |
|---|---|---|
| Providers | ~5s | 含解密后的 upstream 路由信息 |
| Quota | ~10s 本地缓存 | 租户 TPM/QPM 等 |
| Policy snapshot | 内容 hash 变化时热加载 | 仅 **已发布** 规则 |
| Channels | ~5s | 需 `GATEWAY_CHANNEL_REGISTRY=on` |

未配置 `GATEWAY_REMOTE_*_URL` 时，Gateway 回退本地文件或 PG 直读。

---

## Providers 响应形状（概要）

每条 provider 含：

- `provider_id`, `display_name`, `base_url`
- `enabled`, `route`（`local` / `private-cloud` / `third-party`）
- `models[]` — model id、displayName、enabled
- `api_key` — 运行时解密后注入（**仅 internal 响应**，勿暴露给浏览器）

加密存储：`enterprise_runtime_model_providers.api_key_cipher`  
加密密钥：`AGX_PROVIDER_SECRET_KEY`（32 字节 AES-256-GCM）

---

## Policy Snapshot 响应

等价于 `.runtime/admin/policy-snapshot.json`：

- 合并 plugins manifest + PG 已发布规则
- `extends` 链在 Go loader 解析（**extends 为单字符串**，非数组）
- Gateway Go 引擎识别 `keyword` / `regex` / `pii`（不含 `keyword-list`）

---

## Channels 响应

对应表 `gateway_channels`：

- `id`, `name`, `provider_id`, `base_url`, `weight`, `priority`
- `route`, `enabled`, `metadata`
- API Key 字段（cipher 或 env 引用）

健康聚合：admin `GET /api/admin/channels/health` 调用 Gateway `GATEWAY_INTERNAL_BASE_URL`（默认可能为 `:8080`，部署时注意与 `:8088` 对齐）。

---

## Vercel 部署示例

Admin 部署在 `https://admin.example.com`：

```bash
GATEWAY_REMOTE_PROVIDERS_URL=https://admin.example.com/api/internal/providers
GATEWAY_REMOTE_QUOTA_CONFIG_URL=https://admin.example.com/api/internal/quotas
GATEWAY_REMOTE_POLICY_SNAPSHOT_URL=https://admin.example.com/api/internal/policy-snapshot
GATEWAY_REMOTE_CHANNELS_URL=https://admin.example.com/api/internal/channels
GATEWAY_INTERNAL_TOKEN=<shared-secret>
```

Gateway 进程还需：`AUTH_JWT_PUBLIC_KEY`、`DATABASE_URL`（审计/计量 PG 双写）。

完整 env 清单：[deployment/vercel-env-checklist.md](../deployment/vercel-env-checklist.md)。

---

## 安全注意

- Internal 路由**不得**对公网无防护暴露；应网络 ACL 或 mTLS
- 响应含明文 API Key，禁止 CDN 缓存
- 轮换 `GATEWAY_INTERNAL_TOKEN` 需同时更新 admin + 所有 gateway 实例
