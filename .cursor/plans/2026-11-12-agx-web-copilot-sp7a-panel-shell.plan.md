# SP7a · Copilot 面板壳 + 桌面端 mock 回复（纯前端 + 协议）

归属：feat/agx-browser-extension · Master Plan `.cursor/plans/2026-11-12-agx-web-copilot.plan.md` 第 3 节
依赖：SP1（NM 通道）、SP2（act 协议形态）；与 SP7b/SP7c 串行
闭环定义：点工具栏图标 → 右侧面板打开 → 输入文字 → 经 NM 收到（mock）回复并显示

## 0. 防扩散边界

- **不做流式、不做 markdown 渲染、不做划词菜单联动**（分别在 v2 / SP7c / SP7c）
- **不动 desktop/ 目录任何文件**（真实回复是 SP7b；本计划的"回复"来自 e2e 的 mock bridge）
- 不加任何 host 权限；manifest 仅新增 `sidePanel` permission + `side_panel` 字段
- 现有「划词发给 AGX / 整页发给 AGX」菜单与 inject.js 一行不改

## 1. 协议契约（SP7a/b/c 共同遵守，改这里必须同步三个 plan）

```
扩展 → 桌面端（经 NM）：
  {type:"copilot_chat", request_id, session_id?, text,
   source_url?, source_title?, kind?}        // kind: "selection"|"page"|undefined(手输)

桌面端 → 扩展（经 NM）：
  {type:"copilot_reply", request_id, session_id, ok, text?, error?}
  // error 复用 SP5 家族：nm_disconnected / studio_unreachable /
  //   session_not_found / no_active_session / empty_text / reply_timeout
```

## 2. 任务

### 2.1 manifest（extension/manifest.json）
- `permissions` 追加 `"sidePanel"`；新增 `"side_panel": {"default_path": "panel.html"}`
- 权限姿势不回退：仍无常驻 host grant（T7 守护沿用）

### 2.2 面板（extension/panel.html + src/panel.js，样式内联或 panel.css）
- 极简聊天壳：消息列表（user/assistant 两态）+ 输入框 + 发送按钮
- 顶部显示当前绑定会话名（读 storage `agx_active_session`，SP5 已有）
- 发送：`chrome.runtime.sendMessage({cmd:"agx_copilot_send", text, source?})` → SW
- 回复：监听 `chrome.runtime.onMessage`（SW 广播 `agx_copilot_reply`）
- 状态机：idle → busy（禁用输入）→ idle/error（红字显示 error 文案，复用 SP5 文案映射风格）
- NM 掉线（SW 侧 nm_disconnected）→ 面板显示「AGX 未运行」，输入保留不丢
- 纯文本渲染（textContent），**禁止 innerHTML**（markdown/HTML 是 SP7c）

### 2.3 SW 路由（extension/src/sw.js）
- `chrome.runtime.onMessage` 新分支 `agx_copilot_send`：组装协议 payload
  （request_id = crypto.randomUUID()，session_id 取 `agx_active_session`），
  经 `agxNmSendCopilot` 发送（port 掉线 → 直接回 nm_disconnected，模式对齐 agxNmSendInject）
- `onNativeMessage` 新分支 `copilot_reply`：`chrome.runtime.sendMessage` 广播给面板
- SW 回收期间面板自持：面板 busy 状态存 `chrome.storage.session`，重连后 SW 主动
  广播一次当前 NM 状态（复用 SP1 心跳）

### 2.4 e2e（scripts/e2e/verify-copilot-panel.mjs，新）
- 复用 verify-page-inject.mjs harness 模式：自动化 manifest 拷贝 + host_permissions 补丁、
  mock bridge（见到 `copilot_chat` → 回固定文案 `mock_copilot_ack`）、CDP 驱动
- 判据：
  - P1 打开 `chrome-extension://…/panel.html` 为普通标签页 → 输入 → mock 回复渲染
  - P2 busy 态输入禁用；回复后恢复
  - P3 mock bridge 不在线 → 「AGX 未运行」error 态，不静默
  - P4 manifest 姿势：无常驻 host grant、`sidePanel` permission 存在、`side_panel.default_path` 正确
  - P5 现有两项划词菜单回归不受影响（复用 inject 注册探针）

## 3. 验收判据

1. `node scripts/e2e/verify-copilot-panel.mjs` 全 PASS（P1–P5）
2. `node scripts/e2e/verify-page-inject.mjs` 与 `verify-user-journey.mjs` 复跑仍全 PASS（零回归）
3. 真机手测（用户侧）：load unpacked → 点工具栏图标 → 面板开 → 输入 → busy → mock 文案显示

## 4. Sub agent 执行提示

- 先读：`extension/src/sw.js`（agxNmSendInject / onNativeMessage / active_session 分支）、
  `extension/src/inject.js`（协议与文案风格）、`scripts/e2e/verify-page-inject.mjs`（harness 全套照抄）
- panel 里的所有用户可见文案用中文，与 options 页风格一致
- 禁止顺手实现流式/markdown/菜单联动；发现协议要改 → 先改三个 SP7 plan 再写码

## 5. 执行结果

（待执行后填写）
