package quota

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"sort"
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

	budgetConfigVersion = 2
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

// CompanyMonthlyLimits is the company-wide monthly hard stop. Zero means unset.
type CompanyMonthlyLimits struct {
	Tokens  int64   `json:"tokens"`
	CostUSD float64 `json:"costUsd"`
}

// BudgetConfig is the admin-published budget bundle (v2 contract).
type BudgetConfig struct {
	loadErr       error
	Version       int                   `json:"version,omitempty"`
	UpdatedAt     string                `json:"updatedAt,omitempty"`
	CompanyLimits CompanyMonthlyLimits  `json:"companyLimits,omitempty"`
	Defaults      BudgetRule            `json:"defaults"`
	Tenants       map[string]BudgetRule `json:"tenants"`
	Departments   map[string]BudgetRule `json:"departments"`
	Groups        map[string]BudgetRule `json:"groups,omitempty"`
	Users         map[string]BudgetRule `json:"users"`
	UserGroups    map[string][]string   `json:"userGroups,omitempty"`
}

type remoteBudgetSnapshot struct {
	Fetched time.Time
	Config  BudgetConfig
}

// BudgetReceiptLine is one reserved ledger row carried from admission to settlement.
type BudgetReceiptLine struct {
	Dimension string     `json:"dimension"`
	Key       string     `json:"key"`
	Period    string     `json:"period"`
	Unit      string     `json:"unit"`
	Reserved  float64    `json:"reserved"`
	Rule      BudgetRule `json:"rule"`
	completed bool
}

// BudgetReceipt is the in-memory (file mode) or durable (database mode) reservation.
type BudgetReceipt struct {
	ID       string
	Lines    []BudgetReceiptLine
	database bool
}

// BudgetDecision is the outcome of a budget check.
type BudgetDecision struct {
	StorageError   bool
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
	Receipt        *BudgetReceipt
}

type budgetUsageRow struct {
	Dimension string  `json:"dimension"`
	Key       string  `json:"key"`
	Period    string  `json:"period"`
	Unit      string  `json:"unit"`
	Used      float64 `json:"used"`
}

type budgetTarget struct {
	rule      BudgetRule
	dimension string
	key       string
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

var budgetUsageNow = time.Now

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
	return t.loadBudgetConfigForTenant("")
}

func (t *Tracker) loadBudgetConfigForTenant(tenantID string) BudgetConfig {
	tenantID = strings.TrimSpace(tenantID)
	u := strings.TrimSpace(t.budgetRemoteURL)
	if u != "" {
		if !gatewayinternal.IsHTTPURL(u) {
			log.Printf("[budget] remote config URL is invalid")
			if t.budgetDatabaseRequired {
				return finalizeBudgetConfig(BudgetConfig{loadErr: errors.New("invalid remote budget configuration URL")}, tenantID)
			}
		} else {
			return t.loadRemoteBudgetConfig(u, tenantID)
		}
	}

	raw, err := os.ReadFile(t.budgetCfgPath)
	if err != nil {
		if os.IsNotExist(err) {
			return finalizeBudgetConfig(BudgetConfig{}, tenantID)
		}
		log.Printf("[budget] read config failed path=%s err=%v", t.budgetCfgPath, err)
		if t.budgetDatabaseRequired {
			return finalizeBudgetConfig(BudgetConfig{loadErr: fmt.Errorf("budget configuration file unavailable")}, tenantID)
		}
		return finalizeBudgetConfig(BudgetConfig{}, tenantID)
	}
	var cfg BudgetConfig
	if err := json.Unmarshal(raw, &cfg); err != nil || strings.TrimSpace(string(raw)) == "null" {
		log.Printf("[budget] parse config failed path=%s err=%v", t.budgetCfgPath, err)
		if t.budgetDatabaseRequired {
			return finalizeBudgetConfig(BudgetConfig{loadErr: fmt.Errorf("invalid budget configuration file")}, tenantID)
		}
		return finalizeBudgetConfig(BudgetConfig{}, tenantID)
	}
	return finalizeBudgetConfig(cfg, tenantID)
}

