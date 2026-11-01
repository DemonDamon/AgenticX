# ECP 错误码

实现来源：`@agenticx/config` · `ecp-errors.ts`（`resolveEcpErrorCode`）。

| Code | 典型 HTTP | 含义 | 用户可见建议 |
|---|---|---|---|
| `approval_required` | 409 | 上架/发布需已完成审批 | 请先完成审批或联系管理员 |
| `shelf_publish_blocked` | 400 | scan 未完成或 verdict 为 dangerous | 安全扫描未通过，无法发布 |
| `platform_skill_metadata_readonly` | 403 | 修改平台下发 skill 元数据 | 平台下发技能仅可分配或停用 |
| `platform_pack_metadata_readonly` | 403 | 修改平台下发 pack 元数据 | 平台下发能力包仅可调整分配范围 |
| `expert_package_manifest_invalid` | 400 | expert_package manifest 校验失败 | 专家包成员配置无效 |
| `catalog_not_published` | 400 | 对 draft 目录 grant | 仅已发布条目可分发 |
| `platform_tenant_unconfigured` | 500 | 缺少 `ECP_PLATFORM_TENANT_ID` / `DEFAULT_TENANT_ID` | 环境未配置平台租户 |
| `approval_workflow_invalid` | 400 | 审批预设或步骤非法 | 审批配置无效 |

API 路由建议返回 JSON：

```json
{
  "error": "catalog_not_published",
  "message": "catalog item must be published before grant"
}
```

Admin Internal API 现有路由在 migration 缺失时返回 500 + relation 提示，与上表独立。
