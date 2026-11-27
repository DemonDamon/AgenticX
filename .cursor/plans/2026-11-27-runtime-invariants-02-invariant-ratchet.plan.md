# AgenticX 运行时不变量内化 02：不变量门禁

Planned-with: GLM-5.4（Trae）
Suggested-Impl-Model: GLM-5.4
Status: implemented
Plan-Id: 2026-11-27-runtime-invariants-02-invariant-ratchet
Parent-Plan: `.cursor/plans/pending/2026-11-27-runtime-invariants-master.plan.md`

## Goal

给仓库加一道只减不增的不变量门禁，闭环 master plan 的判据 6「把基线调大，CI 失败」：

- 一个最小的 ratchet：基线文件 `scripts/ci/ratchet-baseline.json`、脚本 `scripts/ci/ratchet.py`。每条规则统计 `agenticx/` 下含指定字面量的代码行数，超出基线即失败。
- 启动时三条规则：账本读取不走旁路（基线 2）、checkpoint 不新增落盘口（基线 0）、账本投影的恢复锚点只经 `load_resume_anchor` 进入（基线 0，保护子 plan 01）。
- PR 上把当前基线与目标分支的基线逐条比较：基线调大、规则被删都失败；新增规则允许，但同样受「实际行数 ≤ 基线」约束。这是「把基线调大，CI 变红」唯一的实现方式，只比较「实际行数」做不到。
- 接进 `python-regressions`：作为第一步运行；workflow 的触发路径补上 ratchet 的两个文件，并在 PR 事件下拉取目标分支的基线。
- 顺带把子 plan 01 的五个测试文件与 `tests/test_ha_checkpoint_resume.py` 接进 CI 回归，落实 master plan 风险节的「`tests/test_ha_checkpoint_resume.py` 进基线」。

不做：文件行数上限、LLM 评测进 CI、子 plan 04 的规则（等 04 落地时再加）。本 plan 不改 `agenticx/` 下任何文件。

参考依据见 master plan『背景与参考来源』。

## 核实结论

以下事实全部在 HEAD `f22f5311`（分支 `feat/runtime-invariants`）上实测，时间为 2026-11-28。

### 1. 两条启动规则在当前 HEAD 上的实测

```bash
git grep -n -F -e 'run_dir / "events.jsonl"' -e 'runs/*/events.jsonl' -- agenticx | grep -v "agenticx/runtime/replay_ledger/"
git grep -n "save_agent_state(" -- agenticx | grep -v -e "agenticx/runtime/checkpoint.py" -e "agenticx/studio/storage/"
```

实际输出：第一条恰好 2 行，第二条为空。

```
agenticx/runtime/session_perf.py:37:            events = _load_events(run_dir / "events.jsonl")
agenticx/skills/agenticx-agent-obs/scripts/diagnose_traces.py:42:        sessions_root.glob("*/runs/*/events.jsonl"),
```

与子 plan 01 的门禁自检（其 Task 6）逐字一致。补充三点：

- 规则 1 的基线 2 是「账本包之外」的行数。`agenticx/runtime/replay_ledger/store.py:212,244,290,401` 这 4 行在包内，被排除。
- 规则 2 要得到基线 0，必须同时排除 `agenticx/studio/storage/` 与 `agenticx/runtime/checkpoint.py`。`save_agent_state(` 的全部出现是 `agenticx/runtime/checkpoint.py:85,121`、`agenticx/studio/storage/backend.py:54,173,178`、`local_file.py:211`、`redis_backend.py:183`。
- 宽匹配 `events.jsonl` 在账本包之外会多算 `agenticx/runtime/studio_safety.py:14,41,332` 三行安全审计日志，所以规则 1 只按两段字面匹配。

### 2. A：「基线调大 → CI 变红」只有一种实现方式

**结论：成立。把当前基线文件与目标分支上的基线文件逐条比较，是唯一能在 PR 上发现「基线被调大」的手段。** 只比较实际行数时，把基线从 2 调到 3、实际仍是 2，检查照样通过。已在临时仓库里实测（见 Verification 的 (c)）：不带目标分支时 `ratchet: passed`、退出码 0；带上以后 `ratchet: FAIL ledger-read-bypass: baseline raised from 2 to 3`、退出码 1。

实现口径（已实测可用）：

- 用 `git show <ref>:scripts/ci/ratchet-baseline.json` 读目标分支上的基线。浅克隆（深度 1）下照样能读，因为 blob 可以从分支顶端的提交树直接取到。
- ref 不存在时必须报错退出，不能当成「没有基线」放行：`git cat-file -e "<ref>^{commit}"` 对不存在的 ref 退出码 128，脚本据此区分「ref 配错」与「ref 上没有这个文件」。
- 规则被删除也算失败，删规则等于绕过。
- 新增规则允许，子 plan 04 靠它接入；新规则同样受「实际行数 ≤ 基线」约束。
- 目标分支上没有基线文件（本 PR 就是这种情况，main 上还没有）时只做常规检查。
- 规则的 `patterns` / `exclude` 被改写不做机器校验，是已知局限，见风险节。

### 3. B：workflow 的路径过滤有漏洞

`.github/workflows/python-regressions.yml:5-16`（`pull_request`）与 `:19-30`（`push`）的 `paths` 只列了 `scripts/ci/python-regressions.py` 与 workflow 自身（`:15-16`、`:29-30`）。一个只改 `scripts/ci/ratchet-baseline.json` 或 `scripts/ci/ratchet.py` 的 PR 根本不会触发这个 workflow。两处都要加这两个路径。

另一个更小的缺口：`agenticx/**/*.py` 之外的文件（技能里的 `.md`、`.js` 等）改动不触发本 workflow。ratchet 扫描的是 `agenticx/` 下全部已跟踪文件，所以这类文件里新增的旁路要等下一次有 `.py` 改动的 PR 才会被发现。本 plan 不扩大触发范围，列为待拍板事项 1。

### 4. C：CI 里默认拿不到目标分支的基线

checkout 步骤（`python-regressions.yml:53`）没有设 `fetch-depth`，是默认的浅克隆，PR 事件下只有合并提交。同目录的 `security-scan.yml:35,53` 需要完整历史时是显式写 `fetch-depth: 0` 的。

用临时仓库模拟了这条链路（单分支、深度 1 的克隆，等同于 PR 事件的检出）：

```
--- refs before fetch ---
refs/heads/feature
refs/remotes/origin/feature
--- origin/main before fetch ---
fatal: Needed a single revision
=== fetch the target branch with an explicit refspec ===
 * [new branch]      main       -> origin/main
--- shallow? ---
true
--- base baseline via git show ---
{
  "rules": [{"id": "a", "description": "d", "exclude": [], "patterns": ["x("], "baseline": 2}]
}
```

结论：`git fetch --no-tags --depth=1 origin "+<目标分支>:refs/remotes/origin/<目标分支>"` 之后 `origin/<目标分支>` 一定存在，浅克隆下 `git show` 能读到 base 版基线。`+` 是评审时补上的：不带它，`origin/<目标分支>` 已存在时目标分支前进会被拒为 non-fast-forward（临时仓库实测）。

传参方式全 plan 只用一种：环境变量 `RATCHET_BASE_REF`。理由：

- workflow 用步骤的 `env:` 传值，分支名不进 shell 命令行，不需要担心分支名里的 shell 元字符。
- `scripts/ci/python-regressions.py` 不需要为此加参数、不需要转发。
- 直接运行 `python scripts/ci/ratchet.py` 与经门禁运行是同一条路径。
- push 事件没有目标分支，不设这个变量，只做常规检查。

### 5. D：接入点与解释器

- `import ratchet` 可行。`scripts/ci/python-regressions.py:15` 用 `Path(__file__).resolve().parents[2]` 定位仓库根；以脚本方式运行时 `sys.path[0]` 就是 `scripts/ci`。用两个解释器、以及像 CI 那样预先设置 `PYTHONPATH` 的情况实测，`sys.path[0]` 都打印脚本所在目录，同目录模块可直接 import。
- ratchet 只用标准库。CI 是 Python 3.12（`python-regressions.yml:56`）；本机 `/opt/miniconda3/bin/python3` 是 3.13.12，`.venv` 是 3.12.14。本 plan 的三个 Python 文件已用 3.12.14 `py_compile` 通过，没有 3.13 专有语法。
- 能跑 `scripts/ci/python-regressions.py` 的本机解释器只有 `/opt/miniconda3/bin/python3`：`require_dependencies`（`python-regressions.py:49-60`）要 import `pytest`、`pytest_asyncio`、`fitz`、`pypdf`、`PIL.Image`、`pptx`、`cryptography`，miniconda 全部可用；`.venv` 缺 `pytest`、`pypdf`、`pptx`。
- 改动前的门禁在本机实测通过：`165 passed, 5 warnings in 6.39s`，`Executed 165 regression cases with no skips`，退出码 0。

### 6. E：匹配口径

**结论：用 `git ls-files -z -- agenticx` 枚举文件，再用纯 Python 逐行做字面、大小写敏感的子串匹配，统计「匹配的行数」。**

