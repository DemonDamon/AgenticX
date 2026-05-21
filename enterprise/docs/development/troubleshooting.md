# 排障指南

常见问题与处置。更完整脚本说明见 [../scripts/README.md](../scripts/README.md)。

---

## 启动与环境

| 现象 | 原因 | 处置 |
|---|---|---|
| `start-dev.sh` 报缺 `AUTH_JWT_*` | 未 bootstrap 或 PEM 被删 | `bash scripts/bootstrap.sh` |
| 前台 `chat history operation failed` | PG/Redis 未起 | `bash scripts/start-dev-with-infra.sh` |
| 端口占用 3000/3001/8088 | 旧进程 | `lsof -i :8088` 后 kill |
| Turbo TUI Ctrl+C 无反应 | TUI 捕获信号 | 先 Esc 再 q，或 `--ui=stream` |
| 手动 pnpm 前台登录缺 JWT key | 未展开 `*_FILE` | 见 [local-dev.md](./local-dev.md) 手动 export |

---

## 登录与 IAM

| 现象 | 原因 | 处置 |
|---|---|---|
| admin 密码错误 | seed 后改了 password env | 重跑 bootstrap 或 `reset-dev-data.sh --with-seed` |
| `staff@...` Invalid credentials | 无此种子用户 | 用 owner 或后台创建 |
| 前台无模型可选 | 未分配可见模型 / PG 空 | admin 模型服务 + 用户可见模型；或 `migrate:legacy-runtime` |
| IAM 403 | scope 不足 | 查 [rbac/scopes.md](../rbac/scopes.md) |

---

## Gateway 与模型

| 现象 | 原因 | 处置 |
|---|---|---|
| 只有 mock 回复 | 无 Key | admin 配 Provider 或 env `*_API_KEY` |
| 策略不拦截 | 快照路径错 / 未发布 | 确认 `policy-snapshot` 路径；admin 点发布；重启 gateway |
| 规则已保存仍不生效 | userIds 占位不匹配 | applies_to 留空或填真实 id |
| blocked=false 但选了拦截 | 测试接口用库内旧 action | 用 `/api/policy/test` 合并表单预览 |
| Channel 不健康 | `GATEWAY_INTERNAL_BASE_URL` 端口错 | 对齐 8088 与 internal token |

---

## 策略与审计

| 现象 | 原因 | 处置 |
|---|---|---|
| reset `--full` 后无策略命中 | 快照被清 | admin 重新发布 + 重启 gateway |
| 后台有审计、PG  pending 涨 | PG 短暂不可用 | [runbooks/audit-pg-backfill.md](../runbooks/audit-pg-backfill.md) |
| 部门审计 403 | 缺 `audit:read:dept` | 升级角色 scopes |

---

## SSO

| 现象 | 原因 | 处置 |
|---|---|---|
| SSO 按钮不显示 | 未配 `NEXT_PUBLIC_SSO_PROVIDERS` | 配 env 并**完整重启** Next 进程 |
| `oidc.discovery_failed` | issuer 不可达或占位 | `pnpm sso:oidc-smoke` 自检 |
| 改 SSO env 不生效 | Next 热更新不读 env | 完整重启 admin + portal |

Runbooks：[sso-oidc-setup.md](../runbooks/sso-oidc-setup.md) · [sso-saml-setup.md](../runbooks/sso-saml-setup.md)

---

## Vercel 分体部署

| 现象 | 原因 | 处置 |
|---|---|---|
| Gateway 空 providers | `GATEWAY_REMOTE_*` URL 错 / token 不一致 | [internal-api.md](../api/internal-api.md) |
| 前台 0 条历史、后台有数据 | 不同 DATABASE_URL | 核对 Vercel env |
| Token 永远 0 | usage 未回写 | 确认 gateway DATABASE_URL 与 portal 同库 |

清单：[deployment/vercel-env-checklist.md](../deployment/vercel-env-checklist.md)

---

## E2E / 视觉

| 现象 | 原因 | 处置 |
|---|---|---|
| chromium not found | 未装 Playwright | `pnpm visual-tour:install` |
| visual-tour 超时 | 未起 dev server / 未 export 密码 | 先 `start-dev.sh`，export 登录密码 |

---

## 日志位置

| 组件 | 日志 |
|---|---|
| Gateway 审计 JSONL | `apps/gateway/.runtime/audit/` |
| Gateway 计量 JSONL | `GATEWAY_USAGE_LOG` 或 `apps/gateway/.runtime/usage.jsonl` |
| PG pending 审计 | `apps/gateway/.runtime/audit/.pg-pending` |
| Quota 本地 | `.runtime/gateway/quota-usage.json` |

---

## 获取帮助

1. 确认 `DATABASE_URL` 指向预期库（尤其 reset 脚本会 echo URL）
2. `curl --noproxy '*' http://127.0.0.1:8088/healthz`
3. Admin `GET /api/gateway/health`
4. Gateway 进程日志（`--ui=stream` 模式）
