/**
 * web-portal · 用户能力开关的写入。
 *
 * 只记「关掉了什么」——用户无权开启企业没给的能力，所以没有反向的表。存服务端
 * 而非本机：本机存的话换台电脑或重装就全部复原成开启，且无法审计。
 */

import { normalizeUserPreferenceWrite } from "@agenticx/config";
import { setUserOptOut } from "@agenticx/iam-core";

import { requiredCapabilityTenant } from "./capability-tables";
import {
  capabilityStatesFromView,
  loadUserCapabilityView,
  type UserCapabilityState,
} from "./capability-packs-reader";

export type SetCapabilityPreferenceResult =
  | { ok: true; capabilities: UserCapabilityState[] }
  | { ok: false; reason: "enterprise_disabled" };

/**
 * 落一次用户开关，并回读最新状态。
 *
 * 企业没启用（或没分配给你）时请求开启会被拒绝，而不是静默存下——静默存下会在
 * 企业重新启用的那一刻突然生效，等于绕过了当时的停用决定。
 */
export async function setUserCapabilityPreference(
  userId: string,
  email: string | undefined,
  deptId: string | null | undefined,
  capabilityId: string,
  enabled: boolean,
): Promise<SetCapabilityPreferenceResult> {
  const view = await loadUserCapabilityView(userId, email, deptId);
  const enterpriseEnabled = view.assigned.some((item) => item.id === capabilityId);
  const decision = normalizeUserPreferenceWrite(enterpriseEnabled, enabled);
  if (!decision.accepted) return { ok: false, reason: decision.reason };

  await setUserOptOut(requiredCapabilityTenant(), userId, capabilityId, decision.disabledByUser);

  const optOuts = new Set(view.optOuts);
  if (decision.disabledByUser) optOuts.add(capabilityId);
  else optOuts.delete(capabilityId);
  return { ok: true, capabilities: capabilityStatesFromView({ assigned: view.assigned, optOuts }) };
}
