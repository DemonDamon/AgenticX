package audit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const pendingFileName = ".pg-pending"

type pendingEntry struct {
	ID        string `json:"id"`
	Timestamp string `json:"ts"`
	Error     string `json:"error,omitempty"`
}

var pendingMu sync.Mutex

func appendPgPending(dir, id, errMsg string) error {
	if id == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	pendingMu.Lock()
	defer pendingMu.Unlock()
	f, err := os.OpenFile(filepath.Join(dir, pendingFileName), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	line, err := json.Marshal(pendingEntry{
		ID:        id,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Error:     errMsg,
	})
	if err != nil {
		return err
	}
	_, err = f.Write(append(line, '\n'))
	return err
}

func clearPgPending(dir string) error {
	path := filepath.Join(dir, pendingFileName)
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
