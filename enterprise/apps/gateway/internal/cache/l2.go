package cache

import (
	"math"
	"strings"
	"sync"
	"time"
)

type l2Record struct {
	vector   []float64
	entry    Entry
	expires  time.Time
}

type l2Hit struct {
	Entry      Entry
	Similarity float64
}

// L2Index is a lightweight in-memory semantic cache using bag-of-token vectors.
type L2Index struct {
	mu        sync.RWMutex
	threshold float64
	records   map[string][]l2Record
}

func NewL2Index(threshold float64) *L2Index {
	if threshold <= 0 {
		threshold = 0.92
	}
	return &L2Index{threshold: threshold, records: make(map[string][]l2Record)}
}

func (l *L2Index) SetThreshold(threshold float64) {
	l.mu.Lock()
	l.threshold = threshold
	l.mu.Unlock()
}

func (l *L2Index) bucketKey(tenantID, userID, model string) string {
	return strings.TrimSpace(tenantID) + "|" + strings.TrimSpace(userID) + "|" + strings.TrimSpace(model)
}

func (l *L2Index) Lookup(tenantID, userID, model, prompt string) (l2Hit, bool) {
	vec := embedText(prompt)
	l.mu.RLock()
	defer l.mu.RUnlock()
	records := l.records[l.bucketKey(tenantID, userID, model)]
	bestSim := 0.0
	var best Entry
	now := time.Now()
	for _, rec := range records {
		if !rec.expires.IsZero() && now.After(rec.expires) {
			continue
		}
		sim := cosineSimilarity(vec, rec.vector)
		if sim > bestSim {
			bestSim = sim
			best = rec.entry
		}
	}
	if bestSim >= l.threshold {
		return l2Hit{Entry: best, Similarity: bestSim}, true
	}
	return l2Hit{}, false
}

func (l *L2Index) Write(tenantID, userID, model, prompt string, entry Entry, ttl time.Duration) {
	if ttl <= 0 {
		ttl = time.Hour
	}
	key := l.bucketKey(tenantID, userID, model)
	rec := l2Record{vector: embedText(prompt), entry: entry, expires: time.Now().Add(ttl)}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.records[key] = append(l.records[key], rec)
	if len(l.records[key]) > 256 {
		l.records[key] = l.records[key][len(l.records[key])-256:]
	}
}

func embedText(text string) []float64 {
	tokens := tokenize(text)
	if len(tokens) == 0 {
		return []float64{0}
	}
	vec := make([]float64, 128)
	for _, tok := range tokens {
		idx := int(hashToken(tok) % uint64(len(vec)))
		vec[idx] += 1
	}
	norm := 0.0
	for _, v := range vec {
		norm += v * v
	}
	if norm == 0 {
		return vec
	}
	inv := 1 / math.Sqrt(norm)
	for i := range vec {
		vec[i] *= inv
	}
	return vec
}

func tokenize(text string) []string {
	fields := strings.Fields(strings.ToLower(text))
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		f = strings.Trim(f, ".,!?;:\"'()[]{}")
		if f != "" {
			out = append(out, f)
		}
	}
	return out
}

func hashToken(tok string) uint64 {
	var h uint64 = 1469598103934665603
	for i := 0; i < len(tok); i++ {
		h ^= uint64(tok[i])
		h *= 1099511628211
	}
	return h
}

func cosineSimilarity(a, b []float64) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	n := len(a)
	if len(b) < n {
		n = len(b)
	}
	var dot, na, nb float64
	for i := 0; i < n; i++ {
		dot += a[i] * b[i]
		na += a[i] * a[i]
		nb += b[i] * b[i]
	}
	if na == 0 || nb == 0 {
		return 0
	}
	return dot / (math.Sqrt(na) * math.Sqrt(nb))
}
