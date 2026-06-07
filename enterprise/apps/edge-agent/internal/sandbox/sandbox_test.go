package sandbox

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestWriteAndReadInsideWorkspace(t *testing.T) {
	sb, err := New(DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer sb.Close()

	if err := sb.WriteFile("notes.txt", "hello"); err != nil {
		t.Fatal(err)
	}
	got, err := sb.ReadFile("notes.txt")
	if err != nil {
		t.Fatal(err)
	}
	if got != "hello" {
		t.Fatalf("expected hello, got %q", got)
	}
}

func TestRejectPathEscape(t *testing.T) {
	sb, err := New(DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer sb.Close()

	cases := []string{"../outside.txt", "/etc/passwd", "../../tmp/evil.txt"}
	for _, rel := range cases {
		if err := sb.WriteFile(rel, "x"); !errors.Is(err, ErrPathEscape) {
			t.Fatalf("WriteFile(%q) expected ErrPathEscape, got %v", rel, err)
		}
	}
}

func TestCommandTimeout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("sleep command differs on windows")
	}
	sb, err := New(Config{CommandTimeout: 200 * time.Millisecond, MaxOutputBytes: 4096})
	if err != nil {
		t.Fatal(err)
	}
	defer sb.Close()

	_, _, err = sb.RunCommand(context.Background(), []string{"sleep", "5"})
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected deadline exceeded, got %v", err)
	}
}

func TestRunEchoCommand(t *testing.T) {
	sb, err := New(DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer sb.Close()

	stdout, _, err := sb.RunCommand(context.Background(), []string{"echo", "ok"})
	if err != nil {
		t.Fatal(err)
	}
	if stdout != "ok\n" && stdout != "ok\r\n" {
		t.Fatalf("unexpected stdout: %q", stdout)
	}
}

func TestSymlinkEscapeBlocked(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink test skipped on windows")
	}
	sb, err := New(DefaultConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer sb.Close()

	link := filepath.Join(sb.WorkDir(), "escape-link")
	if err := os.Symlink("/etc", link); err != nil {
		t.Fatal(err)
	}
	if err := sb.WriteFile("escape-link/passwd", "x"); !errors.Is(err, ErrPathEscape) {
		t.Fatalf("expected ErrPathEscape via symlink, got %v", err)
	}
}
