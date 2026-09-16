#!/bin/sh
# Pre-push safety check. Every test here is a class of accident that actually
# shipped to the club once: a syntax slip, an encoding corruption (v71), a
# forgotten cache-buster (the demo sat on v82 for six versions), a mismatch
# between the two index files. Run by .githooks/pre-push; enable once with:
#   git config core.hooksPath .githooks
set -e
cd "$(git rev-parse --show-toplevel)"

fail(){ echo "PRECHECK FAIL: $1"; exit 1; }

node --check app.js || fail "app.js does not parse"

for f in app.js index.html demo/index.html; do
  grep -q "Â" "$f" && fail "mojibake (double-encoded UTF-8) in $f" || true
done

python -c "
import sys
b=open('app.js','rb').read()
bad=[x for x in b if x<9 or (13<x<32)]
sys.exit(1 if bad else 0)
" || fail "control characters inside app.js"

V_MAIN=$(grep -o "v=[0-9]*" index.html | sort -u)
V_DEMO=$(grep -o "v=[0-9]*" demo/index.html | sort -u)
[ "$(echo "$V_MAIN" | wc -l)" -eq 1 ] || fail "index.html carries mixed ?v= versions"
[ "$(echo "$V_DEMO" | wc -l)" -eq 1 ] || fail "demo/index.html carries mixed ?v= versions"
[ "$V_MAIN" = "$V_DEMO" ] || fail "cache-buster differs: index.html $V_MAIN vs demo $V_DEMO"
grep -q "Currently \*\*$V_MAIN\*\*" HANDOFF.md || fail "HANDOFF.md version line is not $V_MAIN"

echo "precheck OK ($V_MAIN)"
