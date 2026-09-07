export type PortalLocale = "zh" | "en";

export type ChatCopy = {
  messageActions: {
    copy: string;
    multiSelect: string;
    edit: string;
    retry: string;
    share: string;
    helpful: string;
    unhelpful: string;
    copyTraceId: string;
    copyText: string;
    cancel: string;
    send: string;
    prevVersion: string;
    nextVersion: string;
    userRole: string;
    assistantRole: string;
    selectAll: string;
    selectedCount: (n: number) => string;
  };
  interaction: {
    auto: string;
    direct: string;
    cardFirst: string;
    planChat: string;
  };
  segments: {
    searchWeb: string;
    parallelSearching: string;
    completedLanes: (n: number) => string;
    doneSuffix: string;
    writingReport: string;
    finishedWriting: (n: number) => string;
    finishedSynthesis: string;
    startingResearch: string;
    researchQuestion: (title: string) => string;
    memo: (path: string) => string;
    stats: (input: {
      queriesPlanned: number;
      urlsDiscovered: number;
      sourcesSelected: number;
      pagesFetched: number;
    }) => string;
    resultsCount: (title: string, n: number) => string;
  };
  phases: {
    recon: string;
    clarify: string;
    plan: string;
    lanes: string;
    reflect: string;
    synthesize: string;
    done: string;
    reconFallback: string;
    clarifyFallback: string;
    planFallback: string;
    lanesFallback: string;
    reflectFallback: string;
    synthesizeFallback: string;
    doneFallback: string;
  };
  timeline: {
    runStarted: string;
    clarify: (step: number, total: number, question: string) => string;
    clarifyTimeout: string;
    laneStarted: (index: number, total: number, title: string) => string;
    laneDone: (path?: string) => string;
    laneFailed: string;
    laneSources: (n: number) => string;
    artifact: (title: string) => string;
    process: string;
    starting: string;
    viewArtifact: string;
    askTool: string;
    waitingConfirm: string;
    timedOutDefault: string;
    collectedInfo: string;
  };
  clarify: {
    intro: string;
    multiSelect: string;
    selectOne: string;
    customPlaceholder: string;
    skip: string;
    confirmContinue: string;
    unansweredDefault: string;
    submitFailed: string;
    title: string;
    midrunSuffix: string;
    myReply: string;
    chatTimeout: string;
    chatPlaceholder: string;
    submitReply: string;
    startNow: string;
    emptyReply: string;
    networkFailed: string;
  };
  preflight: {
    myUnderstanding: string;
    planDraft: string;
    title: string;
    editHint: (version: number) => string;
    waitHint: string;
    submitEdits: string;
    cancel: string;
    confirmStart: string;
    editPlan: string;
    startNow: string;
    keepOne: string;
    networkFailed: string;
    actionProposed: string;
    actionUpdated: string;
    actionApproved: string;
  };
  planChat: {
    title: string;
    updating: string;
    editHint: string;
    historic: string;
    startResearch: string;
    networkFailed: string;
    actionProposed: string;
    actionUpdated: string;
    actionApproved: string;
  };
  recover: {
    inProgress: (phase: string) => string;
  };
};

