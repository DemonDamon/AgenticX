# Settlement Contract Stub（智能合约 / 数据要素交易占位）

## 定位

本模块为 **settlement_contract 接口抽象** 的占位实现，用于描述未来对接智能合约或数据要素交易平台时的集成方式。**本期不含链上逻辑**，仅提供：

- 可配置的 **Webhook 通知**（`billing_settlement_webhook_config`）
- 调用留痕（`billing_settlement_webhook_events`）
- 分账账本写入后的 **best-effort 回调**

## 事件载荷

分账完成后，若租户启用 Webhook，系统将 POST：

```json
{
  "type": "billing.split.settled",
  "tenant_id": "...",
  "usage_record_id": "...",
  "rule_id": "...",
  "entries": [
    { "participant_id": "platform", "amount_micro_usd": "700000" }
  ],
  "contract_stub": true
}
```

金额单位为 **micro-USD**（1 USD = 1_000_000），避免浮点误差。

## 未来对接建议

1. **链下对账 → 链上结算**：Webhook 消费方将 `entries` 映射为链上分账指令（如多签 / 托管合约调用）。
2. **签名回调**：预留 `POST /api/billing/settlement/ack`（未实现）用于接收外部系统签名回执。
3. **数据要素市场**：`participant_id` 可与数据要素登记 ID 对齐，规则表 `billing_split_rules.participants` 扩展 metadata 字段。

## 配置

Admin Console → **计量 → 分账** → 「结算 Webhook」区块：

- `webhook_url`：HTTPS 回调地址
- `enabled`：启用后每条分账尝试通知；未配置时不报错（AC-3）

## 合规说明

智能合约与数据要素交易涉及监管与合同口径，**生产落地前须法务与运维评审**；本仓库仅提供技术占位与审计留痕。
