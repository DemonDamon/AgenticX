#!/usr/bin/env python3
"""AgenticX security evaluation — red-team corpus, judge, scorecards.

SP2 ``security-eval-and-admission``: attack corpus (guard-pattern reverse
generation + versioned jailbreak seed) x model matrix -> safety scorecard
(md + json), feeding admin-console model admission thresholds.

Author: Damon Li
"""

from agenticx.security_eval.corpus import AttackCase, build_corpus, corpus_version
from agenticx.security_eval.judge import Judge
from agenticx.security_eval.runner import EvalRun, MockInvoker, ModelRef, run_eval

__all__ = [
    "AttackCase",
    "Judge",
    "EvalRun",
    "MockInvoker",
    "ModelRef",
    "build_corpus",
    "corpus_version",
    "run_eval",
]
