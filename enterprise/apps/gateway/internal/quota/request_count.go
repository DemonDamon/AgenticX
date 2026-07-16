package quota

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

const (
	requestScopeDay   = "req_day"
	requestScopeWeek  = "req_week"
	requestScopeMonth = "req_month"
)

var requestCountNow = func() time.Time { return time.Now().UTC() }

func requestCountFeatureEnabled() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("GATEWAY_REQUEST_COUNT_QUOTA")), "on")
}

func requestCountBackend() string {
	v := strings.TrimSpace(os.Getenv("GATEWAY_REQUEST_COUNT_BACKEND"))
	if v != "" {
		return strings.ToLower(v)
	}
	if poolBackend() == "pg" {
		return "pg"
	}
	return "local"
}

// RequestCountCounter tracks calendar day/week/month request counts per rateKey identity.
type RequestCountCounter struct {
	mu        sync.Mutex
	local     map[string]int64
	usagePath string
	pgCounter PoolCounter
	usePG     bool
}

func newRequestCountCounter(handle *database.Handle, poolUsagePath string) *RequestCountCounter {
	c := &RequestCountCounter{
		local:     map[string]int64{},
		usagePath: poolUsagePath,
	}
	if requestCountBackend() == "pg" && handle != nil && handle.DB != nil {
		c.pgCounter = &PGPoolCounter{database: handle}
		c.usePG = true
	}
	return c
}

func requestWindowPeriod(kind string, now time.Time) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "week":
		year, week := now.ISOWeek()
		return fmt.Sprintf("%d-W%02d", year, week)
	case "month":
		return now.Format("2006-01")
	default:
		return now.Format("2006-01-02")
	}
}

func requestWindowKey(kind string, ctx RequestContext, period string) string {
	return fmt.Sprintf("requests::%s::%s::%s", strings.ToLower(kind), rateKey("req", ctx), period)
}

func requestCountPoolKey(kind string, ctx RequestContext, period string) PoolKey {
	scopeType := requestScopeDay
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "week":
		scopeType = requestScopeWeek
	case "month":
		scopeType = requestScopeMonth
	}
	tenantID := strings.TrimSpace(ctx.TenantID)
	if tenantID == "" {
		tenantID = "default"
	}
	identity := strings.TrimPrefix(rateKey("req", ctx), "req::")
	return PoolKey{
		TenantID:  tenantID,
		ScopeType: scopeType,
		ScopeID:   identity,
		Period:    period,
	}
}

// Increment counts one request for the given window; returns allowed=false when limit exceeded.
func (c *RequestCountCounter) Increment(ctx RequestContext, kind string, limit int) (allowed bool, used int64, err error) {
	if !requestCountFeatureEnabled() || limit <= 0 {
		return true, 0, nil
	}
	now := requestCountNow()
	period := requestWindowPeriod(kind, now)
	if c.usePG && c.pgCounter != nil {
		key := requestCountPoolKey(kind, ctx, period)
		current, curErr := c.pgCounter.Current(key)
		if curErr != nil {
			return false, current, curErr
		}
		if current >= int64(limit) {
			return false, current, nil
		}
		after, addErr := c.pgCounter.Add(key, 1, "req_count", "")
		if addErr != nil {
			return false, current, addErr
		}
		return after <= int64(limit), after, nil
	}
	return c.incrementLocal(requestWindowKey(kind, ctx, period), limit)
}

func (c *RequestCountCounter) incrementLocal(key string, limit int) (allowed bool, used int64, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	current := c.local[key]
	if current >= int64(limit) {
		return false, current, nil
	}
	after := current + 1
	c.local[key] = after
	return after <= int64(limit), after, nil
}
