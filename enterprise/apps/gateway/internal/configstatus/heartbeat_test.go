package configstatus

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func unsetProxyEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"} {
		t.Setenv(key, "")
	}
}

func TestSendHeartbeatSkipsWhenURLUnset(t *testing.T) {
	t.Setenv("GATEWAY_ADMIN_HEARTBEAT_URL", "")
	if err := SendHeartbeat(NewRegistry(nil), time.Now().UTC()); err != nil {
		t.Fatalf("unset url should not send: %v", err)
	}
}

func TestSendHeartbeatPostsBearerAndFourDomains(t *testing.T) {
	unsetProxyEnv(t)
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "heartbeat-token")
	t.Setenv("GATEWAY_INSTANCE_ID", "gw-a")

	var gotAuth string
	var gotBody StatusBody
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&gotBody); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)
	t.Setenv("GATEWAY_ADMIN_HEARTBEAT_URL", server.URL)

	reg := NewRegistry(nil)
	reg.ReportSuccess(DomainProviders, "http://127.0.0.1/providers", "hash-providers", "")
	reg.ReportSuccess(DomainChannels, "http://127.0.0.1/channels", "hash-channels", "")
	reg.ReportSuccess(DomainPolicy, "http://127.0.0.1/policy", "hash-policy", "pub-a,pub-b")
	reg.ReportSuccess(DomainMCPServers, "http://127.0.0.1/mcp", "hash-mcp", "")

	if err := SendHeartbeat(reg, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer heartbeat-token" {
		t.Fatalf("authorization = %q", gotAuth)
	}
	if gotBody.InstanceID != "gw-a" {
		t.Fatalf("instanceId = %q", gotBody.InstanceID)
	}
	if len(gotBody.Domains) != 4 {
		t.Fatalf("domains = %+v", gotBody.Domains)
	}
	want := map[string]bool{
		DomainProviders:  true,
		DomainChannels:   true,
		DomainPolicy:     true,
		DomainMCPServers: true,
	}
	for _, item := range gotBody.Domains {
		if !want[item.Domain] {
			t.Fatalf("unexpected domain %q", item.Domain)
		}
		delete(want, item.Domain)
	}
	if len(want) != 0 {
		t.Fatalf("missing domains %v", want)
	}
}

func TestSendHeartbeatRejectsNon2xx(t *testing.T) {
	unsetProxyEnv(t)
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "heartbeat-token")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(server.Close)
	t.Setenv("GATEWAY_ADMIN_HEARTBEAT_URL", server.URL)

	err := SendHeartbeat(NewRegistry(nil), time.Now().UTC())
	if err == nil {
		t.Fatal("expected error for non-2xx")
	}
}
