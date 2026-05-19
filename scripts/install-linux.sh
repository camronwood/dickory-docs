#!/usr/bin/env bash
# One-time install of Dickory Docs from GitHub Releases (AppImage).
# Usage:
#   ./scripts/install-linux.sh              # latest release
#   ./scripts/install-linux.sh v0.3.2       # specific tag
#   VERSION=v0.3.2 ./scripts/install-linux.sh

set -euo pipefail

REPO="camronwood/dickory-docs"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
VERSION="${1:-${VERSION:-}}"

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) suffix="amd64" ;;
  aarch64|arm64) suffix="aarch64" ;;
  *)
    echo "error: unsupported architecture: $arch (need x86_64 or aarch64)" >&2
    exit 1
    ;;
esac

if [[ -z "$VERSION" ]]; then
  if command -v gh >/dev/null 2>&1; then
    VERSION="$(gh release view --repo "$REPO" --json tagName -q .tagName)"
  else
    VERSION="$(python3 - <<'PY'
import json, urllib.request
repo = "camronwood/dickory-docs"
with urllib.request.urlopen(f"https://api.github.com/repos/{repo}/releases/latest") as r:
    print(json.load(r)["tag_name"])
PY
)"
  fi
fi

if [[ -z "$VERSION" ]]; then
  echo "error: could not resolve release version; pass v0.3.2 or set VERSION=" >&2
  exit 1
fi

ver="${VERSION#v}"
asset="dickory-docs_${ver}_${suffix}.AppImage"
url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

echo "Architecture: $arch → ${suffix}"
echo "Release:      $VERSION"
echo "Downloading:  $url"

if command -v curl >/dev/null 2>&1; then
  curl -fL -o "$tmpdir/$asset" "$url"
elif command -v wget >/dev/null 2>&1; then
  wget -O "$tmpdir/$asset" "$url"
else
  python3 - "$url" "$tmpdir/$asset" <<'PY'
import sys, urllib.request
url, dest = sys.argv[1], sys.argv[2]
with urllib.request.urlopen(url) as r, open(dest, "wb") as f:
    f.write(r.read())
PY
fi

chmod +x "$tmpdir/$asset"

if [[ -w "$(dirname "$INSTALL_DIR")" ]] || [[ -d "$INSTALL_DIR" ]]; then
  mkdir -p "$INSTALL_DIR"
  dest="$INSTALL_DIR/dickory-docs"
  mv "$tmpdir/$asset" "$dest"
  chmod +x "$dest"
  echo "Installed: $dest"
  echo "Run:       dickory-docs"
else
  echo "Install dir not writable; leaving AppImage at:"
  echo "  $tmpdir/$asset"
  echo "Run: $tmpdir/$asset"
  trap - EXIT
fi

if command -v apt-get >/dev/null 2>&1; then
  if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
    echo "Installing FUSE (one-time, for AppImage)..."
    if sudo apt-get install -y libfuse2t64 2>/dev/null || sudo apt-get install -y libfuse2; then
      echo "FUSE installed."
    else
      echo "warning: could not install libfuse2 — AppImage may fail to mount until you run:" >&2
      echo "  sudo apt install libfuse2t64   # Ubuntu 24.04" >&2
      echo "  sudo apt install libfuse2      # older Ubuntu" >&2
    fi
  fi
fi
