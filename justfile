set dotenv-load := true

default:
  @just --list

# Run bootstrap (install deps, build CLI + TUI, link CLI)
install:
  sh scripts/bootstrap.sh

# Build the TypeScript CLI
build:
  bun run build

# Build the Go TUI binary
tui-build:
  cd tui && go build -o teamhero-tui .

# Build everything (CLI + TUI)
build-all: build tui-build

# Run TypeScript tests
test:
  bun run test

# Run Go TUI tests
tui-test:
  cd tui && go test ./...

# Run all tests (TypeScript + Go)
test-all: test tui-test

# Lint with Biome
lint:
  bun run lint

# Run the report (Go TUI → legacy Gum fallback → headless)
report:
  bun run report

# Run the Agent Maturity Assessment (alias: just assess <args>)
assess *ARGS:
  ./tui/teamhero-tui assess {{ARGS}}

# Uninstall CLI wrapper
uninstall:
  sh scripts/uninstall.sh

# Reset build artifacts and node_modules
reset:
  rm -rf dist node_modules tui/teamhero-tui .claude/hooks/setup.init.log .claude/hooks/setup.maintenance.log

# Deterministic codebase setup
cldi:
  claude --model sonnet --init

# Deterministic codebase maintenance
cldm:
  claude --model sonnet --maintenance

# Allowed tools for agentic setup/maintenance sessions
_agentic_tools := '"Read" "Write" "Glob" "Grep" "Bash(bun:*)" "Bash(bun run:*)" "Bash(npx:*)" "Bash(just:*)" "Bash(~/bin/just:*)" "Bash(git:*)" "Bash(ls:*)"'

# Agentic codebase setup
cldii:
  claude --model sonnet --allowedTools {{ _agentic_tools }} --init "/install"

# Agentic codebase setup interactive
cldit:
  claude --model sonnet --allowedTools {{ _agentic_tools }} --init "/install true"

# Agentic codebase maintenance
cldmm:
  claude --model sonnet --allowedTools {{ _agentic_tools }} --maintenance "/maintenance"
