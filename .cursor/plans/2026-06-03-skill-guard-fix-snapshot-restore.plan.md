# 技能 AI 修复前快照与一键恢复

Plan-Id: 2026-06-03-skill-guard-fix-snapshot-restore
Plan-File: .cursor/plans/2026-06-03-skill-guard-fix-snapshot-restore.plan.md

## 背景与问题

P0/P1 实现了「一键扫描已安装技能 + 处置选项（AI 修复 / 禁用 / 忽略）」，但
**AI 修复若改坏 SKILL.md，目前没有任何回滚入口**。

现有的 `.changelog` 只保存变更摘要（时间/作者/策略），**不保存文件快照**。
`skill_manage patch` 在内存保留 backup，但一旦写入成功就释放了。

用户的期待：修复不满意时，在设置页扫描结果卡片上点「恢复」即可回到修复前状态。

## 设计

### 快照策略

- **时机**：用户在设置页点「AI 修复」按钮、前端发起 `runGuardFixInMetaAgent` 之前，
  先调用后端快照接口。不在 `skill_manage` 内部自动打，因为一次 AI 修复可能多次 patch，
  我们只需要**「修复前的整体状态」**作为恢复基准，不是每次 patch 一个快照。
- **范围**：只快照技能目录下的**文本文件**（SKILL.md、`*.py`、`*.sh`、`*.js`、`*.ts`、
  `*.json`、`*.yaml`、`*.yml`、`*.md`），跳过二进制与过大文件（>256 KB）。
- **格式**：`<skill_dir>/.snapshots/<YYYYMMDD_HHMMSS_UTC>/` 目录，内含各文件原样拷贝，
  并写 `meta.json`（skill_name、trigger、timestamp）。
- **保留策略**：每个技能最多保留最新 5 份快照（create 第 6 份时删最旧的）。
- **查询**：列出可用快照（按时间倒序），前端可展示快照时间与数量。
- **恢复**：用指定快照目录内的文件**覆写**技能目录（仅覆盖快照包含的文件，不删除
  快照里没有的新文件——避免意外删去用户后来手动加的文件；可选强制全量覆写）。

### 后端

| 接口 | 方法 | 说明 |
|------|------|------|
| `POST /api/skills/snapshot` | 创建快照 | body: `{base_dir, trigger?}` → `{ok, snapshot_id, timestamp}` |
| `GET /api/skills/snapshots` | 列出快照 | query: `?base_dir=<path>` → `{ok, snapshots: [{id, ts, files_count}]}` |
| `POST /api/skills/snapshot/restore` | 恢复 | body: `{base_dir, snapshot_id}` → `{ok, restored_files}` |

### Electron IPC

| IPC channel | 说明 |
|-------------|------|
| `skill-snapshot` | 调用 POST /api/skills/snapshot |
| `skill-snapshots-list` | 调用 GET /api/skills/snapshots |
| `skill-snapshot-restore` | 调用 POST /api/skills/snapshot/restore |

### 前端（SettingsPanel.tsx）

#### useGuardSettings 变更

- 新增 `snapshotMap: Record<string, string>`（skill_name → latest snapshot_id，UI
  用于判断「有备份」）。
- `runGuardFixInMetaAgent` 执行前先调 `skillSnapshot`，成功后再跳到元智能体窗格；
  失败时弹提示但不阻断修复流程（快照是尽力服务）。
- 新增 `restoreSnapshot(skillName, snapshotId)` → 调 `skillSnapshotRestore`，
  成功后重新 `runScanAll` 刷新卡片。

#### GuardScanResultCard 变更

- 接收 `hasSnapshot?: boolean` 与 `onRestore?: () => void`。
- 「AI 修复」按钮行右侧加「恢复备份」按钮（仅当 `hasSnapshot && can_fix` 时显示，
  颜色用 amber/warning，tooltip 说明「恢复到本次 AI 修复前的快照」）。
- 恢复成功后 toast 提示「已恢复到修复前备份」，并自动刷新扫描结果（若恢复后安全
  问题重现，卡片重新展示；说明 AI 修复确实没改到正确内容）。

### 模块位置

- `agenticx/skills/snapshot.py`：新增，含 `create_snapshot` / `list_snapshots` /
  `restore_snapshot`。
- `agenticx/studio/server.py`：三条新路由（`/api/skills/snapshot*`）。
- `desktop/electron/main.ts`：三个新 IPC handler。
- `desktop/electron/preload.ts`：暴露到渲染进程。
- `desktop/src/global.d.ts`：类型声明。
- `desktop/src/components/SettingsPanel.tsx`：hook + 卡片 UI。

## 需求

### FR（功能需求）

- FR-1: `create_snapshot(skill_dir, trigger)` 把技能目录文本文件打快照到
  `<skill_dir>/.snapshots/<ts>/`，并保留至多 5 份，超出则删最旧。
- FR-2: `list_snapshots(skill_dir)` 返回时间倒序快照列表（id, ts, files_count）。
- FR-3: `restore_snapshot(skill_dir, snapshot_id)` 用快照文件覆写技能目录，
  追加 `.changelog` restore 记录，返回恢复的文件列表。
- FR-4: 三条 Studio REST 接口（POST snapshot / GET snapshots / POST restore）。
- FR-5: 三个 Electron IPC channel 接通上述接口。
- FR-6: 「AI 修复」前自动触发 snapshot，失败时不阻断但记警告。
- FR-7: GuardScanResultCard 展示「恢复备份」按钮（有快照时），点击后恢复并刷新卡片。
- FR-8: 恢复后通过 toast 或卡片内消息告知用户「已恢复到 <时间> 的备份」。

### NFR（非功能需求）

- NFR-1: 快照目录（`.snapshots/`）被 guard 扫描时自动跳过，不影响安全评分。
- NFR-2: 快照只含文本文件，不收录 `.snapshots/` 自身（防嵌套）。
- NFR-3: 保留策略在 `create_snapshot` 内原子执行（先写新再删旧，不留孤档）。
- NFR-4: 恢复操作不删除快照里没有的文件（增量覆写，安全）。
- NFR-5: 不影响现有 `.changelog`、`skill_manage`、guard 扫描链路。

### AC（验收标准）

- AC-1: 点「AI 修复」后 `~/.agenticx/skills/registry/ima-skill/.snapshots/` 下
  出现新目录，包含修复前的 `SKILL.md`。
- AC-2: 点「恢复备份」后技能目录内文件恢复到快照状态，`.changelog` 追加 restore 记录。
- AC-3: 恢复后重新扫描，若原安全问题未被修复则卡片重新展示。
- AC-4: 快照超过 5 份时最旧的被自动删除。
- AC-5: `.snapshots/` 目录不进入 guard 扫描路径，不影响评分。

## 阶段拆分

| 步骤 | 内容 |
|------|------|
| Step 1 | `agenticx/skills/snapshot.py` + guard 过滤 `.snapshots/` |
| Step 2 | Studio 路由三条 |
| Step 3 | Electron IPC + preload + global.d |
| Step 4 | SettingsPanel hook + 卡片 UI（自动快照 + 恢复按钮） |

## 涉及文件

- `agenticx/skills/snapshot.py`（新建）
- `agenticx/skills/guard_engine.py`（过滤 `.snapshots/`）
- `agenticx/studio/server.py`（三条路由）
- `desktop/electron/main.ts`
- `desktop/electron/preload.ts`
- `desktop/src/global.d.ts`
- `desktop/src/components/SettingsPanel.tsx`
