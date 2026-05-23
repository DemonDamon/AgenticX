package quota

import "testing"

func TestCheckMCPToolCallRateLimit(t *testing.T) {
	tr := NewTracker("", "")
	ctx := RequestContext{UserID: "u-mcp", TenantID: "t1"}
	for i := 0; i < 3; i++ {
		check := tr.CheckMCPToolCall(ctx, "demo", 3)
		if !check.Allowed {
			t.Fatalf("call %d should be allowed", i+1)
		}
	}
	check := tr.CheckMCPToolCall(ctx, "demo", 3)
	if check.Allowed {
		t.Fatal("expected rate limit on 4th call")
	}
	if check.Description != "mcp:rate_limited" {
		t.Fatalf("description %q", check.Description)
	}
}
