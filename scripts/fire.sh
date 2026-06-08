#!/bin/bash
# Fire test webhooks at a Hookwire channel
# Usage: ./scripts/fire.sh <channel> [interval] [count]
# Example: ./scripts/fire.sh v3rejkksdnkmfaa2kgjc 2 20

CHANNEL="${1:-v3rejkksdnkmfaa2kgjc}"
INTERVAL="${2:-2}"
COUNT="${3:-0}"
URL="http://localhost:8787/ch/${CHANNEL}"
i=0

echo "🔥 Firing webhooks at ${URL}"
echo "   Interval: ${INTERVAL}s | Ctrl+C to stop"
echo ""

while true; do
  i=$((i + 1))
  NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${URL}" \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: push" \
    -H "X-GitHub-Delivery: $(uuidgen 2>/dev/null || echo $RANDOM)" \
    -d "{\"ref\":\"refs/heads/main\",\"commits\":[{\"message\":\"Commit #${i}\"}],\"repo\":\"hookwire/test\",\"time\":\"${NOW}\"}")

  echo "[${i}] HTTP ${RESP}"

  if [ "${COUNT}" -gt 0 ] && [ "${i}" -ge "${COUNT}" ]; then
    echo ""
    echo "✅ Done — ${COUNT} requests sent."
    break
  fi

  sleep "${INTERVAL}"
done
