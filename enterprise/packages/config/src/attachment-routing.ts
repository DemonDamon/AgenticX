/**
 * 附件自动路由的**唯一契约**：什么算文档、命中之后切到哪个模型、图片交给谁。
 *
 * 这份东西 Desktop（Python 运行时 + Electron UI）和 web portal 都要用，而两边一个
 * Python 一个 TypeScript，代码没法直接共用。所以这里定义的是**数据**不是行为：策略
 * 由服务端算好下发，两边各自执行、都不各自定义。判定逻辑本身只剩「这批文件名里有
 * 没有命中扩展名」这一句，重复实现的代价可以接受；真正会漂的部分——扩展名清单、目
 * 标模型、页数上限——只有这一处出处。
 *
 * 参考 desktop-capability-endpoints.ts 里同样的取舍：网关地址由服务端算而不是让客户
 * 端自己拼，否则改一次路径就得等所有员工升级客户端。
 */

/** 管理员在模型上声明的能力标记。`capabilities` 字段本身是自由字符串数组。 */
export const MODEL_CAPABILITY_VISION = "vision";
/** 跑在自有硬件上的模型。附件只会被送到带这个标记的模型。 */
export const MODEL_CAPABILITY_PRIVATE = "private-deployment";

/**
 * 命中即锁定会话模型的扩展名。
 *
 * 和 agenticx 的 ALLOWED_EXTENSIONS 保持一致：那批文件最终**一定**会以某种形式进入
 * 上下文（PDF 渲染成页图，Office 抽成文本），所以判定必须在调用模型**之前**发生。
 * 先解析后决定的话，文本已经发给公网模型了才想起来要切。
 *
 * 图片不在这里：图片走 visionFallback，不锁会话模型（见下面 imageStrategy）。
 */
export const DOCUMENT_EXTENSIONS: readonly string[] = [
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
] as const;

/** PDF 渲染成页图的默认上限。超出部分截断，并告诉用户可以接着读。 */
export const DEFAULT_MAX_RENDERED_PAGES = 20;

export type RoutingModelRef = {
  /** provider id，如 `custom_openai_qwen_local`。 */
  provider: string;
  /** 模型名。 */
  model: string;
  /** 给用户看的名字，用于锁定提示与灰显的选择器。 */
  label: string;
};

/**
 * 图片的处理方式。
 *
 * `vision-fallback`：**不动会话模型**，图片交给 visionFallback 那个模型分析，描述回
 * 到当前对话。截图是高频动作，一丢图就切模型会让整段历史的 prefix cache 作废、TTFT
 * 爆炸；而且原图从不离开私有部署，只有描述回到云端，containment 反而更强。
 *
 * `sticky`：和文档一样锁会话模型。留着这个取值是为了让策略能改，不是当前默认。
 */
export type ImageStrategy = "vision-fallback" | "sticky";

export type AttachmentRoutingPolicy = {
  /** 关掉时一切照旧：不锁模型、不改图片路径。 */
  enabled: boolean;
  /** 命中文档后强制切换并锁定到这个模型；取不到目标时整条策略视为未启用。 */
  documentTarget: RoutingModelRef | null;
  /** 触发锁定的扩展名（小写，含点）。 */
  documentExtensions: readonly string[];
  /** 图片怎么处理。 */
  imageStrategy: ImageStrategy;
  /** 当前模型不支持视觉时，图片交给谁分析。 */
  visionFallback: RoutingModelRef | null;
  /** PDF 渲染页数上限。 */
  maxRenderedPages: number;
};

/** 未启用状态的规范形态。取不到目标模型时也回落到它。 */
export const DISABLED_ATTACHMENT_ROUTING: AttachmentRoutingPolicy = {
  enabled: false,
  documentTarget: null,
  documentExtensions: DOCUMENT_EXTENSIONS,
  imageStrategy: "vision-fallback",
  visionFallback: null,
  maxRenderedPages: DEFAULT_MAX_RENDERED_PAGES,
};

function extensionOf(filename: string): string {
  const name = String(filename ?? "").trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot);
}

/**
 * 这批附件里有没有需要锁定会话模型的文档。
 *
 * 只看扩展名，不看内容：判定要在解析之前发生，那时还没有内容可看。
 */
export function hasRoutedDocument(
  filenames: readonly string[],
  policy: AttachmentRoutingPolicy,
): boolean {
  if (!policy.enabled || !policy.documentTarget) return false;
  const wanted = new Set(policy.documentExtensions.map((ext) => ext.toLowerCase()));
  return filenames.some((name) => wanted.has(extensionOf(name)));
}

/** 会话是否已经被锁定在目标模型上（sticky：一旦锁定，本会话不再解锁）。 */
export function isLockedToRoutingTarget(
  current: { provider: string; model: string } | null | undefined,
  policy: AttachmentRoutingPolicy,
): boolean {
  const target = policy.documentTarget;
  if (!policy.enabled || !target || !current) return false;
  return current.provider === target.provider && current.model === target.model;
}