- 为什么不是纯 Python 遍历目录：两条已验证的 `git grep` 命令只搜已跟踪文件。用 `git ls-files` 枚举，文件集合与 `git grep` 由构造保证相同，未跟踪文件、被忽略的文件、`__pycache__` 都天然不进扫描，不需要另写跳过规则。纯遍历则要自己维护这些规则，而且本地未跟踪的源码会让计数与 `git grep` 对不上。
- 二进制文件：按 UTF-8 解码、坏字节替换，含字面量的行照常计数（`git grep` 对二进制文件报 `Binary file matches`，同样算命中）。当前 `agenticx/` 下没有 gitlink 与符号链接，脚本对非普通文件直接跳过。
- 非 `.py` 的已跟踪文件也计数，与 `git grep` 一致。当前 `agenticx/` 下共 1404 个已跟踪文件（1309 个 `.py`，其余是 `.md`、`.yaml`、`.cjs` 等）。
- 一行里出现多个模式或多次出现只计 1 行。
- 实测一致性：用本 plan 的代码对当前工作树计数，规则 1 得到 `agenticx/runtime/session_perf.py:37`、`agenticx/skills/agenticx-agent-obs/scripts/diagnose_traces.py:42`（2 行），规则 2、规则 3 均为 0 行，与三条 `git grep` 逐行一致；枚举 0.011 秒，三条规则计数合计 0.52 秒。

### 7. F：测试文件自身含这些模式字面量

`tests/test_ci_ratchet.py` 的夹具里有 `run_dir / "events.jsonl"`、`save_agent_state(`，启动规则断言里有 `project_resume_anchor`。ratchet 只扫 `agenticx/`，所以不受影响。**实施者不要为此「修复」测试文件**，也不要把扫描范围扩到 `tests/`。

### 8. G：把 01 的测试接进 CI 回归

六个候选文件在 CI 参数下实跑（`-o addopts= --import-mode=importlib --strict-markers --strict-config`）：

| 命令 | 结果 |
| --- | --- |
| 六个文件，本机环境原样 | `52 passed, 1 skipped, 1 warning in 6.58s` |
| 六个文件，提供 fakeredis 2.41.0 + redis 5.3.1 | `53 passed, 1 warning in 5.01s` |
| 01 的 20 文件回归，本机环境原样 | `324 passed, 1 skipped, 1 warning in 15.76s` |
| 01 的 20 文件回归，提供 fakeredis | `325 passed, 1 warning in 15.41s` |

跳过的那 1 个是 `tests/test_ha_checkpoint_resume.py:52` 的 `pytest.importorskip("fakeredis.aioredis")`，只有 `test_checkpoint_store_roundtrip_redis`（`:93`）调用它。`check_report`（`python-regressions.py:69-71`）遇到任何 skip 都让 CI 失败，所以原样接入必然变红。

依赖现状：`requirements.lock` 里没有 fakeredis、redis、pytest（CI 的 pytest 也是在 workflow 里单独钉的版本，`python-regressions.yml:62`）。`pyproject.toml:241` 的 dev extra 声明了 `fakeredis>=2.20,<3`，`:216` 的 server extra 声明了 `redis>=5.0.0,<6`。

**结论：能接，接。** 做法：在 workflow 的安装行加 `"fakeredis==2.41.0" "redis==5.3.1"`，并在 `require_dependencies` 里把 `fakeredis.aioredis` 列为必需依赖（缺了就在 pytest 之前失败，不让它变成 skip）。

- fakeredis 2.41.0 在 dev extra 的范围内，wheel 是纯 Python（`py3-none-any`），依赖 `redis>=4.3` 与 `sortedcontainers>=2`。
- redis 钉 5.3.1 是为了留在 server extra 的 `<6` 范围内；它是 5.x 的最新版，依赖 `PyJWT>=2.9.0`，而 `requirements.lock:307` 已经钉了 `pyjwt==2.13.0`，不冲突。
- 新增的传递依赖只有 `sortedcontainers`（纯 Python）。
- 耗时：六个文件约 5–7 秒，对 20 分钟的超时没有影响。

### 9. H：给 01 接的第三条规则

**结论：接一条，模式 `project_resume_anchor(`，基线 0。**

```bash
git grep -n -F "project_resume_anchor(" -- agenticx | grep -v -e "agenticx/runtime/replay_ledger/" -e "agenticx/runtime/checkpoint.py"
```

实际输出为空。不过滤时恰好 2 行：`agenticx/runtime/replay_ledger/resume_anchor.py:83`（定义）与 `agenticx/runtime/checkpoint.py:179`（`load_resume_anchor` 内的唯一调用，`checkpoint.py:156` 起）。

为什么是它：01 的 FR-4 把恢复分层收在 `load_resume_anchor` 一个函数里——HA 模式读检查点存储、不读本地账本（否则副本接管失效，这是 master plan 风险节的第一条）；`AGX_RESUME_FROM_LEDGER=0` 的回滚开关也在这里。任何地方直接调用 `project_resume_anchor` 都会同时绕过分层与开关，而现有测试 `test_ha_mode_keeps_the_checkpoint_store_as_recovery_source` 只走 `load_resume_anchor`，拦不住这种绕过。它与规则 1（按路径读账本文件）、规则 2（`save_agent_state(` 的调用方）不重复。

评估后不接的候选：

| 候选 | 不接的理由 |
| --- | --- |
| `append_event(`（账本包之外） | 基线是 7 行噪声：`agenticx/sessions/base.py:160,308`、`database.py:346`、`in_memory.py:172,184`、`agenticx/studio/session_event_hub.py:92,111`，全是同名方法，与账本无关 |
| `store.append_event(` | 基线 0、无噪声，但只认接收者名为 `store` 的调用，换个变量名就漏 |
| 「账本行永不回写」「`ledger:` 游标命名空间」「closer 的冷加载守卫」 | 找不到字面量可以表达「不许这样做」 |

### 10. 核实中发现的、需要主会话知晓的事实

- **本 PR 自己在 CI 里演示不了「基线调大变红」。** main 上还没有基线文件，目标分支基线读不到，只做常规检查。这条判据第一次能在 CI 里观察到，是在本提交合入之后的下一个 PR。合入前只能靠单测（临时 git 仓库）与本地演示（提交后用 `RATCHET_BASE_REF=HEAD`）证明，步骤见 Verification。
- **既有用例偶发失败，与 02 无关。** `tests/test_llm_stream_watchdog.py::test_waiting_hint_sentinel`（`:172-190`，生产者睡 0.12 秒、首条反馈阈值 0.05 秒）在本机 17 次全量门禁运行里失败 2 次，报 `assert [] == ['ok']`，原样重跑即过。它一直在 `TEST_FILES` 里。遇到时原样重跑一次并在汇报里注明，不许在 02 里改它。
- **master plan 对规则 2 的描述有一处要读准。** 原文是「`agenticx/studio/storage/` 之外的 `save_agent_state(` 调用，只允许出现在 `agenticx/runtime/checkpoint.py`，基线 0」。要让基线为 0，`checkpoint.py` 本身也在排除列表里，与 01 的自检命令一致。
- **master plan 的 In scope 只写了 `scripts/ci/` 与 workflow。** 本 plan 另加一个测试文件 `tests/test_ci_ratchet.py`。仓库里没有针对 `scripts/ci` 的既有测试，命名沿用 `tests/trajectory/test_explore.py`（测 `scripts/` 下的脚本）的思路，落为 `tests/test_<目录>_<脚本名>.py`。

## Root cause

**现象**：仓库的 10 个 workflow 全是回归、构建、扫描，没有一道「只减不增」的门禁。两条已经验证过的边界 grep 只存在于子 plan 01 的文档里，靠人记得去跑。

**证据链**：

1. `scripts/ci/python-regressions.py:16-32` 的 `TEST_FILES` 只跑固定的回归文件，`check_report`（`:63-72`）只保证「跑了、没跳过」，没有任何「不许变多」的断言。
2. 01 新增的五个测试文件与 `tests/test_ha_checkpoint_resume.py` 都不在 `TEST_FILES` 里；后者还因为缺 fakeredis 会被 `check_report` 判为跳过而失败。
3. workflow 的 `paths` 不含 ratchet 的文件（核实 3）， checkout 是浅克隆（核实 4）。不补这两处，一个只改基线的 PR 不会触发检查，触发了也读不到目标分支的基线。
4. 01 的恢复分层只靠一个测试守护，绕过 `load_resume_anchor` 的直接调用没有任何机器检查（核实 9）。

实施者可以用这条链自行判断改动是否对症：每一环对应下文一个任务，任务做完后对应的那一环应当不再成立。

## Design

每个决定写清选了什么、备选是什么、为什么。

### D1 规则与匹配口径

- **schema（最小）**：`{"rules": [{"id", "description", "exclude", "patterns", "baseline"}]}`。每条规则恰好这五个键，多一个少一个都报错。`exclude` 是仓库根相对的路径前缀列表；`patterns` 是字面量列表，至少一个；`baseline` 是非负整数。
- **「只允许出现在某文件」用排除表达**：规则 2、3 把允许的文件与定义所在的包一起放进 `exclude`，剩下的命中数就是基线。不另设白名单字段。
- **扫描根固定为 `agenticx/`**：三条规则、04 将来的规则都在这个目录下。不加 `scan` 字段，不加 include 通配。
- **严格校验的理由**：基线文件是手写的。键名拼错（`baselines`）、基线写成字符串、规则 id 重复，都会让规则悄悄失效；校验失败时脚本报错退出，不放行。
- **备选 A（放弃）**：纯 Python 遍历目录加跳过规则。见核实 6。
- **备选 B（放弃）**：正则匹配。正则写得越宽，噪声越多，也越难在 PR 里评审；master plan 的两条规则本来就是两段字面量。
- **备选 C（放弃）**：每条规则带文件数或行数预算。master plan 明确不做文件行数上限。

### D2 与目标分支基线比较

