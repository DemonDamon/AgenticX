/**
 * 市场图标纯函数层:确定性 hash 选渐变、名称关键词选行业图标。
 * 不依赖 React/lucide,便于单测;组件层见 MarketIcon.tsx。
 */

/** djb2 字符串 hash:同名输入永远得到同一结果。 */
export function hashName(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 渐变底座色板:冷暖搭配的品牌感渐变(Tailwind class 片段)。 */
export const MARKET_GRADIENTS: readonly string[] = [
  "from-sky-500 to-blue-600",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
  "from-indigo-500 to-violet-600",
  "from-lime-500 to-green-600",
];

/** 按名称确定性选取渐变:同名稳定,不同名尽量散开。 */
export function pickGradientFor(name: string): string {
  return MARKET_GRADIENTS[hashName(name) % MARKET_GRADIENTS.length];
}

/** glyph key 集合(组件层映射到 lucide 图标)。 */
export type MarketIconGlyph =
  | "map"
  | "search"
  | "video"
  | "image"
  | "file"
  | "code"
  | "database"
  | "mail"
  | "chat"
  | "globe"
  | "git"
  | "music"
  | "languages"
  | "flask"
  | "cloud"
  | "sparkles";

/** 关键词规则:顺序即优先级,先具体后一般;中英文都覆盖。 */
const GLYPH_RULES: ReadonlyArray<readonly [readonly string[], MarketIconGlyph]> = [
  [["地图", "map", "gaode", "amap"], "map"],
  [["搜索", "search", "fetch", "bing", "抓取"], "search"],
  [["视频", "video", "movie", "film", "剪辑"], "video"],
  [["图片", "图像", "image", "photo", "画", "绘图", "视觉", "海报"], "image"],
  [["文档", "表格", "幻灯", "doc", "sheet", "ppt", "excel", "word", "pdf", "笔记"], "file"],
  [["代码", "前端", "code", "编程", "react", "vue", "css"], "code"],
  [["数据", "数据库", "data", "sql", "bi", "报表"], "database"],
  [["邮件", "mail", "email", "smtp"], "mail"],
  [["聊天", "chat", "im", "message", "通讯", "客服"], "chat"],
  [["浏览器", "browser", "chrome", "网页", "web", "http"], "globe"],
  [["git", "github", "gitlab", "仓库", "repo"], "git"],
  [["音乐", "music", "audio", "音频", "语音"], "music"],
  [["翻译", "translate", "语言", "language", "i18n"], "languages"],
  [["测试", "test", "qa", "自动化"], "flask"],
  [["天气", "weather", "气候"], "cloud"],
];

/** 按名称关键词选行业图标;无命中回退 sparkles。 */
export function pickMarketIconGlyph(name: string): MarketIconGlyph {
  const n = name.toLowerCase();
  for (const [keywords, glyph] of GLYPH_RULES) {
    if (keywords.some((k) => n.includes(k))) return glyph;
  }
  return "sparkles";
}

/** 品牌图标(官方矢量 logo,经 Simple Icons CDN 按 slug 引用)。 */
export type MarketBrandIcon = { slug: string };

/**
 * 知名品牌关键词 → Simple Icons slug(仅收录 CDN 实测可用的 slug)。
 * 无命中的名称走渐变底座;CDN 不可达时组件层回退渐变。
 */
const BRAND_RULES: ReadonlyArray<readonly [readonly string[], string]> = [
  [["supabase"], "supabase"],
  [["github"], "github"],
  [["gitlab"], "gitlab"],
  [["anthropic", "claude"], "anthropic"],
  [["deepseek"], "deepseek"],
  [["gemini"], "googlegemini"],
  [["ollama"], "ollama"],
  [["notion"], "notion"],
  [["figma"], "figma"],
  [["docker"], "docker"],
  [["kubernetes", "k8s"], "kubernetes"],
  [["postgres"], "postgresql"],
  [["mysql"], "mysql"],
  [["mongodb", "mongo"], "mongodb"],
  [["redis"], "redis"],
  [["elasticsearch"], "elasticsearch"],
  [["jenkins"], "jenkins"],
  [["sentry"], "sentry"],
  [["stripe"], "stripe"],
  [["grafana"], "grafana"],
  [["vercel"], "vercel"],
  [["cloudflare"], "cloudflare"],
  [["阿里云", "aliyun", "alibabacloud"], "alibabacloud"],
  [["微信", "wechat", "weixin"], "wechat"],
];

/** 按名称关键词匹配知名品牌官方图标;无命中返回 null。 */
export function pickBrandIcon(name: string): MarketBrandIcon | null {
  const n = name.toLowerCase();
  for (const [keywords, slug] of BRAND_RULES) {
    if (keywords.some((k) => n.includes(k))) return { slug };
  }
  return null;
}
