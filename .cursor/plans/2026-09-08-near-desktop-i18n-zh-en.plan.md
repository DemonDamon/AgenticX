# Near Desktop 中英文 i18n Implementation Plan

Planned-with: cursor-grok-4.6
Suggested-Impl-Model: Composer 2.5

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Near Desktop（`desktop/`）用户可见界面可在中文 / English 之间切换；默认跟随操作系统语言；选择立即生效并持久化。正经 i18n（`i18next` + `react-i18next` + JSON 词典），禁止组件内 `locale === "en" ? "Save" : "保存"`。

**Architecture:** 渲染进程用 i18next 同步初始化（首屏不闪错语言）。locale 解析：已保存值 → 否则 `en*` 系统语言为 `en`、其余为 `zh`。持久化对齐主题：`localStorage["agx-locale"]` + `~/.agenticx/layout.json` 的 `locale` 字段（经现有 `ui-prefs-set` / `layout-get`）。设置「显示」面板、外观行上方加语言下拉。macOS 自定义菜单读同一份 layout locale。

**Tech Stack:** Electron 34 + Vite + React 18 + Zustand + Vitest；新增 `i18next`、`react-i18next`。不使用 `next-intl`（那是 Next.js / 企业端方案）。

---

## 子规划 → 推荐实施模型

| 子规划 | Suggested-Impl-Model | 理由 |
|---|---|---|
| Wave 1 基础设施 + 语言切换 | Composer 2.5 | 接线 / 现有 `SettingsDropdown` 复用，无审美重塑 |
| Wave 2 设置页抽词 | Composer 2.5 | 机械替换字面量，按本 plan 协议执行 |
| Wave 3 壳层抽词 | Composer 2.5 | 同上 |
| Wave 4 聊天 chrome 抽词 | Composer 2.5 | 同上；勿改流式/SSE 逻辑 |
| Wave 5 工作区 / 群聊 / 自动化 | Composer 2.5 | 同上 |
| Wave 6 日期、错误边界、残留工具函数 | Composer 2.5 | 小 helper + 扫尾 |

最终 `Impl-Model` trailer 以实际使用为准，实施前向用户确认。

---

## 根因与证据（不依赖对话记忆）

| 事实 | 证据 |
|---|---|
| Desktop **没有** i18n 目录、没有 `i18next` / `react-i18next` 依赖 | `desktop/package.json` dependencies 无 i18n；`desktop/` 下 0 个 `*i18n*` 文件 |
| 设置「显示」文案全是硬编码中文 | `desktop/src/components/SettingsPanel.tsx` L7174–7233：`Panel title="显示"`、`外观`、`浅色`/`暗灰`/`深色` |
| 左侧设置 Tab 硬编码中文 | 同文件 L1013–1030 `TABS`：`用户账号`/`通用偏好`/`模型服务`… |
| `index.html` 写死 `lang="zh-CN"` | `desktop/index.html` L2 |
| 日期写死 `zh-CN` | 如 `ChatPane.tsx` L6039、`export-pdf-html.ts` L212、`ShareImagePreviewModal.tsx` L33 |
| 主题已有「localStorage + layout.json」双写，locale 应复用而非新文件 | `store.ts` L963–964、`setTheme` L1389–1397 `saveUiPrefs`；`electron/main.ts` `LayoutFile.theme` L507–511；`ui-prefs-set` L8780–8788 |
| 企业端已有 zh/en，但是 `next-intl`，不能搬到 Electron | `enterprise/apps/web-portal` `next-intl` + `messages/{zh,en}.json` |
| 用户可见中文散落面极大 | 抽样：`SettingsPanel.tsx` ~785 处、`ChatPane.tsx` ~378 处、另有上百个 tsx 含中文 |

**产品决策（已锁定，实施不得改）：**

