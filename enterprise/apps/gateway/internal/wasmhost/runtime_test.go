package wasmhost

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReloadStable(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "wasm-keyword-rewrite")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := `name: wasm-keyword-rewrite
runtime: wasm
enabled: true
wasm:
  binary: builtin:keyword-rewrite
`
	if err := os.WriteFile(filepath.Join(dir, "manifest.yaml"), []byte(manifest), 0o644); err != nil {
		t.Fatal(err)
	}
	m := NewManager(root, noopMetrics{})
	for i := 0; i < 5; i++ {
		if err := m.Reload(); err != nil {
			t.Fatalf("reload %d: %v", i, err)
		}
	}
}

func TestLoadManifestDefaultsRuntime(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "manifest.yaml")
	if err := os.WriteFile(path, []byte("name: demo\nenabled: true\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	m, err := LoadManifest(path)
	if err != nil {
		t.Fatal(err)
	}
	if m.Runtime != "wasm" {
		t.Fatalf("runtime=%q", m.Runtime)
	}
}
