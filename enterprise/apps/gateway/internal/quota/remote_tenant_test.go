package quota

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestRemoteQuotaSnapshotsAreFetchedAndCachedPerTenant(t *testing.T) {
	var mu sync.Mutex
	fetches := map[string]int{}
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.Header.Get("X-AgenticX-Tenant-Id")
		mu.Lock()
		fetches[tenantID]++
		mu.Unlock()
		limit := int64(0)
		switch tenantID {
		case "tenant-a":
			limit = 111
		case "tenant-b":
			limit = 222
		case "tenant-c":
			http.Error(w, "temporary failure", http.StatusInternalServerError)
			return
		default:
			http.Error(w, "tenant required", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"defaults":{"role":{"staff":{"monthlyTokens":%d,"action":"block"}},"model":{}},"users":{},"departments":{},"apiTokens":{}}`, limit)
	}))
	t.Cleanup(remote.Close)
	t.Setenv("GATEWAY_REMOTE_QUOTA_CONFIG_URL", remote.URL)
	dir := t.TempDir()
	tracker := NewTracker(filepath.Join(dir, "quota.json"), filepath.Join(dir, "usage.json"), nil)

	firstA := tracker.loadConfigForTenant("tenant-a")
	firstB := tracker.loadConfigForTenant("tenant-b")
	failedC := tracker.loadConfigForTenant("tenant-c")
	secondA := tracker.loadConfigForTenant("tenant-a")
	if got := firstA.Defaults.Role["staff"].MonthlyTokens; got != 111 {
		t.Fatalf("tenant-a limit=%d want=111", got)
	}
	if got := firstB.Defaults.Role["staff"].MonthlyTokens; got != 222 {
		t.Fatalf("tenant-b limit=%d want=222", got)
	}
	if got := secondA.Defaults.Role["staff"].MonthlyTokens; got != 111 {
		t.Fatalf("tenant-a cached limit=%d want=111", got)
	}
	if got := failedC.Defaults.Role["staff"].MonthlyTokens; got != 0 {
		t.Fatalf("failed tenant-c fetch leaked another tenant's limit: %d", got)
	}
	mu.Lock()
	defer mu.Unlock()
	if fetches["tenant-a"] != 1 || fetches["tenant-b"] != 1 || fetches["tenant-c"] != 1 || len(fetches) != 3 {
		t.Fatalf("remote fetches must be tenant-keyed, got %+v", fetches)
	}
}

func TestRemoteBudgetSnapshotsAreFetchedAndCachedPerTenant(t *testing.T) {
	var mu sync.Mutex
	fetches := map[string]int{}
	missingTenantHeader := false
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.Header.Get("X-AgenticX-Tenant-Id")
		mu.Lock()
		fetches[tenantID]++
		fetchNumber := fetches[tenantID]
		if tenantID == "" {
			missingTenantHeader = true
		}
		mu.Unlock()

		limit := int64(0)
		switch tenantID {
		case "tenant-a":
			if fetchNumber > 1 {
				http.Error(w, "temporary failure", http.StatusInternalServerError)
				return
			}
			limit = 111
		case "tenant-b":
			limit = 222
		case "tenant-c":
			http.Error(w, "temporary failure", http.StatusInternalServerError)
			return
		default:
			http.Error(w, "tenant required", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"companyLimits":{"tokens":%d},"defaults":{},"tenants":{},"departments":{},"users":{}}`, limit)
	}))
	t.Cleanup(remote.Close)
	t.Setenv("GATEWAY_REMOTE_BUDGET_CONFIG_URL", remote.URL)
	dir := t.TempDir()
	tracker := NewTracker(filepath.Join(dir, "quota.json"), filepath.Join(dir, "usage.json"), nil)
	tracker.budgetUsagePath = filepath.Join(dir, "budget-usage.json")

	firstA := tracker.loadBudgetConfigForTenant("tenant-a")
	firstB := tracker.loadBudgetConfigForTenant("tenant-b")
	failedC := tracker.loadBudgetConfigForTenant("tenant-c")
	secondA := tracker.loadBudgetConfigForTenant("tenant-a")
	if got := firstA.CompanyLimits.Tokens; got != 111 {
		t.Fatalf("tenant-a token limit=%d want=111", got)
	}
	if got := firstB.CompanyLimits.Tokens; got != 222 {
		t.Fatalf("tenant-b token limit=%d want=222", got)
	}
	if got := secondA.CompanyLimits.Tokens; got != 111 {
		t.Fatalf("tenant-a cached token limit=%d want=111", got)
	}
	if got := failedC.CompanyLimits.Tokens; got != 0 {
		t.Fatalf("failed tenant-c fetch leaked another tenant's token limit: %d", got)
	}

	// Expire only tenant A and make its next fetch fail. It may fall back to A's
	// own last snapshot, but must never use tenant B's still-fresh snapshot.
	tracker.budgetRemoteMu.Lock()
	staleA := tracker.budgetRemoteSnapshots["tenant-a"]
	staleA.Fetched = time.Now().Add(-11 * time.Second)
	tracker.budgetRemoteSnapshots["tenant-a"] = staleA
	tracker.budgetRemoteMu.Unlock()
	failedRefreshA := tracker.loadBudgetConfigForTenant("tenant-a")
	if got := failedRefreshA.CompanyLimits.Tokens; got != 111 {
		t.Fatalf("tenant-a failed refresh token limit=%d want own cached 111", got)
	}

	if blocked := tracker.CheckBudget(RequestContext{TenantID: "tenant-a", UserID: "u-a"}, 112, 0); blocked.Allowed {
		t.Fatalf("tenant-a budget must use tenant-a snapshot: %+v", blocked)
	}
	if allowed := tracker.CheckBudget(RequestContext{TenantID: "tenant-b", UserID: "u-b"}, 112, 0); !allowed.Allowed {
		t.Fatalf("tenant-b budget must use tenant-b snapshot: %+v", allowed)
	}

	mu.Lock()
	defer mu.Unlock()
	if missingTenantHeader {
		t.Fatal("remote budget request omitted authenticated tenant header")
	}
	if fetches["tenant-a"] != 3 || fetches["tenant-b"] != 1 || fetches["tenant-c"] != 1 || len(fetches) != 3 {
		t.Fatalf("remote budget fetches must be tenant-keyed, got %+v", fetches)
	}
}
