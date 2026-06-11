# 性能基线归档

用于存档 **k6 / 压测** 结构化结果，便于版本对比与客户验收材料引用。

## 网关 Chat（/v1/chat/completions）

| 项 | 说明 |
|---|---|
| 方法文档 | [gateway-baseline-report.md](./gateway-baseline-report.md) |
| 一键脚本 | `bash enterprise/scripts/perf/run-gateway-baseline.sh` |
| k6 脚本 | `enterprise/scripts/perf/gateway-chat-*.js` |
| Mock 上游 | `enterprise/scripts/perf/mock-upstream/` |
| 基线 JSON | `gateway-chat-YYYYMMDD-<commit>.json` |

**注意**：基线使用 mock 上游隔离网关开销；**单机实测 ≠ 生产 SLA**。报告内须区分实测与估算。

## SSO OIDC

- 脚本：`enterprise/scripts/perf/sso-200-concurrent.js`
- 建议文件名：`sso-start-YYYYMMDD.txt`（粘贴 k6 终端摘要）

## 应用全链路 200 并发（登录 + 对话）

| 项 | 说明 |
|---|---|
| 端点契约 | [APP_ENDPOINTS.md](../../scripts/perf/APP_ENDPOINTS.md) |
| k6 脚本 | `enterprise/scripts/perf/app-login-chat-200.js` |
| 一键脚本 | `bash enterprise/scripts/perf/run-app-baseline.sh` |
| 基线 JSON | `app-login-chat-YYYYMMDD-<commit>.json` |

**与网关层基线的区别**：`run-gateway-baseline.sh` 只压 `/v1/chat/completions`（mock upstream 隔离网关开销）；`run-app-baseline.sh` 走 web-portal 的 `POST /api/auth/login` → `POST /api/chat/sessions` → `POST /api/chat/completions`，更贴近规范书 1.1.13「200 账号并发登录及对话」验收。

**跑法**：

```bash
# 1. 起中间件 + 应用栈
bash enterprise/scripts/start-dev-with-infra.sh

# 2. 另开终端：让 portal 指向 perf mock 网关（与脚本默认 18088 一致）
export GATEWAY_COMPLETIONS_URL=http://127.0.0.1:18088/v1/chat/completions
# 重启 web-portal 使 env 生效

# 3. 跑全链路基线（会自启 mock upstream + perf gateway）
export APP_PERF_PASSWORD="${AUTH_DEV_OWNER_PASSWORD:-change-me}"
bash enterprise/scripts/perf/run-app-baseline.sh
```

**验收映射（规范书 1.1.13）**：k6 场景 ramp `0→50(30s)→200(30s)→200(60s)`；通过标准以现场 4C/8G 环境 P95≤800ms 为目标，本地 dev 脚本默认阈值较宽松（P95<5000ms）避免误伤。

CI：可在单独 workflow 里夜间触发 k6，将摘要或 JSON artifact 上传；主仓不强制。
