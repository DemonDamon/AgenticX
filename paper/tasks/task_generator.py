#!/usr/bin/env python3
"""TeamBench 任务生成器 v0.1

两个功能：
1. generate_baseline() — 写出 Phase 1 的 15 个基础任务 JSON（含已有 3 个 seed）
   到 paper/tasks/data/v0.1/
2. generate_variants(template, n, seed) — 对一个任务模板做参数化变体生成
   （替换整数/日期/人名等表面参数，不改任务结构）

用法：
  .venv/bin/python paper/tasks/task_generator.py --baseline
  .venv/bin/python paper/tasks/task_generator.py --variants 3 --seed 42 --out paper/tasks/data/generated/
"""

from __future__ import annotations

import json
import random
import argparse
import shutil
from copy import deepcopy
from pathlib import Path
from datetime import datetime, timedelta
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parent.parent.parent
TASKS_DIR = ROOT / "paper" / "tasks"
V01_DIR = TASKS_DIR / "data" / "v0.1"
SEED_DIR = TASKS_DIR / "data"

# ── 通用素材库（用于变体生成） ──────────────────────────────────────

NAMES_POOL = [
    "张伟", "李娜", "王强", "陈静", "刘洋", "杨帆", "赵磊", "黄丽",
    "周明", "吴芳", "徐涛", "孙磊", "马超", "朱琳", "胡军",
]
DEPTS_POOL = ["产品部", "研发部", "市场部", "销售部", "运营部", "财务部", "人力部", "客服部"]
ROLES_POOL = ["后端", "前端", "产品", "测试", "设计", "运维", "数据分析", "项目经理"]
PRODUCT_POOL = [
    "智能客服系统", "数据中台", "移动办公 App", "CRM 升级项目", "BI 看板",
    "支付网关", "会员系统", "库存系统", "供应链平台", "营销自动化",
]
RECORDS_TEMPLATES = [
    "完成{module}模块开发，预计下周提测",
    "修复{issue}问题，回归测试已通过",
    "与{partner}完成联调，接口{status}",
    "阻塞：{blocker}，等待{wait}",
    "启动{project}调研，预计{time}输出方案",
    "参与{review}评审，确认{point}项通过",
]

# ── 15 任务构建函数 ──────────────────────────────────────────────────


def build_doc_l_01() -> Dict:  # 周报（已有 seed-01）
    src = json.loads((SEED_DIR / "seed-01-team-weekly-report.json").read_text(encoding="utf-8"))
    src["task_id"] = "t-DOC-L-01"
    src["office_type"] = "document"
    src["team_size"] = 3
    src["roles"] = [
        {"name": "收集员", "role": "collector", "responsibility": "读取记录提取要点并去重"},
        {"name": "分析师", "role": "analyst", "responsibility": "按主题归类，标注跨成员依赖"},
        {"name": "撰写员", "role": "writer", "responsibility": "整合为结构化周报"},
    ]
    src["params"] = {
        "member_count": "t-int(4,8)",
        "records_per_member": "t-int(2,5)",
        "names": "t-choice(NAMES_POOL)",
    }
    return src


def build_doc_m_02() -> Dict:
    return {
        "task_id": "t-DOC-M-02",
        "office_type": "document",
        "task_type": "medium_coupling",
        "team_size": 3,
        "description": "根据产品需求初稿，产出一份PRD评审文档：需求撰写 + 可行性评估 + 风险识别",
        "roles": [
            {"name": "需求撰写员", "role": "writer", "responsibility": "整理需求背景、用户画像、核心功能列表"},
            {"name": "可行性评估员", "role": "evaluator", "responsibility": "评估技术可行性、工期估算、资源需求"},
            {"name": "风险识别员", "role": "risk", "responsibility": "识别技术风险、业务风险、合规风险并给出缓解建议"},
        ],
        "shared_initial": {
            "product_name": "智能客服机器人2.0",
            "draft_requirement": "1) 支持多轮对话上下文理解 2) 对接企业微信 3) 知识库自动更新 4) 满意度自动调研 5) 日承载10万对话量",
            "tech_stack": "Python + FastAPI + LLM + Redis + PostgreSQL",
            "team_headcount": 5,
            "deadline": "Q4上线",
        },
        "verification": {
            "required_sections": ["需求描述", "可行性评估", "风险识别"],
            "required_elements": ["用户画像", "核心功能", "工期估算", "技术风险", "缓解建议"],
            "expected_sections_count": 3,
        },
        "params": {
            "feature_count": "t-int(3,7)",
            "headcount": "t-int(3,8)",
            "product_names": "t-choice(PRODUCT_POOL)",
        },
    }


