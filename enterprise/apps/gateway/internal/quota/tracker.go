package quota

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

type Action string

const (
	ActionBlock    Action = "block"
	ActionWarn     Action = "warn"
	ActionFallback Action = "fallback"
)

type Rule struct {
	MonthlyTokens      int64  `json:"monthlyTokens"`
	DailyTokens        int64  `json:"dailyTokens,omitempty"`
	WeeklyTokens       int64  `json:"weeklyTokens,omitempty"`
	TPM                int    `json:"tpm,omitempty"`
	RPM                int    `json:"rpm,omitempty"`
	MaxConcurrency     int    `json:"maxConcurrency,omitempty"`
	ToolCallsPerMinute int    `json:"toolCallsPerMinute,omitempty"`
	RequestsPerDay     int    `json:"requestsPerDay,omitempty"`
	RequestsPerWeek    int    `json:"requestsPerWeek,omitempty"`
	RequestsPerMonth   int    `json:"requestsPerMonth,omitempty"`
	PoolScope          string `json:"poolScope,omitempty"`
	Action             Action `json:"action"`
}

type Config struct {
	Defaults struct {
		Role  map[string]Rule `json:"role"`
		Model map[string]Rule `json:"model"`
	} `json:"defaults"`
	Users       map[string]Rule `json:"users"`
	Departments map[string]Rule `json:"departments"`
	APITokens   map[string]Rule `json:"apiTokens"`
}

type usageRow struct {
	UserID    string `json:"user_id"`
	Month     string `json:"month"`
	UsedTotal int64  `json:"used_total"`
}

type Decision struct {
	Allowed bool
	Grace   bool
	// StorageError distinguishes an unavailable authoritative counter from an
	// exhausted quota so callers can return a retriable infrastructure error.
	StorageError bool
	Rule         Rule
	UsedBefore   int64
	UsedAfter    int64
	ExceededBy   int64
	Period       string
	Description  string
	reservation  *monthlyReservation
}

type remoteQuotaSnapshot struct {
	Fetched time.Time
	Config  Config
}

type Tracker struct {
	cfgPath       string
	usagePath     string
	poolUsagePath string
	remoteURL     string
	// Remote quota snapshots are tenant-scoped. A process-wide singleton here
	// would let the first tenant fetched during the 10-second cache window
	// supply policy to every other tenant handled by this gateway replica.
	remoteCfgSnapshots    map[string]remoteQuotaSnapshot
	budgetCfgPath         string
	budgetUsagePath       string
	budgetRemoteURL       string
	budgetRemoteSnapshots map[string]remoteBudgetSnapshot
	mu                    sync.Mutex
	remoteMu              sync.Mutex
	budgetRemoteMu        sync.Mutex
	usageCache            map[string]int64
	budgetAlertSink       BudgetAlertSink
	poolCounter           PoolCounter
	tokenWindowCounter    PoolCounter
	requestCounter        *RequestCountCounter
}

func NewTracker(cfgPath, usagePath string, handle *database.Handle) *Tracker {
	budgetCfgPath := strings.TrimSpace(os.Getenv("GATEWAY_BUDGET_CONFIG_FILE"))
	if budgetCfgPath == "" {
		budgetCfgPath = DefaultBudgetConfigPath()
	}
	budgetUsagePath := strings.TrimSpace(os.Getenv("GATEWAY_BUDGET_USAGE_FILE"))
	if budgetUsagePath == "" {
		budgetUsagePath = DefaultBudgetUsagePath()
	}
	poolUsagePath := strings.TrimSpace(os.Getenv("GATEWAY_QUOTA_POOL_USAGE_FILE"))
	if poolUsagePath == "" {
		poolUsagePath = DefaultPoolUsagePath()
		// A caller-provided usage file (tests and isolated local deployments)
		// must not share the process working-directory token ledger. Production
		// callers using the default path retain the established pool path.
		if cleanedUsage := filepath.Clean(strings.TrimSpace(usagePath)); cleanedUsage != "." && cleanedUsage != filepath.Clean(DefaultUsagePath()) {
			poolUsagePath = cleanedUsage + ".pool"
		}
	}
	return &Tracker{
		cfgPath:               cfgPath,
		usagePath:             usagePath,
		poolUsagePath:         poolUsagePath,
		remoteURL:             strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL")),
		remoteCfgSnapshots:    map[string]remoteQuotaSnapshot{},
		budgetCfgPath:         budgetCfgPath,
		budgetUsagePath:       budgetUsagePath,
		budgetRemoteURL:       strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL")),
		budgetRemoteSnapshots: map[string]remoteBudgetSnapshot{},
		usageCache:            map[string]int64{},
		poolCounter:           newPoolCounter(handle, poolUsagePath),
		tokenWindowCounter:    newTokenWindowCounter(handle, poolUsagePath),
		requestCounter:        newRequestCountCounter(handle, poolUsagePath),
	}
}

