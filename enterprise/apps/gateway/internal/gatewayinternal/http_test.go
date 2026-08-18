package gatewayinternal

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPGetWithHeadersKeepsInternalAuthAndTenantRouting(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "internal-secret")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer internal-secret" {
			t.Errorf("authorization=%q", got)
		}
		if got := r.Header.Get("X-AgenticX-Tenant-Id"); got != "tenant-a" {
			t.Errorf("tenant header=%q", got)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(server.Close)

	body, code, err := HTTPGetWithHeaders(server.URL, map[string]string{"X-AgenticX-Tenant-Id": "tenant-a"})
	if err != nil || code != http.StatusOK || string(body) != `{"ok":true}` {
		t.Fatalf("HTTPGetWithHeaders body=%s code=%d err=%v", body, code, err)
	}
}