def build_doc_h_03() -> Dict:
    return {
        "task_id": "t-DOC-H-03",
        "office_type": "document",
        "task_type": "high_coupling",
        "team_size": 4,
        "description": "对供应商合同进行多角色交叉审阅：分别审责任/保密/付款条款，并汇总冲突和修改建议",
        "roles": [
            {"name": "责任条款审阅员", "role": "liability", "responsibility": "检查SLA、违约责任、赔偿上限条款"},
            {"name": "保密条款审阅员", "role": "nda", "responsibility": "检查保密范围、期限、例外、违约条款"},
            {"name": "付款条款审阅员", "role": "payment", "responsibility": "检查付款节点、开票要求、滞纳金条款"},
            {"name": "冲突消解员", "role": "merge", "responsibility": "合并三方意见，识别条款间冲突，给出统一修改建议"},
        ],
        "shared_initial": {
            "contract_clauses": [
                {"id": "C1", "type": "责任", "text": "乙方SLA可用性99%，单次违约赔偿上限为合同金额1%，总赔偿不超5%"},
                {"id": "C2", "type": "保密", "text": "保密期限3年，员工离职后保密义务自动解除，泄密赔偿10万元/次"},
                {"id": "C3", "type": "付款", "text": "预付款30%，验收后60天内付款尾款70%，逾期滞纳金按日0.5%"},
                {"id": "C4", "type": "责任", "text": "重大数据泄露不适用赔偿上限，按实际损失赔偿"},
                {"id": "C5", "type": "保密", "text": "审计数据属双方共有，不受保密期限限制"},
                {"id": "C6", "type": "付款", "text": "验收标准以附件B为准，附件与正文冲突以正文优先"},
            ],
            "industry_standard": {"SLA_min": "99.5%", "nda_term_years": 5, "late_fee_max_daily": "0.05%"},
        },
        "verification": {
            "required_sections": ["责任条款意见", "保密条款意见", "付款条款意见", "冲突识别", "修改建议"],
            "min_conflicts_identified": 2,
            "min_amendments": 4,
            "expected_conflicts": [
                "保密期限3年 vs 行业标准5年",
                "滞纳金0.5%/日 vs 行业标准上限0.05%/日",
                "离职后保密义务解除 vs 行业惯例",
            ],
        },
        "params": {
            "clause_count": "t-int(5,9)",
            "sla": "t-float(98.5,99.9,1)",
        },
    }


def build_data_l_01() -> Dict:
    sku_a = [f"SKU{i:03d}" for i in range(1, 31)]
    channel_a_rows = []
    channel_b_rows = []
    for i, sku in enumerate(sku_a):
        qty_a = 50 + (i * 7) % 200
        channel_a_rows.append({"sku": sku, "channel": "A", "qty": qty_a, "revenue": qty_a * (99 + i % 50)})
        qty_b = 30 + (i * 11) % 180
        channel_b_rows.append({"sku": sku, "channel": "B", "qty": qty_b, "revenue": qty_b * (89 + i % 60)})
    return {
        "task_id": "t-DATA-L-01",
        "office_type": "data",
        "task_type": "low_coupling",
        "team_size": 2,
        "description": "汇总月度销售渠道A和渠道B的销售指标，产出合并月度销售汇总表",
        "roles": [
            {"name": "渠道A汇总员", "role": "ch_a", "responsibility": "统计渠道A的销量、销售额、Top3 SKU"},
            {"name": "渠道B汇总员", "role": "ch_b", "responsibility": "统计渠道B的销量、销售额、Top3 SKU"},
        ],
        "shared_initial": {
            "channel_a": channel_a_rows,
            "channel_b": channel_b_rows,
            "period": "2026年8月",
        },
        "verification": {
            "required_sections": ["渠道A汇总", "渠道B汇总", "合计"],
            "required_elements": ["总销量", "总销售额", "Top3 SKU"],
            "expected_total_qty": sum(r["qty"] for r in channel_a_rows) + sum(r["qty"] for r in channel_b_rows),
            "expected_total_revenue": sum(r["revenue"] for r in channel_a_rows) + sum(r["revenue"] for r in channel_b_rows),
        },
        "params": {
            "sku_count": "t-int(20,40)",
            "qty_base": "t-int(20,100)",
        },
    }