func (t *Tracker) loadRemoteBudgetConfig(url, tenantID string) BudgetConfig {
	cacheKey := tenantID
	if cacheKey == "" {
		cacheKey = "__default__"
	}
	t.budgetRemoteMu.Lock()
	defer t.budgetRemoteMu.Unlock()
	if t.budgetRemoteSnapshots == nil {
		t.budgetRemoteSnapshots = map[string]remoteBudgetSnapshot{}
	}
	cached := t.budgetRemoteSnapshots[cacheKey]
	if !cached.Fetched.IsZero() && time.Since(cached.Fetched) < 10*time.Second {
		return finalizeBudgetConfig(cached.Config, tenantID)
	}
	headers := map[string]string{}
	if tenantID != "" {
		headers["X-AgenticX-Tenant-Id"] = tenantID
	}
	raw, code, err := gatewayinternal.HTTPGetWithHeaders(url, headers)
	if err != nil {
		log.Printf("[budget] remote config fetch failed url=%s tenant=%s err=%v", url, tenantID, err)
		return t.remoteBudgetFailure(cached.Config, tenantID, errors.New("remote budget configuration unavailable"))
	}
	if code == http.StatusNotFound {
		empty := BudgetConfig{}
		t.budgetRemoteSnapshots[cacheKey] = remoteBudgetSnapshot{Fetched: time.Now(), Config: empty}
		return finalizeBudgetConfig(empty, tenantID)
	}
	if code < 200 || code >= 300 {
		log.Printf("[budget] remote config bad status url=%s tenant=%s code=%d", url, tenantID, code)
		return t.remoteBudgetFailure(cached.Config, tenantID, fmt.Errorf("remote budget configuration HTTP %d", code))
	}
	var cfg BudgetConfig
	if err := json.Unmarshal(raw, &cfg); err != nil || strings.TrimSpace(string(raw)) == "null" {
		log.Printf("[budget] remote config parse failed tenant=%s err=%v", tenantID, err)
		return t.remoteBudgetFailure(cached.Config, tenantID, errors.New("invalid remote budget configuration"))
	}
	t.budgetRemoteSnapshots[cacheKey] = remoteBudgetSnapshot{Fetched: time.Now(), Config: cfg}
	return finalizeBudgetConfig(cfg, tenantID)
}

func (t *Tracker) remoteBudgetFailure(cached BudgetConfig, tenantID string, cause error) BudgetConfig {
	if t.budgetDatabaseRequired {
		cached.loadErr = cause
		return finalizeBudgetConfig(cached, tenantID)
	}
	return finalizeBudgetConfig(cached, tenantID)
}

func finalizeBudgetConfig(cfg BudgetConfig, tenantID string) BudgetConfig {
	loadErr := cfg.loadErr
	cfg.loadErr = nil
	cfg = cloneBudgetConfig(cfg)
	cfg = normalizeBudgetConfig(cfg)
	cfg = applyLegacyBudgetDefaults(cfg, tenantID)
	cfg.loadErr = loadErr
	return cfg
}

func cloneBudgetConfig(cfg BudgetConfig) BudgetConfig {
	cfg.Tenants = cloneBudgetRules(cfg.Tenants)
	cfg.Departments = cloneBudgetRules(cfg.Departments)
	cfg.Users = cloneBudgetRules(cfg.Users)
	cfg.Groups = cloneBudgetRules(cfg.Groups)
	cfg.UserGroups = cloneUserGroups(cfg.UserGroups)
	return cfg
}

func cloneBudgetRules(in map[string]BudgetRule) map[string]BudgetRule {
	if in == nil {
		return nil
	}
	out := make(map[string]BudgetRule, len(in))
	for key, rule := range in {
		out[key] = rule
	}
	return out
}

