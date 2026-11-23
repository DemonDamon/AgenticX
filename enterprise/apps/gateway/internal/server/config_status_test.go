package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/configstatus"
)

func TestInternalConfigStatusListsCoreDomains(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "status-token")
	reg := configstatus.NewRegistry(nil)
	for _, domain := range []string{
		configstatus.DomainProviders,
		configstatus.DomainChannels,
		configstatus.DomainPolicy,
		configstatus.DomainMCPServers,
	} {
		reg.ReportSuccess(domain, "http://127.0.0.1:9/"+domain+"?x=1", "abc", "")
	}
	s := &Server{configStatus: reg, startedAt: time.Now().UTC()}
	ts := httptest.NewServer(s.Router())
	t.Cleanup(ts.Close)

	unauthReq, err := http.NewRequest(http.MethodGet, ts.URL+"/internal/config-status", nil)
	if err != nil {
		t.Fatal(err)
	}
	unauthResp, err := http.DefaultClient.Do(unauthReq)
	if err != nil {
		t.Fatal(err)
	}
	_ = unauthResp.Body.Close()
	if unauthResp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d", unauthResp.StatusCode)
	}

	req, err := http.NewRequest(http.MethodGet, ts.URL+"/internal/config-status", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer status-token")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d body=%s", resp.StatusCode, body)
	}
	var decoded struct {
		InstanceID string `json:"instanceId"`
		Domains    []struct {
			Domain    string    `json:"domain"`
			Source    string    `json:"source"`
			AppliedAt time.Time `json:"appliedAt"`
		} `json:"domains"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.InstanceID == "" {
		t.Fatal("empty instanceId")
	}
	want := map[string]bool{
		configstatus.DomainProviders:  true,
		configstatus.DomainChannels:   true,
		configstatus.DomainPolicy:     true,
		configstatus.DomainMCPServers: true,
	}
	if len(decoded.Domains) != len(want) {
		t.Fatalf("domains = %+v", decoded.Domains)
	}
	for _, item := range decoded.Domains {
		if !want[item.Domain] {
			t.Fatalf("unexpected domain %q", item.Domain)
		}
		delete(want, item.Domain)
		if item.AppliedAt.IsZero() {
			t.Fatalf("%s appliedAt is zero", item.Domain)
		}
		if strings.Contains(item.Source, "?") {
			t.Fatalf("%s source kept query: %q", item.Domain, item.Source)
		}
	}
	if len(want) != 0 {
		t.Fatalf("missing domains %v", want)
	}
}
