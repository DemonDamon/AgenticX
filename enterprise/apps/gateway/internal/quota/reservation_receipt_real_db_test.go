package quota

import (
	"context"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// TestReservationRealDatabase is opt-in locally, mandatory in its dedicated CI
// matrix. It refuses any database name except the explicit disposable fixture.
func TestReservationRealDatabase(t *testing.T) {
	raw := os.Getenv("GATEWAY_QUOTA_TEST_DATABASE_URL")
	if raw == "" {
		t.Skip("requires disposable agx_quota_test database")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Path != "/agx_quota_test" {
		t.Fatal("test requires an explicit agx_quota_test URL")
	}
	cfg, err := database.ParseConfig(os.Getenv("GATEWAY_QUOTA_TEST_DIALECT"), raw)
	if err != nil {
		t.Fatal("invalid fixture database configuration")
	}
	handle, err := database.Open(cfg)
	if err != nil {
		t.Fatal("open fixture database failed")
	}
	t.Cleanup(func() { _ = handle.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err = handle.Ping(ctx); err != nil {
		t.Fatal("fixture database unreachable")
	}
	for _, ddl := range []string{
		`CREATE TABLE IF NOT EXISTS gateway_quota_pool_usage (tenant_id varchar(26) NOT NULL,scope_type varchar(16) NOT NULL,scope_id varchar(128) NOT NULL,period varchar(16) NOT NULL,used_total bigint NOT NULL DEFAULT 0,updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(tenant_id,scope_type,scope_id,period))`,
		`CREATE TABLE IF NOT EXISTS gateway_quota_ledger (id varchar(64) NOT NULL PRIMARY KEY,tenant_id varchar(26) NOT NULL,scope_type varchar(16) NOT NULL,scope_id varchar(128) NOT NULL,period varchar(16) NOT NULL,event varchar(16) NOT NULL,delta_tokens bigint NOT NULL,request_id varchar(128),created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	} {
		if _, err = handle.ExecContext(ctx, ddl); err != nil {
			t.Fatal(err)
		}
	}
	tenant := "qtest-" + strings.TrimPrefix(newLedgerID(), "qled-")
	if len(tenant) > 26 {
		tenant = tenant[:26]
	}
	t.Cleanup(func() {
		for _, table := range []string{"gateway_quota_ledger", "gateway_quota_pool_usage"} {
			_, _ = handle.ExecContext(context.Background(), "DELETE FROM "+table+" WHERE tenant_id=?", tenant)
		}
	})
	tr, qctx := receiptTracker(t, Rule{MonthlyTokens: 1000, DailyTokens: 1000, WeeklyTokens: 1000, PoolScope: PoolScopeTenant, Action: ActionBlock})
	qctx.TenantID = tenant
	tr.poolCounter = &PGPoolCounter{database: handle}
	check := tr.CheckRequest(qctx, 100, 0)
	if !check.Allowed || len(check.Reservation.Lines) != 3 {
		t.Fatalf("admission=%+v", check)
	}
	originalLines := append([]ReservationLine(nil), check.Reservation.Lines...)
	if err = tr.FinishReservation(check.Reservation, 25, 0); err != nil {
		t.Fatal(err)
	}
	// Simulate independently reconstructed completion retries after a lost reply.
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			copy := &ReservationReceipt{ID: check.Reservation.ID, Lines: append([]ReservationLine(nil), originalLines...)}
			if e := tr.FinishReservation(copy, 25, 0); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	conflicting := &ReservationReceipt{ID: check.Reservation.ID, Lines: append([]ReservationLine(nil), originalLines...)}
	if err = tr.FinishReservation(conflicting, 0, 0); err != nil {
		t.Fatal(err)
	}
	for _, line := range originalLines {
		if got := receiptUsed(t, tr, line.Key); got != 25 {
			t.Fatalf("%s real usage=%d want25", line.Kind, got)
		}
	}
	// A ledger insertion error must roll back the usage update in the same tx.
	key := PoolKey{TenantID: tenant, ScopeType: "tok_day", ScopeID: "atomic-error", Period: "2026-01-01"}
	_, err = tr.poolCounter.Add(key, 7, strings.Repeat("x", 200), "synthetic-bad-event")
	if err == nil {
		t.Fatal("expected ledger validation error")
	}
	if got := receiptUsed(t, tr, key); got != 0 {
		t.Fatalf("ledger failure left usage=%d", got)
	}
	t.Logf("real %s receipt: admission, replay-idempotent settlement and atomic rollback passed", handle.Dialect)
}