func cloneUserGroups(in map[string][]string) map[string][]string {
	if in == nil {
		return nil
	}
	out := make(map[string][]string, len(in))
	for key, groups := range in {
		out[key] = append([]string(nil), groups...)
	}
	return out
}

func normalizeBudgetConfig(cfg BudgetConfig) BudgetConfig {
	if cfg.CompanyLimits.Tokens < 0 {
		cfg.CompanyLimits.Tokens = 0
	}
	if cfg.CompanyLimits.CostUSD < 0 {
		cfg.CompanyLimits.CostUSD = 0
	}
	if cfg.Tenants == nil {
		cfg.Tenants = map[string]BudgetRule{}
	}
	if cfg.Departments == nil {
		cfg.Departments = map[string]BudgetRule{}
	}
	if cfg.Users == nil {
		cfg.Users = map[string]BudgetRule{}
	}
	if cfg.Groups == nil {
		cfg.Groups = map[string]BudgetRule{}
	}
	if cfg.UserGroups == nil {
		cfg.UserGroups = map[string][]string{}
	}
	cfg.Defaults = sanitizeBudgetRule(cfg.Defaults)
	for key, rule := range cfg.Tenants {
		cfg.Tenants[key] = sanitizeBudgetRule(rule)
	}
	for key, rule := range cfg.Departments {
		cfg.Departments[key] = sanitizeBudgetRule(rule)
	}
	for key, rule := range cfg.Users {
		cfg.Users[key] = sanitizeBudgetRule(rule)
	}
	for key, rule := range cfg.Groups {
		cfg.Groups[key] = sanitizeBudgetRule(rule)
	}
	return cfg
}

