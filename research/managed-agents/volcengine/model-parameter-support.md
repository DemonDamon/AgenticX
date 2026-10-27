---
source: https://ark.volcengine.com/region:cn-beijing/docs/model-parameter-support
fetched: 2026-10-24
title: 模型支持的参数列表
---

# 模型支持的参数列表

> 全部文档的索引见 [llms.txt](https://ark.volcengine.com/llms.txt)；在任一文档页面地址后追加 `.md` 可获取该页的 Markdown 版本。

本文介绍方舟 Managed Agents 在定义 Agent 或创建 Session 时可配置的 `thinking`、`reasoning_effort` 和 `service_tier` 参数，并列出当前各模型对思考与服务档位参数的支持情况。

Managed Agents 会根据目标模型版本分别校验 `thinking`、`reasoning_effort` 和 `service_tier`。在创建 Agent、更新 Agent 或临时覆写 Session 模型参数前，应先确认目标模型版本是否支持对应取值。

> **注意**
>
> 模型支持范围可能随模型版本发布而变化，各字段实际支持的取值和默认值以目标模型版本为准。调用时，如果传入当前模型不支持的取值，Managed Agents 会返回 400 `InvalidParameter`。

<span id="parameter-fields"></span>

# 模型参数字段

| 字段                       | 可选取值                                                 | 说明                                                          |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| `model.id`               | 模型 ID 或推理接入点 ID                                   | Agent 使用的模型或推理接入点。使用推理接入点 ID 时，Managed Agents 根据接入点关联的模型校验运行参数。 |
| `model.thinking`         | `enabled`、`disabled`、`auto`                          | 思考开关，对应底层模型调用的 `thinking.type` 字段。`auto` 表示由模型判断是否思考，不表示继承。 |
| `model.reasoning_effort` | `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` | 推理投入档位，对应底层模型调用的 `reasoning_effort` 字段。不同模型支持的档位不同。         |
| `model.service_tier`     | `auto`、`default`、`fast`                              | 推理服务档位，对应底层模型调用的 `service_tier` 字段。只有部分模型版本支持 `fast` 快速档位。  |

> **说明**
>
> 创建或更新 Agent 时，`model.id` 支持模型 ID 和推理接入点 ID。创建 Session 时，`agent_with_overrides.model.id` 仅支持模型 ID；Dream 的 `model` 字段也仅支持模型 ID。如果基础 Agent 使用推理接入点，Session 响应中的模型快照仍会返回该推理接入点 ID。

<span id="default-and-validation"></span>

# 默认值与校验规则

- 不设置 `thinking`、`reasoning_effort` 或 `service_tier`，或在 Agent 定义中传空字符串时，Managed Agents 会优先使用模型元数据中的默认值。
- 如果模型元数据未配置默认值，Managed Agents 不会向底层模型调用传递对应字段，由底层模型服务按默认策略处理。

> **注意**
>
> Seedance Managed Agent 不使用 `reasoning_effort` 的模型默认值。创建 Seedance Managed Agent 时，省略 `reasoning_effort` 会由服务端补齐为 `high`；显式填写时只能设置为 `high`，其他值会返回 400 `InvalidParameter`。从控制台的 Seedance Managed Agent 创建页面展示的模型中选择，并确认该模型支持 `high`。

<span id="support-list"></span>

# 支持模型与参数列表

表中取值后标注“默认”的值，表示该模型版本的默认值。

| 模型 ID                          | `thinking`           | `reasoning_effort`            | `service_tier`        |
| ------------------------------ | -------------------- | ----------------------------- | --------------------- |
| `doubao-seed-evolving`         | enabled（默认）、disabled | low、medium、high（默认）、minimal   | auto、default（默认）      |
| `doubao-seed-2-1-pro-260915`   | enabled（默认）、disabled | low、medium、high（默认）、minimal   | auto、default（默认）      |
| `doubao-seed-2-1-lite-260915`  | enabled（默认）、disabled | low、medium、high（默认）、minimal   | auto、default（默认）      |
| `doubao-seed-2-1-pro-260628`   | enabled（默认）、disabled | low、medium、high（默认）、minimal   | auto、default（默认）      |
| `doubao-seed-2-1-turbo-260628` | enabled（默认）、disabled | low、medium、high（默认）、minimal   | auto、default（默认）、fast |
| `doubao-seed-2-0-lite-260428`  | enabled（默认）、disabled | low、medium（默认）、high、minimal   | auto、default（默认）、fast |
| `deepseek-v4-pro-260425`       | enabled（默认）、disabled | low、high（默认）、max、minimal      | auto、default（默认）      |
| `deepseek-v4-pro-ga-260813`    | enabled（默认）、disabled | none、low、high（默认）、max、minimal | auto、default（默认）      |
| `deepseek-v4-flash-ga-260731`  | enabled（默认）、disabled | none、low、high（默认）、max、minimal | auto、default（默认）      |
| `glm-5-2-260617`               | enabled（默认）、disabled | none、minimal、high、max（默认）     | auto、default（默认）      |

<span id="fast-service-tier"></span>

# 支持快速服务档位的模型

以下模型版本支持 `service_tier: "fast"`：

- `doubao-seed-2-1-turbo-260628`
- `doubao-seed-2-0-lite-260428`

其他模型版本当前支持 `auto` 和 `default`，默认值为 `default`。

> **注意**
>
> `service_tier: "fast"` 只表示请求快速服务档位，不改变模型本身的能力边界。配置快速档位前，应确认业务能够接受对应模型版本的能力边界和推理参数限制。

<span id="configuration-example"></span>

# 配置示例

创建 Agent 时，可以在 `model` 对象中显式配置支持的运行参数：

```json
{
  "model": {
    "id": "doubao-seed-2-1-turbo-260628",
    "thinking": "enabled",
    "reasoning_effort": "high",
    "service_tier": "fast"
  }
}
```

如果只希望使用模型默认策略，可以只设置 `model.id`。`model.id` 的取值可以是模型 ID 或推理接入点 ID；以下示例使用模型 ID：

```json
{
  "model": {
    "id": "doubao-seed-2-1-turbo-260628"
  }
}
```
