# 2026-04-21 开源仓客户信息泄露 · 事故复盘

> **事故等级**：P0（机密数据泄露到公开仓库）
> **事故状态**：已处理（脱敏 + 重写 HEAD + force push 完成）
> **复盘人**：Damon Li
> **范围**：`DemonDamon/AgenticX`（public repo）

---

## 1. 事故摘要

在将 "AgenticX Enterprise" 产品架构和首个客户项目骨架推进到仓库时，架构文档 / ADR / 模块 README / commit message 中含有客户识别字样（公司简称 / 行业特定用语 / 目录代称），随 `git push origin main` 被推送到 GitHub 公开仓库。

- 泄露载体：1 个 commit（`c779ddf`）+ 125 files 变更 + 其中 7 个文档 / 1 个 lockfile 含敏感字样
- 另外排查出 2 个**历史 commit 里早已存在**的轻度泄露（1 处测试 fixture + 1 处 doc 注释）
- 响应耗时：约 15 分钟从发现到 force push 修正完成

---

## 2. 时间线

| 时间 | 事件 |
|---|---|
| T-2h | 本地完成 enterprise/ monorepo 搭建 + 客户仓骨架 |
| T-1h30m | 主仓 commit `c779ddf`（含客户字样），**开源仓 push 完成** |
| T0 | 人工发现：commit 历史页面可见客户字样 |
| T+2min | 启动应急：盘点泄露面（HEAD commit + 7 个文件 + lockfile）|
| T+5min | 批量脱敏（Python 替换脚本 + 手工核对）|
| T+7min | 删除 `enterprise/pnpm-lock.yaml`（含客户 workspace 路径）|
| T+10min | `.gitignore` 加强 + 本地敏感目录转移到 `.git/info/exclude` |
| T+12min | `git commit --amend` 改写 HEAD + 新增 hotfix commit 修复历史泄露 |
| T+15min | `git push --force-with-lease origin main` 完成 |

---

## 3. 根因分析（5 Whys）

1. **为什么客户字样会进 commit message？**
   因为架构文档中大量引用"某客户项目"作为"首个落地案例"，写作时用了客户简称做说明。
2. **为什么写作时没意识到这会泄露？**
   因为当时聚焦在"把架构对齐到客户需求"的正确性，没切换到"这要进开源仓"的安全视角。
3. **为什么没有工具拦截？**
   没有 pre-commit hook / CI 扫描客户关键词的机制，`gitignore` 也未覆盖个人本地敏感目录。
4. **为什么 `pnpm-lock.yaml` 会含客户路径？**
   因为本地工作区同时存在 `customers/<client>/` 目录，pnpm 按 `enterprise/pnpm-workspace.yaml` 的 `../customers/*/apps/*` glob 把客户 app 纳入 lockfile。
5. **为什么 lockfile 被 commit 进去？**
   默认惯例是 lockfile 必须提交以保证可复现；但在"多租户 monorepo + 私有客户仓嵌套"架构下，这个惯例反而会泄露客户存在性信息 —— 我们需要例外规则。

---

## 4. 处理措施（已完成 ✅）

### 4.1 文件内容脱敏

7 个文件中 64 处客户字样替换为中性占位（"客户 A" / "[客户名已脱敏]" / "`<client-name>`"）：

- `docs/plans/2026-04-21-agenticx-enterprise-architecture.md`（35 处）
- `enterprise/docs/guides/enterprise-customers-collaboration.md`（16 处）
- `enterprise/features/audit/README.md`（7 处）
- `enterprise/docs/adr/0001-oss-foundations-selection.md`（3 处）
- `enterprise/apps/edge-agent/README.md`（1 处）
- `enterprise/pnpm-lock.yaml`（2 处，已删除 from git）

历史 tracked 文件另外修复 2 处轻度泄露：
- `tests/test_agent_tools.py`（1 处 taskspace label）
- `docs/plans/2026-04-14-machi-knowledge-base-product-plan.md`（1 处注释路径）

### 4.2 Lockfile 策略调整

```
enterprise/.gitignore 新增：
  pnpm-lock.yaml    # 各环境本地生成，避免被本地 customers/ 污染
```

### 4.3 `.gitignore` 加强

根仓：明确 `/customers/` 排除 + 通用 secrets/ envs 排除。  
本地敏感目录（会暴露客户身份的路径名）不放 `.gitignore`，改到 `.git/info/exclude`（per-repo 本地 ignore，不进版本控制）。

### 4.4 Git 历史改写

- `git commit --amend`：改写 `c779ddf` → `9d7249c`（本轮 commit 脱敏）
- 新增 `91056c7`：单独 hotfix 历史泄露
- `git push --force-with-lease origin main`：覆盖远端

**注意**：旧 commit `c779ddf` 仍在 GitHub event cache 里，约 30-90 天过期。彻底清除需联系 GitHub Support。

