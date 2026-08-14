/**
 * Shared synthesis constraint for ordinary search and deep research.
 *
 * This deliberately stays semantic: it adds no intent regex, provider branch,
 * model round trip, or search request.
 */
export const EVIDENCE_DISCIPLINE_HINT =
  "在当前回答或章节范围内，多实体须逐项取证，缺项分别说明，禁止证据错配。" +
  "‘普遍’‘一边倒’‘风评转变’等趋势结论须至少两个独立来源，并由正文证据比较两个可比时间状态；" +
  "转载不算独立；证据不足时应降低断言强度或缩小结论范围，并把必要限定条件放在相关结论旁，不得单列内部置信度或信息缺口清单。" +
  "需要给出当前态或最新结论时，发布日期缺失或明显早于目标时段的单一来源不能独立支撑该断言：" +
  "要么另有近期证据佐证，要么在正文就近标注该结论所依据的时间边界。";