const ZH: ChatCopy = {
  messageActions: {
    copy: "复制",
    multiSelect: "多选",
    edit: "编辑",
    retry: "重新生成",
    share: "分享",
    helpful: "有帮助",
    unhelpful: "没帮助",
    copyTraceId: "复制请求 ID",
    copyText: "复制文本",
    cancel: "取消",
    send: "发送",
    prevVersion: "上一版回复",
    nextVersion: "下一版回复",
    userRole: "用户",
    assistantRole: "助手",
    selectAll: "全选",
    selectedCount: (n) => `已选择 ${n} 条消息`,
  },
  interaction: {
    auto: "自动",
    direct: "直接开始",
    cardFirst: "卡片确认",
    planChat: "计划对齐",
  },
  segments: {
    searchWeb: "搜索网页",
    parallelSearching: "正在并行检索…",
    completedLanes: (n) => `已完成 ${n} 条调研车道检索`,
    doneSuffix: "已完成",
    writingReport: "正在撰写报告…",
    finishedWriting: (n) => `已完成报告撰写 · ${n} 步`,
    finishedSynthesis: "已完成综合分析",
    startingResearch: "正在启动深度研究…",
    researchQuestion: (title) => `调研子问题：${title}`,
    memo: (path) => `备忘：${path}`,
    stats: ({ queriesPlanned, urlsDiscovered, sourcesSelected, pagesFetched }) =>
      `检索式 ${queriesPlanned} 条 · 发现 ${urlsDiscovered} 个来源 · 采用 ${sourcesSelected} 个 · 读取正文 ${pagesFetched} 篇`,
    resultsCount: (title, n) => `${title} · ${n} 个结果`,
  },
  phases: {
    recon: "开题侦查",
    clarify: "澄清确认",
    plan: "规划路径",
    lanes: "并行检索",
    reflect: "复盘补搜",
    synthesize: "撰写报告",
    done: "已完成",
    reconFallback: "侦查最新现状",
    clarifyFallback: "确认调研方向",
    planFallback: "规划研究路径",
    lanesFallback: "并行检索",
    reflectFallback: "复盘信息缺口",
    synthesizeFallback: "综合分析",
    doneFallback: "研究完成",
  },
  timeline: {
    runStarted: "已启动研究",
    clarify: (step, total, question) => `澄清 ${step}/${total}：${question}`,
    clarifyTimeout: "澄清超时，按默认假设继续",
    laneStarted: (index, total, title) => `车道 ${index}/${total}：${title}`,
    laneDone: (path) => `车道完成${path ? ` · ${path}` : ""}`,
    laneFailed: "车道失败",
    laneSources: (n) => `车道来源 ${n} 个`,
    artifact: (title) => `产物：${title}`,
    process: "研究过程",
    starting: "正在启动深度研究…",
    viewArtifact: "查看产物",
    askTool: "询问工具",
    waitingConfirm: "等待确认",
    timedOutDefault: "超时后按默认假设继续",
    collectedInfo: "已收集信息",
  },
  clarify: {
    intro:
      "我先快速确认一下调研方向，然后开始系统检索。每题可多选；请在 5 分钟内确认；超时将按默认假设继续。",
    multiSelect: "可多选",
    selectOne: "请选一个",
    customPlaceholder: "其他（可选，可与上方选项组合）",
    skip: "跳过",
    confirmContinue: "确认并继续",
    unansweredDefault: "（未回答，已按默认假设继续）",
    submitFailed: "提交失败，请稍后重试",
    title: "深度研究 · 开题确认",
    midrunSuffix: "（运行中补充）",
    myReply: "我的回复：",
    chatTimeout: "澄清超时，已按默认范围继续。",
    chatPlaceholder: "直接回复即可；也可以说「直接开始」…",
    submitReply: "提交回复",
    startNow: "直接开始",
    emptyReply: "请先输入回复，或点击「直接开始」按默认范围调研。",
    networkFailed: "网络异常，提交失败，请重试。",
  },
  preflight: {
    myUnderstanding: "我的理解：",
    planDraft: "研究计划草案：",
    title: "深度研究 · 研究计划",
    editHint: (version) => `每行一条子问题（最多 8 条），提交后按计划 v${version} 执行：`,
    waitHint: "确认或修改前不会自动开始检索，请点下方按钮继续。",
    submitEdits: "提交修改并开始",
    cancel: "取消",
    confirmStart: "确认并开始",
    editPlan: "修改计划",
    startNow: "直接开始",
    keepOne: "请至少保留一条子问题，或点「确认并开始」按草案执行。",
    networkFailed: "网络异常，提交失败，请重试。",
    actionProposed: "草案",
    actionUpdated: "已更新",
    actionApproved: "已确认",
  },
  planChat: {
    title: "深度研究 · 计划对齐",
    updating: "更新中",
    editHint:
      "可在下方输入框用自然语言修改计划（如：侧重性能 / 增加成本分析）；满意后点「开始调研」。",
    historic: "此为历史方案；请查看下方更新后的计划卡。",
    startResearch: "开始调研",
    networkFailed: "网络异常，提交失败，请重试。",
    actionProposed: "草案",
    actionUpdated: "已更新",
    actionApproved: "已确认",
  },
  recover: {
    inProgress: (phase) => `深度调研进行中（${phase}）· 点击继续查看`,
  },
};

