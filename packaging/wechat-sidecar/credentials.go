package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const credentialsFile = "wechat_credentials.json"

type Credentials struct {
	BotID         string `json:"bot_id"`
	BotToken      string `json:"bot_token"`
	BaseURL       string `json:"base_url"`
	ILinkUserID   string `json:"ilink_user_id"`
	SavedAt       string `json:"saved_at"`
	LastSuccessAt string `json:"last_success_at,omitempty"`
}

func loadCredentials(dataDir string) (*Credentials, error) {
	p := filepath.Join(dataDir, credentialsFile)
	data, err := os.ReadFile(p)
	if err != nil {
		return nil, fmt.Errorf("read credentials: %w", err)
	}
	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil, fmt.Errorf("parse credentials: %w", err)
	}
	if creds.BotToken == "" {
		return nil, fmt.Errorf("credentials file missing bot_token")
	}
	// Backward compat: if no saved_at, fall back to file mtime (or leave empty for caller to treat conservatively).
	if creds.SavedAt == "" {
		if fi, statErr := os.Stat(p); statErr == nil {
			creds.SavedAt = fi.ModTime().UTC().Format(time.RFC3339)
		}
	}
	return &creds, nil
}

func saveCredentials(dataDir string, creds *Credentials) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}
	// Set saved_at on first save or if missing (ISO8601 UTC); preserve existing for reloads but ensure present on write.
	if creds.SavedAt == "" {
		creds.SavedAt = time.Now().UTC().Format(time.RFC3339)
	}
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal credentials: %w", err)
	}
	p := filepath.Join(dataDir, credentialsFile)
	if err := os.WriteFile(p, data, 0600); err != nil {
		return fmt.Errorf("write credentials: %w", err)
	}
	return nil
}

func deleteCredentials(dataDir string) error {
	p := filepath.Join(dataDir, credentialsFile)
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("delete credentials: %w", err)
	}
	return nil
}
