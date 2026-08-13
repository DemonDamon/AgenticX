# Enterprise Desktop 外部 HTTPS 代理下设备登录与推理入口适配

Planned-with: claude-opus-4-20250514

## 背景与问题

Enterprise 部署架构中，Portal 运行在内网 HTTP 环境，前方由外部 HTTPS 代理（非本仓库 nginx）终止 TLS 并转发。Desktop 客户端通过 `https://域名:3000` 访问 Portal。此场景暴露三个串联故障：

1. **验证地址 origin 不一致**：Portal `device/init` 接口返回的 `verificationUrl` 基于自身看到的内部 origin（如 `http://域名`），与用户输入的外部 origin（`https://域名:3000`）不匹配，Desktop 校验 same-origin 失败 → 报「组织返回的登录地址无效」
2. **Bootstrap 503 阻断登录**：`resolveDesktopInferenceApiBase` 在 `NODE_ENV=production` 下要求 `NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL` 必须为 HTTPS（或 HTTP loopback）；内网 HTTP 网关地址验证失败 → 旧版 bootstrap 路由直接返回 503 → Desktop 报「企业推理入口未配置」
3. **错误信息不透明**：bootstrap 503 被 Desktop 统一归入「未在有效时间内完成登录确认」超时提示，掩盖了真实原因

## 已实施的改动（2026-08-12）

### 1. `desktop/electron/enterprise-browser-login.ts` — 验证地址 origin 归一化

新增 `normalizeVerificationUrlForPortalOrigin(portalOrigin, verificationUrl)` 函数：

- 外部代理可能将 HTTPS 降级为 HTTP、或丢失自定义端口
- 当 `verificationUrl` 的 hostname 与用户输入的 `portalOrigin` 一致，且路径以 `/auth/desktop` 开头时，将协议和端口重写为 `portalOrigin` 的值
- loopback 地址（`localhost` / `127.0.0.1`）之间视为等效
- `isVerificationUrlSameOrigin` 改为基于此函数判定

### 2. `desktop/electron/main.ts` — 登录/刷新对 503 做降级处理

**`user-account-login-start` handler：**
- 使用 `normalizeVerificationUrlForPortalOrigin` 处理 `verificationUrl` 后再打开浏览器

**`finishEnterpriseLogin` 函数：**
- 401 → 硬失败（PAT 无效）
- **503 → 不再中断登录**，跳过 gateway-direct，`selectEnterpriseInferenceBase` 拿到 portal-proxy 传输，继续完成登录
- 其他非 200 → 保持原有失败行为
- `apiBaseUrl` 始终从用户输入的 `baseUrl` 派生（`${baseUrl}/api/desktop/v1`），不依赖 bootstrap 返回的 `apiBaseUrl`（可能被内部代理污染 origin）
- bootstrap 失败时通过 `user-account-login-timeout` 事件传递具体错误而非泛化超时文案
- 所有 `bootJson.data.xxx` 改用可选链 `bootJson.data?.xxx`

**`enterprise-refresh` handler（刷新模型列表）：**
- 同样对 503 做降级处理，避免刷新时重新报「推理入口未配置」

### 3. `desktop/electron/preload.ts` — 错误 payload 透传

- `onUserAccountLoginTimeout` 签名新增 `payload?: { error?: string }` 参数

### 4. `desktop/src/global.d.ts` — 类型同步

- `onUserAccountLoginTimeout` 类型定义同步更新

### 5. `desktop/src/App.tsx` — 展示具体错误

- `onUserAccountLoginTimeout` 回调检查 `payload.error`：有则显示「企业登录失败」+ 具体原因；无则保持原超时文案

### 6. `desktop/tests/enterprise-browser-login.test.ts` — 新增测试

- 新增 `normalizeVerificationUrlForPortalOrigin` 测试：`portalOrigin=https://域名:3000` + `verificationUrl=http://域名/auth/desktop?device=abc` → 归一化为 `https://域名:3000/auth/desktop?device=abc`

### 7. `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts` — Portal 侧回退 proxy

- `resolveDesktopInferenceApiBase` 返回 `ok: false` 时，不再返回 503
- 改为设置 `data.reauthRequiredForDirect = true`，其余 data（user / models / policy）正常返回 200
- Desktop 收到后走 portal-proxy 传输

## 环境变量配置指引

### 内网 HTTP 网关（无公网 HTTPS 入口）— Portal 代理模式

```bash
# 不设或留空 — 无 Desktop 直连网关能力
# NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL=

# Portal 代理转发目标，HTTP 内网地址即可
GATEWAY_COMPLETIONS_URL=http://192.168.x.x:8088/v1/chat/completions
```

传输链路：`Desktop ──HTTPS──▶ Portal ──HTTP──▶ 内网 Gateway`

### 网关有公网 HTTPS 入口 — 直连模式

```bash
# 设为 Desktop 可达的 HTTPS 地址
NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL=https://gateway.example.com
```

传输链路：`Desktop ──HTTPS──▶ Gateway`

## 涉及文件

- `desktop/electron/enterprise-browser-login.ts`
- `desktop/electron/main.ts`（`finishEnterpriseLogin` + `enterprise-refresh` + `user-account-login-start`）
- `desktop/electron/preload.ts`
- `desktop/src/global.d.ts`
- `desktop/src/App.tsx`
- `desktop/tests/enterprise-browser-login.test.ts`
- `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/route.ts`
- `enterprise/apps/web-portal/src/app/api/desktop/bootstrap/__tests__/route.test.ts`

## In scope

- 外部 HTTPS 代理终止 TLS 后 `verificationUrl` origin 不一致的归一化
- Bootstrap 503 降级为 portal-proxy 而非阻断登录
- 错误信息透明化（区分 bootstrap 失败 vs 超时）
- Portal 侧 bootstrap 路由对推理入口未配置的容错

## Out of scope

- Portal `resolveDesktopInferenceApiBase` 的 HTTPS 强制要求本身（安全约束保留）
- Portal 代理路由 `/api/desktop/v1/chat/completions` 的流式转发优化
- nginx 内部 `/v1/` 路由调整（参见 `2026-08-11-enterprise-external-https-upstream-config.plan.md`）
- Desktop 对 gateway-direct 不可达时的运行时自动降级（当前为登录阶段一次性决策）
