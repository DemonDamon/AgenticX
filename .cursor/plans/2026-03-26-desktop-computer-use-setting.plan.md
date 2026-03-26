---
name: ""
overview: ""
todos: []
isProject: false
---

# Desktop 暴露 Computer Use 配置开关

## Goal

在 Machi 设置「工作区」页读写 `~/.agenticx/config.yaml` 中的 `computer_use.enabled`，替代纯手动编辑 YAML。

## Requirements

- FR-1: Electron 主进程支持加载/保存 `computer_use` 块中的 `enabled`，合并写入时保留该块其它键。
- FR-2: 预加载与 `global.d.ts` 暴露 `loadComputerUseConfig` / `saveComputerUseConfig`。
- FR-3: 设置面板「工作区」Tab 展示开关与简短说明（与技能 Tab 分离）。

## AC

- AC-1: 切换开关后 `config.yaml` 中 `computer_use.enabled` 与 UI 一致。
- AC-2: 保存时若已有 `computer_use` 其它字段，不被清空。
