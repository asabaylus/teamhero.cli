#!/usr/bin/env bash
# scripts/install-release.sh — Download and install TeamHero from GitHub Releases.
#
# Usage:
#   curl -fsSL https://github.com/asabaylus/teamhero.cli/releases/latest/download/install.sh | bash
#   curl -fsSL <url>/install.sh | bash -s -- --version v1.2.3
#   curl -fsSL <url>/install.sh | bash -s -- --install-dir /usr/local/bin
#
# Supports Linux (amd64, arm64), macOS (amd64, arm64), and WSL.

set -euo pipefail

REPO="asabaylus/teamhero.cli"
INSTALL_DIR="${INSTALL_DIR:-${HOME}/.local/bin}"
VERSION=""

# --- Parse arguments ---
while [ $# -gt 0 ]; do
  case "$1" in
    --version)    VERSION="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: install.sh [--version vX.Y.Z] [--install-dir /path]"
      echo ""
      echo "Options:"
      echo "  --version      Install a specific version (default: latest)"
      echo "  --install-dir  Installation directory (default: ~/.local/bin)"
      echo ""
      echo "Environment variables:"
      echo "  INSTALL_DIR    Same as --install-dir"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# --- Detect platform and architecture ---
detect_platform() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux*)  os="linux" ;;
    Darwin*) os="darwin" ;;
    MINGW*|MSYS*|CYGWIN*)
      echo "Error: Windows native is not supported. Use WSL instead." >&2
      exit 1
      ;;
    *)
      echo "Error: Unsupported operating system: $os" >&2
      exit 1
      ;;
  esac

  case "$arch" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      echo "Error: Unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac

  echo "${os} ${arch}"
}

# --- Fetch latest version tag from GitHub API ---
fetch_latest_version() {
  local url="https://api.github.com/repos/${REPO}/releases/latest"
  local tag

  if command -v curl &>/dev/null; then
    tag="$(curl -fsSL "$url" | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name":[ ]*"([^"]+)".*/\1/')"
  elif command -v wget &>/dev/null; then
    tag="$(wget -qO- "$url" | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name":[ ]*"([^"]+)".*/\1/')"
  else
    echo "Error: curl or wget is required." >&2
    exit 1
  fi

  if [ -z "$tag" ]; then
    echo "Error: Could not determine latest version. Check your network or pass --version." >&2
    exit 1
  fi

  echo "$tag"
}

# --- Download and extract archive ---
download_and_extract() {
  local version="$1" platform="$2" arch="$3" install_dir="$4"
  local archive_name="teamhero-${version}-${platform}-${arch}"
  local archive_ext="tar.gz"
  local url="https://github.com/${REPO}/releases/download/${version}/${archive_name}.${archive_ext}"

  TMPDIR_CLEANUP="$(mktemp -d)"
  local tmpdir="$TMPDIR_CLEANUP"
  trap 'rm -rf "${TMPDIR_CLEANUP:-}"' EXIT

  echo "Downloading TeamHero ${version} for ${platform}/${arch}..."
  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "${tmpdir}/archive.tar.gz"
  elif command -v wget &>/dev/null; then
    wget -q "$url" -O "${tmpdir}/archive.tar.gz"
  fi

  echo "Extracting..."
  tar xzf "${tmpdir}/archive.tar.gz" -C "${tmpdir}"

  # Find the extracted directory
  local extract_dir="${tmpdir}/${archive_name}"
  if [ ! -d "$extract_dir" ]; then
    # Try without version prefix (some archives extract flat)
    extract_dir="$tmpdir"
  fi

  # Install binaries
  mkdir -p "$install_dir"

  if [ -f "${extract_dir}/teamhero-tui" ]; then
    install -m 755 "${extract_dir}/teamhero-tui" "${install_dir}/teamhero-tui"
    echo "  Installed teamhero-tui"
  else
    echo "Error: teamhero-tui binary not found in archive." >&2
    exit 1
  fi

  if [ -f "${extract_dir}/teamhero-service" ]; then
    install -m 755 "${extract_dir}/teamhero-service" "${install_dir}/teamhero-service"
    echo "  Installed teamhero-service"
  fi

  # Create teamhero symlink pointing to teamhero-tui
  ln -sf "${install_dir}/teamhero-tui" "${install_dir}/teamhero"
  echo "  Created teamhero -> teamhero-tui symlink"
}

# --- Verify installation ---
verify_install() {
  local install_dir="$1"
  local bin="${install_dir}/teamhero"

  if [ -x "$bin" ]; then
    local ver
    ver="$("$bin" --version 2>/dev/null || echo "unknown")"
    echo ""
    echo "TeamHero ${ver} installed successfully!"
  else
    echo ""
    echo "Warning: Installation completed but binary is not executable." >&2
  fi
}

# --- Check PATH ---
check_path() {
  local install_dir="$1"

  case ":$PATH:" in
    *":${install_dir}:"*) ;;
    *)
      echo ""
      echo "Add TeamHero to your PATH by adding this to your shell profile:"
      echo ""
      echo "  export PATH=\"${install_dir}:\$PATH\""
      echo ""
      echo "Then restart your shell or run:"
      echo ""
      echo "  source ~/.bashrc  # or ~/.zshrc"
      ;;
  esac
}

# --- Main ---
main() {
  read -r platform arch <<< "$(detect_platform)"

  if [ -z "$VERSION" ]; then
    VERSION="$(fetch_latest_version)"
  fi

  echo "TeamHero Installer"
  echo "  Version:  ${VERSION}"
  echo "  Platform: ${platform}/${arch}"
  echo "  Install:  ${INSTALL_DIR}"
  echo ""

  download_and_extract "$VERSION" "$platform" "$arch" "$INSTALL_DIR"
  verify_install "$INSTALL_DIR"
  check_path "$INSTALL_DIR"
}

main
