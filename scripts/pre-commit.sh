#!/bin/sh
# Local gate — install once:  cp scripts/pre-commit.sh .git/hooks/pre-commit
# Runs the checks CI enforces anyway, so a red build never reaches a push.
set -e

echo "pre-commit: typecheck (strict + tests)"
npm run typecheck >/dev/null

echo "pre-commit: lint"
npm run lint --silent >/dev/null

echo "pre-commit: ok"
