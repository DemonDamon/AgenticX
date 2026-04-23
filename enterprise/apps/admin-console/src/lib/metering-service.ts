import { MeteringApi, MeteringService, type MeteringGroupKey } from "@agenticx/feature-metering";

const service = new MeteringService();
const api = new MeteringApi(service);
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ?? "01J00000000000000000000001";

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
    tenant_id: DEFAULT_TENANT_ID,
    ...input,
  });
}

