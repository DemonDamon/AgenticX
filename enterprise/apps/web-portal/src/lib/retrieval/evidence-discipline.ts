/**
 * Shared synthesis constraint for ordinary search and deep research.
 *
 * This deliberately stays semantic: it adds no intent regex, provider branch,
 * model round trip, or search request.
 */
export const EVIDENCE_DISCIPLINE_HINT =
  "在当前回答或章节范围内，多实体须逐项取证，缺项分别说明，禁止证据错配。" +
  "‘普遍’‘一边倒’‘风评转变’等趋势结论须至少两个独立来源，并由正文证据比较两个可比时间状态；" +
  "转载不算独立，否则降级为‘部分讨论’并标明不确定性。";
