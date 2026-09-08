#!/usr/bin/env bash
# End-to-end: stub relay (real bridge rules) + MCP over Streamable HTTP + SDK client.
set -euo pipefail
cd "$(dirname "$0")/.."
node test/stub_relay.mjs & SR=$!; sleep 0.5
KEY=$(node -e "import('nostr-tools').then(m=>console.log(Buffer.from(m.generateSecretKey()).toString('hex')))")
BUZZ_PRIVATE_KEY=$KEY BUZZ_RELAY_URL=http://127.0.0.1:4444 PORT=3111 node src/http.js & MS=$!; sleep 1
node test/e2e_client.mjs; RC=$?
kill $MS $SR 2>/dev/null || true
exit $RC
