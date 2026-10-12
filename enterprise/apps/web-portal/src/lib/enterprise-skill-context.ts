import {
  capabilityStatesFromView,
  loadUserCapabilityView,
} from "./capability-packs-reader";
import { loadSkillBody } from "./enterprise-skill-bundle";
import {
  buildEnterpriseSkillBlock,
  withEnterpriseSkillContext,
  type SkillPromptSource,
} from "./enterprise-skill-prompt";
import { log } from "./observability/logger";

type Message = { role: string; content?: string | null; tool_calls?: unknown };

export async function applyAssignedSkillPrompt<T extends Message>(input: {
  messages: T[];
  userId: string;
  email?: string;
  deptId?: string | null;
  focusedId: string | null;
}): Promise<T[]> {
  let view: Awaited<ReturnType<typeof loadUserCapabilityView>> | null = null;
  try {
    view = await loadUserCapabilityView(input.userId, input.email, input.deptId);
  } catch {
    return input.messages;
  }
  if (!view) return input.messages;
  const states = capabilityStatesFromView(view).filter((item) => item.kind === "skill");
  const catalog: SkillPromptSource[] = states.map((item) => ({
    id: item.id,
    displayName: item.displayName,
    description: item.description ?? "",
    scanVerdict: item.scanVerdict ?? null,
    status: "active",
    optedOut: item.state !== "on",
    body: null,
  }));
  const focused = catalog.find((item) => item.id === input.focusedId && item.scanVerdict === "safe" && !item.optedOut);
  if (focused) {
    const source = states.find((item) => item.id === focused.id);
    const body = await loadSkillBody(source?.bundleUri || null);
    if (!body) {
      log("warn", { event: "chat.skill_bundle_skipped", skill_id: focused.id });
    }
    focused.body = body;
  }
  const block = buildEnterpriseSkillBlock({ catalog, focusedId: focused?.body ? focused.id : null });
  return withEnterpriseSkillContext(input.messages, block);
}