const EN: ChatCopy = {
  messageActions: {
    copy: "Copy",
    multiSelect: "Multi-select",
    edit: "Edit",
    retry: "Regenerate",
    share: "Share",
    helpful: "Helpful",
    unhelpful: "Not helpful",
    copyTraceId: "Copy request ID",
    copyText: "Copy text",
    cancel: "Cancel",
    send: "Send",
    prevVersion: "Previous reply",
    nextVersion: "Next reply",
    userRole: "User",
    assistantRole: "Assistant",
    selectAll: "Select all",
    selectedCount: (n) => `${n} messages selected`,
  },
  interaction: {
    auto: "Auto",
    direct: "Start now",
    cardFirst: "Card confirm",
    planChat: "Plan alignment",
  },
  segments: {
    searchWeb: "Search web",
    parallelSearching: "Searching in parallel…",
    completedLanes: (n) => `Completed ${n} research lane searches`,
    doneSuffix: "Done",
    writingReport: "Writing the report…",
    finishedWriting: (n) => `Finished writing the report · ${n} steps`,
    finishedSynthesis: "Finished synthesis",
    startingResearch: "Starting deep research…",
    researchQuestion: (title) => `Research question: ${title}`,
    memo: (path) => `Memo: ${path}`,
    stats: ({ queriesPlanned, urlsDiscovered, sourcesSelected, pagesFetched }) =>
      `${queriesPlanned} queries · ${urlsDiscovered} sources found · ${sourcesSelected} used · ${pagesFetched} pages read`,
    resultsCount: (title, n) => `${title} · ${n} results`,
  },
  phases: {
    recon: "Topic recon",
    clarify: "Clarification",
    plan: "Planning",
    lanes: "Parallel search",
    reflect: "Gap follow-up",
    synthesize: "Writing report",
    done: "Done",
    reconFallback: "Scanning latest context",
    clarifyFallback: "Confirming research direction",
    planFallback: "Planning the research path",
    lanesFallback: "Parallel search",
    reflectFallback: "Reviewing information gaps",
    synthesizeFallback: "Synthesis",
    doneFallback: "Research complete",
  },
  timeline: {
    runStarted: "Research started",
    clarify: (step, total, question) => `Clarify ${step}/${total}: ${question}`,
    clarifyTimeout: "Clarification timed out; continuing with default assumptions",
    laneStarted: (index, total, title) => `Lane ${index}/${total}: ${title}`,
    laneDone: (path) => `Lane complete${path ? ` · ${path}` : ""}`,
    laneFailed: "Lane failed",
    laneSources: (n) => `${n} lane sources`,
    artifact: (title) => `Artifact: ${title}`,
    process: "Research progress",
    starting: "Starting deep research…",
    viewArtifact: "View artifact",
    askTool: "Ask tool",
    waitingConfirm: "Waiting for confirmation",
    timedOutDefault: "Timed out; continuing with default assumptions",
    collectedInfo: "Information collected",
  },
  clarify: {
    intro:
      "I'll quickly confirm the research direction, then start a systematic search. You can pick more than one option per question. Please reply within 5 minutes; we will continue with default assumptions if time runs out.",
    multiSelect: "Multi-select",
    selectOne: "Select one",
    customPlaceholder: "Other (optional; can combine with the options above)",
    skip: "Skip",
    confirmContinue: "Confirm and continue",
    unansweredDefault: "(unanswered; continued with default assumptions)",
    submitFailed: "Submit failed. Please try again.",
    title: "Deep research · Topic confirmation",
    midrunSuffix: " (mid-run follow-up)",
    myReply: "My reply:",
    chatTimeout: "Clarification timed out; continued with the default scope.",
    chatPlaceholder: "Reply here, or say “Start now”…",
    submitReply: "Submit reply",
    startNow: "Start now",
    emptyReply: "Enter a reply first, or click Start now to research the default scope.",
    networkFailed: "Network error. Submit failed. Please try again.",
  },
  preflight: {
    myUnderstanding: "My understanding:",
    planDraft: "Research plan draft:",
    title: "Deep research · Research plan",
    editHint: (version) => `One sub-question per line (max 8). After submit, plan v${version} will run:`,
    waitHint: "Search will not start until you confirm or edit. Use the buttons below to continue.",
    submitEdits: "Submit edits and start",
    cancel: "Cancel",
    confirmStart: "Confirm and start",
    editPlan: "Edit plan",
    startNow: "Start now",
    keepOne: "Keep at least one sub-question, or click Confirm and start to run the draft.",
    networkFailed: "Network error. Submit failed. Please try again.",
    actionProposed: "Draft",
    actionUpdated: "Updated",
    actionApproved: "Confirmed",
  },
  planChat: {
    title: "Deep research · Plan alignment",
    updating: "Updating",
    editHint:
      "Edit the plan in the composer below (e.g. focus on performance / add cost analysis). When ready, click Start research.",
    historic: "This is a previous plan. See the updated plan card below.",
    startResearch: "Start research",
    networkFailed: "Network error. Submit failed. Please try again.",
    actionProposed: "Draft",
    actionUpdated: "Updated",
    actionApproved: "Confirmed",
  },
  recover: {
    inProgress: (phase) => `Deep research in progress (${phase}) · Click to continue`,
  },
};

export function getChatCopy(locale: PortalLocale | string | undefined): ChatCopy {
  return locale === "en" ? EN : ZH;
}

function collectKeys(value: unknown, prefix = ""): string[] {
  if (typeof value === "function") return [prefix];
  if (!value || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

export function chatCopyKeys(locale: PortalLocale = "zh"): string[] {
  return collectKeys(getChatCopy(locale)).sort();
}
