#!/bin/sh
# Chrome 웹 스토어 업로드 및 GitHub Release 첨부용 ZIP 패키지를 만든다.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

VERSION=$(node -p "require('./manifest.json').version")
OUT_DIR="$ROOT/dist"
OUT_FILE="$OUT_DIR/k-apply-v$VERSION.zip"

node scripts/check.mjs

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"
zip -qr -X "$OUT_FILE" manifest.json LICENSE icons/*.png src -x '*.DS_Store'

echo "✔ $(basename "$OUT_FILE") ($(du -h "$OUT_FILE" | cut -f1 | tr -d ' '))"
