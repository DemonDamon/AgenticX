package quota

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

const (
	BudgetUnitCostUSD = "cost_usd"
	BudgetUnitTokens  = "tokens"

	BudgetPeriodDay   = "day"
	BudgetPeriodWeek  = "week"
	BudgetPeriodMonth = "month"
)

// BudgetRule defines spend/token budget limits for a dimension.
type BudgetRule struct {
	Unit             string  `json:"unit"`   // cost_usd | tokens
	Period           string  `json:"period"` // day | week | month
	Limit            float64 `json:"limit"`
	WarnThresholdPct float64 `json:"warnThresholdPct"`
	Action           Action  `json:"action"`
	FallbackModel    string  `json:"fallbackModel,omitempty"`
}

// BudgetConfig is the admin-published budget bundle.
type BudgetConfig struct {
	UpdatedAt   string                `json:"updatedAt,omitempty"`
	Defaults    BudgetRule            `json:"defaults"`
	Tenants     map[string]BudgetRule `json:"tenants"`
	Departments map[string]BudgetRule `json:"departments"`
	Users       map[string]BudgetRule `json:"users"`
}

// BudgetDecision is the outcome of a budget check.
type BudgetDecision struct {
	Allowed        bool
	Warn           bool
	Blocked        bool
	Action         Action
	Unit           string
	Period         string
	Dimension      string
	DimensionKey   string
	Used           float64
	Limit          float64
	WarnPct        float64
	Description    string
	FallbackModel  string
	ReservedTokens int64
	ReservedCost   float64
}

type budgetUsageRow struct {
	Dimension string  `json:"dimension"`
	Key       string  `json:"key"`
	Period    string  `json:"period"`
	Unit      string  `json:"unit"`
	Used      float64 `json:"used"`
}

// BudgetAlertRecord is persisted for admin visibility.
type BudgetAlertRecord struct {
	ID               string
	TenantID         string
	DeptID           string
	UserID           string
	Dimension        string
	DimensionKey     string
	Period           string
	Unit             string
	AlertType        string // warn | block
	Used             float64
	Limit            float64
	WarnThresholdPct float64
	Description      string
	CreatedAt        time.Time
}

// BudgetAlertSink receives budget warn/block events (PG, audit bridge, etc.).
type BudgetAlertSink func(BudgetAlertRecord)

func (t *Tracker) SetBudgetAlertSink(sink BudgetAlertSink) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.budgetAlertSink = sink
}

func (t *Tracker) SetBudgetUsagePath(path string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.budgetUsagePath = strings.TrimSpace(path)
}

func DefaultBudgetUsagePath() string {
	cwd, _ := os.Getwd()
	return filepath.Clean(filepath.Join(cwd, "../../.runtime/gateway/budget-usage.json"))
}

func (t *Tracker) loadBudgetConfig() BudgetConfig {
	u := strings.TrimSpace(t.budgetRemoteURL)
	if u != "" && gatewayinternal.IsHTTPURL(u) {
		t.budgetRemoteMu.Lock()
		defer t.budgetRemoteMu.Unlock()
		if !t.budgetRemoteFetched.IsZero() && time.Since(t.budgetRemoteFetched) < 10*time.Second {
			return normalizeBudgetConfig(t.budgetRemoteSnapshot)
		}
		raw, code, err := gatewayinternal.HTTPGet(u)
		if err != nil {
			log.Printf("[budget] remote config fetch failed url=%s err=%v", u, err)
			return normalizeBudgetConfig(t.budgetRemoteSnapshot)
		}
		if code == http.StatusNotFound {
			t.budgetRemoteSnapshot = BudgetConfig{}
			t.budgetRemoteFetched = time.Now()
			return BudgetConfig{}
		}
		if code < 200 || code >= 300 {
			log.Printf("[budget] remote config bad status url=%s code=%d", u, code)
			return normalizeBudgetConfig(t.budgetRemoteSnapshot)
		}
		var cfg BudgetConfig
		if err := json.Unmarshal(raw, &cfg); err != nil {
			log.Printf("[budget] remote config parse failed err=%v", err)
			return normalizeBudgetConfig(t.budgetRemoteSnapshot)
		}
		t.budgetRemoteSnapshot = cfg
		t.budgetRemoteFetched = time.Now()
		return normalizeBudgetConfig(cfg)
	}

	raw, err := os.ReadFile(t.budgetCfgPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[budget] read config failed path=%s err=%v", t.budgetCfgPath, err)
		}
		return BudgetConfig{}
	}
	var cfg BudgetConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		log.Printf("[budget] parse config failed path=%s err=%v", t.budgetCfgPath, err)
		return BudgetConfig{}
	}
	return normalizeBudgetConfig(cfg)
}

