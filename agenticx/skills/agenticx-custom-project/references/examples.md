# 使用案例

下面每段都是可以照着做的。命令里的 `python3`，在 Windows 上改成 `py -3`，斜杠改成反斜杠。优先复制脚本按当前系统打印出来的那一行。

官方仓库固定是 `https://github.com/DemonDamon/AgenticX`。示例版本 `0.6.5` 只代表写作时的上游版本，以用户机器上的 `agx --version` 为准。

## 1. 不改框架，用 Python 做一个客户项目

用户说：我们要做一个内部审批助手，规则是客户自己的，不想维护 AgenticX 源码。

```bash
python3 scripts/custom_project.py doctor
python3 scripts/custom_project.py plan --mode depend --stack python --name approval-helper
python3 scripts/custom_project.py plan --mode depend --stack python --name approval-helper --write --dir /你的空目录
```

你会看到的结论是：新建业务仓库，用官方发布包装上 AgenticX，不要克隆框架源码。

`--write` 会生成 `README.md`、`AGENTS.md`、`requirements.txt`、`main.py`、`.env.example` 和 `.gitignore`。`.env.example` 里的密钥是空的。目录里如果已经有文件，命令会停下来，不会覆盖。

接下来才是：

```bash
agx project create approval-helper --template basic
```

若它问「目录已存在，是否覆盖」，回答否。`--template enterprise` 只是一个带监控示例的应用骨架，不是官方仓库里的 `enterprise/` 目录。

客户的审批规则以后都留在这个仓库。判断时用 `--where business --others-need no`。

## 2. 别的语言调用本机运行时

用户说：前端是 Node，只想调用已经装好的 AgenticX，不想把 Python 源码拷进前端仓库。

```bash
python3 scripts/custom_project.py plan --mode depend --stack node --name portal-ui --write
```

骨架里的 README 会要求用户自己打开端口文件：

- macOS / Linux：`~/.agenticx/serve.port`
- Windows：`%USERPROFILE%\.agenticx\serve.port`

技能不读取这个文件，因为旁边有令牌。检查服务时用：

```bash
curl --noproxy "*" http://127.0.0.1:端口/api/session
```

Windows 10 及以上自带 curl。连接失败时，先确认 `agx serve` 或 Near 已经启动，不要先改业务代码。

## 3. 只用桌面，不开发

```bash
python3 scripts/custom_project.py plan --mode depend --stack desktop --name unused
```

结论是安装官网的 macOS 或 Windows 安装包，不创建仓库。地址是 `https://www.agxbuilder.com/`。只有要改桌面源码时才改用 `--mode fork --stack desktop`。

## 4. 必须改源码时才分叉

用户说：我们要改运行时，并且每个月跟一次官方版本。客户界面不放进这个仓库。

```bash
python3 scripts/custom_project.py plan --mode fork --stack python --name agenticx-fork
```

脚本会打印 `git clone`、把 `origin` 改名为 `upstream`、再添加你们自己的 `origin`。它不会替你执行这些命令，也不会改现有 remote。

不要 `git push upstream`，不要把客户业务写进这个克隆。业务仓库仍用案例 1。

## 5. 原因清楚的小 bug

用户说：桌面多窗格切换模型会串到另一格，已经确认是选中状态用了全局变量。

```bash
python3 scripts/custom_project.py classify \
  --kind bug --where desktop --cause-clear yes --size small
```

```text
结论：先在当前仓库修，现在不必给官方提 PR。
原因：根因已经明确的小缺陷，默认在当前仓库修并做定向验证，包括共享运行时里的小修。
上游核对：这次不需要。
业务交付：可以继续，不必等官方合并。
```

内部标记是 `action=local-fix`，`issue=no`，`pr=no`。不要再去搜索 GitHub。修完只跑和这次改动有关的测试。

Windows 上同一条判断：

```bat
py -3 scripts\custom_project.py classify --kind bug --where desktop --cause-clear yes --size small
```

## 6. 还没查清原因

用户说：保存之后会话标题有时会变，但不知道是哪一次写入坏的。

```bash
python3 scripts/custom_project.py classify \
  --kind bug --where runtime --cause-clear 不清楚 --size small --others-need 不需要
```

结论是：先在当前仓库把原因查清，先不要找官方。没有复现步骤时不要开一个空 Issue。查清后再跑一次。若变成「原因明确的小修」，就留在本仓。

## 7. 大家都能用的新能力，还没看官方

用户说：想给所有 AgenticX 用户加一个工具超时后的明确错误，不只是我们这家的审批流。还没看官方有没有。

```bash
python3 scripts/custom_project.py classify \
  --kind feat --where runtime --others-need yes --upstream-has unknown
```

结论是：先只核对相关目录、对应测试和标题能对上的 Issue。不要翻全历史。核对之后：

- 官方已有：`--upstream-has yes`，结论变成升级或最小移植。
- 官方没有：`--upstream-has no`，结论变成拆开。通用部分提 PR，审批流留在业务仓。

业务部分可以先做，不必等 PR 合并。

若这一步上不了网，草稿里写「尚未对照最新上游」。不能写成「已经确认官方没有」。

## 8. 门户或网关的问题

用户说：管理台里的配额数字和一次调用对不上，想直接改 `enterprise/` 提 PR。

```bash
python3 scripts/custom_project.py classify --kind bug --where enterprise --cause-clear yes --size small
```

```text
结论：给官方开 Issue。现在不要提 PR。
原因：官方仓库里的 enterprise/（员工门户、管理台、Go 网关）不接受事先没有约定的外部 PR。
```

