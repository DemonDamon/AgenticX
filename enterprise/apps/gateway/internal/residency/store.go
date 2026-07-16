package residency

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
	"github.com/agenticx/enterprise/gateway/internal/gatewayinternal"
)

// ComplianceStore loads tenant data residency and cross-border policy.
type ComplianceStore struct {
	database  *database.Handle
	remoteURL string
	mu        sync.RWMutex
	byTenant  map[string]TenantPolicy
	fetchedAt time.Time
	cacheTTL  time.Duration
}

func NewComplianceStore(handle *database.Handle) *ComplianceStore {
	return &ComplianceStore{
		database:  handle,
		remoteURL: strings.TrimSpace(os.Getenv("GATEWAY_REMOTE_COMPLIANCE_URL")),
		byTenant:  map[string]TenantPolicy{},
		cacheTTL:  15 * time.Second,
	}
}

func (s *ComplianceStore) PolicyFor(ctx context.Context, tenantID string) TenantPolicy {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return TenantPolicy{CrossBorderAction: ActionAllow}
	}
	if s.database != nil {
		if p, err := s.queryPG(ctx, tenantID); err == nil {
			return p
		}
	}
	if u := strings.TrimSpace(s.remoteURL); u != "" && gatewayinternal.IsHTTPURL(u) {
		s.refreshRemote(u)
		s.mu.RLock()
		defer s.mu.RUnlock()
		if p, ok := s.byTenant[tenantID]; ok {
			return p
		}
	}
	return TenantPolicy{CrossBorderAction: ActionAllow}
}

func (s *ComplianceStore) queryPG(ctx context.Context, tenantID string) (TenantPolicy, error) {
	if s.database == nil {
		return TenantPolicy{}, context.Canceled
	}
	var residency, action *string
	row, err := s.database.QueryRowContext(ctx, `
SELECT data_residency, cross_border_action
FROM enterprise_runtime_compliance
WHERE tenant_id = ?`, tenantID)
	if err != nil {
		return TenantPolicy{}, err
	}
	err = row.Scan(&residency, &action)
	if err != nil {
		return TenantPolicy{}, err
	}
	p := TenantPolicy{CrossBorderAction: ActionAllow}
	if residency != nil {
		p.DataResidency = NormalizeRegion(*residency)
	}
	if action != nil && strings.TrimSpace(*action) != "" {
		p.CrossBorderAction = strings.ToLower(strings.TrimSpace(*action))
	}
	return p, nil
}

type complianceSnapshot struct {
	UpdatedAt string                    `json:"updatedAt"`
	Tenants   map[string]TenantPolicy   `json:"tenants"`
	Items     []complianceSnapshotEntry `json:"items"`
}

type complianceSnapshotEntry struct {
	TenantID          string `json:"tenantId"`
	DataResidency     string `json:"dataResidency"`
	CrossBorderAction string `json:"crossBorderAction"`
}

func (s *ComplianceStore) refreshRemote(url string) {
	s.mu.RLock()
	if !s.fetchedAt.IsZero() && time.Since(s.fetchedAt) < s.cacheTTL {
		s.mu.RUnlock()
		return
	}
	s.mu.RUnlock()

	raw, code, err := gatewayinternal.HTTPGet(url)
	if err != nil || code < 200 || code >= 300 {
		if err != nil {
			log.Printf("[compliance] remote fetch failed: %v", err)
		}
		return
	}
	var snap complianceSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		log.Printf("[compliance] parse snapshot failed: %v", err)
		return
	}
	next := map[string]TenantPolicy{}
	if snap.Tenants != nil {
		for k, v := range snap.Tenants {
			next[k] = v
		}
	}
	for _, item := range snap.Items {
		tid := strings.TrimSpace(item.TenantID)
		if tid == "" {
			continue
		}
		next[tid] = TenantPolicy{
			DataResidency:     NormalizeRegion(item.DataResidency),
			CrossBorderAction: strings.ToLower(strings.TrimSpace(item.CrossBorderAction)),
		}
	}
	s.mu.Lock()
	s.byTenant = next
	s.fetchedAt = time.Now()
	s.mu.Unlock()
}