- **输入**：环境变量 `RATCHET_BASE_REF`，值为 git ref（CI 里是 `origin/<目标分支>`）。未设置或为空串时只做常规检查。
- **读取**：先 `git cat-file -e "<ref>^{commit}"`，失败即报错退出；再 `git cat-file -e "<ref>:scripts/ci/ratchet-baseline.json"`，失败视为「该 ref 上没有基线文件」，只做常规检查；随后的 `git show` 失败一律报错退出，读失败不得静默放行（评审修正）。以 `-` 开头的 ref 直接拒绝，不让它被当成 git 的选项。
- **判定**（四条，顺序无关）：

| 情况 | 结果 |
| --- | --- |
| 某规则实际行数 > 基线 | 失败 |
| 目标分支有、当前没有的规则 | 失败（规则被删） |
| 某规则基线 > 目标分支上的基线 | 失败（基线被调大） |
| 当前有、目标分支没有的规则 | 允许，但同样受第一条约束 |
| 实际行数 < 基线 | 通过，并提示「可以收紧」 |

- **备选 A（放弃）**：ref 读不到时当作没有基线。配置错了会静默放行，等于给了一个关闭比较的暗门。
- **备选 B（放弃）**：比较合并基（merge-base）而不是目标分支顶端。PR 检出的是与目标分支顶端的合并结果，与顶端比较才是对的；目标分支上别人刚收紧的基线也应当立即生效。
- **不做机器校验**：`patterns` / `exclude` 被改写（例如把模式改得永远匹配不上）时，行数会变小、基线不动，检查通过。这只能靠 PR 评审，见风险节。

### D3 workflow 的三处改动

- `pull_request` 与 `push` 两处 `paths` 各加 `scripts/ci/ratchet.py`、`scripts/ci/ratchet-baseline.json`。
- 安装行加 `"fakeredis==2.41.0" "redis==5.3.1"`（理由见核实 8）。
- 新增一步「拉取目标分支」，只在 PR 事件下执行，用带 `+` 的显式 refspec，位于安装步骤之前（评审修正）；运行门禁的那一步设 `RATCHET_BASE_REF`，非 PR 事件为空串。
- 备选（放弃）：把 checkout 改成 `fetch-depth: 0` 拉完整历史。对这个 20 分钟超时的任务来说太重，而且只需要目标分支顶端的一个文件。

### D4 接入 `python-regressions.py`

- 新增 `run_ratchet()`，在 `main()` 里紧跟 `--list` 的返回之后、`require_dependencies` 之前调用；返回非 0 就直接返回，不装依赖、不跑 pytest。
- `--list` 模式不跑 ratchet：它只是打印选择，不应因为基线文件的问题失败。
- 用 `import ratchet` 而不是子进程：`python-regressions.py` 以脚本方式运行，`scripts/ci` 就是 `sys.path[0]`（核实 5）；import 放在 `run_ratchet()` 函数内，`--list` 与任何按路径加载它的场合都不受影响。
- 备选（放弃）：把 ratchet 做成 workflow 里独立的一步。master plan 的入口写明「作为 `python-regressions` 的一个步骤」，本地一条命令就能复现 CI 的全部门禁更有价值。

### D5 给 01 接的第三条规则

规则 `resume-anchor-bypass`：`patterns: ["project_resume_anchor("]`，`exclude: ["agenticx/runtime/replay_ledger/", "agenticx/runtime/checkpoint.py"]`，`baseline: 0`。理由与被否决的候选见核实 9。

04 的规则等 04 落地时再加：往 `rules` 里追加一条即可，新增规则被比较逻辑允许。`test_repository_baseline_keeps_the_startup_rules` 用的是子集断言，加规则不会让它失败。

### D6 回归选择与依赖

- `TEST_FILES` 末尾追加七个文件：01 的五个、`tests/test_ha_checkpoint_resume.py`、`tests/test_ci_ratchet.py`。`select_tests()` 本来就按文件是否存在过滤，老分支上缺文件时照旧打印「Not present on this branch」。
- `require_dependencies` 在选中 `tests/test_ha_checkpoint_resume.py` 时要求 `fakeredis.aioredis`。没有它，redis 用例会被 `importorskip` 跳过，整轮 pytest 跑完才被 `check_report` 判失败；提前失败信息更清楚，也符合该函数对文档、加密依赖的既有处理。
- 两个版本钉在 workflow 的安装行，不写进 `requirements.lock`：lock 是 `desktop-runtime` extra 的运行时锁文件，CI 的 pytest 也是在 workflow 里单独钉的。

### D7 明确不做的

- 不提供跳过开关。需要绕过时回退本提交。
- push 事件不做与目标分支的比较（没有目标分支；浅克隆里也没有前一个提交）。
- 不做 JSON 等多种输出格式，不做插件系统。

### 仓库对新 Python 文件的惯例（新代码遵守）

- 脚本：`scripts/ci/python-regressions.py:1-4` 的写法是 shebang、docstring、`from __future__ import annotations`；新文件照此，并按 01 的惯例在 docstring 末行加 `Author: Damon Li`。只用标准库。文件模式保持 100644（与 `python-regressions.py` 一致），不要 `chmod +x`。
- 测试文件：首行是 docstring（说明覆盖什么），docstring 末尾 `Author: Damon Li`；`from __future__ import annotations`；辅助函数以下划线开头。按路径导入 `scripts/` 下的模块沿用 `tests/trajectory/test_explore.py:11` 的 `sys.path.insert` 写法。
- 运行命令统一为 `/opt/miniconda3/bin/python3 -m pytest <文件> -q --no-cov`。`.venv` 是打包用的精简环境，没有 pytest。
- **本机注意**：miniconda 没有 fakeredis。02 合入后本地跑门禁需要它，见 Task 3 步骤 1 的临时安装方式，不要装进 miniconda 的 base 环境。

## In scope

- `scripts/ci/ratchet.py`、`scripts/ci/ratchet-baseline.json`：ratchet 框架与三条启动规则。
- `scripts/ci/python-regressions.py`：ratchet 作为第一步；回归选择加七个文件；fakeredis 作为必需依赖。
- `.github/workflows/python-regressions.yml`：路径过滤、安装行的两个版本、拉取目标分支、`RATCHET_BASE_REF`。
- `tests/test_ci_ratchet.py`：25 个用例（计划 24 个，评审修正加 1 个）。

## Out of scope

- `agenticx/` 下任何文件：不许碰。02 是门禁，不改被门禁的代码。
- 文件行数上限、LLM 评测进 CI。
- 子 plan 04 的规则：等 04 落地时再加。
- `requirements.lock`、`pyproject.toml`：不改。
- 其它 workflow：不碰。
- 不修 `test_waiting_hint_sentinel` 的偶发失败，不改任何既有测试。
- 不扩大 workflow 的触发范围（见待拍板事项 1）。
- 不给 ratchet 加跳过开关、不加输出格式、不加规则类型。

## Precise landing points

行号以 HEAD `f22f5311` 为准。

| 文件 | 类型 | 落点 |
| --- | --- | --- |
| `scripts/ci/ratchet.py` | Create | 整个文件 |
| `scripts/ci/ratchet-baseline.json` | Create | 整个文件 |
| `tests/test_ci_ratchet.py` | Create（Test） | 整个文件（Task 1 写主体，Task 2 追加常量与两个用例） |
| `scripts/ci/python-regressions.py` | Modify | `TEST_FILES` 末尾（`:31-32` 之间）加七行；`require_dependencies` 之前（`:49` 之前）加 `run_ratchet()`；`require_dependencies` 的 cryptography 分支之后（`:54` 之后）加 fakeredis 分支；`main()` 里 `--list` 返回之后（`:89` 与 `:91` 之间）加三行 |
| `.github/workflows/python-regressions.yml` | Modify | `pull_request.paths`（`:15-16`）与 `push.paths`（`:29-30`）各加两行；安装行（`:59-64`）加版本、插入拉取步骤、给运行步骤加 `env` |

## Tasks

三个 Task 串行实施。每个 Task 先写测试、看它失败，再写实现。**实现与本 plan 一致但测试仍失败时，停下报告，不许改断言。**

### Task 1 — FR-1、FR-2、FR-3：ratchet 核心与单测

文件：
- `tests/test_ci_ratchet.py`（Create，Test）
- `scripts/ci/ratchet.py`（Create）
- `scripts/ci/ratchet-baseline.json`（Create）

步骤：

- [x] 写失败的测试 `tests/test_ci_ratchet.py`（完整内容）：

