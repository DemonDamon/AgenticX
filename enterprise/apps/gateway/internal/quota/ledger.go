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

	turnGraceLeaseTTL      = 30 * time.Minute
	turnGraceLeaseMaxCalls = 64
)

var turnGraceNow = time.Now

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
	HasRequest(key PoolKey, requestID string) (bool, error)
	ReserveWithTurnGrace(key PoolKey, delta, limit, minimumUsed int64, event, requestID string) (TurnGraceReservation, error)
}

// TurnGraceReservation is an atomic hard-limit reservation. Grace is true only
// when this turn owns the first crossing or already owns a prior crossing in
// the same identity/window.
type TurnGraceReservation struct {
	Allowed     bool
	Grace       bool
	LeaseMarked bool
	UsedBefore  int64
	UsedAfter   int64
}

type turnGraceLease struct {
	StartedAt time.Time `json:"started_at"`
	Calls     int       `json:"calls"`
	Balance   int64     `json:"balance"`
}

func (lease turnGraceLease) active(now time.Time) bool {
	return lease.eligible(now) && lease.Balance > 0
}

func (lease turnGraceLease) eligible(now time.Time) bool {
	return !lease.StartedAt.IsZero() && now.Before(lease.StartedAt.Add(turnGraceLeaseTTL)) &&
		lease.Calls < turnGraceLeaseMaxCalls
}

type fallbackPoolCounter struct {
	primary  PoolCounter
	fallback PoolCounter
}

type unavailablePoolCounter struct {
	reason string
}

func (c *unavailablePoolCounter) failure() error {
	reason := strings.TrimSpace(c.reason)
	if reason == "" {
		reason = "database-backed quota counter unavailable"
	}
	return errors.New(reason)
}

func (c *unavailablePoolCounter) Add(PoolKey, int64, string, string) (int64, error) {
	return 0, c.failure()
}

func (c *unavailablePoolCounter) Current(PoolKey) (int64, error) {
	return 0, c.failure()
}

func (c *unavailablePoolCounter) HasRequest(PoolKey, string) (bool, error) {
	return false, c.failure()
}

func (c *unavailablePoolCounter) ReserveWithTurnGrace(PoolKey, int64, int64, int64, string, string) (TurnGraceReservation, error) {
	return TurnGraceReservation{}, c.failure()
}

func (c *fallbackPoolCounter) Add(key PoolKey, delta int64, event string, requestID string) (int64, error) {
	// Once a database counter is selected it is the authoritative mutation
	// target. Falling back to a host-local file after a database failure would
	// acknowledge a settle/refund that the other replicas cannot observe.
	return c.primary.Add(key, delta, event, requestID)
}

func (c *fallbackPoolCounter) Current(key PoolKey) (int64, error) {
	// The database is authoritative once selected. Mutations never update the
	// local counter, so returning it after a database read failure would expose
	// a plausible but stale remaining balance.
	return c.primary.Current(key)
}

func (c *fallbackPoolCounter) HasRequest(key PoolKey, requestID string) (bool, error) {
	return c.primary.HasRequest(key, requestID)
}

func (c *fallbackPoolCounter) ReserveWithTurnGrace(
	key PoolKey,
	delta, limit, minimumUsed int64,
	event, requestID string,
) (TurnGraceReservation, error) {
	// Hard-limit ownership must have one authoritative serialization point.
	// Falling back after a database failure would let each replica independently
	// claim the same first crossing, so strict reservations fail closed instead.
	return c.primary.ReserveWithTurnGrace(key, delta, limit, minimumUsed, event, requestID)
}

