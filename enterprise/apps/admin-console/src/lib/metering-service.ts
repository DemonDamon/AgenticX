import { MeteringApi, MeteringService, type MeteringGroupKey } from "@agenticx/feature-metering";

const service = new MeteringService();
const api = new MeteringApi(service);

// 与 enterprise/scripts/bootstrap.sh 默认值保持一致（dev 默认租户 ULID）。
// 注意：此处必须按调用时取 env，不能在模块顶层缓存；否则 .env.local 注入或修改后
// 必须重启 admin-console 进程才能生效，会导致 metering 长期查到空集。
const FALLBACK_TENANT_ID = "01J00000000000000000000001";

function resolveTenantId(): string {
  const value = process.env.DEFAULT_TENANT_ID?.trim();
  return value && value.length > 0 ? value : FALLBACK_TENANT_ID;
}

export async function queryMetering(input: {
  dept_id?: string[];
  user_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  group_by: MeteringGroupKey[];
}) {
  return api.query({
    tenant_id: resolveTenantId(),
    ...input,
  });
}

