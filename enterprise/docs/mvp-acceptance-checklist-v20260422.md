# AgenticX Enterprise MVP 验收 Checklist（V20260422）

> 对照技术规范书 `§1.3 / §1.4 / §1.5` 的本期达成项勾选结果。

## §1.3 后台功能

- [x] 可视化后台管理入口可用（`admin-console` 登录页 + 侧栏 + 顶栏）。
- [x] 子账号管理能力具备：用户 CRUD、启用/禁用、密码重置、角色绑定、批量导入（CSV 预检/重试/进度）。
- [x] 部门树管理：上下级层级、成员归属、节点增删改查。
- [x] 四维消耗查询 UI 可用（部门→员工→厂商/模型→时间段）并支持导出。
- [x] 独立部署能力保留：`web-portal` / `admin-console` / `gateway` 分离部署。

## §1.4 AI 网关功能

- [x] 自研 Go 网关启动完成：配置加载 + `healthz` 健康检查。
- [x] OpenAI 兼容接口完成：`/v1/chat/completions`（普通响应 + SSE 流式）。
- [x] 三路路由决策完成：`local / private-cloud / third-party`（请求头 + 模型配置）。
- [x] Provider 抽象层完成（OpenAI-compatible provider，当前以 mock 输出验证契约）。
- [x] 敏感策略引擎完成：关键词（Trie）、正则、PII 基线、`block/redact/warn`。
- [x] 前后处理链路完成：入参预检拦截、出参后检脱敏、统一错误码 `9xxxx`。
- [x] E2E 拦截验证完成：3 条金融敏感 prompt 拦截率 100%。

## §1.5 日志管理与审计

- [x] AuditEvent schema 已在 `packages/core-api` 固化（字段覆盖人员/模型/路由/摘要/策略命中/校验链）。
- [x] 网关审计落盘完成：append-only JSONL + checksum 链 + 文件权限 `0600`。
- [x] 审计查询 API 完成：按租户与 RBAC 范围过滤，查询时执行链完整性校验。
- [x] 审计日志页面完成：列表、过滤、详情抽屉、CSV 导出。
- [x] usage_records 完成：网关异步上报 + PostgreSQL 存储 + 日级物化视图聚合。
- [x] 四维查询 API 完成：支持 `dept/user/provider/model/start/end/group_by` 透视返回。

## 本期验证产物

- 截图：
  - `enterprise/w4-e2e-01-portal-auth.png`
  - `enterprise/w4-e2e-02-portal-workspace.png`
  - `enterprise/w4-e2e-03-admin-audit.png`
  - `enterprise/w4-e2e-04-admin-metering.png`
- 录屏：
  - `enterprise/page@76baafc407c9ac091b5fd8e24d81e532.webm`

