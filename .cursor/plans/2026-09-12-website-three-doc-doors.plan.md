# 官网三形态：独立文档门 + 首页三图

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Cursor Grok 4.6

## Goal

首页「三种产品形态」应对齐三张架构图和三扇独立文档门；顶栏用 Framework / Near / Enterprise 替换含糊的单一 Documentation。

## 根因

`AgenticX-Website/src/components/home-page-content.tsx` hero 只渲染 `DiagramFigure name="product"`，`#stack` 只渲染 `name="near"`。Enterprise JPG 已在 `public/diagrams/enterprise-architecture-{en,zh}.jpg`，`DiagramFigure` 已支持 `enterprise`，但首页没挂。顶栏 `site-nav.tsx` 只有 Enterprise + Documentation（`/docs`），Near 埋在 `/docs/concepts/near`。

## In scope（仅 Website 仓）

- 顶栏：Features / Framework / Near / Enterprise / Examples / Ontology（去掉 Documentation）
- 首页 `#stack`：三张官方架构 JPG + 各自文档 CTA
- `/near` 产品页（对标 `/enterprise`）
- `/near/docs` Near 文档门（复用已有 `near.ts` 正文，不新写长文）
- `/docs` 文案改为框架文档门；侧栏去掉 Near 概念项
- 三套文档侧栏加产品切换条
- sitemap 补 `/near`、`/near/docs`

## Out of scope

- 不拆走 `/docs/concepts/near` 旧 URL（保留，避免断链）
- 不新写 Near 文档长文、不重画 JPG、不改 Enterprise 文档树正文
- 不重做整站视觉 / Ontology / Examples / auth / agents
- 不改主仓 `enterprise/docs`、不碰 `agenticx/studio/server.py`
- 不把 Mermaid 画进营销页

## IA

| 产品 | 顶栏 | 文档门 | 架构图 |
|------|------|--------|--------|
| Framework / Runtime | `/docs` | `/docs` | `product-architecture-{locale}.jpg` |
| Near Desktop | `/near` | `/near/docs` | `near-architecture-{locale}.jpg` |
| Enterprise | `/enterprise` | `/enterprise/docs` | `enterprise-architecture-{locale}.jpg` |

## 精确落点

### 1. i18n

`src/i18n/dictionaries/en.ts` 与 `zh.ts` 必须同 shape（`Dictionary = typeof zh`）。

`nav` 新增：

- `framework`: `Framework` / `框架`
- `near`: `Near` / `Near`

保留 `documentation` 键（别处可能用），顶栏不再读它。

`home.stack` 改为每形态自带 caption + 共用 `readDocs`：

```ts
stack: {
  title, subtitle, readDocs,
  core: { title, description, caption },
  near: { title, description, caption },
  enterprise: { title, description, caption },
}
```

删除旧的单一 `stack.caption`（两本词典都删，避免残留不同 shape）。

新增 `nearPage`（与 `enterprisePage` 同级，字段）：

- `metadata.title` / `metadata.description`
- `badge`
- `hero.titleLine1` / `titleLine2` / `subtitle` / `viewDocs`
- `architecture.title` / `subtitle` / `caption` / `overviewTitle` / `readFull`
- `pillars.workspace|runtime|studio` 各 `{ title, description }`
- `footer.brand`

`frameworkDocs.landing`：

- `title` → Framework documentation / 框架文档
- `description` / `intro` 只讲 SDK + Studio + Runtime
- 新增 `siblingHeading` / `siblingNear` / `siblingNearDesc` / `siblingEnterprise` / `siblingEnterpriseDesc`
- 保留 `near` / `nearDesc` 键（可给 sibling 复用），避免大面积删键

新增 `docsSwitcher`（给三侧栏共用）：

- `framework` / `near` / `enterprise`（短标签即可，可与 `nav.*` 相同文案）

### 2. 顶栏

`src/components/site-nav.tsx`

- `active?: 'home' | 'framework' | 'near' | 'enterprise' | 'ontology'`
- 桌面 + 移动菜单顺序：Features → Framework(`/docs`) → Near(`/near`) → Enterprise(`/enterprise`) → Examples → Ontology
- 删除 Documentation → `/docs` 那一项（Framework 已承担）
- `md:flex` 的 `gap-6` 可改为 `gap-4 lg:gap-6`，避免 6 个字链挤爆

### 3. 首页三图

`src/components/home-page-content.tsx`

- **删** hero 里那张 `DiagramFigure name="product"`（避免产品图出现两次；三种形态集中在 `#stack`）
- `#stack` 用三个连续块，禁止再只画 Near 一张：

```tsx
const forms = [
  { name: 'product', copy: t.home.stack.core, href: localizedPath('/docs', locale) },
  { name: 'near', copy: t.home.stack.near, href: localizedPath('/near/docs', locale) },
  { name: 'enterprise', copy: t.home.stack.enterprise, href: localizedPath('/enterprise/docs', locale) },
] as const;
```

