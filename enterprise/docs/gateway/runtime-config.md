# Gateway 运行时配置

Enterprise 将模型服务、用户可见模型、Token 配额、策略快照 **PG 化**，Gateway 通过轮询 admin internal API 或读本地文件获取配置。

---

## 数据表

| 表 | 内容 |
|---|---|
| `enterprise_runtime_model_providers` | Provider、base_url、加密 Key、models[] |
| `enterprise_runtime_user_visible_models` | 用户 → model id 可见性 |
| `enterprise_runtime_token_quotas` | 租户配额 JSON |
| `enterprise_runtime_policy_snapshots` | 已发布策略 |
| `gateway_channels` | Channel 中继上游 |

Schema 详解：[database/schema.md](../database/schema.md)

---

## Legacy JSON 迁移

历史路径：`enterprise/.runtime/admin/`

| 文件 | 目标表 |
|---|---|
| `providers.json` | `enterprise_runtime_model_providers` |
| `user-models.json` | `enterprise_runtime_user_visible_models` |
| `quotas.json` | `enterprise_runtime_token_quotas` |

```bash
pnpm -C enterprise migrate:legacy-runtime
```

`bootstrap.sh` 与本地 `start-dev.sh`（`DATABASE_URL` 指向 localhost）自动执行。

**导入后**：admin / portal / gateway **只读 PG**；JSON 仅作一次性导入源。

---

## Admin GUI 工作流

### 模型服务（/admin/models）

1. 添加 Provider（模板或手动）
2. 填 API Key → 「检测」探活
3. 模型列表勾选 enabled
4. IAM 用户详情 → 「可见模型分配」

Gateway ~5s 内热更新，**无需重启**。

### 配额（/metering/quota）

写入 `enterprise_runtime_token_quotas.config` JSON。

Gateway `quota.Tracker` 读取；远程 URL 时 ~10s 缓存。

**现状**：以租户级配额为主；部门/用户级 TPM 需独立 plan。

### 策略（/policy）

发布 → `enterprise_runtime_policy_snapshots`

---

## Gateway 环境变量

### 远程（Vercel admin + 自建 gateway）

| 变量 | 对应 internal 路由 |
|---|---|
| `GATEWAY_REMOTE_PROVIDERS_URL` | `/api/internal/providers` |
| `GATEWAY_REMOTE_QUOTA_CONFIG_URL` | `/api/internal/quotas` |
| `GATEWAY_REMOTE_POLICY_SNAPSHOT_URL` | `/api/internal/policy-snapshot` |
| `GATEWAY_REMOTE_CHANNELS_URL` | `/api/internal/channels` |
| `GATEWAY_INTERNAL_TOKEN` | Bearer 认证 |

### 本地文件回退

| 变量 | 默认路径倾向 |
|---|---|
| `GATEWAY_ADMIN_PROVIDERS_FILE` | `.runtime/admin/providers.json` |
| `GATEWAY_QUOTA_CONFIG_FILE` | `.runtime/admin/quotas.json` |
| `GATEWAY_POLICY_SNAPSHOT_FILE` | `.runtime/admin/policy-snapshot.json` |
| `GATEWAY_POLICY_OVERRIDE_FILE` | `.runtime/admin/policy-overrides.json` |

**部署陷阱**：`policy-snapshot.json` 路径必须与实际 admin 发布路径一致；指错仓库根 `.runtime` 会导致「规则已发布但不拦截」。

---

## API Key 加密

- 算法：AES-256-GCM
- 密钥 env：`AGX_PROVIDER_SECRET_KEY`（admin 加密，gateway 解密需相同或配对的密钥分发）
- 存库字段：`api_key_cipher`（无明文）

轮换密钥需重新加密所有 provider 或批量更新。

---

## 环境变量 Key 回退

未在 PG 配置 Key 的 provider：

```
<PROVIDER>_API_KEY  →  LLM_API_KEY  →  mock
```

变量名规则：provider id 大写，`-` → `_`。

---

## 用户可见模型 vs Gateway

| 层 | 控制 |
|---|---|
| Portal | 用户能看到哪些 model id（下拉） |
| Gateway | 哪些 upstream 可调用、Key 是否有效 |

用户可见但未配置 upstream → 调用失败；配置了但未分配 → Portal 不展示。

---

## 相关文档

- [internal-api.md](../api/internal-api.md)
- [deployment/vercel-env-checklist.md](../deployment/vercel-env-checklist.md)
- [../../scripts/README.md](../../scripts/README.md) — migrate-runtime-legacy