func DefaultBudgetConfigPath() string {
	cwd, _ := os.Getwd()
	return filepath.Clean(filepath.Join(cwd, "../../.runtime/admin/budgets.json"))
}

func DefaultConfigPath() string {
	cwd, _ := os.Getwd()
	// apps/gateway → enterprise/.runtime/admin（与 admin-console 发布 policy-snapshot 同目录）
	return filepath.Clean(filepath.Join(cwd, "../../.runtime/admin/quotas.json"))
}

func DefaultUsagePath() string {
	cwd, _ := os.Getwd()
	return filepath.Clean(filepath.Join(cwd, "../../.runtime/gateway/quota-usage.json"))
}

func (t *Tracker) CheckAndAdd(userID, deptID, role, model string, tokens int64) Decision {
	return t.CheckAndAddContext(RequestContext{
		UserID: userID,
		DeptID: deptID,
		Role:   role,
		Model:  model,
	}, tokens, LedgerEventReserve)
}

func (t *Tracker) CheckAndAddContext(ctx RequestContext, tokens int64, ledgerEvent string) Decision {
	t.mu.Lock()
	defer t.mu.Unlock()
	cfg := t.loadConfigForTenant(ctx.TenantID)
	rule := selectRuleExtended(cfg, ctx)
	month := requestCountNow().UTC().Format("2006-01")
	if rule.MonthlyTokens <= 0 {
		if strings.TrimSpace(ctx.UserID) == "" {
			return Decision{Allowed: true, Rule: rule, Period: month, Description: "no quota"}
		}
		// Unlimited rules still keep a per-user usage ledger so the portal can
		// report consumed tokens without treating the rule as an enforced cap.
		return t.checkAndAddUserLocked(rule, ctx, month, tokens, true, ledgerEvent)
	}
	if poolKey, ok := poolKeyFor(rule, ctx, month); ok && t.poolCounter != nil {
		return t.checkAndAddSharedPool(rule, ctx, poolKey, tokens, ledgerEvent)
	}
	if rule.MonthlyTokens > 0 && rule.Action == ActionBlock && t.tokenWindowCounter != nil {
		return t.checkAndAddUserWindow(rule, ctx, month, tokens, ledgerEvent)
	}
	return t.checkAndAddUserLocked(rule, ctx, month, tokens, false, ledgerEvent)
}