def build_data_m_02() -> Dict:
    departments = ["研发部", "市场部", "销售部", "运营部", "人力部"]
    budget_rows = []
    expected_items = []
    for i, dept in enumerate(departments):
        planned = 100000 + i * 50000
        actual = int(planned * (0.75 + 0.05 * (i % 5)))
        deviation = actual - planned
        dev_pct = deviation / planned * 100
        budget_rows.append({"department": dept, "planned": planned, "actual": actual, "deviation": deviation, "deviation_pct": round(dev_pct, 2)})
        if abs(dev_pct) >= 10:
            expected_items.append(dept)
    return {
        "task_id": "t-DATA-M-02",
        "office_type": "data",
        "task_type": "medium_coupling",
        "team_size": 3,
        "description": "产出部门预算偏差分析报告：实际提取→偏差计算→原因分析→建议",
        "roles": [
            {"name": "数据提取员", "role": "extract", "responsibility": "提取各部门计划/实际金额，计算偏差"},
            {"name": "偏差分析师", "role": "analyst", "responsibility": "识别偏差>10%的部门，按正负分类"},
            {"name": "报告撰写员", "role": "writer", "responsibility": "给出原因解读和3条成本管控建议"},
        ],
        "shared_initial": {"budget_rows": budget_rows, "period": "2026年Q2"},
        "verification": {
            "required_sections": ["偏差明细", "偏差分类", "原因分析", "管控建议"],
            "min_deviation_items": max(len(expected_items), 2),
            "expected_deviation_depts": expected_items,
            "suggestion_count": 3,
        },
        "params": {
            "dept_count": "t-int(4,8)",
            "base_budget": "t-int(50000, 200000)",
            "deviation_std": "t-int(5,25)",
        },
    }


def build_data_h_03() -> Dict:  # 跨源核对（已有 seed-03）
    src = json.loads((SEED_DIR / "seed-03-cross-source-data-check.json").read_text(encoding="utf-8"))
    src["task_id"] = "t-DATA-H-03"
    src["office_type"] = "data"
    src["team_size"] = 3
    src["roles"] = [
        {"name": "A源核对员", "role": "checker_a", "responsibility": "读表A与B快照比对找A有B无和数值不一致"},
        {"name": "B源核对员", "role": "checker_b", "responsibility": "读表B与A快照比对找B有A无和数值不一致"},
        {"name": "合并员", "role": "merge", "responsibility": "合并双向差异、去重、产出核对报告"},
    ]
    src["params"] = {
        "row_count": "t-int(40,80)",
        "mismatch_count": "t-int(3,10)",
        "a_only_count": "t-int(2,6)",
        "b_only_count": "t-int(2,6)",
    }
    return src


def build_proj_l_01() -> Dict:
    sprints = ["S1", "S2", "S3"]
    tasks_list = []
    for s in sprints:
        for i in range(4):
            tasks_list.append({
                "id": f"{s}-T{i+1}",
                "sprint": s,
                "name": f"{s}迭代子任务{i+1}",
                "owner": random.Random(0).choice(NAMES_POOL),
                "status": random.Random(i).choice(["done", "in_progress", "done", "done"]),
            })
    completed = [t for t in tasks_list if t["status"] == "done"]
    return {
        "task_id": "t-PROJ-L-01",
        "office_type": "project",
        "task_type": "low_coupling",
        "team_size": 3,
        "description": "基于3个迭代的任务数据产出迭代回顾总结：提取完成项、提取问题、撰写报告",
        "roles": [
            {"name": "完成项提取员", "role": "collect_done", "responsibility": "汇总所有已完成任务，按迭代分组"},
            {"name": "问题提取员", "role": "collect_issue", "responsibility": "识别未完成/延期任务，分类问题类型"},
            {"name": "报告撰写员", "role": "writer", "responsibility": "整合为迭代回顾报告"},
        ],
        "shared_initial": {"sprints": sprints, "tasks": tasks_list},
        "verification": {
            "required_sections": ["本次完成", "遗留问题", "改进建议"],
            "min_completed_tasks": len(completed),
            "min_sprints_mentioned": len(sprints),
        },
        "params": {
            "sprint_count": "t-int(2,5)",
            "tasks_per_sprint": "t-int(3,7)",
        },
    }


