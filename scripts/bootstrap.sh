#!/usr/bin/env sh
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── 0. Augment PATH for non-interactive shells ────────
# Hooks and CI run in non-interactive shells that don't source
# .bashrc/.zshrc, so recently-installed tools may not be on PATH.
for _dir in \
  /usr/local/go/bin \
  "$HOME/go/bin" \
  "$HOME/.bun/bin" \
  /opt/homebrew/bin \
  /home/linuxbrew/.linuxbrew/bin \
  "$HOME/.local/bin"; do
  if [ -d "$_dir" ]; then
    case ":$PATH:" in
      *":$_dir:"*) ;;
      *) export PATH="$_dir:$PATH" ;;
    esac
  fi
done
unset _dir

echo ""
echo "🚀 TeamHero Bootstrap"
echo "───────────────────────────────────────────────────"
echo ""

# ── 1. Check for Bun ──────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
  echo "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  echo ""
fi
echo "✓ bun $(bun --version)"

# ── 2. Check for Node.js ≥20 ─────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js not found. Install Node.js 20+ and re-run."
  echo "  https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "✗ Node.js $NODE_MAJOR found, but 20+ is required."
  exit 1
fi
echo "✓ node $(node --version)"

# ── 3. Check for Go (required for TUI) ──────────────
GO_AVAILABLE=false
if command -v go >/dev/null 2>&1; then
  GO_AVAILABLE=true
  echo "✓ go $(go version | awk '{print $3}')"
else
  echo ""
  echo "⚠ Go not found. The interactive TUI requires Go 1.24+."
  echo "  Install Go from https://go.dev/dl/"
  echo ""
  echo "  macOS:        brew install go"
  echo "  Ubuntu/WSL2:  sudo apt install golang-go  # or use the official installer"
  echo "  Fedora:       sudo dnf install golang"
  echo ""
  echo "  Without Go, the report will fall back to the legacy Gum-based TUI."
fi

# ── 4. Install dependencies ──────────────────────────
echo ""
echo "Installing dependencies..."
cd "$REPO_ROOT"
bun install

# ── 5. Build TypeScript CLI ──────────────────────────
echo ""
echo "Building CLI..."
bun run build

# ── 6. Build Go TUI binary ──────────────────────────
if [ "$GO_AVAILABLE" = true ] && [ -f "$REPO_ROOT/tui/go.mod" ]; then
  echo ""
  echo "Building Go TUI binary..."
  cd "$REPO_ROOT/tui"
  go build -o teamhero-tui .
  echo "✓ TUI binary built at tui/teamhero-tui"
  cd "$REPO_ROOT"
else
  echo ""
  echo "ℹ Skipping TUI build (Go not available or tui/ not found)"
fi

# ── 7. Install CLI wrapper ────────────────────────────
echo ""
sh "$REPO_ROOT/scripts/install.sh"
