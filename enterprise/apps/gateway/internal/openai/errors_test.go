package openai

import (
	"net/http"
	"testing"
)

func TestUnavailableStatus(t *testing.T) {
	err := Unavailable("managed model authorization unavailable")
	if err.HTTPStatus != http.StatusServiceUnavailable {
		t.Fatalf("status=%d", err.HTTPStatus)
	}
	if err.Code != "50302" {
		t.Fatalf("code=%s", err.Code)
	}
}
