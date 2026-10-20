#!/bin/bash
# trigger-overload.sh
# Fills a relay's capacity (MAX_CONCURRENT_USERS) to trigger the
# "System Overloaded" state. Run it only against a relay you operate.
#
# Usage: ./trigger-overload.sh [host] [port] [concurrency]
# Defaults: localhost 8787 600
# Tip: start the relay with MAX_CONCURRENT_USERS=50 and use a lower concurrency.

HOST="${1:-localhost}"
PORT="${2:-8787}"
CONCURRENCY="${3:-600}"
WSS=false
if [ "$PORT" = "443" ]; then
    WSS=true
fi

cd "$(dirname "$0")"

echo "WARNING: this script intentionally floods $HOST:$PORT with $CONCURRENCY connections for 60s."
echo "Open the web app pointed at this relay to see the overload banner."

node stress-test.js \
  --host="$HOST" \
  --port="$PORT" \
  --wss=$WSS \
  --concurrency="$CONCURRENCY" \
  --rampup=5 \
  --duration=60
