#!/usr/bin/env bash
set -e

echo "Running post-merge setup..."

# Install root dependencies
pnpm install --frozen-lockfile

# Install mockup sandbox dependencies if present
if [ -d "artifacts/mockup-sandbox" ]; then
  cd artifacts/mockup-sandbox
  npm install
  cd ../..
fi

echo "Post-merge setup complete."
