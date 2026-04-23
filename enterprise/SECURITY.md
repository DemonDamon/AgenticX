# AgenticX Enterprise · 安全基线

> **适用范围**：enterprise/ 全部 apps / features / packages / plugins
> **审阅节奏**：每季度 + 每次 release 前复核
> **漏洞披露**：security@agenticx.ai（或私有通告）

---

## 1. 安全原则

| # | 原则 | 体现 |
|---|---|---|
| 1 | **自研为先** | 不 fork 开源代码，避免继承 CVE 包袱（ADR-0001） |
| 2 | **默认最严** | 端口只绑 127.0.0.1；默认拒绝跨域；默认 HTTPS |
| 3 | **最小权限** | 服务不 root；角色按需分配；API 按 scope 下发 |
| 4 | **数据最小化** | 原始 prompt/response 绝不落盘或外发，只记哈希+摘要 |
| 5 | **纵深防御** | 网关 + Edge Agent + 应用层 三层独立拦截 |
| 6 | **完整审计** | Append-only + checksum 链 + 签名，操作全留痕 |
| 7 | **供应链审计** | 依赖白名单 + SBOM + `govulncheck` + `pnpm audit` |
| 8 | **租户强隔离** | 所有查询走 `tenant_id` 强制过滤，代码 + DB 层双保险 |

---

## 2. 威胁模型分层

```
┌──────────────────────────────────────────────────────────┐
│ L1 · 外部攻击面     → 网关 HTTPS + WAF + 限流            │
│ L2 · 应用层          → JWT/RBAC + 输入校验 + ORM 参数化   │
│ L3 · 数据层          → 加密存储 + tenant_id 强过滤 + 审计 │
│ L4 · 端侧            → Edge Agent 沙箱 + 脱敏 + 本地 Token│
│ L5 · 供应链          → SBOM + 依赖白名单 + 签名 + CI 门禁 │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 全仓通用安全要求

### 3.1 秘密管理

- ❌ 禁止：硬编码 API Key / Password / Certificate 到代码
- ❌ 禁止：把 `.env` 提交到 git
- ✅ 必须：通过 env var / OS Keychain / Vault 注入
- ✅ 必须：CI 跑 **gitleaks** 扫描历史 commit

### 3.2 输入校验

- ✅ 所有 API 入参过 **zod / valibot** schema
- ✅ SQL 只用 ORM 参数化（Drizzle / SQLx）
- ✅ 文件路径走统一 `sandbox.Clean()` 规范化
- ❌ 禁止：`eval` / `Function()` / `child_process.exec(userInput)` / `os.system`

### 3.3 鉴权与 RBAC

- ✅ JWT 签名用非对称（RS256/ES256），短有效期（≤ 1h）+ refresh token
- ✅ API 接口按 `scope` 最小授权（参考 Langfuse RBAC scope 设计思路，代码自研）
- ✅ 特权操作 **二次确认**（管理员批量删除 / 规则库变更 / 导出审计）

### 3.4 CORS / CSRF

- ✅ CORS 白名单，不用 `*`
- ✅ Web 端 form 提交必带 CSRF token
- ✅ Cookie 设 `Secure + HttpOnly + SameSite=Strict`

### 3.5 审计与日志

- ✅ 关键事件（登录 / 规则变更 / 数据导出 / 越权尝试）实时落审计
- ✅ 日志 append-only，checksum 链
- ❌ 禁止：日志输出 Token / Key / 原始对话内容

### 3.6 依赖与供应链

- ✅ `pnpm audit` + `npm audit` 在 CI 中 fail-on-high
- ✅ Go 项目跑 `govulncheck`
- ✅ Python 项目跑 `pip-audit`
- ✅ Release 产物生成 CycloneDX SBOM
- ✅ 二进制 release 用 Ed25519 / cosign 签名

### 3.7 加密

- ✅ TLS 1.2+（建议 1.3），禁用 RC4/3DES
- ✅ 静态数据敏感字段用 AES-256-GCM
- ✅ 密钥轮换策略 ≤ 90 天

### 3.8 错误处理

- ❌ 禁止：把 stack trace 直接返回给前端
- ✅ 统一错误码 + 合规文案
- ✅ 内部错误日志带 correlation id，方便追溯

---

## 4. 各模块安全专章索引

| 模块 | 文档 |
|---|---|
| Edge Agent | [`apps/edge-agent/docs/security-model.md`](./apps/edge-agent/docs/security-model.md) |
| 审计日志 | [`features/audit/README.md`](./features/audit/README.md) |
| 网关 | `apps/gateway/docs/security.md`（TODO）|
| 认证 | `packages/auth/docs/security.md`（TODO）|
| 策略引擎 | `packages/policy-engine/docs/security.md`（TODO）|

---

## 5. CI 安全门禁（必选）

```yaml
# .github/workflows/security.yml 骨架
jobs:
  security:
    steps:
      - name: Secret scan (历史)
        run: gitleaks detect --no-git -v

      - name: SAST (JS/TS)
        run: semgrep --config=auto --error --severity=ERROR

      - name: TypeScript strict
        run: pnpm turbo typecheck

      - name: NPM audit
        run: pnpm audit --audit-level=high

      - name: Go vuln
        run: |
          cd apps/edge-agent && govulncheck ./...
          cd ../gateway && govulncheck ./...

      - name: Python audit
        run: pip-audit -r packages/sdk-py/requirements.txt

      - name: SBOM
        run: syft dir:. -o cyclonedx-json > sbom.json

      - name: License check
        run: license-checker --production --failOn 'GPL;AGPL'
```

---

## 6. 漏洞披露与响应

### 披露渠道

- 邮件：security@agenticx.ai
- PGP：（公钥待补充到 `.well-known/security.txt`）
- 请勿在公开 issue 报告漏洞

### 响应 SLA

| 等级 | 首响 | 修复 | 披露 |
|---|---|---|---|
| **Critical** | 4 小时 | 7 天 | 修复后 30 天内 CVE |
| **High** | 24 小时 | 30 天 | 修复后 60 天内 |
| **Medium** | 3 工作日 | 90 天 | 随版本 |
| **Low** | 5 工作日 | 下个 release | 随版本 |

---

## 7. 合规对照

| 法规/标准 | 本产品对应 |
|---|---|
| 个人信息保护法（PIPL）| 脱敏引擎 · 最小收集 · 用户同意 |
| 数据安全法 | 分级分类 · 本地化存储 · 跨境审批 |
| 等保 2.0 三级 | 身份鉴别 · 访问控制 · 日志完整 · 备份恢复 |
| ISO 27001 | A.9 访问控制 · A.12 运行安全 · A.14 系统开发 |
| ISO 42001 | AI 系统治理 · 可追溯性 · 风险管理 |
| GDPR | Art.25 Privacy by Design · Art.32 Security of Processing |

详细对照见各客户项目交付文档（`customers/*/docs/compliance.md`）。

---

## 8. 新人入职安全清单

- [ ] 阅读本文件 + ADR-0001
- [ ] 阅读各模块 security 专章
- [ ] 本机装 `gitleaks` + pre-commit hook
- [ ] 开发账号启用 2FA
- [ ] 不在 Slack / IM 传递密钥
- [ ] 代码 review 时至少检查：
  - [ ] 是否引入新依赖（填 supply-chain 记录）
  - [ ] 是否新增 API（是否带 auth/scope）
  - [ ] 是否涉及 tenant_id 查询（是否强制过滤）
  - [ ] 是否日志打印敏感字段
