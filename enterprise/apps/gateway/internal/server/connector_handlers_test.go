package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/agenticx/enterprise/gateway/internal/connectorstore"
)

func TestHandleConnectorListUnauthorized(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "secret-token")
	s := &Server{connectorStore: connectorstore.New(nil, nil)}
	req := httptest.NewRequest(http.MethodGet, "/internal/connectors?tenant_id=t1", nil)
	rec := httptest.NewRecorder()
	s.handleConnectorList(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandleConnectorListRequiresTenant(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "secret-token")
	s := &Server{connectorStore: connectorstore.New(nil, nil)}
	req := httptest.NewRequest(http.MethodGet, "/internal/connectors", nil)
	req.Header.Set("Authorization", "Bearer secret-token")
	rec := httptest.NewRecorder()
	s.handleConnectorList(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandleConnectorImportDestructiveNeedsConfirm(t *testing.T) {
	t.Setenv("GATEWAY_INTERNAL_TOKEN", "secret-token")
	s := &Server{connectorStore: connectorstore.New(nil, nil)}
	spec := `{
		"openapi": "3.0.0",
		"info": {"title": "Tickets"},
		"servers": [{"url": "https://tickets.internal.example"}],
		"paths": {
			"/tickets/{id}": {
				"delete": {
					"operationId": "deleteTicket",
					"summary": "Delete ticket",
					"parameters": [{"name": "id", "in": "path", "required": true, "schema": {"type": "string"}}]
				}
			}
		}
	}`
	body := `{"tenant_id":"t1","connector_id":"tickets","spec":` + spec + `}`
	req := httptest.NewRequest(http.MethodPost, "/internal/connectors/import", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer secret-token")
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	s.handleConnectorImport(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var got struct {
		Code string `json:"code"`
		Data struct {
			Destructive []string `json:"destructive"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Code != "40901" || len(got.Data.Destructive) == 0 {
		t.Fatalf("expected 40901 + destructive list, got %+v body=%s", got, rec.Body.String())
	}
}
