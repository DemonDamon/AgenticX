package channel

import (
	"math/rand"
	"strings"
	"sync"
	"time"
)

// Identity 供 affinity 使用的会话主体。
type Identity struct {
	TenantID  string
	UserID    string
	SessionID string
}

// Picker 加权选择 + session 亲和。
type Picker struct {
	registry *Registry
	stats    *StatsStore
	affinity *AffinityStore
	rng      *rand.Rand
	mu       sync.Mutex
}

func NewPicker(registry *Registry, stats *StatsStore, affinity *AffinityStore) *Picker {
	return &Picker{
		registry: registry,
		stats:    stats,
		affinity: affinity,
		rng:      rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

// Pick 返回候选 Channel；exclude 用于重试时跳过已失败通道。
func (p *Picker) Pick(model string, id Identity, exclude map[string]struct{}) (Channel, bool) {
	if p == nil || p.registry == nil {
		return Channel{}, false
	}
	cands := p.registry.ListByModel(id.TenantID, model)
	if len(cands) == 0 {
		return Channel{}, false
	}
	now := time.Now()
	healthy := make([]Channel, 0, len(cands))
	for _, ch := range cands {
		if exclude != nil {
			if _, skip := exclude[ch.ID]; skip {
				continue
			}
		}
		if p.stats != nil && p.stats.InCooldown(ch.ID, now) {
			continue
		}
		healthy = append(healthy, ch)
	}
	if len(healthy) == 0 {
		// 全部 cooldown 时仍允许加权抽样（回退默认 Channel）
		healthy = cands
		for _, skip := range exclude {
			_ = skip
			break
		}
		if len(exclude) > 0 {
			filtered := make([]Channel, 0, len(cands))
			for _, ch := range cands {
				if _, skip := exclude[ch.ID]; skip {
					continue
				}
				filtered = append(filtered, ch)
			}
			if len(filtered) > 0 {
				healthy = filtered
			}
		}
	}

	if p.affinity != nil {
		if lastID, ok := p.affinity.Get(id.SessionID, model); ok {
			for _, ch := range healthy {
				if ch.ID == lastID {
					return ch, true
				}
			}
		}
	}

	return p.weightedSample(healthy), true
}

func (p *Picker) weightedSample(cands []Channel) Channel {
	if len(cands) == 0 {
		return Channel{}
	}
	if len(cands) == 1 {
		return cands[0]
	}
	total := 0
	for _, ch := range cands {
		w := ch.Weight
		if w <= 0 {
			w = 1
		}
		total += w
	}
	if total <= 0 {
		return cands[0]
	}
	p.mu.Lock()
	n := p.rng.Intn(total)
	p.mu.Unlock()
	for _, ch := range cands {
		w := ch.Weight
		if w <= 0 {
			w = 1
		}
		if n < w {
			return ch
		}
		n -= w
	}
	return cands[len(cands)-1]
}

func (p *Picker) MarkSuccess(id Identity, model string, ch Channel, latencyMS int64) {
	if p.affinity != nil && strings.TrimSpace(id.SessionID) != "" {
		p.affinity.Set(id.SessionID, model, ch.ID)
	}
	if p.stats != nil {
		p.stats.RecordSuccess(ch.ID, latencyMS)
	}
}

func (p *Picker) MarkFailure(ch Channel, reason string, cooldown time.Duration) {
	if p.stats != nil {
		p.stats.RecordFailure(ch.ID, reason, cooldown)
	}
}

// StatsStore 进程内 Channel 健康统计。
type StatsStore struct {
	mu    sync.RWMutex
	stats map[string]*Stat
}

func NewStatsStore() *StatsStore {
	return &StatsStore{stats: map[string]*Stat{}}
}

func (s *StatsStore) InCooldown(channelID string, now time.Time) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.stats[channelID]
	if !ok {
		return false
	}
	return st.InCooldown(now)
}

func (s *StatsStore) RecordSuccess(channelID string, latencyMS int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.ensure(channelID)
	st.SuccessCount++
	st.LastSuccess = time.Now().UTC()
	st.LastError = ""
	if latencyMS > 0 {
		if len(st.Latencies) >= LatencyRingSize {
			st.Latencies = st.Latencies[1:]
		}
		st.Latencies = append(st.Latencies, latencyMS)
	}
}

func (s *StatsStore) RecordFailure(channelID string, reason string, cooldown time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.ensure(channelID)
	st.FailureCount++
	st.LastError = strings.TrimSpace(reason)
	if cooldown > 0 {
		st.CooldownUntil = time.Now().UTC().Add(cooldown)
	}
}

func (s *StatsStore) Snapshot() map[string]Stat {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]Stat, len(s.stats))
	for id, st := range s.stats {
		if st == nil {
			continue
		}
		out[id] = *st
	}
	return out
}

func (s *StatsStore) ensure(channelID string) *Stat {
	st, ok := s.stats[channelID]
	if !ok {
		st = &Stat{}
		s.stats[channelID] = st
	}
	return st
}

// AffinityStore session→channel 亲和。
type AffinityStore struct {
	mu   sync.RWMutex
	data map[string]string // key = sessionID+"::"+model
	ttl  time.Duration
}

func NewAffinityStore(ttl time.Duration) *AffinityStore {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return &AffinityStore{data: map[string]string{}, ttl: ttl}
}

func affinityKey(sessionID, model string) string {
	return strings.TrimSpace(sessionID) + "::" + strings.TrimSpace(model)
}

func (a *AffinityStore) Get(sessionID, model string) (string, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	v, ok := a.data[affinityKey(sessionID, model)]
	return v, ok && v != ""
}

func (a *AffinityStore) Set(sessionID, model, channelID string) {
	if strings.TrimSpace(sessionID) == "" || strings.TrimSpace(channelID) == "" {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.data[affinityKey(sessionID, model)] = channelID
}
