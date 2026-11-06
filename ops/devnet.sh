#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${FORK_PORT:-8555}"
UPSTREAM="${BASE_UPSTREAM_RPC:-https://base-rpc.publicnode.com}"
RPC="http://127.0.0.1:${PORT}"
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
CRE_SIM_FORWARDER="0x5E342a8438B4f5d39e72875FCee6f76B39CCE548"
CRE_SIMULATION_OWNER="0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"
export RPC_URL="$RPC" DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-base-fork}"
# A fork freezes Chainlink feeds while block time follows the clock, so the fork oracle accepts 30 day old feeds.
export FEED_MAX_AGE=2592000 MARKET_FEED_MAX_AGE=2592000

anvil --fork-url "$UPSTREAM" --chain-id 8453 --port "$PORT" \
  --compute-units-per-second 150 --fork-retry-backoff 1500 --retries 12 --silent &
ANVIL_PID=$!
trap 'kill $ANVIL_PID 2>/dev/null' EXIT

for _ in $(seq 1 60); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 1; done

(cd contracts && PRIVATE_KEY="$DEPLOYER_KEY" CRE_FORWARDER="$CRE_SIM_FORWARDER" CRE_WORKFLOW_OWNER="$CRE_SIMULATION_OWNER" forge script script/Deploy.s.sol --tc Deploy --rpc-url "$RPC" --broadcast --silent)
npm run --silent seed -w @stabrix/ops
npm run --silent cre-config -w @stabrix/ops

echo "fork ready at $RPC (deployment: deployments/${DEPLOYMENT_NAME}.json)"
wait "$ANVIL_PID"
