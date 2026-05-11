# ngrok 本地外网演示操作指南（Enterprise）

> **适用场景**：不买云服务器，临时把本机 `enterprise` 暴露到公网给客户演示。
> **不适用**：长期生产、需要稳定域名 / 大并发 / 客户内网部署。

---

## 1. 概念澄清（先看这一节）

### 1.1 ngrok 是什么

一个**隧道**工具：在你本机和 ngrok 云之间建立 TLS 长连接，把云上分配的公网 URL（如 `https://xxxx.ngrok-free.app`）的流量转发到你本机端口。客户访问公网 URL ⇒ 流量到 ngrok 云 ⇒ 通过隧道回到你本机 `localhost:3000`。

### 1.2 「authtoken」是谁分配的

是 **ngrok 平台分配给你账号的**，不是你随便编的。

- 获取地址：<https://dashboard.ngrok.com/get-started/your-authtoken>
- 配置后写入本机：`~/Library/Application Support/ngrok/ngrok.yml`
- 没配 token，启动会报 `ERR_NGROK_4018`

### 1.3 `ngrok-demo.sh` 是什么

本仓库新增的便捷脚本：`enterprise/scripts/ngrok-demo.sh`。它只是把
`ngrok http 3000` 或 `ngrok start --all` 包了一层，避免每次手敲。直接用原生
`ngrok` 命令也完全可以，脚本不是必需品。

---

## 2. 安装 ngrok（macOS）

ngrok 在 Homebrew 上通过它**自己的官方 tap** 提供，常见两种写法都能装上：

| 写法 | 解释 | 是否推荐 |
|------|------|-----------|
| `brew install --cask ngrok` | 从已 tap 的源（含 ngrok 官方 tap）安装名为 `ngrok` 的 cask；最简洁 | 推荐 |
| `brew install ngrok/ngrok/ngrok` | 显式指定 `tap=ngrok/ngrok, name=ngrok`，不依赖 Homebrew 的名字解析 | 推荐（与 ngrok 官方文档一致） |
| `brew install ngrok` | 省略 `--cask`，依赖 Homebrew 自动判断；个别新机器上可能命中其他同名 formula | 不推荐 |

> 本机本次安装实际执行的是 `brew install ngrok/ngrok/ngrok`，等价于先 `brew tap ngrok/ngrok` 再装 cask。两条最终都会落到同一个 binary `/opt/homebrew/bin/ngrok`。

### 2.1 安装命令（任选其一）

```bash
brew install --cask ngrok
# 或
brew install ngrok/ngrok/ngrok
```

### 2.2 验证安装

```bash
which ngrok          # 期望：/opt/homebrew/bin/ngrok（Apple Silicon）或 /usr/local/bin/ngrok（Intel）
ngrok version        # 期望：ngrok version 3.x.x
```

---

## 3. 一次性配置 authtoken

只需在本机做一次，之后所有 `ngrok` 命令都自动带上。

```bash
# 1. 打开 https://dashboard.ngrok.com/get-started/your-authtoken
# 2. 复制页面上的那串字符
# 3. 执行（把引号里替换掉）：
ngrok config add-authtoken "<你的TOKEN>"

# 4. 验证配置文件
ngrok config check
# 期望：Valid configuration file at /Users/<you>/Library/Application Support/ngrok/ngrok.yml
```

> 安全提示：token 等价于账户密码，不要发到聊天工具、不要提交到 Git。

---

## 4. 演示流程（每次都按这个走）

需要两个终端窗口同时打开。

### 4.1 终端 A：启动 enterprise 本地服务

```bash
cd /Users/damon/myWork/AgenticX
bash enterprise/scripts/start-dev.sh
```

启动成功后本机访问应正常：

| 服务 | 本地地址 |
|------|----------|
| web-portal（前台） | <http://localhost:3000> |
| admin-console（后台） | <http://localhost:3001> |
| gateway | <http://localhost:8088/healthz> |

> Gateway 是同机器内的本地服务，前台 Next 会主动转发到它，**不需要单独穿透 8088**。

### 4.2 终端 B：启动隧道（推荐方式）

仅暴露前台（免费档兼容性最好）：

```bash
cd /Users/damon/myWork/AgenticX
bash enterprise/scripts/ngrok-demo.sh
# 等同于：ngrok http 3000
```

终端里会打印一段类似下面的输出，把 `Forwarding` 后的 `https://xxxx.ngrok-free.app` 发给客户即可：

```
Session Status                online
Forwarding                    https://xxxx.ngrok-free.app -> http://localhost:3000
```

### 4.3 同时暴露前台 + 后台（可选）

```bash
bash scripts/ngrok-demo.sh --all
# 等同于：ngrok start --all（读取下方配置文件）
```

要求：你的 ngrok 账号支持同时启动多个 endpoint。免费档常见限制为「同时只能 1 条隧道」，遇到额度错误就用 4.2 的单隧道命令。

---

## 5. 当前 ngrok 配置文件

路径：`~/Library/Application Support/ngrok/ngrok.yml`（macOS 默认）

已写入两个 endpoint，仅在 `ngrok start --all` 时生效：

```yaml
version: "3"
agent: {}
endpoints:
  - name: enterprise-web-portal
    upstream:
      url: http://127.0.0.1:3000
  - name: enterprise-admin-console
    upstream:
      url: http://127.0.0.1:3001
```

> 不要把 authtoken 直接写在这里 ❌。`ngrok config add-authtoken` 会自动安全写入。

---

## 6. 常见错误处理

| 现象 | 原因 | 处理 |
|------|------|------|
| `ERR_NGROK_4018` / `authentication failed` | token 未配置或失效 | 重新跑 `ngrok config add-authtoken "<TOKEN>"` |
| 启动时报「only allowed 1 simultaneous tunnel」 | 免费档限制多隧道 | 改用单隧道：`bash scripts/ngrok-demo.sh` |
| 客户访问公网 URL 显示 502 / 504 / 「tunnel is offline」 | 终端 A 的服务挂了 / 没起 | 先在本机浏览器验证 `http://localhost:3000` 能开 |
| 客户访问首页是「ngrok 警告页」要求点继续 | ngrok 免费档默认行为 | 演示前提醒客户点一下；或升级付费档去掉 |
| 一关电脑客户就访问不了 | 隧道依赖你本机进程 | 演示期间保持电脑唤醒、网络稳定；长期需求请改用云主机 |

---

## 7. 关闭演示

按出现顺序反向关闭：

1. 终端 B：`Ctrl + C` 关闭 ngrok 隧道
2. 终端 A：`Ctrl + C` 关闭 enterprise 本地服务

---

## 8. 不适合用 ngrok 的场景（必须升级方案）

- 客户要 **稳定域名**（如 `app.agxbuilder.com`） → 改用云主机 + 自有域名 + 证书
- 客户公司网络 **拦截 ngrok 域名** → 用自己的域名或反向代理
- 演示要持续 **数天且不可中断** → 即使用 ngrok 付费档，也建议改云主机
- 涉及 **生产数据 / 真实租户** → 不要走个人 ngrok 账户

参考下一步：把 enterprise 上云的方案对比见后续 plan（待补：`.cursor/plans/...vps-vs-vercel.plan.md`）。
