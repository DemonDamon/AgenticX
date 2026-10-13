import type { MobileMessage } from "../api/types";

/** 任务过程里一次工具调用的单步 */
export interface ToolStep {
  toolName: string;
  status: "done" | "error" | "unknown";
  /** bash_exec → command；其它工具 → 参数 JSON 摘要 */
  detail: string;
  /** 主要作用目标：文件路径 / 搜索 pattern / URL 等（无则空串） */
  target: string;
  /** 结果 content 单行截断预览 */
  resultPreview: string;
  /** 后端 tool_elapsed_sec 透传（老数据缺省 → null） */
  elapsedSec: number | null;
}

/** 任务过程里的单步：一段思考，或一次工具调用 */
export type ProcessStep =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; tool: ToolStep };

/** 消息流渲染条目（inverted FlatList 的 data 源） */
export type ChatEntry =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string }
  | { kind: "system"; key: string; text: string }
  /**
   * 一个回合的执行过程（思考段 + 工具调用）。完成态默认折叠为
   * 「任务耗时」分隔条；展开是可点击的步进行，点击弹出底部详情抽屉。
   */
  | {
      kind: "turnProcess";
      key: string;
      steps: ProcessStep[];
      /** 回合耗时（user 消息 → 最后一个过程步）；无时间戳数据时为 null */
      durationMs: number | null;
      /** 回合进行中（过程位于消息线尾部）：默认展开、标题显示进行中 */
      running: boolean;
    }
  /** 本地发送中占位（仅页面内使用，不进 buildChatEntries） */
  | { kind: "pending"; key: string }
  /** 真流式：回合进行中的 token 增量气泡（WS turn_delta 累积） */
  | { kind: "streaming"; key: string; text: string };

const RESULT_PREVIEW_MAX = 120;

function readText(m: MobileMessage): string {
  const raw = typeof m.text === "string" ? m.text : m.content;
  return typeof raw === "string" ? raw : "";
}

function readToolName(m: MobileMessage): string {
  const raw = m.tool_name ?? m.name;
  return typeof raw === "string" && raw.trim() !== "" ? raw : "tool";
}

function readToolStatus(m: MobileMessage): ToolStep["status"] {
  if (m.tool_status === "done") return "done";
  if (m.tool_status === "error") return "error";
  return "unknown";
}

