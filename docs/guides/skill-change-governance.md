# Skill 受控变更与版本治理指南

本文档说明 Near 在修改 Skill 时的推荐流程与安全边界。

## 目标

- 降低误改风险（先预览再落盘）
- 提供版本可追溯与可回滚能力
- 保持安全策略不被绕过

## 推荐流程

1. 调用 `skill_manage`，`action=patch`，`mode=preview`。
2. 查看返回内容：
   - `diff`
   - `strategy`
   - `match_count`
   - `target_ranges`（多命中时）
   - `risk`（快速风险摘要）
3. 多命中时，指定 `target_index` 再次调用 `mode=apply`。
4. 若 preview 返回了 `patch_token`，在 apply 时带上该 token，防止预览后文件变化导致误写。
5. apply 成功后，使用 `action=history` 查看可回滚版本。

## 常用动作

- `action=patch` + `mode=preview`
  - 仅预览，不写入。
- `action=patch` + `mode=apply`
  - 正式写入，仍会经过 guard 与 discoverable 校验。
- `action=history`
  - 查看某个 skill 的版本快照历史。
- `action=rollback` + `to_version`
  - 回滚到指定版本（回滚本身也会走安全校验）。

## 错误码语义

- `ERROR[VALIDATION]`
  - 参数缺失、token 不匹配、目标索引非法、目标版本不存在等。
- `ERROR[POLICY]`
  - 命中安全策略，或检测到高风险模式（如远程下载并管道执行 shell）。

## 设计边界

- 不是开放式文本编辑器能力。
- 用户表达意图，Near 生成并执行受控变更提案。
- 任何落盘操作都必须经过 guard / discoverable / rollback 闭环，不允许通过通用文件写工具绕过。
