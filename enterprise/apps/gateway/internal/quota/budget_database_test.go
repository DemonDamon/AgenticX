package quota

import (
	"context"
	"crypto/rand"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

func TestBudgetTargetLockOrderAndInsertSQL(t *testing.T) {
	targets := []budgetTarget{
		{rule: BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth}, dimension: "user", key: "u"},
		{rule: BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth}, dimension: "company", key: "a"},
		{rule: BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodDay}, dimension: "dept", key: "d"},
		{rule: BudgetRule{Unit: BudgetUnitCostUSD, Period: BudgetPeriodMonth}, dimension: "company", key: "a"},
		{rule: BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth}, dimension: "tenant", key: "t"},
	}
	sortBudgetTargets(targets)
	got := make([]string, len(targets))
	for i, target := range targets {
		got[i] = target.dimension + "/" + target.key + "/" + target.rule.Unit + "/" + target.rule.Period
	}
	want := []string{
		"company/a/cost_usd/month",
		"company/a/tokens/month",
		"dept/d/tokens/day",
		"tenant/t/tokens/month",
		"user/u/tokens/month",
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("lock order=%v", got)
	}
	postgres := budgetUsageInsertSQL(database.PostgreSQL)
	if !strings.Contains(postgres, "ON CONFLICT (tenant_id, dimension, dimension_key, period, unit) DO NOTHING") {
		t.Fatalf("postgres insert SQL: %s", postgres)
	}
	mysql := budgetUsageInsertSQL(database.MySQL)
	if !strings.Contains(mysql, "INSERT IGNORE INTO gateway_budget_usage") {
		t.Fatalf("mysql insert SQL: %s", mysql)
	}
}

func TestBudgetDatabaseSharedHardLimitsAreAtomicAcrossReplicas(t *testing.T) {
	for _, dialect := range []database.Dialect{database.MySQL, database.PostgreSQL} {
		t.Run(string(dialect), func(t *testing.T) {
			handle, state := budgetTestDatabase(t, dialect)
			dir := t.TempDir()
			cfg := writeBudgetConfig(t, dir, BudgetConfig{
				Version:       2,
				CompanyLimits: CompanyMonthlyLimits{Tokens: 100},
				Departments:   map[string]BudgetRule{"d1": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 90, Action: ActionWarn}},
				Defaults:      BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 200, Action: ActionBlock},
			})
			first := newBudgetDatabaseTracker(t, handle, dir, cfg)
			second := newBudgetDatabaseTracker(t, handle, dir, cfg)
			contexts := []RequestContext{
				{TenantID: "tenant-a", DeptID: "d1", UserID: "alice"},
				{TenantID: "tenant-a", DeptID: "d1", UserID: "bob"},
			}
			var wg sync.WaitGroup
			decisions := make([]BudgetDecision, 2)
			for i := range decisions {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					tracker := first
					if i == 1 {
						tracker = second
					}
					decisions[i] = tracker.CheckBudget(contexts[i], 60, 0)
				}(i)
			}
			wg.Wait()
			allowed := 0
			for _, decision := range decisions {
				if decision.Allowed {
					allowed++
				} else if !decision.Blocked || decision.Dimension != "company" {
					t.Fatalf("unexpected denial: %+v", decision)
				}
			}
			if allowed != 1 {
				t.Fatalf("two replicas admitted %d requests through one company cap: %+v", allowed, decisions)
			}
			state.mu.Lock()
			defer state.mu.Unlock()
			for _, dimension := range []string{"company", "dept"} {
				var total float64
				for key, value := range state.usage {
					if strings.Contains(key, "|"+dimension+"|") {
						total += value
					}
				}
				if total != 60 {
					t.Fatalf("%s usage=%v want 60; full usage=%v", dimension, total, state.usage)
				}
			}
		})
	}
}

