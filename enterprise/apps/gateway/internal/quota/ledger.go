package quota

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"database/sql"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

const (
	PoolScopeDept   = "dept"
	PoolScopeTenant = "tenant"

	LedgerEventReserve = "reserve"
	LedgerEventSettle  = "settle"
	LedgerEventRefund  = "refund"
)

// PoolKey identifies a shared quota pool counter.
type PoolKey struct {
	TenantID  string
	ScopeType string
	ScopeID   string
	Period    string
}

func (k PoolKey) valid() bool {
	return strings.TrimSpace(k.TenantID) != "" &&
		strings.TrimSpace(k.ScopeType) != "" &&
		strings.TrimSpace(k.ScopeID) != "" &&
		strings.TrimSpace(k.Period) != ""
}

func (k PoolKey) cacheKey() string {
	return k.TenantID + "::" + k.ScopeType + "::" + k.ScopeID + "::" + k.Period
}

// PoolCounter persists shared-pool usage and optional ledger rows.
type PoolCounter interface {
	Add(key PoolKey, delta int64, event string, requestID string) (usedAfter int64, err error)
	Current(key PoolKey) (int64, error)
}

type poolUsageRow struct {
	TenantID  string `json:"tenant_id"`
	ScopeType string `json:"scope_type"`
	ScopeID   string `json:"scope_id"`
	Period    string `json:"period"`
	UsedTotal int64  `json:"used_total"`
}

func poolFeatureEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("GATEWAY_QUOTA_POOL")), "on")
}

func poolBackend() string {
	v := strings.TrimSpace(os.Getenv("GATEWAY_QUOTA_POOL_BACKEND"))
	if v == "" {
		return "local"
	}
	return strings.ToLower(v)
}

func DefaultPoolUsagePath() string {
	cwd, _ := os.Getwd()
	return filepath.Clean(filepath.Join(cwd, "../../.runtime/gateway/quota-pool-usage.json"))
}

func poolKeyFor(rule Rule, ctx RequestContext, period string) (PoolKey, bool) {
	scope := strings.TrimSpace(rule.PoolScope)
	if scope == "" {
		return PoolKey{}, false
	}
	tenantID := strings.TrimSpace(ctx.TenantID)
	if tenantID == "" {
		return PoolKey{}, false
	}
	switch scope {
	case PoolScopeDept:
		deptID := strings.TrimSpace(ctx.DeptID)
		if deptID == "" {
			return PoolKey{}, false
		}
		return PoolKey{TenantID: tenantID, ScopeType: PoolScopeDept, ScopeID: deptID, Period: period}, true
	case PoolScopeTenant:
		return PoolKey{TenantID: tenantID, ScopeType: PoolScopeTenant, ScopeID: tenantID, Period: period}, true
	default:
		return PoolKey{}, false
	}
}

func newPoolCounter(handle *database.Handle, usagePath string) PoolCounter {
	if !poolFeatureEnabled() {
		return nil
	}
	if poolBackend() == "pg" {
		if handle != nil && handle.DB != nil {
			return &PGPoolCounter{database: handle}
		}
		log.Printf("[quota] pool backend=pg but DATABASE_URL unavailable, falling back to local pool counter")
	}
	return &LocalPoolCounter{
		usagePath:  usagePath,
		usageCache: map[string]int64{},
	}
}

// LocalPoolCounter stores shared pool usage in a JSON file (dev / single replica).
type LocalPoolCounter struct {
	mu         sync.Mutex
	usagePath  string
	usageCache map[string]int64
}

