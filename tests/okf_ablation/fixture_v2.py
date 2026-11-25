"""消融实验 fixture Bundle v2 与标注查询集。

设计目标：让纯语义召回必然命中"陷阱"（字面高度相关但已过期/已废弃的知识），
从而量化 OKF 元数据过滤的增量价值。全部离线、确定性构造，不依赖业务数据。

Concept 布局（15 个）：
- 6 个 stable 电商域知识（订单/客户/支付/物流/退款/库存）
- 1 个 stable + human verified（优先召回排序验证）
- 2 个 draft（活跃用户/GMV 草稿）
- 2 个 deprecated（旧配送口径/旧报表 ETL——正文故意与相关查询高字面重叠）
- 2 个 stale_after 已过期（旧配送时效/旧税率）
- 2 个跨域干扰（法律条款/HR 制度）
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Dict, List, Tuple

from agenticx.knowledge.readers.okf_reader import OKFReader

# (相对路径, frontmatter dict, 正文) —— frontmatter 完整 dict 原样写入
CONCEPTS: List[Tuple[str, Dict, str]] = [
    (
        "tables/orders",
        {"type": "BigQuery Table", "title": "Orders", "tags": ["sales"],
         "status": "stable", "stale_after": "2027-06-30T00:00:00Z",
         "resource": "bigquery://ecom/orders",
         "sources": [{"id": "bq-orders", "resource": "bigquery://ecom/orders"}]},
        "# Orders 订单表\n\n一行对应一笔已完成客户订单，含 order_id、customer_id、金额与状态。",
    ),
    (
        "tables/customers",
        {"type": "BigQuery Table", "title": "Customers", "tags": ["sales"],
         "status": "stable", "stale_after": "2027-06-30T00:00:00Z"},
        "# Customers 客户表\n\n客户主数据：customer_id、注册渠道、会员等级与地区。",
    ),
    (
        "tables/payments",
        {"type": "BigQuery Table", "title": "Payments", "tags": ["finance"],
         "status": "stable", "stale_after": "2027-06-30T00:00:00Z",
         "verified": [{"by": "human:finance-lead", "at": "2026-11-20T00:00:00Z"}]},
        "# Payments 支付表\n\n支付流水：支付渠道、支付状态、金额、支付完成时间。",
    ),
    (
        "tables/logistics",
        {"type": "BigQuery Table", "title": "Logistics", "tags": ["ops"],
         "status": "stable", "stale_after": "2027-06-30T00:00:00Z"},
        "# Logistics 物流表\n\n物流单状态：揽收、干线、派送、签收，含承运商与运单号。",
    ),
    (
        "tables/refunds",
        {"type": "BigQuery Table", "title": "Refunds", "tags": ["finance"],
         "status": "stable", "stale_after": "2027-06-30T00:00:00Z"},
        "# Refunds 退款表\n\n退款单：退款原因、退款金额、退款状态、原订单号。",
    ),
    (
        "tables/inventory",
        {"type": "BigQuery Table", "title": "Inventory", "tags": ["ops"],
         "status": "stable", "stale_after": "2027-06-30T00:00:00Z"},
        "# Inventory 库存表\n\n库存快照：SKU、仓库、可用库存与锁定数量。",
    ),
    (
        # verified 信任层级：优先召回排序验证用
        "metrics/revenue",
        {"type": "Metric", "title": "Revenue", "tags": ["finance", "metric"],
         "status": "stable", "stale_after": "2027-06-30T00:00:00Z",
         "verified": [{"by": "human:finance-lead", "at": "2026-11-21T00:00:00Z"}],
         "sources": [{"id": "revenue-spec", "resource": "internal://metrics/revenue"}]},
        "# Revenue 营收指标\n\n口径：已完成订单金额扣除退款，按支付完成时间归因。",
    ),
    (
        "metrics/weekly_active_users",
        {"type": "Metric", "title": "WAU", "tags": ["growth"], "status": "draft"},
        "# WAU 周活跃草稿\n\n周去重活跃用户数，口径评审中：登录或下单任一即计活跃。",
    ),
    (
        "metrics/gmv_draft",
        {"type": "Metric", "title": "GMV Draft", "tags": ["growth"], "status": "draft"},
        "# GMV 草稿\n\n成交总额草稿口径，含待定口径：是否含未支付订单。",
    ),
    (
        # deprecated 陷阱：与配送时效查询字面高重叠
        "legacy/delivery_sla_old",
        {"type": "Metric", "title": "Delivery SLA Old", "status": "deprecated"},
        "# 旧配送时效口径（已废弃）\n\n配送时效按签收减揽收计算，旧口径：超时阈值为 96 小时。",
    ),
    (
        "legacy/reports_etl",
        {"type": "Attested Computation", "title": "Old Reports ETL", "status": "deprecated"},
        "# 旧报表 ETL（已废弃）\n\n每日订单报表旧 ETL：T+1 生成订单金额汇总，口径与退款抵扣不一致。",
    ),
    (
        # stale 陷阱：stale_after 已过
        "legacy/delivery_eta_stale",
        {"type": "Metric", "title": "Delivery ETA Stale", "status": "stable",
         "stale_after": "2026-10-01T00:00:00Z"},
        "# 配送时效预估（已过期）\n\n同城配送时效预估：平均 4 小时送达，95 分位 8 小时。",
    ),
    (
        "legacy/tax_rate_stale",
        {"type": "Reference", "title": "Tax Rate Stale", "status": "stable",
         "stale_after": "2026-09-30T00:00:00Z"},
        "# 旧税率（已过期）\n\n电商订单税率参考：标准税率 11%，优惠政策已于 2026-09 到期。",
    ),
    (
        # 跨域干扰
        "misc/legal_terms",
        {"type": "Reference", "title": "Legal Terms", "tags": ["legal"], "status": "stable"},
        "# 平台法律条款\n\n用户协议与免责声明，订单争议处理以本条款为准。",
    ),
    (
        "misc/hr_policy",
        {"type": "Reference", "title": "HR Policy", "tags": ["hr"], "status": "stable"},
        "# HR 制度\n\n员工考勤与休假制度，含配送岗位排班相关规定。",
    ),
]


def write_bundle_v2(root: Path) -> Path:
    """写出 fixture Bundle v2，返回 Bundle 根路径。"""
    root.mkdir(parents=True, exist_ok=True)
    for rel_path, frontmatter, body in CONCEPTS:
        file_path = root / f"{rel_path}.md"
        file_path.parent.mkdir(parents=True, exist_ok=True)
        fm_lines = ["---"]
        for key, value in frontmatter.items():
            if isinstance(value, list):
                fm_lines.append(f"{key}:")
                for item in value:
                    fm_lines.append(f"  - {item}")
            else:
                fm_lines.append(f"{key}: {value}")
        fm_lines.append("---")
        file_path.write_text("\n".join(fm_lines) + "\n\n" + body, encoding="utf-8")
    return root


# 标注查询集：(query, 应命中 concept_id 列表, 应排除 concept_id 列表)
# 语义约定：应命中项全部是当前有效知识；应排除项 = 字面/语义相关但已过期
# （stale_after 早于 now）或已废弃（status=deprecated）的陷阱概念——纯语义
# 召回必然字面高重叠而命中陷阱，元数据过滤的价值即体现在把它们挡在召回外。
ANNOTATED_QUERIES: List[Tuple[str, List[str], List[str]]] = [
    ("订单表 字段 客户订单", ["tables/orders"], []),
    ("客户 主数据 会员等级", ["tables/customers"], []),
    ("支付 状态 渠道 金额", ["tables/payments"], []),
    ("物流 配送 签收 运单", ["tables/logistics"], ["legacy/delivery_sla_old", "legacy/delivery_eta_stale"]),
    ("配送时效 超时 阈值 平均送达", ["tables/logistics"], ["legacy/delivery_eta_stale", "legacy/delivery_sla_old"]),
    ("退款 原因 原订单号", ["tables/refunds"], []),
    ("库存 SKU 仓库 锁定", ["tables/inventory"], []),
    ("营收 口径 退款扣除 归因", ["metrics/revenue"], []),
    ("周活跃 用户 活跃用户数", ["metrics/weekly_active_users"], []),
    ("订单 税率 税费", ["tables/orders"], ["legacy/tax_rate_stale"]),
    ("订单报表 汇总 金额", ["tables/orders"], ["legacy/reports_etl"]),
    ("员工 排班 考勤", ["misc/hr_policy"], []),
]


async def load_bundle_v2(root: Path):
    """读入 Bundle v2，返回 Document 列表。"""
    return await OKFReader().read(root)


def load_documents_sync(root: Path):
    return asyncio.run(load_bundle_v2(root))
