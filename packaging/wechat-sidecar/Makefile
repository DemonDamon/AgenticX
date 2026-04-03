BINARY=agx-wechat-sidecar
VERSION?=dev

.PHONY: build build-all clean

build:
	go build -ldflags "-s -w" -o $(BINARY) .

build-darwin-arm64:
	GOOS=darwin GOARCH=arm64 go build -ldflags "-s -w" -o $(BINARY)-darwin-arm64 .

build-darwin-amd64:
	GOOS=darwin GOARCH=amd64 go build -ldflags "-s -w" -o $(BINARY)-darwin-amd64 .

build-linux-amd64:
	GOOS=linux GOARCH=amd64 go build -ldflags "-s -w" -o $(BINARY)-linux-amd64 .

build-windows-amd64:
	GOOS=windows GOARCH=amd64 go build -ldflags "-s -w" -o $(BINARY)-windows-amd64.exe .

build-all: build-darwin-arm64 build-darwin-amd64 build-linux-amd64 build-windows-amd64

clean:
	rm -f $(BINARY) $(BINARY)-*
