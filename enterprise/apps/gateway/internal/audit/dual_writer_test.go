package audit

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

type failingPgInserter struct{}

func (failingPgInserter) Insert(context.Context, Event) error {
	return errors.New("injected pg failure")
}

func TestDualWriter_FileSucceedsWhenPGFailsAndPendingLogged(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	fileW := NewFileWriter(dir)
	dw := NewDualWriter(fileW, failingPgInserter{}, dir, nil)
	ev := &Event{
		ID:         "01HZTEST000000000000000001",
		TenantID:   "01J00000000000000000000001",
		EventTime:  time.Now().UTC().Format(time.RFC3339),
		EventType:  "chat_call",
		ClientType: "web-portal",
		Route:      "local",
	}
	if err := dw.Write(ev); err != nil {
		t.Fatalf("write: %v", err)
	}
	dw.Wait()
	pending := filepath.Join(dir, pendingFileName)
	b, err := os.ReadFile(pending)
	if err != nil {
		t.Fatalf("expected pending file: %v", err)
	}
	if len(b) == 0 {
		t.Fatal("pending file empty")
	}
}

func TestDualWriter_FileOnlyNilPG(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	fileW := NewFileWriter(dir)
	dw := NewDualWriter(fileW, nil, dir, nil)
	ev := &Event{
		ID:         "01HZTEST000000000000000002",
		TenantID:   "01J00000000000000000000001",
		EventTime:  time.Now().UTC().Format(time.RFC3339),
		EventType:  "chat_call",
		ClientType: "web-portal",
		Route:      "local",
	}
	if err := dw.Write(ev); err != nil {
		t.Fatalf("write: %v", err)
	}
}