/** 消息时间戳归一化为毫秒（缺省/非法 → null） */
function readTsMs(m: MobileMessage): number | null {
  const raw: unknown = m.timestamp ?? m.ts;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function readElapsedSec(m: MobileMessage): number | null {
  const raw: unknown = m.tool_elapsed_sec;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

const TARGET_KEYS = [
  "path",
  "file_path",
  "filePath",
  "file",
  "filename",
  "pattern",
  "query",
  "url",
] as const;

/** 从工具参数里提取主要作用目标（文件路径/搜索词/URL），用于详情行展示 */
function toolTarget(m: MobileMessage): string {
  const args = m.tool_args;
  if (args !== null && typeof args === "object") {
    const rec = args as Record<string, unknown>;
    for (const k of TARGET_KEYS) {
      const v = rec[k];
      if (typeof v === "string" && v.trim() !== "") return v.trim();
    }
  }
  return "";
}

function toolDetail(m: MobileMessage): string {
  const args = m.tool_args;
  if (args !== null && typeof args === "object") {
    const cmd = (args as Record<string, unknown>).command;
    if (typeof cmd === "string" && cmd.trim() !== "") return cmd.trim();
    try {
      return JSON.stringify(args).slice(0, RESULT_PREVIEW_MAX);
    } catch {
      return "";
    }
  }
  return "";
}

function resultPreview(m: MobileMessage): string {
  const raw = typeof m.content === "string" ? m.content : "";
  return raw.replace(/\s+/g, " ").trim().slice(0, RESULT_PREVIEW_MAX);
}

function buildToolStep(m: MobileMessage): ToolStep {
  return {
    toolName: readToolName(m),
    status: readToolStatus(m),
    detail: toolDetail(m),
    target: toolTarget(m),
    resultPreview: resultPreview(m),
    elapsedSec: readElapsedSec(m),
  };
}

/**
 * 后端消息线 → 手机端渲染条目（Trae 式任务过程折叠）：
 * - 一个回合的「思考段 + 连续 tool 消息」归成一个 turnProcess；过程位于
 *   消息线尾部时 running=true（回合进行中，默认展开），回合随 assistant
 *   正文落地而完成（默认折叠为「任务耗时」分隔条）
 * - assistant 的 reasoning 收编为过程里的 thinking 步，不再单独挂气泡
 * - 老消息（无 tool 字段）按纯文本回退
 */
export function buildChatEntries(messages: MobileMessage[]): ChatEntry[] {
  const entries: ChatEntry[] = [];
  let process: ProcessStep[] | null = null;
  let processStartIdx = 0;
  let turnStartMs: number | null = null;
  let lastStepMs: number | null = null;

  const flush = (running: boolean) => {
    if (process !== null && process.length > 0) {
      // 严格大于才计时：秒级时间戳同值时算出的 0 秒是噪声，回退「任务过程」
      const durationMs =
        turnStartMs !== null && lastStepMs !== null && lastStepMs > turnStartMs
          ? lastStepMs - turnStartMs
          : null;
      entries.push({
        kind: "turnProcess",
        // key 锚定过程首条消息下标：跨轮询/终态重建保持稳定，
        // 用户手动展开的状态不被后续快照顶掉
        key: `tp-${processStartIdx}`,
        steps: process,
        durationMs,
        running,
      });
    }
    process = null;
    turnStartMs = null;
    lastStepMs = null;
  };

  const pushStep = (step: ProcessStep, idx: number, tsMs: number | null) => {
    if (process === null) {
      process = [];
      processStartIdx = idx;
      turnStartMs = turnStartMs ?? tsMs;
    }
    // 相邻思考段合并（中间 assistant 与收尾 assistant 各带一段 reasoning 的场景）
    const last = process[process.length - 1];
    if (step.kind === "thinking" && last !== undefined && last.kind === "thinking") {
      last.text = `${last.text}\n${step.text}`;
    } else {
      process.push(step);
    }
    if (tsMs !== null) lastStepMs = tsMs;
  };

  messages.forEach((m, i) => {
    const tsMs = readTsMs(m);
    if (m.role === "tool") {
      pushStep({ kind: "tool", tool: buildToolStep(m) }, i, tsMs);
      return;
    }
    const text = readText(m);
    if (m.role === "user") {
      flush(false);
      turnStartMs = tsMs;
      entries.push({ kind: "user", key: `${i}-user-${tsMs ?? "nots"}`, text });
      return;
    }
    if (m.role === "assistant") {
      const reasoning =
        typeof m.reasoning === "string" && m.reasoning.trim() !== ""
          ? m.reasoning.trim()
          : null;
      if (reasoning !== null) {
        pushStep({ kind: "thinking", text: reasoning }, i, tsMs);
      }
      if (text.trim() !== "") {
        // 回合收尾：过程随正文落地而完成
        flush(false);
        entries.push({ kind: "assistant", key: `${i}-assistant-${tsMs ?? "nots"}`, text });
      }
      return;
    }
    flush(false);
    entries.push({ kind: "system", key: `${i}-system-${tsMs ?? "nots"}`, text });
  });
  // 尾部仍在累积的过程 = 回合进行中
  flush(true);
  return entries;
}

/** 工具展示类目（决定图标与聚合文案） */
export type ToolCategory = "cmd" | "read" | "write" | "search" | "web" | "tool";

export function toolCategory(toolName: string): ToolCategory {
  const n = toolName.toLowerCase();
  if (/bash|shell|command|_cmd|run_/.test(n)) return "cmd";
  if (/read|open_file|view|cat_/.test(n)) return "read";
  if (/write|edit|patch|save|create_file/.test(n)) return "write";
  if (/search|grep|glob|find|list|count|ls_/.test(n)) return "search";
  if (/web|http|fetch|browse|url|crawl/.test(n)) return "web";
  return "tool";
}

/** 相邻同类步聚合后的展示组（Trae 式「执行 N 条命令」一行） */
export interface ProcessGroup {
  kind: "thinking" | "tool";
  category: ToolCategory;
  steps: ProcessStep[];
}

export function aggregateProcessSteps(steps: ProcessStep[]): ProcessGroup[] {
  const groups: ProcessGroup[] = [];
  for (const step of steps) {
    const category: ToolCategory =
      step.kind === "tool" ? toolCategory(step.tool.toolName) : "tool";
    const last = groups[groups.length - 1];
    if (
      last !== undefined &&
      last.kind === step.kind &&
      (step.kind === "thinking" || last.category === category)
    ) {
      last.steps.push(step);
    } else {
      groups.push({ kind: step.kind, category, steps: [step] });
    }
  }
  return groups;
}

/** 展开态步进行文案 */
export function processGroupLabel(g: ProcessGroup): string {
  if (g.kind === "thinking") return "思考过程";
  const n = g.steps.length;
  switch (g.category) {
    case "cmd":
      return `执行 ${n} 条命令`;
    case "read":
      return `读取 ${n} 个文件`;
    case "write":
      return `编辑 ${n} 个文件`;
    case "search":
      return `搜索 ${n} 次文件`;
    case "web":
      return `检索 ${n} 次网页`;
    default: {
      const first = g.steps[0];
      const name = first.kind === "tool" ? first.tool.toolName : "tool";
      return n > 1 ? `使用 ${n} 次 ${name}` : `使用工具 ${name}`;
    }
  }
}

/** 详情抽屉里的组标题（过去时） */
export function processGroupTitle(g: ProcessGroup): string {
  if (g.kind === "thinking") return "思考过程";
  const n = g.steps.length;
  switch (g.category) {
    case "cmd":
      return n > 1 ? `已运行 ${n} 条命令` : "已运行命令";
    case "read":
      return `已读取 ${n} 个文件`;
    case "write":
      return `已编辑 ${n} 个文件`;
    case "search":
      return `已搜索 ${n} 次`;
    case "web":
      return `已检索 ${n} 次`;
    default: {
      const first = g.steps[0];
      return `已使用 ${first.kind === "tool" ? first.tool.toolName : "tool"}`;
    }
  }
}

/** 耗时展示：X秒 / X分X秒 / X小时X分 */
export function fmtDurationMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}分${rs}秒` : `${m}分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}小时${rm}分` : `${h}小时`;
}

/**
 * 应用一帧流式增量：首个 delta 把 pending 占位原位替换为 streaming
 * 气泡，后续 delta 追加文本。pending 已被移除（如轮询快照重建过）时
 * 尾部追加。返回新数组（输入不变）。
 */
export function applyStreamDelta(
  entries: ChatEntry[] | null,
  pendingKey: string,
  delta: string,
): ChatEntry[] {
  const list = entries ?? [];
  if (delta === "") return list;
  const streamKey = `stream-${pendingKey}`;
  const streamIdx = list.findIndex((e) => e.key === streamKey);
  if (streamIdx >= 0) {
    const cur = list[streamIdx];
    if (cur.kind === "streaming") {
      const next = [...list];
      next[streamIdx] = { ...cur, text: cur.text + delta };
      return next;
    }
  }
  const pendingIdx = list.findIndex((e) => e.key === pendingKey);
  if (pendingIdx >= 0) {
    const next = [...list];
    next[pendingIdx] = { kind: "streaming", key: streamKey, text: delta };
    return next;
  }
  return [...list, { kind: "streaming", key: streamKey, text: delta }];
}

/**
 * 流式 token 里思考段的两种形态：后端 safe_stream 规范化的 think
 * 标签（模型输出非规范变体时被规范下发）、parser 不识别的 <thinking>
 * 原文透传。splitStreamThinking 依据它们做思考/正文分流。
 */
const THINK_BLOCK_RE = /<(think|thinking)>([\s\S]*?)(?:<\/\1>|$)/g;
const THINK_OPEN_PREFIXES = ["<think>", "<thinking>"];

/**
 * 流式思考链分离：把累积 token 流拆成「思考」「正文」两路——思考段
 * （safe_stream 规范的 think 标签，或 parser 不识别的 <thinking> 原文
 * 透传）内容归 thinking 实时上屏渲染，闭合后的增量归 visible 走打字
 * 机。完整闭合块与流式进行中的未闭合尾部同样归 thinking；被 delta 分
 * 片截断的开标签前缀（尾部 "<" / "<thi" 等）暂扣一帧，避免尖括号
 * 闪现——下一帧标签补全后自然归位。
 */
export function splitStreamThinking(text: string): {
  thinking: string;
  visible: string;
} {
  const chunks: string[] = [];
  let visible = "";
  let cursor = 0;
  THINK_BLOCK_RE.lastIndex = 0;
  for (let m = THINK_BLOCK_RE.exec(text); m !== null; m = THINK_BLOCK_RE.exec(text)) {
    visible += text.slice(cursor, m.index);
    chunks.push(m[2]);
    cursor = m.index + m[0].length;
  }
  visible += text.slice(cursor);
  for (let n = Math.min(9, visible.length); n > 0; n -= 1) {
    const tail = visible.slice(-n);
    if (THINK_OPEN_PREFIXES.some((p) => p.slice(0, n) === tail)) {
      visible = visible.slice(0, -n);
      break;
    }
  }
  return { thinking: chunks.join(""), visible };
}
