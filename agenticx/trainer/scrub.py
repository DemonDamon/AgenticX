# agenticx/trainer/scrub.py
"""PII/密钥脱敏：只做训练资产出境前的机械脱敏（正则级），不含语义脱敏。"""
from __future__ import annotations

import re

_PATTERNS = [
    re.compile(r"sk-[a-zA-Z0-9-]{16,}"),          # API keys (sk-ant/sk-...)
    re.compile(r"(?:ghp|gho|github_pat)_[A-Za-z0-9_]{20,}"),  # GitHub tokens
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),  # emails
    re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),   # IPv4
    re.compile(r"(?:Bearer|token|password|passwd|secret)\s*[:=]\s*\S+", re.I),
]

def scrub_text(text: str) -> str:
    out = text
    for p in _PATTERNS:
        out = p.sub("[REDACTED]", out)
    return out

def scrub_trajectory(traj) -> int:
    """原地脱敏 messages 与 tool_calls，返回命中次数。"""
    hits = 0
    for m in traj.messages:
        c = m.get("content")
        if isinstance(c, str):
            n = scrub_text(c)
            hits += n != c
            m["content"] = n
    for tc in traj.tool_calls:
        for k, v in list(tc.arguments.items()):
            if isinstance(v, str):
                n = scrub_text(v)
                hits += n != v
                tc.arguments[k] = n
        n = scrub_text(tc.result_summary)
        hits += n != tc.result_summary
        tc.result_summary = n
    return hits