每块：`h3` + `p` + `DiagramFigure name={...} alt={copy.title} caption={copy.caption}` + `Link`（`t.home.stack.readDocs` + ArrowRight）。

- **删** 现在 `#stack` 底部那三行纯文字 `Link` 列表（与图块重复）

`DiagramFigure`（`src/components/diagram-figure.tsx`）不改映射。图源已是 JPG，不要改成 `ent-topo` SVG（营销页继续用官方架构 JPG）。

### 4. `/near` 产品页

新建：

- `src/app/[locale]/near/page.tsx` — 抄 `enterprise/page.tsx` 的 metadata / `isLocale` 模式，渲染 `NearPageContent`，字典走 `t.nearPage`
- `src/components/near-page-content.tsx` — 结构对齐 `enterprise-page-content.tsx`，但更短：

  - `<SiteNav active="near" />`
  - hero：badge + 两行标题 + `viewDocs` → `/near/docs`
  - `DiagramFigure name="near"`
  - 三支柱 Link：workspace → `/near/docs`，runtime → `/docs/guides/studio`，studio → `/docs/guides/studio`（或 runtime → `/docs/concepts/agent`）
  - footer：Home / Near docs / GitHub

禁止新视觉体系（不要 violet 营销色、不要新动画）。沿用现有 `border-border` / `bg-card` / `HeroBackdrop`。

### 5. `/near/docs` 文档门

新建：

- `src/app/[locale]/near/docs/layout.tsx` — 抄 `docs/layout.tsx`：左侧 `NearDocSidebar`，`main.ml-64`，banner + `max-w-4xl`
- `src/app/[locale]/near/docs/page.tsx` — `DocContent` 或轻量 article：title/description 来自 `nearContent[locale]`（`src/app/[locale]/docs/[...slug]/content/near.ts`），正文 `MarkdownRenderer content={nearContent[locale].content}`
- `src/components/near-docs/sidebar.tsx` — 固定窄侧栏，不要复制整棵 framework `docNavigation`

侧栏链接（写死 4 项即可）：

| 标签 | href |
|------|------|
| Near Desktop | `/near/docs` |
| Studio Server | `/docs/guides/studio` |
| Agent Runtime | `/docs/concepts/agent` |
| Configuration | `/docs/getting-started/configuration` |

底部：`← Back to Near` → `/near`

面包屑：Home / Near docs / 当前标题。`DocContent` 面包屑写死 `/docs`，**不要**拿来渲染 Near 门（会跳回框架）。Near 文档页自己写一段与 `DocContent` 同视觉的 header，或给 `DocContent` 加可选 `docsRoot="/near/docs"`——优先**自写短 header**，避免改 `getPrevNext` 行为。

### 6. 框架文档门

`src/app/[locale]/docs/page.tsx`

- 标题/描述改用更新后的 `frameworkDocs.landing`
- **删** Core Concepts 里指向 `/docs/concepts/near` 的那张卡
- 在 intro 下或文末加 sibling 两卡：`/near/docs`、`/enterprise/docs`

`src/components/docs/navigation.ts` Concepts：**删除** `{ title: 'Near Desktop', slug: 'concepts/near' }`。页面文件 `near.ts` 与 `[...slug]` 路由保留。

### 7. 三侧栏产品切换

新建 `src/components/docs-product-switcher.tsx`（client）：

三个 `Link`：`/docs`、`/near/docs`、`/enterprise/docs`。`active` 用当前门高亮 `text-foreground`，其余 `text-muted-foreground`。

插入位置（logo 下方、搜索上方）：

- `src/components/docs/sidebar.tsx`
- `src/components/near-docs/sidebar.tsx`
- `src/components/enterprise-docs/sidebar.tsx`

只加这一条切换，不改 Enterprise 侧栏颜色体系。

### 8. sitemap

`src/app/sitemap.ts` 的 `staticPaths` 追加 `'/near'`、`'/near/docs'`。

## 验收

- `/en` 与 `/`（zh）：`#stack` 可见 3 张图；每张有进对应文档门的链接
- 顶栏：Framework → `/docs`（或 `/en/docs`），Near → `/near`，Enterprise → `/enterprise`；无 Documentation
- `/near/docs` 正文与现 `/docs/concepts/near` 同内容；侧栏不是框架 30 项
- `/docs` 侧栏 Concepts 无 Near；landing 有另两扇门
- `/docs/concepts/near` 仍 200
- 浅/深色下 JPG 仍可读（黑底 figure 已有，勿改）
- Website 仓 `pnpm ts-check`（或项目里等价脚本）通过
- 浏览器走一遍 `/en` → 三图三链 → `/en/near` → `/en/near/docs` → switcher 到 Framework / Enterprise

## 推荐实施模型

| 子任务 | 模型 | 理由 |
|--------|------|------|
| 全文案 + 路由 + 侧栏 | Composer 2.5 / Cursor Grok 4.6 | 样板接线，落点已写死 |
| 视觉重塑 | 不上 | Out of scope |
