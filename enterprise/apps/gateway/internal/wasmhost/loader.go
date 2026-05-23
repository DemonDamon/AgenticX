package wasmhost

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Manifest describes a gateway plugin package.
type Manifest struct {
	Name        string         `yaml:"name"`
	Version     string         `yaml:"version"`
	Type        string         `yaml:"type"`
	Runtime     string         `yaml:"runtime"`
	Enabled     bool           `yaml:"enabled"`
	Priority    int            `yaml:"priority"`
	Config      map[string]any `yaml:"config"`
	Scope       Scope          `yaml:"scope"`
	Wasm        WasmSpec       `yaml:"wasm"`
	Native      NativeSpec     `yaml:"native"`
	manifestDir string
}

type Scope struct {
	TenantIDs []string `yaml:"tenant_ids"`
	Routes    []string `yaml:"routes"`
}

type WasmSpec struct {
	Binary           string   `yaml:"binary"`
	ConfigSchema     string   `yaml:"config_schema"`
	HostCapabilities []string `yaml:"host_capabilities"`
}

type NativeSpec struct {
	Plugin string `yaml:"plugin"`
}

func DefaultPluginsRoot() string {
	if v := strings.TrimSpace(os.Getenv("GATEWAY_PLUGINS_DIR")); v != "" {
		return v
	}
	cwd, _ := os.Getwd()
	return filepath.Clean(filepath.Join(cwd, "../../plugins"))
}

func LoadManifest(path string) (Manifest, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, err
	}
	var m Manifest
	if err := yaml.Unmarshal(raw, &m); err != nil {
		return Manifest{}, err
	}
	m.manifestDir = filepath.Dir(path)
	if strings.TrimSpace(m.Name) == "" {
		m.Name = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	if m.Runtime == "" {
		if m.Type == "rule-pack" {
			m.Runtime = "declarative"
		} else {
			m.Runtime = "wasm"
		}
	}
	return m, nil
}

func (m Manifest) Dir() string { return m.manifestDir }

func (m Manifest) MatchesRoute(route string) bool {
	if len(m.Scope.Routes) == 0 {
		return true
	}
	route = strings.TrimSpace(route)
	for _, pattern := range m.Scope.Routes {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" || pattern == "*" {
			return true
		}
		if strings.HasSuffix(pattern, "*") {
			prefix := strings.TrimSuffix(pattern, "*")
			if strings.HasPrefix(route, prefix) {
				return true
			}
		}
		if route == pattern {
			return true
		}
	}
	return false
}

func (m Manifest) MatchesTenant(tenantID string) bool {
	if len(m.Scope.TenantIDs) == 0 {
		return true
	}
	for _, t := range m.Scope.TenantIDs {
		if t == "*" || t == tenantID {
			return true
		}
	}
	return false
}

func (m Manifest) WasmBinaryPath() string {
	bin := strings.TrimSpace(m.Wasm.Binary)
	if bin == "" {
		return ""
	}
	if strings.HasPrefix(bin, "builtin:") {
		return bin
	}
	if filepath.IsAbs(bin) {
		return bin
	}
	return filepath.Join(m.manifestDir, bin)
}

func discoverManifests(root string) ([]string, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var paths []string
	for _, ent := range entries {
		if !ent.IsDir() {
			continue
		}
		p := filepath.Join(root, ent.Name(), "manifest.yaml")
		if _, err := os.Stat(p); err == nil {
			paths = append(paths, p)
		}
	}
	return paths, nil
}

func buildPlugin(m Manifest) (Plugin, error) {
	switch strings.ToLower(strings.TrimSpace(m.Runtime)) {
	case "declarative", "rule-pack", "":
		return nil, fmt.Errorf("skip declarative plugin %q", m.Name)
	case "native":
		return newBuiltinPlugin(m.Native.Plugin, m)
	case "wasm":
		path := m.WasmBinaryPath()
		if strings.HasPrefix(path, "builtin:") {
			return newBuiltinPlugin(strings.TrimPrefix(path, "builtin:"), m)
		}
		return NewWazeroPlugin(m)
	default:
		return nil, fmt.Errorf("unsupported runtime %q", m.Runtime)
	}
}
