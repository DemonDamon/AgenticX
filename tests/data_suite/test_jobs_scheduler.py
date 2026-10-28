from datetime import datetime

from agenticx.data_suite.jobs.dsl import JobNode, JobSpec
from agenticx.data_suite.jobs.scheduler import DataJobScheduler, cron_matches


def test_cron_every_minute_due():
    when = datetime(2026, 10, 27, 3, 15)
    assert cron_matches("* * * * *", when) is True


def test_cron_two_am_not_due_at_three():
    when = datetime(2026, 10, 27, 3, 0)
    assert cron_matches("0 2 * * *", when) is False
    assert cron_matches("0 2 * * *", datetime(2026, 10, 27, 2, 0)) is True


def test_scheduler_due():
    always = JobSpec(name="a", nodes=[], schedule="* * * * *")
    night = JobSpec(name="b", nodes=[], schedule="0 2 * * *")
    sched = DataJobScheduler(jobs=[always, night])
    due = sched.due(datetime(2026, 10, 27, 3, 0))
    assert [j.name for j in due] == ["a"]
