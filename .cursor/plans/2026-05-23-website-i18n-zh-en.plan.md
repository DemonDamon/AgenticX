# Plan: AgenticX-Website 多语言 i18n（中文/英文自由切换）

- Plan-Id: 2026-05-23-website-i18n-zh-en
- Plan-File: AgenticX-Website/.plan/2026-05-23-website-i18n-zh-en.plan.md
- Owner: Damon Li
- Status: Draft → Ready

## 背景与问题

当前 `AgenticX-Website` 不存在 i18n 机制，导致严重的「语言撕裂」体验：

- UI 字符串（侧栏、搜索框、banner、元数据、落地页）全部硬编码英文，分布于：
  - `src/components/enterprise-docs/sidebar.tsx`
  - `src/components/enterprise-docs/navigation.ts`
  - `src/components/enterprise-docs/doc-search-command.tsx`
  - `src/components/security-advisory-banner.tsx`
  - `src/app/layout.tsx`、`src/app/page.tsx`（589 行落地页）
  - `src/app/enterprise/page.tsx`、`src/app/agents/page.tsx`
- 文档正文 `content/enterprise/**/*.md`（共 52 篇）几乎全部中文。
- `<html lang="en">` 写死。
- 典型现象：用户进入 `/enterprise/docs`，左侧导航全英文（Architecture / Apps & Modules / API Reference），右侧正文却是中文（「快速导航」「我想…」「第一次跑起来」）。

## 目标（Goals）

- **G1**：用户可在站点右上角自由切换中文 / English，选择持久化（cookie + URL）。
- **G2**：默认语言为中文（`/` = 中文，`/en` = 英文）；首次访问按 `Accept-Language` 自动协商。
- **G3**：所有 UI 字符串走字典化，**绝不再出现侧栏英文 + 正文中文** 的语言撕裂。
- **G4**：企业文档支持 `*.md`（中文，默认）+ `*.en.md`（英文）双语并存，缺失英文版时回退中文并显式提示「本页暂无英文版本」。
- **G5**：不引入新依赖（不上 next-intl / react-i18next），使用 Next.js 16 App Router 原生能力实现轻量字典方案。

## 非目标（Non-Goals）

- 不做第三种语言（如日文）—— 仅 zh / en。
- 不一次性翻译全部 52 篇企业文档；P4 仅翻译核心 8 篇，其余沿用回退机制，后续按需补齐。
- 不改造 `enterprise/` 子项目（admin-console、web-portal、gateway）自身的 i18n，本 plan 只覆盖 `AgenticX-Website/`。
- 不引入翻译管理平台（Crowdin/Phrase 等），字典直接落 TS 文件。

## 技术方案

### URL 结构

- `/` → 中文（等价 `/zh`，但 URL 不带前缀，SEO 友好）
- `/en` / `/en/enterprise/docs/...` → 英文
- 中间件 `middleware.ts`：
  - 命中 `/en/...` → 设置 `NEXT_LOCALE=en` cookie 后放行。
  - 其它路径 → 中文。
  - 首次访问根路径若 `Accept-Language` 偏好英文（且无 cookie 偏好），重定向到 `/en`。
  - `/api/*`、`/_next/*`、静态资源不走 i18n。

### 目录改造（App Router）

```
src/app/
  [locale]/
    layout.tsx           # 注入 <html lang> + LocaleProvider + dictionary
    page.tsx             # 原 src/app/page.tsx
    agents/page.tsx
    enterprise/
      page.tsx
      docs/
        layout.tsx
        page.tsx
        [...slug]/page.tsx
    docs/...
    privacy/page.tsx
    terms/page.tsx
    auth/...
  api/                   # 不进 [locale]
  globals.css
  layout.tsx             # 仅最外层 RootLayout 占位
middleware.ts            # 语言探测 + 重定向
```

### i18n 模块

```
src/i18n/
  config.ts              # locales = ['zh','en'] as const; defaultLocale = 'zh'
  dictionaries/
    zh.ts
    en.ts
  get-dictionary.ts      # 服务端：import('./dictionaries/'+locale)
  locale-context.tsx     # 客户端 Provider
  use-translations.ts    # 客户端 hook
  types.ts               # Dictionary 类型，从 zh.ts 反推保证 key 对齐
```

字典结构示例（节选）：