func (c *LocalPoolCounter) Add(key PoolKey, delta int64, event string, requestID string) (int64, error) {
	if !key.valid() {
		return 0, fmt.Errorf("invalid pool key")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	unlock, lockOK := c.lockUsageFile()
	if !lockOK {
		return 0, fmt.Errorf("pool usage lock failed")
	}
	defer unlock()
	rows := c.readUsage()
	cacheKey := key.cacheKey()
	used := int64(0)
	for _, row := range rows {
		if row.TenantID == key.TenantID && row.ScopeType == key.ScopeType &&
			row.ScopeID == key.ScopeID && row.Period == key.Period {
			used = row.UsedTotal
			break
		}
	}
	if cached, ok := c.usageCache[cacheKey]; ok && cached > used {
		used = cached
	}
	after := used + delta
	if after < 0 {
		after = 0
	}
	updated := false
	for i := range rows {
		if rows[i].TenantID == key.TenantID && rows[i].ScopeType == key.ScopeType &&
			rows[i].ScopeID == key.ScopeID && rows[i].Period == key.Period {
			rows[i].UsedTotal = after
			updated = true
			break
		}
	}
	if !updated {
		rows = append(rows, poolUsageRow{
			TenantID:  key.TenantID,
			ScopeType: key.ScopeType,
			ScopeID:   key.ScopeID,
			Period:    key.Period,
			UsedTotal: after,
		})
	}
	c.usageCache[cacheKey] = after
	if !c.writeUsage(rows) {
		return used, fmt.Errorf("pool usage persist failed")
	}
	_ = event
	_ = requestID
	return after, nil
}

func (c *LocalPoolCounter) Current(key PoolKey) (int64, error) {
	if !key.valid() {
		return 0, fmt.Errorf("invalid pool key")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if cached, ok := c.usageCache[key.cacheKey()]; ok {
		return cached, nil
	}
	rows := c.readUsage()
	for _, row := range rows {
		if row.TenantID == key.TenantID && row.ScopeType == key.ScopeType &&
			row.ScopeID == key.ScopeID && row.Period == key.Period {
			return row.UsedTotal, nil
		}
	}
	return 0, nil
}

func (c *LocalPoolCounter) readUsage() []poolUsageRow {
	raw, err := os.ReadFile(c.usagePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[quota] read pool usage failed path=%s err=%v", c.usagePath, err)
		}
		return []poolUsageRow{}
	}
	var rows []poolUsageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		log.Printf("[quota] parse pool usage failed path=%s err=%v", c.usagePath, err)
		return []poolUsageRow{}
	}
	return rows
}

func (c *LocalPoolCounter) writeUsage(rows []poolUsageRow) bool {
	if err := os.MkdirAll(filepath.Dir(c.usagePath), 0o700); err != nil {
		log.Printf("[quota] ensure pool usage dir failed path=%s err=%v", c.usagePath, err)
		return false
	}
	tmp := fmt.Sprintf("%s.%d.%d.tmp", c.usagePath, os.Getpid(), time.Now().UnixNano())
	bytes, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		log.Printf("[quota] marshal pool usage failed err=%v", err)
		return false
	}
	if err := os.WriteFile(tmp, bytes, 0o600); err != nil {
		log.Printf("[quota] write pool usage tmp failed path=%s err=%v", tmp, err)
		return false
	}
	if err := os.Rename(tmp, c.usagePath); err != nil {
		log.Printf("[quota] rename pool usage file failed tmp=%s target=%s err=%v", tmp, c.usagePath, err)
		return false
	}
	return true
}

func (c *LocalPoolCounter) lockUsageFile() (func(), bool) {
	if err := os.MkdirAll(filepath.Dir(c.usagePath), 0o700); err != nil {
		log.Printf("[quota] ensure pool lock dir failed path=%s err=%v", c.usagePath, err)
		return nil, false
	}
	lockPath := c.usagePath + ".lock"
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		log.Printf("[quota] open pool lock file failed path=%s err=%v", lockPath, err)
		return nil, false
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		log.Printf("[quota] lock pool usage file failed path=%s err=%v", lockPath, err)
		_ = file.Close()
		return nil, false
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, true
}

// PGPoolCounter atomically updates shared pool usage in the configured database.
type PGPoolCounter struct {
	database *database.Handle
}

