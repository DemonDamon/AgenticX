/**
 * 企业能力（MCP / Skill / 能力包）的启用状态解析。
 *
 * 与可见模型的「级联收窄」同一个范式（见 admin-console 的 effective-models）：
 * 上级配置是上限，下级只能再收窄，永远不能放宽。这里从集合退化成布尔——
 *
 *     生效 = 已分配给该用户 且 企业启用 且 用户没有关掉
 *
 * 只有两个可写位：企业一个、用户一个，且用户那位只能做减法。不设「强制启用/
 * 默认启用/可选安装」这类分级——那是 N×M 的组合，而真正要回答的问题只有
 * 「现在这个用户能不能调用它」，多出来的档位只会让这个问题更难回答。
 */

/** 用户视角下一个能力的最终状态。 */
export type CapabilityState =
  /** 未分配，或企业已停用：用户看不到，也无法自行开启。 */
  | "unavailable"
  /** 企业已启用，用户未关闭。 */
  | "on"
  /** 企业已启用，用户自行关闭。 */
  | "off";

export type CapabilityAssignment = {
  capabilityId: string;
  /** 企业侧开关，即上限。false 等同于对该用户不存在。 */
  enterpriseEnabled: boolean;
};

/** 用户偏好只存「关掉了什么」——没有「打开了什么」，因为用户无权开启。 */
export type UserCapabilityOptOuts = ReadonlySet<string> | readonly string[];

function asOptOutSet(optOuts: UserCapabilityOptOuts | undefined): ReadonlySet<string> {
  if (!optOuts) return new Set<string>();
  return optOuts instanceof Set ? optOuts : new Set(optOuts);
}

export function resolveCapabilityState(
  enterpriseEnabled: boolean,
  disabledByUser: boolean,
): CapabilityState {
  if (!enterpriseEnabled) return "unavailable";
  return disabledByUser ? "off" : "on";
}

/**
 * 该用户实际可调用的能力 id。
 *
 * 企业停用的能力**不出现在结果里**，而不是以 disabled 形式下发——下发出去就等于
 * 指望客户端自觉，而紧急撤销恰恰不能建立在客户端自觉上。
 */
export function resolveEffectiveCapabilities(
  assignments: readonly CapabilityAssignment[],
  optOuts?: UserCapabilityOptOuts,
): string[] {
  const opted = asOptOutSet(optOuts);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of assignments) {
    const id = String(item?.capabilityId ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (resolveCapabilityState(item.enterpriseEnabled === true, opted.has(id)) === "on") {
      out.push(id);
    }
  }
  return out;
}

export type PreferenceWriteResult =
  | { accepted: true; disabledByUser: boolean }
  | { accepted: false; reason: "enterprise_disabled" };

/**
 * 校验一次用户偏好写入。
 *
 * 企业停用时请求开启必须被**拒绝**而不是静默存下：静默存下会在企业重新启用的
 * 那一刻突然生效，等于用户绕过了当时的停用决定。
 */
export function normalizeUserPreferenceWrite(
  enterpriseEnabled: boolean,
  requestedEnabled: boolean,
): PreferenceWriteResult {
  if (!enterpriseEnabled) {
    if (requestedEnabled) return { accepted: false, reason: "enterprise_disabled" };
    // 企业已停用时请求关闭是无意义但无害的，按幂等处理。
    return { accepted: true, disabledByUser: true };
  }
  return { accepted: true, disabledByUser: !requestedEnabled };
}

/** 企业停用后，用户偏好里那些已经不可用的条目可以清理掉，避免无限增长。 */
export function pruneOrphanedOptOuts(
  assignments: readonly CapabilityAssignment[],
  optOuts: UserCapabilityOptOuts,
): string[] {
  const assigned = new Set(
    assignments
      .filter((item) => item?.enterpriseEnabled === true)
      .map((item) => String(item.capabilityId ?? "").trim())
      .filter(Boolean),
  );
  return [...asOptOutSet(optOuts)].filter((id) => assigned.has(id));
}
