/**
 * 展示层敏感信息遮蔽：仅用于渲染/复制展示，不改变 store 中 message.content 或发往后端的原文。
 * 参考 agenticx/safety/leak_detector.py 的正则口径，补充飞书 app_id/app_secret 等中文标注场景。
 */

interface SecretPattern {
  re: RegExp;
  /** 需要遮蔽的捕获组下标（1-based）；缺省表示遮蔽整段匹配。 */
  group?: number;
  /**
   * 高熵兜底专用：跳过 URL 路径段（`/` 后的公开 ID）。
   * 已知厂商前缀 / 标注密钥仍会遮蔽，包括出现在 query 里的情况。
   */
  skipInsideUrlPath?: boolean;
}

const HEAD_LEN = 3;
const TAIL_LEN = 2;
const STAR_RUN = "*****";
const MIN_LEN_TO_MASK = HEAD_LEN + TAIL_LEN + 2;

/** 遮蔽单个 token：保留首尾少量字符，中间统一替换为固定长度星号（不随长度线性增长，避免暴露长度信息）。 */
export function maskToken(token: string): string {
  if (!token) return token;
  if (token.length < MIN_LEN_TO_MASK) return "*".repeat(Math.max(token.length, 3));
  return `${token.slice(0, HEAD_LEN)}${STAR_RUN}${token.slice(-TAIL_LEN)}`;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { re: /sk-(?:proj-)?[A-Za-z0-9]{20,}/g },
  { re: /sk-ant-api\d{2}-[A-Za-z0-9-]{20,}/g },
  { re: /AKIA[0-9A-Z]{16}/g },
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/g },
  { re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { re: /\bcli_[a-z0-9]{14,}\b/gi },
  { re: /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  {
    // 「appid是xxx」「api_key: xxx」「app_secret=xxx」等中英文标注 + 取值场景，只遮蔽取值部分
    re: /((?:app[_-]?id|app[_-]?secret|client[_-]?secret|client[_-]?id|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|pwd)\s*(?:是|为|[:=])\s*["'`]?)([A-Za-z0-9_\-.]{6,})/gi,
    group: 2,
  },
  // 通用高熵 token 兜底：无法归入已知厂商前缀（如自定义 "agx-pat-xxx"）的随机密钥/口令，
  // 要求长度>=20 且同时包含大写、小写、数字，降低对普通单词/十六进制哈希的误伤。
  // 不遮蔽 URL 路径段（如微信公众号短链 /s/<id>），否则气泡点击/复制会变成无效地址。
  {
    re: /\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}\b/g,
    skipInsideUrlPath: true,
  },
];

/** http(s) / www. / 带路径的裸域名，用于判断高熵匹配是否落在 URL 里。 */
const URL_SPAN_RE =
  /(?:https?:\/\/|www\.)[^\s<>"'）】)\]>]+|\b[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}\/[^\s<>"'）】)\]>]+/gi;

function findUrlRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(URL_SPAN_RE)) {
    if (match.index == null) continue;
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function isInsideUrlPath(text: string, offset: number, urlRanges: Array<[number, number]>): boolean {
  if (offset <= 0 || text[offset - 1] !== "/") return false;
  return urlRanges.some(([start, end]) => offset >= start && offset < end);
}

function replaceOffset(args: unknown[]): number {
  const last = args[args.length - 1];
  const offsetArg = typeof last === "string" ? args[args.length - 2] : args[args.length - 3];
  return typeof offsetArg === "number" ? offsetArg : -1;
}

/** 对文本做展示层遮蔽：识别常见密钥/口令格式并替换为掐头去尾的星号形式。 */
export function maskSecretsForDisplay(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    const urlRanges = pattern.skipInsideUrlPath ? findUrlRanges(result) : [];
    result = result.replace(pattern.re, (...args: unknown[]) => {
      const match = String(args[0]);
      const offset = replaceOffset(args);
      if (pattern.skipInsideUrlPath && isInsideUrlPath(result, offset, urlRanges)) {
        return match;
      }
      if (!pattern.group) return maskToken(match);
      const value = String(args[pattern.group] ?? "");
      if (!value) return match;
      const prefix = match.slice(0, match.length - value.length);
      return `${prefix}${maskToken(value)}`;
    });
  }
  return result;
}
