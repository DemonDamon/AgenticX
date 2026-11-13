# SP7c · 划词联动侧边栏 + 回复渲染打磨

归属：feat/agx-browser-extension · Master Plan `.cursor/plans/2026-11-12-agx-web-copilot.plan.md` 第 3 节
依赖：SP7a（面板）、SP7b（真实回复）；串行收尾
闭环定义：页面划词 → 右键「划词问 AGX」→ 侧边栏自动打开，选中文本已发出，回答就地显示

## 0. 防扩散边界

- **不做流式、不做多会话切换 UI、不做历史列表**
- 只加**一个**新菜单项「划词问 AGX（侧边栏）」；既有两项菜单行为一行不改
- 不加新权限：sidePanel 已有；划词采集沿用 activeTab（SP5 修复后的语义与测试缝）

## 1. 任务

### 1.1 菜单与手势（extension/src/inject.js 或新 src/copilot-menu.js）
- 新菜单 id `agx-copilot-selection`（contexts: selection），注册进现有 removeAll→create 流程
- 点击流：activeTab 采集 selection（复用 `agxPageSelectionCollector`）→ 组装
  `{type:"copilot_chat", ..., kind:"selection", source_url, source_title}` → 走 SP7a 的
  SW 发送路径 → **`chrome.sidePanel.open({tabId})`**
- **已知风险（SP5 教训）**：MV3 contextMenus.onClicked 常拿不到 user gesture，
  `sidePanel.open` 可能抛错。处理姿势照抄 SP5 修复：
  try/catch —— open 失败 → 消息照发 + notifications toast
  「已发送，点工具栏图标查看回答」（**绝不静默**）；open 成功 → 面板自动加载
  pending 消息状态（chrome.storage.session 里的 busy 记录，SP7a 已建）
- 敏感域名拦截照常生效（SP4 层在采集前 gate，与既有菜单同一 gate 函数）

### 1.2 面板打磨（extension/panel.html + src/panel.js）
- markdown-lite 渲染：**先 escape 全部 HTML，再**支持加粗/行内代码/代码块/链接/换行
  （手写渲染器，禁止引入 markdown 库、禁止任何 raw innerHTML）
- 回复 markdown 渲染；错误态/超时态文案对齐 SP7b 的 error 家族
- 会话名 + 来源标注条（本条消息来自哪个页面，可点击跳转）
- 划词预填态：面板打开即显示 pending 的选中文本摘要（首行 + 200 字符截断）

### 1.3 e2e（scripts/e2e/verify-copilot-panel.mjs 扩展，或新 verify-copilot-selection.mjs）
- 判据：
  - S1 新菜单注册成功且旧菜单不受影响（注册探针模式）
  - S2 合成菜单点击（复用 SP5 的 e2e 菜单触发模式）→ copilot_chat 发出且带 kind/source
  - S3 mock sidePanel.open 抛错（测试缝）→ fallback toast 路径，无静默
  - S4 markdown-lite：加粗/代码块/链接渲染正确 + `<script>` 注入被 escape（安全断言）
  - S5 敏感域名页划词 → 拦截，不发送
  - S6 manifest 姿势回归（T7 风格守护）

## 3. 验收判据

1. verify 脚本全 PASS（含 S1–S6）；verify-page-inject / verify-user-journey 复跑零回归
2. 真机手测：普通页划词 → 面板自动开 + 回答显示；银行类页面划词 → 拦截提示；
   菜单手势被 Chrome 吞掉的场景 → toast fallback

## 4. Sub agent 执行提示

- 先读：`extension/src/inject.js`（activeTab 修复的 try/catch 姿势与测试缝——照抄语义）、
  SP7a 的 panel.js、SP5 的 e2e 菜单触发模式
- 渲染器安全标准：任何路径下用户/agent 文本不得以非 escape 形态进 DOM
- 禁止顺手做流式/多轮切换/历史

## 5. 执行结果

已完成（sub agent，2026-11-12）。交付：inject.js 第三菜单 agx-copilot-selection（采集前敏感域名 gate 复用 SP4 verdict → activeTab 采集 → copilot_chat → agxSidePanelOpenFn 测试缝包 sidePanel.open，抛错→消息照发+toast，绝不静默；终态记 agx_copilot_selection_last_result）；copilot.js setPanelBehavior(openPanelOnActionClick)（manifest 移除 default_popup）；panel.js markdown-lite 渲染器（先全量 escape 再合成，占位符防串扰）+ 划词预填态 + 来源标注条 + 客户端 30s reply_timeout；scripts/e2e/verify-copilot-selection.mjs。
验证：verify-copilot-selection 33/33（连跑两次稳定）；verify-copilot-panel 23/23、verify-page-inject 26/26、verify-user-journey 35/35 零回归；主 agent 独立复跑四套件全 PASS。
偏离：① 敏感域名 gate 前置在 copilot 点击流（既有两菜单本就无此 gate，零改动）；② 补 agx_copilot_pending 广播（面板已开时划词的预填路径，防静默）。
遗留：超长划词未截断（契约无字段，选区由用户手势限定）；真机 sidePanel.open 手势手测待主 agent 安排。