func (t *Tracker) checkAndAddSharedPool(rule Rule, ctx RequestContext, key PoolKey, tokens int64, ledgerEvent string) Decision {
	event := strings.TrimSpace(ledgerEvent)
	if event == "" {
		event = LedgerEventReserve
	}
	if rule.Action == ActionBlock && tokens > 0 {
		reservation, err := t.poolCounter.ReserveWithTurnGrace(
			key,
			tokens,
			rule.MonthlyTokens,
			0,
			event,
			turnGraceLeaseID(ctx),
		)
		if err != nil {
			return Decision{Allowed: false, StorageError: true, Rule: rule, Period: key.Period, Description: "quota pool reserve failed in block mode"}
		}
		decision := Decision{
			Allowed:     reservation.Allowed,
			Grace:       reservation.Grace,
			Rule:        rule,
			UsedBefore:  reservation.UsedBefore,
			UsedAfter:   reservation.UsedAfter,
			ExceededBy:  max64(reservation.UsedAfter-rule.MonthlyTokens, 0),
			Period:      key.Period,
			Description: fmt.Sprintf("pool %s %d/%d", key.cacheKey(), reservation.UsedAfter, rule.MonthlyTokens),
		}
		if reservation.Allowed && tokens > 0 {
			decision.reservation = &monthlyReservation{
				kind: counterSharedPool, key: key, ctx: ctx, rule: rule,
				period: key.Period, reserved: tokens, leaseID: turnGraceLeaseID(ctx),
			}
		}
		return decision
	}
	used, err := t.poolCounter.Current(key)
	if err != nil {
		return Decision{Allowed: false, StorageError: true, Rule: rule, Period: key.Period, Description: "quota pool read failed"}
	}
	after := used
	if tokens != 0 {
		usedAfter, addErr := t.poolCounter.Add(key, tokens, event, "")
		if addErr != nil {
			return Decision{Allowed: false, StorageError: true, Rule: rule, Period: key.Period, Description: "quota pool persist failed"}
		}
		after = usedAfter
	}
	desc := fmt.Sprintf("pool %s %d/%d", key.cacheKey(), after, rule.MonthlyTokens)
	decision := Decision{
		Allowed:     true,
		Rule:        rule,
		UsedBefore:  used,
		UsedAfter:   after,
		ExceededBy:  max64(after-rule.MonthlyTokens, 0),
		Period:      key.Period,
		Description: desc,
	}
	if tokens > 0 {
		decision.reservation = &monthlyReservation{
			kind: counterSharedPool, key: key, ctx: ctx, rule: rule,
			period: key.Period, reserved: tokens, leaseID: turnGraceLeaseID(ctx),
		}
	}
	return decision
}

func (t *Tracker) checkAndAddUserWindow(
	rule Rule,
	ctx RequestContext,
	month string,
	tokens int64,
	ledgerEvent string,
) Decision {
	legacyUsed := t.currentUserUsedLocked(ctx.UserID, month)
	key := tokenWindowPoolKey("month", ctx, month)
	if tokens <= 0 {
		used, err := t.tokenWindowCounter.Current(key)
		if err != nil {
			return Decision{Allowed: false, StorageError: true, Rule: rule, Period: month, Description: "monthly quota read failed in block mode"}
		}
		return Decision{
			Allowed:     true,
			Rule:        rule,
			UsedBefore:  used,
			UsedAfter:   used,
			ExceededBy:  max64(used-rule.MonthlyTokens, 0),
			Period:      month,
			Description: fmt.Sprintf("quota %s %d/%d", cacheKey(ctx.UserID, month), used, rule.MonthlyTokens),
		}
	}
	reservation, err := t.tokenWindowCounter.ReserveWithTurnGrace(
		key,
		max64(tokens, 0),
		rule.MonthlyTokens,
		legacyUsed,
		ledgerEvent,
		turnGraceLeaseID(ctx),
	)
	if err != nil {
		return Decision{Allowed: false, StorageError: true, Rule: rule, Period: month, Description: "monthly quota reserve failed in block mode"}
	}
	if reservation.Allowed {
		t.mirrorMonthlyUserUsageFromCounterLocked(ctx.UserID, month, key)
	}
	decision := Decision{
		Allowed:     reservation.Allowed,
		Grace:       reservation.Grace,
		Rule:        rule,
		UsedBefore:  reservation.UsedBefore,
		UsedAfter:   reservation.UsedAfter,
		ExceededBy:  max64(reservation.UsedAfter-rule.MonthlyTokens, 0),
		Period:      month,
		Description: fmt.Sprintf("quota %s %d/%d", cacheKey(ctx.UserID, month), reservation.UsedAfter, rule.MonthlyTokens),
	}
	if reservation.Allowed && tokens > 0 {
		decision.reservation = &monthlyReservation{
			kind: counterTokenWindow, key: key, ctx: ctx, rule: rule,
			period: month, reserved: tokens, leaseID: turnGraceLeaseID(ctx),
		}
	}
	return decision
}