func normalizeBudgetConfig(cfg BudgetConfig) BudgetConfig {
	if cfg.Tenants == nil {
		cfg.Tenants = map[string]BudgetRule{}
	}
	if cfg.Departments == nil {
		cfg.Departments = map[string]BudgetRule{}
	}
	if cfg.Users == nil {
		cfg.Users = map[string]BudgetRule{}
	}
	cfg.Defaults = sanitizeBudgetRule(cfg.Defaults)
	for k, v := range cfg.Tenants {
		cfg.Tenants[k] = sanitizeBudgetRule(v)
	}
	for k, v := range cfg.Departments {
		cfg.Departments[k] = sanitizeBudgetRule(v)
	}
	for k, v := range cfg.Users {
		cfg.Users[k] = sanitizeBudgetRule(v)
	}
	return cfg
}

func sanitizeBudgetRule(in BudgetRule) BudgetRule {
	r := in
	unit := strings.ToLower(strings.TrimSpace(r.Unit))
	if unit != BudgetUnitTokens {
		r.Unit = BudgetUnitCostUSD
	} else {
		r.Unit = BudgetUnitTokens
	}
	period := strings.ToLower(strings.TrimSpace(r.Period))
	switch period {
	case BudgetPeriodDay:
		r.Period = BudgetPeriodDay
	case BudgetPeriodWeek:
		r.Period = BudgetPeriodWeek
	default:
		r.Period = BudgetPeriodMonth
	}
	if r.Limit < 0 {
		r.Limit = 0
	}
	if r.WarnThresholdPct < 0 {
		r.WarnThresholdPct = 0
	}
	if r.WarnThresholdPct > 100 {
		r.WarnThresholdPct = 100
	}
	switch strings.TrimSpace(string(r.Action)) {
	case string(ActionBlock):
		r.Action = ActionBlock
	case string(ActionFallback):
		r.Action = ActionFallback
	default:
		r.Action = ActionWarn
	}
	r.FallbackModel = strings.TrimSpace(r.FallbackModel)
	return r
}

func selectBudgetRule(cfg BudgetConfig, ctx RequestContext) (BudgetRule, string, string) {
	if ctx.UserID != "" {
		if v, ok := cfg.Users[ctx.UserID]; ok && v.Limit > 0 {
			return v, "user", ctx.UserID
		}
	}
	if ctx.DeptID != "" {
		if v, ok := cfg.Departments[ctx.DeptID]; ok && v.Limit > 0 {
			return v, "dept", ctx.DeptID
		}
	}
	if ctx.TenantID != "" {
		if v, ok := cfg.Tenants[ctx.TenantID]; ok && v.Limit > 0 {
			return v, "tenant", ctx.TenantID
		}
	}
	if cfg.Defaults.Limit > 0 {
		key := ctx.TenantID
		if key == "" {
			key = "default"
		}
		return cfg.Defaults, "tenant", key
	}
	return BudgetRule{}, "", ""
}

func budgetPeriodKey(period string, at time.Time) string {
	switch period {
	case BudgetPeriodDay:
		return at.UTC().Format("2006-01-02")
	case BudgetPeriodWeek:
		year, week := at.UTC().ISOWeek()
		return fmt.Sprintf("%d-W%02d", year, week)
	default:
		return at.UTC().Format("2006-01")
	}
}

func budgetDelta(rule BudgetRule, tokens int64, costUSD float64) float64 {
	if rule.Unit == BudgetUnitTokens {
		if tokens <= 0 {
			return 0
		}
		return float64(tokens)
	}
	if costUSD <= 0 {
		return 0
	}
	return costUSD
}

