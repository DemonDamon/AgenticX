# sandbox: 伪产物链接治理：渲染层可点开 + 提示词源头禁令

Planned-with: kimi-k3
Suggested-Impl-Model: composer-2.5-fast（前端小组件 + 工具函数 + 一行提示词，样板级改动）
Status: implementing
Plan-Id: 2026-08-11-sandbox-artifact-link-rescue

## 背景与根因（证据链）

用户在 Near 对话里让模型复刻网页小游戏，助手产出内容里带 `[skill26_game_studio.html](sandbox:/Users/damon/.claude/skills/yy-compact-creator-gameskill26-creator/outputs/skill26_game_studio.html)` 链接，点击无反应。

1. **桌面端无 `sandbox:` 处理器**：`desktop/src/components/messages/markdown-components.tsx:558` 的 `a` 渲染器只对 `http(s)` 做 `openExternalUrl` 接管；其余 scheme 保留原 href 走 Electron 默认行为，`sandbox:/...` 静默失败。全仓库 grep 无任何 `sandbox:` 处理代码。`sandbox:` 是 Claude 系产物沙箱约定，属模型幻觉式输出。
2. **目标文件在本机不存在**：`~/.claude/skills/` 无该目录（目录名疑似两个 skill 名拼接），全盘 + Spotlight 找不到 `skill26_game_studio.html`。链接是模型编的，文件从未落盘——需要让用户能一眼分辨「伪链接」。
3. **现有可复用件**：`shell-open-path` IPC（`desktop/electron/main.ts:9902`，`shell.openPath` 对不存在路径返回 error 字符串，天然可当存在性校验）；preload 已暴露 `window.agenticxDesktop.shellOpenPath`；`file://` 链接在同一 `a` 渲染器里同样是死链（顺手同路径修复）。

## 目标

- FR-1（渲染层）：聊天 markdown 链接中的 `sandbox:/abs/path`（兼 `file:///abs/path`）渲染为可点的本地文件链接：点击 → `shellOpenPath` 打开；失败（文件不存在/无 IPC）→ 链接旁即时出现「文件不存在（疑似模型伪链接）」警示，数秒后自动恢复。
- FR-2（源头）：meta 系统提示加入硬规则——产出文件必须 `file_write` 真实落盘会话工作区，正文只引用真实存在的绝对路径，禁止输出 `sandbox:` 协议链接。
- FR-3（测试）：解析工具 vitest 用例全绿；既有前端/后端测试不回归。

## 非目标（Out of scope）

- 不做裸文本绝对路径的自动链接化（仅处理 markdown 链接 `[...](sandbox:/...)` / `file://`）。
- 不改 Electron 默认导航策略，不注册系统级 `sandbox://` 协议。
- 不改 avatar/群聊专属提示段落（规则加在 meta 提示公共纪律区，avatar 共用同文件构建链路）。
- 不处理「文件从未落盘」的运行时强制校验（如要求 file_write 真实命中才允许引用——属更大范围，后续按需）。

## 实施步骤

### FR-1 落点 1：新增 `desktop/src/utils/sandbox-artifact-link.ts`

```ts
/** Parse sandbox:/abs or file:///abs links into a plain absolute filesystem path. */
export function parseLocalArtifactPath(url: string): string | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  let p = "";
  if (raw.startsWith("sandbox:")) {
    p = raw.slice("sandbox:".length);
    if (p.startsWith("//")) p = p.replace(/^\/+/, "/");
  } else if (/^file:\/\//i.test(raw)) {
    p = raw.replace(/^file:\/\//i, "");
    if (/^\/[a-zA-Z]:\//.test(p)) p = p.slice(1); // file:///C:/... → C:/...
  } else {
    return null;
  }
  try { p = decodeURIComponent(p); } catch { /* keep raw on malformed escapes */ }
  p = p.trim();
  if (!p) return null;
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)) return p;
  return null;
}
```

### FR-1 落点 2：新增 `desktop/src/components/messages/ArtifactFileLink.tsx`

受控组件：props `{ path: string; children: ReactNode }`；本地 state `"idle" | "opening" | "failed"`；`onClick` preventDefault → `setState("opening")` → `await window.agenticxDesktop.shellOpenPath(path)`：`ok` 回 idle；否则置 failed 并用 `window.setTimeout` 4s 后回 idle（组件卸载清 timer）。failed 态在链接后追加 `⚠ 文件不存在（疑似伪链接）`（`text-amber-300`），`title` 提示完整路径与原因；opening 态禁重复点击。无 `shellOpenPath` API（纯 web 预览）时按 failed 处理。

样式与既有聊天链接一致（继承 `.msg-content a` 样式，不另起视觉）。

### FR-1 落点 3：接入 `markdown-components.tsx` 的 `a` 渲染器（558 行起）

```tsx
a({ href, children, ...rest }) {
  const url = String(href ?? "").trim();
  const external = /^https?:\/\//i.test(url);
  const localArtifactPath = external ? null : parseLocalArtifactPath(url);
  if (localArtifactPath) {
    return <ArtifactFileLink path={localArtifactPath}>{children}</ArtifactFileLink>;
  }
  return ( ...既有 <a> 逻辑不变... );
},
```

注意：`chatMarkdownComponents` 被消息区与（635-639 行）其它组件复用，接入点改动一处即全链路生效；`settingsMarkdownComponents` 不受影响。

### FR-2：`agenticx/runtime/prompts/meta_agent.py`

在 950 行（`- 若涉及文件产出，必须要求子智能体给出可验证路径与工具成功证据；不要接受"口头已生成"。`）之后追加一条：

```python
        "- 产出文件的正文引用纪律：文件必须先通过 `file_write` 真实落盘到会话工作区，正文与链接中只允许引用真实存在的绝对路径；"
        "**禁止输出 `sandbox:` 协议链接**（Desktop 无法打开，属伪造产物链接）。\n"
```

### FR-3：测试 `desktop/src/utils/sandbox-artifact-link.test.ts`

1. `sandbox:/Users/damon/a b.html` → `/Users/damon/a b.html`；`sandbox://Users/x.html` 双斜杠归一；`sandbox:/Users/a%20b.html` → 解码空格。
2. `file:///Users/damon/a.html` → `/Users/damon/a.html`；`file:///C:/Users/a.html` → `C:/Users/a.html`。
3. 拒绝项返回 null：`https://x.com/a`、`sandbox:`（空）、`sandbox:relative/x`、`""`、`sandbox:/` 纯根之外的非法形态按实现核对（根路径 `/` 允许返回）。
4. 畸形百分号（`sandbox:/a%zz`）不抛异常、返回原样路径。

回归：`npx vitest run src/utils`（desktop）全绿；`npx tsc --noEmit` 相对当前工作区基线（85 个既有错误）零新增；`python -m py_compile agenticx/runtime/prompts/meta_agent.py`。

## Requirements

- FR-1: sandbox:/file:// 链接可点击打开本地文件；失败给出 4 秒「文件不存在（疑似伪链接）」警示并自动恢复。
- FR-2: meta 提示含 sandbox: 禁令与真实落盘要求。
- FR-3: 解析测试 ≥6 条全绿；基线不回归。
- NFR-1: 无新依赖；不动 Electron 主进程（复用既有 `shell-open-path` IPC，零 main.ts 改动）。
- NFR-2: 不改 `studio/server.py`；不动 `settingsMarkdownComponents`。
- AC-1: 手工验证：把 `[x](sandbox:/tmp/real.html)` 发给聊天渲染，文件存在时系统默认方式打开；`sandbox:/tmp/nope.html` 点击出现警示。