def build_proj_m_02() -> Dict:  # 风险预警（已有 seed-02）
    src = json.loads((SEED_DIR / "seed-02-project-risk-alert.json").read_text(encoding="utf-8"))
    src["task_id"] = "t-PROJ-M-02"
    src["office_type"] = "project"
    src["team_size"] = 3
    src["roles"] = [
        {"name": "进度收集员", "role": "tracker", "responsibility": "读取看板提取延期/阻塞风险任务"},
        {"name": "根因分析师", "role": "diagnoser", "responsibility": "分析每个风险任务的延期根因"},
        {"name": "建议员", "role": "advisor", "responsibility": "给出3条可执行缓解建议"},
    ]
    src["params"] = {
        "task_count": "t-int(6,12)",
        "milestone_count": "t-int(2,5)",
        "delay_prob": "t-float(0.1,0.4,2)",
    }
    return src


def build_proj_h_03() -> Dict:
    people = ["张工程师", "李设计师", "王产品", "陈测试", "刘前端"]
    proj_tasks = []
    deps = []
    skill_req = {"P1": ["研发", "测试"], "P2": ["设计", "产品"], "P3": ["前端", "研发", "测试"]}
    for p in ["P1", "P2", "P3"]:
        for i in range(3):
            proj_tasks.append({
                "id": f"{p}-T{i+1}",
                "project": p,
                "name": f"{p}项目任务{i+1}",
                "est_hours": 16 + i * 8,
                "start": f"2026-09-0{i+1}",
                "end": f"2026-09-0{i+5}",
                "required_skills": [random.Random(i).choice(skill_req[p])],
            })
    # 引入冲突：张工程师同时被 P1-T1 和 P3-T1 在 9/1-5 占用
    proj_tasks[0]["assignee"] = "张工程师"
    proj_tasks[-1]["assignee"] = "张工程师"
    proj_tasks[0]["start"] = "2026-09-01"; proj_tasks[0]["end"] = "2026-09-05"
    proj_tasks[-1]["start"] = "2026-09-02"; proj_tasks[-1]["end"] = "2026-09-06"
    return {
        "task_id": "t-PROJ-H-03",
        "office_type": "project",
        "task_type": "high_coupling",
        "team_size": 4,
        "description": "检测3个项目的资源冲突，完成重排：3项目分别梳理需求→冲突消解→重排",
        "roles": [
            {"name": "P1需求员", "role": "p1", "responsibility": "梳理P1项目资源需求和关键路径"},
            {"name": "P2需求员", "role": "p2", "responsibility": "梳理P2项目资源需求和关键路径"},
            {"name": "P3需求员", "role": "p3", "responsibility": "梳理P3项目资源需求和关键路径"},
            {"name": "排期冲突消解员", "role": "solver", "responsibility": "检测人员重叠冲突，给出重排方案"},
        ],
        "shared_initial": {"people": people, "tasks": proj_tasks},
        "verification": {
            "required_sections": ["项目需求汇总", "冲突列表", "重排方案"],
            "min_conflicts_identified": 1,
            "min_rescheduling_actions": 2,
        },
        "params": {
            "project_count": "t-int(3,5)",
            "tasks_per_project": "t-int(2,5)",
            "conflict_count": "t-int(1,4)",
        },
    }


def build_cross_l_01() -> Dict:
    hr = ["合同签署", "社保公积金开户", "员工手册发放", "背景调查确认", "门禁开通申请"]
    it = ["企业邮箱开通", "电脑分配", "VPN配置", "办公软件授权", "代码仓库权限"]
    admin = ["工位分配", "门禁卡制作", "办公用品领取", "入职礼包发放"]
    return {
        "task_id": "t-CROSS-L-01",
        "office_type": "cross_dept",
        "task_type": "low_coupling",
        "team_size": 3,
        "description": "核查新员工入职的三部门（HR/IT/Admin）清单完整性，产出最终checklist",
        "roles": [
            {"name": "HR清单核对员", "role": "hr", "responsibility": "检查人力资源类5项是否完成"},
            {"name": "IT清单核对员", "role": "it", "responsibility": "检查IT配置类5项是否完成"},
            {"name": "Admin清单核对员", "role": "admin", "responsibility": "检查行政类4项是否完成"},
        ],
        "shared_initial": {
            "new_hire": "周晓彤",
            "hr_checklist": hr,
            "it_checklist": it,
            "admin_checklist": admin,
            "hr_completed": ["合同签署", "背景调查确认"],
            "it_completed": ["企业邮箱开通", "办公软件授权"],
            "admin_completed": ["工位分配"],
        },
        "verification": {
            "required_sections": ["HR清单", "IT清单", "Admin清单"],
            "min_total_items": len(hr) + len(it) + len(admin),
            "min_completed_report_correct": 2 + 2 + 1,
            "min_pending_report_correct": 3 + 3 + 3,
        },
        "params": {"hr_item_count": "t-int(4,7)", "it_item_count": "t-int(4,7)", "admin_item_count": "t-int(3,6)"},
    }


