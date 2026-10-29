"""NL rule intents for the draft pipeline."""

from __future__ import annotations

from enum import Enum


class RuleIntent(str, Enum):
    CREATE = "create"
    MODIFY = "modify"
    QUERY = "query"
    TEST_RUN = "test_run"
