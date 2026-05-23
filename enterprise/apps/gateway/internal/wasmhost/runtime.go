package wasmhost

import (
	"context"
	"sync"

	"github.com/tetratelabs/wazero"
)

// Runtime wraps wazero runtime for optional external wasm modules.
type Runtime struct {
	mu      sync.Mutex
	runtime wazero.Runtime
}

var globalRuntime = &Runtime{}

func sharedRuntime() wazero.Runtime {
	globalRuntime.mu.Lock()
	defer globalRuntime.mu.Unlock()
	if globalRuntime.runtime == nil {
		globalRuntime.runtime = wazero.NewRuntime(context.Background())
	}
	return globalRuntime.runtime
}

func closeRuntime() {
	globalRuntime.mu.Lock()
	defer globalRuntime.mu.Unlock()
	if globalRuntime.runtime != nil {
		_ = globalRuntime.runtime.Close(context.Background())
		globalRuntime.runtime = nil
	}
}
