// Mint RS256 access JWT for gateway perf k6 scripts (matches gateway verify settings).
package main

import (
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type accessClaims struct {
	UserID        string   `json:"userId"`
	TenantID      string   `json:"tenantId"`
	Email         string   `json:"email"`
	DepartmentID  string   `json:"deptId"`
	DepartmentPath []string `json:"deptPath"`
	SessionID     string   `json:"sessionId"`
	RoleCodes     []string `json:"roleCodes"`
	ClientType    string   `json:"clientType"`
	DataResidency string   `json:"dataResidency"`
	Scopes        []string `json:"scopes"`
	Type          string   `json:"typ"`
	jwt.RegisteredClaims
}

func main() {
	keyPath := strings.TrimSpace(os.Getenv("AUTH_JWT_PRIVATE_KEY_FILE"))
	if keyPath == "" {
		keyPath = ".local-secrets/auth_private.pem"
	}
	keyPEM, err := os.ReadFile(keyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read private key: %v\n", err)
		os.Exit(1)
	}
	privateKey, err := parseRSAPrivateKey(keyPEM)
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse private key: %v\n", err)
		os.Exit(1)
	}

	tenantID := envOr("DEFAULT_TENANT_ID", "01J00000000000000000000001")
	userID := envOr("PERF_JWT_USER_ID", "perf-user")
	now := time.Now().UTC()
	claims := accessClaims{
		UserID:        userID,
		TenantID:      tenantID,
		Email:         "perf@agenticx.local",
		DepartmentID:  envOr("DEFAULT_DEPT_ID", "dept_default"),
		DepartmentPath: []string{},
		SessionID:     "perf-session",
		RoleCodes:     []string{"staff"},
		ClientType:    "perf-k6",
		DataResidency: "cn",
		Scopes:        []string{"workspace:chat", "metering:read"},
		Type:          "access",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "agenticx-enterprise-web-portal",
			Audience:  []string{"agenticx-web-users"},
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(privateKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sign jwt: %v\n", err)
		os.Exit(1)
	}
	fmt.Print(signed)
}

func parseRSAPrivateKey(pemBytes []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("invalid pem")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, err
		}
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, fmt.Errorf("not rsa private key")
	}
	return rsaKey, nil
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