1. 语言仅 `zh` / `en`。
2. 从未选过：跟系统。`app.getLocale()` / `navigator.language` 以 `en` 开头（忽略大小写，`_` 当 `-`）→ `en`，否则 `zh`（含 `zh-TW`，v1 只用简体词典）。
3. 一旦解析或用户选择，立刻落盘；之后不再因系统语言变化而跳变。
4. 切换立即重渲染，不重启应用。
5. 语言行选项文案固定为「中文」「English」（语言自名，避免用户看不懂当前 UI 时找不到开关）。
6. 不翻译：用户消息、模型回复、思考链原文、品牌名（Near / Machi / AgenticX）、模型/供应商名、文件路径、原始 API 错误体。
7. 不绑定语音识别语言（`desktop/src/voice/stt.ts` 等仍独立）。

---

## In scope

- `desktop/` 渲染进程用户可见 UI 文案（设置、侧栏、顶栏、聊天操作条、工作区、群聊编辑、自动化、弹窗、空态、tooltip、aria-label、命令面板）
- locale 解析 / 持久化 / 设置入口
- `~/.agenticx/layout.json` 增加 `locale`
- macOS 应用菜单自定义项（当前「设置」）
- `document.documentElement.lang`（`zh` → `zh-CN`，`en` → `en`）
- 日期时间格式随 locale
- zh/en key 对齐测试

## Out of scope（严禁顺手做）

- `enterprise/`、官网、Studio Python 后端提示词
- 第三种语言、翻译平台、RTL
- 改设置视觉/布局（语言行必须复制「外观」行结构，禁止新设计语言）
- 改聊天流式、SSE、store 会话内核、权限确认策略
- 翻译模型输出 / 改 STT/TTS/`recognition.lang`
- 把 `ui-prefs-set` 改成必须同时传 theme+locale（必须保持 **部分更新**，否则会抹掉已存 theme）
- 新建 `~/.agenticx/ui-locale` 独立文件（已否决；用 `layout.json`）
- 改 `agenticx/studio/server.py` import

---

## no-scope-creep 边界

每个 diff 必须能追溯到本 plan 某条 FR / 某 Wave。禁止顺手重构 `SettingsPanel`/`ChatPane`、禁止「顺便」改主题逻辑、禁止把英文当中文界面默认。

---

## FR / AC

**FR-1** 设置 → 通用偏好 → 显示：外观上方有语言下拉（中文 / English），切换后当前窗口全部已抽词 UI 立刻换语言。  
**AC-1** `desktop/src/i18n/resolve-locale.test.ts` 覆盖 OS 映射与已保存优先。手动：英文系统无 `agx-locale` 时首启为 English；切到中文后重启仍为中文。

**FR-2** locale 写入 `localStorage["agx-locale"]` 与 `layout.json.locale`。  
**AC-2** 单元：`normalizeLayoutLocale` 只接受 `zh`/`en`。Electron：`ui-prefs-set` 只传 `{ locale: "en" }` 不得清掉已有 `theme`。

**FR-3** 用户可见壳层/设置/聊天 chrome/工作区/弹窗走词典，禁止新增硬编码中英长句。  
**AC-3** `desktop/src/i18n/message-parity.test.ts`：各 namespace 的 zh/en key 集合全等。Wave 完成后，该 Wave 清单内文件不再出现用户可见中文/英文长句（测试断言与注释除外）。

**FR-4** 对话正文不翻译。  
**AC-4** 不改消息 `content` 渲染数据源；抽词只动 chrome（按钮、空态、工具卡标题、时间戳格式）。

**FR-5** macOS 菜单「设置」随 locale。  
**AC-5** `buildMenuTemplate(locale)`：`zh` →「设置」，`en` → `Settings`。改语言后菜单更新（`ui-prefs-set` 成功后重设 `Menu.setApplicationMenu`）。

---

## 目录与命名空间

```
desktop/
  locales/
    zh/
      common.json
      settings.json
      chat.json
      sidebar.json
      workspace.json
      electron.json
    en/
      common.json
      settings.json
      chat.json
      sidebar.json
      workspace.json
      electron.json
  src/i18n/
    locales.ts
    resolve-locale.ts
    format.ts
    flatten-messages.ts
    i18n.ts
    I18nProvider.tsx
    resolve-locale.test.ts
    message-parity.test.ts
    format.test.ts
  electron/app-locale.ts          # 与 resolve-locale 同规则，供 main 使用
```

命名空间职责：

