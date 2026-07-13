package server

import (
	"testing"
	"time"
)

func TestShouldFetchRemotePolicy_ThrottlesWithinInterval(t *testing.T) {
	t.Setenv("GATEWAY_POLICY_REMOTE_RELOAD_INTERVAL", "5s")
	s := &Server{}
	now := time.Now()
	if !s.shouldFetchRemotePolicy(now) {
		t.Fatal("expected first fetch when never checked")
	}
	s.markRemotePolicyChecked(now)
	if s.shouldFetchRemotePolicy(now.Add(2 * time.Second)) {
		t.Fatal("expected throttle within interval")
	}
	if !s.shouldFetchRemotePolicy(now.Add(5 * time.Second)) {
		t.Fatal("expected fetch after interval")
	}
}

func TestShouldFetchRemotePolicy_ZeroMeansAlways(t *testing.T) {
	t.Setenv("GATEWAY_POLICY_REMOTE_RELOAD_INTERVAL", "0")
	s := &Server{}
	now := time.Now()
	s.markRemotePolicyChecked(now)
	if !s.shouldFetchRemotePolicy(now.Add(time.Millisecond)) {
		t.Fatal("interval 0 must always fetch")
	}
}
