package observability

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func phaseTestSampler(every uint64, output *bytes.Buffer) *PhaseSampler {
	return NewPhaseSampler(every, slog.New(slog.NewJSONHandler(output, nil)), nil)
}

func TestPhaseSamplingIsExplicitAndBounded(t *testing.T) {
	for _, raw := range []string{"", "0", "-1", "unknown", "1000001", "18446744073709551616"} {
		t.Run(raw, func(t *testing.T) {
			t.Setenv("GATEWAY_REQUEST_DIAGNOSTICS_SAMPLE_EVERY", raw)
			ctx := context.Background()
			got, recorder := NewPhaseSamplerFromEnv(nil, nil).Start(ctx)
			if got != ctx || recorder != nil {
				t.Fatal("invalid/disabled config sampled a request")
			}
		})
	}
	var output bytes.Buffer
	sampler := phaseTestSampler(3, &output)
	for i := 0; i < 10; i++ {
		ctx, recorder := sampler.Start(context.Background())
		if (recorder != nil) != (i%3 == 0) {
			t.Fatalf("sample %d: %v", i, recorder != nil)
		}
		if PhasesFromContext(ctx) != recorder {
			t.Fatal("context recorder mismatch")
		}
	}
}

func TestDisabledPhasePathDoesNotAllocate(t *testing.T) {
	ctx := context.Background()
	sampler := NewPhaseSampler(0, nil, nil)
	if got := testing.AllocsPerRun(1000, func() {
		got, recorder := sampler.Start(ctx)
		if got != ctx || recorder != nil {
			panic("disabled path changed context")
		}
		PhasesFromContext(got).Mark(FirstContent)
		recorder.Finish(got, ReasonCompleted)
	}); got != 0 {
		t.Fatalf("disabled path allocations=%v", got)
	}
}

func TestPhaseSnapshotIsFirstOnlyAndReasonSafe(t *testing.T) {
	var output bytes.Buffer
	ctx, recorder := phaseTestSampler(1, &output).Start(context.Background())
	recorder.MarkAt(ResponseHeaders, recorder.started.Add(7*time.Millisecond))
	recorder.MarkAt(ResponseHeaders, recorder.started.Add(time.Hour))
	recorder.MarkAt(FirstBodyByte, recorder.started.Add(48*time.Hour))
	recorder.ObserveAdmission(-time.Second)
	recorder.SetReason(TerminalReason("sk-fake-private-body https://secret.invalid/?query=private nonce-private"))
	for i := 0; i < 5; i++ {
		recorder.Finish(ctx, ReasonCompleted)
	}
	recorder.Mark(FirstContent)
	snapshot := recorder.Snapshot()
	if snapshot.ResponseHeadersMS != 7 || snapshot.FirstBodyByteMS != maxPhaseDuration.Milliseconds() || snapshot.AdmissionWaitMS != 0 || snapshot.FirstContentMS != -1 || snapshot.Reason != ReasonOther {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	if bytes.Count(output.Bytes(), []byte("\n")) != 1 || output.Len() > 768 {
		t.Fatalf("unbounded output: %s", output.String())
	}
	for _, secret := range []string{"sk-fake", "private-body", "secret.invalid", "query", "nonce-private"} {
		if strings.Contains(output.String(), secret) {
			t.Fatalf("secret field leaked: %s", output.String())
		}
	}
}

func TestConcurrentPhaseFinishEmitsOneRecord(t *testing.T) {
	var output bytes.Buffer
	ctx, recorder := phaseTestSampler(1, &output).Start(context.Background())
	var group sync.WaitGroup
	for i := 0; i < 64; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			recorder.Mark(FirstBodyByte)
			recorder.Snapshot()
			recorder.Finish(ctx, ReasonCompleted)
		}()
	}
	group.Wait()
	if bytes.Count(output.Bytes(), []byte("\n")) != 1 {
		t.Fatalf("duplicate records=%s", output.String())
	}
}

func TestPhaseMiddlewareNeverCapturesRequestData(t *testing.T) {
	const secret = "sk-fake-secret-body-user-query-nonce"
	var output bytes.Buffer
	handler := phaseTestSampler(1, &output).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		PhasesFromContext(r.Context()).SetReason(TerminalReason(secret))
		w.WriteHeader(http.StatusBadGateway)
	}))
	req := httptest.NewRequest(http.MethodPost, "https://private.invalid/"+secret+"?query="+secret, strings.NewReader(secret))
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("X-User", secret)
	req.Header.Set("X-Nonce", secret)
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if strings.Contains(output.String(), secret) || strings.Contains(output.String(), "private.invalid") {
		t.Fatal("request data leaked")
	}
	var record map[string]any
	if err := json.Unmarshal(output.Bytes(), &record); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]bool{"time": true, "level": true, "msg": true, "event": true, "reason": true, "admission_wait_ms": true, "upstream_start_ms": true, "response_headers_ms": true, "first_body_byte_ms": true, "first_content_ms": true, "total_ms": true}
	for key := range record {
		if !allowed[key] {
			t.Fatalf("unexpected log key %q", key)
		}
	}
	if record["reason"] != string(ReasonOther) {
		t.Fatalf("reason=%v", record["reason"])
	}
}