即使用户已经知道改哪一行，也是 Issue。只有维护者在 Issue 里同意后，才把 `--maintainer-agreed yes` 再跑一次，那时才允许 PR。

Issue 里不要写部署路径、内网地址和客户环境。

## 9. 用户不会改代码，只想反映问题

用户说：Near 里这个按钮点了没反应，我不会改源码，帮我告诉官方。

```bash
python3 scripts/custom_project.py classify \
  --kind bug --where desktop --can-fix no --cause-clear no
```

结论是开 Issue，不要求克隆仓库，也不要求先搜遍源码。然后用 `draft --kind issue` 把现象、期望、系统版本写进去。复现用合成操作，不要贴真实聊天记录。

## 10. 草稿、密钥和「还没提交」

正确的草稿命令：

```bash
python3 scripts/custom_project.py draft \
  --kind issue \
  --title "切换会话后标题变回数字" \
  --summary "从别的会话跳回来，中文标题变成了一串数字。" \
  --expected "仍显示原来的标题。" \
  --actual "显示 session id。" \
  --steps "1. 新建一个只有合成内容的会话。2. 切走再切回来。" \
  --version "0.6.5" \
  --os-name "Windows 11" \
  --python-version "3.12"
```

成功时会打印草稿路径，并写明「状态：尚未提交」。

若摘要里把密码写成了等号后面的具体内容，命令退出码是 3，文件不会写下来。报错类似：

```text
草稿里有不能公开的内容，文件没有写入，也没有提交。
- 第 7 行：密钥赋值
```

它不会把那串密钥再打印出来。删掉那一行再运行。

还没核对官方就想创建 PR 时：

```bash
python3 scripts/custom_project.py submit \
  --want pr \
  --title "feat(runtime): 示例" \
  --body-file .agenticx-upstream/ISSUE.md \
  --kind feat --where runtime --others-need yes --upstream-has unknown
```

输出以「尚未提交」开头，并说明当前结论不能创建 PR。加上 `--execute` 也不会绕过这道门。GitHub 打不开或没有 `gh` 时同样是尚未提交，可以把草稿交给能打开网页的人，地址是 `https://github.com/DemonDamon/AgenticX/issues/new`。

## 11. 安全问题出在业务仓库

用户说：我们自己的 `.env` 被提交进了业务仓库。

```bash
python3 scripts/custom_project.py classify --kind security --where business
```

结论是留在本地处理：轮换密钥、从业务仓库历史里去掉。不要开公开 Issue，也不要在对话里重复那串密钥。官方仓库的安全问题才用 `--where runtime` 或 `--where desktop`，公开文字仍不写密钥和利用步骤。

## 12. 领域 Demo：不改框架的最小本体推理闭环（合成数据）

用户说：「用 AgenticX 做一个最小本体推理 Demo，不改框架，要能 query、infer，最好有个浏览器页面。」

第一步，初始化按 depend 模式：

```bash
python3 scripts/custom_project.py doctor
python3 scripts/custom_project.py plan --mode depend --stack python --name ontology-reasoner
python3 scripts/custom_project.py plan --mode depend --stack python --name ontology-reasoner --write --dir /你的空目录
```

结论是：新建业务仓，pip 装官方发布包（示例 `agenticx==0.6.5`，以 `agx --version` / PyPI 为准），**不克隆官方源码**。目录已非空时不要强跑 `agx project create` 覆盖，手工对齐 basic 脚手架精神即可。

第二步，业务仓里自研闭环，分层示意（路径可改名）：

| 路径 | 职责 |
| --- | --- |
| `services/ontology_core/` | 内存本体：概念、属性、关系；JSON 持久化 |
| `services/reasoner/` | 简单规则：传递 `is_a`、沿 `is_a` 继承属性、证据链 |
| `services/agent_bridge/` | 用 `agenticx.FunctionTool` 包装 `ontology_query`、`ontology_infer` |
| `scripts/demo_loop.py` | 不联网一键：写样例 → query → infer → 校验 |
| `tests/test_min_loop.py` | 无网单测 |
| `services/api/` + `apps/portal/` | 可选：FastAPI + 中文单页 Demo UI |

样例公理用合成概念，例如 `Manager is_a Employee`、`Employee is_a Person`，推理应得到 `Manager is_a Person`（传递闭包）。不写客户名、不贴真实标书内容。

```bash
.venv/bin/python scripts/demo_loop.py
```

退出码 `0` 打印 query / infer 结果并校验传递闭包即闭环成立；装了 agx 时可再经 `FunctionTool.run` 调用一轮。未装 agx 时桥接返回空工具列表，纯 Python 部分照常可跑。

第三步，可选 Demo UI：

```bash
.venv/bin/uvicorn services.api.app:app --host 127.0.0.1 --port 8765
```

`http://127.0.0.1:8765/` 是**启动服务那台机器**上的环回地址。服务跑在助手桌面（远程电脑）时，用户笔记本打不开它；让助手在他的桌面浏览器打开或截图展示。Demo UI 不是全量门户，无鉴权、无多租户，只用于本地看闭环。

第四步：用户嫌页面丑，想换皮。**不要**把设计技能的正文并进 `agenticx-custom-project`；另装一个独立的设计类技能（SkillHub 发现、经用户确认后安装），在业务仓里重做 `apps/portal`。判断仍是：

```bash
python3 scripts/custom_project.py classify --kind style --where business
```

结论是留在业务仓，不提上游 PR，也不改官方仓库。

这个案例的要点：框架只做依赖；存储、规则、桥接、闭环脚本和 UI 全部在业务仓自研，Issue / PR 一条都不用提。