| ns | 用途 |
|---|---|
| `common` | 保存/取消/删除/关闭/复制/重试/加载中/错误 |
| `settings` | 设置壳、Tab、显示区、各设置子页 |
| `chat` | 聊天 chrome、工具卡、确认条、空态 |
| `sidebar` | 侧栏、历史、账号条、命令面板 |
| `workspace` | 工作区、预览、WorkPanel |
| `electron` | 主进程菜单（渲染侧可不挂，main 直接读 JSON 或内嵌对照表） |

Key 约定：`camelCase` 点分层，如 `settings.display.language`、`settings.tabs.general`。插值用 i18next `{{count}}`。禁止在 key 里写中文。

---

## Wave 1 — 基础设施 + 语言切换（先做，可独立验收）

### Task 1: locale 纯函数

**Files:**
- Create: `desktop/src/i18n/locales.ts`
- Create: `desktop/src/i18n/resolve-locale.ts`
- Create: `desktop/src/i18n/resolve-locale.test.ts`
- Create: `desktop/electron/app-locale.ts`（逻辑与 `resolve-locale.ts` **逐字相同**，因 `electron/tsconfig.json` 只 `include: ["*.ts"]`，不能 import `src/`）

`locales.ts` 全文：

```ts
export const APP_LOCALES = ["zh", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "zh";
export const LOCALE_STORAGE_KEY = "agx-locale";

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh" || value === "en";
}

export function htmlLangFor(locale: AppLocale): string {
  return locale === "en" ? "en" : "zh-CN";
}
```

`resolve-locale.ts` 必须实现：

```ts
export function localeFromOsTag(tag: string | null | undefined): AppLocale {
  const lower = String(tag ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (lower.startsWith("en")) return "en";
  return "zh";
}

/** 已保存 > OS。saved 非法则当缺失。 */
export function resolveAppLocale(input: {
  saved?: unknown;
  osTag?: string | null;
}): AppLocale {
  if (isAppLocale(input.saved)) return input.saved;
  return localeFromOsTag(input.osTag);
}
```

**测试（先写后实现）：** `desktop/src/i18n/resolve-locale.test.ts`

| 输入 | 期望 |
|---|---|
| `saved: "en"` + 任意 OS | `en` |
| `saved: "zh"` + `en-US` | `zh` |
| `saved: "fr"` + `en-GB` | `en` |
| 无 saved + `en-US` / `en` / `EN_us` | `en` |
| 无 saved + `zh-CN` / `zh-TW` / `ja-JP` / `""` / `undefined` | `zh` |
| `isAppLocale` 仅 zh/en | true/false |
| `htmlLangFor("en")` | `"en"` |
| `htmlLangFor("zh")` | `"zh-CN"` |

Run: `cd desktop && npx vitest run src/i18n/resolve-locale.test.ts`

### Task 2: 词典骨架 + key 对齐测试

**Files:**
- Create: `desktop/locales/zh/common.json`、`en/common.json`
- Create: `desktop/locales/zh/settings.json`、`en/settings.json`
- Create: `desktop/locales/zh/chat.json`、`en/chat.json`（Wave 1 可 `{}`）
- Create: `desktop/locales/zh/sidebar.json`、`en/sidebar.json`（可 `{}`）
- Create: `desktop/locales/zh/workspace.json`、`en/workspace.json`（可 `{}`）
- Create: `desktop/locales/zh/electron.json`、`en/electron.json`
- Create: `desktop/src/i18n/flatten-messages.ts`
- Create: `desktop/src/i18n/message-parity.test.ts`

Wave 1 `settings.json` **必须**含这些 key（zh / en 都要有）：

