# ECP 权限矩阵

> 范围：企业能力平台（平台目录、分发、货架、审批、专家包）。不含客户交付包专属流程。

## 角色

| 角色 | 标识 | 典型 scope / 入口 |
|---|---|---|
| 平台运营 | `platform_operator` | Internal API `/api/admin/platform-catalog`、平台审批节点、`ECP_PLATFORM_TENANT_ID` 租户上的模板 skill/MCP |
| 租户管理员 | `enterprise_admin` | 租户内 skill/pack、二次分配、租户审批预设、分发策略（安装副本开关） |
| 租户成员 | portal 用户 | 只读：经 pack 分配 + bootstrap 可见的能力；不可改平台下发元数据 |

## 能力 × 动作

| 对象 | 平台运营 | 租户 admin | 租户成员 |
|---|---|---|---|
| 平台目录项（skill / expert_package） | 创建、版本、scan、publish、grant/revoke | 不可改元数据；可见已 grant 条目 | 不可见未 grant 条目 |
| 租户库 skill（`origin=platform`） | 通过 grant 同步 | 可分配、可停用；**不可** PATCH 元数据 | 按 pack 分配可见 |
| 租户库 skill（`origin=tenant`） | — | 全 CRUD + publish | 按 pack 分配可见 |
| Capability Pack（`origin=platform`） | 通过 expert_package grant 物化 | 可改 **assignmentKeys**；不可改成员/元数据 | 按 assignment 可见 |
| Capability Pack（`origin=tenant`） | — | 全 CRUD | 按 assignment 可见 |
| 审批申请 | 平台节点审批 | 企管节点审批、提交 introduce | 可提交 introduce（若开放） |
| 分发策略 `install_copy_enabled` | — | 读写租户级策略 | — |

## 只读元数据（E1）

对 `enterprise_skills.origin === "platform"` 或 pack `origin === "platform"`：

- Admin `updateSkill` / `updateCapabilityPack` 修改 displayName、slug、bundle 等 → **403**（`PlatformSkillMetadataReadonlyError` / `PlatformPackMetadataReadonlyError`）
- 允许：`status`（企业停用）、`assignmentKeys`（二次分配）

## Revoke 策略

| 策略 | 平台 grant 行 | bootstrap 更新 | 已同步副本 |
|---|---|---|---|
| `retain_stop_updates`（默认） | `revoked` | 不再推送 catalog 新版本 | 保持 `active`（grant-only） |
| `strip_bootstrap` | `revoked` | 不再推送 | skill/pack 置 `disabled` |

`install_copy_enabled=true` 时 revoke 语义见 [release-notes-e1-e5.md](./release-notes-e1-e5.md) 与 `@agenticx/config` · `resolveExpertPackageRevokeEffect`。
