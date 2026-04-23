# Edge Agent 安全威胁模型

> **分类**：STRIDE + MITRE ATT&CK（Client Operation / Data Exfiltration）
> **审阅频率**：每季度 + release 前复核

---

## 1. 资产清单

按敏感度排序，决定防护强度：

| # | 资产 | 敏感度 | 所在位置 |
|---|---|---|---|
| A1 | 用户原始对话 prompt / response | 🔴 极高 | Edge Agent 进程内存 |
| A2 | 用户工作区文件内容 | 🔴 极高 | 本地磁盘 + Edge Agent 读取 |
| A3 | Edge Agent ↔ Machi Token | 🟠 高 | `~/.agenticx/edge.token` |
| A4 | 客户专属脱敏规则 | 🟠 高 | 内存 + 加密配置 |
| A5 | 审计日志 | 🟡 中 | 本地 append-only 文件 |
| A6 | 模型调用统计 / token / cost | 🟡 中 | 内存 + 上送 |
| A7 | Edge Agent 二进制 | 🟡 中 | 安装目录 |

---

## 2. STRIDE 威胁分析

### S — Spoofing（伪装）

| 威胁 | 对策 |
|---|---|
| 恶意进程伪装成 Machi 发请求 | Token 鉴权（`Authorization: Bearer`） |
| 恶意进程伪装成 Edge Agent（绑定同端口）| 启动时校验端口独占；Machi 校验 server cert/token |
| 恶意软件替换 Edge Agent 二进制 | 自升级 Ed25519 签名；安装目录设为只读 |

### T — Tampering（篡改）

| 威胁 | 对策 |
|---|---|
| 篡改本地日志掩盖越权访问 | Append-only + checksum 链（类 Merkle tree）|
| 篡改脱敏规则让敏感数据外发 | 规则签名校验 + 加载时验证 |
| 篡改 `~/.agenticx/edge.token` 抢占合法 Machi | Token 随机 + 每次启动轮换；Machi 启动时校验 agent 身份 |

### R — Repudiation（抵赖）

| 威胁 | 对策 |
|---|---|
| 用户否认发送过某敏感 prompt | 本地日志 checksum 链不可抵赖；管理员可审 |
| 管理员否认下发过某规则变更 | 规则变更落审计日志（上送 Gateway）|

### I — Information Disclosure（信息泄露）

| 威胁 | 对策 |
|---|---|
| 原始 prompt 上送到云端审计 | **禁止**。`internal/redact` 强制脱敏；摘要 ≤500 字 |
| 工作区文件内容被网络侧看到 | 文件内容**永不出端**；上送只有路径名+hash |
| 内存 dump 泄露敏感数据 | 关键密钥用 `mlock` 锁页；进程 core dump 禁用（`setrlimit(RLIMIT_CORE, 0)`） |
| 日志泄露 Token / Key | 结构化日志配 **secret scrubber**；字段白名单 |
| 崩溃上报泄露上下文 | 不启用自动崩溃上报；若要，必须脱敏后由用户确认 |

### D — Denial of Service（拒绝服务）

| 威胁 | 对策 |
|---|---|
| 大量请求打爆 Edge Agent | 连接数限制（默认 100）+ 令牌桶限流（默认 10 QPS）|
| 恶意大 payload | 请求体上限（默认 10MB）|
| 长时间占用连接 | 读/写超时 60s |

### E — Elevation of Privilege（权限提升）

| 威胁 | 对策 |
|---|---|
| 通过路径遍历访问系统文件 | `internal/sandbox` 三重校验（Clean → EvalSymlinks → 白名单）|
| 通过 API 执行任意命令 | **禁止任何 shell exec** API；工具调用走白名单 |
| Edge Agent 以 root 运行被利用 | 强制非 root；能力降权（Linux `CAP_DROP`）|

---

## 3. MITRE ATT&CK 映射（关键技术）

我们关注的 ATT&CK 技术：

| ID | 技术 | 防护 |
|---|---|---|
| T1005 | Data from Local System | Workspace 沙箱白名单；禁止任意路径读取 |
| T1041 | Exfiltration Over C2 Channel | 原始数据不外发；上送仅摘要 |
| T1059 | Command and Scripting Interpreter | 无 shell exec API；MCP 工具走白名单 |
| T1140 | Deobfuscate/Decode Files | 本地不解密存储的机密；密钥从外部注入 |
| T1190 | Exploit Public-Facing Application | 仅监听 127.0.0.1，不暴露公网 |
| T1546 | Event Triggered Execution | 不注册系统 hook / 启动项（由安装器按需） |

---

## 4. 敏感操作审计清单

以下事件**必须**落本地审计日志 + 上送 Gateway：

1. Token 鉴权失败（含尝试次数、来源 pid）
2. Workspace 路径越权尝试
3. 脱敏规则命中（规则 id / 严重级别）
4. 文件大小超限
5. 自升级启动 / 失败
6. 远程 disable 指令接收

---

## 5. 密钥与凭据管理

| 凭据 | 生成 | 存储 | 轮换 |
|---|---|---|---|
| Edge Agent Token | `crypto/rand` 32 bytes | `~/.agenticx/edge.token`（0600） | 每次启动 |
| 审计签名密钥 | Ed25519 | OS Keychain（macOS）/ DPAPI（Win）/ libsecret（Linux） | 随客户策略 |
| 客户端证书（可选） | CA 签发 | OS Keychain | 随客户策略 |

**绝不**：
- ❌ 密钥硬编码到二进制
- ❌ 密钥明文落盘（非 keychain）
- ❌ 密钥通过日志输出（即便是 DEBUG）

---

## 6. 合规对照

| 法规/标准 | 对应措施 |
|---|---|
| **个人信息保护法（PIPL）** | PII 脱敏引擎；最小收集原则 |
| **等保 2.0 三级要求** | 日志完整性 + 身份鉴别 + 权限管理 |
| **GDPR Art.25 (Privacy by Design)** | 数据最小化 + 默认最严设置 |
| **ISO27001 A.12.4 日志与监控** | append-only 日志 + 实时告警 |
| **ISO42001 人工智能管理** | 模型调用审计 + 脱敏摘要 |

---

## 7. 渗透测试清单（release 前必跑）

- [ ] 端口扫描：确认只暴露 127.0.0.1
- [ ] Token fuzzing：确认非法 token 一律 401
- [ ] 路径遍历：`../`、symlink、相对路径、URL-encoded 均被拦截
- [ ] 大 payload：超过上限返回 413
- [ ] 并发压测：1000 连接不 OOM
- [ ] `govulncheck`：无高危 CVE
- [ ] `semgrep --config=p/owasp-top-ten`：无严重 findings
- [ ] 静态二进制分析：`strings` 不暴露任何 secret / URL
- [ ] 自升级：签名失败的包不执行