// mirrorMonthlyUserUsageFromCounterLocked is called while t.mu is held. It
// re-reads the authoritative counter after the mutation so an older operation
// cannot overwrite the compatibility JSON/cache with its stale return value.
func (t *Tracker) mirrorMonthlyUserUsageFromCounterLocked(userID, month string, key PoolKey) {
	if t == nil || t.tokenWindowCounter == nil {
		return
	}
	authoritativeUsed, err := t.tokenWindowCounter.Current(key)
	if err != nil {
		log.Printf("[quota] monthly compatibility mirror read failed user=%s month=%s err=%v", userID, month, err)
		return
	}
	t.mirrorMonthlyUserUsageLocked(userID, month, authoritativeUsed)
}

// syncMonthlyUserUsage serializes receipt settlement/refund mirrors with the
// normal tracker paths. The authoritative read happens after acquiring t.mu,
// preventing a delayed writer from publishing an older usedAfter value.
func (t *Tracker) syncMonthlyUserUsage(userID, month string, key PoolKey) {
	if t == nil {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	t.mirrorMonthlyUserUsageFromCounterLocked(userID, month, key)
}

func (t *Tracker) mirrorMonthlyUserUsageLocked(userID, month string, authoritativeUsed int64) {
	if strings.TrimSpace(userID) == "" {
		return
	}
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		return
	}
	defer unlock()
	rows := t.readUsage()
	updated := false
	for i := range rows {
		if rows[i].UserID == userID && rows[i].Month == month {
			rows[i].UsedTotal = authoritativeUsed
			updated = true
			break
		}
	}
	if !updated {
		rows = append(rows, usageRow{UserID: userID, Month: month, UsedTotal: authoritativeUsed})
	}
	t.usageCache[cacheKey(userID, month)] = authoritativeUsed
	if !t.writeUsage(rows) {
		log.Printf("[quota] monthly compatibility mirror failed user=%s month=%s", userID, month)
	}
}

func (t *Tracker) checkAndAddUserLocked(
	rule Rule,
	ctx RequestContext,
	month string,
	tokens int64,
	recordOnly bool,
	ledgerEvent string,
) Decision {
	userID := ctx.UserID
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		if !recordOnly && rule.Action == ActionBlock {
			return Decision{
				Allowed:      false,
				StorageError: true,
				Rule:         rule,
				Period:       month,
				Description:  "quota lock failed in block mode",
			}
		}
	} else {
		defer unlock()
	}
	rows := t.readUsage()
	key := cacheKey(userID, month)
	used := int64(0)
	for _, row := range rows {
		if row.UserID == userID && row.Month == month {
			used = row.UsedTotal
			break
		}
	}
	if cached, ok := t.usageCache[key]; ok && cached > used {
		used = cached
	}
	after := used + max64(tokens, 0)
	allowed := recordOnly || after <= rule.MonthlyTokens || rule.Action != ActionBlock
	recorded := false
	if allowed {
		updated := false
		for i := range rows {
			if rows[i].UserID == userID && rows[i].Month == month {
				rows[i].UsedTotal = after
				updated = true
				break
			}
		}
		if !updated {
			rows = append(rows, usageRow{UserID: userID, Month: month, UsedTotal: after})
		}
		t.usageCache[key] = after
		if !t.writeUsage(rows) {
			log.Printf("[quota] persist usage failed user=%s month=%s action=%s", userID, month, rule.Action)
			if recordOnly {
				t.usageCache[key] = used
			} else if rule.Action == ActionBlock {
				// fail-closed for strict quota policy; avoid silent bypass.
				t.usageCache[key] = used
				return Decision{
					Allowed:      false,
					StorageError: true,
					Rule:         rule,
					UsedBefore:   used,
					UsedAfter:    used,
					ExceededBy:   0,
					Period:       month,
					Description:  "quota persist failed in block mode",
				}
			}
		} else {
			recorded = true
			// Keep a database-backed per-user monthly counter in sync with the
			// legacy JSON ledger. The portal runs in a separate process/replica,
			// so it cannot reliably read that file directly.
			t.recordMonthlyUserLedger(ctx, month, used, max64(tokens, 0), ledgerEvent, "")
		}
	}
	desc := fmt.Sprintf("quota %s %d/%d", key, after, rule.MonthlyTokens)
	exceededBy := max64(after-rule.MonthlyTokens, 0)
	if recordOnly {
		desc = fmt.Sprintf("unlimited usage %s %d", key, after)
		exceededBy = 0
	}
	decision := Decision{
		Allowed:     allowed,
		Rule:        rule,
		UsedBefore:  used,
		UsedAfter:   after,
		ExceededBy:  exceededBy,
		Period:      month,
		Description: desc,
	}
	if recorded && tokens > 0 {
		decision.reservation = &monthlyReservation{
			kind: counterLegacyMonthly, ctx: ctx, rule: rule,
			period: month, reserved: tokens,
		}
	}
	return decision
}

