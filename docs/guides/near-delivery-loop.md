# Near 交付 Loop 操作指南

## 概述

Near 桌面端 **交付任务** 面板把客户物料经五阶段流水线产出 POC/MVP 骨架：

1. 需求拆解 → 2. UI/UX 设计 → 3. 前端开发 → 4. 自动化测试 → 5. 审计验收

状态持久化在 delivery worktree 的 `plan.mdc`；任务索引在 `~/.agenticx/delivery/tasks.json`。

## 快速开始

1. 启动 Near（内嵌 `agx serve`）
2. 打开 **Meta 窗格** 工具栏 **交付任务** 按钮（Boxes 图标）
3. **新建任务**：填写项目名，可选粘贴需求文件绝对路径（如 `examples/agenticx-for-delivery/sample-rfp.md`）
4. 等待五阶段全部 `completed`

## 配置（`~/.agenticx/config.yaml`）

```yaml
delivery:
  enabled: true
  worktree_root: ~/.agenticx/deliveries
  figma_token: ""          # 或环境变量 FIGMA_API_KEY
  playwright_browsers: chromium
  max_stage_retries: 2
```

也可在 **设置 → 定时任务** 页顶 **交付 Loop** 卡片编辑并保存。

## Worktree 沙箱

每个任务创建 `delivery/<slug>` 分支，目录默认 `~/.agenticx/deliveries/<slug>/`：

- `plan.mdc` — 阶段状态
- `input/<task_id>/` — 复制的需求文件
- `output/<task_id>/` — 各阶段产物

**注意**：主仓库工作区须干净（无未提交改动），否则 worktree 创建会失败。

## 分身与 Skills

| 阶段 | 分身 | Skill |
|------|------|-------|
| 需求 | delivery-analyst | requirement-decompose |
| 设计 | delivery-designer | b2b-desktop-design-system |
| 开发 | delivery-frontend | scaffold-vite-react |
| 测试/审计 | delivery-qa | playwright-uitest |

Bundle 路径：`examples/agenticx-for-delivery/`。

## API

| 方法 | 路径 |
|------|------|
| GET | `/api/delivery/config` |
| PUT | `/api/delivery/config` |
| GET | `/api/delivery/tasks` |
| POST | `/api/delivery/tasks` |
| GET | `/api/delivery/tasks/{id}` |
| POST | `/api/delivery/tasks/{id}/resume` |
| POST | `/api/delivery/bootstrap` |

## 测试

```bash
AGX_DELIVERY_DRY_RUN=1 pytest tests/test_smoke_delivery_loop.py -q
```

## 已知限制

- 当前 MVP 默认以 **文件骨架 + plan.mdc 状态机** 跑通闭环；真实 LLM 委派各分身需在本机配置模型后扩展 orchestrator。
- Figma / Playwright MCP 依赖本机 `npx` 与网络；无 token 时设计阶段降级为本地 SVG。
- 阶段校验失败超过 `max_stage_retries` 后进入 `awaiting_user`，需在面板点 **继续执行**。
