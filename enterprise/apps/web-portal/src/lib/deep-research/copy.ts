export type PortalLocale = "zh" | "en";

export function languageDirective(locale: PortalLocale): string {
  return locale === "en"
    ? "Write ALL user-facing text in English: narratives, clarify questions/options, plan titles, lane titles, memos, report sections, and completion summary. Keep proper nouns, paper titles, and citations unchanged."
    : "所有面向用户的文本使用简体中文：旁白、澄清题/选项、计划标题、车道标题、备忘、报告章节、完成摘要。专有名词、论文标题与引用保持原样。";
}

export function deepResearchCopy(locale: PortalLocale) {
  if (locale === "en") {
    return {
      offlineMode:
        "This environment cannot reach the public web. Deep research switched to existing-materials-only mode; conclusions will not include live external sources.",
      readingDirectPage:
        "Reading the public page you specified. Later research lanes will reuse it and locate passages against the question.",
      updatingPlan: "Updating the plan from your feedback…",
      resumedPlanConfirm: "Restored the interrupted plan confirmation. Continuing research.",
      resumedPlanChat: "Restored the interrupted plan alignment. You can keep editing or start research.",
      reconNarrative:
        "I'll quickly search the latest public sources to calibrate the research premise.",
      reconPhase: "Scanning the latest public context…",
      coldStartPhase: "Topic cold-start search…",
      coldStartLaneTitle: "Topic cold start",
      reconSources: (n: number) => `Collected ${n} sources`,
      clarifyPhase: "Checking whether clarification is needed…",
      afterReconClarify: "Context is calibrated. Confirm the research direction next.",
      planPhase: "Planning the research path…",
      lanesStarted: (n: number) =>
        `Broke down ${n} research lanes, searching in parallel…`,
      expandedQueries: (n: number) => `Expanded ${n} search queries`,
      skippedQueries: (run: number, skipped: number) =>
        `Enough candidates; ran ${run} queries and skipped ${skipped}`,
      discoveredSources: (n: number) => `Found ${n} candidate sources`,
      selectedSources: (sel: number, pool: number) =>
        `Selected ${sel}/${pool} high-quality sources`,
      collectingSources: (n: number) =>
        `Collected ${n} sources, fetching page text…`,
      searchAllFailed: "All searches failed",
      midrunClarify: "Evidence is still thin. Confirm one key point, then continue.",
      reflectPhase: "Reviewing collected evidence for information gaps…",
      fillingGaps: (n: number) => `Running follow-up search for ${n} gaps…`,
      noGaps: "Cross-checks look sufficient; no follow-up search needed.",
      retrieveDone:
        "Retrieval is complete and the evidence is sufficient. Moving on to synthesis and the report.",
      outlinePhase: "Drafting the report outline…",
      writingSection: (i: number, total: number, title: string) =>
        `Writing section ${i}/${total}: ${title}`,
      synthesizePhase: "Synthesizing…",
      done: "Deep research complete",
      cancelled: "Cancelled",
      policyBlocked: "A compliance policy blocked report writing",
      donePartial: "Deep research complete (some wrap-up steps failed)",
      failed: "Failed",
      clarifyPrefix: "User clarifications",
      researchTopicFallback: "research topic",
      researchThatTopic: "research this topic",
      researchReportFallback: "research report",
      youSaid: (reply: string) => `You: ${reply}`,
      clarifyTimeout: "Clarification timed out. Continuing with default assumptions.",
      clarifyTimeoutMidrun: "Follow-up clarification timed out. Continuing with current evidence.",
      clarifyAnswered: "Research direction confirmed. Starting systematic search.",
      clarifyAnsweredMidrun: "Additional constraints noted. Continuing analysis.",
      clarifySkipped: "Skipped confirmation. Continuing with default assumptions.",
      clarifySkippedMidrun: "Skipped follow-up confirmation. Continuing analysis.",
      startedWithCurrentPlan: "Started research with the current plan.",
      planChatRoundCap: "Reached the conversation-round limit. Starting with the current plan.",
      pagesRead: (fetched: number, total: number) => `Read ${fetched}/${total} pages`,
      pagesReadWithNote: (fetched: number, total: number, note: string) =>
        `Read ${fetched}/${total} pages (${note})`,
      htmlFailed: (reason: string) =>
        `Failed to generate the visual HTML version (${reason}). The full text is saved as a Markdown deliverable you can download.`,
      citationVerify: "Verifying citations and key claims…",
      policyGatewayBlocked: "A compliance policy blocked the response.",
      planApprovedContinue: "Plan confirmed. Continuing research.",
      planEditedContinue: "Continuing with the edited plan.",
      planSkippedContinue: "Skipped plan confirmation. Starting research.",
      fallbackDone: (topic: string) => `🎉「${topic}」Deep research complete.`,
      fallbackStats: (s: {
        queriesPlanned: number;
        sourcesSelected: number;
        pagesFetched: number;
        citationCount: number;
      }) =>
        `This run planned ${s.queriesPlanned} searches, used ${s.sourcesSelected} sources, read ${s.pagesFetched} pages, and collected ${s.citationCount} citations.`,
      fallbackSections: (list: string) => `Report sections: ${list}.`,
      fallbackNoSections: "(no sections generated)",
      fallbackArtifactsHeading: "Deliverables:",
      fallbackOpenFull:
        "Open the link above for the full text, or use the delivery cards below.",
      tocHeading: "Contents",
      tocEmpty: "No contents",
      sourcesHeading: "Sources",
      sourcesEmpty: "No sources",
      mindmapHeading: "Mind map",
      topicGenerated: (topic: string, generatedAt: string) =>
        `Topic: ${topic} · Generated ${generatedAt}`,
      themeToggle: "Toggle light and dark",
      statQueries: "Queries planned",
      statLinks: "Links found",
      statSources: "Sources used",
      statPages: "Pages read",
    };
  }
  return {
    offlineMode:
      "当前环境无法访问外部网站，深度调研已切换为「仅基于已有资料」模式，结论不含外部实时来源。",
    readingDirectPage:
      "正在直接读取用户指定的公开页面，后续研究车道会复用并按问题定位片段。",
    updatingPlan: "正在根据你的反馈更新计划…",
    resumedPlanConfirm: "已恢复中断的计划确认，继续执行研究。",
    resumedPlanChat: "已恢复中断的计划对齐，可继续修改或开始调研。",
    reconNarrative: "我先快速检索最新公开资料，校准调研前提。",
    reconPhase: "正在快速侦查最新现状…",
    coldStartPhase: "开题冷启动检索…",
    coldStartLaneTitle: "开题冷启动",
    reconSources: (n: number) => `已收集 ${n} 个来源`,
    clarifyPhase: "正在判断是否需要澄清…",
    afterReconClarify: "现状已校准，再确认一下调研方向。",
    planPhase: "正在规划研究路径…",
    lanesStarted: (n: number) => `已拆解 ${n} 条调研车道，正在并行检索…`,
    expandedQueries: (n: number) => `已展开 ${n} 条检索式`,
    skippedQueries: (run: number, skipped: number) =>
      `候选已够用，实际检索 ${run} 条，省去 ${skipped} 条检索式`,
    discoveredSources: (n: number) => `发现 ${n} 个候选来源`,
    selectedSources: (sel: number, pool: number) =>
      `筛选出 ${sel}/${pool} 个高质量来源`,
    collectingSources: (n: number) => `已收集 ${n} 个来源，正在读取正文…`,
    searchAllFailed: "检索全部失败",
    midrunClarify: "目前证据偏薄，再确认一个关键点后继续。",
    reflectPhase: "正在复盘已收集证据，识别信息缺口…",
    fillingGaps: (n: number) => `正在针对 ${n} 处缺口补充检索…`,
    noGaps: "证据交叉验证充分，未发现需要补搜的缺口。",
    retrieveDone: "检索阶段完成，数据已足够。现在进入综合分析与报告撰写。",
    outlinePhase: "正在拟定报告大纲…",
    writingSection: (i: number, total: number, title: string) =>
      `正在撰写第 ${i}/${total} 节：${title}`,
    synthesizePhase: "正在综合分析…",
    done: "深度研究完成",
    cancelled: "已取消",
    policyBlocked: "合规策略已拦截报告撰写",
    donePartial: "深度研究完成（部分收尾失败）",
    failed: "失败",
    clarifyPrefix: "用户澄清",
    researchTopicFallback: "研究主题",
    researchThatTopic: "研究该主题",
    researchReportFallback: "调研报告",
    youSaid: (reply: string) => `你：${reply}`,
    clarifyTimeout: "澄清超时，按默认假设继续。",
    clarifyTimeoutMidrun: "补充澄清超时，按现有证据继续。",
    clarifyAnswered: "已明确调研方向，开始系统检索。",
    clarifyAnsweredMidrun: "已补充调研约束，继续分析。",
    clarifySkipped: "已跳过确认，按默认假设继续检索。",
    clarifySkippedMidrun: "已跳过补充确认，继续分析。",
    startedWithCurrentPlan: "已按当前计划开始调研。",
    planChatRoundCap: "已达对话轮次上限，按当前计划开始调研。",
    pagesRead: (fetched: number, total: number) =>
      `已读取 ${fetched}/${total} 篇正文`,
    pagesReadWithNote: (fetched: number, total: number, note: string) =>
      `已读取 ${fetched}/${total} 篇正文（${note}）`,
    htmlFailed: (reason: string) =>
      `可视化 HTML 版本生成失败（${reason}）。完整正文已保存为 Markdown 交付物，可直接下载查看。`,
    citationVerify: "正在复核引用与关键断言…",
    policyGatewayBlocked: "响应触发合规策略，网关已阻断返回。",
    planApprovedContinue: "已确认计划，继续执行研究。",
    planEditedContinue: "已按修改后的计划继续研究。",
    planSkippedContinue: "已跳过计划确认，直接开始研究。",
    fallbackDone: (topic: string) => `🎉「${topic}」深度调研完成。`,
    fallbackStats: (s: {
      queriesPlanned: number;
      sourcesSelected: number;
      pagesFetched: number;
      citationCount: number;
    }) =>
      `本次规划检索 ${s.queriesPlanned} 次、选用来源 ${s.sourcesSelected} 个、抓取正文 ${s.pagesFetched} 篇，共 ${s.citationCount} 个引用。`,
    fallbackSections: (list: string) => `报告章节：${list}。`,
    fallbackNoSections: "（未生成章节）",
    fallbackArtifactsHeading: "产物：",
    fallbackOpenFull: "完整正文请打开上方链接，或使用下方交付卡片。",
    tocHeading: "目录",
    tocEmpty: "无目录",
    sourcesHeading: "来源",
    sourcesEmpty: "暂无来源",
    mindmapHeading: "思维导图",
    topicGenerated: (topic: string, generatedAt: string) =>
      `主题：${topic} · 生成于 ${generatedAt}`,
    themeToggle: "明暗切换",
    statQueries: "规划查询",
    statLinks: "发现链接",
    statSources: "选用来源",
    statPages: "抓取正文",
  };
}

export type DeepResearchCopy = ReturnType<typeof deepResearchCopy>;
