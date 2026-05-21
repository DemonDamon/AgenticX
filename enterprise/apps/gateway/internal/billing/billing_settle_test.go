package billing

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/quota"
)

func TestSettleRefundsOverReservation(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "usage.json")
	cfg := `{"defaults":{"role":{"staff":{"monthlyTokens":10000,"action":"block"}},"model":{}},"users":{},"departments":{}}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	tracker := quota.NewTracker(cfgPath, usagePath)
	svc := NewService(tracker)
	res := svc.Reserve("u1", "", "staff", "m", 1000)
	if !res.Allowed {
		t.Fatalf("reserve denied: %+v", res)
	}
	settle := svc.Settle("u1", "", "staff", "m", 1000, 700)
	if settle.Delta != -300 {
		t.Fatalf("expected delta -300, got %d", settle.Delta)
	}
}
