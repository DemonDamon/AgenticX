import { featureCapabilityId } from "@agenticx/config";

/**
 * 「基础能力」包：联网搜索 + 深度研究，默认发给全员。
 *
 * 用来取代一条看不见的代码规则。原先「没有任何包引用这项功能时全员可用」行为是对的，
 * 但管理员在界面上看不到任何东西解释「为什么大家都有搜索」，想收回也无从下手。
 *
 * 改成真实存在的默认包之后，「全员默认有搜索」变成货架上看得见、能改能撤的一行。
 * 附件自动路由本波次没有整链，不放进这个默认包。
 */
export const DEFAULT_PACK_SLUG = "baseline-capabilities";

export const DEFAULT_PACK_INPUT = {
  slug: DEFAULT_PACK_SLUG,
  displayName: "基础能力",
  description:
    "联网搜索与深度研究。新租户默认发给全员——不想全员可用就改这个包的分配范围。",
  capabilityIds: [featureCapabilityId("web_search"), featureCapabilityId("deep_research")],
  assignmentKeys: ["all"],
} as const;

/** 这个包是否还保持「发给全员」。管理员把范围改窄之后，判定就该完全按包走。 */
export function packGrantsEveryone(assignmentKeys: readonly string[]): boolean {
  return assignmentKeys.includes("all");
}
