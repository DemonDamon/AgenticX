package quota

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	enterpriseDatabase "github.com/agenticx/enterprise/gateway/internal/database"
)

var failingLedgerDriverSerial atomic.Uint64

func TestDatabaseCounterRollsBackAggregateWhenLedgerInsertFails(t *testing.T) {
	for _, dialect := range []enterpriseDatabase.Dialect{enterpriseDatabase.PostgreSQL, enterpriseDatabase.MySQL} {
		t.Run(string(dialect), func(t *testing.T) {
			state := &failingLedgerState{committed: 80, failLedger: true}
			driverName := fmt.Sprintf("quota-ledger-failure-%d", failingLedgerDriverSerial.Add(1))
			sql.Register(driverName, &failingLedgerDriver{state: state})
			db, err := sql.Open(driverName, "")
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = db.Close() })
			counter := &PGPoolCounter{database: &enterpriseDatabase.Handle{Dialect: dialect, DB: db}}
			key := PoolKey{TenantID: "tenant-1", ScopeType: tokenScopeDay, ScopeID: "user::u1", Period: "2026-08-18"}

			if _, err := counter.Add(key, 30, LedgerEventReserve, ""); err == nil {
				t.Fatal("ledger failure must fail the aggregate update")
			}
			state.mu.Lock()
			defer state.mu.Unlock()
			if state.committed != 80 {
				t.Fatalf("aggregate committed despite ledger failure: got %d want 80", state.committed)
			}
			if !state.ledgerAttempted {
				t.Fatal("test did not reach the injected ledger failure")
			}
		})
	}
}

func TestSharedPoolSelectsDatabaseCounterForMySQL(t *testing.T) {
	t.Setenv("GATEWAY_QUOTA_POOL", "on")
	t.Setenv("GATEWAY_QUOTA_POOL_BACKEND", "mysql")
	state := &failingLedgerState{}
	driverName := fmt.Sprintf("quota-mysql-selection-%d", failingLedgerDriverSerial.Add(1))
	sql.Register(driverName, &failingLedgerDriver{state: state})
	db, err := sql.Open(driverName, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	counter := newPoolCounter(&enterpriseDatabase.Handle{Dialect: enterpriseDatabase.MySQL, DB: db}, t.TempDir()+"/pool.json")
	if _, ok := counter.(*PGPoolCounter); !ok {
		t.Fatalf("mysql shared pool must use database authority, got %T", counter)
	}
}

type failingLedgerState struct {
	mu              sync.Mutex
	committed       int64
	failLedger      bool
	ledgerAttempted bool
}

type failingLedgerDriver struct {
	state *failingLedgerState
}

func (d *failingLedgerDriver) Open(string) (driver.Conn, error) {
	return &failingLedgerConn{state: d.state}, nil
}

type failingLedgerConn struct {
	state    *failingLedgerState
	working  int64
	lockHeld bool
}

func (c *failingLedgerConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare not supported by quota transaction test driver")
}

func (c *failingLedgerConn) Close() error { return nil }

func (c *failingLedgerConn) Begin() (driver.Tx, error) {
	return c.BeginTx(context.Background(), driver.TxOptions{})
}

func (c *failingLedgerConn) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	c.state.mu.Lock()
	c.lockHeld = true
	c.working = c.state.committed
	return &failingLedgerTx{conn: c}, nil
}

func (c *failingLedgerConn) ExecContext(_ context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	switch {
	case strings.Contains(query, "UPDATE gateway_quota_pool_usage"):
		if len(args) == 0 {
			return nil, errors.New("missing aggregate value")
		}
		value, ok := args[0].Value.(int64)
		if !ok {
			return nil, fmt.Errorf("aggregate value type %T", args[0].Value)
		}
		c.working = value
	case strings.Contains(query, "INSERT INTO gateway_quota_ledger"):
		c.state.ledgerAttempted = true
		if c.state.failLedger {
			return nil, errors.New("injected ledger insert failure")
		}
	}
	return driver.RowsAffected(1), nil
}

func (c *failingLedgerConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	if !strings.Contains(query, "SELECT used_total FROM gateway_quota_pool_usage") {
		return nil, fmt.Errorf("unexpected query: %s", query)
	}
	return &singleInt64Row{value: c.working}, nil
}

type failingLedgerTx struct {
	conn *failingLedgerConn
}

func (tx *failingLedgerTx) Commit() error {
	if !tx.conn.lockHeld {
		return errors.New("transaction is not active")
	}
	tx.conn.state.committed = tx.conn.working
	tx.conn.lockHeld = false
	tx.conn.state.mu.Unlock()
	return nil
}

func (tx *failingLedgerTx) Rollback() error {
	if !tx.conn.lockHeld {
		return nil
	}
	tx.conn.lockHeld = false
	tx.conn.state.mu.Unlock()
	return nil
}

type singleInt64Row struct {
	value int64
	done  bool
}

func (r *singleInt64Row) Columns() []string { return []string{"used_total"} }
func (r *singleInt64Row) Close() error      { return nil }

func (r *singleInt64Row) Next(dest []driver.Value) error {
	if r.done {
		return io.EOF
	}
	r.done = true
	dest[0] = r.value
	return nil
}
