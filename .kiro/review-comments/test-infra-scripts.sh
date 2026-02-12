#!/bin/bash
# Focused test: verify infra-deploy script works for each package manager.
# Requires verdaccio running on localhost:4873 with @aws/nx-plugin published.
#
# Setup (run once):
#   rm -rf tmp/local-registry/storage
#   npx -y verdaccio --config .verdaccio/config.yml --listen 4873 &
#   sleep 3
#   npm config set //localhost:4873/:_authToken "test-token"
#   npm publish --registry http://localhost:4873 dist/packages/nx-plugin
#
# Usage: AWS_PROFILE=me bash .kiro/review-comments/test-infra-scripts.sh [npm|pnpm|yarn|bun]

set -euo pipefail

# Ensure Node 22 is active (required for yarn compatibility)
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  source "$NVM_DIR/nvm.sh"
  nvm use 22 2>/dev/null || true
fi

# Add bun to PATH if installed
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

echo "Node version: $(node --version)"

REGISTRY="http://localhost:4873"
PM="${1:?Usage: $0 <npm|pnpm|yarn|bun>}"
TEST_DIR="/tmp/infra-test-$PM"

echo ""
echo "=========================================="
echo "Testing infra-deploy with $PM"
echo "=========================================="

rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

# Create workspace — use npm exec to avoid old npx issues
echo "Creating workspace with $PM..."
(cd "$TEST_DIR" && npm_config_registry="$REGISTRY" npm exec -y -- create-nx-workspace@22.5.0 test-app \
  --pm="$PM" \
  --preset=@aws/nx-plugin \
  --iacProvider=CDK \
  --ci=skip \
  --interactive=false \
  --skipGit \
  --nxCloud=skip 2>&1 | tail -10)

WS="$TEST_DIR/test-app"

# Configure package manager to use local registry for subsequent installs
case "$PM" in
  npm)
    echo "registry=$REGISTRY" > "$WS/.npmrc"
    echo "//localhost:4873/:_authToken=test-token" >> "$WS/.npmrc"
    ;;
  pnpm)
    echo "registry=$REGISTRY" >> "$WS/.npmrc"
    ;;
  yarn)
    echo "registry \"$REGISTRY\"" > "$WS/.yarnrc"
    # Also set globally for yarn since create-nx-workspace may not pass env vars
    yarn config set registry "$REGISTRY" 2>/dev/null || true
    ;;
  bun)
    cat > "$WS/bunfig.toml" << EOF
[install]
registry = "$REGISTRY"

[install.cache]
disable = true
disableManifest = true
EOF
    ;;
esac

# Generate infra with enableStageConfig
echo "Generating ts#infra with enableStageConfig..."
(cd "$WS" && npm exec -- nx generate @aws/nx-plugin:ts#infra --name=infra --enableStageConfig=true --no-interactive 2>&1 | tail -10)

# Check files exist
echo "Checking generated files..."
for f in \
  packages/common/infra-config/src/stages.config.ts \
  packages/common/infra-config/src/stages.types.ts \
  packages/common/infra-config/src/resolve-stage.ts \
  packages/common/scripts/src/infra-deploy.ts \
  packages/common/scripts/src/infra-destroy.ts \
  packages/common/scripts/src/stage-credentials/run.ts \
  packages/infra/src/main.ts; do
  if [ ! -f "$WS/$f" ]; then
    echo "FAIL: $f not found"
    exit 1
  fi
done
echo "✓ All files exist"

# Verify main.ts imports resolveStage
if ! grep -q "resolveStage" "$WS/packages/infra/src/main.ts"; then
  echo "FAIL: main.ts missing resolveStage import"
  exit 1
fi
echo "✓ main.ts imports resolveStage"

# Sync and compile
echo "Syncing and compiling..."
(cd "$WS" && npm exec -- nx sync --verbose 2>&1 | tail -3)
(cd "$WS" && npm exec -- nx run-many --target compile --projects=@test-app/common-infra-config,@test-app/common-scripts --verbose 2>&1 | tail -5)

# Run the deploy script — should print usage and exit 1
echo "Running infra-deploy via tsx..."
set +e
OUTPUT=$(cd "$WS" && npm exec -- tsx packages/common/scripts/src/infra-deploy.ts 2>&1)
RC=$?
set -e

echo "Exit code: $RC"
echo "Output: $OUTPUT"

if echo "$OUTPUT" | grep -q "\[infra-deploy\]"; then
  echo ""
  echo "✅ $PM: infra-deploy works via tsx"
else
  echo ""
  echo "❌ $PM: FAILED"
  exit 1
fi
