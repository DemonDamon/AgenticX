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

func initPricingLoader(logger *slog.Logger) *metering.PricingLoader {
	path := strings.TrimSpace(os.Getenv("GATEWAY_PRICING_FILE"))
	if path == "" {
		path = metering.DefaultPricingPath()
	}
	loader, err := metering.NewPricingLoader(path)
	if err != nil {
		logger.Warn("pricing loader unavailable, using defaults", "error", err, "path", path)
		return nil
	}
	if strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_PRICING_CONFIG_URL")) != "" {
		logger.Info("pricing using remote snapshot with local fallback", "path", path)
	}
	return loader
}

func (s *Server) activePricingTable() *metering.PricingTable {
	if s.pricingLoader != nil {
		return s.pricingLoader.Table()
	}
	return s.pricing
}
