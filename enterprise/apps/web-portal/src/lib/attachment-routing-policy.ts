/**
 * web-portal · 只读：把「这个人有哪些可见模型」算成一份附件路由策略下发。
 *
 * 目标模型不另建一张表，而是读模型行上已有的 `capabilities`——那个字段本来就是管理
 * 员声明的自由标签（现在在用 `["text"]` / `["text","vision"]`），admin-console 已经
 * 有编辑入口。私有模型上线后把标记打上即可，不用改 schema、不用加分配 UI、不用发
 * 桌面版本。
 *
 * 「能不能用」仍然走能力包（feature:attachment_routing），和联网搜索、深度研究同一
 * 条路。两件事分开：能力包管授权，模型标记管「哪个是私有多模态的那个」。
 */

import {
  type AttachmentRoutingPolicy,
  DEFAULT_MAX_RENDERED_PAGES,
  DISABLED_ATTACHMENT_ROUTING,
  DOCUMENT_EXTENSIONS,
  MODEL_CAPABILITY_PRIVATE,
  MODEL_CAPABILITY_VISION,
  type RoutingModelRef,
} from "@agenticx/config";

import type { PortalModelOption } from "./admin-providers-reader";

function hasCapability(model: PortalModelOption, capability: string): boolean {
  return (model.capabilities ?? []).some(
    (item) => String(item ?? "").trim().toLowerCase() === capability,
  );
}

function toRef(model: PortalModelOption): RoutingModelRef {
  return {
    id: model.id,
    provider: model.provider,
    model: model.model,
    label: model.label,
  };
}

/**
 * 多个候选时按 `id` 升序取第一个。
 *
 * 只要求结果**稳定**：同一个人两次 bootstrap 必须拿到同一个目标，否则会话中途换目标
 * 会莫名其妙再切一次模型、再废一次缓存。按可见顺序取「第一个」不行——那个顺序跟着
 * provider 启停变。
 */
function pickStable(candidates: readonly PortalModelOption[]): PortalModelOption | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => left.id.localeCompare(right.id))[0]!;
}

export function buildAttachmentRoutingPolicy(
  models: readonly PortalModelOption[],
  options: { enabled: boolean; maxRenderedPages?: number },
): AttachmentRoutingPolicy {
  if (!options.enabled) return DISABLED_ATTACHMENT_ROUTING;

  const privateVision = models.filter(
    (model) =>
      hasCapability(model, MODEL_CAPABILITY_PRIVATE) &&
      hasCapability(model, MODEL_CAPABILITY_VISION),
  );
  const target = pickStable(privateVision);
  if (!target) {
    // 授权开着但没有可用目标：私有模型还没上线，或者管理员没打标记。此时必须整条
    // 关掉——否则「检测到文档」之后无处可切，只能落回公网模型，而用户已经被告知
    // 附件会留在私有部署里。宁可不生效，不能生效一半。
    return DISABLED_ATTACHMENT_ROUTING;
  }

  // 视觉兜底优先复用同一个私有模型：图片同样不该出私有部署。没有别的候选时就是它。
  const visionCandidates = models.filter((model) => hasCapability(model, MODEL_CAPABILITY_VISION));
  const visionFallback = pickStable(privateVision) ?? pickStable(visionCandidates);

  return {
    enabled: true,
    documentTarget: toRef(target),
    documentExtensions: DOCUMENT_EXTENSIONS,
    imageStrategy: "vision-fallback",
    visionFallback: visionFallback ? toRef(visionFallback) : null,
    maxRenderedPages: Math.max(1, options.maxRenderedPages ?? DEFAULT_MAX_RENDERED_PAGES),
  };
}
