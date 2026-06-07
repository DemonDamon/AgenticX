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

CI：可在单独 workflow 里夜间触发 k6，将摘要或 JSON artifact 上传；主仓不强制。
