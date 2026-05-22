package keypool

import (
	"os"
	"strings"
	"sync"
	"time"
)

const (
	defaultCooldownTTL       = 60 * time.Second
	defaultFailureThreshold  = 3
	statusActive             = "active"
	statusCooldown           = "cooldown"
	statusMissing            = "missing"
)

// ResolveResult holds the resolved key value and its env ref name.
type ResolveResult struct {
	Key    string
	KeyRef string
}

// KeyStat exposes health for admin UI.
type KeyStat struct {
	KeyRef              string    `json:"key_ref"`
	Status              string    `json:"status"`
	CooldownUntil       time.Time `json:"cooldown_until,omitempty"`
	LastError           string    `json:"last_error,omitempty"`
	ConsecutiveFailures int       `json:"consecutive_failures"`
}

type keyState struct {
	cooldownUntil       time.Time
	lastError           string
	consecutiveFailures int
}

// Pool resolves Channel-level upstream API keys with cooldown failover.
type Pool struct {
	mu              sync.Mutex
	cursors         map[string]int
	states          map[string]map[string]*keyState // poolID -> keyRef -> state
	cooldownTTL     time.Duration
	failureThreshold int
}

func NewPool() *Pool {
	return &Pool{
		cursors:          map[string]int{},
		states:           map[string]map[string]*keyState{},
		cooldownTTL:      defaultCooldownTTL,
		failureThreshold: defaultFailureThreshold,
	}
}

func (p *Pool) SetCooldownTTL(d time.Duration) {
	if d <= 0 {
		return
	}
	p.mu.Lock()
	p.cooldownTTL = d
	p.mu.Unlock()
}

// Resolve returns an available API key; directKey takes priority over keyRefs rotation.
func (p *Pool) Resolve(poolID, directKey string, keyRefs []string) string {
	return p.ResolveWithRef(poolID, directKey, keyRefs, nil).Key
}

// ResolveWithRef skips refs in exclude and returns both key value and ref name.
func (p *Pool) ResolveWithRef(poolID, directKey string, keyRefs []string, exclude map[string]struct{}) ResolveResult {
	if k := strings.TrimSpace(directKey); k != "" {
		return ResolveResult{Key: k, KeyRef: "direct"}
	}
	refs := normalizeRefs(keyRefs)
	if len(refs) == 0 {
		return ResolveResult{}
	}
	pid := normalizePoolID(poolID)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pruneExpiredLocked(pid)
	start := p.cursors[pid]
	for i := 0; i < len(refs); i++ {
		idx := (start + i) % len(refs)
		ref := refs[idx]
		if exclude != nil {
			if _, skip := exclude[ref]; skip {
				continue
			}
		}
		if p.inCooldownLocked(pid, ref) {
			continue
		}
		if v := strings.TrimSpace(os.Getenv(ref)); v != "" {
			p.cursors[pid] = (idx + 1) % len(refs)
			return ResolveResult{Key: v, KeyRef: ref}
		}
	}
	return ResolveResult{}
}

// MarkFailure records a failure; enters cooldown after failureThreshold consecutive failures.
func (p *Pool) MarkFailure(poolID, keyRef, errMsg string) {
	ref := strings.TrimSpace(keyRef)
	if ref == "" || ref == "direct" {
		return
	}
	pid := normalizePoolID(poolID)
	p.mu.Lock()
	defer p.mu.Unlock()
	st := p.ensureStateLocked(pid, ref)
	st.consecutiveFailures++
	st.lastError = strings.TrimSpace(errMsg)
	if st.consecutiveFailures >= p.failureThreshold {
		st.cooldownUntil = time.Now().UTC().Add(p.cooldownTTL)
	}
}

// MarkSuccess clears consecutive failure count for a key ref.
func (p *Pool) MarkSuccess(poolID, keyRef string) {
	ref := strings.TrimSpace(keyRef)
	if ref == "" || ref == "direct" {
		return
	}
	pid := normalizePoolID(poolID)
	p.mu.Lock()
	defer p.mu.Unlock()
	st := p.ensureStateLocked(pid, ref)
	st.consecutiveFailures = 0
	st.lastError = ""
	st.cooldownUntil = time.Time{}
}

// ResetCooldown clears cooldown for one key ref (admin manual reset).
func (p *Pool) ResetCooldown(poolID, keyRef string) {
	ref := strings.TrimSpace(keyRef)
	if ref == "" {
		return
	}
	pid := normalizePoolID(poolID)
	p.mu.Lock()
	defer p.mu.Unlock()
	st := p.ensureStateLocked(pid, ref)
	st.cooldownUntil = time.Time{}
	st.consecutiveFailures = 0
	st.lastError = ""
}

// Stats returns health for each key ref in a pool.
func (p *Pool) Stats(poolID string, keyRefs []string) []KeyStat {
	pid := normalizePoolID(poolID)
	refs := normalizeRefs(keyRefs)
	p.mu.Lock()
	defer p.mu.Unlock()
	p.pruneExpiredLocked(pid)
	out := make([]KeyStat, 0, len(refs))
	for _, ref := range refs {
		st := p.ensureStateLocked(pid, ref)
		stat := KeyStat{
			KeyRef:              ref,
			LastError:           st.lastError,
			ConsecutiveFailures: st.consecutiveFailures,
		}
		if p.inCooldownLocked(pid, ref) {
			stat.Status = statusCooldown
			stat.CooldownUntil = st.cooldownUntil
		} else if strings.TrimSpace(os.Getenv(ref)) == "" {
			stat.Status = statusMissing
		} else {
			stat.Status = statusActive
		}
		out = append(out, stat)
	}
	return out
}

// MarkUnhealthy is an alias for MarkFailure with empty message (legacy callers).
func (p *Pool) MarkUnhealthy(poolID, keyRef string) {
	p.MarkFailure(poolID, keyRef, "marked unhealthy")
}

func (p *Pool) ensureStateLocked(poolID, keyRef string) *keyState {
	if p.states[poolID] == nil {
		p.states[poolID] = map[string]*keyState{}
	}
	st, ok := p.states[poolID][keyRef]
	if !ok {
		st = &keyState{}
		p.states[poolID][keyRef] = st
	}
	return st
}

func (p *Pool) inCooldownLocked(poolID, keyRef string) bool {
	st := p.states[poolID][keyRef]
	if st == nil {
		return false
	}
	if st.cooldownUntil.IsZero() {
		return false
	}
	return time.Now().UTC().Before(st.cooldownUntil)
}

func (p *Pool) pruneExpiredLocked(poolID string) {
	m := p.states[poolID]
	if m == nil {
		return
	}
	now := time.Now().UTC()
	for ref, st := range m {
		if !st.cooldownUntil.IsZero() && !now.Before(st.cooldownUntil) {
			st.cooldownUntil = time.Time{}
			if st.consecutiveFailures >= p.failureThreshold {
				st.consecutiveFailures = 0
			}
		}
		_ = ref
	}
}

func normalizePoolID(poolID string) string {
	pid := strings.TrimSpace(poolID)
	if pid == "" {
		return "default"
	}
	return pid
}

func normalizeRefs(in []string) []string {
	out := make([]string, 0, len(in))
	for _, ref := range in {
		ref = strings.TrimSpace(ref)
		if ref != "" {
			out = append(out, ref)
		}
	}
	return out
}
