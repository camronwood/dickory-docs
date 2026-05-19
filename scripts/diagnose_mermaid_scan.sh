#!/usr/bin/env bash
# Diagnose Mermaid content under a Dickory Docs workspace root.
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
TAGGED_MERMAID_FILES=0
TAGGED_BLOCK_COUNT=0
MMD_COUNT=0
UNTAGGED_CANDIDATES=0

while IFS= read -r -d '' f; do
  MD_COUNT=$((MD_COUNT + 1))
  if grep -q '```[[:space:]]*mermaid' "$f" 2>/dev/null; then
    TAGGED_MERMAID_FILES=$((TAGGED_MERMAID_FILES + 1))
    n=$(grep -c '```[[:space:]]*mermaid' "$f" || true)
    TAGGED_BLOCK_COUNT=$((TAGGED_BLOCK_COUNT + n))
    echo "  tagged:   ${f#"$WS"/} ($n \`\`\`mermaid fence(s))"
  fi
  if grep -qE '```[[:space:]]*$' "$f" 2>/dev/null && grep -qE '^(graph|flowchart|sequenceDiagram|%%\{init)' "$f" 2>/dev/null; then
    UNTAGGED_CANDIDATES=$((UNTAGGED_CANDIDATES + 1))
    echo "  untagged: ${f#"$WS"/} (may use plain \`\`\` + diagram body)"
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

while IFS= read -r -d '' f; do
  MMD_COUNT=$((MMD_COUNT + 1))
  echo "  .mmd:     ${f#"$WS"/}"
done < <(
  find "$WS" -type f -iname '*.mmd' \
    ! -path '*/.git/*' \
    ! -path '*/node_modules/*' \
    ! -path '*/target/*' \
    ! -path '*/dist/*' \
    ! -path '*/build/*' \
    -print0 2>/dev/null
)

echo
echo "Markdown-ish files:  $MD_COUNT (.md / .markdown / .mdx)"
echo "Standalone .mmd:     $MMD_COUNT"
echo "Tagged mermaid:      $TAGGED_MERMAID_FILES files, $TAGGED_BLOCK_COUNT opening fence(s)"
echo "Untagged candidates: $UNTAGGED_CANDIDATES (heuristic; app validates diagram keywords)"
echo

if [[ "$MD_COUNT" -eq 0 && "$MMD_COUNT" -eq 0 ]]; then
  echo "No .md / .markdown / .mdx / .mmd files — gallery will be empty."
elif [[ "$TAGGED_MERMAID_FILES" -eq 0 && "$MMD_COUNT" -eq 0 && "$UNTAGGED_CANDIDATES" -eq 0 ]]; then
  echo "No detectable Mermaid. Dickory Docs supports:"
  echo "  - \`\`\`mermaid fenced blocks"
  echo "  - untagged \`\`\` blocks whose body starts with graph/flowchart/%%{init/etc."
  echo "  - whole-file .mmd diagrams"
else
  echo "OK — Dickory Docs should find diagrams if this folder is the workspace root."
fi
