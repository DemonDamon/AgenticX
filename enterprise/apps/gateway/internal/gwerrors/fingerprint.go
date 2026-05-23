package gwerrors

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/blake2b"
)

var (
	numRe     = regexp.MustCompile(`\d{5,}`)
	uuidRe    = regexp.MustCompile(`(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`)
	requestRe = regexp.MustCompile(`(?i)(req[_-]?id|request[_-]?id)[:=\s]+[\w-]+`)
)

// Record is a clustered upstream error fingerprint entry.
type Record struct {
	TenantID      string    `json:"tenant_id"`
	Fingerprint   string    `json:"fingerprint"`
	StatusCode    int       `json:"status_code"`
	ErrorType     string    `json:"error_type"`
	Message       string    `json:"message"`
	ChannelID     string    `json:"channel_id,omitempty"`
	Count         int64     `json:"count"`
	FirstSeen     time.Time `json:"first_seen"`
	LastSeen      time.Time `json:"last_seen"`
	RequestIDs    []string  `json:"request_ids,omitempty"`
}

// ComputeFingerprint hashes normalized upstream error attributes.
func ComputeFingerprint(status int, errType, message string) string {
	norm := normalizeMessage(message)
	raw := fmt.Sprintf("%d|%s|%s", status, strings.TrimSpace(errType), norm)
	sum := blake2b.Sum256([]byte(raw))
	return fmt.Sprintf("%x", sum[:8])
}

func normalizeMessage(message string) string {
	s := strings.TrimSpace(message)
	s = uuidRe.ReplaceAllString(s, "<uuid>")
	s = requestRe.ReplaceAllString(s, "request_id=<id>")
	s = numRe.ReplaceAllString(s, "<num>")
	s = strings.Join(strings.Fields(s), " ")
	return strings.ToLower(s)
}

// Store keeps sliding-window error clusters in memory (24h prune on read).
type Store struct {
	mu      sync.RWMutex
	entries map[string]*Record
}

func NewStore() *Store {
	return &Store{entries: map[string]*Record{}}
}

func storeKey(tenantID, fingerprint string) string {
	return tenantID + "::" + fingerprint
}

func (s *Store) RecordError(tenantID, requestID, channelID string, status int, errType, message string) Record {
	if s == nil {
		return Record{}
	}
	fp := ComputeFingerprint(status, errType, message)
	key := storeKey(tenantID, fp)
	now := time.Now().UTC()
	s.mu.Lock()
	defer s.mu.Unlock()
	rec, ok := s.entries[key]
	if !ok {
		rec = &Record{
			TenantID:    tenantID,
			Fingerprint: fp,
			StatusCode:  status,
			ErrorType:   errType,
			Message:     message,
			ChannelID:   channelID,
			Count:       1,
			FirstSeen:   now,
			LastSeen:    now,
		}
		s.entries[key] = rec
	} else {
		rec.Count++
		rec.LastSeen = now
		if channelID != "" {
			rec.ChannelID = channelID
		}
	}
	if requestID != "" {
		rec.RequestIDs = appendUnique(rec.RequestIDs, requestID, 20)
	}
	s.pruneLocked(now.Add(-24 * time.Hour))
	return *rec
}

func appendUnique(items []string, val string, max int) []string {
	for _, item := range items {
		if item == val {
			return items
		}
	}
	items = append(items, val)
	if len(items) > max {
		items = items[len(items)-max:]
	}
	return items
}

func (s *Store) List(tenantID string, limit int) []Record {
	if s == nil {
		return nil
	}
	if limit <= 0 {
		limit = 50
	}
	now := time.Now().UTC()
	s.mu.Lock()
	s.pruneLocked(now.Add(-24 * time.Hour))
	s.mu.Unlock()
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Record, 0, len(s.entries))
	for _, rec := range s.entries {
		if tenantID != "" && rec.TenantID != tenantID {
			continue
		}
		out = append(out, *rec)
	}
	sortRecords(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func sortRecords(items []Record) {
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && items[j-1].Count < items[j].Count; j-- {
			items[j-1], items[j] = items[j], items[j-1]
		}
	}
}

func (s *Store) pruneLocked(cutoff time.Time) {
	for key, rec := range s.entries {
		if rec.LastSeen.Before(cutoff) {
			delete(s.entries, key)
		}
	}
}

// ParseUpstreamError extracts status/type/message from OpenAI-style error JSON when possible.
func ParseUpstreamError(status int, body []byte) (errType, message string) {
	message = strings.TrimSpace(string(body))
	errType = "upstream_error"
	if len(body) == 0 {
		return errType, message
	}
	var parsed struct {
		Error struct {
			Type    string `json:"type"`
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil {
		if strings.TrimSpace(parsed.Error.Type) != "" {
			errType = parsed.Error.Type
		} else if strings.TrimSpace(parsed.Error.Code) != "" {
			errType = parsed.Error.Code
		}
		if strings.TrimSpace(parsed.Error.Message) != "" {
			message = parsed.Error.Message
		}
	}
	if status == 401 {
		errType = "invalid_api_key"
	}
	return errType, message
}

func StatusFromString(v string) int {
	n, _ := strconv.Atoi(strings.TrimSpace(v))
	return n
}