```ts
// zh.ts
export default {
  common: { backToHome: '返回首页', search: '搜索', loading: '加载中…' },
  nav: { home: '首页', enterprise: '企业版', agents: 'Agents', docs: '文档' },
  sidebar: {
    sections: {
      overview: '概览',
      architecture: '架构',
      appsModules: '应用与模块',
      apiReference: 'API 参考',
      gateway: 'AI 网关',
      dataPermissions: '数据与权限',
      configuration: '配置',
      plugins: '插件',
      devTesting: '开发与测试',
      observability: '可观测性',
      deployment: '部署',
      runbooks: 'Runbook',
      adr: '架构决策',
      sales: '销售与验收',
      legal: '法务',
    },
    items: { /* 按 slug 列出每个文档显示名的中文 */ },
    searchPlaceholder: '搜索企业文档…',
    backToEnterprise: '← 返回企业版概览',
  },
  localeSwitcher: { zh: '中文', en: 'English', label: '语言' },
  docs: { englishUnavailableBanner: '本页暂未提供英文版本，正在显示中文原文。' },
};
```

### 导航字典化

`navigation.ts` 从导出常量改为：

```ts
export function getEnterpriseDocNavigation(t: Dictionary): EnterpriseDocNavSection[] {
  return [
    { title: t.sidebar.sections.overview, items: [{ title: t.sidebar.items.index, slug: 'index' }] },
    // ...
  ];
}
```

`searchAliases` 保留英文 + 追加中文别名，提升双语搜索命中率。

### Markdown 文档双语回退

`src/lib/enterprise-docs/load-doc.ts` 改造：

```ts
export function loadDoc(slug: string, locale: Locale): { content: string; fallbackUsed: boolean } | null {
  if (locale === 'en') {
    const en = tryRead(`${slug}.en.md`);
    if (en) return { content: en, fallbackUsed: false };
  }
  const zh = tryRead(`${slug}.md`);
  if (!zh) return null;
  return { content: zh, fallbackUsed: locale === 'en' };
}
```

`fallbackUsed = true` 时在页面顶部插入 `EnglishUnavailableBanner` 组件。

### LocaleSwitcher

放在导航栏右侧，下拉菜单两项：中文 / English。点击逻辑：

1. 写入 `NEXT_LOCALE` cookie（1 年）。
2. `router.replace(swapLocaleInPath(pathname, nextLocale))`。

### 元数据与 SEO

- 每个 `[locale]/page.tsx` 用 `generateMetadata({ params: { locale } })` 输出对应 `title` / `description`。
- `openGraph.locale = locale === 'en' ? 'en_US' : 'zh_CN'`。
- `alternates.languages = { 'zh-CN': absolutePath, 'en': '/en' + absolutePath }`。
- 更新 `robots.ts`、新增 `sitemap.ts` 输出 zh/en 双套 URL。

## 分阶段实施（按可验收 commit 切分）

### P0 — i18n 基础设施（半天）

- 新增 `src/i18n/` 全套文件（config / dictionaries 骨架 / get-dictionary / locale-context / use-translations）。
- 新增 `middleware.ts`，实现 locale 协商 + 重定向。
- 新增 `src/components/locale-switcher.tsx`。
- 把 `src/app/layout.tsx` 拆为最外层 RootLayout（仅 `<html>`/`<body>` 占位）。
- 新建 `src/app/[locale]/layout.tsx`，注入 `<html lang>` 与 LocaleProvider。
- **验收**：`/` 与 `/en` 均可访问且互相切换；cookie 持久化生效；TS 与 build 绿。

### P1 — UI 字典（半天）

- 提取 sidebar / navigation / search-command / security-advisory-banner / 顶栏导航 / 页脚 / 「Back to」类按钮的全部硬编码字符串到 `zh.ts` + `en.ts`。
- `navigation.ts` 改为函数形态。
- LocaleSwitcher 接入导航栏。
- **验收**：`/enterprise/docs` 与 `/en/enterprise/docs` 侧栏分别显示中文 / 英文；搜索框 placeholder、`⌘K` 提示同步切换；与正文语言一致（中文文档在 `/`，英文回退提示条在 `/en`）。**截图回归**：复现用户提到的「侧栏英文 + 正文中文」case，确认已消除。

### P2 — 高优页面字典化（约 1 天）

- 把以下页面的中文 / 英文硬编码字符串迁出到字典：
  - `src/app/page.tsx`（589 行落地页）—— 量最大，按 hero / features / pricing / cta / footer 分块。
  - `src/app/enterprise/page.tsx`
  - `src/app/agents/page.tsx`
  - `src/app/privacy/page.tsx`、`src/app/terms/page.tsx`
