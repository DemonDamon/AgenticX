# AgenticX 新增能力与定制项目的关系

本文件记录 1.2.0 之后官方新增、会影响「项目怎么建、问题归哪」的能力。核对日期：2026-11-23；核对对象：官方 `main` 源码与 PyPI 上的 `agenticx==0.6.5`。

这些事实会过时。用之前先跑 `doctor`，以它的探测结果为准，不要照抄本文件里的版本号。

## 1. 版本号相同，不代表命令相同

PyPI 上的 `0.6.5` 发布包和官方 `main` 源码的版本号都是 `0.6.5`，但发布包里还没有 `agx case` 和 `agx harness-surface`。所以只看 `agx --version` 判断不了能力。

```bash
python3 scripts/custom_project.py doctor
```

`doctor` 会逐个运行 `agx case --help`、`agx harness-surface --help`，并打印「可用」或「当前安装里没有」。显示没有时：

- `depend` 模式的用户：等官方发布新版本，或者不用这条能力。不要为了一条命令改成分叉。
- 必须现在就用：按 `--mode fork` 走源码安装，客户业务仍放另一个仓库。

## 2. 案例库：从已有交付起项目，交付后再沉淀

| 命令 | 做什么 | 会不会联网 |
| --- | --- | --- |
| `agx case search "关键词"` | 在本地案例库里按关键词找 | 不联网；加 `--remote` 才查云端 |
| `agx case init --case <case_id> --target <空目录>` | 用一个案例生成新项目的 `plan.mdc` 和相关产物 | 默认读本地；`--remote` 才从云端取 |
| `agx case compile --plan <plan.mdc>` | 把这次交付的计划整理成案例条目，默认写到 `./cases` | 不联网；加 `--push` 才上报云端 |

云端地址来自 `--url` 或环境变量 `AGX_CONTEXT_SERVICE_URL`，令牌来自 `--token` 或 `AGX_CONTEXT_SERVICE_TOKEN`。不要把令牌写进命令历史或仓库，用环境变量。

规则：

- `case init` 的目标目录必须为空或不存在。已有文件就换目录，不要清空用户的目录。
- 案例内容属于业务仓库。用 `classify --kind docs --where business` 判断，结论是留在本仓。
- **`--push` 之前必须得到用户明确授权**，并确认条目里没有客户名称、内网地址、密钥和真实业务数据。没授权就只落本地，告诉用户「已在本地生成，尚未上报」。
- `--push` 失败时本地条目会保留。照实说尚未上报，不要说已经同步。

## 3. 多引擎：同一会话切换 AgenticX、Claude Code、CodeBuddy、Codex

Near 现在可以在同一个会话里切换执行引擎。`agx harness-surface list` 会列出本机注册了哪些引擎、各自能不能用。

问题归哪：

| 现象 | `--where` |
| --- | --- |
| 引擎桥接、控制面、切换后上下文没接上 | `harness`（等同 `runtime`） |
| Near 里的切换按钮、登录提示、子任务卡片显示不对 | `desktop` |
| 第三方命令行工具自身的 bug | 不是 AgenticX 的问题。不要给官方开 Issue，反馈给那个工具的维护方 |

## 4. 移动端与浏览器扩展

官方仓库新增了两块：

- `mobile/`：手机端应用，用来和本机 Near 配对、查看会话。
- `extension/`：浏览器扩展，把选中文字或整页发给会话，也让智能体在浏览器里打开页面、提取、填表、截图。

这两块还没写进官方贡献说明的仓库地图。贡献说明要求改动面不清楚时先在 Issue 里确认，所以：

```bash
python3 scripts/custom_project.py classify --kind bug --where client --cause-clear yes --size small
```

结论是先开 Issue，维护者同意后加 `--maintainer-agreed yes` 再判断。客户自己的换皮或私有接入不算这里，用 `--where business`。

## 5. 企业账号下的运行记录回流

Near 登录企业账号后，会向企业管理台回传运行指标：耗时、Token、工具名和状态，默认不含对话内容。只有企业在管理台开启对话摘录时，才会附上提问、回复和推理各前 500 字。

用户可以在 Near 的「设置 → 用户账号」里，企业账号卡片上的「运行记录回流」开关暂停。暂停期间的记录不会上传，之后也不会补传。

对定制项目的影响：

- 用真实客户材料调试前，先问用户当前 Near 是否登录了企业账号、企业是否开启了对话摘录。
- 本技能和 `custom_project.py` 不读取、不修改这个开关。需要暂停时让用户自己在界面里操作。
- 回流本身的问题（该暂停却还在传、摘录范围不对）按 `--kind security` 判断：开关界面用 `--where desktop`，上传内容的裁剪用 `--where runtime`。公开文字不写客户内容。
