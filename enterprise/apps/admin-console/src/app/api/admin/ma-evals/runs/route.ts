import {
  getAgentVersion,
  getMaEnvironment,
  listEvalDatasetItems,
  listEvalDatasets,
  listEvalRubrics,
  listEvalRuns,
} from "@agenticx/iam-core";

import { requireAdminScope } from "../../../../../lib/admin-auth";
import { toEvalRunView } from "../../../../../lib/ma/eval-records";
import { runtimeInternal } from "../../../../../lib/ma/runtime-internal-client";
import { assertKeys, evalErrorResponse, fail, ok, readAdminJson, requiredTenantId } from "../shared";

export const dynamic = "force-dynamic";

const MODEL_RE = /^[^/\s]+\/\S+$/;

function isCloudEnvironment(type: string): boolean {
  return type === "cloud";
}

export async function GET(request: Request) {
  const auth = await requireAdminScope(["provider:read"]);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agent_id") || undefined;
    const cursor = url.searchParams.get("cursor");
    const limit = Number(url.searchParams.get("limit") || "50");
    const page = await listEvalRuns(requiredTenantId(), { agentId, cursor, limit });
    return ok({ runs: page.items.map(toEvalRunView), next_cursor: page.nextCursor });
  } catch (error) {
    return evalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminScope(["provider:update"]);
  if (!auth.ok) return auth.response;
  try {
    const body = await readAdminJson(request);
    assertKeys(body, ["agent_id", "agent_version", "environment_id", "dataset_id", "rubric_id", "memory_store_ids", "concurrency"]);
    const tenantId = requiredTenantId();
    const agentId = String(body.agent_id ?? "");
    const agentVersion = Number(body.agent_version);
    if (!agentId || !Number.isInteger(agentVersion) || agentVersion < 1) return fail(400, "请选择智能体版本");
    await getAgentVersion(tenantId, agentId, agentVersion);
    const environmentId = body.environment_id == null || body.environment_id === "" ? null : String(body.environment_id);
    if (environmentId && environmentId !== "local") {
      const environment = await getMaEnvironment(tenantId, environmentId);
      if (!isCloudEnvironment(environment.type)) return fail(400, "评测只支持云端环境");
    }
    const datasetId = String(body.dataset_id ?? "");
    const dataset = (await listEvalDatasets(tenantId)).find((item) => item.id === datasetId);
    if (!dataset) return fail(404, "评测集不存在");
    const items = await listEvalDatasetItems(tenantId, datasetId);
    if (items.length === 0) return fail(400, "评测集没有用例");
    const rubricId = String(body.rubric_id ?? "");
    const rubric = (await listEvalRubrics(tenantId)).find((item) => item.id === rubricId);
    if (!rubric) return fail(404, "评分标准不存在");
    const stores = Array.isArray(body.memory_store_ids) ? body.memory_store_ids.map(String) : [];
    if (stores.length > 8) return fail(400, "最多挂载 8 个记忆库");
    const concurrency = body.concurrency == null ? 2 : Number(body.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) return fail(400, "并发数须为 1–4");
    const content = rubric.content;
    const snapshot = {
      tenant_id: tenantId,
      created_by_user_id: auth.session.userId,
      agent_id: agentId,
      agent_version: agentVersion,
      environment_id: environmentId,
      dataset: {
        id: dataset.id,
        name: dataset.name,
        items: items.map((item) => ({
          id: item.id,
          position: item.position,
          query: item.query,
          expected_answer: item.expectedAnswer,
          expected_tool_trace: item.expectedToolTrace,
        })),
      },
      rubric: { id: rubric.id, name: rubric.name, version: rubric.version, content },
      memory_store_ids: stores,
      concurrency,
    };
    if (typeof content.judge_model === "string" && !MODEL_RE.test(content.judge_model)) {
      return fail(400, "裁判模型不合法");
    }
    const created = await runtimeInternal<{ run: unknown }>("POST", "/internal/ma/eval-runs", snapshot);
    return ok(created, 201);
  } catch (error) {
    return evalErrorResponse(error);
  }
}