```json
{
  "tabs": {
    "account": "用户账号",
    "general": "通用偏好",
    "provider": "模型服务",
    "mcp": "MCP",
    "connectors": "连接器",
    "tools": "内置工具",
    "skills": "技能配置",
    "knowledge": "知识库",
    "data_sources": "数据源",
    "memory": "记忆管理",
    "automation": "定时任务",
    "voice": "语音服务",
    "favorites": "内容收藏",
    "server": "远程连接",
    "security": "安全中心"
  },
  "display": {
    "title": "显示",
    "appearance": "外观",
    "appearanceHint": "选择界面的明暗层级",
    "themeLight": "浅色",
    "themeDim": "暗灰",
    "themeDark": "深色",
    "language": "语言",
    "languageHint": "界面语言，立即生效",
    "languageZh": "中文",
    "languageEn": "English",
    "messageLayout": "消息布局",
    "messageLayoutHint": "决定聊天内容的呈现方式",
    "layoutIm": "IM 风格",
    "layoutTerminal": "终端风格",
    "layoutClean": "简洁风格",
    "accent": "强调色",
    "accentHint": "用于按钮、选中状态与焦点提示",
    "accentBlue": "蓝色",
    "accentGreen": "绿色",
    "accentPink": "粉红色",
    "accentYellow": "黄色",
    "accentMono": "单色"
  }
}
```

en 对应：`Display` / `Appearance` / `Choose the interface brightness` / `Light` / `Dim` / `Dark` / `Language` / `Interface language. Applies immediately.` / `中文` / `English` / `Message layout` / `How chat content is presented` / `IM style` / `Terminal style` / `Clean style` / `Accent color` / `Used for buttons, selection, and focus` / `Blue` / `Green` / `Pink` / `Yellow` / `Mono`。

`electron.json`：

```json
{ "menu": { "settings": "设置" } }
```

en：`Settings`。

`common.json` Wave 1 最少：`save` `cancel` `close` `reload` `appCrashTitle`（错误边界用）。

`flatten-messages.ts`：递归 flatten 对象为 `"a.b.c"` key 列表。

`message-parity.test.ts`：对每个 ns，`flatten(zh)` 与 `flatten(en)` 排序后 deepEqual。缺 key 时报出具体路径。

Run: `cd desktop && npx vitest run src/i18n/message-parity.test.ts`

### Task 3: i18next 初始化

**Files:**
- Modify: `desktop/package.json` — dependencies 增加 `"i18next": "^25.4.0"`、`"react-i18next": "^15.7.0"`（若解析失败允许锁定当前能装的 25.x / 15.x，禁止 next-intl）
- Create: `desktop/src/i18n/i18n.ts`
- Create: `desktop/src/i18n/I18nProvider.tsx`
- Modify: `desktop/src/main.tsx` — `App` 外包 `<I18nProvider>`；错误边界用 `i18n.t("common:appCrashTitle")` / `common:reload`（`i18n.ts` 已同步 init，class 组件可 `import { i18n } from "./i18n/i18n"`）

`i18n.ts` 要点：

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const initial = resolveAppLocale({
  saved: typeof localStorage !== "undefined" ? localStorage.getItem(LOCALE_STORAGE_KEY) : null,
  osTag: typeof navigator !== "undefined" ? navigator.language : undefined,
});

