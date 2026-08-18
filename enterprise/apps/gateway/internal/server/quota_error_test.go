package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/quota"
)

func TestWriteQuotaErrorKeepsWindowDetails(t *testing.T) {
	recorder := httptest.NewRecorder()
	srv := &Server{}
	srv.writeQuotaError(recorder, quota.CheckResult{
		Allowed:     false,
		Kind:        "token_week",
		Used:        120,
		Limit:       100,
		Period:      "2026-W34",
		ResetAt:     "2026-08-24T00:00:00Z",
		Description: "policy:quota:token_week_exceeded",
		Headers: map[string]string{
			"X-AgenticX-Quota-Period":   "2026-W34",
			"X-AgenticX-Quota-Reset-At": "2026-08-24T00:00:00Z",
		},
	})
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("status=%d want=%d", recorder.Code, http.StatusTooManyRequests)
	}
	var payload struct {
		Error struct {
			Message string `json:"message"`
			Kind    string `json:"kind"`
			Used    int64  `json:"used"`
			Limit   int64  `json:"limit"`
			Period  string `json:"period"`
			ResetAt string `json:"resetAt"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Kind != "token_week" || payload.Error.Used != 120 || payload.Error.Limit != 100 ||
		payload.Error.Period != "2026-W34" || payload.Error.ResetAt != "2026-08-24T00:00:00Z" {
		t.Fatalf("unexpected error payload: %+v", payload.Error)
	}
	if payload.Error.Message != "本周 Token 额度已用尽；新任务已暂停，已开始的任务仅可在安全续跑额度内继续。" {
		t.Fatalf("unexpected user message: %q", payload.Error.Message)
	}
	if strings.Contains(payload.Error.Message, "policy:quota:") {
		t.Fatalf("internal policy code leaked into user message: %q", payload.Error.Message)
	}
	if got := recorder.Header().Get("X-AgenticX-Quota-Reset-At"); got != payload.Error.ResetAt {
		t.Fatalf("reset header=%q body=%q", got, payload.Error.ResetAt)
	}
}

func TestWriteQuotaErrorSurfacesCounterFailureAsRetryableUnavailable(t *testing.T) {
	recorder := httptest.NewRecorder()
	srv := &Server{}
	srv.writeQuotaError(recorder, quota.CheckResult{
		Allowed:     false,
		Kind:        "quota_unavailable",
		Description: "internal database detail",
		Headers: map[string]string{
			"Retry-After":                "1",
			"X-AgenticX-Quota-Retryable": "true",
		},
	})
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d want=%d", recorder.Code, http.StatusServiceUnavailable)
	}
	if recorder.Header().Get("Retry-After") != "1" {
		t.Fatalf("missing retry header: %v", recorder.Header())
	}
	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Kind    string `json:"kind"`
		} `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Error.Code != "50302" || payload.Error.Kind != "quota_unavailable" ||
		payload.Error.Message != "配额计数服务暂不可用，请稍后重试。" {
		t.Fatalf("unexpected payload: %+v", payload.Error)
	}
}

func TestQuotaUserMessageDistinguishesCalendarWindow(t *testing.T) {
	tests := []struct {
		kind string
		want string
	}{
		{kind: "token_day", want: "今日 Token 额度已用尽；新任务已暂停，已开始的任务仅可在安全续跑额度内继续。"},
		{kind: "token_week", want: "本周 Token 额度已用尽；新任务已暂停，已开始的任务仅可在安全续跑额度内继续。"},
		{kind: "monthly", want: "本月 Token 额度已用尽；新任务已暂停，已开始的任务仅可在安全续跑额度内继续。"},
	}
	for _, test := range tests {
		t.Run(test.kind, func(t *testing.T) {
			got := quotaUserMessage(quota.CheckResult{Kind: test.kind, Description: "policy:quota:" + test.kind + "_exceeded"})
			if got != test.want {
				t.Fatalf("message=%q want=%q", got, test.want)
			}
		})
	}
}

func TestMonthlyQuotaErrorCheckPreservesResetMetadata(t *testing.T) {
	check := monthlyQuotaErrorCheck(quota.Decision{
		Allowed:   false,
		Rule:      quota.Rule{MonthlyTokens: 1_000, Action: quota.ActionBlock},
		UsedAfter: 1_050,
		Period:    "2026-08",
	}, time.Date(2026, 8, 18, 12, 0, 0, 0, time.UTC))
	if check.Kind != "monthly" || check.Used != 1_050 || check.Limit != 1_000 || check.Period != "2026-08" {
		t.Fatalf("unexpected monthly check: %+v", check)
	}
	if check.ResetAt != "2026-09-01T00:00:00Z" || check.Headers["X-AgenticX-Quota-Reset-At"] != check.ResetAt {
		t.Fatalf("monthly reset metadata missing: %+v", check)
	}
}
