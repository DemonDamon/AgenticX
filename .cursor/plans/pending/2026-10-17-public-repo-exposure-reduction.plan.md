# 公开仓库业务信息暴露收敛方案

Planned-with: Cursor Auto
Suggested-Impl-Model: 强推理档（涉及 git 历史改写与强制推送，属高风险不可逆操作）；阶段 1 的纯文本脱敏可用 Composer/Fast 档

## 1. 背景与证据链

仓库 `DemonDamon/AgenticX` 为 **public**（`gh api repos/DemonDamon/AgenticX --jq .visibility` → `public`），许可证 Apache-2.0。
代码开源本身不是问题；问题是仓库里同时公开了**规划、研究与交付类文档**，任何人 clone 后即可还原产品路线图和正在承接的交付方向。

2026-10-17 盘点结果（`git ls-files <dir> | wc -l`）：

| 路径 | 跟踪文件数 | 暴露内容 |
|---|---|---|
| `.cursor/plans/` | 748（其中 `pending/` 66） | 全部实施计划与未开工 backlog |
| `plans/`（仓库根） | 54 | 含 `plans/bidding/`（交付规划 10 份）、`plans/decision-layer/` 等 |
| `conclusions/` | 99 | 各模块实现总结 |
| `enterprise/conclusions/`、`enterprise/features/` | 若干 | Enterprise 交付相关总结 |
| `research/` | 25 | 竞品/上游调研（`.gitignore` 第 42 行已忽略 `research/`，但这 25 个是忽略前已跟踪的存量） |
| `docs/plans/` | 7 | 产品规划 |
| `AGENTS.md` | 1 | 含用户偏好、交付习惯与可识别客户线索 |

客户识别词命中（用本地 `.githooks/patterns.local.txt` 中的词表检索）：约 14 个路径前缀下的文件含客户可识别字样，分布在 `.cursor/plans/`、`enterprise/{scripts,plugins,docs,deploy,apps,features,conclusions}`、`enterprise/README_ZN.md`、`enterprise/.env.local.example`、`docs/{plans,guides}`、`desktop/src`、`AGENTS.md`。
提交信息：`git log --all --format='%s%n%b'` 中约 84 条含交付/客户类字样，例如最近一条 `9029ceec` 的标题直接写明了交付规划类型。

关键约束：**只删除当前文件无法消除暴露**。git 历史、已有 fork/clone、GitHub 的 PR 引用与缓存仍保留旧内容。

## 2. 目标

- G1：公开仓库只保留产品代码、通用文档与示例；规划/研究/交付类文档迁到私有位置，且本地开发流程（Cursor plan UI、`/commit --spec`、`/update-conclusion`）不受影响。
- G2：公开仓库当前 HEAD 中客户识别词命中数为 0。
- G3：之后的提交（文件与提交信息）在本地钩子和 CI 两层都会被拦截。
- G4（可选，需用户拍板）：改写历史，把上述内容从公开 git 历史中移除。

## 3. 需用户拍板的决策点

- **D1 私有存放方式**（推荐 A）：
  - A：新建私有仓库 `AgenticX-private`，在主仓根目录 clone 到 `.private/`（加入 `.gitignore`），`.cursor/plans` 等用软链接指向 `.private/` 内对应目录。Cursor 读取软链接没有问题，plan UI 不受影响。
  - B：整个主仓改为 private，另开一个只同步 `agenticx/` 等代码目录的公开镜像仓库。改动最小，但公开仓库的 star/issue 历史需要迁移。
- **D2 规则调整**：`~/.cursor/rules/plan-management.mdc` 与 `AGENTS.md` 规定 plan 必须「随代码一起提交」。选择 A 后改为「plan 提交到私有仓，主仓 commit 仍写 `Plan-Id` / `Plan-File` trailer（路径指向私有仓内相对路径）」。trailer 本身只含 slug，slug 不得含客户信息（现有规则已要求）。
- **D3 是否执行阶段 3 历史改写**：不可逆，需要强制推送，所有其他 clone/worktree 必须重新 clone。

## 4. 实施步骤

### 阶段 0：准备（无副作用）

1. 用户在 `.githooks/patterns.local.txt` 填入客户识别词（每行 `F:<词>\t<说明>`），该文件已被 `.gitignore` 第 99 行忽略。
2. 用户在 GitHub → Settings → Secrets → Actions 新建 `CUSTOM_SECRET_KEYWORDS`（多行，每行一个词），让 CI 的 `custom keywords` job 也拦截客户词；如需每周全量扫描，在 Variables 新建 `CUSTOM_SCAN_ENABLED=true`。
3. 全量备份：`git clone --mirror https://github.com/DemonDamon/AgenticX.git ~/backup/AgenticX-$(date +%Y%m%d).git`。

### 阶段 1：止血（只改 HEAD，不改历史）

1. 按 D1-A 建私有仓并迁移目录：
   ```bash
   gh repo create DemonDamon/AgenticX-private --private
   git clone https://github.com/DemonDamon/AgenticX-private.git .private
   for d in .cursor/plans plans conclusions research docs/plans enterprise/conclusions enterprise/features; do
     mkdir -p ".private/$(dirname "$d")" && cp -R "$d" ".private/$d"
   done
   cp AGENTS.md .private/AGENTS.md
   (cd .private && git add -A && git commit -m "chore: import internal docs" && git push)
   ```
