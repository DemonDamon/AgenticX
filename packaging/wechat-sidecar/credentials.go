package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const credentialsFile = "wechat_credentials.json"

type Credentials struct {
	BotID       string `json:"bot_id"`
	BotToken    string `json:"bot_token"`
	BaseURL     string `json:"base_url"`
	ILinkUserID string `json:"ilink_user_id"`
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
	return &creds, nil
}

func saveCredentials(dataDir string, creds *Credentials) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
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