def build_cross_m_02() -> Dict:
    return {
        "task_id": "t-CROSS-M-02",
        "office_type": "cross_dept",
        "task_type": "medium_coupling",
        "team_size": 3,
        "description": "处理客户投诉工单：提取客诉→技术根因分析→撰写回复邮件",
        "roles": [
            {"name": "客诉提取员", "role": "extract", "responsibility": "从工单中提取客户信息、问题描述、期望诉求"},
            {"name": "技术分析师", "role": "tech", "responsibility": "结合技术日志，分析根因和修复方案"},
            {"name": "回复撰写员", "role": "reply", "responsibility": "撰写客户回复邮件（含解决方案+时限+责任人）"},
        ],
        "shared_initial": {
            "ticket": {
                "id": "TK-20260822-001",
                "customer": "蓝箭科技有限公司",
                "contact": "王经理",
                "issue": "登录页面间歇性白屏，近三天发生5次，每次约3分钟恢复，严重影响销售人员出差期间使用。已排除本地网络问题。",
                "severity": "P1",
                "expectation": "尽快查明原因并给出修复计划，若短期无法修复需给出临时方案。",
            },
            "tech_logs": [
                "08-20 09:12 ERR frontend_bundle_timeout 3s",
                "08-20 14:38 ERR redis_connection_pool_exhausted",
                "08-21 10:05 ERR cdn_cache_stale",
                "08-21 15:47 ERR frontend_bundle_timeout",
                "08-22 08:22 WARN redis_pool_grow_triggered",
            ],
        },
        "verification": {
            "required_sections": ["客诉摘要", "根因分析", "回复邮件"],
            "reply_required_elements": ["致歉", "根因", "修复方案", "修复时限", "责任人"],
            "reply_element_count_min": 4,
        },
        "params": {"error_count": "t-int(3,8)", "severity": "t-choice(['P1','P2','P3'])"},
    }


def build_cross_h_03() -> Dict:
    return {
        "task_id": "t-CROSS-H-03",
        "office_type": "cross_dept",
        "task_type": "high_coupling",
        "team_size": 4,
        "description": "跨部门季度需求对齐：三部门各自提需求→优先级仲裁，产出Q4优先级排序",
        "roles": [
            {"name": "研发部代表", "role": "rd", "responsibility": "提出研发侧Q4关键需求（技术债、基建），陈述重要性和资源要求"},
            {"name": "市场部代表", "role": "mk", "responsibility": "提出市场侧Q4需求（活动、宣发、增长），陈述ROI预期"},
            {"name": "产品部代表", "role": "pd", "responsibility": "提出产品侧Q4需求（功能、体验、合规），陈述用户影响"},
            {"name": "优先级仲裁员", "role": "arb", "responsibility": "按影响×紧急×资源三维打分，输出最终排序+冲突解决说明"},
        ],
        "shared_initial": {
            "quarter": "Q4 2026",
            "total_budget_hours": 2000,
            "demands": [
                {"id": "RD-01", "name": "技术债重构-支付模块", "dept": "研发", "impact": 8, "urgency": 7, "hours": 400},
                {"id": "RD-02", "name": "可观测性平台升级", "dept": "研发", "impact": 6, "urgency": 4, "hours": 300},
                {"id": "MK-01", "name": "双十一大促活动页+投放", "dept": "市场", "impact": 9, "urgency": 9, "hours": 250},
                {"id": "MK-02", "name": "品牌升级Slogan全渠道宣发", "dept": "市场", "impact": 7, "urgency": 6, "hours": 200},
                {"id": "PD-01", "name": "移动端信息无障碍适配", "dept": "产品", "impact": 8, "urgency": 8, "hours": 350},
                {"id": "PD-02", "name": "会员体系v2改版", "dept": "产品", "impact": 7, "urgency": 5, "hours": 500},
            ],
        },
        "verification": {
            "required_sections": ["部门需求汇总", "打分与冲突说明", "Q4最终优先级"],
            "min_ranked_items": 5,
            "min_budget_total": 1800,
            "conflict_min_identified": 1,
        },
        "params": {
            "demand_count": "t-int(5,10)",
            "budget_hours": "t-int(1200,3000)",
        },
    }