// applyLegacyBudgetDefaults rewrites a pre-v2 bundle: old defaults were a
// tenant-wide shared cap, not a per-person fallback.
func applyLegacyBudgetDefaults(cfg BudgetConfig, tenantID string) BudgetConfig {
	if cfg.Version == budgetConfigVersion {
		return cfg
	}
	if cfg.Defaults.Limit > 0 {
		key := strings.TrimSpace(tenantID)
		if key == "" {
			key = "default"
		}
		if cfg.Tenants[key].Limit <= 0 {
			cfg.Tenants[key] = cfg.Defaults
		}
	}
	cfg.Defaults = BudgetRule{}
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

// selectPersonalBudgetRules resolves the personal layer only:
// user override > strictest group rule per unit/period > per-person default.
func selectPersonalBudgetRules(cfg BudgetConfig, ctx RequestContext) []BudgetRule {
	userID := strings.TrimSpace(ctx.UserID)
	if userID == "" {
		return nil
	}
	if rule := cfg.Users[userID]; rule.Limit > 0 {
		return []BudgetRule{rule}
	}
	byWindow := map[string]BudgetRule{}
	for _, groupID := range cfg.UserGroups[userID] {
		groupID = strings.TrimSpace(groupID)
		if groupID == "" {
			continue
		}
		rule, ok := cfg.Groups[groupID]
		if !ok || rule.Limit <= 0 {
			continue
		}
		rule.Action = ActionBlock
		key := rule.Unit + "/" + rule.Period
		if current, exists := byWindow[key]; !exists || rule.Limit < current.Limit {
			byWindow[key] = rule
		}
	}
	if len(byWindow) > 0 {
		keys := make([]string, 0, len(byWindow))
		for key := range byWindow {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		rules := make([]BudgetRule, 0, len(keys))
		for _, key := range keys {
			rules = append(rules, byWindow[key])
		}
		return rules
	}
	if cfg.Defaults.Limit > 0 {
		return []BudgetRule{cfg.Defaults}
	}
	return nil
}

func selectBudgetTargets(cfg BudgetConfig, ctx RequestContext) []budgetTarget {
	scopeKey := strings.TrimSpace(ctx.TenantID)
	if scopeKey == "" {
		scopeKey = "default"
	}
	targets := make([]budgetTarget, 0, 7)
	if cfg.CompanyLimits.Tokens > 0 {
		targets = append(targets, budgetTarget{
			rule: BudgetRule{
				Unit:             BudgetUnitTokens,
				Period:           BudgetPeriodMonth,
				Limit:            float64(cfg.CompanyLimits.Tokens),
				WarnThresholdPct: 80,
				Action:           ActionBlock,
			},
			dimension: "company",
			key:       scopeKey,
		})
	}
	if cfg.CompanyLimits.CostUSD > 0 {
		targets = append(targets, budgetTarget{
			rule: BudgetRule{
				Unit:             BudgetUnitCostUSD,
				Period:           BudgetPeriodMonth,
				Limit:            cfg.CompanyLimits.CostUSD,
				WarnThresholdPct: 80,
				Action:           ActionBlock,
			},
			dimension: "company",
			key:       scopeKey,
		})
	}
	if tenantID := strings.TrimSpace(ctx.TenantID); tenantID != "" {
		if rule := cfg.Tenants[tenantID]; rule.Limit > 0 {
			rule.Action = ActionBlock
			targets = append(targets, budgetTarget{rule: rule, dimension: "tenant", key: tenantID})
		}
	}
	if deptID := strings.TrimSpace(ctx.DeptID); deptID != "" {
		if rule := cfg.Departments[deptID]; rule.Limit > 0 {
			rule.Action = ActionBlock
			targets = append(targets, budgetTarget{rule: rule, dimension: "dept", key: deptID})
		}
	}
	userID := strings.TrimSpace(ctx.UserID)
	for _, rule := range selectPersonalBudgetRules(cfg, ctx) {
		targets = append(targets, budgetTarget{rule: rule, dimension: "user", key: userID})
	}
	return targets
}

func budgetTargetLockKey(target budgetTarget) string {
	return target.dimension + "\x00" + target.key + "\x00" + target.rule.Unit + "\x00" + target.rule.Period
}

func sortBudgetTargets(targets []budgetTarget) {
	sort.Slice(targets, func(i, j int) bool {
		return budgetTargetLockKey(targets[i]) < budgetTargetLockKey(targets[j])
	})
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
	if costUSD <= 0 || math.IsNaN(costUSD) || math.IsInf(costUSD, 0) {
		return 0
	}
	return costUSD
}

func evaluateBudgetTarget(target budgetTarget, period string, used, delta float64) BudgetDecision {
	after := used + delta
	warnAt := target.rule.Limit * target.rule.WarnThresholdPct / 100
	decision := BudgetDecision{
		Allowed:      true,
		Unit:         target.rule.Unit,
		Period:       period,
		Dimension:    target.dimension,
		DimensionKey: target.key,
		Used:         after,
		Limit:        target.rule.Limit,
		WarnPct:      target.rule.WarnThresholdPct,
		Action:       target.rule.Action,
	}
	if after > target.rule.Limit {
		switch target.rule.Action {
		case ActionBlock:
			decision.Allowed = false
			decision.Blocked = true
			decision.Description = "policy:budget:exceeded"
		case ActionFallback:
			decision.FallbackModel = target.rule.FallbackModel
			decision.Description = "policy:budget:fallback"
		default:
			decision.Warn = true
			decision.Description = "policy:budget:exceeded_warn"
		}
	} else if warnAt > 0 && used < warnAt && after >= warnAt {
		decision.Warn = true
		decision.Description = "policy:budget:warn"
	}
	return decision
}

// CheckBudget reserves every active company, tenant, department and personal cap.
// File mode keeps the historical fail-open behavior. Database mode rejects when
// configuration or the ledger cannot be read.
func (t *Tracker) CheckBudget(ctx RequestContext, tokens int64, costUSD float64) BudgetDecision {
	if math.IsNaN(costUSD) || math.IsInf(costUSD, 0) {
		if t.budgetDatabaseRequired {
			return BudgetDecision{Allowed: false, StorageError: true, Description: "policy:budget:storage_unavailable"}
		}
		log.Printf("[budget] non-finite cost ignored")
		costUSD = 0
	}
	cfg := t.loadBudgetConfigForTenant(ctx.TenantID)
	if cfg.loadErr != nil {
		if t.budgetDatabaseRequired {
			return BudgetDecision{Allowed: false, StorageError: true, Description: "policy:budget:config_unavailable"}
		}
		cfg.loadErr = nil
	}
	targets := selectBudgetTargets(cfg, ctx)
	if len(targets) == 0 {
		return BudgetDecision{Allowed: true, Description: "no budget"}
	}
	if t.budgetDatabaseRequired {
		if t.budgetDatabase == nil || t.budgetDatabase.DB == nil {
			return budgetDatabaseUnavailable()
		}
		return t.checkBudgetDatabase(ctx, targets, tokens, costUSD)
	}
	return t.checkBudgetFile(ctx, targets, tokens, costUSD)
}

func (t *Tracker) checkBudgetFile(ctx RequestContext, targets []budgetTarget, tokens int64, costUSD float64) BudgetDecision {
	unlock, lockOK := t.lockBudgetUsageFile()
	if !lockOK {
		log.Printf("[budget] usage lock failed; allowing request")
		return BudgetDecision{Allowed: true, Description: "budget check fail-open"}
	}
	defer unlock()
	rows, err := t.readBudgetUsageStrict()
	if err != nil {
		log.Printf("[budget] read usage failed path=%s err=%v", t.budgetUsageFile(), err)
		return BudgetDecision{Allowed: true, Description: "budget check fail-open"}
	}

	type pendingBudget struct {
		target   budgetTarget
		period   string
		delta    float64
		decision BudgetDecision
	}
	pending := make([]pendingBudget, 0, len(targets))
	var notable *BudgetDecision
	at := budgetUsageNow().UTC()
	for _, target := range targets {
		delta := budgetDelta(target.rule, tokens, costUSD)
		period := budgetPeriodKey(target.rule.Period, at)
		used := budgetRowsUsed(rows, target.rule.Unit, target.dimension, target.key, period)
		decision := evaluateBudgetTarget(target, period, used, delta)
		if !decision.Allowed {
			t.emitBudgetAlert(ctx, decision, "block")
			return decision
		}
		pending = append(pending, pendingBudget{target: target, period: period, delta: delta, decision: decision})
		if notable == nil && (decision.Warn || decision.FallbackModel != "") {
			copy := decision
			notable = &copy
		}
	}
	receipt := &BudgetReceipt{Lines: make([]BudgetReceiptLine, 0, len(pending))}
	changed := false
	for _, item := range pending {
		if item.delta != 0 {
			rows = budgetRowsAdd(rows, item.target.rule.Unit, item.target.dimension, item.target.key, item.period, item.delta)
			changed = true
		}
		receipt.Lines = append(receipt.Lines, BudgetReceiptLine{
			Dimension: item.target.dimension,
			Key:       item.target.key,
			Period:    item.period,
			Unit:      item.target.rule.Unit,
			Reserved:  item.delta,
			Rule:      item.target.rule,
		})
	}
	if changed && !t.writeBudgetUsage(rows) {
		log.Printf("[budget] usage persist failed; allowing request")
		return BudgetDecision{Allowed: true, Description: "budget persist fail-open"}
	}
	for _, item := range pending {
		if item.decision.Warn {
			t.emitBudgetAlert(ctx, item.decision, "warn")
		}
	}
	if notable != nil {
		notable.ReservedTokens = tokens
		notable.ReservedCost = costUSD
		notable.Receipt = receipt
		return *notable
	}
	return BudgetDecision{
		Allowed:        true,
		Description:    "ok",
		ReservedTokens: tokens,
		ReservedCost:   costUSD,
		Receipt:        receipt,
	}
}

// SettleBudget adjusts reserved usage for callers that do not hold a receipt.
func (t *Tracker) SettleBudget(ctx RequestContext, reservedTokens int64, reservedCost float64, actualTokens int64, actualCost float64) {
	cfg := t.loadBudgetConfigForTenant(ctx.TenantID)
	if cfg.loadErr != nil && t.budgetDatabaseRequired {
		log.Printf("[budget] settlement skipped: configuration unavailable")
		return
	}
	targets := selectBudgetTargets(cfg, ctx)
	if len(targets) == 0 {
		return
	}
	amounts := make([]float64, len(targets))
	for i, target := range targets {
		reserved := budgetDelta(target.rule, reservedTokens, reservedCost)
		actual := budgetDelta(target.rule, actualTokens, actualCost)
		amounts[i] = actual - reserved
	}
	if err := t.adjustBudgetTargets(ctx.TenantID, targets, amounts); err != nil {
		log.Printf("[budget] settlement failed: %v", err)
	}
}

// RollbackBudget releases a reserved delta for callers that do not hold a receipt.
func (t *Tracker) RollbackBudget(ctx RequestContext, tokens int64, costUSD float64) {
	cfg := t.loadBudgetConfigForTenant(ctx.TenantID)
	if cfg.loadErr != nil && t.budgetDatabaseRequired {
		log.Printf("[budget] rollback skipped: configuration unavailable")
		return
	}
	targets := selectBudgetTargets(cfg, ctx)
	if len(targets) == 0 {
		return
	}
	amounts := make([]float64, len(targets))
	for i, target := range targets {
		amounts[i] = -budgetDelta(target.rule, tokens, costUSD)
	}
	if err := t.adjustBudgetTargets(ctx.TenantID, targets, amounts); err != nil {
		log.Printf("[budget] rollback failed: %v", err)
	}
}

// SettleCheckedBudget prefers the admission receipt and falls back to re-selecting rules.
func (t *Tracker) SettleCheckedBudget(ctx RequestContext, check CheckResult, actualTokens int64, actualCost float64) {
	if t == nil {
		return
	}
	if check.BudgetReceipt != nil {
		if err := t.SettleBudgetReceipt(check.BudgetReceipt, actualTokens, actualCost); err != nil {
			log.Printf("[budget] settlement failed: %v", err)
		}
		return
	}
	t.SettleBudget(ctx, check.BudgetReservedTokens, check.BudgetReservedCost, actualTokens, actualCost)
}

// SettleBudgetReceipt applies actual usage to the rows named by the receipt.
func (t *Tracker) SettleBudgetReceipt(receipt *BudgetReceipt, actualTokens int64, actualCost float64) error {
	if t == nil || receipt == nil {
		return nil
	}
	if receipt.database {
		return t.finishBudgetDatabase(receipt, actualTokens, actualCost, false)
	}
	deltas := make([]float64, len(receipt.Lines))
	for index := range receipt.Lines {
		line := &receipt.Lines[index]
		if line.completed {
			continue
		}
		deltas[index] = budgetDelta(line.Rule, actualTokens, actualCost) - line.Reserved
	}
	if err := t.adjustBudgetReceiptLocal(receipt.Lines, deltas); err != nil {
		return err
	}
	for index := range receipt.Lines {
		receipt.Lines[index].completed = true
	}
	return nil
}

// RollbackBudgetReceipt releases every line on the receipt. Repeating it is a no-op.
func (t *Tracker) RollbackBudgetReceipt(receipt *BudgetReceipt) error {
	if t == nil || receipt == nil {
		return nil
	}
	if receipt.database {
		return t.finishBudgetDatabase(receipt, 0, 0, true)
	}
	deltas := make([]float64, len(receipt.Lines))
	for index := range receipt.Lines {
		line := &receipt.Lines[index]
		if line.completed {
			continue
		}
		deltas[index] = -line.Reserved
	}
	if err := t.adjustBudgetReceiptLocal(receipt.Lines, deltas); err != nil {
		return err
	}
	for index := range receipt.Lines {
		receipt.Lines[index].completed = true
	}
	return nil
}

func (t *Tracker) adjustBudgetTargets(tenantID string, targets []budgetTarget, deltas []float64) error {
	if t.budgetDatabaseRequired {
		if t.budgetDatabase == nil || t.budgetDatabase.DB == nil {
			return errors.New("budget database unavailable")
		}
		return t.adjustBudgetDatabase(tenantID, targets, deltas)
	}
	lines := make([]BudgetReceiptLine, len(targets))
	at := budgetUsageNow().UTC()
	for i, target := range targets {
		lines[i] = BudgetReceiptLine{
			Dimension: target.dimension,
			Key:       target.key,
			Period:    budgetPeriodKey(target.rule.Period, at),
			Unit:      target.rule.Unit,
			Rule:      target.rule,
		}
	}
	return t.adjustBudgetReceiptLocal(lines, deltas)
}

func (t *Tracker) adjustBudgetReceiptLocal(lines []BudgetReceiptLine, deltas []float64) error {
	if len(lines) != len(deltas) {
		return fmt.Errorf("budget adjustment shape mismatch")
	}
	unlock, lockOK := t.lockBudgetUsageFile()
	if !lockOK {
		return fmt.Errorf("budget usage lock failed")
	}
	defer unlock()
	rows, err := t.readBudgetUsageStrict()
	if err != nil {
		return err
	}
	changed := false
	for i, line := range lines {
		if deltas[i] == 0 {
			continue
		}
		rows = budgetRowsAdd(rows, line.Unit, line.Dimension, line.Key, line.Period, deltas[i])
		changed = true
	}
	if changed && !t.writeBudgetUsage(rows) {
		return fmt.Errorf("budget usage persist failed")
	}
	return nil
}

func (t *Tracker) readBudgetUsedValue(tenantID, dimension, key, period, unit string) (float64, error) {
	if t != nil && t.budgetDatabaseRequired {
		return t.readBudgetUsedDatabase(tenantID, dimension, key, period, unit)
	}
	unlock, lockOK := t.lockBudgetUsageFile()
	if !lockOK {
		return 0, errors.New("budget usage lock failed")
	}
	defer unlock()
	rows, err := t.readBudgetUsageStrict()
	if err != nil {
		return 0, err
	}
	return budgetRowsUsed(rows, unit, dimension, key, period), nil
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

func (t *Tracker) readBudgetUsageStrict() ([]budgetUsageRow, error) {
	raw, err := os.ReadFile(t.budgetUsageFile())
	if os.IsNotExist(err) {
		return []budgetUsageRow{}, nil
	}
	if err != nil {
		return nil, err
	}
	var rows []budgetUsageRow
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (t *Tracker) readBudgetUsageLocked() []budgetUsageRow {
	rows, err := t.readBudgetUsageStrict()
	if err != nil {
		log.Printf("[budget] read usage failed path=%s err=%v", t.budgetUsageFile(), err)
		return []budgetUsageRow{}
	}
	return rows
}

func budgetRowsUsed(rows []budgetUsageRow, unit, dimension, key, period string) float64 {
	for _, row := range rows {
		if row.Dimension == dimension && row.Key == key && row.Period == period && row.Unit == unit {
			return row.Used
		}
	}
	return 0
}

func budgetRowsAdd(rows []budgetUsageRow, unit, dimension, key, period string, delta float64) []budgetUsageRow {
	for i := range rows {
		if rows[i].Dimension == dimension && rows[i].Key == key && rows[i].Period == period && rows[i].Unit == unit {
			rows[i].Used += delta
			if rows[i].Used < 0 {
				rows[i].Used = 0
			}
			return rows
		}
	}
	if delta <= 0 {
		return rows
	}
	return append(rows, budgetUsageRow{Dimension: dimension, Key: key, Period: period, Unit: unit, Used: delta})
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
		BudgetReceipt:        b.Receipt,
	}
}
