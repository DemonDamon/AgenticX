package keypool

import (
	"os"
	"strings"
	"sync"
)

// Pool 解析 Channel 级上游 Key；keypool plan 未落地前以 channel 直配 key / env refs 为主。
type Pool struct {
	mu       sync.Mutex
	cursors  map[string]int
	cooldown map[string]map[string]struct{} // poolID -> blocked key ref
}

func NewPool() *Pool {
	return &Pool{
		cursors:  map[string]int{},
		cooldown: map[string]map[string]struct{}{},
	}
}

// Resolve 返回可用 API Key；directKey 优先，其次 keyRefs 轮询。
func (p *Pool) Resolve(poolID, directKey string, keyRefs []string) string {
	if k := strings.TrimSpace(directKey); k != "" {
		return k
	}
	refs := normalizeRefs(keyRefs)
	if len(refs) == 0 {
		return ""
	}
	pid := strings.TrimSpace(poolID)
	if pid == "" {
		pid = "default"
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	blocked := p.cooldown[pid]
	start := p.cursors[pid]
	for i := 0; i < len(refs); i++ {
		idx := (start + i) % len(refs)
		ref := refs[idx]
		if blocked != nil {
			if _, skip := blocked[ref]; skip {
				continue
			}
		}
		if v := strings.TrimSpace(os.Getenv(ref)); v != "" {
			p.cursors[pid] = (idx + 1) % len(refs)
			return v
		}
	}
	return ""
}

func (p *Pool) MarkUnhealthy(poolID, keyRef string) {
	ref := strings.TrimSpace(keyRef)
	if ref == "" {
		return
	}
	pid := strings.TrimSpace(poolID)
	if pid == "" {
		pid = "default"
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cooldown[pid] == nil {
		p.cooldown[pid] = map[string]struct{}{}
	}
	p.cooldown[pid][ref] = struct{}{}
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
