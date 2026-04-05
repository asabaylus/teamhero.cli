BINARY_NAME := teamhero-tui
VERSION     ?= dev
LDFLAGS     := -X main.version=$(VERSION)
BUILD_DIR   := build

.PHONY: build test clean all coverage coverage-check

build:
	go build -ldflags "$(LDFLAGS)" -o $(BINARY_NAME) .

test:
	go test ./...

coverage:
	go test ./... -coverprofile=coverage.out -covermode=set
	go tool cover -func=coverage.out | tail -1

coverage-check:
	go test ./... -coverprofile=coverage.out -covermode=set
	@go tool cover -func=coverage.out | tail -1 | awk '{pct=$$3; sub(/%/,"",pct); if(pct+0 < 85) {print "FAIL: " pct "% < 85%"; exit 1} else {print "OK: " pct "%"}}'

clean:
	rm -f $(BINARY_NAME)
	rm -rf $(BUILD_DIR)
	rm -f coverage.out

# Cross-compilation targets
.PHONY: build-linux-amd64 build-linux-arm64 build-darwin-amd64 build-darwin-arm64 build-windows-amd64

build-linux-amd64:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-amd64 .

build-linux-arm64:
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-linux-arm64 .

build-darwin-amd64:
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-amd64 .

build-darwin-arm64:
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-darwin-arm64 .

build-windows-amd64:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(BUILD_DIR)/$(BINARY_NAME)-windows-amd64.exe .

# Build all platforms
all: build-linux-amd64 build-linux-arm64 build-darwin-amd64 build-darwin-arm64 build-windows-amd64
