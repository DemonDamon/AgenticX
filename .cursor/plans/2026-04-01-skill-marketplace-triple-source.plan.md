---
name: ""
overview: ""
todos: []
isProject: false
---

# 技能市场三源重构：推荐 + ClawHub + SkillHub

> Plan-Id: 2026-04-01-skill-marketplace-triple-source
> Created: 2026-04-01
> Author: Damon Li

## 背景

当前 SettingsPanel 的「技能」Tab 底部只有一个「浏览市场」搜索框（走 ClawHub + AGX 聚合），和一个「已安装扩展包」区块。用户希望：

1. **推荐区**：在市场搜索上方，以卡片形式展示官方 APP 自行发布的技能（如腾讯文档 Skill、ima 知识库 Skill、腾讯会议 Skill），点击「安装」后跳转到 Meta-Agent 的一个新 session，自动发送预设的安装指令让 agent 执行。
2. **ClawHub 市场**（原「浏览市场」改名）：保持现有搜索+安装流程不变，仅改标题。
3. **SkillHub 市场**（新增）：来自腾讯 [SkillHub](https://skillhub.tencent.com/) 的 ClawHub 生态镜像/加速源，提供搜索框，搜索结果点击「安装」时跳转到 Meta-Agent 新 session 发送安装指令执行。

## 需求

### FR-1: 推荐技能区

- **位置**：在「ClawHub 市场」区块上方，新增「推荐」section。
- **数据源**：内置注册表 JSON/TS 常量（不走后端 API），每个条目包含：
  - `id`: 唯一标识（如 `tencent-docs`）
  - `name`: 显示名（如「腾讯文档」）
  - `provider`: 提供方（如「腾讯」）
  - `description`: 一句话描述
  - `icon_emoji`: 临时用 emoji 标识（后续可换图标）
  - `official_url`: 官方说明页 URL
  - `install_prompt`: 预设的安装指令文本（发给 Meta-Agent 执行）
  - `requires_api_key`: 是否需要用户先获取 API Key
  - `api_key_url`: API Key 获取页面 URL（可选）
  - `category`: 分类标签
- **UI**：小卡片网格（2 列），每张卡片展示图标/名称/描述/提供方，底部两个按钮：
  - 「安装」→ 触发 FR-4 的安装流程
  - 「官网 ↗」→ `window.open(official_url)`
- **初始内置条目**：
  1. **腾讯文档**：`install_prompt` = `"请安装腾讯文档技能\n说明页：https://docs.qq.com/scenario/open-claw.html?nlc=1\n请根据页面指引完成安装。"`，`official_url` = `https://docs.qq.com/scenario/open-claw.html?nlc=1`
  2. **ima 知识库**：`install_prompt` = `"请安装 ima 技能\n下载地址：https://app-dl.ima.qq.com/skills/ima-skills-1.1.2.zip\nAPI Key 获取：https://ima.qq.com/agent-interface"`，`official_url` = `https://ima.qq.com/agent-interface`，`requires_api_key` = true
  3. **腾讯会议**：`install_prompt` = 根据 `https://meeting.tencent.com/ai-skill/` 页面指引构造，`official_url` = `https://meeting.tencent.com/ai-skill/`

### FR-2: ClawHub 市场（改名）

- 将现有「浏览市场」section 标题改为「ClawHub 市场」。
- 保持现有搜索框、搜索结果列表、安装确认、风险提示等全部逻辑不变。
- ClawHub badge 保留不变。

### FR-3: SkillHub 市场（新增）

- **位置**：在「ClawHub 市场」区块下方、「已安装扩展包」区块上方。
- **UI**：
  - section 标题「SkillHub 市场」，右侧小字链接「skillhub.tencent.com ↗」
  - 搜索框 + 搜索按钮（独立 state，不复用 ClawHub 的 `marketQuery`）
  - 搜索结果列表：卡片展示 `name`、描述、作者、版本、下载量（若 API 返回）
  - 每个结果卡片有「安装」按钮和「详情 ↗」按钮（链接到 `https://skillhub.tencent.com/skill/{slug}`）
- **搜索后端**：
  - 新增后端 API `GET /api/registry/skillhub/search?q=...`
  - 后端调用 SkillHub API（需调研其 REST 接口；若无公开 API 则走页面爬取或 CLI 代理）
  - Desktop IPC 新增 `searchSkillHub` handler
- **安装流程**：点击「安装」→ 触发 FR-4，install_prompt 为：

```
  请先检查是否已安装 SkillHub 商店，若未安装，请根据 https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/skillhub.md 安装 Skillhub商店，然后安装{skill_name}技能。
  
  若已安装，则直接安装{skill_name}技能。
  

```

  （优先采用 SkillHub 加速安装）

### FR-4: 安装跳转到 Meta-Agent 新 Session

- 推荐区和 SkillHub 的「安装」按钮统一走此流程：
  1. 创建一个新的 Meta-Agent session（调用现有的 session 创建 API）
  2. 自动切换到该 session 对应的 pane（或打开 Meta-Agent pane）
  3. 自动在新 session 的输入框填入 `install_prompt` 并发送
  4. 用户可在 Meta-Agent 对话中看到完整的安装过程（下载、配置、确认等）
- 若 `requires_api_key` = true，安装前弹出小提示：「此技能需要 API Key，请先访问 {api_key_url} 获取」，提供「去获取」（打开链接）和「我已有 Key，继续安装」两个选项。

### NFR-1: 不二次分发

- Machi 不托管、不缓存、不代理任何第三方 skill 包本体。
- 所有下载均由 agent 直接从官方 URL 拉取。
- UI 明确标注「由 {provider} 提供」。

### NFR-2: 可扩展

- 推荐注册表为 TS 常量数组，后续可改为从远程配置拉取。
- SkillHub 搜索接口抽象为独立模块，便于未来接入更多市场源。

## 验收标准

- AC-1: 技能 Tab 区块顺序自上而下为：扫描路径 → 本地列表 → **推荐** → **ClawHub 市场** → **SkillHub 市场** → 已安装扩展包
- AC-2: 推荐区展示 ≥3 个官方技能卡片，点击「安装」能创建新 session 并自动发送安装指令
- AC-3: 推荐区点击「官网 ↗」能正常打开对应 URL
- AC-4: 原「浏览市场」标题已改为「ClawHub 市场」，功能不受影响
- AC-5: SkillHub 市场搜索能返回结果，点击「安装」能创建新 session 并发送含 SkillHub CLI 安装指引的指令
- AC-6: 需要 API Key 的技能安装前有提示引导
- AC-7: 所有卡片标注提供方来源

## 实现步骤

### Phase 1: 推荐区 + ClawHub 改名（前端为主，无后端改动）

- **Step 1.1**: 在 `desktop/src/` 新建推荐注册表常量文件（如 `desktop/src/data/recommended-skills.ts`），定义 `RecommendedSkill` 类型和初始 3 条数据
- **Step 1.2**: 在 `SettingsPanel.tsx` 的 `SkillsTab` 中，在原「浏览市场」上方新增「推荐」section，渲染卡片网格
- **Step 1.3**: 实现「安装」按钮的跳转逻辑：创建新 session → 切换 pane → 填入 install_prompt 并发送。需要调用 store 的 session 创建和消息发送方法
- **Step 1.4**: 实现 `requires_api_key` 的弹窗提示 UX
- **Step 1.5**: 将原「浏览市场」标题文案改为「ClawHub 市场」

### Phase 2: SkillHub 市场搜索（需后端 + 前端）

- **Step 2.1**: 调研 SkillHub API（`skillhub.tencent.com`）是否有公开 REST 搜索接口。若有，记录 endpoint 和响应格式；若无，考虑走 `skillhub` CLI 的 `skillhub search` 命令代理
- **Step 2.2**: 后端 `agenticx/extensions/` 新建 `skillhub_adapter.py`，封装 SkillHub 搜索逻辑
- **Step 2.3**: `agenticx/studio/server.py` 新增 `GET /api/registry/skillhub/search` 端点
- **Step 2.4**: `desktop/electron/main.ts` + `preload.ts` 新增 `searchSkillHub` IPC handler
- **Step 2.5**: `SettingsPanel.tsx` 新增「SkillHub 市场」section，含搜索框和结果列表
- **Step 2.6**: 结果卡片的「安装」按钮复用 FR-4 流程（install_prompt 包含 SkillHub CLI 安装指引 + 目标技能名）

### Phase 3: 打磨

- **Step 3.1**: 卡片视觉优化（provider badge 颜色、hover 效果）
- **Step 3.2**: 推荐区响应式布局（窄屏单列、宽屏双列）
- **Step 3.3**: 推荐注册表可通过远程 JSON 更新（预留接口，不在本期实现）

## 技术要点

### 推荐注册表数据结构

```typescript
interface RecommendedSkill {
  id: string;
  name: string;
  provider: string;
  description: string;
  icon_emoji: string;
  official_url: string;
  install_prompt: string;
  requires_api_key: boolean;
  api_key_url?: string;
  category: string;
}
```

### 安装跳转实现要点

跳转到 Meta-Agent 新 session 的核心逻辑：

1. 调用 `POST /api/session` 创建新 session
2. 调用 store 的 `addPane` 或切换到 Meta-Agent pane
3. 调用 `POST /api/chat` 发送 `install_prompt` 作为用户消息
4. 前端自动开始 SSE 流监听

### SkillHub 搜索

已知信息：

- SkillHub CLI 安装：`curl -fsSL https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/install.sh | bash -s -- --cli-only`
- CLI 搜索：`skillhub search <query>`
- CLI 安装：`skillhub install <skill_name>`
- 页面 URL 模式：`https://skillhub.tencent.com/` → 搜索 → 详情页

后端搜索策略（按优先级）：

1. 若 SkillHub 有公开 REST API → 直接 HTTP 调用
2. 若无 API → 本机检测 `skillhub` CLI 是否已安装，已装则 `subprocess` 调 `skillhub search`
3. 兜底 → 提示用户先安装 SkillHub CLI

## 风险


| 风险                    | 应对                                                  |
| --------------------- | --------------------------------------------------- |
| SkillHub 无公开 REST API | 走 CLI 代理或只做 link 跳转到网站搜索                            |
| 官方技能安装指令版本硬编码         | install_prompt 中 URL 包含版本号的（如 ima 1.1.2），需提示用户确认最新版 |
| Meta-Agent 安装能力不足     | agent 需有 bash 执行权限（curl/unzip），安装前检查权限配置            |


## 不做的事

- **不**在 Machi 后端代理下载 skill 包
- **不**在推荐区做复杂的 CRUD（本期只读常量）
- **不**实现远程推荐列表拉取（预留接口即可）
- **不**修改现有 ClawHub 搜索/安装逻辑

