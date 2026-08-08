#!/usr/bin/env bash
set -euo pipefail
API="${API:-http://127.0.0.1:3000}"
curl -sf "$API/health" | grep -q '"ok":true'
CODE=$(curl -sf -X POST "$API/api/rooms" -H 'content-type: application/json' -d '{"title":"smoke"}' | bun -e 'process.stdout.write(JSON.parse(await Bun.stdin.text()).code)')
test -n "$CODE"
curl -sf "$API/api/rooms/$CODE" | grep -q "$CODE"
curl -sf "$API/api/architecture" | grep -q frontend
echo "smoke ok room=$CODE"
