package main

import (
	"context"
	"testing"
	"time"
)

func waitUntil(t *testing.T, timeout time.Duration, pred func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if pred() {
			return true
		}
		time.Sleep(5 * time.Millisecond)
	}
	return pred()
}

func installFakeMonitorLoop(t *testing.T, started chan struct{}) {
	t.Helper()
	prev := runMonitorLoop
	runMonitorLoop = func(ctx context.Context, _ *Credentials) error {
		select {
		case started <- struct{}{}:
		default:
		}
		<-ctx.Done()
		return ctx.Err()
	}
	t.Cleanup(func() {
		runMonitorLoop = prev
		stopMonitor()
	})
}

func TestReconnectKeepsMonitorRunning(t *testing.T) {
	started := make(chan struct{}, 8)
	installFakeMonitorLoop(t, started)

	creds := &Credentials{BotID: "test-bot", BotToken: "token"}
	go startMonitor(creds)
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("first monitor did not start")
	}
	if !waitUntil(t, time.Second, isMonitorRunning) {
		t.Fatal("expected first monitor to report running")
	}

	// Same sequence as handleReconnect: cancel, then start a new generation.
	stopMonitor()
	go startMonitor(creds)
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("reconnected monitor did not start")
	}
	if !waitUntil(t, time.Second, isMonitorRunning) {
		t.Fatal("after reconnect, /status connected must stay true; old monitor cleanup must not clear the new generation")
	}

	stopMonitor()
	if !waitUntil(t, time.Second, func() bool { return !isMonitorRunning() }) {
		t.Fatal("expected monitor to stop after explicit stopMonitor")
	}
}

func TestStaleGenerationCleanupDoesNotClearNewerMonitor(t *testing.T) {
	started := make(chan struct{}, 8)
	installFakeMonitorLoop(t, started)

	creds := &Credentials{BotID: "test-bot", BotToken: "token"}
	go startMonitor(creds)
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("monitor did not start")
	}
	if !waitUntil(t, time.Second, isMonitorRunning) {
		t.Fatal("expected monitor to report running")
	}

	monitorMu.Lock()
	current := monitorEpoch
	monitorMu.Unlock()
	if current == 0 {
		t.Fatal("expected a claimed monitor generation")
	}

	// Late cleanup from the previous generation must be a no-op.
	finishMonitorGeneration(current-1, nil)
	if !isMonitorRunning() {
		t.Fatal("stale generation cleanup must not set connected=false for the current monitor")
	}
}
