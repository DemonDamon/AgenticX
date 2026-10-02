# OpenMuse-05 · Near Browser Harden

Planned-with: Auto (Composer)
Suggested-Impl-Model: Composer 2.5
Plan-Id: 2026-10-01-openmuse-05-near-browser-harden
Plan-File: `.cursor/plans/2026-10-01-openmuse-05-near-browser-harden.plan.md`
Parent-Plan: `2026-10-01-openmuse-selective-adopt-master`
Source-SHA: `d0b3a6b` · OpenMuse `observeForThread` + `validatePublicUrl` / `isPublicIp`

> **For Claude:** Harden existing near_browser_* only. Do not add Playwright worker service or CopilotKit. Do not commit unless asked.

**Goal:** 为 `near_browser_*` 增加（1）会话/线程级稳定 browser profile key，失败重试不新开失控会话；（2）打开 URL 前拒绝非公网 / 危险目标（SSRF 基线）。

**Architecture:** 在 Studio session 或 `~/.agenticx/sessions/<id>/` 旁路记录 `browser_profile_id`；`near_browser_open` 先 `validate_public_http_url` 再请求后端浏览器桥。校验逻辑可放 `agenticx/tools/near_browser/url_guard.py`（新建），单元测试覆盖私网/localhost/file/带用户名密码 URL。

**Tech Stack:** Python urllib/ipaddress、既有 near_browser HTTP 桥、pytest。

---

## In scope

- `validate_public_http_url(url) -> parsed`：仅 http/https；拒绝 userinfo；端口仅默认或 80/443；hostname 解析后 IP 必须公网（可复用/改写 OpenMuse `isPublicIp` 思路，**不要**复制 AGPL/不明来源大段；独立实现并测）
- session 级 `browser_profile_id`：首次 open 创建，后续 open/snapshot 复用
- 错误信息对用户可读（中文可）：「不允许访问内网地址」等
- 测试：127.0.0.1、10.0.0.1、169.254.x、localhost、https://example.com 允许（mock DNS）

## Out of scope

- Take control 完整直播控制台（可后续 plan；本 plan 最多预留 profile id 字段）
- 替换 browser-use MCP、Computer Use
- Desktop 大改浏览器面板视觉
- ActionProposal / durable jobs / choice panels

---

## 根因与证据

| 侧 | 事实 |
|---|---|
| OpenMuse | `browser.ts:181-213` 先占 UUID；`network.ts` 公网 IP allowlist |
| AgenticX | `near_browser_open`（`agent_tools.py:3580+`）经 session HTTP 桥，缺少统一公网校验与稳定 profile 文档化行为 |

---

## FR / AC

| ID | 需求 | AC |
|---|---|---|
| FR-1 | 私网/localhost open 失败 | `tests/test_near_browser_url_guard.py` |
| FR-2 | 同 session 两次 open 复用同一 profile id（存储层） | `test_profile_stable_per_session` |
| FR-3 | 合法公网 URL 通过校验（DNS mock） | `test_public_url_ok` |
| NFR-1 | 不改 `server.py` import；若需存储可用 session 属性或 sessions 目录文件 | diff 审查 |

---

## 落点

- Create: `agenticx/tools/near_browser/url_guard.py`
- Create: `agenticx/tools/near_browser/profile.py` — get_or_create_profile(session)
- Modify: `agenticx/cli/agent_tools.py` · `_tool_near_browser_open`（约 3580）开头调用 guard；传入 profile id 到 HTTP 桥（若桥 API 尚无字段，先本地记录 + 日志，并在工具返回中带 `profile_id`）
- Test: `tests/test_near_browser_url_guard.py`

### before/after

```text
before: near_browser_open(url) → 直接 HTTP 桥
after:  validate_public_http_url(url) → bind profile_id → HTTP 桥
```

---

## 实施步骤

1. 红测 url_guard 矩阵
2. 实现 guard + profile
3. 接线 `_tool_near_browser_open`
4. 确认其它 near_browser_* 不绕过 open（click/type 仍走已开页）

---

## 风险

- DNS TOCTOU：与 OpenMuse 一样无法在无出口代理时完美消除；文档注明「校验为最佳努力基线」
- 桥接服务若忽略 profile_id：本 plan 以本地绑定 + 返回值为验收，不强制改外部 CDP 实现
