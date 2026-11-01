# ECP 审计事件（逻辑点）

ECP 当前以 **业务表时间戳 + 审批步骤表** 为主审计载体；网关 `gateway_audit_events` 与 IAM `audit_events` 仍用于聊天/管理操作，以下列出 ECP 域内应对齐的逻辑事件，便于接入统一审计管道。

## 平台目录

| 事件 | 触发 | 建议 payload |
|---|---|---|
| `ecp.catalog_item.created` | `createCatalogItem` | `catalogItemId`, `resourceType`, `slug` |
| `ecp.catalog_version.created` | `createCatalogVersion` | `catalogItemId`, `versionId`, `version` |
| `ecp.catalog_version.scanned` | `recordCatalogVersionScan` | `versionId`, `scanVerdict`, `scanSource` |
| `ecp.catalog_version.published` | `publishCatalogVersion` | `catalogItemId`, `versionId`, `operatorTenantId` |
| `ecp.catalog_item.deprecated` | `deprecateCatalogItem` | `catalogItemId` |

## 分发

| 事件 | 触发 | 建议 payload |
|---|---|---|
| `ecp.grant.created` | `grantCatalogToTenant` | `catalogItemId`, `tenantId` |
| `ecp.grant.reactivated` | 对已 revoke 行再次 grant | 同上 |
| `ecp.grant.revoked` | `revokeCatalogFromTenant` | `catalogItemId`, `tenantId`, `revokePolicy` |

## 租户库同步

| 事件 | 触发 | 建议 payload |
|---|---|---|
| `ecp.tenant_skill.upserted` | grant / catalog 更新推送 | `tenantId`, `skillId`, `platformCatalogItemId` |
| `ecp.expert_package.synced` | `syncExpertPackageToTenant` | `tenantId`, `packId`, `capabilityIds[]` |
| `ecp.expert_package.revoke_applied` | `applyExpertPackageRevoke` | `tenantId`, `catalogItemId`, `policy` |

## 审批（E3）

| 事件 | 触发 | 建议 payload |
|---|---|---|
| `ecp.approval.requested` | 创建申请单 | `requestId`, `action`, `resourceType`, `resourceId` |
| `ecp.approval.step.passed` | 节点通过 | `requestId`, `stepOrder`, `actorScope` |
| `ecp.approval.step.failed` | 节点驳回 | `requestId`, `stepOrder`, `note` |
| `ecp.approval.consumed` | publish 消费申请 | `requestId` |

## 租户策略

| 事件 | 触发 | 建议 payload |
|---|---|---|
| `ecp.distribution_policy.updated` | `updateEcpTenantDistributionPolicy` | `tenantId`, `installCopyEnabled` |
