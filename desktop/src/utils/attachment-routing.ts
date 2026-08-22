/**
 * 附件自动路由 · 桌面侧判定。
 *
 * 规则本身由企业后台在 `/api/desktop/bootstrap` 里下发（见 enterprise 的
 * packages/config/attachment-routing.ts）。Desktop 不在那个 pnpm workspace 里，拿不到
 * 那份类型，所以这里按线上格式重新声明一遍——这正是「共用数据不共用代码」的形态：
 * 扩展名清单、目标模型、页数上限只有服务端一处出处，客户端只负责执行。
 *
 * 判定必须发生在**发送之前**，而不是等回包：
 * - 用户一挂上文档，选择器就该灰掉并给出理由，而不是发完才发现被切走了；
 * - 更硬的一条——Office 文档最终会被抽成文本进上下文。先解析后决定的话，文本已经
 *   发给公网模型了才想起来要切。
 */

export type RoutingModelRef = {
  /**
   * `<provider>/<model>` 形式的全 id。
   *
   * 企业登录后 Desktop 把所有下发模型挂在**单一** `enterprise` provider 下、拿这个
   * id 当模型名（见 electron/main.ts 的 applyEnterpriseProvider）。所以三种寻址都得
   * 带着：按 provider/model 去切企业会话，会切到一个不存在的模型。
   */
  id: string;
  provider: string;
  model: string;
  label: string;
};

/** 企业登录后所有模型都挂在这个 provider 下。 */
export const ENTERPRISE_PROVIDER = "enterprise";

/** 把目标翻译成当前会话能用的 (provider, model)。 */
export function addressForSession(
  current: { provider: string } | null | undefined,
  target: RoutingModelRef,
): { provider: string; model: string } {
  if ((current?.provider ?? "").trim() === ENTERPRISE_PROVIDER) {
    return { provider: ENTERPRISE_PROVIDER, model: target.id };
  }
  return { provider: target.provider, model: target.model };
}

export type ImageStrategy = "vision-fallback" | "sticky";

export type AttachmentRoutingPolicy = {
  enabled: boolean;
  documentTarget: RoutingModelRef | null;
  documentExtensions: readonly string[];
  imageStrategy: ImageStrategy;
  visionFallback: RoutingModelRef | null;
  maxRenderedPages: number;
};

/** 没登录企业、没下发、或下发的内容不认识时的形态：什么都不做。 */
export const ATTACHMENT_ROUTING_OFF: AttachmentRoutingPolicy = {
  enabled: false,
  documentTarget: null,
  documentExtensions: [],
  imageStrategy: "vision-fallback",
  visionFallback: null,
  maxRenderedPages: 20,
};

function readModelRef(raw: unknown): RoutingModelRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const provider = typeof src.provider === "string" ? src.provider.trim() : "";
  const model = typeof src.model === "string" ? src.model.trim() : "";
  if (!provider || !model) return null;
  const label = typeof src.label === "string" && src.label.trim() ? src.label.trim() : `${provider}/${model}`;
  // 服务端漏发 id 时自己拼一个，而不是留空导致企业会话切到空模型名。
  const id = typeof src.id === "string" && src.id.trim() ? src.id.trim() : `${provider}/${model}`;
  return { id, provider, model, label };
}

/**
 * 读下发快照。**默认关**，只有明确认得的内容才启用。
 *
 * 这一点和 enterprise-capability-policy 的「默认全开、只认真正的 false」相反，是刻意
 * 的：那边配歪了当没配过，最坏是少拦一道；这边配歪了当启用，最坏是把会话锁死在一个
 * 取不到的模型上，用户既发不出消息也不知道为什么。
 */
export function readAttachmentRoutingPolicy(raw: unknown): AttachmentRoutingPolicy {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...ATTACHMENT_ROUTING_OFF };
  const src = raw as Record<string, unknown>;
  if (src.enabled !== true) return { ...ATTACHMENT_ROUTING_OFF };
  const documentTarget = readModelRef(src.documentTarget);
  // 没有目标就没有「切到哪」。整条关掉，而不是让"检测到文档但无处可切"发生——那会
  // 把附件落回公网模型，而用户已经被告知它留在私有部署里。
  if (!documentTarget) return { ...ATTACHMENT_ROUTING_OFF };
  const extensions = Array.isArray(src.documentExtensions)
    ? src.documentExtensions
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.startsWith(".") && item.length > 1)
    : [];
  if (extensions.length === 0) return { ...ATTACHMENT_ROUTING_OFF };
  const pages = Number(src.maxRenderedPages);
  return {
    enabled: true,
    documentTarget,
    documentExtensions: extensions,
    imageStrategy: src.imageStrategy === "sticky" ? "sticky" : "vision-fallback",
    visionFallback: readModelRef(src.visionFallback),
    maxRenderedPages: Number.isFinite(pages) && pages >= 1 ? Math.floor(pages) : 20,
  };
}

