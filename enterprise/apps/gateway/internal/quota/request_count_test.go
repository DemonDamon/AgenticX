package quota

import (
	"os"
	"testing"
	"time"
)

func TestRequestWindowPeriod(t *testing.T) {
	day := time.Date(2026, 6, 7, 12, 0, 0, 0, time.UTC)
	if got := requestWindowPeriod("day", day); got != "2026-06-07" {
		t.Fatalf("day period=%q", got)
	}
	if got := requestWindowPeriod("month", day); got != "2026-06" {
		t.Fatalf("month period=%q", got)
	}
	if got := requestWindowPeriod("week", day); got != "2026-W23" {
		t.Fatalf("week period=%q", got)
	}
}

func TestRequestWindowKey(t *testing.T) {
	ctx := RequestContext{TenantID: "t1", UserID: "u1"}
	key := requestWindowKey("day", ctx, "2026-06-07")
	if key != "requests::day::req::user::u1::2026-06-07" {
		t.Fatalf("unexpected key %q", key)
	}
}

func TestRequestCountDayBlockAC1(t *testing.T) {
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "on")
	t.Setenv("GATEWAY_REQUEST_COUNT_BACKEND", "local")

	dir := t.TempDir()
	cfgPath := dir + "/q.json"
	usagePath := dir + "/u.json"
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"requestsPerDay":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{UserID: "u1", Role: "staff"}

	for i := 0; i < 100; i++ {
		r := tracker.CheckRequest(ctx, 1, 0)
		if !r.Allowed {
			t.Fatalf("request %d should pass, got %+v", i+1, r)
		}
	}
	r101 := tracker.CheckRequest(ctx, 1, 0)
	if r101.Allowed {
		t.Fatal("101st request should be blocked")
	}
	if r101.Kind != "requests" {
		t.Fatalf("kind=%q", r101.Kind)
	}
	if r101.Limit != 100 {
		t.Fatalf("limit=%d", r101.Limit)
	}
}

func TestRequestCountWithTokenQuotaAC2(t *testing.T) {
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "on")
	t.Setenv("GATEWAY_REQUEST_COUNT_BACKEND", "local")

	dir := t.TempDir()
	cfgPath := dir + "/q.json"
	usagePath := dir + "/u.json"
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":5,"requestsPerDay":100,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{UserID: "u1", Role: "staff"}

	if r := tracker.CheckRequest(ctx, 10, 0); r.Allowed {
		t.Fatal("token quota should block before request count")
	}
	if r := tracker.CheckRequest(ctx, 3, 0); !r.Allowed {
		t.Fatal("within token quota should pass")
	}
}

func TestRequestCountWarnAC3(t *testing.T) {
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "on")
	t.Setenv("GATEWAY_REQUEST_COUNT_BACKEND", "local")

	dir := t.TempDir()
	cfgPath := dir + "/q.json"
	usagePath := dir + "/u.json"
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"requestsPerDay":1,"action":"warn"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{UserID: "u1", Role: "staff"}

	if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed {
		t.Fatal("first request should pass")
	}
	r2 := tracker.CheckRequest(ctx, 1, 0)
	if !r2.Allowed || !r2.Warn {
		t.Fatalf("warn mode should allow with warn flag: %+v", r2)
	}
	if r2.Headers["X-AgenticX-Quota-Warn"] != "requests" {
		t.Fatalf("headers=%v", r2.Headers)
	}
}

func TestRequestCountDisabledAC4(t *testing.T) {
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "off")

	dir := t.TempDir()
	cfgPath := dir + "/q.json"
	usagePath := dir + "/u.json"
	cfg := `{"defaults":{"role":{},"model":{}},"users":{"u1":{"monthlyTokens":0,"requestsPerDay":1,"action":"block"}},"departments":{},"apiTokens":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	ctx := RequestContext{UserID: "u1", Role: "staff"}

	for i := 0; i < 5; i++ {
		if r := tracker.CheckRequest(ctx, 1, 0); !r.Allowed {
			t.Fatalf("request %d should pass when feature off", i+1)
		}
	}
}

func TestRequestCountCrossWindowReset(t *testing.T) {
	t.Setenv("GATEWAY_REQUEST_COUNT_QUOTA", "on")
	counter := newRequestCountCounter(nil, "")
	ctx := RequestContext{UserID: "u1"}
	origNow := requestCountNow
	t.Cleanup(func() { requestCountNow = origNow })

	requestCountNow = func() time.Time {
		return time.Date(2026, 6, 7, 10, 0, 0, 0, time.UTC)
	}
	ok, used, err := counter.Increment(ctx, "day", 2)
	if err != nil || !ok || used != 1 {
		t.Fatalf("first increment: ok=%v used=%d err=%v", ok, used, err)
	}
	ok, used, err = counter.Increment(ctx, "day", 2)
	if err != nil || !ok || used != 2 {
		t.Fatalf("second increment: ok=%v used=%d err=%v", ok, used, err)
	}
	ok, used, err = counter.Increment(ctx, "day", 2)
	if err != nil || ok || used != 2 {
		t.Fatalf("third should block: ok=%v used=%d err=%v", ok, used, err)
	}

	requestCountNow = func() time.Time {
		return time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)
	}
	ok, used, err = counter.Increment(ctx, "day", 2)
	if err != nil || !ok || used != 1 {
		t.Fatalf("next day reset: ok=%v used=%d err=%v", ok, used, err)
	}
}

func TestSanitizeRuleRequestCounts(t *testing.T) {
	r := sanitizeRuleExtended(Rule{
		DailyTokens:      -1,
		WeeklyTokens:     -2,
		RequestsPerDay:   -1,
		RequestsPerWeek:  10,
		RequestsPerMonth: -5,
	})
	if r.DailyTokens != 0 || r.WeeklyTokens != 0 || r.RequestsPerDay != 0 || r.RequestsPerWeek != 10 || r.RequestsPerMonth != 0 {
		t.Fatalf("sanitize failed: %+v", r)
	}
}