def build_content_l_01() -> Dict:
    return {
        "task_id": "t-CONTENT-L-01",
        "office_type": "content",
        "task_type": "low_coupling",
        "team_size": 3,
        "description": "公众号推文生产：撰写初稿→事实核对→文字润色",
        "roles": [
            {"name": "初稿撰写员", "role": "writer", "responsibility": "撰写产品宣发推文初稿"},
            {"name": "事实核对员", "role": "fact", "responsibility": "核对产品参数、价格、发布时间等事实错误"},
            {"name": "润色员", "role": "polish", "responsibility": "润色标题和行文，确保符合公众号风格"},
        ],
        "shared_initial": {
            "product_brief": {
                "name": "SmartDesk 2.0 智能升降桌",
                "price": 2299,
                "launch_date": "2026-09-10",
                "features": [
                    "双电机静音升降，速度38mm/s",
                    "久坐提醒+健康坐姿算法",
                    "60kg承重，三年质保",
                    "无线充电面板+USB-C 65W快充",
                ],
                "target_audience": "互联网从业者/居家办公人群",
                "word_count_target": 1500,
            },
            "fact_check_reference": {
                "name": "SmartDesk 2.0",
                "price_rmb": 2299,
                "speed_mm_per_s": 38,
                "weight_capacity_kg": 60,
                "warranty_years": 3,
                "usb_power_w": 65,
            },
        },
        "verification": {
            "required_sections": ["标题", "正文", "卖点小结"],
            "min_word_count": 800,
            "fact_error_count_max": 1,
            "required_facts_count_min": 3,
        },
        "params": {
            "feature_count": "t-int(3,6)",
            "target_word": "t-int(800,2000)",
        },
    }


def build_content_m_02() -> Dict:
    return {
        "task_id": "t-CONTENT-M-02",
        "office_type": "content",
        "task_type": "medium_coupling",
        "team_size": 3,
        "description": "产品宣发文案及双平台适配：主文案→抖音版→公众号版",
        "roles": [
            {"name": "主文案撰写员", "role": "main", "responsibility": "写出3个核心卖点+主传播slogan"},
            {"name": "抖音适配员", "role": "douyin", "responsibility": "适配抖音短视频口播脚本（前3秒钩子+15秒卖点+结尾动作）"},
            {"name": "公众号适配员", "role": "wechat", "responsibility": "适配公众号深度图文（长文案+小标题分层）"},
        ],
        "shared_initial": {
            "product": {
                "name": "SmartDesk 2.0 智能升降桌",
                "campaign_theme": "告别久坐，30天重塑健康工作习惯",
                "core_benefits": ["健康", "效率", "品质"],
            },
        },
        "verification": {
            "required_sections": ["主文案+Slogan", "抖音脚本", "公众号图文稿"],
            "min_usps": 3,
            "douyin_hook_first_3s": True,
            "douyin_cta_end": True,
            "wechat_subheadings_min": 3,
        },
        "params": {"usps": "t-int(3,5)", "douyin_sec": "t-int(15,60)"},
    }


