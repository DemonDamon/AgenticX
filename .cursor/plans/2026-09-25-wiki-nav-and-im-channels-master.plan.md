# Wiki 导航与 IM 渠道

Planned-with: grok-4.7

把 Wiki 从知识库详情标签提升为设置左侧导航的独立项，并按顺序补齐钉钉真实回复、Slack 与 Telegram 适配器、QQ 官方机器人适配器。四段互不改同一批 UI 锚点，必须按编号执行。

## 顺序

| 顺序 | 子计划 | Suggested-Impl-Model | 理由 |
|---|---|---|---|
| 1 | [2026-09-25-wiki-settings-nav.plan.md](2026-09-25-wiki-settings-nav.plan.md) | composer-2.5 | 只搬现有 Wiki 面板，不改编译器 |
| 2 | [2026-09-25-dingtalk-session-reply.plan.md](2026-09-25-dingtalk-session-reply.plan.md) | composer-2.5 | 已有 webhook，补回复与设置项 |
| 3 | [2026-09-25-slack-telegram-adapters.plan.md](2026-09-25-slack-telegram-adapters.plan.md) | composer-2.5 | 两个标准 Bot webhook，结构相同 |
| 4 | [2026-09-25-qq-bot-adapter.plan.md](2026-09-25-qq-bot-adapter.plan.md) | composer-2.5 | 新适配器，但接口与前两段相同；不得复用个人微信 sidecar |

后一段开始前，前一段的测试必须通过。不要并行改 `agenticx/gateway/app.py` 或 `desktop/src/components/SettingsPanel.tsx`。

## 不做

- 不把 Wiki 放进左侧会话列表（分身、群聊、元智能体那一栏）。
- 不新建飞书式长连接子进程。
- 不改个人微信 iLink sidecar。
- 不实现 Wiki 页面版本对比、引用撤回或自动编译策略。
- 不在设置里增加企业微信以外的新「远程连接」产品线；新渠道配置放在现有「远程连接」页。