- 元数据 `generateMetadata` 改造，输出 locale-aware title/description/OG。
- 更新 `robots.ts`，新增 `sitemap.ts`。
- **验收**：以上页面在 `/` 与 `/en` 下完全本地化；元数据正确；TS 与 build 绿。

### P3 — 文档双语回退机制（约 2 小时）

- 改造 `src/lib/enterprise-docs/load-doc.ts` 支持 `.en.md` 优先 + 中文回退。
- 改造 `src/app/[locale]/enterprise/docs/page.tsx` 与 `[...slug]/page.tsx` 传入 locale。
- 新增 `src/components/enterprise-docs/english-unavailable-banner.tsx`，`fallbackUsed` 时渲染在文档顶部（黄色温和提示，不破坏阅读）。
- `EnterpriseDocSearchCommand` 索引同时支持中英 title。
- **验收**：浏览 `/en/enterprise/docs/<未翻译 slug>` 显示中文 + 顶部 banner；浏览已翻译 slug 显示英文。

### P4 — 核心文档英文版（视翻译方式约 2~3 小时）

首批翻译 8 篇，覆盖落地路径：

1. `content/enterprise/README.md` → `README.en.md`（用作 index 回退源）
2. `content/enterprise/architecture/overview.md` → `.en.md`
3. `content/enterprise/architecture/data-flow.md` → `.en.md`
4. `content/enterprise/gateway/overview.md` → `.en.md`
5. `content/enterprise/apps/README.md` → `.en.md`（若存在；否则 `features.md`）
6. `content/enterprise/features.md` → `.en.md`
7. `content/enterprise/api/README.md` → `.en.md`
8. `content/enterprise/mvp-acceptance-checklist-v20260422.md` → `.en.md`

> 翻译策略：保留代码块、命令、路径、产品名、专有名词原样；表格、链接结构保持一致；如某篇文档涉及大量中文行业语境（如「移动云」「投资立项」），可适度本地化或注脚说明。

- **验收**：以上 8 篇在 `/en/enterprise/docs/...` 显示英文且不出现「英文不可用」banner。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `[locale]` 路由迁移破坏既有 URL | P0 步骤中保留所有原 URL（`/` 自动 = 中文），仅新增 `/en` 前缀；中间件做兼容 redirect。 |
| `app/page.tsx`（589 行）字典化字符串数量大，易遗漏 | 用 `rg -n "['\"][\u4e00-\u9fa5]" src/app/page.tsx` 与同义英文扫描双向核对；每提交一段做一次构建。 |
| LocaleSwitcher 在 RSC 与 client 边界混乱 | 严格区分：dictionary 注入在服务端 RSC，LocaleSwitcher 是 client component 通过 props/context 拿当前 locale。 |
| SEO 影响（旧链接被搜索引擎索引） | 在 `<head>` 加 hreflang `alternates`；保持 `/` 永久指向中文，避免 301 循环。 |
| 翻译质量参差 | P4 翻译走 AI 辅助 + 人工校对；不强求所有文档同时上线，回退机制兜底。 |

## 验收清单（DoD）

- [ ] 站点右上角 LocaleSwitcher 可用，切换后路径与 cookie 同步。
- [ ] `/enterprise/docs` 与 `/en/enterprise/docs` 侧栏、搜索、banner、面包屑全部正确本地化。
- [ ] 不再出现「侧栏英文 + 正文中文」的撕裂（含截图回归）。
- [ ] `<html lang>` 与 `og:locale` 随当前语言变化。
- [ ] 8 篇核心英文文档上线，其余 doc 在 `/en` 下显示中文 + 顶部「暂无英文版本」提示条。
- [ ] `pnpm ts-check` 与 `pnpm build` 全绿。
- [ ] 不新增第三方依赖（`package.json` 仅可能新增 `accept-language` 这类<10KB 工具，原则上手写实现，避免依赖膨胀）。

## 提交策略

每个 P 阶段一个 commit，必须包含：

```
Plan-Id: 2026-05-23-website-i18n-zh-en
Plan-File: AgenticX-Website/.plan/2026-05-23-website-i18n-zh-en.plan.md
Made-with: Damon Li
```

最终（或 P4 完成时）追加 `/update-conclusion` 维护对应模块总结。
