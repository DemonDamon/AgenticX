package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/database"
)

// ManagedModelIdentity is the trusted identity used for model visibility checks.
type ManagedModelIdentity struct {
	TenantID  string
	UserID    string
	UserEmail string
	DeptID    string
}

// ManagedModelAuthorizer decides whether a managed Desktop identity may use a composite model id.
type ManagedModelAuthorizer interface {
	IsAllowed(ctx context.Context, identity ManagedModelIdentity, modelID string) (bool, error)
}

type modelAccessReader interface {
	EnabledModelIDs(ctx context.Context, tenantID string) ([]string, error)
	DepartmentAncestors(ctx context.Context, tenantID, deptID string) ([]string, error)
	AssignmentsForKeys(
		ctx context.Context,
		tenantID string,
		assignmentKeys []string,
	) (map[string][]string, error)
}

type modelAccessCacheEntry struct {
	effective map[string]struct{}
	expires   time.Time
}

// DBManagedModelAuthorizer loads visibility from enterprise_runtime_* tables.
type DBManagedModelAuthorizer struct {
	reader modelAccessReader
	ttl    time.Duration
	mu     sync.RWMutex
	cache  map[string]modelAccessCacheEntry
}

func NewDBManagedModelAuthorizer(handle *database.Handle) *DBManagedModelAuthorizer {
	return &DBManagedModelAuthorizer{
		reader: &sqlModelAccessReader{db: handle},
		ttl:    managedModelCacheTTLFromEnv(),
		cache:  map[string]modelAccessCacheEntry{},
	}
}

func NewManagedModelAuthorizerWithReader(reader modelAccessReader, ttl time.Duration) *DBManagedModelAuthorizer {
	if ttl <= 0 {
		ttl = 15 * time.Second
	}
	return &DBManagedModelAuthorizer{
		reader: reader,
		ttl:    ttl,
		cache:  map[string]modelAccessCacheEntry{},
	}
}

func managedModelCacheTTLFromEnv() time.Duration {
	raw := strings.TrimSpace(os.Getenv("GATEWAY_MANAGED_MODEL_CACHE_TTL"))
	if raw == "" {
		return 15 * time.Second
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d <= 0 {
		return 15 * time.Second
	}
	return d
}

func (a *DBManagedModelAuthorizer) IsAllowed(
	ctx context.Context,
	identity ManagedModelIdentity,
	modelID string,
) (bool, error) {
	if a == nil || a.reader == nil {
		return false, errors.New("auth:managed_model:unavailable")
	}
	tenantID := strings.TrimSpace(identity.TenantID)
	userID := strings.TrimSpace(identity.UserID)
	email := strings.ToLower(strings.TrimSpace(identity.UserEmail))
	deptID := strings.TrimSpace(identity.DeptID)
	modelID = strings.TrimSpace(modelID)
	if tenantID == "" || userID == "" || modelID == "" {
		return false, nil
	}

	cacheKey := tenantID + "\x00" + userID + "\x00" + email + "\x00" + deptID
	if effective, ok := a.cachedEffective(cacheKey); ok {
		_, allowed := effective[modelID]
		return allowed, nil
	}

	effective, err := a.loadEffective(ctx, tenantID, userID, email, deptID)
	if err != nil {
		return false, err
	}
	a.storeEffective(cacheKey, effective)
	_, allowed := effective[modelID]
	return allowed, nil
}

func (a *DBManagedModelAuthorizer) loadEffective(
	ctx context.Context,
	tenantID, userID, email, deptID string,
) (map[string]struct{}, error) {
	allEnabled, err := a.reader.EnabledModelIDs(ctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("auth:managed_model:enabled: %w", err)
	}
	ancestors := []string{}
	if deptID != "" {
		ancestors, err = a.reader.DepartmentAncestors(ctx, tenantID, deptID)
		if err != nil {
			return nil, fmt.Errorf("auth:managed_model:dept: %w", err)
		}
	}
	keys := make([]string, 0, len(ancestors)+2)
	for _, id := range ancestors {
		keys = append(keys, "dept:"+id)
	}
	keys = append(keys, userID)
	if email != "" {
		keys = append(keys, "email:"+email)
	}
	assignments, err := a.reader.AssignmentsForKeys(ctx, tenantID, keys)
	if err != nil {
		return nil, fmt.Errorf("auth:managed_model:assignments: %w", err)
	}
	return computeEffectiveModelIDs(allEnabled, assignments, ancestors, userID, email), nil
}

func (a *DBManagedModelAuthorizer) cachedEffective(key string) (map[string]struct{}, bool) {
	a.mu.RLock()
	entry, ok := a.cache[key]
	a.mu.RUnlock()
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expires) {
		a.mu.Lock()
		delete(a.cache, key)
		a.mu.Unlock()
		return nil, false
	}
	return entry.effective, true
}

func (a *DBManagedModelAuthorizer) storeEffective(key string, effective map[string]struct{}) {
	a.mu.Lock()
	a.cache[key] = modelAccessCacheEntry{
		effective: effective,
		expires:   time.Now().Add(a.ttl),
	}
	a.mu.Unlock()
}

