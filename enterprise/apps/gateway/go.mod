module github.com/agenticx/enterprise/gateway

go 1.24.0

require (
	github.com/agenticx/enterprise/policy-engine v0.0.0
	github.com/go-chi/chi/v5 v5.2.3
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/lib/pq v1.10.9
	golang.org/x/crypto v0.43.0
	gopkg.in/yaml.v3 v3.0.1
)

require golang.org/x/sys v0.37.0 // indirect

replace github.com/agenticx/enterprise/policy-engine => ../../packages/policy-engine
