#!/bin/bash

# WebSocket Load Test Runner
# This script runs the browser WebSocket load test with monitoring

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
RELAY_URL="${RELAY_URL:-ws://localhost:8787}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8787/health}"
TEST_FILE="load-tests/browser-websocket-test.yml"

echo -e "${GREEN}=== WebSocket Load Test Runner ===${NC}"
echo ""
echo "Configuration:"
echo "  Relay URL: $RELAY_URL"
echo "  Health URL: $HEALTH_URL"
echo "  Test File: $TEST_FILE"
echo ""

# Check if Artillery is installed
if ! command -v artillery &> /dev/null; then
    echo -e "${YELLOW}Artillery not found. Installing...${NC}"
    npm install -g artillery
fi

# Check if test file exists
if [ ! -f "$TEST_FILE" ]; then
    echo -e "${RED}Error: Test file not found: $TEST_FILE${NC}"
    exit 1
fi

# Check relay health before starting
echo -e "${YELLOW}Checking relay health...${NC}"
if command -v curl &> /dev/null; then
    HEALTH_RESPONSE=$(curl -s "$HEALTH_URL" || echo "{}")
    if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
        echo -e "${GREEN}✓ Relay is healthy${NC}"
        echo "$HEALTH_RESPONSE" | jq '.' 2>/dev/null || echo "$HEALTH_RESPONSE"
    else
        echo -e "${YELLOW}⚠ Could not verify relay health (continuing anyway)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ curl not found, skipping health check${NC}"
fi

echo ""
echo -e "${GREEN}Starting load test...${NC}"
echo ""

# Run the test
artillery run --target "$RELAY_URL" "$TEST_FILE"

# Check exit code
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Load test completed successfully${NC}"
    echo ""
    echo "To view detailed report:"
    echo "  artillery report artillery-report.json"
else
    echo ""
    echo -e "${RED}✗ Load test failed with exit code: $EXIT_CODE${NC}"
    exit $EXIT_CODE
fi