func TestPhaseHTTPFallbackAndExplicitOutcome(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		cancel bool
		reason TerminalReason
	}{
		{"ok", 200, false, ReasonCompleted}, {"rejected", 400, false, ReasonRejected}, {"auth", 401, false, ReasonAuth},
		{"forbidden", 403, false, ReasonForbidden}, {"rate", 429, false, ReasonRateLimited}, {"internal", 500, false, ReasonInternalError},
		{"cancelled", 200, true, ReasonClientCancelled},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var output bytes.Buffer
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if tc.cancel {
				cancel()
			}
			handler := phaseTestSampler(1, &output).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(tc.status) }))
			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx))
			var record struct{ Reason TerminalReason }
			if err := json.Unmarshal(output.Bytes(), &record); err != nil {
				t.Fatal(err)
			}
			if record.Reason != tc.reason {
				t.Fatalf("reason=%s", record.Reason)
			}
		})
	}
}

func TestPhaseMetricsHaveOnlyAllowlistedLabels(t *testing.T) {
	registry := &Registry{enabled: true}
	registry.register()
	var output bytes.Buffer
	ctx, recorder := NewPhaseSampler(1, slog.New(slog.NewJSONHandler(&output, nil)), registry).Start(context.Background())
	recorder.Mark(ResponseHeaders)
	recorder.SetReason(TerminalReason("secret-user-query-nonce"))
	recorder.Finish(ctx, ReasonCompleted)
	recorder.Finish(ctx, ReasonCompleted)
	families, err := registry.reg.Gather()
	if err != nil {
		t.Fatal(err)
	}
	terminalCount := float64(0)
	for _, family := range families {
		if !strings.HasPrefix(family.GetName(), "agx_gateway_request_") {
			continue
		}
		for _, metric := range family.Metric {
			for _, label := range metric.Label {
				switch label.GetName() {
				case "reason":
					if label.GetValue() != string(ReasonOther) {
						t.Fatalf("reason=%q", label.GetValue())
					}
				case "phase":
					if label.GetValue() != "response_headers" && label.GetValue() != "total" {
						t.Fatalf("phase=%q", label.GetValue())
					}
				default:
					t.Fatalf("unexpected diagnostic label=%q", label.GetName())
				}
			}
			if family.GetName() == "agx_gateway_request_terminal_total" {
				terminalCount += metric.GetCounter().GetValue()
			}
		}
	}
	if terminalCount != 1 {
		t.Fatalf("terminal count=%v", terminalCount)
	}
}

func TestNestedPhaseMiddlewareStillEmitsOneRecord(t *testing.T) {
	var output bytes.Buffer
	sampler := phaseTestSampler(1, &output)
	handler := sampler.HTTPMiddleware()(sampler.HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", nil))
	if bytes.Count(output.Bytes(), []byte("\n")) != 1 {
		t.Fatalf("duplicate records: %s", output.String())
	}
}

func TestPhaseMiddlewarePanicDoesNotLogPanicValue(t *testing.T) {
	var output bytes.Buffer
	handler := phaseTestSampler(1, &output).HTTPMiddleware()(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		PhasesFromContext(r.Context()).SetReason(ReasonCompleted)
		panic("sk-fake-private-body")
	}))
	func() {
		defer func() {
			if recover() == nil {
				t.Error("panic semantics changed")
			}
		}()
		handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", nil))
	}()
	if strings.Contains(output.String(), "sk-fake") || !strings.Contains(output.String(), `"reason":"internal_error"`) {
		t.Fatalf("unsafe panic record: %s", output.String())
	}
}

func TestDisabledPhaseMiddlewareDoesNotAllocate(t *testing.T) {
	handler := NewPhaseSampler(0, nil, nil).HTTPMiddleware()(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	req, response := httptest.NewRequest(http.MethodGet, "/", nil), httptest.NewRecorder()
	if allocs := testing.AllocsPerRun(1000, func() { handler.ServeHTTP(response, req) }); allocs != 0 {
		t.Fatalf("disabled middleware allocations=%v", allocs)
	}
}

func TestLateCancellationOverridesEarlierSuccessEvidence(t *testing.T) {
	var output bytes.Buffer
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handler := phaseTestSampler(1, &output).HTTPMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		PhasesFromContext(r.Context()).SetReason(ReasonCompleted)
		cancel()
	}))
	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", nil).WithContext(ctx))
	if !strings.Contains(output.String(), `"reason":"client_cancelled"`) {
		t.Fatalf("stale terminal reason: %s", output.String())
	}
}
