// Package policy 动作级（glob allow/block）与连接级（scope 子集）策略：
// 执行前拦截，而非事后审计。block 恒优先于 allow。
package policy

import (
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/agenticx/connector-runtime/internal/model"
)

// Decision 评估结论。Code 为空表示放行。
type Decision struct {
	Allowed bool
	Code    string // action_blocked | scope_denied
	Reason  string
}

// Policy 动作级策略。模式为 glob（* 不跨 /；动作 id 无 /，故 * 即全通配）。
// 并发安全：管理面更新与执行面读取可并发。
type Policy struct {
	mu     sync.RWMutex
	Allow  []string `json:"allow,omitempty"`
	Block  []string `json:"block,omitempty"`
	Default string  `json:"default,omitempty"` // allow（默认）| deny
}

// DefaultAllow 空策略。
func DefaultAllow() *Policy { return &Policy{Default: "allow"} }

// Sanitize 归一化：默认值与空模式清理。
func (p *Policy) Sanitize() {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.defaultAndCompactLocked()
}

func (p *Policy) defaultAndCompactLocked() {
	if p.Default != "deny" {
		p.Default = "allow"
	}
	p.Allow = compact(p.Allow)
	p.Block = compact(p.Block)
}

// Evaluate 评估动作是否放行。
func (p *Policy) Evaluate(actionID string) Decision {
	p.mu.RLock()
	defer p.mu.RUnlock()
	for _, pat := range p.Block {
		if match(pat, actionID) {
			return Decision{Allowed: false, Code: "action_blocked",
				Reason: fmt.Sprintf("动作 %s 命中阻止规则 %s", actionID, pat)}
		}
	}
	for _, pat := range p.Allow {
		if match(pat, actionID) {
			return Decision{Allowed: true}
		}
	}
	if p.Default == "deny" {
		return Decision{Allowed: false, Code: "action_blocked",
			Reason: fmt.Sprintf("动作 %s 未命中放行规则且默认拒绝", actionID)}
	}
	return Decision{Allowed: true}
}

// UpdateFrom 以新策略内容原子替换（管理面调用；np 内容会被拷贝）。
func (p *Policy) UpdateFrom(np *Policy) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Allow = append([]string(nil), np.Allow...)
	p.Block = append([]string(nil), np.Block...)
	p.Default = np.Default
	p.defaultAndCompactLocked()
}

// View 策略内容快照（JSON 形态与 Policy 一致，无锁）。
type View struct {
	Allow   []string `json:"allow,omitempty"`
	Block   []string `json:"block,omitempty"`
	Default string   `json:"default,omitempty"`
}

// Snapshot 返回内容副本（供管理面读取）。
func (p *Policy) Snapshot() View {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return View{
		Allow:   append([]string(nil), p.Allow...),
		Block:   append([]string(nil), p.Block...),
		Default: p.Default,
	}
}

// EvaluateConnection 连接级授权：动作 requiredScopes 须为连接 grantedScopes 子集。
// 连接为空（no-auth 匿名执行）时仅要求动作无 requiredScopes。
func EvaluateConnection(act model.Action, grantedScopes []string) Decision {
	if len(act.RequiredScopes) == 0 {
		return Decision{Allowed: true}
	}
	have := map[string]bool{}
	for _, s := range grantedScopes {
		have[s] = true
	}
	for _, need := range act.RequiredScopes {
		if !have[need] {
			return Decision{Allowed: false, Code: "scope_denied",
				Reason: fmt.Sprintf("动作 %s 需要 scope %q，连接未授予", act.ID, need)}
		}
	}
	return Decision{Allowed: true}
}

// Load 从文件加载；不存在返回默认放行策略。
func Load(path string) (*Policy, error) {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return DefaultAllow(), nil
	}
	if err != nil {
		return nil, err
	}
	var p Policy
	if err := json.Unmarshal(b, &p); err != nil {
		return nil, fmt.Errorf("策略文件损坏: %w", err)
	}
	p.Sanitize()
	return &p, nil
}

// Save 持久化策略。
func (p *Policy) Save(dir string) error {
	p.mu.RLock()
	b, err := json.MarshalIndent(p, "", "  ")
	p.mu.RUnlock()
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "policy.json"), b, 0o600)
}

func match(pattern, actionID string) bool {
	ok, err := path.Match(pattern, actionID)
	return err == nil && ok
}

func compact(in []string) []string {
	out := in[:0]
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
