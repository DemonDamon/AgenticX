# 性能基线归档（可选）

仓库**没有**已发布的历史压测数字或 CI 基线。本目录只用来存档你手工跑的 `k6` / 压测摘要，便于版本对比与验收材料引用。客户方案里不要写「仓库已有 ≥N 并发基线」。

## SSO OIDC

- 脚本：`enterprise/scripts/perf/sso-200-concurrent.js`
- 建议文件名：`enterprise/docs/perf-baselines/sso-start-YYYYMMDD.txt`（直接粘贴 k6 终端摘要）

CI：可在单独 workflow 里夜间触发 k6，将摘要 artifact 上传；主仓不强制。
