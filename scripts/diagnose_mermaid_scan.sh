#!/usr/bin/env bash
# Diagnose Mermaid fenced blocks under a Dickory Docs workspace root.
# Usage: ./scripts/diagnose_mermaid_scan.sh [/path/to/workspace]

set -euo pipefail

WS="${1:-${PWD}}"
if [[ ! -d "$WS" ]]; then
  echo "error: not a directory: $WS" >&2
  exit 1
fi

WS="$(cd "$WS" && pwd -P)"
echo "Workspace (canonical): $WS"
echo

MD_COUNT=0
MERMAID_FILES=0
BLOCK_COUNT=0

while IFS= read -r -d '' f; do
  MD_COUNT=$((MD_COUNT + 1))
  if grep -q '```[[:space:]]*mermaid' "$f" 2>/dev/null; then
    MERMAID_FILES=$((MERMAID_FILES + 1))
    n=$(grep -c '```[[:space:]]*mermaid' "$f" || true)
    BLOCK_COUNT=$((BLOCK_COUNT + n))
    echo "  mermaid: ${f#"$WS"/} ($n fence(s))"
  fi
done < <(
  find "$WS" -type f \( -iname '*.md' -o -iname '*.markdown' -o -iname '*.mdx' \) \
    ! -path '*/.git/*' \
    ! -path '*/node_modules/*' \
    ! -path '*/target/*' \
    ! -path '*/dist/*' \
    ! -path '*/build/*' \
    -print0 2>/dev/null
)

echo
echo "Markdown files:     $MD_COUNT"
echo "Files with mermaid: $MERMAID_FILES"
echo "Opening fences:     $BLOCK_COUNT (grep count; may differ slightly from app parser)"
echo

if [[ "$MD_COUNT" -eq 0 ]]; then
  echo "No .md / .markdown / .mdx files — gallery will be empty."
elif [[ "$MERMAID_FILES" -eq 0 ]]; then
  echo "Markdown present but no \`\`\`mermaid fences found."
  echo "Non-standard (same-line diagram after tag):"
  grep -r --include='*.md' --include='*.mdx' -l -E '```[[:space:]]*mermaid[[:space:]]+[^`[:space:]]' "$WS" 2>/dev/null | head -5 || true
else
  echo "OK — Dickory Docs should find diagrams if this folder is the workspace root."
fi
