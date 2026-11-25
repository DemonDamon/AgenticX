---
type: BigQuery Table
title: Orders
tags:
  - sales
status: stable
stale_after: 2027-06-30T00:00:00Z
resource: bigquery://ecom/orders
sources:
  - {'id': 'bq-orders', 'resource': 'bigquery://ecom/orders'}
---

# Orders 订单表

一行对应一笔已完成客户订单，含 order_id、customer_id、金额与状态。