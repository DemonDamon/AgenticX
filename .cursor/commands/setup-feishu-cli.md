# setup-feishu-cli

从安装到配置多个飞书企业账号。一个 profile 对应一个开放平台应用，对应一个企业。飞书客户端里登了几个企业，不会自动变成几条 profile。

官方安装页：[飞书 CLI](https://www.feishu.cn/feishu-cli)。命令与多账号说明以 [larksuite/cli](https://github.com/larksuite/cli) 的中文 README 为准。

## 命令名

- 对话里使用：`/setup-feishu-cli`
- 可选参数：要配置的企业清单。用户没给清单时，先列出已有 profile，再问还要加哪几个企业。

## 硬性边界

- 只改本机 `lark-cli` 配置（钥匙串 / `~/.lark-cli`）。不要把 App Secret、device code、用户令牌写入仓库、plan、commit 或 `mcp.json`。
- 回复用户时不回显 App Secret。添加 profile 时 Secret 只从 stdin 进入 `lark-cli profile add --app-secret-stdin`。
- 不使用 `config init` 覆盖已有默认应用。已有 App ID 时用 `profile add`，不要再 `--new` 出一个重复应用。
- 未经用户点名，不执行 `profile use`、`profile remove`。单次操作用 `--profile "<名称>"`。
- 同一轮只发起一个企业的浏览器授权。展示授权链接和二维码后结束本轮，等用户说做完了，再执行 `--device-code`。不要在同一轮里阻塞等待。
- 授权失败且 CLI 写明「请勿持续重试」时，不要立刻重开登录。把缺的 scope 告诉用户。

## 第一步：安装

需要本机有 Node.js（`npm` / `npx`）。源码编译才需要 Go 1.23+ 和 Python 3。

先检查：

```bash
command -v lark-cli && lark-cli -v
```

已有可执行文件就跳过安装，向用户报告版本和路径。没有则用官方一行安装（[飞书 CLI 安装页](https://www.feishu.cn/feishu-cli) 与 README 的推荐方式）：

```bash
npx @larksuite/cli@latest install
```

装完再跑 `command -v lark-cli && lark-cli -v`。新开的 shell 找不到命令时，提示用户新开终端，或执行 `hash -r`。

源码安装只在用户明确要求时使用：

```bash
git clone https://github.com/larksuite/cli.git
cd cli
make install
npx skills add larksuite/cli -y -g
```

npm 安装脚本若没有装上 Agent skills，补一次：

```bash
npx skills add larksuite/cli -y -g
```

用 `lark-cli skills list` 确认能看到 `lark-shared`。不要把社区包 `feishu-mcp` 或 `@larksuiteoapi/lark-mcp` 当成这个 CLI。

## 第二步：看清已有账号

```bash
lark-cli profile list
lark-cli whoami
```

向用户说明：`active: true` 是以后不写 `--profile` 时的默认身份。`tokenStatus: valid` 且 `user` 非空，才算用户身份可用。只有 bot、没有 `user` 的 profile 不能读该用户的知识库和云文档。

## 第三步：逐个企业接入

对用户点名的每一个企业单独做完下面一整段，再开始下一个。

### 3.1 已有应用

用户提供该企业的 App ID 和 App Secret。profile 名称用用户指定的短名（例如企业简称），不要用 App ID 当名字，除非用户要求。

```bash
python3 - << 'PY'
import subprocess
secret = """PASTE_SECRET"""
proc = subprocess.run(
    [
        "lark-cli", "profile", "add",
        "--name", "PROFILE_NAME",
        "--app-id", "APP_ID",
        "--app-secret-stdin",
        "--lang", "zh_cn",
    ],
    input=secret,
    text=True,
    capture_output=True,
)
print(proc.stdout)
print(proc.stderr)
raise SystemExit(proc.returncode)
PY
lark-cli --profile "PROFILE_NAME" whoami
```

`whoami` 里 `identity` 为 `bot` 且 `tokenStatus` 为 `ready`，表示应用凭证可用。不要加 `--use`。

### 3.2 还没有应用

让用户先在浏览器确认右上角企业就是目标企业，然后：

1. 打开飞书开放平台，选择「创建企业自建应用」。不要选「从智能体模板开始」，那是给别的智能体运行时预置用的。
2. 应用名称由用户定。左侧「添加应用能力」里的机器人、网页应用可以跳过，CLI 不依赖这些能力。
3. 左侧「权限管理」开通云文档、知识库、云空间。后台开通和用户授权是两层，缺一不可。
4. 右上角「创建版本」并发布。未发布时配置不生效；企业要求管理员审核时，等状态变为已启用。
5. 把「凭证与基础信息」里的 App ID 和 App Secret 发回来，再走 3.1。

### 3.3 用户授权

应用凭证通过后，为这个 profile 发起用户登录。知识库和文档场景用：

```bash
lark-cli auth login --profile "PROFILE_NAME" --domain wiki,docs,drive --no-wait --json
```

从 JSON 取出 `verification_url` 和 `device_code`。`verification_url` 原样发给用户，不做编码或改写。然后：

```bash
lark-cli auth qrcode "VERIFICATION_URL" --output "/tmp/feishu-<profile>-qr.png" --size 320
```

回复里先放链接，再放二维码图片。告诉用户：浏览器里选这个企业的账号，不要选已经登过的另一个企业。链接约 10 分钟有效。请用户授权完成后回复。

用户确认后：

```bash
lark-cli auth login --profile "PROFILE_NAME" --device-code "DEVICE_CODE"
```

成功标准：`lark-cli profile list` 里该 profile 的 `user` 是预期显示名，且 `tokenStatus` 为 `valid`。再用只读命令抽查：

```bash
lark-cli --profile "PROFILE_NAME" wiki +space-list --as user --page-size 5
```

若提示缺 `search:docs:read` 或 `space:document:retrieve`，说明后台没开或用户没授。列出缺项，让用户到「权限管理」补开并发布新版本，不要空转重试。

## 第四步：告诉用户以后怎么点名

配置结束后用一张表回复，每行包含：profile 名、企业、用户显示名、是否默认、令牌状态。

之后用户这样说就按表切换，只对这一次生效：

| 用户说法 | Agent 做法 |
|---|---|
| 用「某 profile 名」或用「某用户显示名」 | 该次命令加 `--profile`，不改默认 |
| 没点名 | 用 `profile list` 里 `active: true` 的那条 |
| 把默认改成某账号 | 用户明确要求后才 `lark-cli profile use "<名称>"` |

终端里单次指定：

```bash
lark-cli --profile "PROFILE_NAME" wiki +space-list --as user
```

改默认（会一直生效，直到再改）：

```bash
lark-cli profile use "PROFILE_NAME"
```

## 完成时要报告

- 安装结果：新装还是沿用已有，版本号，`which lark-cli` 的路径
- 这次新增或更新的 profile，以及仍然只有 bot、还没有用户的 profile
- 当前默认身份是谁
- 没做完的企业，以及卡在「缺凭证 / 未发布 / 未授权 / 缺 scope」的哪一步
