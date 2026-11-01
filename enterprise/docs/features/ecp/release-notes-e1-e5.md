# ECP E1–E5 联合发版说明

面向 **AGX 企业能力平台** 可复用主线（非单客户交付包）。

## Highlights

### E1 · 跨租户分发

- 平台目录 grant/revoke；租户侧平台物只读元数据。
- 默认 revoke：`retain_stop_updates`（停更、保留已同步副本）。

### E2 · 货架生命周期

- `draft → published → deprecated`；发布前强制 scan。
- 草稿不可进入 Portal/bootstrap 注入路径。

### E3 · 可插拔审核

- 申请单 + 1～N 级节点；预设「企管单级」「企管+平台」。
- 未 consumed 的 approved 申请不可 publish。

### E4 · 专家包产品化

- `expert_package` catalog 类型；manifest（2 skill + 1 MCP）grant 后物化为 Capability Pack。
- `install_copy_enabled` 企业策略，**默认 false**（纯授权引用）。

### E5 · 硬化与闭环 E2E

- 权限矩阵、审计事件、错误码、环境变量文档。
- 自动化 synthetic + 可选 PG 铜管测试（master §8 `e2e-enterprise-capability-platform`）。

## Revoke × 安装副本

| 模式 | revoke 默认 `retain_stop_updates` | revoke `strip_bootstrap` |
|---|---|---|
| grant-only（`install_copy_enabled=false`） | 停更；租户 skill/pack 仍 active | 停更；skill/pack **disabled** |
| install copy（`install_copy_enabled=true`） | 停更；**保留** install 副本行 | 停更；副本与 pack **disabled** |

新 bootstrap 在 revoke 后不再拉取 catalog **新版本**（`shouldPushCatalogUpdateToTenant` / `isCatalogUpdateVisibleToTenant`）。

## 升级注意

1. 运行 PG/MySQL migrations `0071–0074`（或 MySQL `0045–0048`）。
2. 配置 `ECP_PLATFORM_TENANT_ID` 指向平台模板租户（见 [platform-tenant-env.md](./platform-tenant-env.md)）。
3. Desktop 闭环需在本地验证 `enterprise-sync-capabilities`；云端 CI 不替代 Mac UI 铜管。

## 相关

- [permission-matrix.md](./permission-matrix.md)
- [error-codes.md](./error-codes.md)
- Master plan §8 验收表