// CheckBudget evaluates budget before a request. Storage failures fail-open.
func (t *Tracker) CheckBudget(ctx RequestContext, tokens int64, costUSD float64) BudgetDecision {
	cfg := t.loadBudgetConfig()
	rule, dimension, dimKey := selectBudgetRule(cfg, ctx)
	if rule.Limit <= 0 {
		return BudgetDecision{Allowed: true, Description: "no budget"}
	}
	delta := budgetDelta(rule, tokens, costUSD)
	if delta <= 0 {
		return BudgetDecision{Allowed: true, Description: "no budget delta"}
	}
	at := time.Now().UTC()
	period := budgetPeriodKey(rule.Period, at)

	unlock, lockOK := t.lockBudgetUsageFile()
	if !lockOK {
		return BudgetDecision{Allowed: true, Description: "budget check fail-open"}
	}
	defer unlock()

	used := t.readBudgetUsedLocked(rule, dimension, dimKey, period)
	after := used + delta
	warnAt := rule.Limit * rule.WarnThresholdPct / 100

	decision := BudgetDecision{
		Allowed:        true,
		Unit:           rule.Unit,
		Period:         period,
		Dimension:      dimension,
		DimensionKey:   dimKey,
		Used:           after,
		Limit:          rule.Limit,
		WarnPct:        rule.WarnThresholdPct,
		Action:         rule.Action,
		ReservedTokens: tokens,
		ReservedCost:   costUSD,
	}

	emitWarn := warnAt > 0 && used < warnAt && after >= warnAt
	if after > rule.Limit {
		switch rule.Action {
		case ActionBlock:
			decision.Allowed = false
			decision.Blocked = true
			decision.Description = "policy:budget:exceeded"
			t.emitBudgetAlert(ctx, decision, "block")
			return decision
		case ActionFallback:
			decision.FallbackModel = rule.FallbackModel
			decision.Description = "policy:budget:fallback"
		default:
			decision.Warn = true
			decision.Description = "policy:budget:exceeded_warn"
		}
	} else if emitWarn {
		decision.Warn = true
		if decision.Description == "" {
			decision.Description = "policy:budget:warn"
		}
	}

	if !t.addBudgetUsageLocked(rule, dimension, dimKey, period, delta) {
		return BudgetDecision{Allowed: true, Description: "budget persist fail-open"}
	}

	if decision.Warn {
		t.emitBudgetAlert(ctx, decision, "warn")
	}
	return decision
}

// SettleBudget adjusts reserved budget usage after the actual cost/tokens are known.
func (t *Tracker) SettleBudget(ctx RequestContext, reservedTokens int64, reservedCost float64, actualTokens int64, actualCost float64) {
	cfg := t.loadBudgetConfig()
	rule, dimension, dimKey := selectBudgetRule(cfg, ctx)
	if rule.Limit <= 0 {
		return
	}
	reserved := budgetDelta(rule, reservedTokens, reservedCost)
	actual := budgetDelta(rule, actualTokens, actualCost)
	delta := actual - reserved
	if delta == 0 {
		return
	}
	unlock, lockOK := t.lockBudgetUsageFile()
	if !lockOK {
		return
	}
	defer unlock()
	period := budgetPeriodKey(rule.Period, time.Now().UTC())
	_ = t.addBudgetUsageLocked(rule, dimension, dimKey, period, delta)
}

// RollbackBudget releases a reserved budget delta when a request fails before completion.
func (t *Tracker) RollbackBudget(ctx RequestContext, tokens int64, costUSD float64) {
	cfg := t.loadBudgetConfig()
	rule, dimension, dimKey := selectBudgetRule(cfg, ctx)
	if rule.Limit <= 0 {
		return
	}
	delta := budgetDelta(rule, tokens, costUSD)
	if delta <= 0 {
		return
	}
	unlock, lockOK := t.lockBudgetUsageFile()
	if !lockOK {
		return
	}
	defer unlock()
	period := budgetPeriodKey(rule.Period, time.Now().UTC())
	_ = t.addBudgetUsageLocked(rule, dimension, dimKey, period, -delta)
}

