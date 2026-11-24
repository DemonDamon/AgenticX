package quota

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/redis/go-redis/v9"
	"log"
	"time"
)

const concurrencyKeyPrefix = "agx-gateway-concurrency:"

func concurrencyKey(ctx RequestContext) string {
	return fmt.Sprintf("%s%x", concurrencyKeyPrefix, sha256.Sum256([]byte(ctx.TenantID+"\x00"+rateKey("concurrency", ctx))))
}

var acquireConcurrencyScript = redis.NewScript(`
local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
local current=redis.call('ZCARD',KEYS[1])
if redis.call('ZSCORE',KEYS[1],ARGV[1]) then return {1,current} end
if current>=tonumber(ARGV[2]) then return {0,current} end
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[3]),ARGV[1])
redis.call('PEXPIRE',KEYS[1],ARGV[3])
return {1,current+1}
`)
var renewConcurrencyScript = redis.NewScript(`
local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
if not redis.call('ZSCORE',KEYS[1],ARGV[1]) then return 0 end
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[2]),ARGV[1])
redis.call('PEXPIRE',KEYS[1],ARGV[2])
return 1
`)

type redisConcurrencyStore struct{ client *redis.Client }

func (s *redisConcurrencyStore) acquire(ctx context.Context, key, owner string, limit int, ttl time.Duration) (bool, int, error) {
	values, err := acquireConcurrencyScript.Run(ctx, s.client, []string{key}, owner, limit, ttl.Milliseconds()).Int64Slice()
	if err != nil {
		return false, 0, err
	}
	if len(values) != 2 {
		return false, 0, ErrConcurrencyUnavailable
	}
	return values[0] == 1, int(values[1]), nil
}
func (s *redisConcurrencyStore) renew(ctx context.Context, key, owner string, ttl time.Duration) (bool, error) {
	n, err := renewConcurrencyScript.Run(ctx, s.client, []string{key}, owner, ttl.Milliseconds()).Int64()
	return n == 1, err
}
func (s *redisConcurrencyStore) release(ctx context.Context, key, owner string) error {
	return s.client.ZRem(ctx, key, owner).Err()
}

func (l *RateLimiter) AcquireConcurrencyLease(ctx context.Context, key string, limit int) (ConcurrencyLease, int, error) {
	if l == nil || limit <= 0 {
		return nil, 0, nil
	}
	if l.concurrencyErr != nil {
		return nil, 0, l.concurrencyErr
	}
	cfg := l.leaseConfig
	owner := newLedgerID()
	started := time.Now()
	op, cancel := context.WithTimeout(ctx, cfg.opTimeout)
	allowed, current, err := l.concurrencyStore.acquire(op, key, owner, limit, cfg.ttl)
	cancel()
	if err != nil {
		l.concurrencyWarn.Do(func() { log.Printf("quota: shared concurrency admission unavailable; request refused") })
		return nil, current, ErrConcurrencyUnavailable
	}
	if !allowed {
		return nil, current, nil
	}
	lease := newRenewableLease(l.concurrencyStore, key, owner, cfg, started)
	if lease.IsLost() {
		lease.Release()
		return nil, current, ErrConcurrencyUnavailable
	}
	return lease, current, nil
}
