#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'tools'))

from rule_matching_tool import RuleMatchingTool
from rule_models import RuleConfig, MatchType

def test_complex_text():
    tool = RuleMatchingTool()
    
    rules = [
        RuleConfig(
            intent_code="greeting",
            description="问候语识别",
            match_strategy=MatchType.FULL_MATCH,
            patterns=["你好", "hello", "hi"],
            priority=1,
            confidence_weight=1.0
        ),
        RuleConfig(
            intent_code="phone_inquiry",
            description="电话号码查询",
            match_strategy=MatchType.REGEX_MATCH,
            patterns=[r"\d{11}", r"电话.*\d+", r"手机.*\d+"],
            priority=2,
            confidence_weight=0.9
        ),
        RuleConfig(
            intent_code="time_inquiry",
            description="时间查询",
            match_strategy=MatchType.FULL_MATCH,
            patterns=["现在几点", "什么时间", "时间"],
            priority=1,
            confidence_weight=0.8
        )
    ]
    
    complex_text = "你好！我想查询一下我的电话号码13812345678，现在几点了？"
    
    result = tool.execute(
        text=complex_text,
        rules=rules
    )
    
    print(f"Success: {result['success']}")
    print(f"Total matches: {len(result['data']['matches'])}")
    print(f"Match details:")
    for i, match in enumerate(result['data']['matches']):
        print(f"  {i+1}. Intent: {match['matched_intent']}, Text: '{match['matches'][0]['text']}', Confidence: {match['confidence']}")
    
    return result

if __name__ == "__main__":
    test_complex_text()