---

## 5. 影响评估

| 维度 | 评估 |
|---|---|
| 泄露字段 | 客户简称、行业特定用语、本地目录名 |
| 是否泄露凭据 | ❌ 无（未涉及 API Key / Password / 证书）|
| 是否泄露合同内容 | ❌ 无（仅公开项目名 + 行业类别）|
| 观察窗口 | 约 15 分钟（push 到 force push 修正）|
| Fork / Clone 数 | 需手工在 GitHub Network 页面确认 |
| 法律合规风险 | 低（未包含客户法人 / 业务细节 / 个人信息）|
| 声誉风险 | 中（需要应急处理以防对方发现） |

---

## 6. 未来防御（五层递进）

### L1 — 写作阶段（预防）

- **规则**：写任何文档时自问"这会进开源仓吗？"。涉及客户的内容一律用占位符：
  - "客户 A" / "目标客户" / "首个落地案例" / "<client-name>"
  - 数字版本号 / 日期戳保留（不暴露身份）
- **工具**：vscode/cursor 里新建 snippet，输入 `@client` 自动插入占位符

### L2 — 提交阶段（本地 hook）⭐ 本文档附带

- `.githooks/pre-commit`：扫 staged 内容 + 文件路径，命中敏感 pattern 阻止提交
- `.githooks/commit-msg`：扫 commit message，阻止含客户字样
- `.githooks/patterns.txt`：通用模式（GitHub PAT、AWS Key、OpenAI Key 等），进仓
- `.githooks/patterns.local.txt`：个人客户关键词（和创 / hechuang / 具体公司名），**gitignore**

### L3 — 目录隔离（架构）

- 开源仓与客户仓**物理分开**：
  - AgenticX（public）↔ customers/\*（private repos，嵌套但 git 独立）
- 本地敏感目录用 `.git/info/exclude` 不入 `.gitignore`（避免 `.gitignore` 本身泄露客户名）

### L4 — CI 门禁（push 后/merge 前）

- `.github/workflows/security-scan.yml`：gitleaks + 自定义 pattern 扫描每次 push
- PR 合并前必须通过 security-scan

### L5 — 事后监控

- 定期 `git log --all | grep -E "和创|客户关键词"` 自查
- GitHub Settings → Code security → Secret scanning（免费）启用
- 关键业务关键词订阅 Google Alerts（第三方意外引用时告警）

---

## 7. 行动项 Checklist

### 本轮已完成

- [x] 重写 HEAD commit，force push 覆盖远端
- [x] lockfile 从 git 移除，加到 `enterprise/.gitignore`
- [x] 历史泄露（test fixture + doc 注释）独立 hotfix
- [x] 本地敏感目录转 `.git/info/exclude`
- [x] 本复盘文档 + pre-commit hook + CI workflow 落盘

### 待用户确认 / 人工执行

- [ ] 🔴 GitHub PAT 轮换（用户主动暂不做，已知悉风险）
- [ ] 检查 `https://github.com/DemonDamon/AgenticX/network/members` 是否有 fork
- [ ] （可选）联系 `support@github.com` 请求清除 c779ddf 的 event cache

### 持续执行

- [ ] 所有新人 clone 仓库后必须运行 `.githooks/install.sh`
- [ ] 月度自查：`git log --all --format="%H %s" | rg '<client-keywords>'`
- [ ] 季度 threat model review：更新 `patterns.txt`

---

## 8. 教训

1. **多租户架构 + 开源仓库的组合天然有泄露风险**，要在架构阶段就把防御做好，不能靠事后补救。
2. **lockfile / 生成物** 在多仓协作下可能意外包含下游路径，应该默认不提交，除非 CI 在隔离环境生成。
3. **`.gitignore` 本身也是内容泄露点**。`/和创/` 这样的 ignore 规则本身就暴露了客户身份，应该用 `.git/info/exclude`。
4. **commit message 比代码更容易泄露**，因为写得快、审得少，却 100% 公开可见。
5. **pre-commit hook 的性价比极高**，投入 30 分钟写规则，可以把大部分泄露堵在本地。
6. **出事后响应速度比事前演练更重要** — 本次从发现到修复 15 分钟，得益于对 git 工具链的熟悉。对于不熟的人，建议把"事故响应剧本"贴到仓库首页。

---

## 9. 参考

- 事故处理过程：`git log e05dfae..91056c7`（分别对应第二次 amend 前 / 最终 hotfix commit）
- 防御 hooks：`/.githooks/`（本次一并落盘）
- CI scanner：`/.github/workflows/security-scan.yml`（本次一并落盘）
- ADR-0001 开源基座选型（含 License 合规与供应链安全）：`enterprise/docs/adr/0001-oss-foundations-selection.md`
- SECURITY.md：`enterprise/SECURITY.md`
