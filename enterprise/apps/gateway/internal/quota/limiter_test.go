package quota

import (
	"os"
	"testing"
)

func TestRateLimiterTPM(t *testing.T) {
	lim := NewRateLimiter()
	ok, _ := lim.AllowTPM("u1", 100, 40)
	if !ok {
		t.Fatal("first tpm should pass")
	}
	ok, _ = lim.AllowTPM("u1", 100, 40)
	if !ok {
		t.Fatal("second tpm within limit should pass")
	}
	ok, _ = lim.AllowTPM("u1", 100, 25)
	if ok {
		t.Fatal("tpm should block when exceeded")
	}
}

func TestRateLimiterRPM(t *testing.T) {
	lim := NewRateLimiter()
	for i := 0; i < 3; i++ {
		ok, _ := lim.AllowRPM("r1", 3)
		if !ok {
			t.Fatalf("rpm attempt %d should pass", i+1)
		}
	}
	ok, _ := lim.AllowRPM("r1", 3)
	if ok {
		t.Fatal("rpm should block 4th request")
	}
}

func TestCheckRequestDeptTPM(t *testing.T) {
	dir := t.TempDir()
	cfgPath := dir + "/q.json"
	usagePath := dir + "/u.json"
	if err := os.WriteFile(cfgPath, []byte(`{"defaults":{"role":{},"model":{}},"users":{},"departments":{"d1":{"monthlyTokens":0,"tpm":10,"rpm":0,"action":"block"}},"apiTokens":{}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tracker := NewTracker(cfgPath, usagePath)
	ctx := RequestContext{DeptID: "d1", UserID: "u1", Role: "staff", Model: "m"}
	if r := tracker.CheckRequest(ctx, 5); !r.Allowed {
		t.Fatal("first check should pass")
	}
	r2 := tracker.CheckRequest(ctx, 6)
	if r2.Allowed {
		t.Fatal("second check should block tpm")
	}
	if r2.Description != "policy:quota:tpm_exceeded" {
		t.Fatalf("unexpected desc %s", r2.Description)
	}
}
