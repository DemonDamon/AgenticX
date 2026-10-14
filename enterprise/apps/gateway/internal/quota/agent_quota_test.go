package quota

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAgentMonthlyQuotaIsSeparateFromUser(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "quotas.json")
	usagePath := filepath.Join(dir, "usage.json")
	cfg := `{
	  "defaults": {"role": {"staff": {"monthlyTokens": 1000, "action": "block"}}, "model": {}},
	  "users": {},
	  "departments": {},
	  "agents": {"bot-1": {"monthlyTokens": 10, "action": "block"}}
	}`
	if err := os.WriteFile(cfgPath, []byte(cfg), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	tracker := NewTracker(cfgPath, usagePath, nil)
	agent := RequestContext{UserID: "u1", Role: "staff", AgentID: "bot-1"}
	if decision := tracker.CheckAndAddContext(agent, 6, LedgerEventReserve); !decision.Allowed {
		t.Fatalf("first agent charge denied: %+v", decision)
	}
	if decision := tracker.CheckAndAddContext(agent, 5, LedgerEventReserve); decision.Allowed {
		t.Fatalf("agent quota should block the second charge: %+v", decision)
	}
	plain := RequestContext{UserID: "u1", Role: "staff"}
	if decision := tracker.CheckAndAddContext(plain, 20, LedgerEventReserve); !decision.Allowed {
		t.Fatalf("user without agent id should keep the staff quota: %+v", decision)
	}
	if !tracker.RollbackContext(agent, 6) {
		t.Fatal("agent rollback failed")
	}
	if decision := tracker.CheckAndAddContext(agent, 6, LedgerEventReserve); !decision.Allowed {
		t.Fatalf("agent charge after rollback denied: %+v", decision)
	}
}