func TestBudgetDatabaseReservationIsAllOrNothingAndFailsClosed(t *testing.T) {
	handle, state := budgetTestDatabase(t, database.MySQL)
	state.failUpdateAt = 2
	dir := t.TempDir()
	cfg := writeBudgetConfig(t, dir, BudgetConfig{
		Version:       2,
		CompanyLimits: CompanyMonthlyLimits{Tokens: 100},
		Defaults:      BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 100, Action: ActionBlock},
	})
	tracker := newBudgetDatabaseTracker(t, handle, dir, cfg)
	decision := tracker.CheckBudget(RequestContext{TenantID: "tenant-a", UserID: "u1"}, 30, 0)
	if decision.Allowed || !decision.StorageError {
		t.Fatalf("failed second ledger write must deny admission: %+v", decision)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	if len(state.usage) != 0 || len(state.receipts) != 0 {
		t.Fatalf("failed multi-target transaction committed partial state: usage=%v receipts=%v", state.usage, state.receipts)
	}
}

func TestBudgetDatabaseSettleAndRollbackReceiptsAreIdempotent(t *testing.T) {
	handle, state := budgetTestDatabase(t, database.MySQL)
	dir := t.TempDir()
	cfg := writeBudgetConfig(t, dir, BudgetConfig{
		Version:       2,
		CompanyLimits: CompanyMonthlyLimits{Tokens: 100, CostUSD: 10},
		Defaults:      BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 100, Action: ActionBlock},
	})
	tracker := newBudgetDatabaseTracker(t, handle, dir, cfg)
	ctx := RequestContext{TenantID: "tenant-a", UserID: "u1"}
	first := tracker.CheckBudget(ctx, 70, 3)
	if !first.Allowed || first.Receipt == nil {
		t.Fatalf("reserve failed: %+v", first)
	}
	if err := tracker.finishBudgetDatabase(first.Receipt, 40, 2, false); err != nil {
		t.Fatal(err)
	}
	retry := &BudgetReceipt{ID: first.Receipt.ID, database: true}
	if err := tracker.finishBudgetDatabase(retry, 40, 2, false); err != nil {
		t.Fatalf("settlement retry: %v", err)
	}
	second := tracker.CheckBudget(ctx, 30, 1)
	if !second.Allowed || second.Receipt == nil {
		t.Fatalf("second reserve failed: %+v", second)
	}
	if err := tracker.finishBudgetDatabase(second.Receipt, 0, 0, true); err != nil {
		t.Fatal(err)
	}
	if err := tracker.finishBudgetDatabase(&BudgetReceipt{ID: second.Receipt.ID, database: true}, 0, 0, true); err != nil {
		t.Fatalf("rollback retry: %v", err)
	}
	state.mu.Lock()
	defer state.mu.Unlock()
	for key, value := range state.usage {
		want := 40.0
		if strings.Contains(key, "|cost_usd") {
			want = 2
		}
		if value != want {
			t.Fatalf("%s usage=%v want %v", key, value, want)
		}
	}
}

func TestBudgetDatabaseMissingRelationDenies(t *testing.T) {
	handle, state := budgetTestDatabase(t, database.PostgreSQL)
	state.missingRelation = true
	dir := t.TempDir()
	cfg := writeBudgetConfig(t, dir, BudgetConfig{CompanyLimits: CompanyMonthlyLimits{Tokens: 10}})
	tracker := newBudgetDatabaseTracker(t, handle, dir, cfg)
	decision := tracker.CheckBudget(RequestContext{TenantID: "tenant-a", UserID: "u1"}, 1, 0)
	if decision.Allowed || !decision.StorageError || decision.Description != "policy:budget:ledger_unavailable" {
		t.Fatalf("missing ledger must deny: %+v", decision)
	}
}

func TestBudgetDatabaseRequiredWithoutHandleFailsClosed(t *testing.T) {
	t.Setenv("GATEWAY_BUDGET_BACKEND", "database")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	dir := t.TempDir()
	cfg := writeBudgetConfig(t, dir, BudgetConfig{CompanyLimits: CompanyMonthlyLimits{Tokens: 10}})
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "usage.json"), nil)
	tracker.budgetCfgPath = cfg
	decision := tracker.CheckBudget(RequestContext{TenantID: "tenant-a", UserID: "u1"}, 1, 0)
	if decision.Allowed || !decision.StorageError {
		t.Fatalf("missing configured database must deny budgeted request: %+v", decision)
	}
}

