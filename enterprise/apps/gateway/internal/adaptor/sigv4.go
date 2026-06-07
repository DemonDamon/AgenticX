// Adapted from higress-group/higress ai-proxy (Apache-2.0) — SigV4 signing subset for Bedrock.
package adaptor

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	awsSigV4Algorithm = "AWS4-HMAC-SHA256"
	awsRequestType    = "aws4_request"
)

type sigV4Credentials struct {
	AccessKey string
	SecretKey string
	Region    string
	Service   string
}

func signRequest(req *http.Request, cred sigV4Credentials, payload []byte, now time.Time) error {
	if req == nil {
		return fmt.Errorf("sigv4: nil request")
	}
	if cred.AccessKey == "" || cred.SecretKey == "" {
		return fmt.Errorf("sigv4: missing credentials")
	}
	if cred.Service == "" {
		cred.Service = "bedrock"
	}
	if cred.Region == "" {
		return fmt.Errorf("sigv4: missing region")
	}

	amzDate := now.UTC().Format("20060102T150405Z")
	dateStamp := now.UTC().Format("20060102")

	host := req.URL.Host
	if host == "" {
		host = req.Host
	}
	req.Header.Set("Host", host)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", hashHex(payload))

	signedHeaders := []string{"host", "x-amz-content-sha256", "x-amz-date"}
	if ct := strings.TrimSpace(req.Header.Get("Content-Type")); ct != "" {
		signedHeaders = append(signedHeaders, "content-type")
	}
	sort.Strings(signedHeaders)

	canonicalHeaders, signedHeaderNames := buildCanonicalHeaders(req, signedHeaders)
	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI(req.URL),
		canonicalQuery(req.URL),
		canonicalHeaders,
		signedHeaderNames,
		hashHex(payload),
	}, "\n")

	credentialScope := strings.Join([]string{dateStamp, cred.Region, cred.Service, awsRequestType}, "/")
	stringToSign := strings.Join([]string{
		awsSigV4Algorithm,
		amzDate,
		credentialScope,
		hashHex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := deriveSigningKey(cred.SecretKey, dateStamp, cred.Region, cred.Service)
	signature := hmacSHA256Hex(signingKey, stringToSign)

	auth := fmt.Sprintf(
		"%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		awsSigV4Algorithm,
		cred.AccessKey,
		credentialScope,
		signedHeaderNames,
		signature,
	)
	req.Header.Set("Authorization", auth)
	return nil
}

func buildCanonicalHeaders(req *http.Request, signed []string) (canonical string, signedNames string) {
	lines := make([]string, 0, len(signed))
	for _, name := range signed {
		var val string
		switch name {
		case "host":
			val = strings.TrimSpace(req.Header.Get("Host"))
		case "content-type":
			val = strings.TrimSpace(req.Header.Get("Content-Type"))
		case "x-amz-date":
			val = strings.TrimSpace(req.Header.Get("X-Amz-Date"))
		case "x-amz-content-sha256":
			val = strings.TrimSpace(req.Header.Get("X-Amz-Content-Sha256"))
		}
		lines = append(lines, name+":"+strings.TrimSpace(val))
	}
	return strings.Join(lines, "\n") + "\n", strings.Join(signed, ";")
}

func canonicalURI(u *url.URL) string {
	if u == nil || u.Path == "" {
		return "/"
	}
	return u.EscapedPath()
}

func canonicalQuery(u *url.URL) string {
	if u == nil {
		return ""
	}
	values := u.Query()
	if len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		vals := values[k]
		sort.Strings(vals)
		for _, v := range vals {
			parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(v))
		}
	}
	return strings.Join(parts, "&")
}

func hashHex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(data))
	return mac.Sum(nil)
}

func hmacSHA256Hex(key []byte, data string) string {
	return hex.EncodeToString(hmacSHA256(key, data))
}

func deriveSigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, awsRequestType)
}