func (t *Tracker) emitBudgetAlert(ctx RequestContext, decision BudgetDecision, alertType string) {
	t.mu.Lock()
	sink := t.budgetAlertSink
	t.mu.Unlock()
	if sink == nil {
		return
	}
	sink(BudgetAlertRecord{
		ID:               fmt.Sprintf("bal-%d", time.Now().UnixNano()),
		TenantID:         ctx.TenantID,
		DeptID:           ctx.DeptID,
		UserID:           ctx.UserID,
		Dimension:        decision.Dimension,
		DimensionKey:     decision.DimensionKey,
		Period:           decision.Period,
		Unit:             decision.Unit,
		AlertType:        alertType,
		Used:             decision.Used,
		Limit:            decision.Limit,
		WarnThresholdPct: decision.WarnPct,
		Description:      decision.Description,
		CreatedAt:        time.Now().UTC(),
	})
}

func (t *Tracker) budgetUsageFile() string {
	t.mu.Lock()
	path := t.budgetUsagePath
	t.mu.Unlock()
	if strings.TrimSpace(path) == "" {
		path = DefaultBudgetUsagePath()
	}
	return path
}

func (t *Tracker) readBudgetUsageLocked() []budgetUsageRow {
	raw, err := os.ReadFile(t.budgetUsageFile())
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[budget] read usage failed path=%s err=%v", t.budgetUsageFile(), err)
		}
		return []budgetUsageRow{}
	}
	var rows []budgetUsageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		log.Printf("[budget] parse usage failed err=%v", err)
		return []budgetUsageRow{}
	}
	return rows
}

func (t *Tracker) readBudgetUsedLocked(rule BudgetRule, dimension, key, period string) float64 {
	for _, row := range t.readBudgetUsageLocked() {
		if row.Dimension == dimension && row.Key == key && row.Period == period && row.Unit == rule.Unit {
			return row.Used
		}
	}
	return 0
}

func (t *Tracker) addBudgetUsageLocked(rule BudgetRule, dimension, key, period string, delta float64) bool {
	if delta == 0 {
		return true
	}
	rows := t.readBudgetUsageLocked()
	updated := false
	for i := range rows {
		if rows[i].Dimension == dimension && rows[i].Key == key && rows[i].Period == period && rows[i].Unit == rule.Unit {
			next := rows[i].Used + delta
			if next < 0 {
				next = 0
			}
			rows[i].Used = next
			updated = true
			break
		}
	}
	if !updated {
		if delta < 0 {
			return true
		}
		rows = append(rows, budgetUsageRow{
			Dimension: dimension,
			Key:       key,
			Period:    period,
			Unit:      rule.Unit,
			Used:      delta,
		})
	}
	return t.writeBudgetUsage(rows)
}

func (t *Tracker) writeBudgetUsage(rows []budgetUsageRow) bool {
	path := t.budgetUsageFile()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		log.Printf("[budget] ensure usage dir failed path=%s err=%v", path, err)
		return false
	}
	tmp := fmt.Sprintf("%s.%d.%d.tmp", path, os.Getpid(), time.Now().UnixNano())
	bytes, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		return false
	}
	if err := os.WriteFile(tmp, bytes, 0o600); err != nil {
		return false
	}
	if err := os.Rename(tmp, path); err != nil {
		return false
	}
	return true
}

func (t *Tracker) lockBudgetUsageFile() (func(), bool) {
	path := t.budgetUsageFile()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, false
	}
	lockPath := path + ".lock"
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, false
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX); err != nil {
		_ = file.Close()
		return nil, false
	}
	return func() {
		_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		_ = file.Close()
	}, true
}

func budgetDecisionToCheckResult(b BudgetDecision) CheckResult {
	headers := map[string]string{}
	if b.Warn {
		headers["X-AgenticX-Budget-Warn"] = b.Description
	}
	if b.Limit > 0 {
		headers["X-AgenticX-Budget-Used"] = fmt.Sprintf("%.6f", b.Used)
		headers["X-AgenticX-Budget-Limit"] = fmt.Sprintf("%.6f", b.Limit)
	}
	return CheckResult{
		Allowed:              b.Allowed,
		Warn:                 b.Warn,
		Kind:                 "budget",
		Description:          b.Description,
		Used:                 int64(b.Used),
		Limit:                int64(b.Limit),
		Headers:              headers,
		FallbackModel:        b.FallbackModel,
		BudgetReservedTokens: b.ReservedTokens,
		BudgetReservedCost:   b.ReservedCost,
	}
}
