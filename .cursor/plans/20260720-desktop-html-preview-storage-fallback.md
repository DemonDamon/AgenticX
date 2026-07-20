# Desktop HTML 预览 sandbox 存储兜底

Planned-with: gpt5.6luna
Suggested-Impl-Model: gpt5.6luna

## 背景与根因证据

本次问题表现为：本地 HTML 文件直接用系统浏览器打开时内容正常，但 Near Desktop 的工作台 HTML 预览中，依赖脚本动态生成的内容为空。

已核对的证据链：

1. `/Users/dubianche/.agenticx/avatars/8451f5797d32/workspace/断舍离待办清单.html` 的 `#todoList` 初始为空，15 条待办仅存在于脚本变量 `todos`，必须由 `loadTodos()` 调用 `renderTodos()` 后才会显示。
2. 该 HTML 在 `loadTodos()` 的第一步直接执行 `localStorage.getItem('weekend-todos')`，没有异常兜底；如果读取失败，后续 `renderTodos()` 不会执行。
3. `desktop/src/components/workspace/HtmlPreviewBody.tsx` 的 iframe 使用 `sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox"`，刻意不授予 `allow-same-origin`。sandbox `srcDoc` 的 opaque origin 可能拒绝 `localStorage` / `sessionStorage` 访问。
4. 因此根因是“生成的 HTML 依赖浏览器存储”与“安全隔离的 srcDoc 预览环境”不兼容，而不是待办数据没有写入文件。

## 目标

在不放开 HTML 预览的 same-origin 隔离权限的前提下，让依赖 `localStorage` 或 `sessionStorage` 初始化的本地 HTML 至少能够正常渲染，并保持页面在预览 iframe 内的交互可用。

## In scope

- `desktop/src/components/workspace/HtmlPreviewBody.tsx`
  - 在 `srcDoc` 生成链路中，在 `injectHtmlInspectBridge()` 前调用存储兜底注入函数，保证存储兜底脚本先于 HTML 作者脚本执行。
- `desktop/src/utils/html-preview-storage.ts`
  - 新增预览专用注入函数。
  - 在 `localStorage` 或 `sessionStorage` getter / 方法不可用时，以 iframe 内存对象提供 `length`、`key`、`getItem`、`setItem`、`removeItem`、`clear` 六个基本 Storage 操作。
  - 内存存储仅属于当前预览 iframe，不承诺跨次打开或跨 iframe 持久化。
  - 预览仍不添加 `allow-same-origin`。
- `desktop/src/utils/html-preview-storage.test.ts`
  - 覆盖注入顺序、无 `<head>` 时的插入位置、幂等性。
- 本计划文件随实现一起提交。

## Out of scope / no-scope-creep

- 不修改用户生成的 `断舍离待办清单.html`。
- 不修改 Electron 主进程、不改变本地文件读写 API。
- 不给预览 iframe 添加 `allow-same-origin`。
- 不实现跨次预览的持久化存储同步。
- 不调整 HTML 预览设备栏、元素检查、图片预览或工作台布局。
- 不纳入已有的 `desktop/package-lock.json` 工作区改动。

## 精确实施意图

### FR-1：安全隔离下的 HTML 初始化不因 Storage 失败而中断

落点：`desktop/src/utils/html-preview-storage.ts` 的 `injectHtmlPreviewStorageBridge()`。

Before：`HtmlPreviewBody` 仅将作者 HTML 传给 `injectHtmlInspectBridge()`；作者脚本在 storage getter 抛错时直接中断。

After 伪代码：

```ts
const srcDoc = injectHtmlInspectBridge(
  injectHtmlPreviewStorageBridge(baseSrcDoc),
);
```

注入函数必须：

1. 优先插入 `<head>` 开标签之后，使其先于 head 内作者脚本运行。
2. 没有 `<head>` 时插入 `<body>` 开标签之前；再没有结构标签时插入文档开头。
3. 用固定 marker 保证重复调用不会重复插入。
4. 先探测原生 storage；只有 getter 或 `getItem` 抛错时才定义内存 fallback，不覆盖正常 origin 下可用的 native storage。

### FR-2：既有 HTML inspect bridge 行为不变

落点：`desktop/src/components/workspace/HtmlPreviewBody.tsx` `srcDoc` 的 `useMemo`。

存储脚本必须先于作者脚本，HTML inspect bridge 仍由既有 `injectHtmlInspectBridge()` 最后注入；不改变 postMessage 协议、元素选择和相对资源内联流程。

## 验收标准（AC）

- AC-1：`cd desktop && npm exec vitest run src/utils/html-preview-storage.test.ts src/components/workspace/HtmlPreviewBody.test.ts src/utils/html-preview-assets.test.ts src/utils/html-preview-inspect.test.ts` 全部通过。
- AC-2：新增测试断言 storage bridge 在 `<head>` 作者脚本之前、无 head 时在 body 内容脚本之前，并且重复注入结果不变。
- AC-3：`cd desktop && npm run build` 成功完成 Vite 构建和 Electron TypeScript 编译。
- AC-4：实现 diff 不包含 `allow-same-origin`，不包含生成 HTML 文件，不包含已有 `desktop/package-lock.json` 改动。