func TestBudgetDatabaseURLReceiptLifecycle(t *testing.T) {
	if strings.TrimSpace(os.Getenv("DATABASE_URL")) == "" {
		t.Skip("DATABASE_URL is not set; skipping live budget ledger test")
	}
	handle, err := database.OpenFromEnv()
	if err != nil {
		t.Skip("live budget database is not reachable")
	}
	t.Cleanup(func() { _ = handle.Close() })
	pingCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := handle.Ping(pingCtx); err != nil {
		t.Skip("live budget database is not reachable")
	}

	dir := t.TempDir()
	cfg := writeBudgetConfig(t, dir, BudgetConfig{
		Version:       2,
		CompanyLimits: CompanyMonthlyLimits{Tokens: 100},
		Departments:   map[string]BudgetRule{"d1": {Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 90, Action: ActionWarn}},
		Defaults:      BudgetRule{Unit: BudgetUnitTokens, Period: BudgetPeriodMonth, Limit: 80, Action: ActionBlock},
	})
	tracker := newBudgetDatabaseTracker(t, handle, dir, cfg)
	tenantID := liveBudgetTenantID(t)
	t.Cleanup(func() { deleteLiveBudgetRows(t, handle, tenantID) })

	if !budgetLedgerTablesExist(t, handle) {
		decision := tracker.CheckBudget(RequestContext{TenantID: tenantID, DeptID: "d1", UserID: "alice"}, 1, 0)
		if decision.Allowed || !decision.StorageError {
			t.Fatalf("missing ledger must deny before migration: %+v", decision)
		}
		if err := createLiveBudgetTables(t, handle); err != nil {
			t.Fatalf("create budget ledger tables: %v", err)
		}
	}
	ctx := RequestContext{TenantID: tenantID, DeptID: "d1", UserID: "alice"}
	first := tracker.CheckBudget(ctx, 60, 0)
	if !first.Allowed || first.Receipt == nil || !first.Receipt.database {
		t.Fatalf("live reserve failed: %+v", first)
	}
	blocked := tracker.CheckBudget(ctx, 50, 0)
	if blocked.Allowed || !blocked.Blocked || blocked.Receipt != nil {
		t.Fatalf("over-limit request must not leave a receipt: %+v", blocked)
	}
	if got := liveBudgetUsage(t, handle, tenantID); got["company|tokens"] != 60 || got["dept|tokens"] != 60 || got["user|tokens"] != 60 {
		t.Fatalf("over-limit request changed usage: %+v", got)
	}
	if err := tracker.SettleBudgetReceipt(first.Receipt, 40, 0); err != nil {
		t.Fatal(err)
	}
	if err := tracker.SettleBudgetReceipt(&BudgetReceipt{ID: first.Receipt.ID, database: true}, 40, 0); err != nil {
		t.Fatalf("settlement retry: %v", err)
	}
	second := tracker.CheckBudget(ctx, 20, 0)
	if !second.Allowed || second.Receipt == nil {
		t.Fatalf("second reserve: %+v", second)
	}
	if err := tracker.RollbackBudgetReceipt(second.Receipt); err != nil {
		t.Fatal(err)
	}
	if err := tracker.RollbackBudgetReceipt(&BudgetReceipt{ID: second.Receipt.ID, database: true}); err != nil {
		t.Fatalf("rollback retry: %v", err)
	}
	if got := liveBudgetUsage(t, handle, tenantID); got["company|tokens"] != 40 || got["dept|tokens"] != 40 || got["user|tokens"] != 40 {
		t.Fatalf("usage after idempotent settle/rollback: %+v", got)
	}
	states := liveBudgetStates(t, handle, tenantID)
	if states["settled"] != 1 || states["rolled_back"] != 1 {
		t.Fatalf("receipt states=%v", states)
	}
}