func (t *Tracker) Rollback(userID string, tokens int64) bool {
	return t.RollbackContext(RequestContext{UserID: userID}, tokens)
}

func (t *Tracker) RollbackContext(ctx RequestContext, tokens int64) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if tokens <= 0 {
		return true
	}
	cfg := t.loadConfigForTenant(ctx.TenantID)
	rule := selectRuleExtended(cfg, ctx)
	month := requestCountNow().UTC().Format("2006-01")
	if rule.MonthlyTokens <= 0 {
		if strings.TrimSpace(ctx.UserID) == "" {
			return true
		}
		return t.rollbackUserLocked(ctx, month, tokens)
	}
	return t.rollbackRuleLocked(rule, ctx, month, tokens)
}

func (t *Tracker) rollbackRuleLocked(rule Rule, ctx RequestContext, month string, tokens int64) bool {
	if poolKey, ok := poolKeyFor(rule, ctx, month); ok && t.poolCounter != nil {
		leaseID := turnGraceLeaseID(ctx)
		marker := activeTurnMarker(t.poolCounter, poolKey, leaseID)
		_, err := t.poolCounter.Add(poolKey, -tokens, LedgerEventRefund, marker)
		return err == nil
	}
	if rule.Action == ActionBlock && rule.MonthlyTokens > 0 && t.tokenWindowCounter != nil {
		key := tokenWindowPoolKey("month", ctx, month)
		leaseID := turnGraceLeaseID(ctx)
		marker := activeTurnMarker(t.tokenWindowCounter, key, leaseID)
		_, err := t.tokenWindowCounter.Add(key, -tokens, LedgerEventRefund, marker)
		if err == nil {
			t.mirrorMonthlyUserUsageFromCounterLocked(ctx.UserID, month, key)
		}
		return err == nil
	}
	return t.rollbackUserLocked(ctx, month, tokens)
}

func (t *Tracker) rollbackUserLocked(ctx RequestContext, month string, tokens int64) bool {
	userID := ctx.UserID
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		return false
	}
	defer unlock()
	rows := t.readUsage()
	key := cacheKey(userID, month)
	changed := false
	usedBefore := int64(0)
	for i := range rows {
		if rows[i].UserID == userID && rows[i].Month == month {
			usedBefore = rows[i].UsedTotal
			next := rows[i].UsedTotal - tokens
			if next < 0 {
				next = 0
			}
			rows[i].UsedTotal = next
			t.usageCache[key] = next
			changed = true
			break
		}
	}
	if !changed {
		if cache, ok := t.usageCache[key]; ok {
			usedBefore = cache
			next := cache - tokens
			if next < 0 {
				next = 0
			}
			t.usageCache[key] = next
			rows = append(rows, usageRow{UserID: userID, Month: month, UsedTotal: next})
			changed = true
		}
	}
	if !changed {
		return true
	}
	if !t.writeUsage(rows) {
		return false
	}
	removed := min64(tokens, usedBefore)
	t.recordMonthlyUserLedger(ctx, month, usedBefore, -removed, LedgerEventRefund, "")
	return true
}

