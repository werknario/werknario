#!/usr/bin/env bash
# Package the extension and lay out the EXT_STORE the registry serves.
#   registry/scripts/build-ext-store.sh [OUT_DIR]
# OUT_DIR defaults to registry/ext-store. Produces:
#   OUT_DIR/werknario-webide-agent-web-0.1.0.vsix
#   OUT_DIR/unpacked/{[Content_Types].xml, extension.vsixmanifest, extension/...}
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${1:-$REPO_ROOT/registry/ext-store}"
EXT_DIR="$REPO_ROOT/packages/extension"
VSIX_NAME="werknario-webide-agent-web-0.1.0.vsix"

echo "› building extension bundle"
npm run --prefix "$REPO_ROOT" -w werknario-webide-agent build >/dev/null

echo "› packaging web vsix"
( cd "$EXT_DIR" && rm -f "$VSIX_NAME" && \
  npx --yes @vscode/vsce@3.9.2 package --target web --no-dependencies \
    --allow-missing-repository --skip-license -o "$VSIX_NAME" >/dev/null )

echo "› laying out store at $OUT_DIR"
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/unpacked"
cp "$EXT_DIR/$VSIX_NAME" "$OUT_DIR/$VSIX_NAME"
( cd "$OUT_DIR/unpacked" && unzip -q "$OUT_DIR/$VSIX_NAME" )

echo "✓ store ready:"
find "$OUT_DIR" -type f | sed "s#$OUT_DIR/#   #"