void i18n.use(initReactI18next).init({
  lng: initial,
  fallbackLng: "zh",
  defaultNS: "common",
  ns: ["common", "settings", "chat", "sidebar", "workspace"],
  resources: { /* 静态 import 各 JSON */ },
  interpolation: { escapeValue: false },
  returnNull: false,
});
```

`I18nProvider`：`I18nextProvider` + 订阅 zustand `locale`，`useEffect` 里 `i18n.changeLanguage(locale)` 且 `document.documentElement.lang = htmlLangFor(locale)`。

`main.tsx` **before：** 直接 `<App />`。  
**after：** `<I18nProvider><App /></I18nProvider>`。错误边界三处中文改为 `i18n.t(...)`。

### Task 4: store + layout.json 持久化

**Files:**
- Modify: `desktop/src/store.ts` — 在 `theme` 旁增加 `locale: AppLocale`、`setLocale: (locale: AppLocale) => void`；`loadLocale()` 只读 `localStorage`（非法则返回 `null`，store 初值用 `resolveAppLocale({ saved: loadLocale(), osTag: navigator.language })`）
- Modify: `desktop/src/global.d.ts` `loadLayout` 返回值增加 `locale?: string`；`saveUiPrefs` 改为 `payload: { theme?: "dark"|"light"|"dim"; locale?: "zh"|"en" }`（至少一项）
- Modify: `desktop/electron/preload.ts` `saveUiPrefs` 类型同步
- Modify: `desktop/electron/main.ts`：
  - `LayoutFile` 增加 `locale?: AppLocale`
  - 新增 `normalizeLayoutLocale`（调 `electron/app-locale.ts` 的 `isAppLocale`）
  - `layout-get` 返回 `locale: normalizeLayoutLocale(data.locale) ?? ""`
  - **`ui-prefs-set` 改为部分更新**（这是回归点）：

**before（L8780–8788）：** 无 `theme` 直接 `invalid theme`，只 `saveLayoutData({ theme })`。  
**after：**

```ts
ipcMain.handle("ui-prefs-set", async (_event, payload: { theme?: unknown; locale?: unknown }) => {
  try {
    const patch: Partial<LayoutFile> = {};
    const theme = normalizeLayoutTheme(payload?.theme);
    if (theme) patch.theme = theme;
    const locale = normalizeLayoutLocale(payload?.locale);
    if (locale) patch.locale = locale;
    if (!patch.theme && !patch.locale) return { ok: false, error: "invalid ui prefs" };
    saveLayoutData(patch);
    if (locale && process.platform === "darwin") {
      Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate(locale)));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
```

- `setTheme` **继续只传 `{ theme }`**，不得改成必带 locale。
- `setLocale`：写 `localStorage`、`i18n.changeLanguage`、`saveUiPrefs({ locale })`。
- 新增 IPC `get-system-locale` → `app.getLocale()`；preload / `global.d.ts` 暴露 `getSystemLocale(): Promise<string>`。

**App.tsx L1577–1604 旁**（主题从 layout 回填的 `useEffect`）增加同等逻辑：

1. `loadLayout()` 若 `locale` 为 zh/en → `setLocale`
2. 否则若 localStorage 无有效值 → `getSystemLocale()` + `navigator.language` 解析后 `setLocale`（会落盘）
3. 不得在已有 saved locale 时再用 OS 覆盖

**index.html：** 在现有 theme 预脚本旁设置 `document.documentElement.lang`：

```js
var savedLocale = localStorage.getItem("agx-locale");
var nav = (navigator.language || "").toLowerCase();
var loc = savedLocale === "en" || savedLocale === "zh"
  ? savedLocale
  : nav.indexOf("en") === 0 ? "en" : "zh";
document.documentElement.lang = loc === "en" ? "en" : "zh-CN";
```

### Task 5: 设置「显示」语言行 + Tab 抽词

**Files:**
- Modify: `desktop/src/components/SettingsPanel.tsx`
- Modify: `desktop/src/App.tsx`（不必新传 props：语言从 store 读，与 `themeColor` 一样）

**TABS（L1013）：** 模块级常量不能用 hook。改为组件内：

```ts
const { t } = useTranslation("settings");
const tabs = useMemo(() => [
  { id: "account" as const, label: t("tabs.account"), icon: User },
  // …与现有 id 顺序完全一致，禁止重排 Tab
], [t]);
```

所有 `TABS.map` / `TABS.find` 改用 `tabs`。

**显示面板（L7174 起）插入点：** `<Panel title={t("display.title")}>` 后、外观行 **之前** 插入语言行，结构与外观行逐像素对齐（`flex min-h-14` + `SETTINGS_LABEL_CLASS` + `SETTINGS_HINT_CLASS` + `SettingsDropdown` `className="w-40 shrink-0"` `size="compact"` `menuPortal`）。中间同样用 `<div className="h-px bg-[var(--border-muted)]" />`。

语言行：

```tsx
const locale = useAppStore((s) => s.locale);
const setLocale = useAppStore((s) => s.setLocale);
const langOptions = [
  { value: "zh", label: t("display.languageZh") },
  { value: "en", label: t("display.languageEn") },
] as const;
```

`onChange` → `setLocale(next as AppLocale)`。

外观 / 消息布局 / 强调色的 label、hint、option 改为 `t("display.*")`。**不要改** `onThemeChange` / `themeColor` 行为。

**Wave 1 不做** 用户档案、模型服务等其余设置文案（留给 Wave 2）。

### Task 6: Electron 菜单

**Files:** `desktop/electron/main.ts` `buildMenuTemplate` L2530–2558；启动处 L12414

**before：** `label: "设置"` 无参。  
**after：** `buildMenuTemplate(locale?: AppLocale)`，locale 默认 `normalizeLayoutLocale(loadLayoutData().locale) ?? localeFromOsTag(app.getLocale())`。darwin 自定义项：`zh`「设置」/ `en` `Settings`。`role: "about"|"quit"|"undo"|…` 交给 Electron 系统本地化，不要手写 Edit/Window。

启动时 `Menu.buildFromTemplate(buildMenuTemplate())` 无参即可（内部读 layout/OS）。

### Task 7: Wave 1 验收

```bash
cd desktop && npm install
npx vitest run src/i18n/resolve-locale.test.ts src/i18n/message-parity.test.ts
```

若改了 `electron/main.ts` 的 IPC：完全退出后重启 `npm run dev`（主进程不热更新）。

手动：设置 → 通用偏好 → 显示 → 语言，中英来回切；刷新后保持；外观下拉仍可用。

---

## Wave 2 — 设置页抽词

**协议（后续 Wave 共用，必须遵守）：**

1. 只替换 **用户可见** 字符串（JSX 文本、`placeholder`、`title`、`aria-label`、`HoverTip`、toast）。
2. 注释、测试里的中文、log、内部枚举值（`id: "general"`）不动。
3. 新 key 同时写入 zh 与 en；先跑 `message-parity.test.ts`。
4. 不断言具体中文的旧测试：改为 `i18n.t(...)` 或断言 key/role。
5. 禁止改布局 class、禁止重排区块、禁止改保存逻辑。
6. 纯函数若 **返回给 UI 的中文**（如 `toolDisplayDescription` L1198）：改为 `(name, apiDescription, t)` 或返回 key；不要在 utils 里 `import i18n` 造成测试耦合——优先把 `t` 从组件传入。

**本 Wave 文件清单（必须抽完）：**

| 文件 | ns 前缀 |
|---|---|
| `desktop/src/components/SettingsPanel.tsx` 剩余 Tab/区块 | `settings.*` |
| `desktop/src/components/AccountTab.tsx` | `settings.account` |
| `desktop/src/components/AvatarSettingsPanel.tsx` | `settings.avatar` |
| `desktop/src/components/settings/voice/VoiceSettingsPanel.tsx` | `settings.voice` |
| `desktop/src/components/settings/WebSearchSettingsPanel.tsx` | `settings.webSearch` |
| `desktop/src/components/settings/security/*` | `settings.security` |
| `desktop/src/components/settings/mcp/*`（用户可见文案） | `settings.mcp` |
| `desktop/src/components/settings/knowledge/*` | `settings.knowledge` |
| `desktop/src/components/settings/connectors/ConnectorsTab.tsx` | `settings.connectors` |
| `desktop/src/components/settings/code-index/CodeIndexSettingsPanel.tsx` | `settings.codeIndex` |
| `desktop/src/components/settings/brains/*` | `settings.brains` |
| `desktop/src/components/settings/datasources/*` | `settings.dataSources` |
| `desktop/src/components/memory/TurnArchiveSettingsPanel.tsx` | `settings.memory` |
| `desktop/src/components/memory/MemoryGraphExplorer.tsx`（工具栏/空态，不译图谱节点业务名） | `settings.memoryGraph` |
| `desktop/src/components/settings/skills/PendingProposalsList.tsx` | `settings.skills` |
| `desktop/src/components/KeybindingsPanel.tsx` | `settings.keybindings` |

`EMAIL_PRESETS` 的 `QQ 邮箱` 等用户可见 label 抽到 `settings.email.presets.*`；host/port **不译**。

`settings-tab.ts` 的 id 枚举不译。

AC：打开每个设置 Tab，切 English 后标题/按钮/hint 为英文；保存/测试连通性行为不变。

---

## Wave 3 — 壳层

| 文件 | ns |
|---|---|
| `desktop/src/App.tsx` 用户可见字符串 | `sidebar` / `common` |
| `desktop/src/components/AvatarSidebar.tsx` | `sidebar` |
| `desktop/src/components/sidebar/SidebarSessionHistory.tsx` | `sidebar.history` |
| `desktop/src/components/SidebarAccountBar.tsx` | `sidebar.account` |
| `desktop/src/components/Topbar.tsx` / `TopbarLeftControls.tsx` | `sidebar.topbar` |
| `desktop/src/components/CommandPalette.tsx` | `sidebar.commandPalette` |
| `desktop/src/core/command-registry.ts` 命令显示名 | `sidebar.commands`（`t` 传入或 registry 存 key） |
| `desktop/src/components/quick-compose/*` | `sidebar.compose` |
| `desktop/src/components/global-search/*` | `sidebar.search` |
| `desktop/src/components/ConfirmDialog.tsx` | `common` |
| `desktop/src/components/ForwardPicker.tsx` | `chat.forward` |
| `desktop/src/components/ClarificationDialog.tsx` | `chat.clarify` |
| `desktop/src/components/ShareImagePreviewModal.tsx` | `chat.share` |
| `desktop/src/components/gallery/AvatarGalleryView.tsx` | `sidebar.gallery` |
| `desktop/src/components/groups/GroupEditorInline.tsx` / `GroupTemplateCreateDialog.tsx` / `ProjectsView.tsx` | `sidebar.groups` |
| `desktop/src/components/AvatarCreateDialog.tsx` | `sidebar.avatarCreate` |
| `desktop/src/components/AccountIdentityControl.tsx` | `sidebar.identity` |

群模板 `group-templates.ts`：用户可见 `name`/`description` 抽到 `sidebar.groupTemplates.<id>.*`；模板 **id / 系统提示** 不译。

---

## Wave 4 — 聊天 chrome

只动 chrome，**禁止**改 SSE、重试、附件 `sourcePath`、多窗格模型绑定。

| 文件 | ns |
|---|---|
| `desktop/src/components/ChatPane.tsx` 按钮/空态/tooltip/composer 提示 | `chat` |
| `desktop/src/components/ChatView.tsx` 同上 | `chat` |
| `desktop/src/components/messages/ToolCallCard.tsx` | `chat.tool` |
| `desktop/src/components/messages/TurnToolGroupCard.tsx` | `chat.tool` |
| `desktop/src/components/messages/InlineConfirmCard.tsx` | `chat.confirm` |
| `desktop/src/components/messages/ClarificationCard.tsx` | `chat.clarify` |
| `desktop/src/components/messages/ReasoningBlock.tsx` | `chat.reasoning`（Thinking / Thought） |
| `desktop/src/components/messages/ImBubble.tsx` 操作条（复制/引用/收藏…） | `chat.actions` |
| `desktop/src/components/StickyTaskBar.tsx` | `chat.taskBar` |
| `desktop/src/components/SubAgentCard.tsx` / `SubAgentPanel.tsx` | `chat.subagent` |
| `desktop/src/components/TodoUpdateCard.tsx` | `chat.todo` |
| `desktop/src/components/composer/*` | `chat.composer` |
| `desktop/src/components/ModelPicker.tsx` | `chat.model` |
| `desktop/src/utils/noisy-chat-messages.ts` 等返回 UI 文案的 helper | 改为 key 或接收 `t` |

`toLocaleTimeString("zh-CN")` 改为 `desktop/src/i18n/format.ts` 的 `formatClock(ts, locale)`（en → `en-US`）。

AC：切 English 后输入区/工具卡/操作条为英文；发出一条消息，气泡正文仍是模型原文。

---

## Wave 5 — 工作区 / WorkPanel / 自动化

| 文件 | ns |
|---|---|
| `desktop/src/components/WorkspacePanel.tsx` | `workspace` |
| `desktop/src/components/workspace/*` 用户可见 | `workspace.preview` |
| `desktop/src/components/work-panel/*` | `workspace.work` |
| `desktop/src/components/automation/*` | `settings.automation` 或 `workspace.automation`（选一，全 Wave 一致） |
| `desktop/src/components/graph/*` 面板标题/空态 | `workspace.graph` |
| `desktop/src/components/CollabRoomPanel.tsx` | `workspace.collab` |
| `desktop/src/components/connectors/ConnectorsMenuButton.tsx` | `workspace.connectors` |

「在访达中显示」等按 `hostPlatform` 分支保留，但字符串走 i18n（`workspace.reveal.darwin` / `win32` / `linux`）。

---

## Wave 6 — 日期、错误边界、残留扫描

**Create:** `desktop/src/i18n/format.ts` + `format.test.ts`

```ts
export function dateLocale(locale: AppLocale): string {
  return locale === "en" ? "en-US" : "zh-CN";
}
export function formatClock(ts: number | string | Date, locale: AppLocale): string {
  return new Date(ts).toLocaleTimeString(dateLocale(locale), { hour: "2-digit", minute: "2-digit" });
}
export function formatDateTime(ts: number | string | Date, locale: AppLocale): string {
  return new Date(ts).toLocaleString(dateLocale(locale));
}
```

替换这些写死点（以仓库当时行号为锚，实施时按符号搜 `toLocaleTimeString("zh-CN")` / `toLocaleString("zh-CN")`）：

- `desktop/src/components/ChatPane.tsx`
- `desktop/src/utils/export-pdf-html.ts`（导出 HTML 的 `lang` 与时间）
- `desktop/src/components/ShareImagePreviewModal.tsx`
- `desktop/src/components/messages/ForwardedHistoryModal.tsx`

残留扫描命令（实施者必须跑）：

```bash
cd desktop && rg -l '[\u4e00-\u9fff]{2,}' src --glob '*.tsx' --glob '*.ts' | grep -v '\.test\.'
```

对仍命中的 **用户可见** 字符串按所在 Wave 补 key。测试文件、注释、`group-templates` 系统提示、供应商 displayName 数据、模型 hover 里的产品名可保留。

`message-turn-meta.ts` 的 `TURN_USAGE_MISSING_*` / `formatTurnUsageTitle`：改为接收 `t` 或迁到组件用 `chat.usage.*`。

---

## 抽词协议伪代码（Wave 2–6）

**before：**

```tsx
<div className={SETTINGS_LABEL_CLASS}>外观</div>
```

**after：**

```tsx
<div className={SETTINGS_LABEL_CLASS}>{t("display.appearance")}</div>
```

**before（模块级）：**

```ts
const TABS = [{ id: "general", label: "通用偏好", icon: Settings2 }];
```

**after：** 组件内 `useTranslation` + `useMemo` 依赖 `[t]`，`id`/`icon` 不变。

---

## 依赖与启动

```bash
cd desktop && npm install i18next@^25.4.0 react-i18next@^15.7.0
```

改 `electron/main.ts` / preload / IPC 后：**完全退出 Electron 再 `npm run dev`**。只刷新渲染进程看不到菜单/IPC 变化。

---

## 验收总表

- [ ] Wave 1：语言行可用；刷新保持；英文 OS 无保存值时默认 English；`ui-prefs-set` 只更新 locale 不丢 theme
- [ ] 设置各 Tab 中英切换完整（Wave 2）
- [ ] 侧栏/顶栏/命令面板/历史（Wave 3）
- [ ] 聊天操作与空态（Wave 4）；消息正文不译
- [ ] 工作区/自动化（Wave 5）
- [ ] 时间格式随语言；macOS「设置」菜单随语言（Wave 6）
- [ ] `npx vitest run src/i18n` 绿
- [ ] `message-parity` 全 namespace 绿

---

## 实施顺序

1. 将本文件从 `.cursor/plans/pending/` **移到** `.cursor/plans/2026-09-08-near-desktop-i18n-zh-en.plan.md`
2. 开分支（如 `feat/desktop-i18n-zh-en`）
3. 按 Wave 提交；每 Wave 独立可运行。commit 用 `/commit --spec=.cursor/plans/2026-09-08-near-desktop-i18n-zh-en.plan.md`，并询问用户 `Plan-Model` / `Impl-Model`
