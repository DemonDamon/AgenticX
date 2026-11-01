# ECP 平台租户环境变量

专家包 grant 时，成员 skill/MCP 模板解析自 **平台租户** 上的 `enterprise_skills` / `mcp_servers` 行（见 `expert-package-sync.ts` · `platformTenantId()`）。

## 变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ECP_PLATFORM_TENANT_ID` | 专家包 grant **强烈建议** | 平台运营侧模板租户 ULID；与业务租户隔离 |
| `DEFAULT_TENANT_ID` | 回退 | 未设置 `ECP_PLATFORM_TENANT_ID` 时使用；单租户 dev 可共用，**多租户生产应显式设置 ECP 变量** |

## 行为

- 缺失两者：`syncExpertPackageToTenant` / 成员解析抛出 `ECP_PLATFORM_TENANT_ID or DEFAULT_TENANT_ID is required`（错误码 `platform_tenant_unconfigured`）。
- 平台 catalog publish 的审批 `operatorTenantId` 默认也读 `DEFAULT_TENANT_ID`。

## 推荐部署

1. 创建专用租户（如 `code=platform`），写入 `ECP_PLATFORM_TENANT_ID`。
2. 在该租户维护专家包 manifest 引用的模板 skill/MCP。
3. 业务租户仅通过 grant 接收物化 pack，不复制模板租户整库。

## 本地 / CI

```bash
export DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/agenticx'
export ECP_PLATFORM_TENANT_ID='<platform-tenant-ulid>'
export DEFAULT_TENANT_ID='<tenant-a-ulid>'   # portal 单租户 dev

pnpm -C enterprise/packages/db-schema db:migrate:pg
pnpm -C enterprise/apps/admin-console test -- ecp-e5-closed-loop.pg
```

PG 铜管测试在 **无 `DATABASE_URL`** 时自动 skip，不失败 CI。
