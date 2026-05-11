# Cloudflare Tunnel 临时演示指南（Enterprise）

> 目标：在不买云服务器的前提下，把本机 `enterprise` 的前台/后台临时暴露到公网，供客户或同事体验。
>
> 适用：2~3 天 Demo、临时评审、跨网络协作测试。  
> 不适用：生产环境、稳定 SLA、固定域名。

---

## 1. 方案说明（先看）

本指南使用的是 **Cloudflare Quick Tunnel**（账号可选、临时随机域名）：

- 每条隧道会生成一个 `https://xxxx.trycloudflare.com` 地址。
- 进程关闭后地址失效；重开会换新地址。
- 想要固定域名（如 `demo.xxx.com`）请走 Named Tunnel（不在本文范围）。

---

## 2. 安装 cloudflared（macOS）

如果你没有 Homebrew，先安装（已有可跳过）：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装 cloudflared：

```bash
brew install cloudflared
cloudflared --version
```

期望输出类似：`cloudflared version 2026.3.0`

---

## 3. 先启动本地 enterprise

在第一个终端：

```bash
cd /Users/damon/myWork/AgenticX/enterprise
bash scripts/start-dev.sh
```

本机应可访问：

- 前台：`http://127.0.0.1:3000`
- 后台：`http://127.0.0.1:3001/login`

建议先本机验证（绕过代理）：

```bash
curl --noproxy '*' -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000
curl --noproxy '*' -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/login
```

---

## 4. 启动 Cloudflare 隧道（重点）

> Quick Tunnel 一条命令只能映射一个 `--url`，不能一个命令里写两个 `--url`。

### 4.1 前台隧道（终端 B）

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  cloudflared tunnel --url http://127.0.0.1:3000
```

### 4.2 后台隧道（终端 C）

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  cloudflared tunnel --url http://127.0.0.1:3001
```

> 为什么要 `env -u ...`：避免系统代理/VPN劫持 cloudflared 请求导致 500/超时。

---

## 5. 如何拿公网地址

每个隧道启动后，终端会出现：

```text
Your quick Tunnel has been created! Visit it at:
https://xxxxx.trycloudflare.com
```

把两条地址分别发出去：

- 前台地址（3000）：给普通体验用户
- 后台地址（3001）：给管理员，建议直接附 `/login`

示例：

- `https://aaa.trycloudflare.com`（前台）
- `https://bbb.trycloudflare.com/login`（后台）

---

## 6. 日志判断：哪些是正常，哪些是故障

### 6.1 可忽略（非致命）

以下日志常见且通常不影响使用：

- `Cannot determine default configuration path...`
  - Quick Tunnel 没有本地 `config.yml` 时的提示。
- `Failed to fetch features, default to disable ...`
  - 拉取 feature flags 失败，cloudflared 用默认值继续运行。
- `Unable to lookup protocol percentage.`
  - 统计/策略拉取失败，通常不影响已建隧道。

### 6.2 需要处理（致命）

- `failed to unmarshal quick Tunnel ... 500 Internal Server Error`
  - 向 `trycloudflare.com` 申请隧道失败，当前隧道没建成。
- 没有出现 `Your quick Tunnel has been created!`
  - 隧道未成功。
- 没有 `Registered tunnel connection`
  - 连接未注册成功。

---

## 7. 常见问题排查

### Q1. 我本机能打开，别人网络打不开

常见是对方网络到 `trycloudflare.com` 链路差、代理/VPN干扰、公司网关策略拦截。

处理顺序：

1. 对方关代理/VPN后重试；
2. 换浏览器；
3. 换手机热点；
4. 你重启隧道拿新地址再发一次。

### Q2. `stream canceled by remote with error code 0`

多为对端浏览器/网络中断，不一定是你服务挂了。  
如果你本机公网地址可打开，问题通常在访问方网络。

### Q3. `curl` 明明 502，但浏览器能开

十有八九是 `curl` 走了系统代理。用：

```bash
curl --noproxy '*' -I http://127.0.0.1:3001/login
```

---

## 8. 演示建议（实战）

1. 开会前 10 分钟先重启三样：
   - `start-dev.sh`
   - 3000 隧道
   - 3001 隧道
2. 把两个公网地址都先在你本机点通一次。
3. 发给同事时直接发带路径链接：
   - 前台：`https://xxx.trycloudflare.com/`
   - 后台：`https://yyy.trycloudflare.com/login`
4. 如果对方网络不通，立刻切换应急方案：
   - 用 ngrok 单隧道演示前台，后台你本机共享屏幕。

---

## 9. 关闭方法

终端里按 `Ctrl + C` 关闭对应隧道。  
隧道一旦关闭，公网地址即刻失效。

---

## 10. 安全与边界

- Quick Tunnel 是临时能力，不要承载生产敏感数据。
- 不建议长期对外暴露后台地址。
- 正式交付请改为：客户环境部署 / 云主机 + 固定域名 + TLS + 身份控制。