func (t *Tracker) AddUsage(userID string, tokens int64) (int64, bool) {
	return t.AddUsageContext(RequestContext{UserID: userID}, tokens)
}

// AddUsageContext records a final monthly usage delta with the same identity
// context used by the normal quota path. AddUsage is retained as a compatibility
// wrapper for callers that only have a user id.
func (t *Tracker) AddUsageContext(ctx RequestContext, tokens int64) (int64, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	userID := ctx.UserID
	if tokens <= 0 {
		month := requestCountNow().UTC().Format("2006-01")
		return t.currentUsed(userID, month), true
	}
	month := requestCountNow().UTC().Format("2006-01")
	rule := selectRuleExtended(t.loadConfigForTenant(ctx.TenantID), ctx)
	if poolKey, ok := poolKeyFor(rule, ctx, month); ok && t.poolCounter != nil {
		if rule.Action == ActionBlock && rule.MonthlyTokens > 0 {
			return recordFinalCounterUsage(t.poolCounter, poolKey, tokens, rule.MonthlyTokens, 0, turnGraceLeaseID(ctx))
		}
		usedAfter, err := t.poolCounter.Add(poolKey, tokens, LedgerEventSettle, "")
		return usedAfter, err == nil
	}
	if rule.Action == ActionBlock && rule.MonthlyTokens > 0 && t.tokenWindowCounter != nil {
		key := tokenWindowPoolKey("month", ctx, month)
		legacyUsed := t.currentUserUsedLocked(ctx.UserID, month)
		usedAfter, ok := recordFinalCounterUsage(
			t.tokenWindowCounter,
			key,
			tokens,
			rule.MonthlyTokens,
			legacyUsed,
			turnGraceLeaseID(ctx),
		)
		if ok {
			t.mirrorMonthlyUserUsageFromCounterLocked(ctx.UserID, month, key)
		}
		return usedAfter, ok
	}
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		return t.currentUsed(userID, month), false
	}
	defer unlock()
	rows := t.readUsage()
	key := cacheKey(userID, month)
	used := int64(0)
	for _, row := range rows {
		if row.UserID == userID && row.Month == month {
			used = row.UsedTotal
			break
		}
	}
	if cached, ok := t.usageCache[key]; ok && cached > used {
		used = cached
	}
	after := used + tokens
	updated := false
	for i := range rows {
		if rows[i].UserID == userID && rows[i].Month == month {
			rows[i].UsedTotal = after
			updated = true
			break
		}
	}
	if !updated {
		rows = append(rows, usageRow{UserID: userID, Month: month, UsedTotal: after})
	}
	t.usageCache[key] = after
	ok := t.writeUsage(rows)
	if ok {
		t.recordMonthlyUserLedger(ctx, month, used, tokens, LedgerEventSettle, "")
	}
	return after, ok
}

// recordFinalCounterUsage first tries the same atomic grace reservation used
// at admission. If the delta belongs to a new turn that is already over the
// limit, the provider usage has nevertheless been consumed, so record it
// without a grace marker. This preserves accounting without opening the next
// request for that turn.
func recordFinalCounterUsage(
	counter PoolCounter,
	key PoolKey,
	tokens, limit, minimumUsed int64,
	leaseID string,
) (int64, bool) {
	reservation, err := counter.ReserveWithTurnGrace(
		key,
		tokens,
		limit,
		minimumUsed,
		LedgerEventSettle,
		normalizedRequestID(leaseID),
	)
	if err == nil && reservation.Allowed {
		return reservation.UsedAfter, true
	}
	usedAfter, addErr := counter.Add(key, tokens, LedgerEventSettle, "")
	return usedAfter, addErr == nil
}

