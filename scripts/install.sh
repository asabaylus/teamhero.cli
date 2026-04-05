#!/usr/bin/env sh
set -eu

APP_NAME="${APP_NAME:-teamhero}"
ENTRY_REL="${ENTRY_REL:-dist/cli/index.js}"

# Resolve repo root and absolute entry path
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY_ABS="$REPO_ROOT/$ENTRY_REL"

# Pick an install dir
TARGET_DIR="${TARGET_DIR:-$HOME/.local/bin}"
if [ ! -w "$TARGET_DIR" ]; then
  TARGET_DIR="/usr/local/bin"
fi

# Ensure entry exists
if [ ! -f "$ENTRY_ABS" ]; then
  echo "Build artifact not found at $ENTRY_ABS"
  echo "Run your build first, e.g.: bun run build"
  exit 1
fi

# Ensure entry is executable and has a shebang
if ! head -n1 "$ENTRY_ABS" | grep -q '^#!'; then
  echo "Adding Node shebang to $ENTRY_ABS"
  # Prepend shebang safely via temp file
  TMP="$(mktemp)"
  printf '%s\n' '#!/usr/bin/env node' > "$TMP"
  cat "$ENTRY_ABS" >> "$TMP"
  mv "$TMP" "$ENTRY_ABS"
fi
chmod +x "$ENTRY_ABS"

# Create target dir if needed
mkdir -p "$TARGET_DIR"

# Install as wrapper script (better for Node.js module resolution)
LINK_PATH="$TARGET_DIR/$APP_NAME"
if [ -L "$LINK_PATH" ] || [ -f "$LINK_PATH" ]; then
  rm -f "$LINK_PATH"
fi

# Create a wrapper script that calls node with the absolute path
cat > "$LINK_PATH" <<EOF
#!/usr/bin/env sh
exec node "$ENTRY_ABS" "\$@"
EOF
chmod +x "$LINK_PATH"

echo ""
echo "✅ Installed $APP_NAME"
echo "───────────────────────────────────────────────────"
echo "Wrapper: $LINK_PATH -> $ENTRY_ABS"
echo ""
case ":$PATH:" in
  *":$TARGET_DIR:"*)
    echo "✓ $TARGET_DIR is in your PATH"
    echo ""
    echo "You can now run:"
    echo "  $APP_NAME --version"
    ;;
  *)
    echo "⚠️  PATH Setup Required"
    echo ""
    echo "Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
    echo "  export PATH=\"$TARGET_DIR:\$PATH\""
    echo ""
    echo "Then reload your shell:"
    echo "  source ~/.bashrc  # or source ~/.zshrc"
    echo ""
    echo "After that, you can run:"
    echo "  $APP_NAME --version"
    ;;
esac
echo "───────────────────────────────────────────────────"
echo ""

# Check for Go TUI binary
TUI_BINARY="$REPO_ROOT/tui/teamhero-tui"
if [ -x "$TUI_BINARY" ]; then
  echo "✓ Go TUI binary found at $TUI_BINARY"
elif command -v teamhero-tui >/dev/null 2>&1; then
  echo "✓ teamhero-tui found on PATH"
else
  echo "ℹ  Go TUI binary not found. Build it with:"
  echo "     cd tui && go build -o teamhero-tui ."
  echo ""
  echo "   Or install Go (1.24+) and run: just tui-build"
  echo ""
  echo "   Without the TUI binary, reports will fall back to the legacy Gum script."
fi
echo ""
