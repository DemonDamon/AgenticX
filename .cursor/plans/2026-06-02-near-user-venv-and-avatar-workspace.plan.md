# Near 用户态 venv 缺包根治 + 新建分身可选 workspace

**Plan-Id**: 2026-06-02-near-user-venv-and-avatar-workspace
**Plan-File**: .cursor/plans/2026-06-02-near-user-venv-and-avatar-workspace.plan.md
**Status**: Implemented（Phase 1–4 已落地，待用户在 Near 上回归验收 AC-1/AC-3）
**Author**: Damon Li

---

## 1. 背景与问题（已核实，非臆测）

用户在 Near 上传 md 到知识库解析时报 `chromadb is required for the knowledge base`。
根因不是工作区配置错误，而是 **Near 启动的后端 Python 环境里没有装知识库依赖**。

已核实的事实：

| 事实 | 证据 |
|------|------|
| `chromadb` 报错来自 KB 向量后端初始化 | `agenticx/studio/kb/runtime.py:327` `_ensure()` `import chromadb` 失败 |
| `chromadb` 不在核心依赖，仅在 `desktop-runtime` extras | `pyproject.toml:86` `desktop-runtime`，核心 `dependencies` 无 chromadb |
| Near 开发模式优先用仓库 `.venv/bin/agx` | `desktop/electron/main.ts:1831` `repoAdjacentVenvBinDirs()`（cwd 与上级目录的 `.venv/venv`）|
| Near 后端两条路：内嵌 `agx-server`（打包）或 PATH 上的 `agx serve` | `main.ts:1965` `resolveBundledBackend()`、`2066` `findAgxBinaryOnPath` |
| `install.sh` / 文档只写 `pip install agenticx`（不含 desktop-runtime）| `install.sh:43`、`docs/getting-started/installation.md:11` |
| 分身 workspace 已隔离，但**创建时不可指定** | `agenticx/avatar/registry.py:145` 自动派生为 `~/.agenticx/avatars/<id>/workspace`，且 `workspace_dir` 在 `update_avatar` 的 `immutable` 集合 |

结论：缺包是**用户态后端运行时依赖问题**，与 `workspace_dir`（`~/.agenticx/workspace`）无关；venv 只隔离 Python 包，不是沙箱。

---

## 2. 目标（本批次，明确小步）

1. **缺包根治（用户态）**：让非开发用户不再手动 `pip install`——优先内嵌后端；无内嵌后端时，Near 维护并优先使用用户级 `~/.agenticx/.venv`，并在缺依赖时给出**一键修复**与**明确诊断**（用的是哪个 Python、缺哪些包）。
2. **新建分身可选 workspace**：创建数字分身时新增可选「落盘目录」，留空走默认 `~/.agenticx/avatars/<id>/workspace`。

**本 plan 明确不做（留作后续单独 plan）**：
- 不做「每个分身独立 venv / 复制元智能体 venv」——单进程模型下 venv 不生效，且 venv 复制脆弱（绝对路径 / 平台二进制），非沙箱正确原语。
- 不做容器 / 远程 microVM 执行后端（真沙箱）。这些归入未来「可插拔 ExecutionBackend」路线图。
- 不改 `agx serve` 单进程执行模型。

---

## 3. 需求块

### FR — 功能需求

**A 组：用户态 venv 缺包根治**
- **FR-A1** Near 后端解析顺序明确为：① 内嵌 `agx-server`（打包）→ ② 仓库相邻 `.venv`（开发，仅 `!app.isPackaged` 时）→ ③ 用户级 `~/.agenticx/.venv/bin/agx`（或 Windows `Scripts\agx.exe`）→ ④ PATH 上的 `agx`。
- **FR-A2** 新增 IPC「修复/初始化后端依赖」：在 `~/.agenticx/.venv` 创建虚拟环境并 `pip install "agenticx[desktop-runtime]"`，**带真实阶段/百分比**进度（不得只 spinner），失败透传 pip 错误尾部。
- **FR-A3** 后端启动前或 KB 失败时做依赖自检（复用 `agx --check-desktop-runtime`），缺包时 UI 给出：当前使用的 Python 可执行路径 + 缺失包列表 + 「一键修复」按钮（触发 FR-A2）。
- **FR-A4** `install.sh` 与安装文档默认改为安装含知识库依赖的 extras（如 `agenticx[desktop-runtime]` 或合适聚合 extras），消除「装了 agx 但 KB 必炸」的默认陷阱。

**B 组：新建分身可选 workspace**
- **FR-B1** `AvatarRegistry.create_avatar` 新增可选关键字参数 `workspace_dir`：非空则用用户指定（`expanduser` + 绝对化 + 创建目录），留空保持现有默认派生。
- **FR-B2** `POST /api/avatars` 透传 `payload["workspace_dir"]`（去空白；空则不传）。
- **FR-B3** `createAvatar` IPC / preload / `global.d.ts` 类型增加可选 `workspaceDir`。
- **FR-B4** `AvatarCreateDialog` 手动创建区新增可选「工作区目录」输入（占位说明：留空使用默认 `~/.agenticx/avatars/<id>/workspace`），`onCreate` 透传。
- **FR-B5** `workspace_dir` 仍保持创建后不可改（维持 `update_avatar` 的 `immutable` 语义不变）。

