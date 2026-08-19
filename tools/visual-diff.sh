#!/usr/bin/env bash
# Compare how a page renders NOW against how it rendered at a git ref.
#
# Built to prove the booking-engine extraction changed nothing visually
# (it produced byte-identical 1280x8436 screenshots). Reusable during the
# redesign for the same question in reverse: "this was meant to be a
# CSS-only refactor — did it actually change any pixels?"
#
#   tools/visual-diff.sh                          # vs HEAD, canoe tour page
#   tools/visual-diff.sh main                     # vs another ref
#   tools/visual-diff.sh HEAD~3 tours/index.html  # another page
#
# Renders with mocked Bokun data and third-party assets blocked, so the
# comparison is deterministic and needs no network.
set -euo pipefail

REF="${1:-HEAD}"
PAGE="${2:-tours/banff-hidden-gem-canoe-tour/index.html}"
URL="/${PAGE%index.html}"
OUT="$(mktemp -d)"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -f "$PAGE" ] || { echo "no such page: $PAGE" >&2; exit 1; }
git cat-file -e "$REF:$PAGE" 2>/dev/null || { echo "$PAGE does not exist at $REF" >&2; exit 1; }

BACKUP="$OUT/working.html"
cp "$PAGE" "$BACKUP"
# Always put the working tree back, even on failure or Ctrl-C.
trap 'cp "$BACKUP" "$PAGE"; echo "(working tree restored)"' EXIT

echo "── rendering working tree ──"
SHOT_PATH="$OUT/current.png" PAGE_URL="$URL" npx playwright test visual --reporter=line >/dev/null

echo "── rendering $REF ──"
git show "$REF:$PAGE" > "$PAGE"
SHOT_PATH="$OUT/ref.png" PAGE_URL="$URL" npx playwright test visual --reporter=line >/dev/null

cp "$BACKUP" "$PAGE"
trap - EXIT

node -e '
const fs = require("fs"), crypto = require("crypto");
const read = (f) => { const b = fs.readFileSync(f);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), size: b.length,
           hash: crypto.createHash("sha256").update(b).digest("hex") }; };
const a = read(process.argv[1] + "/ref.png"), b = read(process.argv[1] + "/current.png");
const fmt = (l, x) => console.log(l.padEnd(12), (x.w + "x" + x.h).padEnd(12), String(x.size).padStart(9) + " bytes  " + x.hash.slice(0, 16));
fmt(process.argv[2], a); fmt("working", b);
if (a.hash === b.hash) { console.log("\n✓ pixel-identical"); process.exit(0); }
console.log("\n✗ RENDERING CHANGED" + (a.w !== b.w || a.h !== b.h ? "  (page height/width differs)" : "  (same size, different pixels)"));
console.log("  " + process.argv[1] + "/ref.png\n  " + process.argv[1] + "/current.png");
process.exit(1);
' "$OUT" "$REF"
