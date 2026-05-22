package server

import (
	"log/slog"
	"os"
	"strings"

	"github.com/agenticx/enterprise/gateway/internal/cache"
	"github.com/agenticx/enterprise/gateway/internal/metering"
)

func initCacheService(logger *slog.Logger) *cache.Service {
	cfg := cache.ConfigFromEnv()
	if adminCfg, err := cache.LoadAdminConfig(cacheConfigPath()); err == nil {
		cfg = adminCfg.Apply(cfg)
	}
	var store cache.Store = cache.NewMemoryStore(4096)
	if redisURL := strings.TrimSpace(os.Getenv("REDIS_URL")); redisURL != "" {
		redisStore, err := cache.NewRedisStore(redisURL, "")
		if err != nil {
			logger.Warn("redis cache unavailable, using memory store", "error", err)
		} else {
			store = redisStore
			logger.Info("cache using redis store")
		}
	}
	return cache.NewService(cfg, store)
}

func initPricingTable(logger *slog.Logger) *metering.PricingTable {
	path := strings.TrimSpace(os.Getenv("GATEWAY_PRICING_FILE"))
	if path == "" {
		path = metering.DefaultPricingPath()
	}
	table, err := metering.LoadPricingTable(path)
	if err != nil {
		logger.Warn("pricing table unavailable, using defaults", "error", err, "path", path)
		fallback, _ := metering.LoadPricingTable("")
		return fallback
	}
	return table
}
