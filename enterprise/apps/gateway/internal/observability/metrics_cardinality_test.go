package observability

import (
	"slices"
	"testing"
)

// TestRegistryLabelsForbidHighCardinalityIDs keeps session/trace/deployment IDs
// off Prometheus labels. Add new HistogramVec/CounterVec names to allowed
// before registering them.
func TestRegistryLabelsForbidHighCardinalityIDs(t *testing.T) {
	forbidden := []string{
		"session_id", "sessionId", "trace_id", "traceId",
		"deployment_id", "deploymentId", "gateway_trace_id",
	}
	allowed := map[string][]string{
		"agx_gateway_ttft_seconds":                  {"model", "channel", "inbound_protocol"},
		"agx_gateway_tokens_per_second":             {"model", "channel"},
		"agx_gateway_cache_hits_total":              {"layer"},
		"agx_gateway_cache_lookups_total":           {"layer", "result"},
		"agx_gateway_channel_health":                {"channel", "status"},
		"agx_gateway_active_streams":                {"model"},
		"agx_gateway_upstream_error_total":          {"channel", "reason"},
		"agx_plugin_invocations_total":              {"plugin"},
		"agx_plugin_errors_total":                   {"plugin"},
		"agx_plugin_latency_seconds":                {"plugin"},
		"agx_gateway_http_requests_total":           {"method", "route", "status"},
		"agx_gateway_http_request_duration_seconds": {"method", "route"},
	}
	for name, labels := range allowed {
		for _, f := range forbidden {
			if slices.Contains(labels, f) {
				t.Fatalf("%s must not use high-cardinality label %q", name, f)
			}
		}
	}
}
