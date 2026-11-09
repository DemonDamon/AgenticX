// Package configstatus records which snapshot each core config domain
// is currently serving, and the last time a reload failed.
package configstatus

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	DomainProviders  = "providers"
	DomainChannels   = "channels"
	DomainPolicy     = "policy"
	DomainMCPServers = "mcp_servers"
)

// ErrRemote404Keep is returned when a remote snapshot answers 404 after a
// snapshot has already been applied. Callers must not wrap it: LastError is
// this text verbatim.
var ErrRemote404Keep = errors.New("remote 404, keeping last known good")

// Outcome is one domain's applied snapshot and the latest check.
type Outcome struct {
	Domain              string    `json:"domain"`
	Source              string    `json:"source"`
	ContentHash         string    `json:"contentHash"`
	Version             string    `json:"version"`
	AppliedAt           time.Time `json:"appliedAt"`
	CheckedAt           time.Time `json:"checkedAt"`
	LastError           string    `json:"lastError"`
	ConsecutiveFailures int       `json:"consecutiveFailures"`
}

// Metrics receives apply success and failure signals. Nil is allowed.
type Metrics interface {
	IncConfigApplyFailure(domain string)
	SetConfigLastSuccess(domain string, at time.Time)
}

// Registry is the process-local record of core config domains.
type Registry struct {
	mu        sync.RWMutex
	outcomes  map[string]Outcome
	startedAt time.Time
	metrics   Metrics
}

func NewRegistry(metrics Metrics) *Registry {
	return &Registry{
		outcomes:  make(map[string]Outcome),
		startedAt: time.Now().UTC(),
		metrics:   metrics,
	}
}

func (r *Registry) StartedAt() time.Time {
	if r == nil {
		return time.Time{}
	}
	return r.startedAt
}

// ReportSuccess records a snapshot that is now being served.
func (r *Registry) ReportSuccess(domain, source, hash, version string) {
	if r == nil {
		return
	}
	now := time.Now().UTC()
	r.mu.Lock()
	r.outcomes[domain] = Outcome{
		Domain:              domain,
		Source:              sanitizeSource(source),
		ContentHash:         hash,
		Version:             version,
		AppliedAt:           now,
		CheckedAt:           now,
		LastError:           "",
		ConsecutiveFailures: 0,
	}
	metrics := r.metrics
	r.mu.Unlock()
	if metrics != nil {
		metrics.SetConfigLastSuccess(domain, now)
	}
}

// ReportFailure records a failed check and keeps the last applied snapshot fields.
func (r *Registry) ReportFailure(domain, source string, err error) {
	if r == nil {
		return
	}
	now := time.Now().UTC()
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	r.mu.Lock()
	prev := r.outcomes[domain]
	prev.Domain = domain
	prev.Source = sanitizeSource(source)
	prev.CheckedAt = now
	prev.LastError = msg
	prev.ConsecutiveFailures++
	r.outcomes[domain] = prev
	metrics := r.metrics
	r.mu.Unlock()
	if metrics != nil {
		metrics.IncConfigApplyFailure(domain)
	}
}

// Snapshot returns reported domains sorted by Domain. Domains that have never
// reported are omitted; callers that must always show the four core domains
// use FillCoreDomains.
func (r *Registry) Snapshot() []Outcome {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Outcome, 0, len(r.outcomes))
	for _, item := range r.outcomes {
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Domain < out[j].Domain })
	return out
}

// FillCoreDomains returns the four core domains, using reported rows when present.
func FillCoreDomains(have []Outcome) []Outcome {
	by := make(map[string]Outcome, len(have))
	for _, item := range have {
		by[item.Domain] = item
	}
	out := make([]Outcome, 0, 4)
	for _, domain := range []string{DomainChannels, DomainMCPServers, DomainPolicy, DomainProviders} {
		if item, ok := by[domain]; ok {
			out = append(out, item)
			continue
		}
		out = append(out, Outcome{Domain: domain})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Domain < out[j].Domain })
	return out
}

func HashBytes(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func InstanceID() string {
	if id := strings.TrimSpace(os.Getenv("GATEWAY_INSTANCE_ID")); id != "" {
		return id
	}
	host, err := os.Hostname()
	if err != nil {
		return "unknown"
	}
	host = strings.TrimSpace(host)
	if host == "" {
		return "unknown"
	}
	return host
}

func sanitizeSource(source string) string {
	source = strings.TrimSpace(source)
	parsed, err := url.Parse(source)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return source
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}
