package audit

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestListAuditJSONLInWindow_findsRecentFiles(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	today := time.Now().UTC().Format("20060102")
	old := time.Now().UTC().AddDate(0, 0, -30).Format("20060102")
	if err := os.WriteFile(filepath.Join(dir, "audit-"+today+".jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "audit-"+old+".jsonl"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "other.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	files, err := listAuditJSONLInWindow(dir, 7)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(files) != 1 || !strings.HasSuffix(files[0], "audit-"+today+".jsonl") {
		t.Fatalf("unexpected files: %v", files)
	}
}

func TestBackfillDaysFromEnv_default(t *testing.T) {
	t.Setenv("GATEWAY_AUDIT_BACKFILL_DAYS", "")
	if d := BackfillDaysFromEnv(); d != 7 {
		t.Fatalf("default: %d", d)
	}
}

func TestBackfillDaysFromEnv_custom(t *testing.T) {
	t.Setenv("GATEWAY_AUDIT_BACKFILL_DAYS", "14")
	if d := BackfillDaysFromEnv(); d != 14 {
		t.Fatalf("custom: %d", d)
	}
}