2. 主仓停止跟踪并改为软链接：
   ```bash
   git rm -r --cached .cursor/plans plans conclusions research docs/plans enterprise/conclusions enterprise/features AGENTS.md
   ```
   在 `.gitignore` 追加：`.private/`、`/plans/`、`/conclusions/`、`docs/plans/`、`enterprise/conclusions/`、`enterprise/features/`、`/AGENTS.md`；并**删除** `.gitignore` 第 4–5 行的 `!.cursor/plans/` 与 `!.cursor/plans/**`，再追加 `.cursor/plans/`。
   然后对每个目录 `rm -rf <dir> && ln -s <相对路径>/.private/<dir> <dir>`（`AGENTS.md` 同理），确认 Cursor 中 plan 仍能打开。
3. 对剩余仍需公开的文件做脱敏：执行
   ```bash
   sed -E 's/^F://; s/\t.*$//' .githooks/patterns.local.txt | grep -v '^#' | grep -v '^$' > /tmp/kw.txt
   git grep -l -I -F -f /tmp/kw.txt
   ```
   逐个文件把客户字样替换为中性表述（「Enterprise 交付」「客户项目」「运营商 IDaaS」等）。重点检查 `enterprise/README_ZN.md`、`enterprise/.env.local.example`、`enterprise/deploy/README.md`、`enterprise/docs/runbooks/sso-*.md`、`enterprise/apps/admin-console/messages/zh.json`、`enterprise/plugins/tool-watermark/pdf_watermark_cli.py`、`enterprise/scripts/README.md`、`desktop/src` 中的命中文件。只替换字样，不改逻辑。
4. 提交到主仓（提交信息只写「迁出内部文档、脱敏示例」，不出现任何客户或交付类型字样）。

### 阶段 2：后续防线（与本次已完成的扫描修复衔接）

- 本地：`.githooks/` 已通过 `bash .githooks/install.sh` 激活（`git config core.hooksPath` → `.githooks`）；`commit-msg` 钩子会用同一份词表扫提交信息。
- CI：`.github/workflows/security-scan.yml` 的 `custom keywords` job 会读取 `CUSTOM_SECRET_KEYWORDS`。
- 在 `.githooks/patterns.local.txt` 追加交付类通用词（如招投标、评标、报价类词）以拦截提交信息里的业务方向描述。

### 阶段 3（可选，D3 确认后）：改写公开历史

1. 安装 `brew install git-filter-repo`，在**全新 mirror clone** 上操作：
   ```bash
   git clone --mirror https://github.com/DemonDamon/AgenticX.git /tmp/agx-rewrite.git && cd /tmp/agx-rewrite.git
   git filter-repo --invert-paths \
     --path .cursor/plans --path plans --path conclusions --path research \
     --path docs/plans --path enterprise/conclusions --path enterprise/features --path AGENTS.md
   git filter-repo --replace-text /tmp/kw-replace.txt     # 每行 "<客户词>==>[redacted]"
   git filter-repo --replace-message /tmp/kw-replace.txt
   ```
2. 检查：`git log --all --format='%s%n%b' | grep -cF -f /tmp/kw.txt` 应为 0；`git grep -F -f /tmp/kw.txt $(git rev-list --all) | wc -l` 应为 0。
3. `git push --force --mirror`（需临时关闭 `main` 分支保护）。
4. 联系 GitHub Support 申请清理缓存视图与 PR 引用（`refs/pull/*` 无法自行改写）。
5. 本机所有 worktree 与其他机器上的 clone 全部删除后重新 clone；已存在的第三方 fork 无法收回，需接受这部分残留。

## 5. 验收标准

- AC-1（G2）：主仓执行阶段 1 第 3 步的 `git grep -l -I -F -f /tmp/kw.txt` 输出为空。
- AC-2（G1）：`git ls-files .cursor/plans plans conclusions research docs/plans | wc -l` 为 0；Cursor 中打开任意 `.cursor/plans/*.plan.md` 仍能正常显示 todo UI。
- AC-3（G3）：新建临时文件写入一个客户词后 `git add` 并执行 `.githooks/pre-commit`，退出码为 1；提交信息含客户词时 `commit-msg` 钩子拦截。
- AC-4（G3）：在 PR 中故意加入客户词，CI `custom keywords (client identifiers)` job 失败。
- AC-5（G4，可选）：阶段 3 第 2 步两条命令输出均为 0。

## 6. 范围

In scope：上表列出的目录与文件迁移、`.gitignore` 调整、命中文件的字样脱敏、词表与 CI secret 配置、可选的历史改写。

Out of scope（no-scope-creep）：
- 不修改任何业务代码逻辑，不重构 `enterprise/` 目录结构。
- 不调整许可证（如需限制商用另立方案）。
- 不处理第三方已有 fork。
- 不改 `security-scan.yml` 中已修好的通用凭据规则。