function extensionOf(filename: string): string {
  const name = String(filename ?? "").trim().toLowerCase();
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const base = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot);
}

/** 这批文件里有没有会触发锁定的文档。只看扩展名——判定发生在解析之前。 */
export function hasRoutedDocument(
  filenames: readonly string[],
  policy: AttachmentRoutingPolicy,
): boolean {
  if (!policy.enabled || !policy.documentTarget) return false;
  const wanted = new Set(policy.documentExtensions);
  return filenames.some((name) => wanted.has(extensionOf(name)));
}

export type RoutingDecision =
  | { action: "none" }
  /** 本轮要切到 target；`announce` 为真时该弹一次说明（本会话第一次锁定）。 */
  | { action: "lock"; target: RoutingModelRef; announce: boolean };

/**
 * 决定这一轮要不要锁模型。
 *
 * sticky 的含义：**一旦锁定，本会话不再解锁**。理由不止是"别泄露"——文档内容已经
 * 进了这段对话的上下文（PDF 是页图，Office 是文本），换回纯文本云端模型要么看不见
 * 它，要么得把它抽成文本再发出去。所以后续每一轮都返回 lock，只是不再 announce。
 *
 * @param lockedTarget 本会话已经锁定的目标；没锁过传 null。
 */
export function decideAttachmentRouting(input: {
  policy: AttachmentRoutingPolicy;
  filenames: readonly string[];
  lockedTarget: RoutingModelRef | null;
}): RoutingDecision {
  const { policy, filenames, lockedTarget } = input;
  if (!policy.enabled || !policy.documentTarget) return { action: "none" };
  if (lockedTarget) {
    // 已锁定：保持，不再打扰用户。目标以当前下发的为准——管理员换了私有模型之后，
    // 老会话下一轮就跟着走，不会卡在一个已经下线的模型上。
    return { action: "lock", target: policy.documentTarget, announce: false };
  }
  if (!hasRoutedDocument(filenames, policy)) return { action: "none" };
  return { action: "lock", target: policy.documentTarget, announce: true };
}

/** 锁定后给用户看的理由。选择器灰掉时 hover / 点击都用它。 */
export function routingLockReason(target: RoutingModelRef): string {
  return `本会话包含文档附件，已锁定到「${target.label}」（私有部署）。文档内容不会离开这台部署。`;
}

/**
 * 「不再显示」只静音**弹窗**，不隐藏状态。
 *
 * 用户勾了之后下次就不会再弹，但模型选择器仍然是灰的、hover 仍然给出理由——被切走的
 * 是数据流向，不是一个 UI 偏好。通知可以静音，状态必须常驻。
 */
export const ROUTING_NOTICE_DISMISSED_KEY = "agx.attachmentRouting.noticeDismissed";

export function routingNoticeDismissed(storage?: Pick<Storage, "getItem">): boolean {
  const store = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!store) return false;
  try {
    return store.getItem(ROUTING_NOTICE_DISMISSED_KEY) === "true";
  } catch {
    return false;
  }
}

export function dismissRoutingNotice(storage?: Pick<Storage, "setItem">): void {
  const store = storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!store) return;
  try {
    store.setItem(ROUTING_NOTICE_DISMISSED_KEY, "true");
  } catch {
    // 隐私模式下 localStorage 会抛。静音失败最坏是多弹一次，不值得让它冒泡。
  }
}

/**
 * 模型选择器该不该禁用，以及禁用时说什么。
 *
 * 单独抽出来是因为它有两个调用方（输入框上的下拉、设置里的默认模型），两边各判一遍
 * 迟早会出现一处灰了一处没灰。
 */
export function modelPickerLock(
  lockedTarget: RoutingModelRef | null,
): { disabled: boolean; reason: string } {
  if (!lockedTarget) return { disabled: false, reason: "" };
  return { disabled: true, reason: routingLockReason(lockedTarget) };
}
