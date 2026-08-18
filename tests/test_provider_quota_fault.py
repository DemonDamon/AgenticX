from types import SimpleNamespace

from agenticx.llms.provider_fault import enterprise_token_quota_error


class _QuotaError(RuntimeError):
    def __init__(self, payload: dict):
        super().__init__("request failed with status 429")
        self.response = SimpleNamespace(json=lambda: payload)


def test_extracts_typed_enterprise_quota_response() -> None:
    detail = enterprise_token_quota_error(
        _QuotaError(
            {
                "error": {
                    "code": "42901",
                    "kind": "token_week",
                    "message": "本周 Token 额度已用尽；新任务请稍后再试。",
                    "period": "2026-W34",
                    "resetAt": "2026-08-24T00:00:00Z",
                    "used": 120,
                    "limit": 100,
                }
            }
        )
    )

    assert detail == {
        "kind": "token_week",
        "message": "本周 Token 额度已用尽；新任务请稍后再试。",
        "period": "2026-W34",
        "reset_at": "2026-08-24T00:00:00Z",
        "used": 120,
        "limit": 100,
    }


def test_extracts_json_wrapped_by_provider_sdk() -> None:
    exc = RuntimeError(
        'RateLimitError: upstream said {"error":{"kind":"token_day",'
        '"message":"今日 Token 额度已用尽","resetAt":"2026-08-19T00:00:00Z"}}'
    )

    assert enterprise_token_quota_error(exc) == {
        "kind": "token_day",
        "message": "今日 Token 额度已用尽",
        "reset_at": "2026-08-19T00:00:00Z",
    }


def test_ordinary_rate_limit_is_not_misclassified_as_enterprise_quota() -> None:
    assert enterprise_token_quota_error(RuntimeError("429 Too Many Requests")) is None
