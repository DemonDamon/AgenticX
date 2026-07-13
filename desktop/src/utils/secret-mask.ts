/**
 * 展示层敏感信息遮蔽：仅用于渲染/复制展示，不改变 store 中 message.content 或发往后端的原文。
 * 参考 agenticx/safety/leak_detector.py 的正则口径，补充飞书 app_id/app_secret 等中文标注场景。
 */

interface SecretPattern {
  re: RegExp;
  /** 需要遮蔽的捕获组下标（1-based）；缺省表示遮蔽整段匹配。 */
  group?: number;
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
  { re: /\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]{20,}\b/g },
];

/** 对文本做展示层遮蔽：识别常见密钥/口令格式并替换为掐头去尾的星号形式。 */
export function maskSecretsForDisplay(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern.re, (...args: unknown[]) => {
      const match = String(args[0]);
      if (!pattern.group) return maskToken(match);
      const value = String(args[pattern.group] ?? "");
      if (!value) return match;
      const prefix = match.slice(0, match.length - value.length);
      return `${prefix}${maskToken(value)}`;
    });
  }
  return result;
}
