# Desktop：自动化防休眠 + 技能安装扫描与策略

## What & Why

- Machi 设置中提供「自动化」防休眠（`automation.prevent_sleep` → Electron `powerSaveBlocker`），与「技能」中的安装策略、高级技能开关分层展示。
- 扩展包与市场技能安装前经 `agenticx.skills.guard` 扫描；`skills.non_high_risk_auto_install` 为真时非高危可自动继续，高危始终需用户确认。

## Requirements

- **FR-1**：`~/.agenticx/config.yaml` 读写 `automation.prevent_sleep`；应用运行期间按配置启用/关闭防休眠。
- **FR-2**：同配置文件读写 `skills.non_high_risk_auto_install`；与 Trinity 技能高级项同面板，开关为卡片式 Toggle。
- **FR-3**：Studio/API 与 Desktop IPC 支持安装预览（扫描摘要）与正式安装（`acknowledge_high_risk` / `confirm_non_high_risk` 等标志）。
- **FR-4**：`guard` 侧提供可序列化的扫描结果结构，installer/registry 安装路径统一走扫描与错误码。
- **AC-1**：技能 Tab 中本地包与市场安装先预览再安装；返回 `non_high_risk_confirm_required` / `high_risk_confirm_required` 时 UI 提供确认重试。
- **AC-2**：文案为 Machi 产品向说明，避免与其他产品话术逐句雷同。

## Implementation notes

- Python：`agenticx/skills/guard.py`，`extensions/installer.py`，`extensions/registry_hub.py`，`studio/server.py`（预览路由、安装参数）。
- Desktop：`electron/main.ts` / `preload.ts`，`global.d.ts`，`SettingsPanel.tsx`（自动化 Tab、技能高级 Toggle、安装流）。

## Conclusion

- 待本分支合并后：在真机验证配置持久化、防休眠随 Machi 启停、以及带 caution/dangerous 样本包的安装分流。