```python
"""Tests for the invariant ratchet (scripts/ci/ratchet.py) and its wiring into
the Python regression gate.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "ci"))

import ratchet  # noqa: E402

LEDGER_READ = 'run_dir / "events.jsonl"'
LEDGER_RULE = {
    "id": "ledger-read-bypass",
    "description": "Ledger reads go through the ledger package.",
    "exclude": ["agenticx/runtime/replay_ledger/"],
    "patterns": [LEDGER_READ, "runs/*/events.jsonl"],
    "baseline": 2,
}
MALFORMED = [
    "not json",
    "{}",
    '{"rules": []}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("]}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("],'
    ' "baseline": 1, "note": "typo"}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": "1"}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": -1}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": true}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": [], "baseline": 1}]}',
    '{"rules": [{"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": 1},'
    ' {"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": 1}]}',
]


def _git(root: Path, *args: str) -> None:
    """Run git in ``root`` with a test identity and without the developer's global config."""
    env = {
        **os.environ,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_AUTHOR_NAME": "ratchet tests",
        "GIT_AUTHOR_EMAIL": "ratchet@invalid",
        "GIT_COMMITTER_NAME": "ratchet tests",
        "GIT_COMMITTER_EMAIL": "ratchet@invalid",
    }
    subprocess.run(["git", *args], cwd=root, env=env, check=True, capture_output=True)


def _rule(rule_id: str, patterns: list[str], baseline: int) -> dict:
    return {
        "id": rule_id,
        "description": f"Rule {rule_id}",
        "exclude": [],
        "patterns": patterns,
        "baseline": baseline,
    }


def _write_baseline(root: Path, *rules: dict) -> None:
    path = root / ratchet.BASELINE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"rules": list(rules)}, indent=2) + "\n", encoding="utf-8")


def _repo(tmp_path: Path, files: dict[str, str], *rules: dict) -> Path:
    """Commit ``files`` under agenticx/ plus ``rules`` on ``main``."""
    _git(tmp_path, "init", "-q", "-b", "main")
    if rules:
        _write_baseline(tmp_path, *rules)
    for name, text in files.items():
        path = tmp_path / "agenticx" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-q", "-m", "init")
    return tmp_path


def _pull_request(root: Path, *rules: dict) -> None:
    """Rewrite the baseline on a feature branch, the way a pull request does."""
    _git(root, "checkout", "-q", "-b", "feature")
    _write_baseline(root, *rules)
    _git(root, "add", "-A")
    _git(root, "commit", "-q", "-m", "update")


def _run(
    root: Path,
    capsys: pytest.CaptureFixture,
    monkeypatch: pytest.MonkeyPatch,
    base_ref: str | None = None,
) -> tuple[int, str]:
    """Run the ratchet against ``root`` and return its exit code with its output."""
    monkeypatch.setattr(ratchet, "ROOT", root)
    if base_ref is None:
        monkeypatch.delenv(ratchet.BASE_REF_ENV, raising=False)
    else:
        monkeypatch.setenv(ratchet.BASE_REF_ENV, base_ref)
    code = ratchet.main()
    return code, capsys.readouterr().out


def test_counts_each_matching_line_once_over_tracked_files_only(tmp_path: Path) -> None:
    repo = _repo(
        tmp_path,
        {
            # The second line holds both patterns and still counts once.
            "a.py": f"x = {LEDGER_READ}\ny = z  # {LEDGER_READ} or runs/*/events.jsonl\nplain = 1\n",
            "sub/b.py": f"x = {LEDGER_READ}\n",
            "runtime/replay_ledger/store.py": f"events_path = {LEDGER_READ}\n",
            "skills/notes.md": f"see {LEDGER_READ}\n",
        },
        LEDGER_RULE,
    )
    (repo / "agenticx" / "untracked.py").write_text(f"x = {LEDGER_READ}\n", encoding="utf-8")
    cache = repo / "agenticx" / "__pycache__"
    cache.mkdir()
    (cache / "a.cpython-312.pyc").write_bytes(LEDGER_READ.encode())

    files = ratchet.tracked_files(repo)

    assert "agenticx/untracked.py" not in files
    assert not any("__pycache__" in name for name in files)
    assert ratchet.count_lines(repo, LEDGER_RULE, files) == 4


def test_passes_when_every_count_fits_its_baseline(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 1))

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 0
    assert "ratchet: r: 1 line(s), baseline 1\n" in out
    assert f"ratchet: no base baseline to compare ({ratchet.BASE_REF_ENV} is unset" in out
    assert out.rstrip().endswith("ratchet: passed")


def test_fails_when_the_count_exceeds_the_baseline(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 0))

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 1
    assert "ratchet: FAIL r: 1 matching line(s) exceed the baseline of 0\n" in out


def test_passes_below_the_baseline_and_suggests_tightening(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 3))

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 0
    assert "ratchet: r: 1 line(s), baseline 3; the baseline can be tightened\n" in out


def test_raised_baseline_fails_against_the_target_branch(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 1))
    _pull_request(repo, _rule("r", [LEDGER_READ], 2))

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 1
    assert "ratchet: baselines compared with main\n" in out
    assert "ratchet: FAIL r: baseline raised from 1 to 2\n" in out


def test_lowered_baseline_passes_against_the_target_branch(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 2))
    _pull_request(repo, _rule("r", [LEDGER_READ], 1))

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 0
    assert "ratchet: baselines compared with main\n" in out


def test_removed_rule_fails_even_when_the_counts_fit(tmp_path, monkeypatch, capsys) -> None:
    first = _rule("first", [LEDGER_READ], 1)
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, first, _rule("second", ["save_agent_state("], 0))
    _pull_request(repo, first)

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 1
    assert "ratchet: FAIL second: rule removed\n" in out


def test_new_rule_is_allowed_but_ratcheted(tmp_path, monkeypatch, capsys) -> None:
    first = _rule("first", [LEDGER_READ], 1)
    second = _rule("second", ["save_agent_state("], 0)
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, first)
    _pull_request(repo, first, second)

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 0
    # Only tracked files are scanned, so stage the new bypass first.
    (repo / "agenticx" / "b.py").write_text("store.save_agent_state(sid, {})\n", encoding="utf-8")
    _git(repo, "add", "-A")

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 1
    assert "ratchet: FAIL second: 1 matching line(s) exceed the baseline of 0\n" in out


def test_target_branch_without_a_baseline_file_only_gets_the_count_check(
    tmp_path, monkeypatch, capsys
) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"})
    _pull_request(repo, _rule("r", [LEDGER_READ], 5))

    code, out = _run(repo, capsys, monkeypatch, base_ref="main")

    assert code == 0
    assert "no base baseline to compare" in out


def test_unknown_base_ref_fails_instead_of_skipping_the_comparison(
    tmp_path, monkeypatch, capsys
) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"}, _rule("r", [LEDGER_READ], 1))

    code, out = _run(repo, capsys, monkeypatch, base_ref="origin/no-such-branch")

    assert code == 1
    assert "ratchet: error: base ref 'origin/no-such-branch' is not a commit in this clone" in out


def test_missing_baseline_file_fails_loudly(tmp_path, monkeypatch, capsys) -> None:
    repo = _repo(tmp_path, {"a.py": f"x = {LEDGER_READ}\n"})

    code, out = _run(repo, capsys, monkeypatch)

    assert code == 1
    assert "ratchet: error: " in out


@pytest.mark.parametrize("document", MALFORMED)
def test_malformed_baseline_is_rejected(document: str) -> None:
    with pytest.raises(ratchet.RatchetError):
        ratchet.parse_baseline(document)


def test_repository_baseline_keeps_the_startup_rules() -> None:
    rules = ratchet.parse_baseline((ratchet.ROOT / ratchet.BASELINE_PATH).read_text(encoding="utf-8"))

    assert {"ledger-read-bypass", "checkpoint-save-bypass", "resume-anchor-bypass"} <= set(rules)
```

说明：

- 与目标分支比较的用例都在临时 git 仓库里跑（`_repo` 建分支 `main`，`_pull_request` 开 `feature` 分支改基线），不依赖本仓库的提交历史。`GIT_CONFIG_GLOBAL=os.devnull` 隔离开发者的全局 git 配置（签名、hooks）。
- `test_new_rule_is_allowed_but_ratcheted` 里新增的旁路要先 `git add` 才会被计数，这是「只扫已跟踪文件」的直接后果。
- 夹具里出现被统计的字面量是无害的，见核实 7。

- [x] 运行：`/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov`。预期失败（收集阶段）：

```
tests/test_ci_ratchet.py:19: in <module>
    import ratchet  # noqa: E402
E   ModuleNotFoundError: No module named 'ratchet'
ERROR tests/test_ci_ratchet.py
1 error in 0.04s
```

- [x] 新建 `scripts/ci/ratchet-baseline.json`（完整内容）：

```json
{
  "rules": [
    {
      "id": "ledger-read-bypass",
      "description": "Replay ledger events are read only through agenticx/runtime/replay_ledger/. Lines elsewhere that open events.jsonl by path bypass the store API. Literal patterns on purpose: studio_safety.py keeps a same-named safety audit log that is not a ledger read.",
      "exclude": ["agenticx/runtime/replay_ledger/"],
      "patterns": ["run_dir / \"events.jsonl\"", "runs/*/events.jsonl"],
      "baseline": 2
    },
    {
      "id": "checkpoint-save-bypass",
      "description": "save_agent_state( is called only from agenticx/runtime/checkpoint.py; agenticx/studio/storage/ holds the interface and the backend implementations.",
      "exclude": ["agenticx/studio/storage/", "agenticx/runtime/checkpoint.py"],
      "patterns": ["save_agent_state("],
      "baseline": 0
    },
    {
      "id": "resume-anchor-bypass",
      "description": "The ledger-projected resume anchor is entered only through load_resume_anchor, which keeps recovery layering (HA mode reads the checkpoint store) and the AGX_RESUME_FROM_LEDGER switch. A direct project_resume_anchor( call elsewhere skips both.",
      "exclude": ["agenticx/runtime/replay_ledger/", "agenticx/runtime/checkpoint.py"],
      "patterns": ["project_resume_anchor("],
      "baseline": 0
    }
  ]
}
```

- [x] 新建 `scripts/ci/ratchet.py`（完整内容）：

