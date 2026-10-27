---
source: https://docs.bailian.console.aliyun.com/zh/model-studio/managed-agents-billing
fetched: 2026-10-23
title: 计费说明
---

> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bailian.console.aliyun.com/llms.txt
> Use this file to discover all available pages before exploring further.

# 计费说明

> Managed Agents 的计费项、免费额度与计费示例。

<meta property="og:title" content="计费说明" />

<Note>
  Managed Agents 自 2026-08-17 09:00:00（UTC+8）起正式商业化计费。以下价格与额度以该版本为准，实际计费时间与金额以控制台账单为准。
</Note>

## 计费项 <span id="i1bnvx56bjye1" /> <span id="zpwbrahun3vwz" />

Managed Agents 的费用由三部分组成，分别独立计费。

| **计费项**     | **计费标准**          | **说明**                                                                   |
| ----------- | ----------------- | ------------------------------------------------------------------------ |
| 会话运行时费      | 0.5 元/小时          | 基础计费项。按创建并启用（运行中）的会话运行时长计费，不足 1 小时按实际时长精确计算                              |
| 模型调用费       | 按所调用模型的实际标准       | 运行时调用大模型（如 Qwen 系列）产生的 token 消耗，不含在运行时费中，按阿里云百炼对应模型的公开按量标准收取             |
| 工具及 MCP 调用费 | 按所调用工具或 MCP 的实际标准 | 调用工具或 MCP 服务产生的费用，单独计费。例如内置工具 `web_search` 按 0.03 元/次计费，`web_fetch` 限时免费 |

<Note>
  会话处于运行中状态即产生运行时费，空闲状态不收取。及时终止不再使用的会话可减少运行时费。会话状态管理详见 [管理会话](managed-agents-session-operations.md)。
</Note>

## 免费额度 <span id="s6axiz833v76v" /> <span id="gevw4z2mzoqe4" />

正式商业化后，赠送 10 小时的会话运行时免费额度。

| **项目** | **说明**                                  |
| ------ | --------------------------------------- |
| 赠送额度   | 总计 10 小时运行时，不限会话数，可任意抵扣                 |
| 抵扣范围   | 仅抵扣会话运行时费（0.5 元/小时），不抵扣模型调用费及工具/MCP 调用费 |
| 有效期    | 自额度生效日起 30 天内有效，逾期失效                    |

## 计费示例 <span id="75tx9lg0xx52i" /> <span id="p674bbewkuejy" />

运行 2 个会话，每个运行 5 小时；期间两个会话共调用 qwen-plus 模型，消耗 100 万 Input Token 和 20 万 Output Token（Input 0.004 元/千 Token，Output 0.012 元/千 Token）。

| **项目** | **计算**                         | **金额**     |
| ------ | ------------------------------ | ---------- |
| 会话运行时费 | (5 + 5) 小时 × 0.5 元/小时          | 5.0 元      |
| 模型调用费  | (1000 × 0.004) + (200 × 0.012) | 6.4 元      |
| **总计** |                                | **11.4 元** |

如有计费工具类调用，需在此基础上加上工具调用费用。
