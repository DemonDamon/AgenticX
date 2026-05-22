package cache

import (
	"strings"
	"sync"

	"github.com/agenticx/enterprise/gateway/internal/openai"
)

// Service coordinates L1/L2 cache lookup and write-back.
type Service struct {
	cfg   Config
	store Store
	l2    *L2Index
	mu    sync.RWMutex
}

func NewService(cfg Config, store Store) *Service {
	if store == nil {
		store = NewMemoryStore(4096)
	}
	return &Service{cfg: cfg, store: store, l2: NewL2Index(cfg.SemanticThreshold)}
}

func (s *Service) Config() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

func (s *Service) UpdateConfig(cfg Config) {
	s.mu.Lock()
	s.cfg = cfg
	s.l2.SetThreshold(cfg.SemanticThreshold)
	s.mu.Unlock()
}

func (s *Service) Lookup(tenantID, userID string, req openai.ChatCompletionRequest) (LookupResult, bool) {
	cfg := s.Config()
	if !cfg.L1Enabled && !cfg.L2Enabled {
		return LookupResult{Layer: LayerNone}, false
	}
	if !cfg.ModelAllowed(req.Model) {
		return LookupResult{Layer: LayerNone}, false
	}
	keyHash, bypass, _ := CanonicalKey(tenantID, userID, req.Model, req)
	if bypass {
		return LookupResult{Layer: LayerNone}, false
	}
	if cfg.L1Enabled {
		if entry, ok := s.store.Get(keyHash); ok {
			return LookupResult{Layer: LayerL1, KeyHash: keyHash, Entry: entry}, true
		}
	}
	if cfg.L2Enabled {
		if hit, ok := s.l2.Lookup(tenantID, userID, req.Model, promptText(req)); ok {
			return LookupResult{
				Layer:              LayerL2,
				KeyHash:            keyHash,
				SemanticSimilarity: hit.Similarity,
				Entry:              hit.Entry,
			}, true
		}
	}
	return LookupResult{Layer: LayerNone, KeyHash: keyHash}, false
}

func (s *Service) Write(tenantID, userID string, req openai.ChatCompletionRequest, entry Entry) {
	cfg := s.Config()
	if !cfg.L1Enabled && !cfg.L2Enabled {
		return
	}
	if !cfg.ModelAllowed(req.Model) {
		return
	}
	keyHash, bypass, _ := CanonicalKey(tenantID, userID, req.Model, req)
	if bypass {
		return
	}
	if cfg.L1Enabled {
		s.store.Set(keyHash, entry, cfg.L1TTL)
	}
	if cfg.L2Enabled {
		s.l2.Write(tenantID, userID, req.Model, promptText(req), entry, cfg.L2TTL)
	}
}

func (s *Service) EvictPrefix(prefix string) int {
	return s.store.DeletePrefix(prefix)
}

func (s *Service) GatewayCacheUsage(entry Entry, discount float64) openai.Usage {
	in := entry.Usage.PromptTokens
	if in == 0 {
		in = entry.Usage.TotalTokens
	}
	out := entry.Usage.CompletionTokens
	if discount <= 0 {
		discount = 0.1
	}
	// Virtual usage: bill discounted input, keep output as-is.
	cached := int(float64(in) * (1 - discount))
	if cached < 0 {
		cached = 0
	}
	return openai.Usage{
		PromptTokens:     in,
		CompletionTokens: out,
		TotalTokens:      in + out,
		CachedTokens:     cached,
		Source:           "gateway_cache",
	}
}

func promptText(req openai.ChatCompletionRequest) string {
	parts := make([]string, 0, len(req.Messages)+1)
	if strings.TrimSpace(req.System) != "" {
		parts = append(parts, req.System)
	}
	for _, msg := range req.Messages {
		parts = append(parts, openai.ComposeMessageContent(msg.Content, msg.ReasoningContent))
	}
	return strings.Join(parts, "\n")
}
