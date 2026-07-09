# Workspace HTML 渲染预览

Planned-with: Cursor Grok 4.5
Suggested-Impl-Model: Composer 2.5

## 问题

工作区预览 `.html` 时，后端 `classify_taskspace_file` 将其标为 `preview_kind=code`，前端 `WorkspaceFilePreview` 仅做 Prism 源码高亮，用户看到的是 HTML 源码而非渲染页面（如调研报告 `harness-multi-agent-report.html`）。

## 方案

**不改后端 kind**（仍为 `code`，内容已可读）。前端对 `.html`/`.htm`：

1. 默认用沙箱 `iframe` + `srcDoc` 渲染页面
2. 顶栏提供「渲染 / 源码」切换（对齐 Markdown 的 Eye/Pencil）
3. `sandbox` 允许 scripts/forms，**不含** `allow-same-origin`，避免逃逸到父页面
4. 相对路径资源不解析到文件目录（自包含 HTML 最佳）；后续若需要再加 `base`/`file` 协议增强

## In scope

- `desktop/src/components/workspace/HtmlPreviewBody.tsx`（新建）
- `desktop/src/components/workspace/WorkspaceFilePreview.tsx`（检测 html、默认渲染、切换源码、Prism markup）

## Out of scope

- 后端新增 `preview_kind=html`
- 相对资源 / 外链完整离线打包
- 编辑并保存 HTML（仅预览切换）

## AC

- 打开 `.html` 默认看到渲染页面，而非源码
- 可切换到源码高亮视图再切回渲染
- 页面内脚本不污染 Desktop 主窗口
