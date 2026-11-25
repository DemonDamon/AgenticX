"""两组模型实验脚本的离线断言：不调模型，只保证实验设计的硬约束成立。"""

from __future__ import annotations

import re

try:
    from tests.okf_ablation import audit_offline_claims as audit
    from tests.okf_ablation.cross_model_consistency import TODAY
    from tests.okf_ablation.mixed_fragments import ARMS, ORDERS, TOPICS, build_prompt, classify
except ImportError:
    import audit_offline_claims as audit
    from cross_model_consistency import TODAY
    from mixed_fragments import ARMS, ORDERS, TOPICS, build_prompt, classify


def test_every_expired_topic_has_one_current_counterpart():
    assert len(TOPICS) == 12
    for topic in TOPICS:
        assert topic["current"]["title"] == topic["stale"]["title"]
        assert topic["current"]["stale_after"] > TODAY


def test_stale_and_current_values_are_tellable_apart():
    """过期数值和现行数值的正则不能互相误判，否则答案没法归类。"""
    for topic in TOPICS:
        assert not re.search(topic["stale_re"], topic["current"]["body"]), topic["id"]
        assert not re.search(topic["current_re"], topic["stale"]["body"]), topic["id"]


def test_blind_prompt_shows_no_status_and_meta_prompt_shows_both_headers():
    topic = TOPICS[0]
    for order in ORDERS:
        blind = build_prompt(topic, "blind", order)
        meta = build_prompt(topic, "meta", order)
        assert TODAY in blind and "无法回答" in blind
        assert "status" not in blind and "stale_after" not in blind
        assert "status: deprecated" in meta or "stale_after: 2026-" in meta
        assert "status: stable" in meta and "stale_after: 2027-06-30T00:00:00Z" in meta
    assert ARMS == ("blind", "meta")


def test_classify_puts_answers_in_the_right_bucket():
    topic = TOPICS[0]  # 退款审核：过期 48 小时，现行 24 小时
    assert classify("48小时内完成审核", topic) == "过期"
    assert classify("24小时内", topic) == "现行"
    assert classify("无法回答", topic) == "无法回答"
    assert classify("知识1是48小时，知识2是24小时", topic) == "两条都提"


def test_strip_header_removes_only_the_yaml_header():
    body = audit.strip_header("---\ntype: Policy\nstatus: deprecated\n---\n\n# 退款审核时效\n\n正文")
    assert body == "\n# 退款审核时效\n\n正文"
    assert audit.strip_header("# 没有文件头\n\n正文") == "# 没有文件头\n\n正文"
