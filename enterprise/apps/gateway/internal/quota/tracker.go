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

	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
	"github.com/jackc/pgx/v5/pgxpool"
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
	Allowed     bool
	Rule        Rule
	UsedBefore  int64
	UsedAfter   int64
	ExceededBy  int64
	Description string
}

type Tracker struct {
	cfgPath              string
	usagePath            string
	poolUsagePath        string
	remoteURL            string
	remoteFetched        time.Time
	remoteCfgSnapshot    Config
	budgetCfgPath        string
	budgetUsagePath      string
	budgetRemoteURL      string
	budgetRemoteFetched  time.Time
	budgetRemoteSnapshot BudgetConfig
	mu                   sync.Mutex
	remoteMu             sync.Mutex
	budgetRemoteMu       sync.Mutex
	usageCache           map[string]int64
	budgetAlertSink      BudgetAlertSink
	poolCounter          PoolCounter
	requestCounter       *RequestCountCounter
}

func NewTracker(cfgPath, usagePath string, pgPool *pgxpool.Pool) *Tracker {
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
	}
	return &Tracker{
		cfgPath:         cfgPath,
		usagePath:       usagePath,
		poolUsagePath:   poolUsagePath,
		remoteURL:       strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL")),
		budgetCfgPath:   budgetCfgPath,
		budgetUsagePath: budgetUsagePath,
		budgetRemoteURL: strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL")),
		usageCache:      map[string]int64{},
		poolCounter:     newPoolCounter(pgPool, poolUsagePath),
		requestCounter:  newRequestCountCounter(pgPool, poolUsagePath),
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
	cfg := t.loadConfig()
	rule := selectRule(cfg, ctx.UserID, ctx.DeptID, ctx.Role, ctx.Model)
	if rule.MonthlyTokens <= 0 {
		return Decision{Allowed: true, Rule: rule, Description: "no quota"}
	}
	month := time.Now().UTC().Format("2006-01")
	if poolKey, ok := poolKeyFor(rule, ctx, month); ok && t.poolCounter != nil {
		return t.checkAndAddSharedPool(rule, poolKey, tokens, ledgerEvent)
	}
	return t.checkAndAddUserLocked(rule, ctx.UserID, month, tokens)
}

func (t *Tracker) checkAndAddSharedPool(rule Rule, key PoolKey, tokens int64, ledgerEvent string) Decision {
	event := strings.TrimSpace(ledgerEvent)
	if event == "" {
		event = LedgerEventReserve
	}
	used, err := t.poolCounter.Current(key)
	if err != nil && rule.Action == ActionBlock {
		return Decision{
			Allowed:     false,
			Rule:        rule,
			Description: "quota pool read failed in block mode",
		}
	}
	after := used + max64(tokens, 0)
	allowed := after <= rule.MonthlyTokens || rule.Action != ActionBlock
	if allowed && tokens != 0 {
		usedAfter, addErr := t.poolCounter.Add(key, tokens, event, "")
		if addErr != nil {
			log.Printf("[quota] pool persist failed key=%s event=%s err=%v", key.cacheKey(), event, addErr)
			if rule.Action == ActionBlock {
				return Decision{
					Allowed:     false,
					Rule:        rule,
					UsedBefore:  used,
					UsedAfter:   used,
					Description: "quota pool persist failed in block mode",
				}
			}
		} else {
			after = usedAfter
		}
	}
	desc := fmt.Sprintf("pool %s %d/%d", key.cacheKey(), after, rule.MonthlyTokens)
	return Decision{
		Allowed:     allowed,
		Rule:        rule,
		UsedBefore:  used,
		UsedAfter:   after,
		ExceededBy:  max64(after-rule.MonthlyTokens, 0),
		Description: desc,
	}
}

func (t *Tracker) checkAndAddUserLocked(rule Rule, userID, month string, tokens int64) Decision {
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		if rule.Action == ActionBlock {
			return Decision{
				Allowed:     false,
				Rule:        rule,
				Description: "quota lock failed in block mode",
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
	allowed := after <= rule.MonthlyTokens || rule.Action != ActionBlock
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
			if rule.Action == ActionBlock {
				// fail-closed for strict quota policy; avoid silent bypass.
				t.usageCache[key] = used
				return Decision{
					Allowed:     false,
					Rule:        rule,
					UsedBefore:  used,
					UsedAfter:   used,
					ExceededBy:  0,
					Description: "quota persist failed in block mode",
				}
			}
		}
	}
	desc := fmt.Sprintf("quota %s %d/%d", key, after, rule.MonthlyTokens)
	return Decision{
		Allowed:     allowed,
		Rule:        rule,
		UsedBefore:  used,
		UsedAfter:   after,
		ExceededBy:  max64(after-rule.MonthlyTokens, 0),
		Description: desc,
	}
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
	cfg := t.loadConfig()
	rule := selectRule(cfg, ctx.UserID, ctx.DeptID, ctx.Role, ctx.Model)
	month := time.Now().UTC().Format("2006-01")
	if poolKey, ok := poolKeyFor(rule, ctx, month); ok && t.poolCounter != nil {
		_, err := t.poolCounter.Add(poolKey, -tokens, LedgerEventRefund, "")
		return err == nil
	}
	return t.rollbackUserLocked(ctx.UserID, month, tokens)
}

func (t *Tracker) rollbackUserLocked(userID, month string, tokens int64) bool {
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		return false
	}
	defer unlock()
	rows := t.readUsage()
	key := cacheKey(userID, month)
	changed := false
	for i := range rows {
		if rows[i].UserID == userID && rows[i].Month == month {
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
	return t.writeUsage(rows)
}

func (t *Tracker) AddUsage(userID string, tokens int64) (int64, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if tokens <= 0 {
		month := time.Now().UTC().Format("2006-01")
		return t.currentUsed(userID, month), true
	}
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		month := time.Now().UTC().Format("2006-01")
		return t.currentUsed(userID, month), false
	}
	defer unlock()
	rows := t.readUsage()
	month := time.Now().UTC().Format("2006-01")
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
	return after, t.writeUsage(rows)
}

func (t *Tracker) loadConfig() Config {
	if u := strings.TrimSpace(t.remoteURL); u != "" && gatewayinternal.IsHTTPURL(u) {
		t.remoteMu.Lock()
		defer t.remoteMu.Unlock()
		if !t.remoteFetched.IsZero() && time.Since(t.remoteFetched) < 10*time.Second {
			return t.normalizeConfig(t.remoteCfgSnapshot)
		}
		raw, code, err := gatewayinternal.HTTPGet(u)
		if err != nil {
			log.Printf("[quota] remote config fetch failed url=%s err=%v", u, err)
			return t.normalizeConfig(t.remoteCfgSnapshot)
		}
		if code == http.StatusNotFound {
			t.remoteCfgSnapshot = Config{}
			t.remoteFetched = time.Now()
			return Config{}
		}
		if code < 200 || code >= 300 {
			log.Printf("[quota] remote config bad status url=%s code=%d", u, code)
			return t.normalizeConfig(t.remoteCfgSnapshot)
		}
		var cfg Config
		if err := json.Unmarshal(raw, &cfg); err != nil {
			log.Printf("[quota] remote config parse failed err=%v", err)
			return t.normalizeConfig(t.remoteCfgSnapshot)
		}
		t.remoteCfgSnapshot = cfg
		t.remoteFetched = time.Now()
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