func (c *PGPoolCounter) Add(key PoolKey, delta int64, event string, requestID string) (int64, error) {
	if c == nil || c.database == nil || c.database.DB == nil {
		return 0, fmt.Errorf("pool counter unavailable")
	}
	if !key.valid() {
		return 0, fmt.Errorf("invalid pool key")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var usedAfter int64
	var err error
	if c.database.Dialect == database.MySQL {
		usedAfter, err = c.addMySQL(ctx, key, delta)
	} else {
		usedAfter, err = c.addPostgreSQL(ctx, key, delta)
	}
	if err != nil {
		return 0, err
	}
	if usedAfter < 0 {
		_, _ = c.database.ExecContext(ctx, `
UPDATE gateway_quota_pool_usage SET used_total = 0, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period)
		usedAfter = 0
	}
	if delta != 0 && strings.TrimSpace(event) != "" {
		ledgerID := newLedgerID()
		reqID := strings.TrimSpace(requestID)
		var reqArg any
		if reqID == "" {
			reqArg = nil
		} else {
			reqArg = reqID
		}
		_, err = c.database.ExecContext(ctx, `
INSERT INTO gateway_quota_ledger (id, tenant_id, scope_type, scope_id, period, event, delta_tokens, request_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`, ledgerID, key.TenantID, key.ScopeType, key.ScopeID, key.Period, event, delta, reqArg)
		if err != nil {
			log.Printf("[quota] pool ledger insert failed key=%s event=%s err=%v", key.cacheKey(), event, err)
		}
	}
	return usedAfter, nil
}

func (c *PGPoolCounter) addPostgreSQL(ctx context.Context, key PoolKey, delta int64) (int64, error) {
	var usedAfter int64
	row, err := c.database.QueryRowContext(ctx, `
INSERT INTO gateway_quota_pool_usage (tenant_id, scope_type, scope_id, period, used_total, updated_at)
VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, scope_type, scope_id, period)
DO UPDATE SET used_total = gateway_quota_pool_usage.used_total + EXCLUDED.used_total, updated_at = CURRENT_TIMESTAMP
RETURNING used_total
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period, delta)
	if err != nil {
		return 0, err
	}
	if err := row.Scan(&usedAfter); err != nil {
		return 0, err
	}
	return usedAfter, nil
}

func (c *PGPoolCounter) addMySQL(ctx context.Context, key PoolKey, delta int64) (int64, error) {
	tx, err := c.database.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	_, err = tx.ExecContext(ctx, `
INSERT INTO gateway_quota_pool_usage (tenant_id, scope_type, scope_id, period, used_total, updated_at)
VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE used_total = gateway_quota_pool_usage.used_total + ?, updated_at = CURRENT_TIMESTAMP
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period, delta, delta)
	if err != nil {
		return 0, err
	}
	var usedAfter int64
	err = tx.QueryRowContext(ctx, `
SELECT used_total FROM gateway_quota_pool_usage
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
FOR UPDATE
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period).Scan(&usedAfter)
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return usedAfter, nil
}

func (c *PGPoolCounter) Current(key PoolKey) (int64, error) {
	if c == nil || c.database == nil || c.database.DB == nil {
		return 0, fmt.Errorf("pool counter unavailable")
	}
	if !key.valid() {
		return 0, fmt.Errorf("invalid pool key")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var used int64
	row, err := c.database.QueryRowContext(ctx, `
SELECT used_total FROM gateway_quota_pool_usage
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period)
	if err != nil {
		return 0, err
	}
	err = row.Scan(&used)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return used, nil
}

func newLedgerID() string {
	buf := make([]byte, 8)
	_, _ = rand.Read(buf)
	return fmt.Sprintf("qled-%d-%s", time.Now().UnixNano(), hex.EncodeToString(buf))
}

// CurrentPoolUsed exposes pool usage for admin (optional).
func (t *Tracker) CurrentPoolUsed(key PoolKey) (int64, error) {
	if t == nil || t.poolCounter == nil {
		return 0, nil
	}
	return t.poolCounter.Current(key)
}
