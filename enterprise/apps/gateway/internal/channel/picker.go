package channel

import (
	"math/rand"
	"strings"
	"sync"
	"time"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// Identity 供 affinity 使用的会话主体。
type Identity struct {
	TenantID  string
	UserID    string
	SessionID string
}

// Picker 加权选择 + session 亲和 + 可选 latency/prefix 策略。
type Picker struct {
	registry   *Registry
	stats      *StatsStore
	affinity   *AffinityStore
	rng        *rand.Rand
	mu         sync.Mutex
	policy     LBPolicy
	prefixMsgs int
}

func NewPicker(registry *Registry, stats *StatsStore, affinity *AffinityStore) *Picker {
	return &Picker{
		registry:   registry,
		stats:      stats,
		affinity:   affinity,
		rng:        rand.New(rand.NewSource(time.Now().UnixNano())),
		policy:     LBPolicyFromEnv(),
		prefixMsgs: PrefixMsgsFromEnv(),
	}
}

// Pick 返回候选 Channel；exclude 用于重试时跳过已失败通道。
func (p *Picker) Pick(model string, id Identity, exclude map[string]struct{}) (Channel, bool) {
	ch, _, ok := p.PickWithPrefix(model, id, exclude, nil)
	return ch, ok
}

// PickWithPrefix 支持 prefix-cache 策略；messages 为 nil 时 prefix 分支不生效。
func (p *Picker) PickWithPrefix(
	model string,
	id Identity,
	exclude map[string]struct{},
	messages []openai.ChatMessage,
) (Channel, PickDecision, bool) {
	if p == nil || p.registry == nil {
		return Channel{}, PickDecision{}, false
	}
	policy := p.policy
	if policy == "" {
		policy = LBWeight
	}
	cands := p.registry.ListByModel(id.TenantID, model)
	if len(cands) == 0 {
		return Channel{}, PickDecision{}, false
	}
	healthy := p.filterHealthy(cands, exclude)
	if len(healthy) == 0 {
		return Channel{}, PickDecision{}, false
	}

	if policy == LBPrefixCache && len(messages) > 0 {
		if ch, ok := p.pickByPrefix(healthy, messages); ok {
			return ch, PickDecision{ChannelID: ch.ID, Policy: LBPrefixCache, Reason: "prefix"}, true
		}
	}

	if p.affinity != nil {
		if lastID, ok := p.affinity.Get(id.SessionID, model); ok {
			for _, ch := range healthy {
				if ch.ID == lastID {
					return ch, PickDecision{ChannelID: ch.ID, Policy: policy, Reason: "affinity"}, true
				}
			}
		}
	}

	if policy == LBLatencyAware {
		ch := p.latencyAwareSample(healthy)
		if ch.ID == "" {
			return Channel{}, PickDecision{}, false
		}
		return ch, PickDecision{ChannelID: ch.ID, Policy: LBLatencyAware, Reason: "latency"}, true
	}

	ch := p.weightedSample(healthy)
	if ch.ID == "" {
		return Channel{}, PickDecision{}, false
	}
	return ch, PickDecision{ChannelID: ch.ID, Policy: LBWeight, Reason: "weight"}, true
}

func (p *Picker) filterHealthy(cands []Channel, exclude map[string]struct{}) []Channel {
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
		healthy = cands
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
	return healthy
}

func (p *Picker) pickByPrefix(healthy []Channel, messages []openai.ChatMessage) (Channel, bool) {
	sorted := stableSortedChannels(healthy)
	if len(sorted) == 0 {
		return Channel{}, false
	}
	idx := PrefixHashIndex(messages, p.prefixMsgs, len(sorted))
	if idx < 0 || idx >= len(sorted) {
		return Channel{}, false
	}
	return sorted[idx], true
}

func (p *Picker) latencyAwareSample(cands []Channel) Channel {
	if len(cands) == 0 {
		return Channel{}
	}
	if len(cands) == 1 {
		return cands[0]
	}
	weights := make([]int, len(cands))
	allMissing := true
	for i, ch := range cands {
		w := ch.Weight
		if w <= 0 {
			w = 1
		}
		if p.stats != nil && p.stats.HasLatencySamples(ch.ID) {
			allMissing = false
			w = InverseLatencyWeight(p.stats.P50Latency(ch.ID), ch.Weight)
		}
		weights[i] = w
	}
	if allMissing {
		return p.weightedSample(cands)
	}
	return p.weightedSampleWithWeights(cands, weights)
}

func (p *Picker) weightedSample(cands []Channel) Channel {
	if len(cands) == 0 {
		return Channel{}
	}
	weights := make([]int, len(cands))
	for i, ch := range cands {
		w := ch.Weight
		if w <= 0 {
			w = 1
		}
		weights[i] = w
	}
	return p.weightedSampleWithWeights(cands, weights)
}

func (p *Picker) weightedSampleWithWeights(cands []Channel, weights []int) Channel {
	if len(cands) == 0 {
		return Channel{}
	}
	if len(cands) == 1 {
		return cands[0]
	}
	total := 0
	for _, w := range weights {
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
	for i, ch := range cands {
		w := weights[i]
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

func (s *StatsStore) HasLatencySamples(channelID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.stats[channelID]
	return ok && st != nil && len(st.Latencies) > 0
}

func (s *StatsStore) P50Latency(channelID string) int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.stats[channelID]
	if !ok || st == nil {
		return 0
	}
	return st.P50LatencyMS()
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