// computeEffectiveModelIDs mirrors portal effective-models cascading restriction.
// deptAncestorsLeafFirst is leaf→root; computation reverses to root→leaf.
func computeEffectiveModelIDs(
	allEnabled []string,
	assignments map[string][]string,
	deptAncestorsLeafFirst []string,
	userID string,
	userEmail string,
) map[string]struct{} {
	effective := make(map[string]struct{}, len(allEnabled))
	for _, id := range allEnabled {
		id = strings.TrimSpace(id)
		if id != "" {
			effective[id] = struct{}{}
		}
	}

	rootToLeaf := make([]string, 0, len(deptAncestorsLeafFirst))
	for i := len(deptAncestorsLeafFirst) - 1; i >= 0; i-- {
		rootToLeaf = append(rootToLeaf, deptAncestorsLeafFirst[i])
	}
	for _, deptID := range rootToLeaf {
		configured, ok := assignments["dept:"+deptID]
		if !ok || len(configured) == 0 {
			continue
		}
		effective = intersectModelSet(effective, configured)
	}

	userKeys := []string{strings.TrimSpace(userID)}
	normalizedEmail := strings.ToLower(strings.TrimSpace(userEmail))
	if normalizedEmail != "" {
		userKeys = append(userKeys, "email:"+normalizedEmail)
	}
	userUnion := map[string]struct{}{}
	userConfigured := false
	for _, key := range userKeys {
		if key == "" {
			continue
		}
		configured, ok := assignments[key]
		if !ok || len(configured) == 0 {
			continue
		}
		userConfigured = true
		for _, id := range configured {
			id = strings.TrimSpace(id)
			if id != "" {
				userUnion[id] = struct{}{}
			}
		}
	}
	if userConfigured {
		allowed := make([]string, 0, len(userUnion))
		for id := range userUnion {
			allowed = append(allowed, id)
		}
		effective = intersectModelSet(effective, allowed)
	}
	return effective
}

func intersectModelSet(base map[string]struct{}, ids []string) map[string]struct{} {
	allowed := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id != "" {
			allowed[id] = struct{}{}
		}
	}
	out := make(map[string]struct{})
	for id := range base {
		if _, ok := allowed[id]; ok {
			out[id] = struct{}{}
		}
	}
	return out
}

type sqlModelAccessReader struct {
	db *database.Handle
}

type providerModelJSON struct {
	Name    string `json:"name"`
	Enabled *bool  `json:"enabled"`
}

func (r *sqlModelAccessReader) EnabledModelIDs(ctx context.Context, tenantID string) ([]string, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("database unavailable")
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT provider_id, models
FROM enterprise_runtime_model_providers
WHERE tenant_id = ? AND enabled = TRUE`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var providerID string
		var modelsRaw []byte
		if err := rows.Scan(&providerID, &modelsRaw); err != nil {
			return nil, err
		}
		providerID = strings.TrimSpace(providerID)
		if providerID == "" {
			continue
		}
		var models []providerModelJSON
		if len(modelsRaw) > 0 {
			if err := json.Unmarshal(modelsRaw, &models); err != nil {
				return nil, err
			}
		}
		for _, m := range models {
			name := strings.TrimSpace(m.Name)
			if name == "" {
				continue
			}
			enabled := true
			if m.Enabled != nil {
				enabled = *m.Enabled
			}
			if !enabled {
				continue
			}
			out = append(out, providerID+"/"+name)
		}
	}
	return out, rows.Err()
}

func (r *sqlModelAccessReader) DepartmentAncestors(ctx context.Context, tenantID, deptID string) ([]string, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("database unavailable")
	}
	ids := make([]string, 0)
	seen := map[string]struct{}{}
	current := strings.TrimSpace(deptID)
	for current != "" {
		if _, ok := seen[current]; ok {
			break
		}
		seen[current] = struct{}{}
		row, err := r.db.QueryRowContext(ctx, `
SELECT id, COALESCE(parent_id, '')
FROM departments
WHERE tenant_id = ? AND id = ?
LIMIT 1`, tenantID, current)
		if err != nil {
			return nil, err
		}
		var id, parent string
		if err := row.Scan(&id, &parent); err != nil {
			// Missing dept: stop chain (same as portal break).
			break
		}
		ids = append(ids, strings.TrimSpace(id))
		current = strings.TrimSpace(parent)
	}
	return ids, nil
}

func (r *sqlModelAccessReader) AssignmentsForKeys(
	ctx context.Context,
	tenantID string,
	assignmentKeys []string,
) (map[string][]string, error) {
	out := map[string][]string{}
	if r == nil || r.db == nil {
		return nil, errors.New("database unavailable")
	}
	keys := make([]string, 0, len(assignmentKeys))
	for _, k := range assignmentKeys {
		k = strings.TrimSpace(k)
		if k != "" {
			keys = append(keys, k)
		}
	}
	if len(keys) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(keys))
	args := make([]any, 0, len(keys)+1)
	args = append(args, tenantID)
	for i, k := range keys {
		placeholders[i] = "?"
		args = append(args, k)
	}
	query := fmt.Sprintf(`
SELECT assignment_key, model_id
FROM enterprise_runtime_user_visible_models
WHERE tenant_id = ? AND assignment_key IN (%s)`, strings.Join(placeholders, ","))
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var key, modelID string
		if err := rows.Scan(&key, &modelID); err != nil {
			return nil, err
		}
		key = strings.TrimSpace(key)
		modelID = strings.TrimSpace(modelID)
		if key == "" || modelID == "" {
			continue
		}
		out[key] = append(out[key], modelID)
	}
	return out, rows.Err()
}