type poolUsageRow struct {
	TenantID  string                    `json:"tenant_id"`
	ScopeType string                    `json:"scope_type"`
	ScopeID   string                    `json:"scope_id"`
	Period    string                    `json:"period"`
	UsedTotal int64                     `json:"used_total"`
	Leases    map[string]turnGraceLease `json:"turn_grace_leases,omitempty"`
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
	backend := poolBackend()
	useDatabase := backend == "pg" || backend == "postgres" || backend == "postgresql" || backend == "mysql"
	if useDatabase {
		if handle != nil && handle.DB != nil {
			return &PGPoolCounter{database: handle}
		}
		log.Printf("[quota] pool database backend=%s but DATABASE_URL unavailable; quota mutations will fail closed", backend)
		return &unavailablePoolCounter{reason: "database-backed shared quota counter unavailable"}
	}
	return &LocalPoolCounter{
		usagePath:  usagePath,
		usageCache: map[string]int64{},
	}
}

// newTokenWindowCounter creates the per-identity day/week usage ledger. Unlike
// shared quota pools, this ledger is needed for portal metering even when the
// optional shared-pool enforcement feature is disabled.
func newTokenWindowCounter(handle *database.Handle, usagePath string) PoolCounter {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("GATEWAY_QUOTA_POOL_BACKEND")))
	explicitDatabase := backend == "pg" || backend == "postgres" ||
		backend == "postgresql" || backend == "mysql"
	preferDatabase := explicitDatabase ||
		(backend == "" && handle != nil && handle.DB != nil)
	local := &LocalPoolCounter{
		usagePath:  usagePath,
		usageCache: map[string]int64{},
	}
	if preferDatabase {
		if handle != nil && handle.DB != nil {
			return &fallbackPoolCounter{
				primary:  &PGPoolCounter{database: handle},
				fallback: local,
			}
		}
		if explicitDatabase {
			log.Printf("[quota] token window database backend requested but DATABASE_URL unavailable; quota mutations will fail closed")
			return &unavailablePoolCounter{reason: "database-backed token window counter unavailable"}
		}
	}
	return local
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
	after := used + delta
	if after < 0 {
		after = 0
	}
	appliedDelta := after - used
	updated := false
	for i := range rows {
		if rows[i].TenantID == key.TenantID && rows[i].ScopeType == key.ScopeType &&
			rows[i].ScopeID == key.ScopeID && rows[i].Period == key.Period {
			rows[i].UsedTotal = after
			rows[i].Leases = adjustLeaseBalance(rows[i].Leases, requestID, appliedDelta)
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
			Leases:    adjustLeaseBalance(nil, requestID, appliedDelta),
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

func adjustLeaseBalance(existing map[string]turnGraceLease, requestID string, delta int64) map[string]turnGraceLease {
	requestID = normalizedRequestID(requestID)
	if requestID == "" {
		return existing
	}
	lease, ok := existing[requestID]
	if !ok {
		// Add is used for settle/refund bookkeeping. Lease creation belongs to
		// the atomic reservation path, never to an unaudited standalone Add.
		return existing
	}
	lease.Balance += delta
	if lease.Balance < 0 {
		lease.Balance = 0
	}
	existing[requestID] = lease
	return existing
}

func normalizedRequestID(requestID string) string {
	requestID = strings.TrimSpace(requestID)
	if len(requestID) > 128 {
		return ""
	}
	return requestID
}

func (c *LocalPoolCounter) Current(key PoolKey) (int64, error) {
	if !key.valid() {
		return 0, fmt.Errorf("invalid pool key")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	rows := c.readUsage()
	for _, row := range rows {
		if row.TenantID == key.TenantID && row.ScopeType == key.ScopeType &&
			row.ScopeID == key.ScopeID && row.Period == key.Period {
			return row.UsedTotal, nil
		}
	}
	return 0, nil
}

func (c *LocalPoolCounter) HasRequest(key PoolKey, requestID string) (bool, error) {
	if !key.valid() {
		return false, fmt.Errorf("invalid pool key")
	}
	requestID = normalizedRequestID(requestID)
	if requestID == "" {
		return false, nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	rows := c.readUsage()
	for _, row := range rows {
		if row.TenantID != key.TenantID || row.ScopeType != key.ScopeType ||
			row.ScopeID != key.ScopeID || row.Period != key.Period {
			continue
		}
		lease, ok := row.Leases[requestID]
		return ok && lease.active(turnGraceNow().UTC()), nil
	}
	return false, nil
}

func (c *LocalPoolCounter) ReserveWithTurnGrace(
	key PoolKey,
	delta, limit, minimumUsed int64,
	event, requestID string,
) (TurnGraceReservation, error) {
	if !key.valid() || delta < 0 || limit <= 0 {
		return TurnGraceReservation{}, fmt.Errorf("invalid turn-grace reservation")
	}
	requestID = normalizedRequestID(requestID)
	c.mu.Lock()
	defer c.mu.Unlock()
	unlock, lockOK := c.lockUsageFile()
	if !lockOK {
		return TurnGraceReservation{}, fmt.Errorf("pool usage lock failed")
	}
	defer unlock()

	rows := c.readUsage()
	cacheKey := key.cacheKey()
	rowIndex := -1
	used := int64(0)
	for i := range rows {
		if rows[i].TenantID == key.TenantID && rows[i].ScopeType == key.ScopeType &&
			rows[i].ScopeID == key.ScopeID && rows[i].Period == key.Period {
			rowIndex = i
			used = rows[i].UsedTotal
			break
		}
	}
	// minimumUsed only imports the legacy counter when this window is first
	// created. Once a row exists this counter is authoritative, including zero
	// after a full refund; a stale compatibility mirror must not raise it again.
	if rowIndex < 0 && minimumUsed > used {
		used = minimumUsed
	}
	if rowIndex < 0 {
		rows = append(rows, poolUsageRow{
			TenantID:  key.TenantID,
			ScopeType: key.ScopeType,
			ScopeID:   key.ScopeID,
			Period:    key.Period,
		})
		rowIndex = len(rows) - 1
	}
	now := turnGraceNow().UTC()
	requested, requestedExists := rows[rowIndex].Leases[requestID]
	otherActive := false
	for leaseID, lease := range rows[rowIndex].Leases {
		if leaseID != requestID && lease.active(now) {
			otherActive = true
			break
		}
	}
	result := decideTurnGraceReservation(used, delta, limit, requestID, requested, requestedExists, otherActive, now)
	if !result.Allowed {
		return result, nil
	}
	rows[rowIndex].UsedTotal = result.UsedAfter
	if result.LeaseMarked {
		if rows[rowIndex].Leases == nil {
			rows[rowIndex].Leases = map[string]turnGraceLease{}
		}
		if !requestedExists {
			requested = turnGraceLease{StartedAt: now}
		}
		if event == LedgerEventReserve {
			requested.Calls++
		}
		requested.Balance += delta
		rows[rowIndex].Leases[requestID] = requested
	}
	c.usageCache[cacheKey] = result.UsedAfter
	if !c.writeUsage(rows) {
		c.usageCache[cacheKey] = used
		return TurnGraceReservation{}, fmt.Errorf("pool usage persist failed")
	}
	_ = event
	return result, nil
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

	return c.addTransactional(ctx, key, delta, event, normalizedRequestID(requestID), c.database.Dialect != database.MySQL)
}

// addTransactional keeps the aggregate counter and its audit-ledger delta in
// one database transaction. If the ledger write fails, the aggregate update
// rolls back as well; callers never observe a counter that cannot be audited.
func (c *PGPoolCounter) addTransactional(
	ctx context.Context,
	key PoolKey,
	delta int64,
	event, requestID string,
	postgres bool,
) (int64, error) {
	tx, err := c.database.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	insertUsage := `
INSERT INTO gateway_quota_pool_usage (tenant_id, scope_type, scope_id, period, used_total, updated_at)
	VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
	ON DUPLICATE KEY UPDATE used_total = gateway_quota_pool_usage.used_total
`
	selectUsage := `
SELECT used_total FROM gateway_quota_pool_usage
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
FOR UPDATE
`
	updateUsage := `
UPDATE gateway_quota_pool_usage SET used_total = ?, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
`
	if postgres {
		insertUsage = `
INSERT INTO gateway_quota_pool_usage (tenant_id, scope_type, scope_id, period, used_total, updated_at)
VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, scope_type, scope_id, period) DO NOTHING
`
		selectUsage = `
SELECT used_total FROM gateway_quota_pool_usage
WHERE tenant_id = $1 AND scope_type = $2 AND scope_id = $3 AND period = $4
FOR UPDATE
`
		updateUsage = `
UPDATE gateway_quota_pool_usage SET used_total = $1, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = $2 AND scope_type = $3 AND scope_id = $4 AND period = $5
`
	}
	_, err = tx.ExecContext(ctx, insertUsage, key.TenantID, key.ScopeType, key.ScopeID, key.Period)
	if err != nil {
		return 0, err
	}
	var usedBefore int64
	if err = tx.QueryRowContext(ctx, selectUsage, key.TenantID, key.ScopeType, key.ScopeID, key.Period).Scan(&usedBefore); err != nil {
		return 0, err
	}
	usedAfter := usedBefore + delta
	if usedAfter < 0 {
		usedAfter = 0
	}
	appliedDelta := usedAfter - usedBefore
	if appliedDelta != 0 {
		if _, err = tx.ExecContext(ctx, updateUsage, usedAfter, key.TenantID, key.ScopeType, key.ScopeID, key.Period); err != nil {
			return 0, err
		}
		if strings.TrimSpace(event) != "" {
			if err = insertTurnGraceLedger(ctx, tx, postgres, key, appliedDelta, event, requestID, requestID != ""); err != nil {
				return 0, err
			}
		}
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

func (c *PGPoolCounter) HasRequest(key PoolKey, requestID string) (bool, error) {
	if c == nil || c.database == nil || c.database.DB == nil {
		return false, fmt.Errorf("pool counter unavailable")
	}
	if !key.valid() {
		return false, fmt.Errorf("invalid pool key")
	}
	requestID = normalizedRequestID(requestID)
	if requestID == "" {
		return false, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	query := `
SELECT MIN(created_at),
       COALESCE(SUM(CASE WHEN event = 'reserve' AND delta_tokens > 0 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(delta_tokens), 0)
FROM gateway_quota_ledger
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ? AND request_id = ?
`
	if c.database.Dialect == database.PostgreSQL {
		query = `
SELECT MIN(created_at),
       COALESCE(SUM(CASE WHEN event = 'reserve' AND delta_tokens > 0 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(delta_tokens), 0)
FROM gateway_quota_ledger
WHERE tenant_id = $1 AND scope_type = $2 AND scope_id = $3 AND period = $4 AND request_id = $5
`
	}
	var started sql.NullTime
	var calls, balance int64
	err := c.database.DB.QueryRowContext(ctx, query, key.TenantID, key.ScopeType, key.ScopeID, key.Period, requestID).
		Scan(&started, &calls, &balance)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	lease := turnGraceLease{Calls: int(calls), Balance: balance}
	if started.Valid {
		lease.StartedAt = started.Time.UTC()
	}
	return lease.active(turnGraceNow().UTC()), nil
}

func (c *PGPoolCounter) ReserveWithTurnGrace(
	key PoolKey,
	delta, limit, minimumUsed int64,
	event, requestID string,
) (TurnGraceReservation, error) {
	if c == nil || c.database == nil || c.database.DB == nil {
		return TurnGraceReservation{}, fmt.Errorf("pool counter unavailable")
	}
	if !key.valid() || delta < 0 || limit <= 0 {
		return TurnGraceReservation{}, fmt.Errorf("invalid turn-grace reservation")
	}
	requestID = normalizedRequestID(requestID)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if c.database.Dialect == database.MySQL {
		return c.reserveWithTurnGraceMySQL(ctx, key, delta, limit, minimumUsed, event, requestID)
	}
	return c.reserveWithTurnGracePostgreSQL(ctx, key, delta, limit, minimumUsed, event, requestID)
}

func (c *PGPoolCounter) reserveWithTurnGracePostgreSQL(
	ctx context.Context,
	key PoolKey,
	delta, limit, minimumUsed int64,
	event, requestID string,
) (TurnGraceReservation, error) {
	tx, err := c.database.DB.BeginTx(ctx, nil)
	if err != nil {
		return TurnGraceReservation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `
INSERT INTO gateway_quota_pool_usage (tenant_id, scope_type, scope_id, period, used_total, updated_at)
VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
ON CONFLICT (tenant_id, scope_type, scope_id, period)
DO NOTHING
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period, minimumUsed); err != nil {
		return TurnGraceReservation{}, err
	}
	var used int64
	if err = tx.QueryRowContext(ctx, `
SELECT used_total FROM gateway_quota_pool_usage
WHERE tenant_id = $1 AND scope_type = $2 AND scope_id = $3 AND period = $4
FOR UPDATE
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period).Scan(&used); err != nil {
		return TurnGraceReservation{}, err
	}
	leases, err := txTurnGraceLeases(ctx, tx, true, key)
	if err != nil {
		return TurnGraceReservation{}, err
	}
	result := decideTurnGraceReservationFromLeases(used, delta, limit, requestID, leases, turnGraceNow().UTC())
	if !result.Allowed {
		return result, nil
	}
	if _, err = tx.ExecContext(ctx, `
UPDATE gateway_quota_pool_usage SET used_total = $1, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = $2 AND scope_type = $3 AND scope_id = $4 AND period = $5
`, result.UsedAfter, key.TenantID, key.ScopeType, key.ScopeID, key.Period); err != nil {
		return TurnGraceReservation{}, err
	}
	if delta > 0 {
		if err = insertTurnGraceLedger(ctx, tx, true, key, delta, event, requestID, result.LeaseMarked); err != nil {
			return TurnGraceReservation{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return TurnGraceReservation{}, err
	}
	return result, nil
}

func (c *PGPoolCounter) reserveWithTurnGraceMySQL(
	ctx context.Context,
	key PoolKey,
	delta, limit, minimumUsed int64,
	event, requestID string,
) (TurnGraceReservation, error) {
	tx, err := c.database.DB.BeginTx(ctx, nil)
	if err != nil {
		return TurnGraceReservation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `
INSERT INTO gateway_quota_pool_usage (tenant_id, scope_type, scope_id, period, used_total, updated_at)
VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE used_total = gateway_quota_pool_usage.used_total
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period, minimumUsed); err != nil {
		return TurnGraceReservation{}, err
	}
	var used int64
	if err = tx.QueryRowContext(ctx, `
SELECT used_total FROM gateway_quota_pool_usage
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
FOR UPDATE
`, key.TenantID, key.ScopeType, key.ScopeID, key.Period).Scan(&used); err != nil {
		return TurnGraceReservation{}, err
	}
	leases, err := txTurnGraceLeases(ctx, tx, false, key)
	if err != nil {
		return TurnGraceReservation{}, err
	}
	result := decideTurnGraceReservationFromLeases(used, delta, limit, requestID, leases, turnGraceNow().UTC())
	if !result.Allowed {
		return result, nil
	}
	if _, err = tx.ExecContext(ctx, `
UPDATE gateway_quota_pool_usage SET used_total = ?, updated_at = CURRENT_TIMESTAMP
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
`, result.UsedAfter, key.TenantID, key.ScopeType, key.ScopeID, key.Period); err != nil {
		return TurnGraceReservation{}, err
	}
	if delta > 0 {
		if err = insertTurnGraceLedger(ctx, tx, false, key, delta, event, requestID, result.LeaseMarked); err != nil {
			return TurnGraceReservation{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return TurnGraceReservation{}, err
	}
	return result, nil
}

func turnGraceOverageAllowance(limit int64) int64 {
	allowance := limit / 4
	if allowance < 16_384 {
		allowance = 16_384
	}
	if allowance > 1_000_000 {
		allowance = 1_000_000
	}
	return allowance
}

func decideTurnGraceReservationFromLeases(
	used, delta, limit int64,
	requestID string,
	leases map[string]turnGraceLease,
	now time.Time,
) TurnGraceReservation {
	requested, requestedExists := leases[requestID]
	otherActive := false
	for leaseID, lease := range leases {
		if leaseID != requestID && lease.active(now) {
			otherActive = true
			break
		}
	}
	return decideTurnGraceReservation(used, delta, limit, requestID, requested, requestedExists, otherActive, now)
}

func decideTurnGraceReservation(
	used, delta, limit int64,
	requestID string,
	requested turnGraceLease,
	requestedExists, otherActive bool,
	now time.Time,
) TurnGraceReservation {
	after := used + delta
	result := TurnGraceReservation{UsedBefore: used, UsedAfter: used}
	if after <= limit {
		result.Allowed = true
		result.UsedAfter = after
		if after == limit && requestID != "" && !otherActive {
			if (!requestedExists) || requested.eligible(now) {
				result.LeaseMarked = true
			}
		}
		return result
	}
	if requestID == "" || after-limit > turnGraceOverageAllowance(limit) || otherActive {
		return result
	}
	if requestedExists {
		if !requested.active(now) && !(used < limit && requested.eligible(now)) {
			return result
		}
	} else if used >= limit {
		// A new lease can only be claimed by the atomic reservation that first
		// crosses the boundary. Once a window is exhausted, replaying a fresh
		// client-provided id cannot manufacture a new grace owner.
		return result
	}
	result.Allowed = true
	result.Grace = true
	result.LeaseMarked = true
	result.UsedAfter = after
	return result
}

func txTurnGraceLeases(ctx context.Context, tx *sql.Tx, postgres bool, key PoolKey) (map[string]turnGraceLease, error) {
	query := `
SELECT request_id,
       MIN(created_at),
       COALESCE(SUM(CASE WHEN event = 'reserve' AND delta_tokens > 0 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(delta_tokens), 0)
FROM gateway_quota_ledger
WHERE tenant_id = ? AND scope_type = ? AND scope_id = ? AND period = ?
  AND request_id LIKE 'lease-%'
GROUP BY request_id
`
	if postgres {
		query = `
SELECT request_id,
       MIN(created_at),
       COALESCE(SUM(CASE WHEN event = 'reserve' AND delta_tokens > 0 THEN 1 ELSE 0 END), 0),
       COALESCE(SUM(delta_tokens), 0)
FROM gateway_quota_ledger
WHERE tenant_id = $1 AND scope_type = $2 AND scope_id = $3 AND period = $4
  AND request_id LIKE 'lease-%'
GROUP BY request_id
`
	}
	rows, err := tx.QueryContext(ctx, query, key.TenantID, key.ScopeType, key.ScopeID, key.Period)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	leases := make(map[string]turnGraceLease)
	for rows.Next() {
		var requestID string
		var started sql.NullTime
		var calls, balance int64
		if err := rows.Scan(&requestID, &started, &calls, &balance); err != nil {
			return nil, err
		}
		lease := turnGraceLease{Calls: int(calls), Balance: balance}
		if started.Valid {
			lease.StartedAt = started.Time.UTC()
		}
		leases[requestID] = lease
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return leases, nil
}

func insertTurnGraceLedger(
	ctx context.Context,
	tx *sql.Tx,
	postgres bool,
	key PoolKey,
	delta int64,
	event, requestID string,
	persistMarker bool,
) error {
	ledgerRequestID := any(nil)
	if persistMarker && requestID != "" {
		ledgerRequestID = requestID
	}
	query := `
INSERT INTO gateway_quota_ledger (id, tenant_id, scope_type, scope_id, period, event, delta_tokens, request_id, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
`
	if postgres {
		query = `
INSERT INTO gateway_quota_ledger (id, tenant_id, scope_type, scope_id, period, event, delta_tokens, request_id, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
`
	}
	_, err := tx.ExecContext(ctx, query, newLedgerID(), key.TenantID, key.ScopeType, key.ScopeID, key.Period, event, delta, ledgerRequestID)
	return err
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