```python
#!/usr/bin/env python3
"""Invariant ratchet: greppable counts may only go down.

Every rule in ``ratchet-baseline.json`` counts the lines that contain any of
its literal patterns, over the tracked files under ``agenticx/`` (the set
``git grep`` searches) and outside its excluded path prefixes. A rule fails
when its count exceeds its baseline.

On a pull request the target branch's baseline is read as well
(``RATCHET_BASE_REF`` names a git ref such as ``origin/main``) and compared
rule by rule: a raised baseline or a removed rule fails even when the count
still fits. A new rule is always allowed and is ratcheted like the others.
Without ``RATCHET_BASE_REF`` only the count check runs.

Matching is literal, case-sensitive and per line; a line counts once no
matter how many patterns or occurrences it holds.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
BASELINE_PATH = "scripts/ci/ratchet-baseline.json"
SCAN_ROOT = "agenticx"
BASE_REF_ENV = "RATCHET_BASE_REF"
RULE_KEYS = frozenset({"baseline", "description", "exclude", "id", "patterns"})


class RatchetError(Exception):
    """A baseline file or base ref that cannot be used; never a silent pass."""


def _git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, check=False)


def _string_list(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) and item for item in value)


def parse_baseline(text: str) -> dict[str, dict]:
    """Validate one baseline document and return its rules keyed by id."""
    try:
        document = json.loads(text)
    except ValueError as exc:
        raise RatchetError(f"{BASELINE_PATH} is not valid JSON: {exc}") from exc
    rules = document.get("rules") if isinstance(document, dict) else None
    if not isinstance(rules, list) or not rules:
        raise RatchetError(f'{BASELINE_PATH} must hold a non-empty "rules" list')
    parsed: dict[str, dict] = {}
    for rule in rules:
        if not isinstance(rule, dict) or set(rule) != RULE_KEYS:
            raise RatchetError(f"each rule needs exactly the keys {sorted(RULE_KEYS)}: {rule!r}")
        if any(not isinstance(rule[key], str) or not rule[key].strip() for key in ("id", "description")):
            raise RatchetError(f"id and description must be non-empty strings: {rule!r}")
        if not _string_list(rule["exclude"]) or not _string_list(rule["patterns"]) or not rule["patterns"]:
            raise RatchetError(
                f"exclude and patterns must be lists of non-empty strings, with at least one pattern: {rule!r}"
            )
        if type(rule["baseline"]) is not int or rule["baseline"] < 0:
            raise RatchetError(f"baseline must be an integer of at least 0: {rule!r}")
        if rule["id"] in parsed:
            raise RatchetError(f"duplicate rule id: {rule['id']}")
        parsed[rule["id"]] = rule
    return parsed


def tracked_files(root: Path) -> list[str]:
    """Return the repo-relative paths of the tracked files under the scan root."""
    result = _git(root, "ls-files", "-z", "--", SCAN_ROOT)
    if result.returncode:
        raise RatchetError(f"git ls-files failed: {result.stderr.decode(errors='replace').strip()}")
    names = result.stdout.decode("utf-8", errors="surrogateescape").split("\0")
    return [name for name in names if name]


def count_lines(root: Path, rule: dict, files: list[str]) -> int:
    """Count the lines holding any pattern of ``rule`` outside its excluded prefixes."""
    excluded = tuple(rule["exclude"])
    patterns = tuple(rule["patterns"])
    count = 0
    for name in files:
        if name.startswith(excluded):
            continue
        path = root / name
        if not path.is_file():
            continue  # a submodule entry, or a file deleted from the working tree
        lines = path.read_bytes().decode("utf-8", errors="replace").split("\n")
        count += sum(1 for line in lines if any(pattern in line for pattern in patterns))
    return count


def base_rules(root: Path, ref: str) -> dict[str, dict] | None:
    """Return the rules of the baseline file at ``ref``, or None when that ref has none."""
    ref = ref.strip()
    if not ref:
        return None
    if ref.startswith("-"):
        raise RatchetError(f"{BASE_REF_ENV} must name a git ref, got {ref!r}")
    if _git(root, "cat-file", "-e", f"{ref}^{{commit}}").returncode:
        raise RatchetError(
            f"base ref {ref!r} is not a commit in this clone; fetch the target branch first"
        )
    shown = _git(root, "show", f"{ref}:{BASELINE_PATH}")
    if shown.returncode:
        return None
    return parse_baseline(shown.stdout.decode("utf-8"))


def evaluate(
    counts: dict[str, int], current: dict[str, dict], base: dict[str, dict] | None
) -> list[str]:
    """Return one failure line per ratchet problem; an empty list means the ratchet passes."""
    problems: list[str] = []
    for rule_id, rule in current.items():
        if counts[rule_id] > rule["baseline"]:
            problems.append(
                f"{rule_id}: {counts[rule_id]} matching line(s) exceed the baseline of {rule['baseline']}"
            )
    if base is not None:
        for rule_id, rule in base.items():
            if rule_id not in current:
                problems.append(f"{rule_id}: rule removed")
            elif current[rule_id]["baseline"] > rule["baseline"]:
                problems.append(
                    f"{rule_id}: baseline raised from {rule['baseline']} to {current[rule_id]['baseline']}"
                )
    return problems


def main() -> int:
    try:
        current = parse_baseline((ROOT / BASELINE_PATH).read_text(encoding="utf-8"))
        base = base_rules(ROOT, os.environ.get(BASE_REF_ENV, ""))
        files = tracked_files(ROOT)
    except (OSError, RatchetError, ValueError) as exc:
        print(f"ratchet: error: {exc}", flush=True)
        return 1
    counts = {rule_id: count_lines(ROOT, rule, files) for rule_id, rule in current.items()}
    for rule_id, rule in current.items():
        count, baseline = counts[rule_id], rule["baseline"]
        note = "" if count == baseline else ("; the baseline can be tightened" if count < baseline else "")
        print(f"ratchet: {rule_id}: {count} line(s), baseline {baseline}{note}", flush=True)
    if base is None:
        print(
            f"ratchet: no base baseline to compare ({BASE_REF_ENV} is unset or its ref has no {BASELINE_PATH})",
            flush=True,
        )
    else:
        print(f"ratchet: baselines compared with {os.environ[BASE_REF_ENV].strip()}", flush=True)
    problems = evaluate(counts, current, base)
    for problem in problems:
        print(f"ratchet: FAIL {problem}", flush=True)
    if problems:
        print(
            "ratchet: failed; a baseline may only go down, explain any other change in the pull request",
            flush=True,
        )
        return 1
    print("ratchet: passed", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [x] 运行：`/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov`。预期 `22 passed`（13 个测试函数，其中 `test_malformed_baseline_is_rejected` 参数化成 10 个）。
- [x] 运行：`/opt/miniconda3/bin/python3 scripts/ci/ratchet.py; echo "exit=$?"`。预期三条规则的实际行数为 2、0、0，末行 `ratchet: passed`，`exit=0`。
- [x] 运行：`.venv/bin/python -m py_compile scripts/ci/ratchet.py tests/test_ci_ratchet.py`，确认 3.12 下能编译（无输出即通过）。

### Task 2 — FR-4、FR-5：接入门禁与 workflow

文件：
- `tests/test_ci_ratchet.py`（Modify：加常量与两个用例）
- `scripts/ci/python-regressions.py`（Modify）
- `.github/workflows/python-regressions.yml`（Modify）

依赖 Task 1。

步骤：

- [x] 改 `tests/test_ci_ratchet.py`，两处。

  (a) `MALFORMED` 列表之后、`_git` 之前插入。before：

```python
    ' {"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": 1}]}',
]


def _git(root: Path, *args: str) -> None:
```

  after：

```python
    ' {"id": "r", "description": "d", "exclude": [], "patterns": ["x("], "baseline": 1}]}',
]
GATE = ratchet.ROOT / "scripts" / "ci" / "python-regressions.py"
# Suites that keep the runtime invariants under test; the gate must keep selecting them.
INVARIANT_SUITES = (
    "tests/test_ci_ratchet.py",
    "tests/test_replay_ledger_upcast.py",
    "tests/test_replay_ledger_payload_summary.py",
    "tests/test_replay_ledger_resume_anchor.py",
    "tests/test_ledger_resume_recovery.py",
    "tests/test_ledger_reattach_stream.py",
    "tests/test_ha_checkpoint_resume.py",
)


def _git(root: Path, *args: str) -> None:
```

  (b) 文件末尾追加两个用例（与上一个用例之间空两行）：

```python
def test_gate_runs_the_ratchet_before_the_tests() -> None:
    """An unusable base ref must stop the gate before any test runs."""
    result = subprocess.run(
        [sys.executable, str(GATE)],
        cwd=ratchet.ROOT,
        env={**os.environ, ratchet.BASE_REF_ENV: "origin/no-such-branch"},
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "ratchet: error: base ref 'origin/no-such-branch'" in result.stdout
    assert "Required dependency imported" not in result.stdout


def test_gate_list_mode_skips_the_ratchet_and_keeps_the_invariant_suites() -> None:
    result = subprocess.run(
        [sys.executable, str(GATE), "--list"],
        cwd=ratchet.ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0
    assert "ratchet:" not in result.stdout
    listed = {line.strip() for line in result.stdout.splitlines()}
    assert set(INVARIANT_SUITES) <= listed
```

- [x] 运行：`/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov -k gate`。预期 2 个失败（约 17 秒，第一个用例会把未改的门禁完整跑一遍）：`test_gate_runs_the_ratchet_before_the_tests` 报 `AssertionError: assert 0 == 1`；`test_gate_list_mode_skips_the_ratchet_and_keeps_the_invariant_suites` 报 `Extra items in the left set:`，列出 `tests/test_ci_ratchet.py`、`tests/test_replay_ledger_upcast.py` 等七个文件。汇总行 `2 failed, 22 deselected`。
- [x] 改 `scripts/ci/python-regressions.py`，四处。只精确增删目标行。

  (a) `TEST_FILES` 末尾。before（`python-regressions.py:30-32`）：

```python
    "tests/tools/test_document_dependency_compatibility.py",
    "tests/test_dependency_crypto_compatibility.py",
)
```

  after：

```python
    "tests/tools/test_document_dependency_compatibility.py",
    "tests/test_dependency_crypto_compatibility.py",
    "tests/test_replay_ledger_upcast.py",
    "tests/test_replay_ledger_payload_summary.py",
    "tests/test_replay_ledger_resume_anchor.py",
    "tests/test_ledger_resume_recovery.py",
    "tests/test_ledger_reattach_stream.py",
    "tests/test_ha_checkpoint_resume.py",
    "tests/test_ci_ratchet.py",
)
```

  (b) `require_dependencies` 之前插入 `run_ratchet()`。before（`python-regressions.py:49-50`）：

```python
def require_dependencies(selected: list[str]) -> None:
    modules = {"pytest", "pytest_asyncio"}
