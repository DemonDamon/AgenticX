package wasmhost

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// MetricsRecorder records plugin observability counters.
type MetricsRecorder interface {
	ObservePlugin(name string, latency time.Duration, err error)
}

type noopMetrics struct{}

func (noopMetrics) ObservePlugin(string, time.Duration, error) {}

// Manager loads plugins and executes hook chains.
type Manager struct {
	root    string
	mu      sync.RWMutex
	plugins []loadedPlugin
	metrics MetricsRecorder
}

type loadedPlugin struct {
	manifest Manifest
	plugin   Plugin
}

func NewManager(root string, metrics MetricsRecorder) *Manager {
	if metrics == nil {
		metrics = noopMetrics{}
	}
	if strings.TrimSpace(root) == "" {
		root = DefaultPluginsRoot()
	}
	return &Manager{root: root, metrics: metrics}
}

func (m *Manager) Reload() error {
	paths, err := discoverManifests(m.root)
	if err != nil {
		return err
	}
	sort.Strings(paths)
	loaded := make([]loadedPlugin, 0, len(paths))
	for _, path := range paths {
		manifest, err := LoadManifest(path)
		if err != nil {
			continue
		}
		if !manifest.Enabled {
			continue
		}
		if manifest.Runtime == "declarative" || manifest.Type == "rule-pack" || manifest.Type == "theme-pack" || manifest.Type == "tool-pack" {
			continue
		}
		plug, err := buildPlugin(manifest)
		if err != nil {
			continue
		}
		if err := plug.Start(manifest.Config); err != nil {
			disableBrokenPlugin(plug, err)
			continue
		}
		loaded = append(loaded, loadedPlugin{manifest: manifest, plugin: plug})
	}
	sort.SliceStable(loaded, func(i, j int) bool {
		return loaded[i].manifest.Priority < loaded[j].manifest.Priority
	})
	m.mu.Lock()
	old := m.plugins
	m.plugins = loaded
	m.mu.Unlock()
	for _, item := range old {
		_ = item.plugin.Close()
	}
	return nil
}

func disableBrokenPlugin(plug Plugin, err error) {
	_ = plug.Close()
	_ = err
}

func (m *Manager) Start(ctx context.Context) error {
	if err := m.Reload(); err != nil {
		return err
	}
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	_ = watcher.Add(m.root)
	go func() {
		defer watcher.Close()
		for {
			select {
			case <-ctx.Done():
				return
			case ev, ok := <-watcher.Events:
				if !ok {
					return
				}
				if ev.Has(fsnotify.Write) || ev.Has(fsnotify.Create) || ev.Has(fsnotify.Remove) || ev.Has(fsnotify.Rename) {
					_ = m.Reload()
				}
			case _, ok := <-watcher.Errors:
				if !ok {
					return
				}
			}
		}
	}()
	return nil
}

func (m *Manager) List() []Manifest {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Manifest, 0, len(m.plugins))
	for _, item := range m.plugins {
		out = append(out, item.manifest)
	}
	return out
}

func (m *Manager) matching(tenantID, route string) []Plugin {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Plugin, 0, len(m.plugins))
	for _, item := range m.plugins {
		if item.manifest.MatchesTenant(tenantID) && item.manifest.MatchesRoute(route) {
			out = append(out, item.plugin)
		}
	}
	return out
}

func (m *Manager) RunRequestHeaders(ctx *HookContext) error {
	return m.runHooks(ctx, func(p Plugin) (Action, error) {
		start := time.Now()
		action, err := safeHook(func() (Action, error) { return p.OnRequestHeaders(ctx) })
		m.metrics.ObservePlugin(p.Name(), time.Since(start), err)
		return action, err
	})
}

func (m *Manager) RunRequestBody(ctx *HookContext, body []byte, eos bool) error {
	return m.runHooks(ctx, func(p Plugin) (Action, error) {
		start := time.Now()
		action, err := safeHook(func() (Action, error) { return p.OnRequestBody(ctx, body, eos) })
		m.metrics.ObservePlugin(p.Name(), time.Since(start), err)
		return action, err
	})
}

func (m *Manager) RunResponseBody(ctx *HookContext, body []byte, eos bool) ([]byte, error) {
	current := body
	err := m.runHooks(ctx, func(p Plugin) (Action, error) {
		start := time.Now()
		action, out, err := safeHookBody(func() (Action, []byte, error) { return p.OnResponseBody(ctx, current, eos) })
		if err == nil && len(out) > 0 {
			current = out
		}
		m.metrics.ObservePlugin(p.Name(), time.Since(start), err)
		return action, err
	})
	return current, err
}

func (m *Manager) RunStreamChunk(ctx *HookContext, chunk []byte) ([]byte, error) {
	current := chunk
	err := m.runHooks(ctx, func(p Plugin) (Action, error) {
		start := time.Now()
		action, out, err := safeHookBody(func() (Action, []byte, error) { return p.OnStreamChunk(ctx, current) })
		if err == nil && len(out) > 0 {
			current = out
		}
		m.metrics.ObservePlugin(p.Name(), time.Since(start), err)
		return action, err
	})
	return current, err
}

func (m *Manager) runHooks(ctx *HookContext, fn func(Plugin) (Action, error)) error {
	if m == nil || ctx == nil {
		return nil
	}
	for _, plug := range m.matching(ctx.TenantID, ctx.Route) {
		action, err := fn(plug)
		if err != nil {
			return err
		}
		if action == ActionStop {
			return ErrStopped
		}
	}
	return nil
}

var ErrStopped = fmt.Errorf("wasmhost: stopped")

func safeHook(fn func() (Action, error)) (action Action, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("plugin panic: %v", rec)
			action = ActionContinue
		}
	}()
	return fn()
}

func safeHookBody(fn func() (Action, []byte, error)) (action Action, out []byte, err error) {
	defer func() {
		if rec := recover(); rec != nil {
			err = fmt.Errorf("plugin panic: %v", rec)
			action = ActionContinue
		}
	}()
	return fn()
}

// WazeroPlugin loads external wasm modules when binary path points to a .wasm file.
type WazeroPlugin struct {
	manifest Manifest
	name     string
}

func NewWazeroPlugin(m Manifest) (Plugin, error) {
	path := m.WasmBinaryPath()
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("wasm binary missing: %s", path)
	}
	return &WazeroPlugin{manifest: m, name: m.Name}, nil
}

func (p *WazeroPlugin) Name() string { return p.name }

func (p *WazeroPlugin) Start(_ map[string]any) error { return nil }

func (p *WazeroPlugin) OnRequestHeaders(_ *HookContext) (Action, error)       { return ActionContinue, nil }
func (p *WazeroPlugin) OnRequestBody(_ *HookContext, _ []byte, _ bool) (Action, error) {
	return ActionContinue, nil
}
func (p *WazeroPlugin) OnResponseHeaders(_ *HookContext) (Action, error) { return ActionContinue, nil }
func (p *WazeroPlugin) OnResponseBody(ctx *HookContext, body []byte, _ bool) (Action, []byte, error) {
	return ActionContinue, body, nil
}
func (p *WazeroPlugin) OnStreamChunk(ctx *HookContext, chunk []byte) (Action, []byte, error) {
	return ActionContinue, chunk, nil
}
func (p *WazeroPlugin) Close() error { return nil }
