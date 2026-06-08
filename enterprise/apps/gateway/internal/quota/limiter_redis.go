// Adapted from higress-group/higress ai-token-ratelimit (Apache-2.0).
package quota

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	defaultRedisDialTimeout = 2 * time.Second
	defaultRedisOpTimeout   = 200 * time.Millisecond
	redisWindowSeconds      = 60
	redisKeyPrefix          = "agx-gateway-rl:"
)

// fixedWindowAllowScript atomically increments a fixed-window counter and sets TTL on first use.
// Returns {allowed(0|1), current_count, ttl}.
var fixedWindowAllowScript = redis.NewScript(`
local limit = tonumber(ARGV[1])
local windowSec = tonumber(ARGV[2])
local increment = tonumber(ARGV[3])
local current = tonumber(redis.call('get', KEYS[1]) or '0')
if current + increment > limit then
  local ttl = redis.call('ttl', KEYS[1])
  if ttl < 0 then ttl = windowSec end
  return {0, current, ttl}
end
local newCount = redis.call('incrby', KEYS[1], increment)
if newCount == increment then
  redis.call('expire', KEYS[1], windowSec)
end
return {1, newCount, redis.call('ttl', KEYS[1])}
`)

type redisLimiterBackend struct {
	client   *redis.Client
	opTO     time.Duration
	fallback *inProcessBackend
	warnOnce sync.Once
}

func newRedisLimiterBackend(redisURL string) (*redisLimiterBackend, error) {
	opts, err := redis.ParseURL(strings.TrimSpace(redisURL))
	if err != nil {
		return nil, err
	}
	dialTO := redisDialTimeoutFromEnv()
	if opts.DialTimeout <= 0 {
		opts.DialTimeout = dialTO
	}
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), dialTO)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}
	return &redisLimiterBackend{
		client:   client,
		opTO:     redisOpTimeoutFromEnv(),
		fallback: newInProcessBackend(),
	}, nil
}

func redisDialTimeoutFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_REDIS_DIAL_TIMEOUT"))
	if raw == "" {
		return defaultRedisDialTimeout
	}
	if ms, err := strconv.Atoi(raw); err == nil && ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return d
	}
	return defaultRedisDialTimeout
}

func redisOpTimeoutFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_REDIS_OP_TIMEOUT"))
	if raw == "" {
		return defaultRedisOpTimeout
	}
	if ms, err := strconv.Atoi(raw); err == nil && ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	if d, err := time.ParseDuration(raw); err == nil && d > 0 {
		return d
	}
	return defaultRedisOpTimeout
}

func (r *redisLimiterBackend) AllowRPM(key string, limit int) (bool, int) {
	allowed, used, err := r.fixedWindowAllow("rpm", key, limit, 1)
	if err != nil {
		r.warnOnce.Do(func() {
			log.Printf("quota: redis limiter unavailable, falling back to in-process: %v", err)
		})
		return r.fallback.AllowRPM(key, limit)
	}
	return allowed, used
}

func (r *redisLimiterBackend) AllowTPM(key string, limit int, tokens int64) (bool, int64) {
	if tokens <= 0 {
		tokens = 1
	}
	allowed, used, err := r.fixedWindowAllow("tpm", key, limit, tokens)
	if err != nil {
		r.warnOnce.Do(func() {
			log.Printf("quota: redis limiter unavailable, falling back to in-process: %v", err)
		})
		return r.fallback.AllowTPM(key, limit, tokens)
	}
	return allowed, int64(used)
}

func (r *redisLimiterBackend) fixedWindowAllow(kind, rateKey string, limit int, increment int64) (bool, int, error) {
	if limit <= 0 {
		return true, 0, nil
	}
	if increment <= 0 {
		increment = 1
	}
	if r == nil || r.client == nil {
		return false, 0, redis.ErrClosed
	}
	redisKey := fmt.Sprintf("%s%s:%d:%s", redisKeyPrefix, kind, redisWindowSeconds, rateKey)
	ctx, cancel := context.WithTimeout(context.Background(), r.opTO)
	defer cancel()
	raw, err := fixedWindowAllowScript.Run(
		ctx,
		r.client,
		[]string{redisKey},
		limit,
		redisWindowSeconds,
		increment,
	).Int64Slice()
	if err != nil {
		return false, 0, err
	}
	if len(raw) < 2 {
		return false, 0, fmt.Errorf("unexpected redis script result: %v", raw)
	}
	return raw[0] == 1, int(raw[1]), nil
}

func redisURLFromEnv() string {
	if v := strings.TrimSpace(os.Getenv("GATEWAY_REDIS_URL")); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv("REDIS_URL"))
}

var redisFallbackWarnOnce sync.Once

func buildSharedRateLimiter() *RateLimiter {
	redisURL := redisURLFromEnv()
	if redisURL == "" {
		return NewRateLimiter()
	}
	backend, err := newRedisLimiterBackend(redisURL)
	if err != nil {
		redisFallbackWarnOnce.Do(func() {
			log.Printf("quota: redis limiter init failed, falling back to in-process: %v", err)
		})
		return NewRateLimiter()
	}
	return NewRateLimiterWithBackend(backend)
}
