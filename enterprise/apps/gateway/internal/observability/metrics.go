package observability

import (
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Registry holds gateway AI observability metrics.
type Registry struct {
	enabled bool
	reg     *prometheus.Registry

	ttftSeconds *prometheus.HistogramVec
	tps         *prometheus.HistogramVec
	cacheHits   *prometheus.CounterVec
	cacheLookups *prometheus.CounterVec
	channelHealth *prometheus.GaugeVec
	activeStreams *prometheus.GaugeVec
	upstreamErrors *prometheus.CounterVec
	pluginInvocations *prometheus.CounterVec
	pluginErrors      *prometheus.CounterVec
	pluginLatency     *prometheus.HistogramVec

	once sync.Once
}

var (
	globalRegistry     *Registry
	globalRegistryOnce sync.Once
)

func NewRegistryFromEnv() *Registry {
	globalRegistryOnce.Do(func() {
		enabled := envOn("GATEWAY_METRICS", true)
		globalRegistry = &Registry{enabled: enabled}
		if enabled {
			globalRegistry.register()
		}
	})
	return globalRegistry
}

func (r *Registry) register() {
	r.reg = prometheus.NewRegistry()
	r.ttftSeconds = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "agx_gateway_ttft_seconds",
		Help:    "Time to first token in seconds",
		Buckets: prometheus.ExponentialBuckets(0.05, 2, 12),
	}, []string{"model", "channel", "inbound_protocol"})
	r.tps = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "agx_gateway_tokens_per_second",
		Help:    "Completion tokens per second",
		Buckets: prometheus.ExponentialBuckets(1, 2, 12),
	}, []string{"model", "channel"})
	r.cacheHits = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "agx_gateway_cache_hits_total",
		Help: "Total cache hits by layer",
	}, []string{"layer"})
	r.cacheLookups = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "agx_gateway_cache_lookups_total",
		Help: "Cache lookups by layer and result",
	}, []string{"layer", "result"})
	r.channelHealth = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "agx_gateway_channel_health",
		Help: "Channel health status (1=healthy,0=cooldown)",
	}, []string{"channel", "status"})
	r.activeStreams = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "agx_gateway_active_streams",
		Help: "Active streaming requests",
	}, []string{"model"})
	r.upstreamErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "agx_gateway_upstream_error_total",
		Help: "Upstream errors by channel and reason",
	}, []string{"channel", "reason"})
	r.pluginInvocations = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "agx_plugin_invocations_total",
		Help: "Wasm plugin hook invocations",
	}, []string{"plugin"})
	r.pluginErrors = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "agx_plugin_errors_total",
		Help: "Wasm plugin hook errors",
	}, []string{"plugin"})
	r.pluginLatency = prometheus.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "agx_plugin_latency_seconds",
		Help:    "Wasm plugin hook latency in seconds",
		Buckets: prometheus.ExponentialBuckets(0.00001, 2, 14),
	}, []string{"plugin"})

	r.reg.MustRegister(
		r.ttftSeconds,
		r.tps,
		r.cacheHits,
		r.cacheLookups,
		r.channelHealth,
		r.activeStreams,
		r.upstreamErrors,
		r.pluginInvocations,
		r.pluginErrors,
		r.pluginLatency,
	)
}

// ObservePlugin implements wasmhost.MetricsRecorder.
func (r *Registry) ObservePlugin(name string, latency time.Duration, err error) {
	if !r.Enabled() {
		return
	}
	plugin := safeLabel(name)
	if r.pluginInvocations != nil {
		r.pluginInvocations.WithLabelValues(plugin).Inc()
	}
	if err != nil && r.pluginErrors != nil {
		r.pluginErrors.WithLabelValues(plugin).Inc()
	}
	if r.pluginLatency != nil {
		r.pluginLatency.WithLabelValues(plugin).Observe(latency.Seconds())
	}
}

func (r *Registry) Enabled() bool { return r != nil && r.enabled }

func (r *Registry) ObserveTTFT(model, channel, protocol string, d time.Duration) {
	if !r.Enabled() || r.ttftSeconds == nil {
		return
	}
	r.ttftSeconds.WithLabelValues(safeLabel(model), safeLabel(channel), safeLabel(protocol)).Observe(d.Seconds())
}

func (r *Registry) ObserveTPS(model, channel string, tokens int, elapsed time.Duration) {
	if !r.Enabled() || r.tps == nil || elapsed <= 0 {
		return
	}
	tps := float64(tokens) / elapsed.Seconds()
	r.tps.WithLabelValues(safeLabel(model), safeLabel(channel)).Observe(tps)
}

func (r *Registry) RecordCacheLookup(layer, result string) {
	if !r.Enabled() || r.cacheLookups == nil {
		return
	}
	r.cacheLookups.WithLabelValues(safeLabel(layer), safeLabel(result)).Inc()
}

func (r *Registry) RecordCacheHit(layer string) {
	if !r.Enabled() || r.cacheHits == nil {
		return
	}
	r.cacheHits.WithLabelValues(safeLabel(layer)).Inc()
}

func (r *Registry) SetChannelHealth(channel, status string, value float64) {
	if !r.Enabled() || r.channelHealth == nil {
		return
	}
	r.channelHealth.WithLabelValues(safeLabel(channel), safeLabel(status)).Set(value)
}

func (r *Registry) IncActiveStreams(model string) {
	if !r.Enabled() || r.activeStreams == nil {
		return
	}
	r.activeStreams.WithLabelValues(safeLabel(model)).Inc()
}

func (r *Registry) DecActiveStreams(model string) {
	if !r.Enabled() || r.activeStreams == nil {
		return
	}
	r.activeStreams.WithLabelValues(safeLabel(model)).Dec()
}

func (r *Registry) RecordUpstreamError(channel, reason string) {
	if !r.Enabled() || r.upstreamErrors == nil {
		return
	}
	r.upstreamErrors.WithLabelValues(safeLabel(channel), safeLabel(reason)).Inc()
}

func (r *Registry) Handler() http.Handler {
	if !r.Enabled() {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		})
	}
	return promhttp.HandlerFor(r.reg, promhttp.HandlerOpts{})
}

func safeLabel(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return "unknown"
	}
	return v
}

func envOn(key string, defaultOn bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return defaultOn
	}
	switch strings.ToLower(raw) {
	case "1", "true", "on", "yes":
		return true
	case "0", "false", "off", "no":
		return false
	default:
		return defaultOn
	}
}
