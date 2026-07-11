# Near 桌面端「连接器」设置页视觉原型

Planned-with: gpt-5.6-sol-medium
Suggested-Impl-Model: composer-2.5
Status: implementation-ready prototype

## 目标与交付边界

在 Near 设置面板左侧导航新增独立「连接器」入口，并实现一版可评审的连接器目录视觉原型，用于确认信息架构、卡片密度、响应式布局与交互反馈。

本计划是**视觉原型**，不是已上线的连接能力：

- 所有卡片均显示「即将支持」，不得显示绿色「已连接」状态。
- 不接入 open-connector、不读取真实连接状态、不实现 OAuth/API Key。
- 点击添加按钮只展示 Near 现有 Toast，明确提示能力尚未开放。
- 未经用户单独确认，不把本原型描述为“连接器已经可用”。

## 视觉基线

用户提供的 WorkBuddy 截图仅作为布局参考，不复制其产品目录或第三方品牌资产。实现必须满足：

1. 设置页左侧导航在 `MCP` 与「内置工具」之间新增「连接器」，使用 `Link2` 链条图标。
2. 内容区采用连接器卡片网格；卡片结构固定为：
   - 左侧 36×36 圆角图标占位；
   - 中间服务名与单行描述；
   - 右侧 32×32 圆形 `Plus` 按钮。
3. 卡片使用 Near 现有 `border-border`、`bg-surface-card`、`bg-surface-hover`、`text-text-*` token，不新增硬编码主题颜色。
4. 不复制截图中的「专家 / 技能 / 连接器」顶部导航；Near 已有设置页左侧导航，必须沿用现有信息架构。
5. Provider 图标只使用中性文字缩写，不下载、复制或打包第三方商标图片。真实图标与品牌合规留待后续正式集成计划处理。

## 实施者开始前必须读取

- `desktop/src/settings-tab.ts:1-25`
- `desktop/src/components/SettingsPanel.tsx:17-45`
- `desktop/src/components/SettingsPanel.tsx:977-994`
- `desktop/src/components/SettingsPanel.tsx:9016-9433`
- `desktop/src/components/ds/Toast.tsx`
- `desktop/src/components/ds/Button.tsx`
- `desktop/src/components/settings/datasources/DataSourcesSettings.tsx:8-21,79-112`
- `desktop/package.json:9-20`

## In scope

- 修改 `desktop/src/settings-tab.ts`
- 修改 `desktop/src/components/SettingsPanel.tsx`
- 新建 `desktop/src/components/settings/connectors/ConnectorsTab.tsx`
- 使用组件内只读 fixture 渲染 8 个预览卡片
- 响应式、键盘、读屏和 Toast 反馈
- Desktop build 与手动视觉回归

## Out of scope

- 不创建 `connector-catalog.ts`、API client、状态 store 或通用 connector abstraction
- 不修改 `desktop/electron/main.ts`、`preload.ts`、`global.d.ts`
- 不修改 MCP、飞书、微信或数据源逻辑
- 不显示任何真实或伪造的「已连接」状态
- 不引入 `sonner` 或其他依赖
- 不提交代码；只有用户明确要求时才执行 git commit

## Task 1：注册设置 Tab

### 文件

- Modify: `desktop/src/settings-tab.ts:2-19`
- Modify: `desktop/src/components/SettingsPanel.tsx:17-45`
- Modify: `desktop/src/components/SettingsPanel.tsx:977-994`

### 改动

1. 在 `SETTINGS_TAB_IDS` 的 `"mcp"` 后插入 `"connectors"`：

```ts
  "provider",
  "mcp",
  "connectors",
  "tools",
```

2. 在 `SettingsPanel.tsx` 现有 `lucide-react` 具名 import 中加入 `Link2`；禁止新增 `lucide-react/dist/*` import。
3. 在 `TABS` 中固定插入：

```ts
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "connectors", label: "连接器", icon: Link2 },
  { id: "tools", label: "内置工具", icon: Wrench },
```

### 验收

- `SettingsTab` 联合类型自动包含 `"connectors"`。
- `isSettingsTab("connectors")` 返回 `true`，无需修改函数实现。
- 原有 Tab 顺序与内容不变。

## Task 2：实现 `ConnectorsTab`

### 文件

- Create: `desktop/src/components/settings/connectors/ConnectorsTab.tsx`

### 固定数据模型

Fixture 只在组件文件内使用，不导出：

```ts
type PreviewConnector = {
  id: string;
  name: string;
  description: string;
  initials: string;
  availability: "coming_soon";
};
```

固定展示以下 8 项，顺序不得自行调整：

