#!/usr/bin/env bash
# Registers AWS secret patterns in the local git config.
# Run automatically via the "prepare" npm script after install.
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/git-secrets" --register-aws 2>/dev/null
