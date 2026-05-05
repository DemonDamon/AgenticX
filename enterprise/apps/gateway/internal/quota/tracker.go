package quota

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Action string

const (
	ActionBlock    Action = "block"
	ActionWarn     Action = "warn"
	ActionFallback Action = "fallback"
)

type Rule struct {
	MonthlyTokens int64  `json:"monthlyTokens"`
	Action        Action `json:"action"`
}

type Config struct {
	Defaults struct {
		Role  map[string]Rule `json:"role"`
		Model map[string]Rule `json:"model"`
	} `json:"defaults"`
	Users       map[string]Rule `json:"users"`
	Departments map[string]Rule `json:"departments"`
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
	cfgPath    string
	usagePath  string
	mu         sync.Mutex
	usageCache map[string]int64
}

func NewTracker(cfgPath, usagePath string) *Tracker {
	return &Tracker{
		cfgPath:    cfgPath,
		usagePath:  usagePath,
		usageCache: map[string]int64{},
	}
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
	t.mu.Lock()
	defer t.mu.Unlock()
	cfg := t.loadConfig()
	rule := selectRule(cfg, userID, deptID, role, model)
	if rule.MonthlyTokens <= 0 {
		return Decision{Allowed: true, Rule: rule, Description: "no quota"}
	}
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
	t.mu.Lock()
	defer t.mu.Unlock()
	if tokens <= 0 {
		return true
	}
	unlock, lockOK := t.lockUsageFile()
	if !lockOK {
		return false
	}
	defer unlock()
	rows := t.readUsage()
	month := time.Now().UTC().Format("2006-01")
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