// recordMonthlyUserLedger mirrors the legacy per-user monthly file into the
// shared usage counter used by the portal. The seed step makes existing file
// usage visible immediately after the first request following this migration;
// subsequent requests only apply their actual reserve/settle/refund delta.
func (t *Tracker) recordMonthlyUserLedger(
	ctx RequestContext,
	month string,
	legacyUsed int64,
	delta int64,
	event string,
	requestID string,
) {
	if t == nil || t.tokenWindowCounter == nil || strings.TrimSpace(ctx.UserID) == "" {
		return
	}
	key := tokenWindowPoolKey("month", ctx, month)
	current, err := t.tokenWindowCounter.Current(key)
	if err != nil {
		log.Printf("[quota] monthly ledger read failed key=%s err=%v", key.cacheKey(), err)
		return
	}
	if current == 0 && legacyUsed > 0 {
		if _, err := t.tokenWindowCounter.Add(key, legacyUsed, event, ""); err != nil {
			log.Printf("[quota] monthly ledger seed failed key=%s err=%v", key.cacheKey(), err)
			return
		}
	}
	if delta == 0 {
		return
	}
	if _, err := t.tokenWindowCounter.Add(key, delta, event, requestID); err != nil {
		log.Printf("[quota] monthly ledger update failed key=%s delta=%d err=%v", key.cacheKey(), delta, err)
	}
}

func (t *Tracker) loadConfigForTenant(tenantID string) Config {
	if u := strings.TrimSpace(t.remoteURL); u != "" && gatewayinternal.IsHTTPURL(u) {
		tenantID = strings.TrimSpace(tenantID)
		cacheKey := tenantID
		if cacheKey == "" {
			cacheKey = "__default__"
		}
		t.remoteMu.Lock()
		defer t.remoteMu.Unlock()
		if t.remoteCfgSnapshots == nil {
			t.remoteCfgSnapshots = map[string]remoteQuotaSnapshot{}
		}
		cached := t.remoteCfgSnapshots[cacheKey]
		if !cached.Fetched.IsZero() && time.Since(cached.Fetched) < 10*time.Second {
			return t.normalizeConfig(cached.Config)
		}
		headers := map[string]string{}
		if tenantID != "" {
			headers["X-AgenticX-Tenant-Id"] = tenantID
		}
		raw, code, err := gatewayinternal.HTTPGetWithHeaders(u, headers)
		if err != nil {
			log.Printf("[quota] remote config fetch failed url=%s tenant=%s err=%v", u, tenantID, err)
			return t.normalizeConfig(cached.Config)
		}
		if code == http.StatusNotFound {
			t.remoteCfgSnapshots[cacheKey] = remoteQuotaSnapshot{Fetched: time.Now(), Config: Config{}}
			return Config{}
		}
		if code < 200 || code >= 300 {
			log.Printf("[quota] remote config bad status url=%s tenant=%s code=%d", u, tenantID, code)
			return t.normalizeConfig(cached.Config)
		}
		var cfg Config
		if err := json.Unmarshal(raw, &cfg); err != nil {
			log.Printf("[quota] remote config parse failed tenant=%s err=%v", tenantID, err)
			return t.normalizeConfig(cached.Config)
		}
		t.remoteCfgSnapshots[cacheKey] = remoteQuotaSnapshot{Fetched: time.Now(), Config: cfg}
		return t.normalizeConfig(cfg)
	}

	raw, err := os.ReadFile(t.cfgPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[quota] read config failed path=%s err=%v", t.cfgPath, err)
		}
		return Config{}
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		log.Printf("[quota] parse config failed path=%s err=%v", t.cfgPath, err)
		return Config{}
	}
	return t.normalizeConfig(cfg)
}

func (t *Tracker) loadConfig() Config {
	return t.loadConfigForTenant("")
}

