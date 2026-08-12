# 参与贡献 AgenticX

感谢贡献。提交 Pull Request 前请先阅读本文。

英文版：[CONTRIBUTING.md](CONTRIBUTING.md)

---

## 我们期望什么

AgenticX 包含多智能体框架、本地 Studio API（`agx serve`）、Desktop 应用，以及可选的 Enterprise 栈。贡献应满足：

1. **范围克制** — 只改 Issue/PR 所需内容，禁止顺手重构无关代码。
2. **可验证** — 行为变更应补充或更新测试，并在 PR 中说明如何验证。
3. **可安全合入** — 无密钥、无客户可识别信息、无硬编码内网地址。

每条改动都应能追溯到具体 bug、功能需求或已文档化的要求。

---

## 分支命名

所有改动须走功能分支 + Pull Request，禁止直接推 `main`。

| 场景 | 前缀 |
|------|------|
| 新功能 | `feat/<name>` |
| Bug 修复 | `fix/<name>` |
| 文档 | `docs/<name>` |
| 重构 | `refactor/<name>` |
| 测试 | `test/<name>` |

```bash
git checkout -b feat/my-feature
# ... 开发、提交 ...
# 向 main 发起 PR
```

---

## 开发环境

需要 **Python 3.10+**。

```bash
git clone https://github.com/DemonDamon/AgenticX.git
cd AgenticX

# 推荐
pip install uv
uv pip install -e ".[dev]"

# 或
pip install -e ".[dev]"
```

仅在改动需要时再装可选 extras（见 `README_ZN.md` / `pyproject.toml`）：

```bash
uv pip install -e ".[memory,mcp]"
# 或
uv pip install -e ".[all]"
```

系统依赖与文档解析相关说明见 [INSTALL.md](INSTALL.md)。

### Desktop（改动 `desktop/` 时）

```bash
cd desktop
npm install
npm run dev          # Vite 默认端口 5713（可用 AGX_DEV_PORT 覆盖）
npm run build        # 若改了 UI/Electron，PR 前须通过
```

说明：

- Desktop 默认连接**本机** `agx serve`，不是远程后端。
- 修改 Electron 主进程（`desktop/electron/`）后须**完全退出并重启**应用（⌘Q / 停掉 `npm run dev`）；仅刷新渲染进程不会加载新主进程逻辑。
- Electron 升级后 `node-pty` 可能需要：`npx @electron/rebuild -f -w node-pty`。

### 本机运行时配置

用户/运行时数据在 `~/.agenticx/`（如 `config.yaml`、会话、workspace）。不要假定「只改仓库文件」就会改变已安装 Desktop 的运行配置。

---

## 测试

### Python（后端 / 运行时改动必做）

验收口径是**「不引入新的失败」**，而不是「全量测试全绿」。

`tests/` 下约有 450 个测试文件，其中部分在干净的 `main` 上本身就是失败的，或依赖凭据 / 网络 / 外部 CLI。全量跑既慢又必然见红。因此请：

1. 找出覆盖你改动的测试文件，**改动前**先跑一遍记录基线。
2. 改完再跑一遍，确认没有新增失败。
3. 在 PR 里写出前后结果（例如「`test_studio_server.py`：改动前后均为 4 failed / 27 passed，同一批既有失败」）。

```bash
# 定向运行；-o addopts= 可跳过默认 coverage 参数，本地迭代更快
python -m pytest tests/test_agent_runtime_tool_search.py -q -o addopts=

# 需要跑更大范围时排除慢测试
python -m pytest tests/ -q -o addopts= -m "not slow"
```

新行为应在 `tests/` 下补充单测或冒烟测试（现有大量 `test_smoke_*.py` 可参考）。

> 目前**没有 CI 跑 Python 测试**，这项检查完全依赖贡献者自觉，所以请在 PR 中写清跑了什么。

### Desktop

若改动 `desktop/` 下 TypeScript/React/Electron：

```bash
cd desktop
npm run build                      # 必须通过
npm run test:action-confirmation   # 相关时运行
npm run test:native-connectors     # 相关时运行
```

### Studio 冒烟（改动 `agenticx/studio/server.py` 时必做）

`create_studio_app()` 及其顶部 import 区非常敏感。编辑该文件后：

1. 在空闲端口冷启动，例如：  
   `agx serve --host 127.0.0.1 --port 18765`
2. 确认进程不崩溃，且核心接口返回 200，例如：  
   `/api/session`、`/api/avatars`、`/api/sessions`
3. 编辑 import 或大段代码时：**只精确增删目标行**，禁止用整段替换覆盖相邻无关 import（容易误删一行导致 Desktop 分身/历史/工作区全空）。

---

## 持续集成（CI）

PR 上的 CI 关注的是打包与凭据卫生，不负责验证正确性：

