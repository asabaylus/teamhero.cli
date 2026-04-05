#!/usr/bin/env sh
set -eu

APP_NAME="${APP_NAME:-teamhero}"
CANDIDATES="$HOME/.local/bin /usr/local/bin"

for d in $CANDIDATES; do
  if [ -L "$d/$APP_NAME" ] || [ -f "$d/$APP_NAME" ]; then
    rm -f "$d/$APP_NAME"
    echo "Removed $d/$APP_NAME"
  fi
done

