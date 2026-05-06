# 性能基线归档（可选）

用于存档手工 `k6` / 压测摘要，便于版本对比与客户验收材料引用。

## SSO OIDC

- 脚本：`enterprise/scripts/perf/sso-200-concurrent.js`
- 建议文件名：`enterprise/docs/perf-baselines/sso-start-YYYYMMDD.txt`（直接粘贴 k6 终端摘要）

CI：可在单独 workflow 里夜间触发 k6，将摘要 artifact 上传；主仓不强制。
