# 分身设置：背景色选择 + 默认对齐元智能体

Planned-with: Grok 4.5
Suggested-Impl-Model: Grok 4.5 / Composer 2.5

## Goal

在分身「设置 → 基本信息」增加**背景色**色板选择；缺省与**元智能体**一致（窗格无 tint、头像占位用主题色），不再按 id hash 随机上色。

## In scope

1. `AvatarConfig.color: str = ""` 持久化到 `avatar.yaml`（合法值为 `AVATAR_PALETTE` 之一；空 = 跟随元智能体）
2. Desktop 设置 UI 色点选择器；保存走现有 `updateAvatar`
3. `avatar-color.ts`：空 color → meta 行为；有 color → 对应 tint/bg
4. 列表映射 / ChatPane tint / gallery / 设置预览消费 `avatar.color`

## Out of scope

- 群聊色板、主题色设置本身、批量改 yaml 脚本（缺字段即视为空）
- 不改 `server.py` import 区无关行

## Acceptance

- AC-1: 打开分身设置基本信息可见「背景色」+ 默认 + 调色板
- AC-2: 未配置 color 的既有分身窗格背景与元智能体一致（无彩色 tint）
- AC-3: 选色并保存后，gallery 头像底色与该分身 ChatPane tint 同步