```ts
const PREVIEW_CONNECTORS: PreviewConnector[] = [
  { id: "github", name: "GitHub", description: "查看仓库、Issue 与 Pull Request", initials: "GH", availability: "coming_soon" },
  { id: "gmail", name: "Gmail", description: "收发、搜索和整理邮件", initials: "GM", availability: "coming_soon" },
  { id: "notion", name: "Notion", description: "浏览页面与数据库内容", initials: "NO", availability: "coming_soon" },
  { id: "slack", name: "Slack", description: "读取频道并发送消息", initials: "SL", availability: "coming_soon" },
  { id: "gdrive", name: "Google Drive", description: "查找与管理云端文件", initials: "GD", availability: "coming_soon" },
  { id: "airtable", name: "Airtable", description: "读取和更新表格记录", initials: "AT", availability: "coming_soon" },
  { id: "supabase", name: "Supabase", description: "访问项目数据与服务", initials: "SB", availability: "coming_soon" },
  { id: "bigquery", name: "BigQuery", description: "查询和分析数据集", initials: "BQ", availability: "coming_soon" },
];
```

### 固定组件结构

组件包含：

1. 标题「连接器」
2. 说明「连接常用账号与服务，让 Near 在获得授权后调用对应能力。」
3. 黄色预览提示「当前为界面预览，连接能力尚未开放。」
4. 响应式网格：

```tsx
<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
```

5. 卡片根节点：

```tsx
className="group flex min-h-[84px] items-center gap-3 rounded-xl border border-border bg-surface-card px-3 py-3 transition hover:bg-surface-hover"
```

6. 图标占位：

```tsx
className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-panel text-[11px] font-semibold text-text-subtle"
```

7. 描述必须 `truncate`，卡片不得因长描述增高。
8. 添加按钮使用现有 `Button`，但不得使用不存在的 `size` 属性：

```tsx
<Button
  variant="ghost"
  className="h-8 w-8 shrink-0 rounded-full p-0"
  aria-label={`连接 ${item.name}`}
  onClick={() => showToast(`${item.name} 连接能力即将支持`)}
>
  <Plus className="h-4 w-4" aria-hidden />
</Button>
```

9. 按钮必须可通过 Tab 聚焦；沿用浏览器可见焦点，不添加 `outline-none`。
10. 不渲染绿色圆点或「已连接」文字。

### Toast 固定实现

复用 `DataSourcesSettings` 模式：

```ts
const [toastOpen, setToastOpen] = useState(false);
const [toastMessage, setToastMessage] = useState("");

const showToast = useCallback((message: string) => {
  setToastMessage(message);
  setToastOpen(true);
}, []);
```

组件根部渲染：

```tsx
<Toast
  open={toastOpen}
  message={toastMessage}
  onClose={() => setToastOpen(false)}
/>
```

## Task 3：接入内容区

### 文件

- Modify: `desktop/src/components/SettingsPanel.tsx`

### 改动

1. 在 MCP 组件 import 区附近精确新增：

```ts
import { ConnectorsTab } from "./settings/connectors/ConnectorsTab";
```

2. 在完整 MCP 分支结束后、`ToolsTab` 分支前插入：

```tsx
{tab === "connectors" && <ConnectorsTab />}
{tab === "tools" && <ToolsTab ref={toolsTabRef} />}
```

3. `SettingsPanel.tsx` 是大文件，只允许精确插入目标行；不得替换相邻 import 块或 Tab 内容块。

## Verification Contract

### 自动验证

在仓库根执行：

```bash
cd desktop && npm run build
```

预期：

- Vite build 成功
- Electron TypeScript 编译成功
- 无 `size` 属性、缺失 import 或 `SettingsTab` 类型错误

### 手动视觉验证

执行：

```bash
cd desktop && npm run dev
```

完全退出并重新启动 Electron 后检查：

1. 设置左侧导航在 MCP 后显示「连接器」和链条图标。
2. 标准宽度显示 2-3 列；窄窗口降级为 1 列，无横向滚动。
3. 8 个卡片顺序正确，描述单行截断。
4. 所有卡片均显示预览语义，不出现「已连接」。
5. 点击任意 `+` 后只出现一次贴近应用既有样式的 Toast。
6. 键盘 Tab 可依次聚焦 8 个按钮；读屏名称为「连接 <服务名>」。
7. MCP、内置工具、技能配置三个现有 Tab 仍可正常打开。

## Definition of Done

- 仅修改本计划列出的 3 个代码路径
- `npm run build` 通过
- 手动视觉与键盘验收全部通过
- 不产生真实连接、伪造状态、新依赖或后端改动
- 原型验收后，由用户决定是否保留、调整或等待正式集成再合入
