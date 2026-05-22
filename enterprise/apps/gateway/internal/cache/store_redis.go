package cache

import (
	"context"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisStore persists cache entries in Redis when REDIS_URL is configured.
type RedisStore struct {
	client *redis.Client
	prefix string
}

func NewRedisStore(redisURL, keyPrefix string) (*RedisStore, error) {
	opts, err := redis.ParseURL(strings.TrimSpace(redisURL))
	if err != nil {
		return nil, err
	}
	client := redis.NewClient(opts)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, err
	}
	if strings.TrimSpace(keyPrefix) == "" {
		keyPrefix = "agx:gateway:cache:"
	}
	return &RedisStore{client: client, prefix: keyPrefix}, nil
}

func (r *RedisStore) redisKey(key string) string {
	return r.prefix + key
}

func (r *RedisStore) Get(key string) (Entry, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	raw, err := r.client.Get(ctx, r.redisKey(key)).Bytes()
	if err != nil {
		return Entry{}, false
	}
	entry, err := UnmarshalEntry(raw)
	if err != nil {
		return Entry{}, false
	}
	return entry, true
}

func (r *RedisStore) Set(key string, entry Entry, ttl time.Duration) {
	raw, err := MarshalEntry(entry)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	_ = r.client.Set(ctx, r.redisKey(key), raw, ttl).Err()
}

func (r *RedisStore) DeletePrefix(prefix string) int {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	iter := r.client.Scan(ctx, 0, r.prefix+prefix+"*", 200).Iterator()
	removed := 0
	for iter.Next(ctx) {
		if err := r.client.Del(ctx, iter.Val()).Err(); err == nil {
			removed++
		}
	}
	return removed
}