func newBudgetDatabaseTracker(t *testing.T, handle *database.Handle, dir, cfg string) *Tracker {
	t.Helper()
	t.Setenv("GATEWAY_BUDGET_BACKEND", "database")
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", "")
	tracker := NewTracker(filepath.Join(dir, "quotas.json"), filepath.Join(dir, "quota-usage.json"), handle)
	tracker.budgetCfgPath = cfg
	tracker.budgetUsagePath = filepath.Join(dir, "budget-usage.json")
	return tracker
}

func liveBudgetTenantID(t *testing.T) string {
	t.Helper()
	var buf [11]byte
	if _, err := rand.Read(buf[:]); err != nil {
		t.Fatal(err)
	}
	return "b9at" + hex.EncodeToString(buf[:])
}

func budgetLedgerTablesExist(t *testing.T, handle *database.Handle) bool {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if handle.Dialect == database.MySQL {
		row, err := handle.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'gateway_budget_usage'`)
		if err != nil {
			t.Fatal(err)
		}
		var count int
		if err := row.Scan(&count); err != nil {
			t.Fatal(err)
		}
		return count > 0
	}
	row, err := handle.QueryRowContext(ctx, `SELECT to_regclass('public.gateway_budget_usage')`)
	if err != nil {
		t.Fatal(err)
	}
	var name sql.NullString
	if err := row.Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name.Valid && name.String != ""
}

func createLiveBudgetTables(t *testing.T, handle *database.Handle) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	statements := []string{
		`CREATE TABLE IF NOT EXISTS gateway_budget_usage (
			tenant_id varchar(26) NOT NULL,
			dimension varchar(16) NOT NULL,
			dimension_key varchar(128) NOT NULL,
			period varchar(16) NOT NULL,
			unit varchar(16) NOT NULL,
			used_value numeric(38,18) NOT NULL DEFAULT 0,
			updated_at timestamp with time zone NOT NULL DEFAULT now(),
			CONSTRAINT gateway_budget_usage_pk PRIMARY KEY (tenant_id, dimension, dimension_key, period, unit)
		)`,
		`CREATE TABLE IF NOT EXISTS gateway_budget_reservations (
			receipt_id varchar(32) PRIMARY KEY NOT NULL,
			tenant_id varchar(26) NOT NULL,
			state varchar(16) NOT NULL,
			lines_json text NOT NULL,
			actual_tokens bigint,
			actual_cost_usd numeric(38,18),
			created_at timestamp with time zone NOT NULL DEFAULT now(),
			updated_at timestamp with time zone NOT NULL DEFAULT now()
		)`,
	}
	if handle.Dialect == database.MySQL {
		statements = []string{
			`CREATE TABLE IF NOT EXISTS gateway_budget_usage (
				tenant_id varchar(26) NOT NULL,
				dimension varchar(16) NOT NULL,
				dimension_key varchar(128) NOT NULL,
				period varchar(16) NOT NULL,
				unit varchar(16) NOT NULL,
				used_value decimal(38,18) NOT NULL DEFAULT 0,
				updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
				CONSTRAINT gateway_budget_usage_pk PRIMARY KEY (tenant_id, dimension, dimension_key, period, unit)
			)`,
			`CREATE TABLE IF NOT EXISTS gateway_budget_reservations (
				receipt_id varchar(32) NOT NULL,
				tenant_id varchar(26) NOT NULL,
				state varchar(16) NOT NULL,
				lines_json text NOT NULL,
				actual_tokens bigint,
				actual_cost_usd decimal(38,18),
				created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
				updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
				CONSTRAINT gateway_budget_reservations_pk PRIMARY KEY (receipt_id)
			)`,
		}
	}
	for _, statement := range statements {
		if _, err := handle.ExecContext(ctx, statement); err != nil {
			return err
		}
	}
	return nil
}

func deleteLiveBudgetRows(t *testing.T, handle *database.Handle, tenantID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, statement := range []string{
		`DELETE FROM gateway_budget_reservations WHERE tenant_id = ?`,
		`DELETE FROM gateway_budget_usage WHERE tenant_id = ?`,
	} {
		if _, err := handle.ExecContext(ctx, statement, tenantID); err != nil {
			t.Errorf("cleanup budget rows: %v", err)
		}
	}
}

func liveBudgetUsage(t *testing.T, handle *database.Handle, tenantID string) map[string]float64 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	query := `SELECT dimension, unit, used_value::text FROM gateway_budget_usage WHERE tenant_id = ?`
	if handle.Dialect == database.MySQL {
		query = `SELECT dimension, unit, CAST(used_value AS CHAR) FROM gateway_budget_usage WHERE tenant_id = ?`
	}
	rows, err := handle.QueryContext(ctx, query, tenantID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var dimension, unit, raw string
		if err := rows.Scan(&dimension, &unit, &raw); err != nil {
			t.Fatal(err)
		}
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			t.Fatal(err)
		}
		out[dimension+"|"+unit] = value
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func liveBudgetStates(t *testing.T, handle *database.Handle, tenantID string) map[string]int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := handle.QueryContext(ctx, `SELECT state FROM gateway_budget_reservations WHERE tenant_id = ?`, tenantID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var state string
		if err := rows.Scan(&state); err != nil {
			t.Fatal(err)
		}
		out[state]++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

var budgetDriverSerial atomic.Uint64

func budgetTestDatabase(t *testing.T, dialect database.Dialect) (*database.Handle, *budgetDriverState) {
	t.Helper()
	state := &budgetDriverState{usage: map[string]float64{}, receipts: map[string]budgetDriverReceipt{}}
	name := fmt.Sprintf("budget-transaction-%d", budgetDriverSerial.Add(1))
	sql.Register(name, &budgetDriver{state: state})
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(4)
	t.Cleanup(func() { _ = db.Close() })
	return &database.Handle{Dialect: dialect, DB: db}, state
}

type budgetDriverReceipt struct {
	tenant, state, lines string
	tokens, cost         driver.Value
}

type budgetDriverState struct {
	mu              sync.Mutex
	usage           map[string]float64
	receipts        map[string]budgetDriverReceipt
	failUpdateAt    int
	missingRelation bool
}

type budgetDriver struct{ state *budgetDriverState }

func (d *budgetDriver) Open(string) (driver.Conn, error) {
	return &budgetDriverConn{state: d.state}, nil
}

type budgetDriverConn struct {
	state *budgetDriverState
	tx    *budgetDriverTx
}

func (c *budgetDriverConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare unsupported")
}
func (c *budgetDriverConn) Close() error { return nil }
func (c *budgetDriverConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *budgetDriverConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	c.state.mu.Lock()
	working := make(map[string]float64, len(c.state.usage))
	for key, value := range c.state.usage {
		working[key] = value
	}
	receipts := make(map[string]budgetDriverReceipt, len(c.state.receipts))
	for key, value := range c.state.receipts {
		receipts[key] = value
	}
	c.tx = &budgetDriverTx{conn: c, usage: working, receipts: receipts}
	return c.tx, nil
}

func budgetDriverKey(args []driver.NamedValue, offset int) string {
	parts := make([]string, 0, 5)
	for i := offset; i < offset+5; i++ {
		parts = append(parts, fmt.Sprint(args[i].Value))
	}
	return strings.Join(parts, "|")
}

func (c *budgetDriverConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if c.tx == nil {
		return nil, errors.New("transaction required")
	}
	if c.state.missingRelation && strings.Contains(query, "gateway_budget_") {
		return nil, &pgconn.PgError{Code: "42P01"}
	}
	switch {
	case strings.Contains(query, "INSERT INTO gateway_budget_usage") || strings.Contains(query, "INSERT IGNORE INTO gateway_budget_usage"):
		key := budgetDriverKey(args, 0)
		if _, ok := c.tx.usage[key]; !ok {
			c.tx.usage[key] = 0
		}
	case strings.Contains(query, "UPDATE gateway_budget_usage"):
		c.tx.updates++
		if c.state.failUpdateAt > 0 && c.tx.updates == c.state.failUpdateAt {
			return nil, errors.New("injected budget update failure")
		}
		key := budgetDriverKey(args, 1)
		value, ok := args[0].Value.(float64)
		if !ok {
			return nil, fmt.Errorf("unexpected budget value %T", args[0].Value)
		}
		c.tx.usage[key] = value
	case strings.Contains(query, "INSERT INTO gateway_budget_reservations"):
		id := fmt.Sprint(args[0].Value)
		c.tx.receipts[id] = budgetDriverReceipt{tenant: fmt.Sprint(args[1].Value), state: "reserved", lines: fmt.Sprint(args[2].Value)}
	case strings.Contains(query, "UPDATE gateway_budget_reservations"):
		id := fmt.Sprint(args[3].Value)
		receipt := c.tx.receipts[id]
		receipt.state = fmt.Sprint(args[0].Value)
		receipt.tokens = args[1].Value
		receipt.cost = args[2].Value
		c.tx.receipts[id] = receipt
	default:
		return nil, fmt.Errorf("unexpected SQL: %s", query)
	}
	return driver.RowsAffected(1), nil
}

func (c *budgetDriverConn) QueryContext(_ context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if c.tx == nil {
		return nil, errors.New("transaction required")
	}
	if c.state.missingRelation && strings.Contains(query, "gateway_budget_") {
		return nil, &pgconn.PgError{Code: "42P01"}
	}
	switch {
	case strings.Contains(query, "SELECT used_value FROM gateway_budget_usage"):
		value, ok := c.tx.usage[budgetDriverKey(args, 0)]
		if !ok {
			return &budgetDriverRows{columns: []string{"used_value"}}, nil
		}
		return &budgetDriverRows{columns: []string{"used_value"}, values: [][]driver.Value{{value}}}, nil
	case strings.Contains(query, "FROM gateway_budget_reservations"):
		receipt, ok := c.tx.receipts[fmt.Sprint(args[0].Value)]
		if !ok {
			return &budgetDriverRows{columns: []string{"tenant_id", "state", "lines_json", "actual_tokens", "actual_cost_usd"}}, nil
		}
		return &budgetDriverRows{
			columns: []string{"tenant_id", "state", "lines_json", "actual_tokens", "actual_cost_usd"},
			values:  [][]driver.Value{{receipt.tenant, receipt.state, receipt.lines, receipt.tokens, receipt.cost}},
		}, nil
	default:
		return nil, fmt.Errorf("unexpected SQL: %s", query)
	}
}

type budgetDriverTx struct {
	conn     *budgetDriverConn
	usage    map[string]float64
	receipts map[string]budgetDriverReceipt
	updates  int
	done     bool
}

func (tx *budgetDriverTx) Commit() error {
	if tx.done {
		return errors.New("transaction already finished")
	}
	tx.conn.state.usage = tx.usage
	tx.conn.state.receipts = tx.receipts
	tx.finish()
	return nil
}

func (tx *budgetDriverTx) Rollback() error {
	if !tx.done {
		tx.finish()
	}
	return nil
}

func (tx *budgetDriverTx) finish() {
	tx.done = true
	tx.conn.tx = nil
	tx.conn.state.mu.Unlock()
}

type budgetDriverRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *budgetDriverRows) Columns() []string { return r.columns }
func (r *budgetDriverRows) Close() error      { return nil }
func (r *budgetDriverRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

var _ driver.ConnBeginTx = (*budgetDriverConn)(nil)
var _ driver.ExecerContext = (*budgetDriverConn)(nil)
var _ driver.QueryerContext = (*budgetDriverConn)(nil)
