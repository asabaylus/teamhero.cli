#!/usr/bin/env bash
# scripts/build-plugin.sh — Build the Claude Code plugin zip.
#
# Produces teamhero-cli-plugin.zip in the repo root containing
# the claude-plugin/ directory with a UPX-compressed TUI binary.
#
# Usage:
#   ./scripts/build-plugin.sh
#
# Requirements: Go 1.24+, Python 3 (for zipfile), curl
# Optional: UPX (downloaded automatically if not on PATH)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="${ROOT_DIR}/claude-plugin"
BIN_DIR="${PLUGIN_DIR}/bin"
TUI_SRC="${ROOT_DIR}/tui"
ZIP_NAME="teamhero-cli-plugin.zip"
MAX_SIZE_MB=50

echo "==> Building teamhero-tui for linux-amd64..."
cd "${TUI_SRC}"
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -ldflags "-s -w" -o "${BIN_DIR}/teamhero-tui" .

RAW_SIZE=$(stat -c%s "${BIN_DIR}/teamhero-tui" 2>/dev/null || stat -f%z "${BIN_DIR}/teamhero-tui")
echo "    Raw binary: $(( RAW_SIZE / 1024 / 1024 ))MB (${RAW_SIZE} bytes)"

# --- UPX compression ---
UPX_BIN=""
if command -v upx &>/dev/null; then
  UPX_BIN="upx"
elif [ -x "${ROOT_DIR}/.cache/upx/upx" ]; then
  UPX_BIN="${ROOT_DIR}/.cache/upx/upx"
else
  echo "==> Downloading UPX..."
  UPX_VERSION="4.2.4"
  UPX_DIR="${ROOT_DIR}/.cache/upx"
  mkdir -p "${UPX_DIR}"
  curl -sL "https://github.com/upx/upx/releases/download/v${UPX_VERSION}/upx-${UPX_VERSION}-amd64_linux.tar.xz" \
    | tar xJ --strip-components=1 -C "${UPX_DIR}"
  UPX_BIN="${UPX_DIR}/upx"
fi

if [ -n "${UPX_BIN}" ]; then
  echo "==> Compressing with UPX..."
  "${UPX_BIN}" --best --lzma "${BIN_DIR}/teamhero-tui" || echo "    UPX compression failed — continuing with uncompressed binary"
  COMPRESSED_SIZE=$(stat -c%s "${BIN_DIR}/teamhero-tui" 2>/dev/null || stat -f%z "${BIN_DIR}/teamhero-tui")
  echo "    Compressed: $(( COMPRESSED_SIZE / 1024 / 1024 ))MB (${COMPRESSED_SIZE} bytes)"
fi

# --- Create zip using Python (avoids requiring zip package) ---
echo "==> Creating ${ZIP_NAME}..."
cd "${ROOT_DIR}"

python3 -c "
import zipfile, os, sys

zip_path = '${ZIP_NAME}'
plugin_dir = 'claude-plugin'

with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(plugin_dir):
        for f in filenames:
            filepath = os.path.join(dirpath, f)
            arcname = filepath  # preserve claude-plugin/ prefix
            info = zipfile.ZipInfo(arcname)
            # Preserve executable permission for binaries
            if dirpath.endswith('/bin') or '/bin/' in dirpath:
                info.external_attr = 0o755 << 16
            else:
                info.external_attr = 0o644 << 16
            with open(filepath, 'rb') as fh:
                zf.writestr(info, fh.read())

print(f'    Created {zip_path}')
"

# --- Report contents ---
echo ""
echo "==> Zip contents:"
python3 -c "
import zipfile
with zipfile.ZipFile('${ZIP_NAME}', 'r') as zf:
    for info in zf.infolist():
        size = info.file_size
        unit = 'B'
        if size > 1024*1024:
            size = size // (1024*1024)
            unit = 'MB'
        elif size > 1024:
            size = size // 1024
            unit = 'KB'
        print(f'    {size:>6}{unit}  {info.filename}')
"

# --- Validate size ---
ZIP_SIZE=$(stat -c%s "${ZIP_NAME}" 2>/dev/null || stat -f%z "${ZIP_NAME}")
ZIP_SIZE_MB=$(( ZIP_SIZE / 1024 / 1024 ))
echo ""
echo "==> Total zip size: ${ZIP_SIZE_MB}MB (${ZIP_SIZE} bytes)"

if [ "${ZIP_SIZE_MB}" -ge "${MAX_SIZE_MB}" ]; then
  echo "ERROR: Zip exceeds ${MAX_SIZE_MB}MB limit!" >&2
  exit 1
fi

echo "==> Done! ${ZIP_NAME} is ready."
