# Demo UI 前端栈：shadcn + Bits

AgenticX 定制项目里，凡是要做本地 Demo 门户、展示页、营销感落地页（常见路径 `apps/portal/`），默认用这一套。业务仓自建，判 `--kind style --where business`，不提上游 PR。

## 分工

| 层 | 用什么 | 负责什么 |
| --- | --- | --- |
| 常规界面 | shadcn/ui（React）/ shadcn-vue / shadcn-svelte | 按钮、表单、弹窗、表格、导航 |
| 视觉动效 | React Bits / Vue Bits / Svelte Bits | 极光背景、文字动画、鼠标特效、氛围背景 |
| 样式底座 | Tailwind CSS（与 shadcn init 一致） | 主题色、间距、暗色模式 |

同一页面可以同时用 shadcn 按钮和 Bits 背景；**不要**把 React / Vue / Svelte 三套框架组件混进同一个页面。哪个框架建项目，就只用该框架的 shadcn + Bits。

## 总原则

1. 先 `init` 对应框架的 shadcn，再往 `components.json` 加 Bits 注册表。
2. shadcn 支持多个 registry；CLI 按地址分别下载源码进业务仓，源码归你改。
3. Bits 组件名按官网变体写：React 常见 `ComponentName-TS-TW`（语言-样式），不要瞎猜小写串。
4. 装前看组件页列出的 peer（框架大版本、Tailwind、`ogl`、`gsap` 等）是否与当前 lockfile 冲突。
5. 免费库与 Pro 库分开：没有授权就不要装 Pro registry。
6. 仍可另装独立「设计类」兄弟技能做文案/布局建议；**不要**把第三方技能全文粘进本技能。本文件是本技能自带的默认前端栈。

## React 项目

```bash
npx shadcn@latest init
npx shadcn@latest add button
```

在 `components.json` 加入（与现有字段合并，不要整文件覆盖）：

```json
{
  "registries": {
    "@react-bits": "https://reactbits.dev/r/{name}.json"
  }
}
```

安装动效（名称以官网为准，示例）：

```bash
npx shadcn@latest add @react-bits/SplitText-TS-TW
```

也可直接用完整 URL：`npx shadcn@latest add https://reactbits.dev/r/SplitText-TS-TW`。文档：[reactbits.dev](https://reactbits.dev/get-started/installation)。

## Vue 项目

```bash
npx shadcn-vue@latest init
npx shadcn-vue@latest add button
```

Vue Bits 官网默认可用 jsrepo：

```bash
npx jsrepo add https://vue-bits.dev/r/Aurora.json
```

若希望统一走 shadcn-vue，在 `components.json` 合并：

```json
{
  "registries": {
    "@vue-bits": "https://vue-bits.dev/r/{name}.json"
  }
}
```

然后：

```bash
npx shadcn-vue@latest add @vue-bits/Aurora
```

或：`npx shadcn@latest add https://vue-bits.dev/r/Aurora.json`。文档：[vue-bits.dev](https://vue-bits.dev/)。

## Svelte 项目

同理：先 `shadcn-svelte` 搭基础 UI，再通过 Svelte Bits 的注册表或 jsrepo 安装动效。框架、CLI、Bits 三者保持同一生态，不要跨框架混装。

## 兼容性检查（装之前）

1. 打开组件页 / registry JSON，记下 `dependencies` 与 peer。
2. 对照业务仓 `package.json` / lockfile：React/Vue/Svelte 大版本、Tailwind 大版本是否一致。
3. WebGL 类（如 Aurora）常依赖 `ogl`，父容器要有明确高度，否则画布高度为 0。
4. 动画类常依赖 `gsap`；注意 `prefers-reduced-motion`，可关速度或换静态帧。
5. 冲突时：优先升/降 Bits 组件依赖到与项目一致的版本；仍冲突就换同类组件或改用纯 CSS，不要硬并两套 Tailwind 主配置。

## 和 AgenticX 分层的关系

- `services/api/` + `apps/portal/`：门户可以是 Vite + React/Vue/Svelte；API 仍可用 FastAPI。
- 极简单页（无构建）继续可用；一旦要「好看、可维护」，升级到本栈，而不是在 HTML 里堆内联样式。
- 换皮、换组件、改主题：一律业务仓，`classify --kind style --where business`。
