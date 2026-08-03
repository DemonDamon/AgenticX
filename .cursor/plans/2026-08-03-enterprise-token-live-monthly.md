# Enterprise Token 月度统计与实时刷新

## 目标

修复企业版门户月度 Token 用量与日/周不一致、需要刷新页面才更新的问题。

## 实现

- 网关继续保留 `quota-usage.json` 作为兼容账本，同时把用户月度用量镜像到 `gateway_quota_pool_usage` 的 `tok_month` 记录；本地环境使用现有 pool JSON 降级。
- 月度读取优先共享月度记录，并在迁移期与旧文件取较大值，避免跨进程/跨副本低报。
- 结算与回滚同步月度记录，避免 reserve、settle、refund 重复或遗漏。
- 门户 Token 卡片在回答流完成事件、窗口重新获得焦点、页面恢复可见时刷新，并以 5 秒轮询兜底；后台刷新失败保留最后一次成功展示。

## 验证

- `go test ./internal/quota`
- IAM quota-remaining 与 SDK HTTP stream 定向 Vitest
- 门户 quota summary 路由定向 Vitest
- IAM、SDK TypeScript typecheck

## 备注

门户全量 TypeScript 检查仍受仓库既有的 `react-dom`、视频探针测试和 `pdfjs-dist` 类型错误影响，本 feature 文件未引入这些错误。
