# 桌面端开发者工具入口

Planned-with: glm-5.2

Suggested-Impl-Model: Codex 中档代码模型

## 背景与根因

桌面端 macOS 应用菜单由 `desktop/electron/main.ts` 中的 `buildMenuTemplate()` 构造。当前模板只包含应用、`Edit` 与 `Window` 三个菜单；没有 `View` 菜单，也没有 `toggleDevTools` role 或调用 `mainWindow.webContents.openDevTools()` 的入口。因此 Electron 不会为主窗口注册常用的 DevTools 切换快捷键，`⌘⌥I` 无法打开主渲染器的 Chromium DevTools。仓库中现有的 `openDevTools()` 调用仅服务于 HTML 预览来宾窗口，不能用于检查主桌面窗口。

## 目标

在未打包的桌面端开发运行中，为主窗口提供一个可发现的菜单入口和 `⌘⌥I`（Windows/Linux 为 `Ctrl+Alt+I`）快捷键，能够切换主窗口 DevTools；打包版不暴露该调试入口。

## 范围

In scope:

- 修改 `desktop/electron/main.ts` 的 `buildMenuTemplate()`。
- 仅在 `app.isPackaged === false` 时向 macOS 菜单增加「开发」菜单，其子项使用 Electron 的 `toggleDevTools` role，并显式声明 `CommandOrControl+Alt+I` accelerator。
- 通过开发模式实际启动桌面端，验证菜单点击和快捷键均能打开、再次触发能关闭 DevTools。

Out of scope:

- 不修改预加载脚本、IPC 通道、渲染器 UI 或 HTML 预览 DevTools 行为。
- 不为生产/打包版提供隐藏快捷键或调试菜单。
- 不改变现有 `Edit`、`Window` 菜单和任何运行时业务逻辑。

## 实施步骤

### 1. 在开发构建下追加调试菜单

落点：`desktop/electron/main.ts`，函数 `buildMenuTemplate()`（当前约第 2389 行）。

将 macOS 分支当前直接返回的菜单数组改为局部 `template` 数组，然后在 `!app.isPackaged` 条件成立时，在 `Window` 菜单之前插入：

```ts
{
  label: "开发",
  submenu: [
    {
      label: "切换开发者工具",
      role: "toggleDevTools",
      accelerator: "CommandOrControl+Alt+I"
    }
  ]
}
```

再返回该 `template`。使用 role 而不是手写 `mainWindow?.webContents.openDevTools()`：role 会针对当前聚焦窗口执行标准的打开/关闭切换，并避免为窗口生命周期另建状态管理。

`!app.isPackaged` 是唯一门槛：本地 `npm run dev` 必须显示入口，经过 Electron 打包的发行构建必须不包含该菜单和快捷键。

### 2. 验证

1. 执行桌面端现有 TypeScript 检查或构建命令（以 `desktop/package.json` 中定义的 script 为准），确认 `MenuItemConstructorOptions` 类型接受新增 role 与 accelerator。
2. 用开发命令启动桌面端，打开 macOS 菜单栏的「开发 → 切换开发者工具」，确认主窗口出现 DevTools。
3. 关闭后按 `⌘⌥I`，确认同一主窗口的 DevTools 再次打开；再次按快捷键确认其关闭。
4. 对打包标志做最小验证：在 `app.isPackaged` 为真时，`buildMenuTemplate()` 不生成标签为「开发」的顶级菜单。若现有测试架构无法隔离 Electron `app`，在实现提交中记录为人工发行前检查，不为了该单一分支引入测试框架或重构主进程。

## 验收标准

- FR-1：macOS 开发运行的顶部菜单出现「开发」，且包含「切换开发者工具」。
- FR-2：点击该项可打开/关闭主窗口 DevTools。
- FR-3：`⌘⌥I` 在开发运行中可执行同样的打开/关闭切换。
- FR-4：打包版不显示「开发」菜单，也不注册该新增快捷键。
- NFR-1：不新增 IPC、配置持久化或生产环境调试暴露。

## 推荐实施模型

| 子任务 | 建议模型 | 原因 |
| --- | --- | --- |
| 菜单模板接线与本地验证 | Codex 中档代码模型 | 单文件、Electron API 明确，但需要严格保证仅开发构建暴露入口。 |