### NFR — 非功能需求
- **NFR-1** 开发模式行为不回退：有仓库 `.venv` 时仍优先用它（FR-A1 的 ② 在 ③ 之前），现有 `npm run dev` 流程 bit-compatible。
- **NFR-2** 不修改 `agx serve` 单进程模型与现有分身调度语义。
- **NFR-3** FR-A2 的安装是显式用户触发或首启引导，**不在每次启动静默联网安装**；离线 / 无 pip 时给出可读失败。
- **NFR-4** Windows 路径分支正确（`Scripts` vs `bin`，`agx.exe`）。
- **NFR-5** 留空 workspace 时分身创建与现状完全一致（无行为变化）。

### AC — 验收标准
- **AC-1** 干净用户态（无仓库、无 chromadb）下，点击「一键修复」后 `~/.agenticx/.venv` 具备 `chromadb`，重启 Near 后上传 md 到知识库成功，全程有进度反馈。
- **AC-2** KB 缺包失败时 UI 显示具体 Python 路径与缺失包名，而非裸 `chromadb is required` 单行。
- **AC-3** 新建分身填写自定义目录 → 分身 `workspace_dir` 落到该目录且目录被创建；留空 → 落默认派生目录。
- **AC-4** 开发模式（仓库有 `.venv`）下后端仍走仓库 `.venv`，无回退。
- **AC-5** 新增冒烟测试：`tests/test_smoke_avatar_workspace_*.py`（create_avatar 指定/留空两路）全绿；既有 avatar 测试不回归。

---

## 4. 分阶段实施

### Phase 0 — 对齐（已确认）
- [x] FR-A2 形态：**显式「一键修复」按钮**（用户点击才建 venv + 装依赖，不静默自动安装）。
- [x] 实施节奏：一次性推进 Phase 1–4。
- [x] FR-A4 extras：沿用现有 `desktop-runtime`（已含 chromadb/onnxruntime/PDF/Office）。

### Phase 1 — 新建分身可选 workspace（小、低风险，先落地）
- [ ] `registry.py:create_avatar` 加 `workspace_dir` 可选参数 + 归一化/建目录
- [ ] `server.py` `POST /api/avatars` 透传
- [ ] preload / `global.d.ts` / IPC 加 `workspaceDir`
- [ ] `AvatarCreateDialog.tsx` 加可选输入 + `AvatarSidebar.tsx` `handleCreate` 透传
- [ ] 冒烟测试 `tests/test_smoke_avatar_workspace_*.py`

### Phase 2 — 用户态 venv 解析与诊断（中）
- [ ] `main.ts` 后端解析顺序加入 `~/.agenticx/.venv`（FR-A1）
- [ ] KB 失败 / 启动自检 → 暴露 Python 路径 + 缺包（FR-A3）

### Phase 3 — 一键修复依赖（中，带进度）
- [ ] IPC：创建 `~/.agenticx/.venv` + `pip install` extras，流式进度（FR-A2）
- [ ] 设置页 / 失败提示处的「一键修复」入口与进度 UI

### Phase 4 — 安装入口默认含 KB 依赖（小）
- [ ] `install.sh` + 安装文档默认 extras（FR-A4）

### Phase 5 — 验收与回归
- [ ] AC-1..5 逐条验证；`npm run typecheck && npm run build`（desktop）；Python 冒烟测试

---

## 5. 未来路线图（不在本批次，仅记录方向）

「环境隔离 / 沙箱（Manus 式每会话云电脑）」的正确前置是**可插拔 ExecutionBackend**，按隔离强度分档：
`shared local`（现状）→ `per-session workspace`（已有）→ `venv subprocess`（依赖隔离）→ `container`（真沙箱起点）→ `remote microVM`（云电脑）。
venv 只是其中最弱一档，应直接奔容器 / 微VM，而非「每分身复制 venv」。该路线图另起 plan。

---

## 6. 追加修复（2026-06-02）：SOCKS 代理 + socksio + 知识脑配置保存

- **socksio**：`desktop-runtime` 增加 `socksio`；一键修复在 PyPI 装完后**显式** `pip install socksio` 并校验；开发态优先 `pip install -e <repo>[desktop-runtime]`。
- **诊断**：检测到 `ALL_PROXY`/`HTTPS_PROXY` 含 `socks` 时要求可 `import socksio`。
- **入库**：`runtime._check_socks_proxy_deps()` 向量化前 fail-fast；资料页区分「缺依赖」与「依赖已装但 serve 进程需 ⌘Q 重启」。
- **BrainsSettings**：保存知识脑配置改用 `kbDraft` 状态，修复 Wiki/合成答案勾选后保存被置空。
