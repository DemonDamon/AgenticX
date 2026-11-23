package configstatus

import (
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeMetrics struct {
	failures map[string]int
	success  map[string]int
}

func (f *fakeMetrics) IncConfigApplyFailure(domain string) {
	if f.failures == nil {
		f.failures = map[string]int{}
	}
	f.failures[domain]++
}

func (f *fakeMetrics) SetConfigLastSuccess(domain string, at time.Time) {
	if at.IsZero() {
		return
	}
	if f.success == nil {
		f.success = map[string]int{}
	}
	f.success[domain]++
}

func TestReportSuccessFailureSuccess(t *testing.T) {
	metrics := &fakeMetrics{}
	reg := NewRegistry(metrics)
	source := "http://127.0.0.1:9/providers?x=1"

	reg.ReportSuccess(DomainProviders, source, "h1", "")
	snap := reg.Snapshot()
	if len(snap) != 1 {
		t.Fatalf("snapshot len = %d", len(snap))
	}
	if snap[0].ConsecutiveFailures != 0 || snap[0].LastError != "" {
		t.Fatalf("after success: %+v", snap[0])
	}
	if strings.Contains(snap[0].Source, "?") || strings.Contains(snap[0].Source, "x=1") {
		t.Fatalf("source kept query: %q", snap[0].Source)
	}
	applied := snap[0].AppliedAt
	if applied.IsZero() {
		t.Fatal("appliedAt zero after success")
	}

	reg.ReportFailure(DomainProviders, source, errors.New("parse failed"))
	snap = reg.Snapshot()
	if snap[0].ConsecutiveFailures != 1 || snap[0].LastError != "parse failed" {
		t.Fatalf("after first failure: %+v", snap[0])
	}
	if !snap[0].AppliedAt.Equal(applied) || snap[0].ContentHash != "h1" {
		t.Fatalf("failure replaced last good snapshot: %+v", snap[0])
	}

	reg.ReportFailure(DomainProviders, source, errors.New("parse failed"))
	snap = reg.Snapshot()
	if snap[0].ConsecutiveFailures != 2 {
		t.Fatalf("consecutive = %d", snap[0].ConsecutiveFailures)
	}

	reg.ReportSuccess(DomainProviders, source, "h2", "")
	snap = reg.Snapshot()
	if snap[0].ConsecutiveFailures != 0 || snap[0].LastError != "" || snap[0].ContentHash != "h2" {
		t.Fatalf("after second success: %+v", snap[0])
	}
	if metrics.failures[DomainProviders] != 2 {
		t.Fatalf("failure callbacks = %d", metrics.failures[DomainProviders])
	}
	if metrics.success[DomainProviders] < 1 {
		t.Fatalf("success callbacks = %d", metrics.success[DomainProviders])
	}
}

func TestFillCoreDomainsAlwaysFour(t *testing.T) {
	got := FillCoreDomains(nil)
	want := []string{DomainChannels, DomainMCPServers, DomainPolicy, DomainProviders}
	if len(got) != len(want) {
		t.Fatalf("len = %d", len(got))
	}
	for i, domain := range want {
		if got[i].Domain != domain {
			t.Fatalf("domain[%d] = %q, want %q", i, got[i].Domain, domain)
		}
	}
}