def build_content_h_03() -> Dict:
    return {
        "task_id": "t-CONTENT-H-03",
        "office_type": "content",
        "task_type": "high_coupling",
        "team_size": 4,
        "description": "技术产品发布会全稿：主演讲稿+竞品对比+技术Q&A+业务Q&A",
        "roles": [
            {"name": "主稿撰写员", "role": "keynote", "responsibility": "撰写20分钟发布会主演讲稿，含3个核心信息点"},
            {"name": "竞品对比分析师", "role": "comp", "responsibility": "对比3款竞品，输出差异化论据"},
            {"name": "技术Q&A整理员", "role": "tech_qa", "responsibility": "预判10+常见技术问题并撰写标准答复"},
            {"name": "业务Q&A整理员", "role": "biz_qa", "responsibility": "预判10+常见商业问题并撰写标准答复"},
        ],
        "shared_initial": {
            "product_name": "AgenticX 2.0 企业级智能体开发平台",
            "core_messages": [
                "开箱即用的多智能体编排，企业部署效率提升5倍",
                "全链路可审计，满足金融/政府合规要求",
                "MCP协议兼容，无缝对接企业现有系统",
            ],
            "competitors": [
                {"name": "AutoGen", "position": "开源框架", "weakness": "企业级治理缺失"},
                {"name": "CrewAI", "position": "开源框架", "weakness": "合规审计弱"},
                {"name": "LangGraph", "position": "工作流引擎", "weakness": "学习曲线陡，原生Agent能力弱"},
            ],
            "tech_questions_count_target": 12,
            "biz_questions_count_target": 10,
        },
        "verification": {
            "required_sections": ["主演讲稿", "竞品对比", "技术Q&A", "业务Q&A"],
            "core_msg_covered_all": True,
            "tech_qa_count_min": 10,
            "biz_qa_count_min": 8,
            "competitor_count_covered": 3,
        },
        "params": {
            "tech_qa_n": "t-int(8,15)",
            "biz_qa_n": "t-int(8,15)",
            "comp_n": "t-int(2,5)",
        },
    }


# ── 主入口 ──────────────────────────────────────────────────────────

ALL_BUILDERS = {
    "t-DOC-L-01": build_doc_l_01,
    "t-DOC-M-02": build_doc_m_02,
    "t-DOC-H-03": build_doc_h_03,
    "t-DATA-L-01": build_data_l_01,
    "t-DATA-M-02": build_data_m_02,
    "t-DATA-H-03": build_data_h_03,
    "t-PROJ-L-01": build_proj_l_01,
    "t-PROJ-M-02": build_proj_m_02,
    "t-PROJ-H-03": build_proj_h_03,
    "t-CROSS-L-01": build_cross_l_01,
    "t-CROSS-M-02": build_cross_m_02,
    "t-CROSS-H-03": build_cross_h_03,
    "t-CONTENT-L-01": build_content_l_01,
    "t-CONTENT-M-02": build_content_m_02,
    "t-CONTENT-H-03": build_content_h_03,
}


def generate_baseline() -> None:
    V01_DIR.mkdir(parents=True, exist_ok=True)
    for tid, builder in ALL_BUILDERS.items():
        data = builder()
        data.setdefault("task_id", tid)
        out_path = V01_DIR / f"{tid}.json"
        out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tt = data.get("task_type", "?")
        n = data.get("team_size", "?")
        roles = [r["name"] for r in data.get("roles", [])]
        print(f"[OK] {tid:<16} type={tt:<15} N={n}  roles={roles} -> {out_path.name}")


def _apply_param_variant(obj: Any, rng: random.Random) -> Any:
    """在 dict 中查找以 `t-` 开头的参数表达式并用 rng 替换。（v0.1简化：不解析表达式，只替换具体字段）"""
    return obj  # v0.1 参数化表达式暂不启用（变体生成器可后续完善）

def generate_variants_for(template: Dict, variants_count: int, seed: int, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    tid = template["task_id"]
    for v in range(variants_count):
        rng = random.Random(seed * 1000 + v)
        variant = deepcopy(template)
        variant = _apply_param_variant(variant, rng)
        variant["variant_id"] = f"{tid}__v{v:02d}"
        variant["variant_seed"] = seed * 1000 + v
        out_path = out_dir / f"{tid}__v{v:02d}.json"
        out_path.write_text(json.dumps(variant, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--baseline", action="store_true", help="生成 Phase 1 的 15 个基础任务 JSON")
    ap.add_argument("--variants", type=int, default=0, help="每个基础任务生成多少个参数化变体")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", type=str, default=str(TASKS_DIR / "data" / "generated"))
    args = ap.parse_args()

    if args.baseline:
        generate_baseline()
    if args.variants > 0:
        out_dir = Path(args.out)
        # 先生成 baseline（如果还没有）再变体
        if not V01_DIR.exists() or not any(V01_DIR.glob("*.json")):
            generate_baseline()
        for f in sorted(V01_DIR.glob("*.json")):
            tpl = json.loads(f.read_text(encoding="utf-8"))
            generate_variants_for(tpl, args.variants, args.seed, out_dir)
        print(f"\n变体生成完毕 -> {out_dir}")
    if not args.baseline and args.variants == 0:
        ap.print_help()


if __name__ == "__main__":
    main()
