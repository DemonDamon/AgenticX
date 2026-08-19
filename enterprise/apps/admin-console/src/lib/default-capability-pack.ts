import { featureCapabilityId, PLATFORM_FEATURES } from "@agenticx/config";

/**
 * 「基础能力」包：联网搜索 + 深度研究，默认发给全员。
 *
 * 这是用来取代一条看不见的代码规则的。原本的写法是「没有任何包引用这项功能时，视为
 * 还没纳管，全员可用」——行为对，但管理员在界面上看不到任何东西解释「为什么大家都有
 * 搜索」，想收回也无从下手：那不是一条可以编辑的数据，是判定函数里的一个分支。
 *
 * 改成一个真实存在的默认包之后，「全员默认有搜索」变成货架上看得见、能改能撤的一行：
 * 不想给全员，就把分配范围从 all 改成某个部门或用户组；不想要深度研究，就把它移出包。
 */
export const DEFAULT_PACK_SLUG = "baseline-capabilities";

export const DEFAULT_PACK_INPUT = {
  slug: DEFAULT_PACK_SLUG,
  displayName: "基础能力",
  description:
    "联网搜索与深度研究。新租户默认发给全员——不想全员可用就改这个包的分配范围，不用去改代码。",
  capabilityIds: PLATFORM_FEATURES.map((feature) => featureCapabilityId(feature)),
  assignmentKeys: ["all"],
} as const;

/**
 * 这个包是否还保持「发给全员」。
 *
 * 管理员把范围改窄之后，判定就该完全按包走，不再有任何兜底——否则改了不生效，
 * 比不能改更糟。
 */
export function packGrantsEveryone(assignmentKeys: readonly string[]): boolean {
  return assignmentKeys.includes("all");
}