```

  after：

```python
def run_ratchet() -> int:
    # This file runs as a script, so scripts/ci is sys.path[0] and the ratchet
    # module sits next to it.
    import ratchet

    return ratchet.main()


def require_dependencies(selected: list[str]) -> None:
    modules = {"pytest", "pytest_asyncio"}
```

  (c) fakeredis 作为必需依赖。before（`python-regressions.py:53-54`）：

```python
    if "tests/test_dependency_crypto_compatibility.py" in selected:
        modules.add("cryptography")
```

  after：

```python
    if "tests/test_dependency_crypto_compatibility.py" in selected:
        modules.add("cryptography")
    if "tests/test_ha_checkpoint_resume.py" in selected:
        # Its redis case uses importorskip, and check_report rejects any skip.
        modules.add("fakeredis.aioredis")
```

  (d) `main()` 里 ratchet 作为第一步。before（`python-regressions.py:88-91`）：

```python
    if args.list:
        return 0

    for name, value in {
```

  after：

```python
    if args.list:
        return 0

    ratchet_code = run_ratchet()
    if ratchet_code:
        return ratchet_code

    for name, value in {
```

- [x] 改 `.github/workflows/python-regressions.yml`，三处。

  (a) 路径过滤，`pull_request`（`:15-16`）与 `push`（`:29-30`）各一处，两处的 before / after 相同。before：

```yaml
      - "scripts/ci/python-regressions.py"
      - ".github/workflows/python-regressions.yml"
```

  after：

```yaml
      - "scripts/ci/python-regressions.py"
      - "scripts/ci/ratchet.py"
      - "scripts/ci/ratchet-baseline.json"
      - ".github/workflows/python-regressions.yml"
```

  (b) 安装与运行两步。before（`:59-64`）：

```yaml
      - name: Install the branch's locked runtime and test tools
        run: >-
          python -m pip install -r requirements.lock -c requirements.lock
          "pytest==8.4.2" "pytest-asyncio==0.26.0"
      - name: Run the available regression contracts
        run: python scripts/ci/python-regressions.py
```

  after（评审修正后的最终形态：拉取步骤在安装之前，refspec 带 `+`）：

```yaml
      - name: Fetch the target branch for the ratchet baseline comparison
        if: github.event_name == 'pull_request'
        env:
          RATCHET_BASE_BRANCH: ${{ github.base_ref }}
        run: git fetch --no-tags --depth=1 origin "+${RATCHET_BASE_BRANCH}:refs/remotes/origin/${RATCHET_BASE_BRANCH}"
      - name: Install the branch's locked runtime and test tools
        run: >-
          python -m pip install -r requirements.lock -c requirements.lock
          "pytest==8.4.2" "pytest-asyncio==0.26.0"
          "fakeredis==2.41.0" "redis==5.3.1"
      - name: Run the available regression contracts
        env:
          RATCHET_BASE_REF: ${{ github.event_name == 'pull_request' && format('origin/{0}', github.base_ref) || '' }}
        run: python scripts/ci/python-regressions.py
```

- [x] 运行：`/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov -k gate`。预期 `2 passed, 22 deselected`。
- [x] 运行：`/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov`。预期 `24 passed`。
- [x] 运行：`git diff --stat`。预期只有 `scripts/ci/python-regressions.py` 与 `.github/workflows/python-regressions.yml` 两个已跟踪文件被改；workflow 的改动是纯新增 12 行（两处各 2 行、安装行 1 行、拉取步骤 5 行、`env` 2 行）。
- [x] workflow 文件在 push 之前只能静态评审。本地做一次语法检查：

```bash
/opt/miniconda3/bin/python3 -c "import pathlib, yaml; d = yaml.safe_load(pathlib.Path('.github/workflows/python-regressions.yml').read_text()); print(len(d[True]['pull_request']['paths']), len(d[True]['push']['paths']))"
```

  预期输出 `13 13`（YAML 里裸写的 `on` 被解析成布尔键 `True`，所以用 `d[True]`）。

### Task 3 — 回归与端到端自检

文件：无新增，无修改（演示步骤里临时改动的基线文件必须原样恢复）。

依赖 Task 2。

步骤：

- [x] 1. 本机准备 fakeredis（只装进 `/tmp`，不碰 miniconda 的 base 环境）：

```bash
/opt/miniconda3/bin/python3 -m pip install --target /tmp/agx-ci-deps "fakeredis==2.41.0" "redis==5.3.1"
```

- [x] 2. (a) 当前工作树上 ratchet 通过并打印每条规则的实际行数：

```bash
/opt/miniconda3/bin/python3 scripts/ci/ratchet.py; echo "exit=$?"
```

  预期输出：

```
ratchet: ledger-read-bypass: 2 line(s), baseline 2
ratchet: checkpoint-save-bypass: 0 line(s), baseline 0
ratchet: resume-anchor-bypass: 0 line(s), baseline 0
ratchet: no base baseline to compare (RATCHET_BASE_REF is unset or its ref has no scripts/ci/ratchet-baseline.json)
ratchet: passed
exit=0
```

- [x] 3. (a 续) 整条门禁在本机跑通（ratchet 是第一行输出，其后才是依赖检查与 pytest）：

```bash
PYTHONPATH=/tmp/agx-ci-deps:"$PWD" /opt/miniconda3/bin/python3 scripts/ci/python-regressions.py; echo "exit=$?"
```

  预期：先出现步骤 2 的五行 ratchet 输出；随后有 `Required dependency imported: fakeredis.aioredis`；pytest 汇总 `242 passed`（原有 165 + 01 的 41 + HA 的 12 + ratchet 的 24），`Executed 242 regression cases with no skips`，`exit=0`，全程约 10 秒。若唯一失败的是 `test_waiting_hint_sentinel`，原样重跑一次并注明（核实 10）。
- [x] 4. (b) 本地演示「实际行数超基线 → 失败」。把规则 1 的基线临时调成 1，实际仍是 2：

```bash
cp scripts/ci/ratchet-baseline.json /tmp/ratchet-baseline.keep.json
/opt/miniconda3/bin/python3 - <<'EOF'
from pathlib import Path

path = Path("scripts/ci/ratchet-baseline.json")
text = path.read_text(encoding="utf-8")
assert text.count('"baseline": 2') == 1
path.write_text(text.replace('"baseline": 2', '"baseline": 1'), encoding="utf-8")
EOF
/opt/miniconda3/bin/python3 scripts/ci/ratchet.py; echo "exit=$?"
PYTHONPATH=/tmp/agx-ci-deps:"$PWD" /opt/miniconda3/bin/python3 scripts/ci/python-regressions.py > /tmp/gate-demo.log 2>&1; echo "exit=$?"; tail -3 /tmp/gate-demo.log
cp /tmp/ratchet-baseline.keep.json scripts/ci/ratchet-baseline.json
cmp /tmp/ratchet-baseline.keep.json scripts/ci/ratchet-baseline.json && echo restored
```

  预期：直接运行时输出 `ratchet: ledger-read-bypass: 2 line(s), baseline 1`、`ratchet: FAIL ledger-read-bypass: 2 matching line(s) exceed the baseline of 1`，`exit=1`。经门禁运行时退出码 1，`tail -3` 恰好是三行：`ratchet: no base baseline to compare (...)`、`ratchet: FAIL ledger-read-bypass: 2 matching line(s) exceed the baseline of 1`、`ratchet: failed; a baseline may only go down, explain any other change in the pull request`；日志里没有任何 `Required dependency imported`，说明门禁在 ratchet 处就停下、没有跑 pytest。最后一行输出 `restored`。

- [x] 5. (c) 本地演示「基线调大 → 失败」。main 上还没有基线文件，所以提交前由单测证明，命令与预期：

```bash
/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov -k "raised_baseline or removed_rule or target_branch_without or new_rule or lowered_baseline"
```

  预期 `5 passed`。对应关系：`test_raised_baseline_fails_against_the_target_branch`（调大即失败）、`test_removed_rule_fails_even_when_the_counts_fit`（删规则即失败）、`test_new_rule_is_allowed_but_ratcheted`（新规则允许但受约束）、`test_target_branch_without_a_baseline_file_only_gets_the_count_check`（目标分支没有基线文件时只做常规检查，即本 PR 自己的情形）、`test_lowered_baseline_passes_against_the_target_branch`（调小通过）。

- [x] 6. (d) 01 的相关测试回归，带 fakeredis：

```bash
PYTHONPATH=/tmp/agx-ci-deps:"$PWD" /opt/miniconda3/bin/python3 -m pytest tests/test_replay_ledger_store.py tests/test_replay_ledger_recorder.py tests/test_run_context_checkpoint.py tests/test_run_replay_api.py tests/test_run_replay_export.py tests/test_run_branch_service.py tests/test_run_branch_api.py tests/test_run_workspace_snapshot.py tests/test_ha_checkpoint_resume.py tests/test_smoke_interrupted_closers.py tests/test_runtime_interrupted_stream.py tests/test_smoke_session_event_hub.py tests/test_smoke_group_reattach_hub.py tests/test_session_manager_persistence.py tests/test_enterprise_trace.py tests/test_replay_ledger_upcast.py tests/test_replay_ledger_payload_summary.py tests/test_replay_ledger_resume_anchor.py tests/test_ledger_resume_recovery.py tests/test_ledger_reattach_stream.py -q --no-cov
```

  预期 `325 passed`（01 实施后的 324 passed, 1 skipped，加上 fakeredis 后那个 redis 用例也执行了）。
- [x] 7. (e) 范围核对：

```bash
git status --short | grep -v -E "^\?\? "
git status --short -- scripts tests .github
```

  预期：第一条只剩改动前就有的 ` M examples/agenticx-for-finance/FinnewsHunter`；第二条恰好五行，即 ` M .github/workflows/python-regressions.yml`、` M scripts/ci/python-regressions.py`、`?? scripts/ci/ratchet-baseline.json`、`?? scripts/ci/ratchet.py`、`?? tests/test_ci_ratchet.py`。其余无关的未跟踪文件一个都没动、没 add。
- [x] 8. 三条门禁自检，与 ratchet 的输出对照：

```bash
git grep -n -F -e 'run_dir / "events.jsonl"' -e 'runs/*/events.jsonl' -- agenticx | grep -v "agenticx/runtime/replay_ledger/"
git grep -n "save_agent_state(" -- agenticx | grep -v -e "agenticx/runtime/checkpoint.py" -e "agenticx/studio/storage/"
git grep -n -F "project_resume_anchor(" -- agenticx | grep -v -e "agenticx/runtime/replay_ledger/" -e "agenticx/runtime/checkpoint.py"
```

  预期：第一条 2 行（`session_perf.py:37`、`diagnose_traces.py:42`），第二、三条为空。

## 实施后评审处置

实施完成、主会话独立验收通过后，由一位独立评审员做代码质量评审，主会话逐条核实后处置如下。

| 评审意见 | 处置 | 落点 |
| --- | --- | --- |
| `git show` 任何非零退出都当成「目标分支没有基线」，读失败会静默降级成只查行数，与「绝不静默放行」矛盾 | 采纳：先用 `git cat-file -e <ref>:<path>` 判断路径是否存在，不存在才跳过比较；随后的 `show` 失败一律报错退出 | `ratchet.py` 的 `base_rules()`；`test_unreadable_base_baseline_fails_loudly` |
| refspec 缺 `+`，`refs/remotes/origin/<base>` 已存在时目标分支前进会被拒（non-fast-forward） | 采纳：加 `+`。托管 runner 每次是新工作区，现在触发不了，但零成本 | workflow 拉取步骤 |
| 拉取步骤在 pip install 之后，ratchet 失败要白等安装 | 采纳：前移到安装步骤之前 | workflow 步骤顺序 |
| 符号链接被跟随并计数，还会读到 `agenticx/` 之外的文件，与 `git grep` 不一致 | 采纳：`is_symlink()` 跳过 | `ratchet.py` 的 `count_lines()`；计数用例改为断言已跟踪的符号链接不计数 |
| `test_missing_baseline_file_fails_loudly` 只断言 `ratchet: error: `，任何错误都能过 | 采纳：加断言，报错必须含基线文件名 | 同名用例 |
| `.pyc` 断言从未 `git add`，空转 | 采纳：删掉，换成符号链接断言 | `test_counts_each_matching_line_once_over_tracked_files_only` |
| `paths` 只列 `agenticx/**/*.py`，扫描的却是 `agenticx/` 全部已跟踪文件，建议放宽 | 不采纳：技能文档改动会触发整套回归，既有的偶发用例会给无关 PR 挂红。缺口列入风险表 | 风险表新增一行 |
| 合并冲突中的路径会按 stage 重复列出，本地多计 | 不采纳：只在本地冲突合并时出现，CI 的检出没有冲突；多计的方向是变红不是放行 | 无 |
| `save_agent_state (`（带空格）、`_EVENTS_NAME = "events.jsonl"` 间接写法不命中 | 不采纳：字面匹配的固有盲区，风险表已有同类说明；后者是安全审计日志，不是旁路 | 无 |

评审修正后复跑（2026-11-28，解释器 `/opt/miniconda3/bin/python3`）：`tests/test_ci_ratchet.py` 25 passed；门禁 243 passed、无 skip；workflow 仍为纯新增 12 行。另在临时仓库里按 workflow 原样模拟了 CI 链路（只含 PR 分支的深度 1 克隆，拉取目标分支，再运行 ratchet）：基线调大报 `baseline raised from 2 to 3`、退出码 1；新增旁路报 `checkpoint-save-bypass: 1 matching line(s) exceed the baseline of 0`、退出码 1；目标分支没有基线文件时只做常规检查并通过；`RATCHET_BASE_REF` 为空串时只做常规检查；不带 `+` 的拉取在目标分支前进后被拒，带 `+` 正常。

## 交付约定

- 实施者（subagent）只改本 plan 列出的五个文件，不改 `agenticx/` 下任何文件，不提交、不推送、不动分支；每条验证命令连同实际输出原样贴回。
- **实现与本 plan 一致但测试仍失败时，停下报告，不许改断言、不许改被统计的代码来让数字变小。** 唯一例外是核实 10 记录的 `test_waiting_hint_sentinel` 偶发失败：原样重跑一次并注明。
- 演示步骤 (b) 临时改过的基线文件必须用备份原样恢复，并以 `cmp` 的输出为证。
- 主会话独立复跑 Verification 的命令、审 diff、核对范围：`git status --short` 里不得出现本 plan 之外的文件。
- 验收通过后由主会话把本文件从 `.cursor/plans/pending/` 移到 `.cursor/plans/`，`Status` 改为 `implemented`，只 `git add` 本 plan 的文件，提交一个 commit。
- 提交后主会话做 (c) 的真实仓库演示：

```bash
cp scripts/ci/ratchet-baseline.json /tmp/ratchet-baseline.keep.json
/opt/miniconda3/bin/python3 - <<'EOF'
from pathlib import Path

path = Path("scripts/ci/ratchet-baseline.json")
text = path.read_text(encoding="utf-8")
assert text.count('"baseline": 2') == 1
path.write_text(text.replace('"baseline": 2', '"baseline": 3'), encoding="utf-8")
EOF
/opt/miniconda3/bin/python3 scripts/ci/ratchet.py > /tmp/ratchet-demo.log 2>&1; echo "exit=$?"; tail -2 /tmp/ratchet-demo.log
RATCHET_BASE_REF=HEAD /opt/miniconda3/bin/python3 scripts/ci/ratchet.py; echo "exit=$?"
cp /tmp/ratchet-baseline.keep.json scripts/ci/ratchet-baseline.json
git status --short -- scripts/ci
```

  预期：不带目标分支时末行是 `ratchet: passed`、退出码 0（这就是只比行数的漏洞）；带 `RATCHET_BASE_REF=HEAD` 时出现 `ratchet: baselines compared with HEAD`、`ratchet: FAIL ledger-read-bypass: baseline raised from 2 to 3`、`ratchet: failed; ...`，`exit=1`；最后一条命令无输出。
- 提交标题：`feat(ci): add an invariant ratchet to the Python regression gate`。正文用 `## What & Why` 与 `## Requirements`（FR/AC）两节，要点如下：

  - FR-1：ratchet 核心。基线文件加脚本，对 `agenticx/` 下已跟踪文件做逐行字面匹配，实际行数超过基线即失败。
  - FR-2：与目标分支基线比较。`RATCHET_BASE_REF` 指向的基线被调大或规则被删即失败；新增规则允许但同样受约束；目标分支没有基线文件时只做常规检查；ref 不可用时报错。
  - FR-3：三条启动规则。`ledger-read-bypass`（基线 2）、`checkpoint-save-bypass`（基线 0）、`resume-anchor-bypass`（基线 0）。
  - FR-4：接入。ratchet 是 `python-regressions` 的第一步，`--list` 不跑；workflow 的路径过滤补两个文件，PR 事件下拉取目标分支。
  - FR-5：回归选择加 01 的五个测试文件、HA 检查点测试与 ratchet 自测；fakeredis 与 redis 钉版本并列为必需依赖。
  - AC-1：当前工作树 ratchet 通过，三条规则实际行数 2、0、0。
  - AC-2：`tests/test_ci_ratchet.py` 25 个用例通过；本机门禁 243 passed、无 skip。
  - AC-3：实际行数超基线、基线调大两种情形本地演示均失败。
  - AC-4：改动只落在 `scripts/ci/`、workflow 与一个测试文件，`agenticx/` 未动。

## Suggested impl models

- GLM-5.4：落点精确到行、三个新文件的完整内容已给出且在 HEAD 的镜像上全部跑通过，属于按图施工的小体量改动。唯一不能本地验证的是 workflow，靠静态评审与 YAML 语法检查兜底。

## Verification

下文的预期分两类：改动前的基线与 01 的回归是在本仓库 HEAD 上实测的；02 落地后的输出是在一个临时镜像上实测的（用 `git archive HEAD` 导出 `agenticx/`、相关测试与 `pyproject.toml`，应用本 plan 的全部代码后跑出来的），数字与真实仓库一致。

实施后复跑（2026-11-28，解释器 `/opt/miniconda3/bin/python3`）：Task 1–3 各命令全部通过；评审修正后 `tests/test_ci_ratchet.py` 25 passed，门禁 243 passed、无 skip；三条门禁 grep 为 2 行、空、空；CI 链路的临时仓库模拟见「实施后评审处置」。下文保留计划原文的命令与预期。

**基线**（改代码之前先跑一遍，确认为绿）：

| 命令 | 实测 |
| --- | --- |
| `/opt/miniconda3/bin/python3 scripts/ci/python-regressions.py` | `165 passed, 5 warnings in 6.39s`，`Executed 165 regression cases with no skips` |
| 01 的 20 文件回归（Task 3 步骤 6 的命令，不带 `PYTHONPATH`） | `324 passed, 1 skipped, 1 warning in 15.76s` |
| 三条门禁自检（Task 3 步骤 8） | 2 行、空、空 |

**各任务命令**：

| 任务 | 命令 | 预期 |
| --- | --- | --- |
| Task 1 红 | `/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov` | 收集阶段 `ModuleNotFoundError: No module named 'ratchet'` |
| Task 1 绿 | 同上 | `22 passed` |
| Task 1 | `/opt/miniconda3/bin/python3 scripts/ci/ratchet.py` | 三行实际行数 2 / 0 / 0，`ratchet: passed` |
| Task 2 红 | `/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov -k gate` | `2 failed, 22 deselected` |
| Task 2 绿 | 同上 | `2 passed, 22 deselected` |
| Task 2 | `/opt/miniconda3/bin/python3 -m pytest tests/test_ci_ratchet.py -q --no-cov` | `24 passed` |
| Task 3 | Task 3 步骤 2–8 | 见各步骤 |

**闭环判据逐条对应**（master plan Verification 第 5 条与总览表 02 的「闭环」列）：

| 判据 | 自动化验证 | 手工验证 |
| --- | --- | --- |
| 把基线调大，CI 失败 | `test_raised_baseline_fails_against_the_target_branch`、`test_removed_rule_fails_even_when_the_counts_fit`、`test_new_rule_is_allowed_but_ratcheted`、`test_target_branch_without_a_baseline_file_only_gets_the_count_check` | 提交后主会话用 `RATCHET_BASE_REF=HEAD` 在真实仓库演示；CI 里的第一次观察要等本提交合入后的下一个 PR（核实 10） |
| 超出基线即失败 | `test_fails_when_the_count_exceeds_the_baseline`、`test_gate_runs_the_ratchet_before_the_tests` | Task 3 步骤 4 |
| 只减不增的口径与 `git grep` 一致 | `test_counts_each_matching_line_once_over_tracked_files_only` | Task 3 步骤 2 与步骤 8 的输出对照 |

**本机能跑通门禁的命令**：只有 `/opt/miniconda3/bin/python3` 能跑 `scripts/ci/python-regressions.py`（核实 5）。02 落地后本地需要 fakeredis，用 Task 3 步骤 1 的方式装到 `/tmp`，再按步骤 3 的 `PYTHONPATH` 运行。`.venv` 缺 pytest 与三个解析库，不能用于本 plan 的任何验证。

## 风险与回滚

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| workflow 文件在 push 之前只能静态评审 | 拉取步骤或表达式写错，要到第一个 PR 才发现 | 改动是纯新增；YAML 语法用 Task 2 的命令本地检查；拉取用的 refspec 已在临时仓库里模拟过（核实 4）。出错时的表现是 `ratchet: error: base ref ... is not a commit`，门禁变红而不是放行 |
| `patterns` / `exclude` 被改写不受机器校验 | 把模式改成永远匹配不上，行数归零、基线不动，检查通过 | 已知局限。基线文件的改动会触发 workflow（路径已补），但语义只能靠 PR 评审；每条规则的 `description` 写明了它保护什么，评审时对照 |
| 实际行数小于基线 | 基线逐渐松弛，ratchet 变松 | 通过，并打印 `; the baseline can be tightened`。收紧基线永远允许（调小不触发比较失败） |
| 本 PR 自己在 CI 里没有目标分支基线可比 | 「调大变红」在本 PR 的 CI 上看不到 | 合入前用单测与本地演示证明；合入后的第一个 PR 起生效。主会话验收时知晓这一点 |
| push 事件不做基线比较 | 直接推到 main 的提交调大基线不会被比较拦住，只受「行数 ≤ 基线」约束 | 与 PR 事件同样的常规检查仍在；目标分支若受保护、只接受 PR，则不构成缺口 |
| 规则 3 的字面量只盯一个函数名 | 别名导入后调用点不再命中：导入行写的是 `import project_resume_anchor as p`，函数名后面跟的不是 `(`；调用点写成 `p(`。两处都不命中 | 已知局限。靠 PR 评审与 01 的测试兜底 |
| 既有用例 `test_waiting_hint_sentinel` 偶发失败 | CI 可能因为这个用例变红，被误读成 ratchet 失败 | 与 02 无因；失败时看倒数第二行是否有 `ratchet: FAIL`，没有就不是 ratchet。不在 02 里修 |
| 触发路径只含 `agenticx/**/*.py`，扫描范围是 `agenticx/` 全部已跟踪文件 | 只改 `.md`、`.cjs` 等非 Python 文件新增的旁路，要等下一次有 `.py` 改动的 PR 才被发现 | 已知局限，不放宽（已定案事项 13）：放宽后技能文档改动也会跑整套回归，既有的偶发用例会给无关 PR 挂红 |
| 01 的回归并入 CI 后多依赖 fakeredis 与 redis | CI 多装三个纯 Python 包；版本写死在 workflow 里，将来升级要改 workflow | 与 pytest 的钉法一致；两个版本都在 `pyproject.toml` 声明的范围内 |
| PR 分支落后于目标分支上一次基线收紧 | 分支上的旧基线比目标分支的新基线大，比较失败 | 把目标分支合进来即可。这是 ratchet 的预期行为 |
| 门禁被同一个 PR 改掉 | workflow、基线、脚本都在仓库里，PR 可以把它们一起删掉 | 门禁防的是无心之失，不是恶意改动；后者靠分支保护与评审 |

回滚：

- 代码回滚：回退本提交即可。02 没有运行时改动，`agenticx/` 一行未动，没有数据或配置需要撤销。
- 临时绕过某条规则：不要加开关。规则确实需要放宽时，在 PR 里说明理由并调大基线——比较逻辑会让这个 PR 变红，评审者据此判断是否接受；这是设计本意。

## 已定案事项

主会话已定、实施时不再询问：

1. **「基线调大 → CI 变红」靠与目标分支的基线比较实现**；规则被删同样失败；新增规则允许但受约束；目标分支没有基线文件时只做常规检查。
2. **`pull_request` 与 `push` 两处 `paths` 都加 ratchet 的两个文件**；PR 事件下用显式 refspec 拉取目标分支。
3. **ratchet 在 `python-regressions.py` 里作为第一步运行，`--list` 不跑**；用 `import ratchet`。
4. **匹配口径**：逐行、字面、大小写敏感，统计行数；扫描范围与 `git grep` 完全一致。
5. **测试文件含被统计的字面量不处理。**
6. **六个测试文件接进 CI 回归**，依赖在 workflow 里钉版本。
7. **给 01 接一条规则**（核实 9 的结论）。

规划时在授权范围内定的、主会话审查本 plan 时可否决：

8. 传参用环境变量 `RATCHET_BASE_REF`，不用 CLI 参数（核实 4 的理由）。
9. 文件枚举用 `git ls-files`，不用纯 Python 遍历（核实 6 的理由）。
10. 第三条规则取 `project_resume_anchor(`，其余候选不接。
11. 扫描根固定为 `agenticx/`，schema 不设 `scan` 字段；不提供跳过开关。
12. 新测试文件命名 `tests/test_ci_ratchet.py`。

主会话审查已定（2026-11-28，实施时不再询问）：

13. **不放宽触发路径**，`agenticx/**/*.py` 保持原样。能破坏这几条不变量的改动只会出现在 Python 代码里；技能里的非 Python 文件改动每触发一次就多跑一轮回归，不值。缺口保留在风险表里。
14. **fakeredis 与 redis 钉在 workflow 的安装行里**，不另生成锁文件，与 pytest 的既有做法一致。`requirements.lock` 没有 redis 与 fakeredis，作为约束文件不会与新钉的版本冲突。

## 主会话审查记录

2026-11-28 独立复核，全部在 HEAD `f22f5311` 上实测：

- 三条门禁 grep：2 行（`session_perf.py:37`、`diagnose_traces.py:42`）、空、空。`project_resume_anchor(` 全仓恰好 2 处（`checkpoint.py:179`、`resume_anchor.py:83`）。`agenticx/` 下已跟踪文件 1404 个。
- 新接进的七个测试文件只依赖 `pytest`、`httpx`（`requirements.lock:120` 钉 0.28.1）与 `agenticx` 自身；标记只有 `parametrize`，`--strict-markers` 下不会报错；唯一的 skip 是 `tests/test_ha_checkpoint_resume.py:52` 的 `importorskip`，由 fakeredis 依赖解决。既有 15 个 CI 用例文件都不涉及 redis，多装 `redis` 不会改变它们的行为。
- 已定案事项第 8–12 条按规划执行，第 13–14 条为审查时拍板。

## Commit trailers

```
Plan-Id: 2026-11-27-runtime-invariants-02-invariant-ratchet
Plan-File: .cursor/plans/2026-11-27-runtime-invariants-02-invariant-ratchet.plan.md
Plan-Model: GLM-5.4
Impl-Model: GLM-5.4
Made-with: Damon Li
```