func (t *Tracker) normalizeConfig(cfg Config) Config {
	if cfg.Defaults.Role == nil {
		cfg.Defaults.Role = map[string]Rule{}
	}
	if cfg.Defaults.Model == nil {
		cfg.Defaults.Model = map[string]Rule{}
	}
	if cfg.Users == nil {
		cfg.Users = map[string]Rule{}
	}
	if cfg.Departments == nil {
		cfg.Departments = map[string]Rule{}
	}
	if cfg.APITokens == nil {
		cfg.APITokens = map[string]Rule{}
	}
	return cfg
}

func selectRule(cfg Config, userID, deptID, role, model string) Rule {
	if v, ok := cfg.Users[userID]; ok {
		return sanitizeRule(v)
	}
	if v, ok := cfg.Departments[deptID]; ok {
		return sanitizeRule(v)
	}
	if v, ok := cfg.Defaults.Model[model]; ok {
		return sanitizeRule(v)
	}
	if v, ok := cfg.Defaults.Role[role]; ok {
		return sanitizeRule(v)
	}
	if v, ok := cfg.Defaults.Role["staff"]; ok {
		return sanitizeRule(v)
	}
	return Rule{}
}

func sanitizeRule(in Rule) Rule {
	r := in
	if r.MonthlyTokens < 0 {
		r.MonthlyTokens = 0
	}
	switch strings.TrimSpace(r.PoolScope) {
	case PoolScopeDept, PoolScopeTenant:
		r.PoolScope = strings.TrimSpace(r.PoolScope)
	default:
		r.PoolScope = ""
	}
	switch strings.TrimSpace(string(r.Action)) {
	case string(ActionBlock):
		r.Action = ActionBlock
	case string(ActionFallback):
		r.Action = ActionFallback
	default:
		r.Action = ActionWarn
	}
	return r
}

func (t *Tracker) readUsage() []usageRow {
	raw, err := os.ReadFile(t.usagePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[quota] read usage failed path=%s err=%v", t.usagePath, err)
		}
		return []usageRow{}
	}
	var rows []usageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		log.Printf("[quota] parse usage failed path=%s err=%v", t.usagePath, err)
		return []usageRow{}
	}
	return rows
}

func (t *Tracker) writeUsage(rows []usageRow) bool {
	if err := os.MkdirAll(filepath.Dir(t.usagePath), 0o700); err != nil {
		log.Printf("[quota] ensure usage dir failed path=%s err=%v", t.usagePath, err)
		return false
	}
	tmp := fmt.Sprintf("%s.%d.%d.tmp", t.usagePath, os.Getpid(), time.Now().UnixNano())
	bytes, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		log.Printf("[quota] marshal usage failed err=%v", err)
		return false
	}
	if err := os.WriteFile(tmp, bytes, 0o600); err != nil {
		log.Printf("[quota] write usage tmp failed path=%s err=%v", tmp, err)
		return false
	}
	if err := os.Rename(tmp, t.usagePath); err != nil {
		log.Printf("[quota] rename usage file failed tmp=%s target=%s err=%v", tmp, t.usagePath, err)
		return false
	}
	return true
}

func (t *Tracker) lockUsageFile() (func(), bool) {
	if err := os.MkdirAll(filepath.Dir(t.usagePath), 0o700); err != nil {
		log.Printf("[quota] ensure lock dir failed path=%s err=%v", t.usagePath, err)
		return nil, false
	}
	lockPath := t.usagePath + ".lock"
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		log.Printf("[quota] open lock file failed path=%s err=%v", lockPath, err)
		return nil, false
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		log.Printf("[quota] lock usage file failed path=%s err=%v", lockPath, err)
		_ = file.Close()
		return nil, false
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, true
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func cacheKey(userID, month string) string {
	return userID + "::" + month
}

func (t *Tracker) currentUsed(userID, month string) int64 {
	key := cacheKey(userID, month)
	if cached, ok := t.usageCache[key]; ok {
		return cached
	}
	return 0
}