| Workflow | 作用 |
|----------|------|
| `.github/workflows/security-scan.yml` | 每个 PR 用 gitleaks 扫**完整 git 历史**，并做 enterprise 依赖审计 |
| `.github/workflows/build-desktop.yml` | 构建 Desktop（macOS DMG / Windows 安装包） |
| `.github/workflows/enterprise-db-compat.yml` | Enterprise 数据库兼容性检查 |

两点推论：

- 只要分支历史里**任何一次** commit 提交过凭据，扫描就会失败，即使后续 commit 已删除。这种情况请重写分支历史，而不是再加一个「删除密钥」的提交。
- CI 不跑 Python 测试，所以 PR 描述里的测试证据很重要。

---

## 仓库地图（改哪里）

| 区域 | 路径 | 说明 |
|------|------|------|
| 核心框架 / 运行时 | `agenticx/` | Agent、工具、记忆、LLM Provider |
| 本地 API（Studio） | `agenticx/studio/` | REST + SSE，无内置 Web UI |
| Desktop | `desktop/` | React + Electron + Vite |
| 测试 | `tests/` | 优先在功能旁补 smoke/unit |
| 打包 | `packaging/` | PyInstaller / sidecar |
| Enterprise | `enterprise/` | **不接受外部 PR** — 见下 |

若目标端不清晰（Desktop vs Studio），先在 Issue 里确认再写代码。

### Enterprise（`enterprise/`）

Enterprise 栈（网关、管理台、前台 portal）**目前不接受外部 Pull Request**：它带有部署相关假设与交付约束，从外部难以评审。

如果你在这里发现 bug 或想改动，请**先开 Issue**，我们再讨论后续处理。未经 Issue 事先约定就修改 `enterprise/` 的 PR 将不做评审直接关闭。

---

## 代码约定

- **范围纪律**：只碰 PR 所需路径，不「改进」当前没问题的无关逻辑。
- **风格对齐**：跟随所改文件既有写法（import、命名、模式）。
- **不要**给未改动的代码补注释、类型注解或 docstring。
- **不要**为假想的未来需求加抽象或配置开关。
- 优先小而可审的 PR，避免多主题大包。
- 新增依赖：Python 改 `pyproject.toml`，Desktop 改 `desktop/package.json`，并在 PR 中说明理由。
- UI 改动应对齐 `desktop/` 现有主题 token 与组件模式，避免一次性硬编码颜色/另起一套控件。

---

## Commit 信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat(studio): 新建会话尽早返回 session_id
fix(desktop): 多窗格模型选择互不串台
docs: 说明 Desktop 仅绑定本机 agx serve
test(runtime): 补充工具轮次上限相关冒烟测试
```

要求：

- subject 写**原因 / 用户可见效果**，不要堆文件清单。
- commit 与 PR 文案中**不得**出现密钥、客户名称或内部部署路径。
- **不要**用「对齐某某第三方产品」表述；用产品内中性描述说明行为变化。
- 除非维护者要求特定格式，否则不要添加 AI 工具署名类 trailer（如 `Co-authored-by: Cursor`）。

维护者在合入时可能补充额外 trailer（计划/过程元数据）；贡献者无需自行编造。

---

## Pull Request

- 关联相关 Issue（或清晰描述 bug/需求）。
- 说明**改了什么**以及**如何测试**。
- 尽量一 PR 一事。
- 用户可见行为或 CLI 变更时同步更新文档。
- Review 会重点看范围、正确性与回归风险。

### PR 前检查清单

- [ ] 不在 `main` 上直接开发；PR 目标为 `main`
- [ ] 改动范围与所述需求一致
- [ ] 相关测试改动前后各跑一遍，**无新增失败**，并已在 PR 中说明结果
- [ ] 若改动 `desktop/`，`npm run build` 已通过
- [ ] 若改动了 `agenticx/studio/server.py`：已完成 `agx serve` 冷启动冒烟
- [ ] 未改动 `enterprise/`（或已在 Issue 中与维护者达成一致）
- [ ] **分支历史中任何位置**都没有 API Key、Token、凭据或客户可识别信息
- [ ] 新文件已确认无敏感内容
- [ ] 新增依赖已写入对应清单
- [ ] 新行为有测试（或在 PR 中说明为何不需要）
- [ ] Commit 信息符合 Conventional Commits

---

## 报告 Bug

请开 GitHub Issue，并尽量包含：

- 期望行为 vs 实际行为
- 复现步骤
- AgenticX / Desktop 版本（或 git SHA）、操作系统、Python 版本
- 相关日志（打码密钥）。若 Desktop 出现分身/历史/工作区全空，请先确认 `agx serve` 是否在监听（Desktop 场景可对照 `~/.agenticx/serve.port`）

---

## 许可证

AgenticX 采用 [Apache License 2.0](LICENSE)。提交贡献即表示你同意该贡献以相同许可证授权，并确认你有权提交它（为你本人的成果，或你已获授权贡献）。

---

## 其它

- 产品站点：[https://www.agxbuilder.com/](https://www.agxbuilder.com/)
- 需要附着在具体改动上的设计讨论，优先用 GitHub Issue

感谢帮助改进 AgenticX。
