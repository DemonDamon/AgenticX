module github.com/agenticx/enterprise/gateway

go 1.25.0

require (
	github.com/agenticx/enterprise/policy-engine v0.0.0
	github.com/go-chi/chi/v5 v5.2.3
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/jackc/pgx/v5 v5.9.2
	github.com/lib/pq v1.10.9
	golang.org/x/crypto v0.43.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/kr/text v0.2.0 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	golang.org/x/sync v0.17.0 // indirect
	golang.org/x/sys v0.37.0 // indirect
	golang.org/x/text v0.30.0 // indirect
)

replace github.com/agenticx/enterprise/policy-engine => ../../packages/policy-engine
